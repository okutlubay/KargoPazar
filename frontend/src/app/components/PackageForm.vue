<script>
export const DEFAULT_PRESETS = [
  { key: 'small', lengthIn: 8, widthIn: 6, heightIn: 4 },
  { key: 'medium', lengthIn: 12, widthIn: 10, heightIn: 6 },
  { key: 'large', lengthIn: 18, widthIn: 14, heightIn: 8 },
  { key: 'poly', lengthIn: 10, widthIn: 13, heightIn: 1 },
]

/** Dimensional weight in lb (rounded up), 0 when dimensions are incomplete. */
export function dimWeightLb(p, divisor = 139) {
  const l = Number(p?.lengthIn), w = Number(p?.widthIn), h = Number(p?.heightIn)
  if (!(l > 0 && w > 0 && h > 0)) return 0
  return Math.ceil((l * w * h) / divisor)
}

/** Billable weight in lb: max(dim weight, actual rounded up to the next lb). */
export function billableWeightLb(p, divisor = 139) {
  const actual = Number(p?.weightLb) || 0
  return Math.max(dimWeightLb(p, divisor), actual > 0 ? Math.ceil(actual) : 0)
}
</script>

<script setup>
import { reactive, ref, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import FormField from './FormField.vue'
import { validateAll } from './validation.js'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  // { lengthIn, widthIn, heightIn, weightLb, preset } (always stored as in / lb)
  modelValue: { type: Object, default: () => ({}) },
  presets: { type: Array, default: () => DEFAULT_PRESETS }, // [{ key, label?, lengthIn, widthIn, heightIn }]
  units: { type: String, default: 'imperial' }, // 'imperial' (in, lb+oz) | 'metric' (cm, kg)
  dimDivisor: { type: Number, default: 139 },
  showPresets: { type: Boolean, default: true },
  showWeight: { type: Boolean, default: true },
  showSummary: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const { t, fmt } = useI18n()

const CM_PER_IN = 2.54
const LB_PER_KG = 2.20462
const metric = computed(() => props.units === 'metric')
const r = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f }
const str = v => (v == null || v === '' || Number.isNaN(v) ? '' : String(v))

const local = reactive({ l: '', w: '', h: '', a: '', b: '' }) // a: lb | kg, b: oz
let lastEmitted = ''

function fromModel() {
  const m = props.modelValue || {}
  const conv = v => (v == null || v === '' ? '' : str(metric.value ? r(v * CM_PER_IN, 1) : r(v, 2)))
  local.l = conv(m.lengthIn)
  local.w = conv(m.widthIn)
  local.h = conv(m.heightIn)
  if (m.weightLb == null || m.weightLb === '') { local.a = ''; local.b = ''; return }
  if (metric.value) { local.a = str(r(m.weightLb / LB_PER_KG, 2)); local.b = '' }
  else {
    let lb = Math.floor(m.weightLb)
    let oz = r((m.weightLb - lb) * 16, 1)
    if (oz >= 16) { lb += 1; oz = 0 }
    local.a = str(lb)
    local.b = oz ? str(oz) : ''
  }
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

function emitModel(extra = {}) {
  const dim = v => { const n = num(v); return n == null ? null : r(metric.value ? n / CM_PER_IN : n, 3) }
  let weightLb = null
  const a = num(local.a), b = num(local.b)
  if (a != null || b != null) weightLb = r(metric.value ? (a || 0) * LB_PER_KG : (a || 0) + (b || 0) / 16, 3)
  const next = { ...props.modelValue, lengthIn: dim(local.l), widthIn: dim(local.w), heightIn: dim(local.h), weightLb, ...extra }
  lastEmitted = JSON.stringify(next)
  emit('update:modelValue', next)
}

function onDim(key, v) {
  local[key] = v
  emitModel({ preset: 'custom' })
}
function onWeight(key, v) {
  local[key] = v
  emitModel()
}
function pickPreset(p) {
  const next = { ...props.modelValue, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, preset: p.key }
  lastEmitted = JSON.stringify(next)
  emit('update:modelValue', next)
  fromModelWith(next)
}
function fromModelWith(m) {
  const conv = v => (v == null || v === '' ? '' : str(metric.value ? r(v * CM_PER_IN, 1) : r(v, 2)))
  local.l = conv(m.lengthIn); local.w = conv(m.widthIn); local.h = conv(m.heightIn)
}

watch(() => props.modelValue, m => { if (JSON.stringify(m) !== lastEmitted) fromModel() }, { deep: true, immediate: true })
watch(() => props.units, fromModel)

const presetLabel = p => p.label || t('components.package.presets.' + p.key)
const presetDims = p => fmt.dims(p, props.units)

// ---- live weights
const dimLb = computed(() => dimWeightLb(props.modelValue, props.dimDivisor))
const actualLb = computed(() => Number(props.modelValue?.weightLb) || 0)
const billLb = computed(() => billableWeightLb(props.modelValue, props.dimDivisor))
const w = (lb, d) => fmt.weight(lb, props.units, metric.value ? 1 : d)
const summary = computed(() => {
  if (!dimLb.value && !actualLb.value) return ''
  if (!dimLb.value) return t('components.package.onlyActual', { actual: w(actualLb.value, 1), billable: w(billLb.value, 0) })
  if (!actualLb.value) return t('components.package.onlyDim', { dim: w(dimLb.value, 0) })
  if (dimLb.value > actualLb.value) return t('components.package.dimWins', { dim: w(dimLb.value, 0), actual: w(actualLb.value, 1), billable: w(billLb.value, 0) })
  return t('components.package.actualWins', { dim: w(dimLb.value, 0), actual: w(actualLb.value, 1), billable: w(billLb.value, 0) })
})
const dimWinning = computed(() => dimLb.value > actualLb.value && actualLb.value > 0)

// ---- validation
const dimsRule = () => [local.l, local.w, local.h].every(v => (num(v) || 0) > 0) ? true : t('components.package.dimsRequired')
const weightRule = () => (actualLb.value > 0 ? true : t('components.package.weightRequired'))
const dimsField = ref(null)
const weightField = ref(null)
const root = ref(null)
function validate() { return validateAll([dimsField.value, weightField.value].filter(Boolean), { scroll: false }) }
function focus(opts) { const f = [dimsField.value, weightField.value].find(x => x?.invalid) || dimsField.value; f?.focus(opts) }
defineExpose({ validate, focus, el: root })

const unitLen = computed(() => (metric.value ? t('common.units.cm') : t('common.units.in')))
</script>

<template>
  <fieldset ref="root" class="kpz-package" :disabled="disabled">
    <div v-if="showPresets" class="pf-presets" role="radiogroup" :aria-label="t('components.package.presetsLabel')">
      <button
        v-for="p in presets"
        :key="p.key"
        type="button"
        role="radio"
        class="pf-preset"
        :class="{ active: modelValue.preset === p.key }"
        :aria-checked="modelValue.preset === p.key"
        @click="pickPreset(p)"
      >
        <Icon :name="p.key === 'poly' ? 'tag' : 'box'" :size="16" />
        <span class="pf-p-name">{{ presetLabel(p) }}</span>
        <span class="mono pf-p-dims">{{ presetDims(p) }}</span>
      </button>
      <span class="pf-preset custom" :class="{ active: modelValue.preset === 'custom' }" aria-hidden="true">
        <Icon name="edit" :size="16" />
        <span class="pf-p-name">{{ t('components.package.presets.custom') }}</span>
        <span class="mono pf-p-dims">{{ t('components.package.customHint') }}</span>
      </span>
    </div>

    <div class="pf-grid">
      <FormField ref="dimsField" class="pf-dims" :label="t('components.package.dims', { unit: unitLen })" required :rules="[dimsRule]" :value="[local.l, local.w, local.h].join('x')" v-slot="{ id, invalid, describedBy }">
        <div class="pf-dim-row">
          <div class="pf-unit-input">
            <input :id="id" class="input mono" inputmode="decimal" :value="local.l" :placeholder="t('components.package.lengthShort')" :aria-label="t('components.package.length')" :aria-invalid="invalid" :aria-describedby="describedBy" @input="onDim('l', $event.target.value)" />
          </div>
          <span class="pf-x" aria-hidden="true">x</span>
          <div class="pf-unit-input">
            <input class="input mono" inputmode="decimal" :value="local.w" :placeholder="t('components.package.widthShort')" :aria-label="t('components.package.width')" :aria-invalid="invalid" @input="onDim('w', $event.target.value)" />
          </div>
          <span class="pf-x" aria-hidden="true">x</span>
          <div class="pf-unit-input">
            <input class="input mono" inputmode="decimal" :value="local.h" :placeholder="t('components.package.heightShort')" :aria-label="t('components.package.height')" :aria-invalid="invalid" @input="onDim('h', $event.target.value)" />
            <span class="pf-suffix">{{ unitLen }}</span>
          </div>
        </div>
      </FormField>

      <FormField v-if="showWeight" ref="weightField" class="pf-weight" :label="t('components.package.weight')" required :rules="[weightRule]" :value="actualLb" v-slot="{ id, invalid, describedBy }">
        <div class="pf-dim-row">
          <div class="pf-unit-input">
            <input :id="id" class="input mono" inputmode="decimal" :value="local.a" placeholder="0" :aria-label="metric ? t('common.units.kg') : t('common.units.lb')" :aria-invalid="invalid" :aria-describedby="describedBy" @input="onWeight('a', $event.target.value)" />
            <span class="pf-suffix">{{ metric ? t('common.units.kg') : t('common.units.lb') }}</span>
          </div>
          <div v-if="!metric" class="pf-unit-input">
            <input class="input mono" inputmode="decimal" :value="local.b" placeholder="0" :aria-label="t('common.units.oz')" :aria-invalid="invalid" @input="onWeight('b', $event.target.value)" />
            <span class="pf-suffix">{{ t('common.units.oz') }}</span>
          </div>
        </div>
      </FormField>
    </div>

    <div v-if="showSummary" class="pf-summary" aria-live="polite">
      <div class="pf-stats">
        <div class="pf-stat">
          <span class="pf-s-label">{{ t('components.package.actual') }}</span>
          <span class="mono pf-s-val">{{ actualLb ? w(actualLb, 1) : '-' }}</span>
        </div>
        <div class="pf-stat" :class="{ win: dimWinning }">
          <span class="pf-s-label">{{ t('components.package.dimWeight') }}</span>
          <span class="mono pf-s-val">{{ dimLb ? w(dimLb, 0) : '-' }}</span>
        </div>
        <div class="pf-stat bill">
          <span class="pf-s-label">{{ t('components.package.billable') }}</span>
          <span class="mono pf-s-val">{{ billLb ? w(billLb, 0) : '-' }}</span>
        </div>
      </div>
      <div v-if="summary" class="pf-sentence" :class="{ warn: dimWinning }">
        <Icon :name="dimWinning ? 'info' : 'scale'" :size="13" />
        <span>{{ summary }}</span>
      </div>
      <div class="pf-formula mono">{{ t('components.package.formula', { d: dimDivisor }) }}</div>
    </div>
  </fieldset>
</template>

<style scoped>
.kpz-package { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.pf-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.pf-preset {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px; text-align: left;
  border: 1px solid var(--line-2); border-radius: var(--r-md); background: var(--surface); color: var(--ink-2); transition: all 0.15s;
}
button.pf-preset:hover { border-color: var(--line-strong); background: var(--bg-2); }
.pf-preset.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); box-shadow: 0 0 0 1px var(--accent) inset; }
.pf-preset.custom { border-style: dashed; cursor: default; }
.pf-preset:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.pf-p-name { font-weight: 600; font-size: 13px; color: var(--ink-1); }
.pf-p-dims { font-size: 11px; color: var(--ink-3); }
.pf-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 14px; }
@media (max-width: 640px) { .pf-grid { grid-template-columns: 1fr; } }
.pf-dim-row { display: flex; align-items: center; gap: 6px; }
.pf-unit-input { position: relative; flex: 1; min-width: 0; }
.pf-unit-input .input { padding-right: 34px; }
.pf-suffix { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; color: var(--ink-3); pointer-events: none; }
.pf-x { color: var(--ink-4); font-size: 13px; }
.pf-summary { border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--bg-2); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.pf-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.pf-stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line-1); }
.pf-stat.win { border-color: oklch(0.89 0.09 80); }
.pf-stat.bill { border-color: var(--ink-1); }
.pf-s-label { font-size: 11.5px; color: var(--ink-3); }
.pf-s-val { font-size: 15px; font-weight: 600; color: var(--ink-1); }
.pf-sentence { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
.pf-sentence :deep(svg) { margin-top: 2px; flex: none; }
.pf-sentence.warn { color: oklch(0.45 0.10 65); }
.pf-formula { font-size: 11px; color: var(--ink-4); }
</style>
