<script setup>
// Create / edit a customer specific rate card (spec 10.2). Emits `saved(card)`.
import { ref, reactive, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import FormField from '../FormField.vue'
import Spinner from '../Spinner.vue'
import SegmentedControl from '../SegmentedControl.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { saveCustomerCard } from '../../api/admin.js'
import { errorText, fieldText } from '../settings/util.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  card: { type: Object, default: null },
  customers: { type: Array, default: () => [] },
  markups: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:open', 'saved'])
const { t, fmt } = useI18n()

const carriers = computed(() => db.all('carriers').filter(c => c.status === 'active' && c.type !== 'international'))
const servicesOf = code => carriers.value.find(c => c.code === code)?.services ?? []
const ymd = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

const form = reactive({ id: null, customerId: 'CUS-001', name: '', validFrom: '', validUntil: '', status: 'approved', note: '', lines: [] })
const errors = ref({})
const saving = ref(false)

watch(() => props.open, v => {
  if (!v) return
  errors.value = {}
  const c = props.card
  if (c) {
    Object.assign(form, {
      id: c.id, customerId: c.customerId, name: c.name, validFrom: ymd(c.validFrom), validUntil: ymd(c.validUntil), status: c.status,
      note: typeof c.note === 'object' && c.note ? c.note.tr ?? c.note.en ?? '' : c.note ?? '',
      lines: c.lines.map(l => ({ carrier: l.carrier, service: l.service, mode: l.fixedPrice != null ? 'fixed' : 'markup', value: l.fixedPrice != null ? l.fixedPrice : Math.round(l.markupPct * 1000) / 10 })),
    })
  } else {
    const now = new Date()
    Object.assign(form, { id: null, customerId: props.customers.find(x => x.id !== 'CUS-001')?.id ?? 'CUS-001', name: '', validFrom: ymd(now), validUntil: ymd(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())), status: 'pending_review', note: '', lines: [{ carrier: 'UPS', service: 'GROUND', mode: 'markup', value: 10 }] })
  }
}, { immediate: true })

const customer = computed(() => props.customers.find(c => c.id === form.customerId))
const planMarkup = computed(() => props.markups[customer.value?.plan] ?? null)

function addLine() {
  const used = new Set(form.lines.map(l => `${l.carrier}-${l.service}`))
  for (const c of carriers.value) for (const s of c.services) if (!used.has(`${c.code}-${s.code}`)) { form.lines.push({ carrier: c.code, service: s.code, mode: 'markup', value: 10 }); return }
}
function onCarrier(l) { l.service = servicesOf(l.carrier)[0]?.code }
const err = k => (errors.value[k] ? fieldText(errors.value[k], 'admin') : '')

async function submit() {
  errors.value = {}
  saving.value = true
  try {
    const card = await saveCustomerCard({
      id: form.id ?? undefined,
      customerId: form.customerId, name: form.name, status: form.status, note: form.note || null,
      validFrom: form.validFrom ? new Date(form.validFrom + 'T00:00:00').toISOString() : '',
      validUntil: form.validUntil ? new Date(form.validUntil + 'T23:59:00').toISOString() : '',
      lines: form.lines.map(l => (l.mode === 'fixed' ? { carrier: l.carrier, service: l.service, fixedPrice: l.value === '' ? '' : Number(l.value) } : { carrier: l.carrier, service: l.service, markupPct: l.value === '' ? NaN : Number(l.value) / 100 })),
    })
    toast.success(form.id ? t('admin.rates.cardUpdated') : t('admin.rates.cardCreated'))
    emit('saved', card)
    emit('update:open', false)
  } catch (e) {
    errors.value = e?.details ?? {}
    toast.error(errorText(e, 'admin'))
    requestAnimationFrame(() => document.querySelector('.cce .field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  } finally { saving.value = false }
}
</script>

<template>
  <Modal :open="open" :title="form.id ? t('admin.rates.editCard') : t('admin.rates.newCard')" :subtitle="t('admin.rates.cardEditorDesc')" size="lg" @update:open="v => emit('update:open', v)">
    <form id="cce-form" class="cce stack-lg" novalidate @submit.prevent="submit">
      <div class="form-grid">
        <FormField :label="t('admin.rates.customer')" required :error="err('customerId')" :value="form.customerId" v-slot="{ id }">
          <select :id="id" v-model="form.customerId" class="select">
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }} · {{ t('plans.' + c.plan) }}</option>
          </select>
        </FormField>
        <FormField :label="t('admin.rates.cardName')" required :error="err('name')" :value="form.name" v-slot="{ id, invalid }">
          <input :id="id" v-model="form.name" class="input" :placeholder="t('admin.rates.cardNamePh')" :aria-invalid="invalid || !!err('name')" />
        </FormField>
        <FormField :label="t('admin.rates.validFrom')" required :error="err('validFrom')" :value="form.validFrom" v-slot="{ id }">
          <input :id="id" v-model="form.validFrom" type="date" class="input" />
        </FormField>
        <FormField :label="t('admin.rates.validUntil')" required :error="err('validUntil')" :value="form.validUntil" v-slot="{ id }">
          <input :id="id" v-model="form.validUntil" type="date" class="input" />
        </FormField>
      </div>
      <div class="callout neutral" v-if="planMarkup != null">
        <Icon name="info" :size="14" />{{ t('admin.rates.planMarkupHint', { plan: t('plans.' + customer.plan), pct: fmt.percent(planMarkup, 0) }) }}
      </div>

      <section>
        <div class="sec-head">
          <div class="sec-title">{{ t('admin.rates.lines') }}</div>
          <button type="button" class="btn btn-ghost btn-sm" @click="addLine"><Icon name="plus" :size="12" />{{ t('admin.rates.addLine') }}</button>
        </div>
        <div v-if="errors.lines" class="field-error">{{ err('lines') }}</div>
        <div v-for="(l, i) in form.lines" :key="i" class="line-wrap">
          <div class="line">
            <select v-model="l.carrier" class="select" :aria-label="t('admin.rates.carrier')" @change="onCarrier(l)">
              <option v-for="c in carriers" :key="c.code" :value="c.code">{{ c.name }}</option>
            </select>
            <select v-model="l.service" class="select" :aria-label="t('admin.rates.service')" :aria-invalid="!!errors['lines.' + i + '.service']">
              <option v-for="s in servicesOf(l.carrier)" :key="s.code" :value="s.code">{{ s.name }}</option>
            </select>
            <SegmentedControl v-model="l.mode" :options="[{ value: 'markup', label: t('admin.rates.modeMarkup') }, { value: 'fixed', label: t('admin.rates.modeFixed') }]" size="sm" :aria-label="t('admin.rates.mode')" />
            <div class="valw">
              <input v-model="l.value" type="number" :step="l.mode === 'fixed' ? 0.01 : 0.5" min="0" class="input num" :aria-label="t('admin.rates.value')" :aria-invalid="!!errors['lines.' + i + '.value']" />
              <span class="unit">{{ l.mode === 'fixed' ? '$' : '%' }}</span>
            </div>
            <button type="button" class="btn-icon" :disabled="form.lines.length === 1" :aria-label="t('admin.rates.removeLine')" @click="form.lines.splice(i, 1)"><Icon name="trash" :size="14" /></button>
          </div>
          <div v-if="errors['lines.' + i + '.service'] || errors['lines.' + i + '.value']" class="field-error">{{ err('lines.' + i + '.service') || err('lines.' + i + '.value') }}</div>
          <div v-else-if="l.mode === 'markup' && planMarkup != null && l.value !== ''" class="hint">{{ Number(l.value) / 100 < planMarkup ? t('admin.rates.lineBelow', { d: fmt.number((planMarkup * 100) - Number(l.value), 1) }) : t('admin.rates.lineAbove') }}</div>
        </div>
      </section>

      <div class="form-grid">
        <FormField :label="t('admin.rates.approval')" :value="form.status" v-slot="{ id }">
          <select :id="id" v-model="form.status" class="select">
            <option v-for="s in ['approved', 'pending_review', 'draft']" :key="s" :value="s">{{ t('status.' + s) }}</option>
          </select>
        </FormField>
        <FormField :label="t('admin.rates.note')" optional :value="form.note" v-slot="{ id }">
          <input :id="id" v-model="form.note" class="input" :placeholder="t('admin.rates.notePh')" />
        </FormField>
      </div>
      <p class="hint">{{ t('admin.rates.approvalHint') }}</p>
    </form>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
      <button type="submit" form="cce-form" class="btn btn-primary" :disabled="saving"><Spinner v-if="saving" :size="14" />{{ t('common.save') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.sec-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.sec-title { font-family: var(--font-display); font-weight: 600; font-size: 14.5px; }
.line-wrap { margin-bottom: 8px; }
.line { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto 130px 32px; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--line-1); background: var(--bg-2); border-radius: 10px; }
.valw { display: flex; align-items: center; gap: 6px; }
.valw .input { width: 100%; }
.unit { color: var(--ink-3); font-size: 13px; }
.hint { color: var(--ink-3); font-size: 12px; margin: 4px 4px 0; }
@media (max-width: 860px) { .line { grid-template-columns: 1fr 1fr; } }
</style>
