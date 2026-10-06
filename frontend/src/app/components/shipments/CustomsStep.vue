<script setup>
// Customs step of the shipment wizard (spec 5.5 step 5): items, HS code with AI top-3,
// origin, content type, declared total and automatic CN22 / CN23 choice.
//   <CustomsStep v-model="customs" ref="c" />   c.value.validate() -> boolean
import { computed, ref, nextTick } from 'vue'
import Icon from '@/components/Icon.vue'
import Popover from '../Popover.vue'
import SegmentedControl from '../SegmentedControl.vue'
import CustomsInfoPanel from '../customs/CustomsInfoPanel.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { suggestHs, normalizeHsCode } from '../../api/ai.js'
import { apiErrorText } from './helpers.js'
import { toast } from '../toast.js'

const props = defineProps({ modelValue: { type: Object, required: true }, destination: { type: String, default: '' }, destCode: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])

const CN22_LIMIT = 400
const ORIGINS = ['TR', 'US', 'GB', 'DE', 'CN', 'IN']
const TYPES = ['merchandise', 'gift', 'sample', 'documents']
// `pending` holds the value emitted in this tick so two quick edits before the parent re-renders do not overwrite each other.
let pending = null
const c = computed(() => props.modelValue)
const cur = () => pending ?? props.modelValue
const errors = ref({})

function update(patch) {
  pending = { ...cur(), ...patch }
  emit('update:modelValue', pending)
  nextTick(() => { pending = null })
}
function setItem(i, patch) {
  const items = cur().items.map((it, k) => (k === i ? { ...it, ...patch } : it))
  update({ items })
  for (const k of Object.keys(patch)) if (errors.value[`${i}.${k}`]) { const e = { ...errors.value }; delete e[`${i}.${k}`]; errors.value = e }
}
function addItem() { update({ items: [...cur().items, { description: '', qty: 1, unitValue: '', hsCode: '', origin: 'TR', weightLb: '' }] }) }
function removeItem(i) { update({ items: cur().items.filter((_, k) => k !== i) }) }

const total = computed(() => c.value.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitValue) || 0), 0))
// Customs information panel: opens as soon as a line has a valid HS code
const infoItems = computed(() => c.value.items
  .filter(i => normalizeHsCode(i.hsCode))
  .map(i => ({ hsCode: normalizeHsCode(i.hsCode), title: i.description, qty: Number(i.qty) || 1, unitValueUsd: Number(i.unitValue) || 0, origin: i.origin || 'TR' })))
const infoOrigin = computed(() => {
  const n = {}
  for (const i of infoItems.value) n[i.origin] = (n[i.origin] || 0) + 1
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'TR'
})
const form = computed(() => (total.value <= CN22_LIMIT ? 'cn22' : 'cn23'))

// AI HS suggestions per row
const sugg = ref({})
const loadingRow = ref(-1)
async function fetchHs(i) {
  const title = cur().items[i].description
  if (!String(title).trim()) { errors.value = { ...errors.value, [`${i}.description`]: t('shipments.customs.needDesc') }; return }
  loadingRow.value = i
  try {
    const r = await suggestHs(title, '', { source: 'shipment' })
    sugg.value = { ...sugg.value, [i]: r }
  } catch (e) { toast.error(apiErrorText(e)) } finally { loadingRow.value = -1 }
}
function pickHs(i, code, close) { setItem(i, { hsCode: code }); close?.() }

function validate() {
  const e = {}
  if (!c.value.items.length) e.items = t('shipments.customs.noItems')
  c.value.items.forEach((it, i) => {
    if (!String(it.description ?? '').trim()) e[`${i}.description`] = t('common.validation.required')
    if (!(Number(it.qty) > 0)) e[`${i}.qty`] = t('common.validation.number')
    if (!(Number(it.unitValue) >= 0) || it.unitValue === '') e[`${i}.unitValue`] = t('common.validation.number')
    if (!it.hsCode) e[`${i}.hsCode`] = t('common.validation.required')
    else if (!normalizeHsCode(it.hsCode)) e[`${i}.hsCode`] = t('shipments.customs.hsFormat')
  })
  errors.value = e
  if (Object.keys(e).length) {
    requestAnimationFrame(() => document.querySelector('.cs .invalid')?.focus())
    return false
  }
  // normalize codes
  update({ items: c.value.items.map(it => ({ ...it, hsCode: normalizeHsCode(it.hsCode) })) })
  return true
}
defineExpose({ validate, total, form })
</script>

<template>
  <div class="cs">
    <div class="callout neutral"><Icon name="shield" :size="15" />{{ t('shipments.customs.intro', { country: destination }) }}</div>

    <div class="row-top">
      <div>
        <div class="field-label">{{ t('shipments.customs.contentType') }}</div>
        <SegmentedControl :model-value="c.contentType" :options="TYPES.map(x => ({ value: x, label: t('shipments.customs.types.' + x) }))" size="sm" @update:model-value="v => update({ contentType: v })" />
      </div>
      <div class="form-pill" :class="form">
        <span class="mono">{{ form.toUpperCase() }}</span>
        <span>{{ t('shipments.customs.formAuto.' + form, { limit: fmt.moneyNative(CN22_LIMIT, 'USD', 0) }) }}</span>
      </div>
    </div>

    <div v-if="errors.items" class="field-error">{{ errors.items }}</div>
    <div v-for="(it, i) in c.items" :key="i" class="item">
      <div class="item-grid">
        <div class="f desc">
          <label class="field-label" :for="`cs-d-${i}`">{{ t('shipments.customs.description') }}</label>
          <input :id="`cs-d-${i}`" class="input" :class="{ invalid: errors[`${i}.description`] }" :value="it.description" @input="setItem(i, { description: $event.target.value })" />
          <div v-if="errors[`${i}.description`]" class="field-error">{{ errors[`${i}.description`] }}</div>
        </div>
        <div class="f">
          <label class="field-label" :for="`cs-q-${i}`">{{ t('shipments.customs.qty') }}</label>
          <input :id="`cs-q-${i}`" type="number" min="1" class="input" :class="{ invalid: errors[`${i}.qty`] }" :value="it.qty" @input="setItem(i, { qty: $event.target.value })" />
          <div v-if="errors[`${i}.qty`]" class="field-error">{{ errors[`${i}.qty`] }}</div>
        </div>
        <div class="f">
          <label class="field-label" :for="`cs-v-${i}`">{{ t('shipments.customs.unitValue') }}</label>
          <input :id="`cs-v-${i}`" type="number" min="0" step="0.01" class="input" :class="{ invalid: errors[`${i}.unitValue`] }" :value="it.unitValue" @input="setItem(i, { unitValue: $event.target.value })" />
          <div v-if="errors[`${i}.unitValue`]" class="field-error">{{ errors[`${i}.unitValue`] }}</div>
        </div>
        <div class="f hs">
          <label class="field-label" :for="`cs-h-${i}`">{{ t('shipments.customs.hs') }}</label>
          <div class="hs-row">
            <input :id="`cs-h-${i}`" class="input mono" :class="{ invalid: errors[`${i}.hsCode`] }" placeholder="0000.00" :value="it.hsCode" @input="setItem(i, { hsCode: $event.target.value })" />
            <Popover :width="320" placement="bottom-end" :aria-label="t('shipments.customs.aiTop3')" @show="!sugg[i] && fetchHs(i)">
              <template #trigger="{ toggle, open, id }">
                <button type="button" class="btn btn-soft btn-sm ai-btn" :aria-expanded="open" :aria-controls="id" @click="toggle"><Icon name="spark" :size="12" />AI</button>
              </template>
              <template #default="{ close }">
                <div class="hs-pop">
                  <div class="hs-pop-head"><span class="badge-ai"><Icon name="spark" :size="10" />AI</span>{{ t('shipments.customs.aiTop3') }}</div>
                  <div v-if="loadingRow === i" class="muted small">{{ t('common.loading') }}</div>
                  <template v-else-if="sugg[i]">
                    <div v-if="sugg[i].lowConfidence" class="callout warn small">{{ t('orders.hs.low') }}</div>
                    <button v-for="s in sugg[i].top" :key="s.code" type="button" class="hs-opt" @click="pickHs(i, s.code, close)">
                      <span class="mono strong">{{ s.code }}</span>
                      <span class="hs-desc">{{ tx(s.desc) }}</span>
                      <span class="mono small">{{ fmt.percent(s.prob, 0) }}</span>
                    </button>
                    <button type="button" class="btn-link small" @click="fetchHs(i)">{{ t('shipments.customs.refresh') }}</button>
                  </template>
                  <div v-else class="muted small">{{ t('shipments.customs.needDesc') }}</div>
                </div>
              </template>
            </Popover>
          </div>
          <div v-if="errors[`${i}.hsCode`]" class="field-error">{{ errors[`${i}.hsCode`] }}</div>
        </div>
        <div class="f">
          <label class="field-label" :for="`cs-o-${i}`">{{ t('shipments.customs.origin') }}</label>
          <select :id="`cs-o-${i}`" class="input select" :value="it.origin" @change="setItem(i, { origin: $event.target.value })">
            <option v-for="o in ORIGINS" :key="o" :value="o">{{ t('shipments.customs.countries.' + o) }}</option>
          </select>
        </div>
        <button v-if="c.items.length > 1" type="button" class="btn-icon rm" :aria-label="t('shipments.customs.remove')" @click="removeItem(i)"><Icon name="trash" :size="14" /></button>
      </div>
    </div>
    <button type="button" class="btn btn-ghost btn-sm" @click="addItem"><Icon name="plus" :size="13" />{{ t('shipments.customs.add') }}</button>

    <div class="totals">
      <span>{{ t('shipments.customs.total') }}</span>
      <strong class="mono">{{ fmt.money(total) }}</strong>
    </div>

    <CustomsInfoPanel v-if="infoItems.length" :items="infoItems" :dest="destCode || 'US'" :origin="infoOrigin" :incoterm="c.incoterm || 'DDP'" @update:incoterm="v => update({ incoterm: v })" />
  </div>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 12px; }
.row-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.form-pill { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--r-md); font-size: 12.5px; background: var(--accent-soft); color: var(--accent-ink); }
.form-pill.cn23 { background: oklch(0.96 0.06 80); color: oklch(0.42 0.1 70); }
.form-pill .mono { font-weight: 700; }
.item { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px; background: var(--bg); }
.item-grid { display: grid; grid-template-columns: 2.2fr .7fr 1fr 1.5fr 1fr auto; gap: 10px; align-items: start; }
.f { display: flex; flex-direction: column; min-width: 0; }
.hs-row { display: flex; gap: 6px; }
.hs-row .input { flex: 1; min-width: 0; }
.ai-btn { height: 38px; }
.rm { margin-top: 22px; }
.hs-pop { padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.hs-pop-head { display: flex; gap: 8px; align-items: center; font-weight: 600; font-size: 13px; margin-bottom: 2px; }
.hs-opt { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 8px; border-radius: 8px; border: 1px solid var(--line-1); background: var(--surface); text-align: left; cursor: pointer; font-size: 12.5px; color: var(--ink-1); }
.hs-opt:hover { border-color: var(--accent); background: var(--accent-soft); }
.hs-desc { color: var(--ink-2); }
.strong { font-weight: 600; }
.small { font-size: 12px; }
.totals { display: flex; justify-content: space-between; padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); font-size: 14px; }
@media (max-width: 1024px) { .item-grid { grid-template-columns: 1fr 1fr; } .desc, .hs { grid-column: 1 / -1; } .rm { margin-top: 0; } }
</style>
