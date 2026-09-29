<script setup>
// Weight adjustments (spec 5.10): list, declared vs measured detail with drawing, dispute + countdown.
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar from '../../components/FilterBar.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import Money from '../../components/Money.vue'
import Drawer from '../../components/Drawer.vue'
import Spinner from '../../components/Spinner.vue'
import Skeleton from '../../components/Skeleton.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import ScaleDrawing from '../../components/billing/ScaleDrawing.vue'
import Countdown from './Countdown.vue'
import { listAdjustments, getAdjustment, disputeAdjustment, DISPUTE_REASONS } from '../../api/wallet.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../../components/toast.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()
const rows = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const filters = ref({ status: [] })

async function load() {
  loading.value = true
  try { rows.value = await listAdjustments() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(load)
const sig = computed(() => db.all('adjustments').map(a => a.id + a.status).join('|'))
watch(sig, () => { load(); if (current.value) refreshCurrent() })

const STATUSES = ['charged', 'disputed', 'reviewing', 'waived']
const chips = computed(() => [{ key: 'status', label: t('common.status'), options: STATUSES.map(s => ({ value: s, label: t('status.' + s), count: rows.value.filter(r => r.status === s).length })) }])
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => (!filters.value.status?.length || filters.value.status.includes(r.status)) && (!q || [r.id, r.shipmentId, r.orderId, r.carrier].some(v => String(v ?? '').toLowerCase().includes(q))))
})
const hasFilters = computed(() => !!search.value || !!filters.value.status?.length)
function clear() { search.value = ''; filters.value = { status: [] } }

const summary = computed(() => {
  const charged = rows.value.filter(r => r.status === 'charged')
  const open = charged.filter(r => r.disputeDeadline && new Date(r.disputeDeadline) > new Date())
  return {
    total: rows.value.reduce((s, r) => s + (r.status === 'waived' ? 0 : r.delta || 0), 0),
    open: open.length,
    disputed: rows.value.filter(r => r.status === 'disputed' || r.status === 'reviewing').length,
  }
})

const columns = computed(() => [
  { key: 'id', label: 'ID', sortable: true, width: 100 },
  { key: 'shipmentId', label: t('billing.adj.shipment'), sortable: true, width: 120 },
  { key: 'carrier', label: t('billing.adj.carrier'), hideBelow: 'md' },
  { key: 'weights', label: t('billing.adj.billable'), value: r => `${r.declared?.billableLb}>${r.measured?.billableLb}` },
  { key: 'delta', label: t('billing.adj.delta'), sortable: true, align: 'right', width: 100 },
  { key: 'measuredAt', label: t('billing.adj.measuredAt'), sortable: true, hideBelow: 'lg' },
  { key: 'status', label: t('common.status'), sortable: true, width: 140 },
  { key: 'disputeDeadline', label: t('billing.adj.deadline'), sortable: true, width: 150 },
])

// ---- drawer
const open = ref(false)
const current = ref(null)
const loadingOne = ref(false)
const reason = ref('')
const note = ref('')
const formErr = ref({})
const submitting = ref(false)

async function openRow(row) {
  open.value = true
  current.value = null
  reason.value = ''
  note.value = ''
  formErr.value = {}
  loadingOne.value = true
  try { current.value = await getAdjustment(row.id) } catch (e) { toast.error(errorText(e)); open.value = false } finally { loadingOne.value = false }
  if (route.query.id !== row.id) router.replace({ query: { ...route.query, tab: 'adjustments', id: row.id } })
}
async function refreshCurrent() { try { current.value = await getAdjustment(current.value.id) } catch {} }
watch(open, v => { if (!v && route.query.id) router.replace({ query: { ...route.query, id: undefined } }) })
onMounted(() => { if (route.query.id) openRow({ id: route.query.id }) })

const windowOpen = computed(() => current.value?.status === 'charged' && current.value.disputeDeadline && new Date(current.value.disputeDeadline) > new Date())
const canDispute = computed(() => can('billing.view'))

async function submitDispute() {
  const e = {}
  if (!reason.value) e.reason = t('billing.adj.reasonRequired')
  if (reason.value === 'other' && note.value.trim().length < 10) e.note = t('billing.adj.noteMin')
  formErr.value = e
  if (Object.keys(e).length) { document.getElementById(e.reason ? 'adj-reason' : 'adj-note')?.focus(); return }
  submitting.value = true
  try {
    current.value = { ...current.value, ...(await disputeAdjustment(current.value.id, { reason: reason.value, note: note.value })) }
    toast.success(t('billing.adj.disputed', { id: current.value.id }))
    load()
  } catch (err) {
    toast.error(errorText(err))
  } finally { submitting.value = false }
}
const fmtDims = d => (d ? `${fmt.number(d.lengthIn, 0)} x ${fmt.number(d.widthIn, 0)} x ${fmt.number(d.heightIn, 0)} in` : '-')
</script>

<template>
  <div class="stack">
    <div class="grid-3 sums">
      <div class="panel panel-pad"><div class="k">{{ t('billing.adj.sumTotal') }}</div><div class="v"><Money :value="summary.total" /></div></div>
      <div class="panel panel-pad"><div class="k">{{ t('billing.adj.sumOpen') }}</div><div class="v num">{{ fmt.number(summary.open) }}</div></div>
      <div class="panel panel-pad"><div class="k">{{ t('billing.adj.sumDisputed') }}</div><div class="v num">{{ fmt.number(summary.disputed) }}</div></div>
    </div>
    <FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('billing.adj.searchPh')" @clear="clear" />
    <div v-if="error" class="callout danger">{{ error }}</div>
    <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" storage-key="billing-adj"
      :default-sort="{ key: 'measuredAt', dir: 'desc' }" :empty-title="t('billing.adj.empty')" :empty-desc="t('billing.adj.emptyDesc')" empty-icon="scale"
      @clear-filters="clear" @row-click="openRow">
      <template #cell-id="{ row }"><span class="mono">{{ row.id }}</span></template>
      <template #cell-shipmentId="{ row }"><RouterLink :to="`/shipments/${row.shipmentId}`" class="link mono">{{ row.shipmentId }}</RouterLink></template>
      <template #cell-carrier="{ row }"><CarrierLogo :code="row.carrier" :size="22" show-name /></template>
      <template #cell-weights="{ row }"><span class="num">{{ row.declared?.billableLb }} lb</span> <Icon name="arrow" :size="12" class="arr" /> <strong class="num">{{ row.measured?.billableLb }} lb</strong></template>
      <template #cell-delta="{ row }"><Money :value="row.delta" signed /></template>
      <template #cell-measuredAt="{ row }"><DateTime :value="row.measuredAt" mode="date" /> <span class="muted">· {{ row.measuredAtHub }}</span></template>
      <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
      <template #cell-disputeDeadline="{ row }"><Countdown v-if="row.status === 'charged'" :to="row.disputeDeadline" compact /><span v-else class="muted">-</span></template>
    </DataTable>

    <Drawer v-model:open="open" :title="current ? t('billing.adj.drawerTitle', { id: current.id }) : t('common.loading')" :subtitle="current ? `${current.shipmentId} · ${current.measuredAtHub}` : ''" width="600px">
      <Skeleton v-if="loadingOne || !current" :lines="8" />
      <div v-else class="stack">
        <div class="head-row">
          <StatusPill :status="current.status" />
          <span v-if="current.status === 'charged'" class="dl"><Icon name="clock" :size="13" /> {{ t('billing.adj.deadlineLeft') }} <Countdown :to="current.disputeDeadline" /></span>
        </div>
        <ScaleDrawing :measured="{ weightLb: current.measured.weightLb, ...current.measured.dims }" :declared="{ weightLb: current.declared.weightLb, ...current.declared.dims }" :hub="current.measuredAtHub" :at="fmt.dateTime(current.measuredAt)" />
        <div class="cmp">
          <table class="table-simple">
            <thead><tr><th></th><th>{{ t('billing.adj.declared') }}</th><th>{{ t('billing.adj.measured') }}</th></tr></thead>
            <tbody>
              <tr><td>{{ t('billing.adj.weight') }}</td><td class="num">{{ fmt.weight(current.declared.weightLb) }}</td><td class="num" :class="{ diff: current.measured.weightLb > current.declared.weightLb }">{{ fmt.weight(current.measured.weightLb) }}</td></tr>
              <tr><td>{{ t('billing.adj.dims') }}</td><td class="num">{{ fmtDims(current.declared.dims) }}</td><td class="num" :class="{ diff: fmtDims(current.measured.dims) !== fmtDims(current.declared.dims) }">{{ fmtDims(current.measured.dims) }}</td></tr>
              <tr><td>{{ t('billing.adj.billable') }}</td><td class="num">{{ current.declared.billableLb }} lb</td><td class="num diff"><strong>{{ current.measured.billableLb }} lb</strong></td></tr>
              <tr><td>{{ t('billing.adj.price') }}</td><td class="num">{{ fmt.money(current.originalPrice) }}</td><td class="num"><strong>{{ fmt.money(current.newPrice) }}</strong></td></tr>
            </tbody>
          </table>
          <div class="delta-card">
            <span>{{ t('billing.adj.diffLabel') }}</span>
            <strong>+{{ fmt.number(current.measured.billableLb - current.declared.billableLb, 0) }} lb, {{ fmt.money(current.delta) }}</strong>
            <small v-if="current.billedTo === 'carrier_account'">{{ t('billing.adj.billedCarrier') }}</small>
          </div>
        </div>
        <div v-if="current.waivedReason" class="callout neutral">{{ tx(current.waivedReason) }}</div>

        <!-- dispute state -->
        <div v-if="current.dispute" class="panel panel-pad dispute-state">
          <div class="panel-title">{{ t('billing.adj.disputeTitle') }}</div>
          <ol class="steps">
            <li class="done"><Icon name="check-circle" :size="14" /> {{ t('billing.adj.stepSubmitted') }} <DateTime :value="current.dispute.at" /></li>
            <li :class="{ done: current.status === 'reviewing' }"><Icon :name="current.status === 'reviewing' ? 'check-circle' : 'clock'" :size="14" /> {{ t('billing.adj.stepReviewing') }}</li>
            <li><Icon name="clock" :size="14" /> {{ t('billing.adj.stepDecision') }}</li>
          </ol>
          <dl class="kv">
            <dt>{{ t('billing.adj.reason') }}</dt><dd>{{ t('core.disputeReasons.' + current.dispute.reason) }}</dd>
            <template v-if="current.dispute.note"><dt>{{ t('billing.adj.note') }}</dt><dd>{{ current.dispute.note }}</dd></template>
          </dl>
        </div>
        <form v-else-if="windowOpen" class="panel panel-pad dispute" novalidate @submit.prevent="submitDispute">
          <div class="panel-title">{{ t('billing.adj.disputeTitle') }}</div>
          <p class="panel-sub">{{ t('billing.adj.disputeDesc') }}</p>
          <label class="fld" for="adj-reason">{{ t('billing.adj.reason') }}</label>
          <select id="adj-reason" v-model="reason" class="select" :class="{ invalid: formErr.reason }" @change="formErr = { ...formErr, reason: '' }">
            <option value="" disabled>{{ t('billing.adj.reasonPh') }}</option>
            <option v-for="r in DISPUTE_REASONS" :key="r" :value="r">{{ t('core.disputeReasons.' + r) }}</option>
          </select>
          <div v-if="formErr.reason" class="field-error">{{ formErr.reason }}</div>
          <label class="fld" for="adj-note">{{ t('billing.adj.note') }} <span v-if="reason !== 'other'" class="opt">({{ t('common.optional') }})</span></label>
          <textarea id="adj-note" v-model="note" class="input" :class="{ invalid: formErr.note }" rows="3" :placeholder="t('billing.adj.notePh')" />
          <div v-if="formErr.note" class="field-error">{{ formErr.note }}</div>
          <div class="row-end">
            <button class="btn btn-primary" type="submit" :disabled="submitting || !canDispute"><Spinner v-if="submitting" :size="14" /> {{ t('billing.adj.submitDispute') }}</button>
          </div>
        </form>
        <div v-else-if="current.status === 'charged'" class="callout neutral">{{ t('billing.adj.windowClosed') }}</div>
      </div>
      <template v-if="current" #footer>
        <RouterLink :to="`/shipments/${current.shipmentId}`" class="btn btn-ghost btn-sm">{{ t('billing.adj.openShipment') }}</RouterLink>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.sums .k { font-size: 12.5px; color: var(--ink-3); }
.sums .v { font-size: 20px; font-weight: 600; font-family: var(--font-display); margin-top: 2px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.muted { color: var(--ink-4); font-size: 12.5px; }
.arr { color: var(--ink-4); vertical-align: -1px; }
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dl { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-3); }
.cmp { display: grid; grid-template-columns: 1fr 180px; gap: 12px; align-items: stretch; }
.diff { color: oklch(0.5 0.14 60); }
.delta-card { border-radius: var(--r-md); background: oklch(0.96 0.06 80); color: oklch(0.4 0.1 70); padding: 12px; display: flex; flex-direction: column; justify-content: center; gap: 4px; font-size: 12.5px; }
.delta-card strong { font-size: 17px; font-family: var(--font-display); }
.dispute, .dispute-state { display: flex; flex-direction: column; gap: 6px; }
.fld { font-size: 12.5px; font-weight: 500; color: var(--ink-2); margin-top: 6px; }
.opt { color: var(--ink-4); font-weight: 400; }
.select, textarea { width: 100%; }
.row-end { display: flex; justify-content: flex-end; margin-top: 8px; }
.steps { list-style: none; padding: 0; margin: 6px 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink-3); }
.steps li { display: flex; align-items: center; gap: 6px; }
.steps li.done { color: var(--success); }
@media (max-width: 560px) { .cmp { grid-template-columns: 1fr; } }
</style>
