<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import FilterBar, { inRange } from '../../components/FilterBar.vue'
import DataTable from '../../components/DataTable.vue'
import Drawer from '../../components/Drawer.vue'
import Dropdown from '../../components/Dropdown.vue'
import StatusPill from '../../components/StatusPill.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import Money from '../../components/Money.vue'
import DateTime from '../../components/DateTime.vue'
import CopyButton, { copyText } from '../../components/CopyButton.vue'
import ShipmentDetail from '../../components/shipments/ShipmentDetail.vue'
import { t, fmt } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { can } from '../../store/session.js'
import { listShipments, shipmentCounts, voidLabel, listDrafts, deleteDraft } from '../../api/shipments.js'
import { downloadText, apiErrorText, serviceName, carrierName } from '../../components/shipments/helpers.js'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const shipments = ref([])
const drafts = ref([])
const draftsLoading = ref(true)
const selected = ref([])
const highlight = ref([])

async function load(quiet = false) {
  if (!quiet) loading.value = true
  try { shipments.value = await listShipments() } catch (e) { toast.error(apiErrorText(e)) } finally { loading.value = false }
}
async function loadDrafts(quiet = false) {
  if (!quiet) draftsLoading.value = true
  try { drafts.value = await listDrafts() } catch (e) { toast.error(apiErrorText(e)) } finally { draftsLoading.value = false }
}

// ---- tabs
const TAB_KEYS = ['all', 'label_created', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'voided', 'drafts']
const tab = ref(TAB_KEYS.includes(route.query.tab) ? route.query.tab : 'all')
const counts = computed(() => shipmentCounts())
const tabs = computed(() => TAB_KEYS.map(k => ({ key: k, label: t('shipments.tabs.' + k), count: counts.value[k] ?? 0 })))
watch(tab, v => {
  selected.value = []
  router.replace({ query: { ...route.query, tab: v === 'all' ? undefined : v } })
  if (v === 'drafts') loadDrafts(drafts.value.length > 0)
})
watch(() => route.query.tab, v => { if (TAB_KEYS.includes(v) && v !== tab.value) tab.value = v; if (!v && tab.value !== 'all') tab.value = 'all' })

// ---- filters
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const emptyFilters = () => ({ carrier: [], service: [], hub: [], account: null, aiPick: null, adjustment: null })
const filters = ref(emptyFilters())
const range = ref(null)
const chips = computed(() => {
  const count = key => { const m = new Map(); for (const s of shipments.value) { const v = key(s); if (v != null) m.set(v, (m.get(v) ?? 0) + 1) }; return m }
  const car = count(s => s.carrier)
  const svc = count(s => `${s.carrier}|${s.service}`)
  const hub = count(s => s.hub)
  const selCarriers = filters.value.carrier ?? []
  const svcOptions = [...svc.keys()]
    .filter(k => !selCarriers.length || selCarriers.includes(k.split('|')[0]))
    .sort()
    .map(k => { const [c, s] = k.split('|'); return { value: k, label: `${carrierName(c)} ${serviceName(c, s)}`.replace(`${carrierName(c)} ${carrierName(c)}`, carrierName(c)), count: svc.get(k) } })
  const own = shipments.value.filter(s => String(s.account).startsWith('own:')).length
  const ai = shipments.value.filter(s => s.aiPick?.chosen).length
  const adj = shipments.value.filter(s => s.reweighAdjustmentId).length
  return [
    { key: 'carrier', label: t('shipments.filters.carrier'), icon: 'truck', options: [...car.keys()].sort().map(c => ({ value: c, label: carrierName(c), count: car.get(c) })) },
    { key: 'service', label: t('shipments.filters.service'), icon: 'layers', options: svcOptions },
    { key: 'hub', label: t('shipments.filters.hub'), icon: 'warehouse', options: [...hub.keys()].sort().map(h => ({ value: h, label: h, count: hub.get(h) })) },
    { key: 'account', label: t('shipments.filters.account'), icon: 'key', multiple: false, options: [{ value: 'platform', label: t('shipments.filters.platform'), count: shipments.value.length - own }, { value: 'own', label: t('shipments.filters.own'), count: own }] },
    { key: 'aiPick', label: t('shipments.filters.aiPick'), icon: 'spark', multiple: false, options: [{ value: 'yes', label: t('common.yes'), count: ai }, { value: 'no', label: t('common.no'), count: shipments.value.length - ai }] },
    { key: 'adjustment', label: t('shipments.filters.adjustment'), icon: 'scale', multiple: false, options: [{ value: 'yes', label: t('shipments.filters.hasAdjustment'), count: adj }, { value: 'no', label: t('shipments.filters.noAdjustment'), count: shipments.value.length - adj }] },
  ]
})
const hasFilters = computed(() => !!search.value || !!range.value || ['account', 'aiPick', 'adjustment'].some(k => !!filters.value[k]) || ['carrier', 'service', 'hub'].some(k => (filters.value[k] ?? []).length))
function clearFilters() {
  search.value = ''
  range.value = null
  filters.value = emptyFilters()
  if (route.query.q) router.replace({ query: { ...route.query, q: undefined } })
}

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const f = filters.value
  return shipments.value.filter(s => {
    if (tab.value !== 'all' && tab.value !== 'drafts' && s.status !== tab.value) return false
    if (f.carrier?.length && !f.carrier.includes(s.carrier)) return false
    if (f.service?.length && !f.service.includes(`${s.carrier}|${s.service}`)) return false
    if (f.hub?.length && !f.hub.includes(s.hub)) return false
    if (f.account === 'own' && !String(s.account).startsWith('own:')) return false
    if (f.account === 'platform' && String(s.account).startsWith('own:')) return false
    if (f.aiPick === 'yes' && !s.aiPick?.chosen) return false
    if (f.aiPick === 'no' && s.aiPick?.chosen) return false
    if (f.adjustment === 'yes' && !s.reweighAdjustmentId) return false
    if (f.adjustment === 'no' && s.reweighAdjustmentId) return false
    if (range.value && !inRange(s.createdAt, range.value)) return false
    if (q && ![s.id, s.trackingNo, s.orderId, s.reference, s.to?.name, s.to?.city, s.to?.zip].some(v => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
})

// ---- table
const columns = computed(() => [
  { key: 'id', label: t('shipments.cols.id'), sortable: true, nowrap: true, hideable: false },
  { key: 'createdAt', label: t('shipments.cols.created'), sortable: true, hideBelow: 'md' },
  { key: 'recipient', label: t('shipments.cols.recipient'), sortable: true, value: r => r.to?.name },
  { key: 'carrier', label: t('shipments.cols.carrier'), sortable: true, value: r => `${carrierName(r.carrier)} ${serviceName(r.carrier, r.service)}` },
  { key: 'trackingNo', label: t('shipments.cols.tracking'), hideBelow: 'lg' },
  { key: 'hub', label: t('shipments.cols.hub'), sortable: true, hideBelow: 'lg' },
  { key: 'status', label: t('common.status'), sortable: true },
  { key: 'eta', label: t('shipments.cols.eta'), sortable: true, hideBelow: 'md', sortValue: r => r.deliveredAt ?? r.eta ?? '' },
  { key: 'total', label: t('shipments.cols.amount'), sortable: true, align: 'right', sortValue: r => r.total ?? r.walletCharge ?? 0 },
  { key: 'actions', label: '', isAction: true, align: 'right', width: 48, hideable: false },
])

// ---- drawer
const drawerId = ref(null)
const drawerOpen = computed({ get: () => !!drawerId.value, set: v => { if (!v) drawerId.value = null } })
function openRow(r) { drawerId.value = r.id }

// ---- actions
const trackUrl = s => `${location.origin}${location.pathname}#/track/${s.trackingNo}`
async function share(s) {
  if (await copyText(trackUrl(s))) toast.success(t('shipments.detail.shareCopied'))
  else toast.error(t('common.errorGeneric'))
}
async function downloadLabel(s) {
  try { const d = await import('../../docs/index.js'); d.downloadLabel(s) } catch (e) { toast.error(t('common.errorGeneric')) }
}
async function voidRow(s) {
  const usps = s.carrier === 'USPS'
  const ok = await confirm({
    title: t('shipments.void.title', { id: s.id }),
    message: t('shipments.void.message', { amount: fmt.money(s.walletCharge ?? 0) }) + (usps ? ' ' + t('shipments.void.uspsNote') : ''),
    confirmLabel: t('shipments.void.confirm'), danger: true,
  })
  if (!ok) return
  try {
    const r = await voidLabel(s.id, { reason: 'panel' })
    await load(true)
    highlight.value = [s.id]
    setTimeout(() => { highlight.value = [] }, 4000)
    if (!r.refund) toast.success(t('shipments.void.doneNoRefund'))
    else if (r.refund.status === 'pending') toast.info(t('shipments.void.donePending', { amount: fmt.money(r.refund.amount) }), { duration: 6000 })
    else toast.success(t('shipments.void.done', { amount: fmt.money(r.refund.amount) }))
  } catch (e) { toast.error(apiErrorText(e)) }
}
function rowMenu(s) {
  const items = [
    { key: 'view', label: t('shipments.list.view'), icon: 'eye', onClick: () => openRow(s) },
    { key: 'page', label: t('shipments.list.fullPage'), icon: 'external', onClick: () => router.push({ name: 'shipment-detail', params: { id: s.id } }) },
    { key: 'label', label: t('shipments.actions.labelPdf'), icon: 'download', disabled: s.status === 'voided', onClick: () => downloadLabel(s) },
    { key: 'share', label: t('shipments.actions.share'), icon: 'link', onClick: () => share(s) },
    { key: 'track', label: t('shipments.actions.openTracking'), icon: 'radar', onClick: () => router.push({ name: 'track', params: { trackingNo: s.trackingNo } }) },
  ]
  if (s.orderId) items.push({ key: 'order', label: t('shipments.list.openOrder', { id: s.orderId }), icon: 'list', onClick: () => router.push({ name: 'order-detail', params: { id: s.orderId } }) })
  if (s.status === 'label_created') items.push({ divider: true }, { key: 'void', label: t('shipments.actions.void'), icon: 'x-circle', danger: true, disabled: !can('shipments.void'), onClick: () => voidRow(s) })
  return items
}

// ---- bulk
function csvCell(v) { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
function exportCsv(list) {
  const head = ['id', 'created_at', 'order_id', 'recipient', 'city', 'state', 'zip', 'carrier', 'service', 'tracking_no', 'hub', 'status', 'eta', 'delivered_at', 'amount_usd', 'ai_pick', 'adjustment_id']
  const lines = [head.join(',')]
  for (const s of list) {
    lines.push([s.id, s.createdAt, s.orderId ?? '', s.to?.name, s.to?.city, s.to?.state, s.to?.zip, carrierName(s.carrier), serviceName(s.carrier, s.service), s.trackingNo, s.hub, s.status, s.eta ?? '', s.deliveredAt ?? '', (s.total ?? s.walletCharge ?? 0).toFixed(2), s.aiPick?.chosen ? 'yes' : 'no', s.reweighAdjustmentId ?? ''].map(csvCell).join(','))
  }
  downloadText(`shipments_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'))
  toast.success(t('shipments.list.exported', { n: list.length }))
}
function bulkExport(ids) { exportCsv(shipments.value.filter(s => ids.includes(s.id))) }
const labelsBusy = ref(false)
async function bulkLabels(ids) {
  const list = shipments.value.filter(s => ids.includes(s.id) && s.status !== 'voided')
  if (!list.length) { toast.warning(t('shipments.list.noLabels')); return }
  labelsBusy.value = true
  try {
    const d = await import('../../docs/index.js')
    d.downloadCombinedLabels(list, { title: t('shipments.list.labelsTitle', { n: list.length }) })
    toast.success(t('shipments.list.labelsDone', { n: list.length }))
  } catch (e) { toast.error(t('common.errorGeneric')) } finally { labelsBusy.value = false }
}
async function bulkShare(ids) {
  const list = shipments.value.filter(s => ids.includes(s.id))
  if (await copyText(list.map(trackUrl).join('\n'))) toast.success(t('shipments.list.linksCopied', { n: list.length }))
}

// ---- drafts
const draftCols = computed(() => [
  { key: 'id', label: t('shipments.drafts.id'), sortable: true, nowrap: true, hideable: false },
  { key: 'updatedAt', label: t('shipments.drafts.updated'), sortable: true },
  { key: 'recipient', label: t('shipments.cols.recipient'), value: r => r.summary?.toName ?? '' },
  { key: 'orderId', label: t('shipments.drafts.order'), hideBelow: 'md' },
  { key: 'step', label: t('shipments.drafts.step'), sortable: true, hideBelow: 'md' },
  { key: 'service', label: t('shipments.cols.carrier'), hideBelow: 'lg', value: r => r.summary?.carrier ?? '' },
  { key: 'total', label: t('shipments.cols.amount'), align: 'right', value: r => r.summary?.total ?? null },
  { key: 'actions', label: '', isAction: true, align: 'right', width: 150, hideable: false },
])
const draftRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return drafts.value.filter(d => !q || [d.id, d.orderId, d.summary?.toName, d.summary?.city].some(v => String(v ?? '').toLowerCase().includes(q)))
})
const STEP_NAMES = ['sender', 'recipient', 'package', 'rates', 'customs', 'payment']
function stepLabel(d) {
  const intl = (d.data?.to?.country || 'US') !== 'US'
  const keys = STEP_NAMES.filter(k => k !== 'customs' || intl)
  const k = keys[Math.min(d.step ?? 0, keys.length - 1)]
  return t('shipments.drafts.stepN', { n: (d.step ?? 0) + 1, total: keys.length, name: t('shipments.steps.' + k) })
}
function resume(d) { router.push({ name: 'shipment-new', query: { draft: d.id } }) }
async function removeDraft(d) {
  const ok = await confirm({ title: t('shipments.draft.discardTitle'), message: t('shipments.drafts.deleteMsg', { id: d.id }), confirmLabel: t('shipments.draft.discard'), danger: true })
  if (!ok) return
  try { await deleteDraft(d.id); await loadDrafts(true); toast.success(t('shipments.drafts.deleted', { id: d.id })) } catch (e) { toast.error(apiErrorText(e)) }
}

function onDetailChanged() { load(true) }

onMounted(async () => {
  const p = [load()]
  if (tab.value === 'drafts') p.push(loadDrafts())
  else loadDrafts(true).finally(() => { draftsLoading.value = false })
  await Promise.all(p)
  if (typeof route.query.open === 'string') drawerId.value = route.query.open
  if (typeof route.query.highlight === 'string') {
    highlight.value = route.query.highlight.split(',')
    setTimeout(() => { highlight.value = [] }, 6000)
  }
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.shipments')" :subtitle="t('shipments.list.subtitle')">
      <template #actions>
        <button class="btn btn-ghost" :disabled="loading || !rows.length || tab === 'drafts'" @click="exportCsv(rows)"><Icon name="download" :size="14" />{{ t('common.exportCsv') }}</button>
        <RouterLink v-if="can('shipments.create')" class="btn btn-primary" :to="{ name: 'shipment-new' }"><Icon name="plus" :size="14" />{{ t('nav.shipmentNew') }}</RouterLink>
        <button v-else class="btn btn-primary" disabled :title="t('common.noPermission')"><Icon name="lock" :size="14" />{{ t('nav.shipmentNew') }}</button>
      </template>
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.shipments')" class="tabs" />

    <template v-if="tab !== 'drafts'">
      <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('shipments.list.searchPlaceholder')" class="fb" @clear="clearFilters" />
      <DataTable :columns="columns" :rows="rows" :loading="loading" selectable v-model:selected="selected" :filtered="hasFilters"
        :highlight-keys="highlight" storage-key="shipments" :default-sort="{ key: 'createdAt', dir: 'desc' }"
        :empty-title="t('shipments.list.emptyTitle')" :empty-desc="t('shipments.list.emptyDesc')" empty-icon="truck"
        :empty-action-label="can('shipments.create') ? t('nav.shipmentNew') : ''" :aria-label="t('nav.shipments')"
        @empty-action="router.push({ name: 'shipment-new' })" @clear-filters="clearFilters" @row-click="openRow">
        <template #cell-id="{ row }">
          <div class="mono strong">{{ row.id }}</div>
          <div v-if="row.orderId" class="muted xs mono">{{ row.orderId }}</div>
          <div v-else-if="row.isReturn" class="muted xs">{{ t('shipments.detail.returnLabel') }}</div>
        </template>
        <template #cell-createdAt="{ value }"><DateTime :value="value" /></template>
        <template #cell-recipient="{ row }">
          <div class="rcp"><div class="truncate strong-n">{{ row.to?.name || '-' }}</div>
          <div class="muted xs truncate">{{ row.to?.city }}, {{ row.to?.state || row.to?.country }}</div></div>
        </template>
        <template #cell-carrier="{ row }">
          <div class="car">
            <CarrierLogo :code="row.carrier" :size="24" />
            <div class="car-t">
              <div class="truncate svc-n">{{ serviceName(row.carrier, row.service) }}</div>
              <div class="muted xs">{{ carrierName(row.carrier) }}<span v-if="String(row.account).startsWith('own:')" class="own-tag"><Icon name="key" :size="9" />{{ t('shipments.list.ownShort') }}</span><span v-if="row.aiPick?.chosen" class="ai-dot" :title="t('shipments.list.aiPicked')"><Icon name="spark" :size="8" />AI</span></div>
            </div>
          </div>
        </template>
        <template #cell-trackingNo="{ row }">
          <span class="trk"><span class="mono xs truncate">{{ row.trackingNo }}</span><CopyButton :text="row.trackingNo" size="xs" data-no-row-click /></span>
        </template>
        <template #cell-hub="{ value }"><span class="mono">{{ value }}</span></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
        <template #cell-eta="{ row }">
          <span v-if="row.deliveredAt" class="xs nw"><Icon name="check-circle" :size="11" class="ok" />{{ fmt.shortDate(row.deliveredAt) }}</span>
          <span v-else-if="row.eta && !['voided', 'returned'].includes(row.status)" class="xs nw">{{ fmt.shortDate(row.eta) }}</span>
          <span v-else class="muted">-</span>
        </template>
        <template #cell-total="{ row }">
          <span class="amt"><span v-if="row.reweighAdjustmentId" class="adj-ic" :title="t('shipments.list.adjustmentTip', { id: row.reweighAdjustmentId })" :aria-label="t('shipments.list.adjustmentTip', { id: row.reweighAdjustmentId })"><Icon name="scale" :size="12" /></span><Money :value="row.total ?? row.walletCharge ?? 0" /></span>
        </template>
        <template #cell-actions="{ row }"><Dropdown :items="rowMenu(row)" size="sm" :aria-label="t('common.actions')" /></template>
        <template #bulk="{ selected: sel }">
          <button class="btn btn-ghost btn-sm" :disabled="labelsBusy" @click="bulkLabels(sel)"><Icon name="printer" :size="13" />{{ t('shipments.list.bulkLabels', { n: sel.length }) }}</button>
          <button class="btn btn-ghost btn-sm" @click="bulkShare(sel)"><Icon name="link" :size="13" />{{ t('shipments.list.bulkLinks') }}</button>
          <button class="btn btn-ghost btn-sm" @click="bulkExport(sel)"><Icon name="download" :size="13" />{{ t('common.exportCsv') }}</button>
        </template>
      </DataTable>
    </template>

    <template v-else>
      <FilterBar v-model:search="search" :search-placeholder="t('shipments.drafts.searchPlaceholder')" class="fb" @clear="clearFilters" />
      <div class="callout neutral mb"><Icon name="info" :size="15" />{{ t('shipments.drafts.note') }}</div>
      <DataTable :columns="draftCols" :rows="draftRows" :loading="draftsLoading" :filtered="!!search" storage-key="shipment-drafts"
        :default-sort="{ key: 'updatedAt', dir: 'desc' }" :empty-title="t('shipments.drafts.emptyTitle')" :empty-desc="t('shipments.drafts.emptyDesc')"
        empty-icon="file" :empty-action-label="can('shipments.create') ? t('nav.shipmentNew') : ''" :aria-label="t('shipments.tabs.drafts')"
        @empty-action="router.push({ name: 'shipment-new' })" @clear-filters="clearFilters" @row-click="resume">
        <template #cell-id="{ value }"><span class="mono strong">{{ value }}</span></template>
        <template #cell-updatedAt="{ value }"><DateTime :value="value" /></template>
        <template #cell-recipient="{ row }">
          <div class="truncate strong-n">{{ row.summary?.toName || '-' }}</div>
          <div class="muted xs">{{ [row.summary?.city, row.summary?.state].filter(Boolean).join(', ') || '-' }}</div>
        </template>
        <template #cell-orderId="{ value }"><span class="mono xs">{{ value || '-' }}</span></template>
        <template #cell-step="{ row }"><span class="xs">{{ stepLabel(row) }}</span></template>
        <template #cell-service="{ row }">
          <span v-if="row.summary?.carrier" class="car"><CarrierLogo :code="row.summary.carrier" :size="20" /><span class="xs">{{ serviceName(row.summary.carrier, row.summary.service) }}</span></span>
          <span v-else class="muted">-</span>
        </template>
        <template #cell-total="{ row }"><Money v-if="row.summary?.total != null" :value="row.summary.total" /><span v-else class="muted">-</span></template>
        <template #cell-actions="{ row }">
          <div class="d-act">
            <button class="btn btn-soft btn-xs" @click.stop="resume(row)"><Icon name="play" :size="11" />{{ t('shipments.drafts.resume') }}</button>
            <button class="btn-icon" :aria-label="t('shipments.draft.discard')" :title="t('shipments.draft.discard')" @click.stop="removeDraft(row)"><Icon name="trash" :size="14" /></button>
          </div>
        </template>
      </DataTable>
    </template>

    <Drawer v-model:open="drawerOpen" :title="drawerId ?? ''" :subtitle="t('shipments.list.drawerSub')" width="640px">
      <template #actions>
        <RouterLink v-if="drawerId" class="btn btn-ghost btn-sm" :to="{ name: 'shipment-detail', params: { id: drawerId } }"><Icon name="external" :size="13" />{{ t('shipments.list.fullPage') }}</RouterLink>
      </template>
      <ShipmentDetail v-if="drawerId" :shipment-id="drawerId" layout="drawer" @changed="onDetailChanged" />
    </Drawer>
  </div>
</template>

<style scoped>
.tabs { margin-bottom: 12px; }
.fb { margin-bottom: 12px; }
.mb { margin-bottom: 12px; }
.strong { font-weight: 600; }
.strong-n { font-weight: 500; }
.xs { font-size: 11.5px; }
.car { display: flex; align-items: center; gap: 8px; min-width: 0; }
.car-t { min-width: 0; }
.own-tag { display: inline-flex; align-items: center; gap: 2px; margin-left: 6px; padding: 0 5px; height: 16px; border-radius: 4px; background: var(--ink-1); color: white; font-size: 10px; font-weight: 600; vertical-align: middle; }
.ai-dot { display: inline-flex; align-items: center; gap: 1px; height: 16px; padding: 0 4px; margin-left: 5px; border-radius: 4px; background: var(--accent); color: white; font-size: 9.5px; font-weight: 700; vertical-align: middle; }
.svc-n { max-width: 160px; }
.rcp { max-width: 140px; }
.nw { white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
.trk { display: inline-flex; align-items: center; gap: 2px; max-width: 128px; }
.trk .truncate { min-width: 0; display: block; }
.amt { display: inline-flex; align-items: center; gap: 6px; }
.adj-ic { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: oklch(0.95 0.06 75); color: oklch(0.45 0.12 60); }
.ok { color: var(--success); vertical-align: -1px; }
.d-act { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; }
</style>
