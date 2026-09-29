<script setup>
// Last mile recipients for "deliver directly to recipients" (spec 9.2 step 3):
// CSV upload, pick from awaiting orders, or add manually. Each row gets a live address score.
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import SegmentedControl from '@/app/components/SegmentedControl.vue'
import FileDrop from '@/app/components/FileDrop.vue'
import ScoreBadge from '@/app/components/ScoreBadge.vue'
import Modal from '@/app/components/Modal.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { parseRecipientsCsv, recipientsCsvTemplate, validateRecipient, listRecipientOrders } from '@/app/api/intl.js'
import { validateAddressSync } from '@/app/api/ai.js'
import { errorText } from './stage.js'

const props = defineProps({
  recipients: { type: Array, required: true },
  error: { type: String, default: '' },
})
const { t, fmt } = useI18n()
const mode = ref('csv')
const csvErrors = ref([])
const csvInfo = ref(null)
const drop = ref(null)

function scoreOf(r) {
  try { return validateAddressSync({ ...r, country: 'US' }).score } catch { return null }
}
function addMany(list, source) {
  const keys = new Set(props.recipients.map(r => r.orderId || `${r.name}|${r.zip}`))
  let added = 0
  for (const r of list) {
    const k = r.orderId || `${r.name}|${r.zip}`
    if (keys.has(k)) continue
    keys.add(k)
    props.recipients.push({ ...r, source, score: scoreOf(r) })
    added++
  }
  return added
}

function onFile(f) {
  const res = parseRecipientsCsv(f.text)
  csvErrors.value = res.errors
  const added = addMany(res.recipients, 'csv')
  csvInfo.value = { name: f.name, rows: res.rowCount ?? 0, added, errors: res.errors.length }
  if (added) toast.success(t('intl.recipients.csvAdded', { n: added }))
  else if (!res.errors.length) toast.info(t('intl.recipients.csvNothing'))
}
function downloadTemplate() {
  const blob = new Blob([recipientsCsvTemplate()], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'recipients_template.csv'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// ---- pick orders
const pickOpen = ref(false)
const orders = ref([])
const ordersLoading = ref(false)
const picked = ref([])
const orderQ = ref('')
async function openPick() {
  pickOpen.value = true
  ordersLoading.value = true
  picked.value = []
  try { orders.value = await listRecipientOrders() } catch (e) { toast.error(errorText(t, e)) } finally { ordersLoading.value = false }
}
const already = computed(() => new Set(props.recipients.map(r => r.orderId).filter(Boolean)))
const visibleOrders = computed(() => {
  const q = orderQ.value.trim().toLowerCase()
  return orders.value.filter(o => !q || [o.id, o.shipTo?.name, o.shipTo?.city, o.shipTo?.state, o.channelOrderNo].some(v => String(v || '').toLowerCase().includes(q)))
})
function togglePick(id) {
  picked.value = picked.value.includes(id) ? picked.value.filter(x => x !== id) : [...picked.value, id]
}
function confirmPick() {
  const list = orders.value.filter(o => picked.value.includes(o.id)).map(o => ({
    name: o.shipTo.name, company: o.shipTo.company || '', line1: o.shipTo.line1, line2: o.shipTo.line2 || '', city: o.shipTo.city,
    state: o.shipTo.state, zip: o.shipTo.zip, residential: o.shipTo.residential !== false, orderId: o.id,
  }))
  const n = addMany(list, 'order')
  pickOpen.value = false
  if (n) toast.success(t('intl.recipients.ordersAdded', { n }))
}

// ---- manual
const manual = ref({ name: '', line1: '', line2: '', city: '', state: '', zip: '' })
const manualErr = ref({})
function addManual() {
  const r = { ...manual.value, state: String(manual.value.state || '').toUpperCase().trim(), zip: String(manual.value.zip || '').trim() }
  const e = validateRecipient(r)
  manualErr.value = e
  if (Object.keys(e).length) return
  addMany([{ ...r, residential: true }], 'manual')
  manual.value = { name: '', line1: '', line2: '', city: '', state: '', zip: '' }
}

function remove(i) {
  const [r] = props.recipients.splice(i, 1)
  toast.info(t('intl.recipients.removed', { name: r.name }), { action: { label: t('common.undo'), onClick: () => props.recipients.splice(i, 0, r) } })
}
function clearAll() {
  const copy = [...props.recipients]
  props.recipients.splice(0)
  csvInfo.value = null
  drop.value?.clear?.()
  toast.info(t('intl.recipients.cleared', { n: copy.length }), { action: { label: t('common.undo'), onClick: () => props.recipients.push(...copy) } })
}
const lowScore = computed(() => props.recipients.filter(r => r.score != null && r.score < 70).length)
</script>

<template>
  <div class="re">
    <SegmentedControl v-model="mode" size="sm" :options="[
      { value: 'csv', label: t('intl.recipients.csv'), icon: 'upload' },
      { value: 'orders', label: t('intl.recipients.orders'), icon: 'list' },
      { value: 'manual', label: t('intl.recipients.manual'), icon: 'edit' },
    ]" :aria-label="t('intl.recipients.source')" />

    <div v-if="mode === 'csv'" class="box">
      <FileDrop ref="drop" accept=".csv" :hint="t('intl.recipients.csvHint')" compact @file="onFile" @error="m => toast.error(m)" />
      <div class="row">
        <button type="button" class="btn btn-link" @click="downloadTemplate"><Icon name="download" :size="13" /> {{ t('intl.recipients.template') }}</button>
        <span v-if="csvInfo" class="muted">{{ t('intl.recipients.csvResult', csvInfo) }}</span>
      </div>
      <ul v-if="csvErrors.length" class="errs">
        <li v-for="(e, i) in csvErrors.slice(0, 8)" :key="i"><Icon name="x-circle" :size="12" />{{ t('intl.recipients.csvError', { row: e.row, field: t('intl.recipients.fields.' + e.field), code: t('intl.validation.' + e.code) }) }}</li>
        <li v-if="csvErrors.length > 8" class="muted">{{ t('intl.recipients.moreErrors', { n: csvErrors.length - 8 }) }}</li>
      </ul>
    </div>
    <div v-else-if="mode === 'orders'" class="box">
      <p class="muted">{{ t('intl.recipients.ordersHint') }}</p>
      <button type="button" class="btn btn-ghost" @click="openPick"><Icon name="list" :size="14" />{{ t('intl.recipients.pickOrders') }}</button>
    </div>
    <form v-else class="box manual" @submit.prevent="addManual">
      <input v-model="manual.name" class="input" :class="{ invalid: manualErr.name }" :placeholder="t('intl.recipients.fields.name')" :aria-label="t('intl.recipients.fields.name')" />
      <input v-model="manual.line1" class="input" :class="{ invalid: manualErr.line1 }" :placeholder="t('intl.recipients.fields.line1')" :aria-label="t('intl.recipients.fields.line1')" />
      <input v-model="manual.line2" class="input" :placeholder="t('intl.recipients.fields.line2')" :aria-label="t('intl.recipients.fields.line2')" />
      <input v-model="manual.city" class="input" :class="{ invalid: manualErr.city }" :placeholder="t('intl.recipients.fields.city')" :aria-label="t('intl.recipients.fields.city')" />
      <input v-model="manual.state" class="input st" maxlength="2" :class="{ invalid: manualErr.state }" :placeholder="t('intl.recipients.fields.state')" :aria-label="t('intl.recipients.fields.state')" />
      <input v-model="manual.zip" class="input zp" :class="{ invalid: manualErr.zip }" placeholder="ZIP" :aria-label="t('intl.recipients.fields.zip')" />
      <button type="submit" class="btn btn-soft"><Icon name="plus" :size="13" />{{ t('common.add') }}</button>
      <span v-if="Object.keys(manualErr).length" class="field-error full">{{ t('intl.recipients.manualInvalid', { fields: Object.keys(manualErr).map(k => t('intl.recipients.fields.' + k)).join(', ') }) }}</span>
    </form>

    <div class="list" :class="{ invalid: error && !recipients.length }">
      <div class="lh">
        <strong>{{ t('intl.recipients.count', { n: recipients.length }) }}</strong>
        <span v-if="lowScore" class="tag tag-warning">{{ t('intl.recipients.lowScore', { n: lowScore }) }}</span>
        <button v-if="recipients.length" type="button" class="btn btn-link sm" @click="clearAll">{{ t('intl.recipients.clear') }}</button>
      </div>
      <p v-if="!recipients.length" class="empty">{{ error || t('intl.recipients.empty') }}</p>
      <div v-else class="table-wrap">
        <table class="table-simple">
          <thead><tr><th>{{ t('intl.recipients.fields.name') }}</th><th>{{ t('intl.recipients.address') }}</th><th>{{ t('intl.recipients.score') }}</th><th>{{ t('intl.recipients.sourceCol') }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="(r, i) in recipients" :key="(r.orderId || r.name) + i">
              <td>{{ r.name }}</td>
              <td class="addr">{{ r.line1 }}{{ r.line2 ? ', ' + r.line2 : '' }}, {{ r.city }}, {{ r.state }} {{ r.zip }}</td>
              <td><ScoreBadge :score="r.score" size="sm" /></td>
              <td><span class="tag">{{ r.orderId || t('intl.recipients.src.' + (r.source || 'manual')) }}</span></td>
              <td><button type="button" class="btn-icon" :aria-label="t('common.delete')" @click="remove(i)"><Icon name="trash" :size="13" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-model:open="pickOpen" :title="t('intl.recipients.pickTitle')" :subtitle="t('intl.recipients.pickSub')" size="lg">
      <input v-model="orderQ" class="input" :placeholder="t('intl.recipients.searchOrders')" :aria-label="t('intl.recipients.searchOrders')" />
      <div class="olist">
        <Skeleton v-if="ordersLoading" :lines="6" />
        <EmptyState v-else-if="!visibleOrders.length" compact icon="list" :title="orders.length ? t('common.emptyFiltered') : t('intl.recipients.noOrders')" />
        <label v-for="o in visibleOrders" v-else :key="o.id" class="orow" :class="{ dis: already.has(o.id) }">
          <input type="checkbox" :checked="picked.includes(o.id) || already.has(o.id)" :disabled="already.has(o.id)" @change="togglePick(o.id)" />
          <span class="oid mono">{{ o.id }}</span>
          <span class="on">{{ o.shipTo?.name }}</span>
          <span class="oc">{{ o.shipTo?.city }}, {{ o.shipTo?.state }} {{ o.shipTo?.zip }}</span>
          <ScoreBadge :score="o.addressCheck?.score ?? null" size="sm" />
        </label>
      </div>
      <template #footer>
        <span class="muted">{{ t('common.selected', { n: picked.length }) }}</span>
        <button type="button" class="btn btn-ghost" @click="pickOpen = false">{{ t('common.cancel') }}</button>
        <button type="button" class="btn btn-primary" :disabled="!picked.length" @click="confirmPick">{{ t('intl.recipients.addPicked', { n: picked.length }) }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.re { display: flex; flex-direction: column; gap: 12px; }
.box { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.box > :deep(*) { max-width: 100%; }
.row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.muted { color: var(--ink-3); font-size: 12.5px; margin: 0; }
.errs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--danger); }
.errs li { display: flex; gap: 6px; align-items: center; }
.manual { display: grid; grid-template-columns: 1.2fr 1.4fr 0.9fr 1fr 60px 90px auto; gap: 8px; width: 100%; align-items: center; }
.manual .full { grid-column: 1 / -1; }
.list { border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--surface); }
.list.invalid { border-color: var(--danger); }
.lh { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line-1); font-size: 13px; }
.lh .sm { margin-left: auto; font-size: 12.5px; }
.empty { margin: 0; padding: 18px 12px; color: var(--ink-3); font-size: 13px; text-align: center; }
.list.invalid .empty { color: var(--danger); }
.addr { font-size: 12.5px; color: var(--ink-2); }
.olist { margin-top: 10px; max-height: 380px; overflow: auto; display: flex; flex-direction: column; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.orow { display: grid; grid-template-columns: 20px 92px 1fr 1.4fr 60px; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line-1); font-size: 13px; cursor: pointer; }
.orow:hover { background: var(--bg-2); }
.orow.dis { opacity: .55; cursor: default; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.oc { color: var(--ink-3); font-size: 12.5px; }
@media (max-width: 860px) {
  .manual { grid-template-columns: 1fr 1fr; }
  .orow { grid-template-columns: 20px 1fr 60px; }
  .orow .oc, .orow .oid { display: none; }
}
</style>
