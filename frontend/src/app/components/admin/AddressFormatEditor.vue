<script setup>
// Address format editor (spec 9.6): drag and drop field order, required flags, postcode regex
// with a live test box and an ordered preview. v-model = country.addressFormat.
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Toggle from '../Toggle.vue'
import { useI18n } from '../../i18n/index.js'
import tr from '../../i18n/tr.js'
import en from '../../i18n/en.js'
import { testPostcode } from '../../api/countries.js'

const props = defineProps({
  modelValue: { type: Object, required: true }, // { fields: [{ key, label{tr,en}, required }], postalRegex, postalExample, postalLabel{tr,en} }
  errors: { type: Object, default: () => ({}) }, // { 'addressFormat.fields': msg, 'addressFormat.postalRegex': msg, ... }
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const { t, tx } = useI18n()

const LIB = ['name', 'company', 'line1', 'line2', 'city', 'district', 'state', 'zip', 'phone']
const both = key => ({ tr: key.split('.').reduce((o, p) => o?.[p], tr) ?? key, en: key.split('.').reduce((o, p) => o?.[p], en) ?? key })

const fields = computed(() => props.modelValue.fields ?? [])
const missing = computed(() => LIB.filter(k => !fields.value.some(f => f.key === k)))
function update(patch) { emit('update:modelValue', { ...props.modelValue, ...patch }) }
function setFields(list) { update({ fields: list }) }

// drag and drop (HTML5) + keyboard buttons
const dragIdx = ref(-1)
const overIdx = ref(-1)
function onDragStart(i, e) { dragIdx.value = i; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)) } catch {} }
function onDragOver(i, e) { if (dragIdx.value < 0) return; e.preventDefault(); overIdx.value = i }
function onDrop(i) {
  const from = dragIdx.value
  dragIdx.value = -1; overIdx.value = -1
  if (from < 0 || from === i) return
  const list = [...fields.value]
  const [m] = list.splice(from, 1)
  list.splice(i, 0, m)
  setFields(list)
}
function onDragEnd() { dragIdx.value = -1; overIdx.value = -1 }
function move(i, d) {
  const j = i + d
  if (j < 0 || j >= fields.value.length) return
  const list = [...fields.value]
  ;[list[i], list[j]] = [list[j], list[i]]
  setFields(list)
}
function toggleReq(i, v) { const list = fields.value.map((f, k) => (k === i ? { ...f, required: v } : f)); setFields(list) }
function removeField(i) { setFields(fields.value.filter((_, k) => k !== i)) }
function addField(key) { if (!key) return; setFields([...fields.value, { key, label: both('admin.countries.fieldLib.' + key), required: ['line1', 'city', 'zip', 'name'].includes(key) }]) }
const newKey = ref('')
function onAdd() { addField(newKey.value); newKey.value = '' }

// postcode test
const sample = ref('')
const test = computed(() => testPostcode(props.modelValue.postalRegex ?? '', sample.value))
const exampleOk = computed(() => {
  const r = testPostcode(props.modelValue.postalRegex ?? '', props.modelValue.postalExample ?? '')
  return r.valid
})
</script>

<template>
  <div class="afe">
    <div class="afe-cols">
      <div>
        <div class="lbl">{{ t('admin.countries.fieldOrder') }}</div>
        <p class="hint">{{ t('admin.countries.fieldOrderHint') }}</p>
        <ol :class="['flist', { bad: errors['addressFormat.fields'] }]" :aria-label="t('admin.countries.fieldOrder')">
          <li
            v-for="(f, i) in fields" :key="f.key + i"
            :class="{ dragging: dragIdx === i, over: overIdx === i && dragIdx !== i }"
            :draggable="!disabled"
            @dragstart="onDragStart(i, $event)" @dragover="onDragOver(i, $event)" @drop.prevent="onDrop(i)" @dragend="onDragEnd"
          >
            <span class="grip" aria-hidden="true"><Icon name="grip" :size="14" /></span>
            <span class="fno mono">{{ i + 1 }}</span>
            <span class="fname">{{ tx(f.label) }} <span class="mono fkey">{{ f.key }}</span></span>
            <Toggle :model-value="!!f.required" size="sm" :label="t('admin.countries.required')" :disabled="disabled || f.key === 'line1'" @update:model-value="v => toggleReq(i, v)" />
            <span class="fbtns">
              <button type="button" class="btn-icon" :disabled="disabled || i === 0" :aria-label="t('admin.countries.moveUp')" @click="move(i, -1)"><Icon name="chevron-up" :size="13" /></button>
              <button type="button" class="btn-icon" :disabled="disabled || i === fields.length - 1" :aria-label="t('admin.countries.moveDown')" @click="move(i, 1)"><Icon name="chevron-down" :size="13" /></button>
              <button type="button" class="btn-icon" :disabled="disabled || f.key === 'line1'" :aria-label="t('admin.countries.removeField')" @click="removeField(i)"><Icon name="trash" :size="13" /></button>
            </span>
          </li>
        </ol>
        <div v-if="errors['addressFormat.fields']" class="field-error">{{ errors['addressFormat.fields'] }}</div>
        <div v-if="missing.length" class="addrow">
          <select v-model="newKey" class="select sm" :disabled="disabled" :aria-label="t('admin.countries.addField')">
            <option value="">{{ t('admin.countries.addFieldPh') }}</option>
            <option v-for="k in missing" :key="k" :value="k">{{ t('admin.countries.fieldLib.' + k) }}</option>
          </select>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="!newKey || disabled" @click="onAdd"><Icon name="plus" :size="12" />{{ t('admin.countries.addField') }}</button>
        </div>
      </div>

      <div class="right">
        <div class="lbl">{{ t('admin.countries.postalTitle') }}</div>
        <label class="fl">
          <span>{{ t('admin.countries.postalRegex') }}</span>
          <input class="input mono" :value="modelValue.postalRegex" :disabled="disabled" :aria-invalid="!!errors['addressFormat.postalRegex']" spellcheck="false" @input="e => update({ postalRegex: e.target.value })" />
          <span v-if="errors['addressFormat.postalRegex']" class="field-error">{{ errors['addressFormat.postalRegex'] }}</span>
        </label>
        <label class="fl">
          <span>{{ t('admin.countries.postalExample') }}</span>
          <input class="input mono" :value="modelValue.postalExample" :disabled="disabled" @input="e => update({ postalExample: e.target.value })" />
          <span v-if="errors['addressFormat.postalExample']" class="field-error">{{ errors['addressFormat.postalExample'] }}</span>
          <span v-else-if="modelValue.postalExample && exampleOk === false" class="field-error">{{ t('admin.validation.example_mismatch') }}</span>
        </label>
        <div class="tester">
          <label class="fl">
            <span>{{ t('admin.countries.testBox') }}</span>
            <input v-model="sample" class="input mono" :placeholder="modelValue.postalExample || ''" spellcheck="false" />
          </label>
          <div :class="['result', test.error ? 'bad' : test.valid === true ? 'ok' : test.valid === false ? 'bad' : '']" role="status" aria-live="polite">
            <template v-if="test.error"><Icon name="x-circle" :size="14" />{{ t('admin.countries.regexInvalid') }}</template>
            <template v-else-if="test.valid === true"><Icon name="check-circle" :size="14" />{{ t('admin.countries.testOk', { v: sample.trim().toUpperCase() }) }}</template>
            <template v-else-if="test.valid === false"><Icon name="x-circle" :size="14" />{{ t('admin.countries.testBad', { v: sample.trim().toUpperCase() }) }}</template>
            <template v-else>{{ t('admin.countries.testIdle') }}</template>
          </div>
        </div>

        <div class="lbl mt">{{ t('admin.countries.preview') }}</div>
        <div class="preview" aria-hidden="true">
          <div v-for="f in fields" :key="f.key" class="pv">
            <span>{{ tx(f.label) }}<i v-if="f.required">*</i></span>
            <div class="pv-in mono">{{ f.key === 'zip' ? (modelValue.postalExample || '') : '' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.afe-cols { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 20px; }
.lbl { font-size: 13px; font-weight: 600; color: var(--ink-1); }
.lbl.mt { margin-top: 16px; }
.hint { font-size: 12px; color: var(--ink-3); margin: 2px 0 8px; }
.flist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.flist.bad { outline: 1px solid var(--danger); outline-offset: 3px; border-radius: 8px; }
.flist li { display: grid; grid-template-columns: 16px 20px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 6px 8px; border: 1px solid var(--line-1); border-radius: 9px; background: var(--surface); }
.flist li[draggable='true'] { cursor: grab; }
.flist li.dragging { opacity: .45; }
.flist li.over { border-color: var(--accent); box-shadow: 0 -2px 0 var(--accent); }
.grip { color: var(--ink-4); display: grid; place-items: center; }
.fno { font-size: 11px; color: var(--ink-4); }
.fname { font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fkey { font-size: 10.5px; color: var(--ink-4); margin-left: 4px; }
.fbtns { display: inline-flex; }
.fbtns .btn-icon { width: 26px; height: 26px; }
.addrow { display: flex; gap: 8px; margin-top: 8px; }
.select.sm { height: 32px; font-size: 13px; }
.fl { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink-2); margin-top: 8px; }
.tester { margin-top: 8px; padding: 10px; border: 1px dashed var(--line-2); border-radius: 10px; background: var(--bg-2); }
.tester .fl { margin-top: 0; }
.result { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-3); margin-top: 8px; min-height: 18px; }
.result.ok { color: var(--success); }
.result.bad { color: var(--danger); }
.preview { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding: 10px; border: 1px solid var(--line-1); border-radius: 10px; }
.pv span { font-size: 11.5px; color: var(--ink-3); }
.pv i { color: var(--danger); font-style: normal; margin-left: 2px; }
.pv-in { height: 26px; border: 1px solid var(--line-1); border-radius: 6px; background: var(--bg-2); font-size: 12px; padding: 4px 8px; color: var(--ink-4); }
@media (max-width: 860px) { .afe-cols { grid-template-columns: 1fr; } }
</style>
