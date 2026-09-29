<script setup>
// Create / edit a shipping rule: conditions (AND) + actions. Emits `saved(rule)`.
import { ref, reactive, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import FormField from '../FormField.vue'
import Spinner from '../Spinner.vue'
import Toggle from '../Toggle.vue'
import { US_STATES } from '../AddressForm.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { RULE_FIELDS, RULE_ACTIONS, saveRule } from '../../store/rules.js'
import { errorText, fieldText } from './util.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  rule: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'saved'])
const { t, tx } = useI18n()

const form = reactive({ id: null, nameTr: '', nameEn: '', active: true, conditions: [], actions: [] })
const saving = ref(false)
const errors = ref({})
const showErrors = ref(false)

const carriers = computed(() => db.all('carriers').filter(c => c.status === 'active' && c.type !== 'international'))
const countries = computed(() => db.all('countries'))
const stateCodes = computed(() => US_STATES.map(s => (Array.isArray(s) ? s[0] : typeof s === 'string' ? s : s.code)))
const LIST_OPS = ['in', 'not_in']

function blankCondition() { return { field: 'declaredValue', op: 'gt', value: '' } }
function blankAction() { return { type: 'add_insurance' } }

watch(() => props.open, v => {
  if (!v) return
  errors.value = {}
  showErrors.value = false
  const r = props.rule
  if (r) {
    Object.assign(form, {
      id: r.id ?? null,
      nameTr: typeof r.name === 'string' ? r.name : r.name?.tr ?? '',
      nameEn: typeof r.name === 'string' ? r.name : r.name?.en ?? '',
      active: r.active !== false,
      conditions: (r.conditions ?? []).map(c => ({ ...c, value: Array.isArray(c.value) ? c.value.join(', ') : c.value })),
      actions: (r.actions ?? []).map(a => ({ ...a })),
    })
  } else Object.assign(form, { id: null, nameTr: '', nameEn: '', active: true, conditions: [blankCondition()], actions: [blankAction()] })
}, { immediate: true })

const fieldDef = id => RULE_FIELDS.find(f => f.id === id)
const actionDef = id => RULE_ACTIONS.find(a => a.id === id)

function onFieldChange(c) {
  const f = fieldDef(c.field)
  if (!f.ops.includes(c.op)) c.op = f.ops[0]
  c.value = f.type === 'country' ? 'US' : f.type === 'enum' ? f.options[0] : ''
}
function onActionChange(a) {
  const def = actionDef(a.type)
  for (const k of ['carrier', 'service', 'hub', 'value', 'tag']) if (!def.params.includes(k)) delete a[k]
  if (def.params.includes('carrier') && !a.carrier) a.carrier = carriers.value[0]?.code
  if (def.params.includes('service')) a.service = servicesOf(a.carrier)[0]?.code
  if (def.params.includes('hub') && !a.hub) a.hub = 'LA01'
  if (a.type === 'max_transit_days') a.value = a.value ?? 2
  if (a.type === 'select_strategy') a.value = 'cheapest'
  if (a.type === 'add_tag') a.tag = a.tag ?? ''
}
function servicesOf(code) { return carriers.value.find(c => c.code === code)?.services ?? [] }
function onCarrierChange(a) { if (actionDef(a.type).params.includes('service')) a.service = servicesOf(a.carrier)[0]?.code }

function toggleEnum(c, opt) {
  const list = String(c.value || '').split(',').map(s => s.trim()).filter(Boolean)
  const i = list.indexOf(opt)
  if (i >= 0) list.splice(i, 1)
  else list.push(opt)
  c.value = list.join(', ')
}
const hasEnum = (c, opt) => String(c.value || '').split(',').map(s => s.trim()).includes(opt)

function normalized() {
  return {
    id: form.id ?? undefined,
    name: { tr: form.nameTr.trim(), en: (form.nameEn || form.nameTr).trim() },
    active: form.active,
    conditions: form.conditions.map(c => {
      const f = fieldDef(c.field)
      let value = c.value
      if (LIST_OPS.includes(c.op)) value = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => (f.type === 'state' || f.type === 'country' ? s.toUpperCase() : s))
      else if (f.type === 'number') value = value === '' ? '' : Number(value)
      else if (f.type === 'state' || f.type === 'country') value = String(value ?? '').trim().toUpperCase()
      else value = String(value ?? '').trim()
      return { field: c.field, op: c.op, value }
    }),
    actions: form.actions.map(a => {
      const out = { type: a.type }
      for (const p of actionDef(a.type).params) out[p] = p === 'value' && a.type === 'max_transit_days' ? Number(a[p]) : a[p]
      return out
    }),
  }
}

const rowErrors = computed(() => {
  const r = normalized()
  const out = { name: '', conditions: [], actions: [], general: '' }
  if (!r.name.tr) out.name = t('common.validation.required')
  r.conditions.forEach((c, i) => {
    const empty = c.value === '' || c.value == null || (Array.isArray(c.value) && !c.value.length)
    if (empty) out.conditions[i] = t('settings.rules.editor.valueRequired')
    else if (fieldDef(c.field).type === 'number' && !Number.isFinite(Number(c.value))) out.conditions[i] = t('common.validation.number')
    else if (fieldDef(c.field).type === 'state') {
      const vals = Array.isArray(c.value) ? c.value : [c.value]
      if (vals.some(v => !stateCodes.value.includes(v))) out.conditions[i] = t('settings.rules.editor.stateInvalid')
    }
  })
  r.actions.forEach((a, i) => {
    if (actionDef(a.type).params.some(p => a[p] == null || a[p] === '' || (p === 'value' && a.type === 'max_transit_days' && !(Number(a[p]) >= 1)))) out.actions[i] = t('settings.rules.editor.paramRequired')
  })
  if (!r.actions.length) out.general = t('settings.rules.editor.actionRequired')
  return out
})
const invalid = computed(() => !!(rowErrors.value.name || rowErrors.value.general || rowErrors.value.conditions.some(Boolean) || rowErrors.value.actions.some(Boolean)))

async function submit() {
  showErrors.value = true
  if (invalid.value) {
    requestAnimationFrame(() => document.querySelector('.rule-editor .row-err, .rule-editor [aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return
  }
  saving.value = true
  try {
    const saved = await saveRule(normalized())
    toast.success(form.id ? t('settings.rules.updated') : t('settings.rules.created'))
    emit('saved', saved)
    emit('update:open', false)
  } catch (e) {
    errors.value = Object.fromEntries(Object.entries(e?.details ?? {}).map(([k, v]) => [k, fieldText(v)]))
    toast.error(errorText(e))
  } finally { saving.value = false }
}

const conditionPreview = computed(() => normalized())
</script>

<template>
  <Modal :open="open" :title="form.id ? t('settings.rules.editor.editTitle') : t('settings.rules.editor.newTitle')" :subtitle="t('settings.rules.editor.subtitle')" size="lg" @update:open="v => emit('update:open', v)">
    <form id="rule-form" class="rule-editor stack-lg" novalidate @submit.prevent="submit">
      <div class="form-grid">
        <FormField :label="t('settings.rules.editor.nameTr')" required :error="showErrors ? rowErrors.name || errors.name : ''" :value="form.nameTr" v-slot="{ id, invalid: inv, describedBy }">
          <input :id="id" v-model="form.nameTr" class="input" :placeholder="t('settings.rules.editor.namePh')" :aria-invalid="inv" :aria-describedby="describedBy" />
        </FormField>
        <FormField :label="t('settings.rules.editor.nameEn')" optional :hint="t('settings.rules.editor.nameEnHint')" :value="form.nameEn" v-slot="{ id }">
          <input :id="id" v-model="form.nameEn" class="input" />
        </FormField>
      </div>

      <section>
        <div class="sec-head">
          <div>
            <div class="sec-title">{{ t('settings.rules.editor.conditions') }}</div>
            <div class="hint">{{ t('settings.rules.editor.conditionsHint') }}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="form.conditions.push(blankCondition())"><Icon name="plus" :size="12" />{{ t('settings.rules.editor.addCondition') }}</button>
        </div>
        <div v-if="!form.conditions.length" class="callout neutral">{{ t('settings.rules.editor.noConditions') }}</div>
        <div v-for="(c, i) in form.conditions" :key="i" class="crow-wrap">
          <div v-if="i > 0" class="and mono">{{ t('settings.rules.editor.and') }}</div>
          <div class="crow">
            <select v-model="c.field" class="select" :aria-label="t('settings.rules.editor.field')" @change="onFieldChange(c)">
              <option v-for="f in RULE_FIELDS" :key="f.id" :value="f.id">{{ t('core.rules.fields.' + f.id) }}</option>
            </select>
            <select v-model="c.op" class="select" :aria-label="t('settings.rules.editor.operator')">
              <option v-for="op in fieldDef(c.field).ops" :key="op" :value="op">{{ t('core.rules.ops.' + op) }}</option>
            </select>
            <div class="val">
              <template v-if="fieldDef(c.field).type === 'enum' && LIST_OPS.includes(c.op)">
                <div class="chips">
                  <button v-for="o in fieldDef(c.field).options" :key="o" type="button" :class="['chip', { on: hasEnum(c, o) }]" @click="toggleEnum(c, o)">{{ t('settings.rules.channels.' + o) }}</button>
                </div>
              </template>
              <select v-else-if="fieldDef(c.field).type === 'enum'" v-model="c.value" class="select" :aria-label="t('settings.rules.editor.value')">
                <option v-for="o in fieldDef(c.field).options" :key="o" :value="o">{{ t('settings.rules.channels.' + o) }}</option>
              </select>
              <select v-else-if="fieldDef(c.field).type === 'state' && !LIST_OPS.includes(c.op)" v-model="c.value" class="select" :aria-label="t('settings.rules.editor.value')">
                <option value="" disabled>{{ t('settings.rules.editor.pickState') }}</option>
                <option v-for="s in stateCodes" :key="s" :value="s">{{ s }}</option>
              </select>
              <select v-else-if="fieldDef(c.field).type === 'country' && !LIST_OPS.includes(c.op)" v-model="c.value" class="select" :aria-label="t('settings.rules.editor.value')">
                <option v-for="co in countries" :key="co.code" :value="co.code">{{ co.code }} · {{ tx(co.name) }}</option>
              </select>
              <div v-else-if="fieldDef(c.field).type === 'number'" class="num-wrap">
                <input v-model="c.value" type="number" step="0.01" class="input num" :aria-label="t('settings.rules.editor.value')" :aria-invalid="showErrors && !!rowErrors.conditions[i]" />
                <span class="unit mono">{{ fieldDef(c.field).unit }}</span>
              </div>
              <input v-else v-model="c.value" class="input" :placeholder="LIST_OPS.includes(c.op) || c.op === 'in' ? t('settings.rules.editor.listPh') : ''" :aria-label="t('settings.rules.editor.value')" :aria-invalid="showErrors && !!rowErrors.conditions[i]" />
            </div>
            <button type="button" class="btn-icon" :aria-label="t('settings.rules.editor.removeCondition')" @click="form.conditions.splice(i, 1)"><Icon name="trash" :size="14" /></button>
          </div>
          <div v-if="showErrors && rowErrors.conditions[i]" class="field-error row-err">{{ rowErrors.conditions[i] }}</div>
        </div>
      </section>

      <section>
        <div class="sec-head">
          <div>
            <div class="sec-title">{{ t('settings.rules.editor.actions') }}</div>
            <div class="hint">{{ t('settings.rules.editor.actionsHint') }}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="form.actions.push(blankAction())"><Icon name="plus" :size="12" />{{ t('settings.rules.editor.addAction') }}</button>
        </div>
        <div v-if="showErrors && rowErrors.general" class="callout danger row-err">{{ rowErrors.general }}</div>
        <div v-for="(a, i) in form.actions" :key="i" class="crow-wrap">
          <div class="crow">
            <select v-model="a.type" class="select" :aria-label="t('settings.rules.editor.action')" @change="onActionChange(a)">
              <option v-for="d in RULE_ACTIONS" :key="d.id" :value="d.id">{{ t('core.rules.actions.' + d.id) }}</option>
            </select>
            <div class="params">
              <select v-if="actionDef(a.type).params.includes('carrier')" v-model="a.carrier" class="select" :aria-label="t('settings.rules.editor.carrier')" @change="onCarrierChange(a)">
                <option v-for="c in carriers" :key="c.code" :value="c.code">{{ c.name }}</option>
              </select>
              <select v-if="actionDef(a.type).params.includes('service')" v-model="a.service" class="select" :aria-label="t('settings.rules.editor.service')">
                <option v-for="s in servicesOf(a.carrier)" :key="s.code" :value="s.code">{{ s.name }}</option>
              </select>
              <select v-if="actionDef(a.type).params.includes('hub')" v-model="a.hub" class="select" :aria-label="t('settings.rules.editor.hub')">
                <option value="NJ01">NJ01 · New Jersey</option>
                <option value="LA01">LA01 · Los Angeles</option>
              </select>
              <div v-if="a.type === 'max_transit_days'" class="num-wrap">
                <input v-model="a.value" type="number" min="1" max="10" class="input num" :aria-label="t('settings.rules.editor.days')" />
                <span class="unit">{{ t('settings.rules.editor.daysUnit') }}</span>
              </div>
              <select v-if="a.type === 'select_strategy'" v-model="a.value" class="select" :aria-label="t('settings.rules.editor.strategy')">
                <option value="cheapest">{{ t('core.rules.strategies.cheapest') }}</option>
                <option value="fastest">{{ t('core.rules.strategies.fastest') }}</option>
              </select>
              <input v-if="a.type === 'add_tag'" v-model="a.tag" class="input" :placeholder="t('settings.rules.editor.tagPh')" :aria-label="t('settings.rules.editor.tag')" />
              <span v-if="!actionDef(a.type).params.length" class="hint">{{ t('settings.rules.editor.noParams') }}</span>
            </div>
            <button type="button" class="btn-icon" :aria-label="t('settings.rules.editor.removeAction')" @click="form.actions.splice(i, 1)"><Icon name="trash" :size="14" /></button>
          </div>
          <div v-if="showErrors && rowErrors.actions[i]" class="field-error row-err">{{ rowErrors.actions[i] }}</div>
        </div>
      </section>

      <div class="foot-row">
        <Toggle v-model="form.active" :label="t('settings.rules.editor.activeLabel')" :description="t('settings.rules.editor.activeDesc')" />
      </div>
      <div class="preview callout neutral">
        <Icon name="info" :size="14" />
        <span>
          <b>{{ t('settings.rules.editor.preview') }}:</b>
          {{ conditionPreview.conditions.length ? conditionPreview.conditions.map(c => `${t('core.rules.fields.' + c.field)} ${t('core.rules.ops.' + c.op)} ${Array.isArray(c.value) ? c.value.join(', ') : c.value}`).join(` ${t('core.rules.and')} `) : t('core.rules.always') }}
          →
          {{ conditionPreview.actions.map(a => t('core.rules.actions.' + a.type)).join(', ') || '-' }}
        </span>
      </div>
    </form>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
      <button type="submit" form="rule-form" class="btn btn-primary" :disabled="saving"><Spinner v-if="saving" :size="14" />{{ form.id ? t('common.save') : t('settings.rules.editor.create') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.sec-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 10px; }
.sec-title { font-family: var(--font-display); font-weight: 600; font-size: 14.5px; }
.hint { color: var(--ink-3); font-size: 12.5px; }
.crow-wrap { margin-bottom: 8px; }
.and { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-ink); margin: 2px 0 6px 12px; }
.crow { display: grid; grid-template-columns: 190px 170px minmax(0, 1fr) 32px; gap: 8px; align-items: start; padding: 10px; background: var(--bg-2); border: 1px solid var(--line-1); border-radius: 10px; }
.crow:has(.params) { grid-template-columns: 220px minmax(0, 1fr) 32px; }
.params { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-height: 38px; }
.params .select, .params .input { flex: 1; min-width: 140px; }
.val { min-width: 0; }
.val .select, .val .input { width: 100%; }
.num-wrap { display: flex; align-items: center; gap: 6px; }
.num-wrap .input { width: 100%; max-width: 140px; }
.unit { font-size: 12px; color: var(--ink-3); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); font-size: 12.5px; }
.chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); font-weight: 500; }
.row-err { margin-left: 4px; }
.preview { align-items: flex-start; }
@media (max-width: 860px) {
  .crow, .crow:has(.params) { grid-template-columns: 1fr 32px; }
  .crow > :not(.btn-icon) { grid-column: 1; }
  .crow > .btn-icon { grid-column: 2; grid-row: 1; }
}
</style>
