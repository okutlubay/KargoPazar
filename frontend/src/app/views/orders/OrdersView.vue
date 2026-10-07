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
import Modal from '../../components/Modal.vue'
import StatusPill from '../../components/StatusPill.vue'
import ScoreBadge from '../../components/ScoreBadge.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import Money from '../../components/Money.vue'
import DateTime from '../../components/DateTime.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import OrderDetail from '../../components/orders/OrderDetail.vue'
import CsvImportModal from '../../components/orders/CsvImportModal.vue'
import SyncModal from '../../components/orders/SyncModal.vue'
import { t, fmt } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { can, hasFeature } from '../../store/session.js'
import {
  listOrders, orderCounts, holdOrders, releaseOrders, restoreOrders, tagOrders, cancelOrder,
  revalidateAddresses, exportOrdersCsv,
} from '../../api/orders.js'
import { downloadText, apiErrorText } from '../../components/shipments/helpers.js'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const orders = ref([])
const selected = ref([])
const highlight = ref([])

async function load(quiet = false) {
  if (!quiet) loading.value = true
  try { orders.value = await listOrders() } catch (e) { toast.error(apiErrorText(e)) } finally { loading.value = false }
}

// ---- tabs
const TAB_KEYS = ['all', 'awaiting_shipment', 'on_hold', 'labeled', 'shipped', 'cancelled']
const tab = ref(TAB_KEYS.includes(route.query.tab) ? route.query.tab : 'all')
const counts = computed(() => {
  const c = orderCounts()
  return { all: c.all, awaiting_shipment: c.awaiting_shipment, on_hold: c.on_hold, labeled: c.labeled, shipped: (c.shipped ?? 0) + (c.delivered ?? 0), cancelled: c.cancelled }
})
const tabs = computed(() => TAB_KEYS.map(k => ({ key: k, label: t('orders.tabs.' + k), count: counts.value[k] })))

// ---- filters
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const initialScore = ['lt70', '70to84', 'gte85'].includes(route.query.addressScore) ? route.query.addressScore : null
const filters = ref({ channel: [], score: initialScore, state: [], tag: [] })
const range = ref(null)
const CHANNELS = ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce', 'manual', 'api']
const chips = computed(() => {
  const by = key => { const m = new Map(); for (const o of orders.value) { const v = key(o); if (v != null) m.set(v, (m.get(v) ?? 0) + 1) }; return m }
  const ch = by(o => o.channel)
  const st = by(o => o.shipTo?.state)
  const tg = new Map()
  for (const o of orders.value) for (const x of o.tags ?? []) tg.set(x, (tg.get(x) ?? 0) + 1)
  const band = s => (s < 70 ? 'lt70' : s < 85 ? '70to84' : 'gte85')
  const bands = by(o => band(o.addressCheck?.score ?? 100))
  return [
    { key: 'channel', label: t('orders.filters.channel'), icon: 'store', options: CHANNELS.filter(c => ch.has(c)).map(c => ({ value: c, label: t('orders.channels.' + c), count: ch.get(c) })) },
    { key: 'score', label: t('orders.filters.score'), icon: 'pin', multiple: false, options: ['lt70', '70to84', 'gte85'].map(b => ({ value: b, label: t('orders.scoreBands.' + b), count: bands.get(b) ?? 0 })) },
    { key: 'state', label: t('orders.filters.state'), icon: 'map', options: [...st.keys()].sort().map(s => ({ value: s, label: s, count: st.get(s) })) },
    { key: 'tag', label: t('orders.filters.tag'), icon: 'tag', options: [...tg.keys()].sort().map(x => ({ value: x, label: x, count: tg.get(x) })) },
  ]
})
const hasFilters = computed(() => !!search.value || !!range.value || !!filters.value.score || ['channel', 'state', 'tag'].some(k => (filters.value[k] ?? []).length))
function clearFilters() {
  search.value = ''
  range.value = null
  filters.value = { channel: [], score: null, state: [], tag: [] }
  if (route.query.addressScore || route.query.q) router.replace({ query: { ...route.query, addressScore: undefined, q: undefined } })
}

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const f = filters.value
  return orders.value.filter(o => {
    if (tab.value === 'shipped' ? !['shipped', 'delivered'].includes(o.status) : tab.value !== 'all' && o.status !== tab.value) return false
    if (f.channel?.length && !f.channel.includes(o.channel)) return false
    if (f.state?.length && !f.state.includes(o.shipTo?.state)) return false
    if (f.tag?.length && !(o.tags ?? []).some(x => f.tag.includes(x))) return false
    if (f.score) { const s = o.addressCheck?.score ?? 100; const b = s < 70 ? 'lt70' : s < 85 ? '70to84' : 'gte85'; if (b !== f.score) return false }
    if (range.value && !inRange(o.createdAt, range.value)) return false
    if (q && ![o.id, o.channelOrderNo, o.customer?.name, o.customer?.email, ...(o.items ?? []).map(i => i.sku)].some(v => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
})
watch(tab, v => { selected.value = []; router.replace({ query: { ...route.query, tab: v === 'all' ? undefined : v } }) })
watch(() => route.query.addressScore, v => { if (['lt70', '70to84', 'gte85'].includes(v)) filters.value = { ...filters.value, score: v } })

// ---- table
const columns = computed(() => [
  { key: 'id', label: t('orders.cols.order'), sortable: true, nowrap: true, hideable: false },
  { key: 'createdAt', label: t('orders.cols.date'), sortable: true, hideBelow: 'md' },
  { key: 'customer', label: t('orders.cols.customer'), sortable: true, value: r => r.customer?.name },
  { key: 'destination', label: t('orders.cols.destination'), value: r => `${r.shipTo?.city}, ${r.shipTo?.state}`, hideBelow: 'lg' },
  { key: 'items', label: t('orders.cols.items'), hideBelow: 'lg', value: r => r.items?.[0]?.title },
  { key: 'total', label: t('orders.cols.total'), sortable: true, align: 'right' },
  { key: 'score', label: t('orders.cols.score'), sortable: true, sortValue: r => r.addressCheck?.score ?? 100, value: r => r.addressCheck?.score },
  { key: 'status', label: t('common.status'), sortable: true },
  { key: 'actions', label: '', isAction: true, align: 'right', width: 48, hideable: false },
])

// ---- drawer
const drawerId = ref(null)
const drawerOpen = computed({ get: () => !!drawerId.value, set: v => { if (!v) drawerId.value = null } })
function openRow(r) { drawerId.value = r.id }

// ---- row menu
function rowMenu(o) {
  const items = [{ key: 'view', label: t('orders.actions.view'), icon: 'eye', onClick: () => openRow(o) }]
  items.push({ key: 'page', label: t('orders.actions.fullPage'), icon: 'external', onClick: () => router.push({ name: 'order-detail', params: { id: o.id } }) })
  if (['awaiting_shipment', 'on_hold'].includes(o.status) && !o.shipmentId) items.push({ key: 'ship', label: t('orders.actions.createShipment'), icon: 'printer', disabled: !can('shipments.create'), onClick: () => router.push({ name: 'shipment-new', query: { orderId: o.id } }) })
  if (o.status === 'awaiting_shipment') items.push({ key: 'hold', label: t('orders.actions.hold'), icon: 'pause', disabled: !can('orders.manage'), onClick: () => hold([o.id]) })
  if (o.status === 'on_hold') items.push({ key: 'release', label: t('orders.actions.release'), icon: 'play', disabled: !can('orders.manage'), onClick: () => release([o.id]) })
  if (!['cancelled', 'delivered', 'shipped'].includes(o.status)) items.push({ divider: true }, { key: 'cancel', label: t('orders.actions.cancel'), icon: 'x-circle', danger: true, disabled: !can('orders.manage'), onClick: () => cancel(o) })
  return items
}

// ---- bulk / single actions
async function hold(ids) {
  try {
    const r = await holdOrders(ids)
    await load(true)
    toast.info(t('orders.toast.held', { n: r.changed.length }), { action: { label: t('common.undo'), onClick: () => undo(r.changed) } })
    selected.value = []
  } catch (e) { toast.error(apiErrorText(e)) }
}
async function release(ids) {
  try {
    const r = await releaseOrders(ids)
    await load(true)
    toast.info(t('orders.toast.released', { n: r.changed.length }), { action: { label: t('common.undo'), onClick: () => undo(r.changed) } })
  } catch (e) { toast.error(apiErrorText(e)) }
}
async function undo(changed) {
  try { await restoreOrders(changed); await load(true); toast.success(t('orders.toast.undone')) } catch (e) { toast.error(apiErrorText(e)) }
}
async function cancel(o) {
  const ok = await confirm({ title: t('orders.cancel.title', { id: o.id }), message: t('orders.cancel.message'), confirmLabel: t('orders.cancel.confirm'), danger: true })
  if (!ok) return
  try { await cancelOrder(o.id, t('orders.cancel.reason')); await load(true); toast.success(t('orders.cancel.done', { id: o.id })) } catch (e) { toast.error(apiErrorText(e)) }
}
function bulkLabel(ids) {
  if (!hasFeature('batch')) { toast.warning(t('common.upgradeRequired')); router.push({ name: 'plan' }); return }
  const eligible = orders.value.filter(o => ids.includes(o.id) && ['awaiting_shipment', 'on_hold'].includes(o.status) && !o.shipmentId).map(o => o.id)
  if (!eligible.length) { toast.warning(t('orders.bulk.noneEligible')); return }
  if (eligible.length < ids.length) toast.info(t('orders.bulk.someSkipped', { n: ids.length - eligible.length }))
  router.push({ name: 'batch', query: { orders: eligible.join(',') } })
}

const validating = ref(false)
const validateProgress = ref(0)
const validateResult = ref(null)
async function bulkValidate(ids) {
  validating.value = true
  validateProgress.value = 0
  validateResult.value = null
  try {
    const r = await revalidateAddresses(ids, { onProgress: p => { validateProgress.value = p } })
    validateResult.value = r
    await load(true)
    highlight.value = r.filter(x => x.prevScore !== x.score).map(x => x.id)
  } catch (e) { toast.error(apiErrorText(e)); validating.value = false }
}
const validateSummary = computed(() => {
  const r = validateResult.value ?? []
  return { total: r.length, problems: r.filter(x => x.score < 70).length, changed: r.filter(x => x.prevScore !== x.score).length }
})

const tagOpen = ref(false)
const tagValue = ref('')
const tagError = ref('')
const tagIds = ref([])
const tagging = ref(false)
function openTag(ids) { tagIds.value = [...ids]; tagValue.value = ''; tagError.value = ''; tagOpen.value = true }
async function applyTag() {
  if (!tagValue.value.trim()) { tagError.value = t('common.validation.required'); return }
  tagging.value = true
  try {
    const r = await tagOrders(tagIds.value, tagValue.value)
    tagOpen.value = false
    await load(true)
    toast.success(t('orders.toast.tagged', { tag: r.tag, n: r.changed.length }), { action: r.changed.length ? { label: t('common.undo'), onClick: () => undo(r.changed) } : undefined })
  } catch (e) { tagError.value = apiErrorText(e) } finally { tagging.value = false }
}
const existingTags = computed(() => [...new Set(orders.value.flatMap(o => o.tags ?? []))].sort())

function bulkExport(ids) {
  const csv = exportOrdersCsv(ids)
  downloadText(`orders_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  toast.success(t('orders.toast.exported', { n: ids.length }))
}

// ---- sync + import
const syncOpen = ref(false)
const importOpen = ref(false)
async function onSynced(ids) {
  await load(true)
  if (ids.length) {
    tab.value = 'all'
    highlight.value = ids
    setTimeout(() => { highlight.value = [] }, 6000)
  }
}
async function onImported(list) {
  await load(true)
  tab.value = 'all'
  highlight.value = list.map(o => o.id)
  setTimeout(() => { highlight.value = [] }, 6000)
  toast.success(t('orders.csv.toast', { n: list.length }))
}

function onDetailChanged() { load(true) }

onMounted(async () => {
  await load()
  if (typeof route.query.highlight === 'string') {
    highlight.value = route.query.highlight.split(',')
    setTimeout(() => { highlight.value = [] }, 6000)
  }
  if (typeof route.query.open === 'string') drawerId.value = route.query.open
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.orders')" :subtitle="t('orders.subtitle')">
      <template #actions>
        <button data-testid="orders-sync" class="btn btn-ghost" :disabled="!can('orders.manage')" :title="!can('orders.manage') ? t('common.noPermission') : ''" @click="syncOpen = true"><Icon name="sync" :size="14" />{{ t('orders.actions.sync') }}</button>
        <button class="btn btn-ghost" :disabled="!can('orders.manage')" :title="!can('orders.manage') ? t('common.noPermission') : ''" @click="importOpen = true"><Icon name="upload" :size="14" />{{ t('common.importCsv') }}</button>
        <RouterLink v-if="can('orders.manage')" class="btn btn-primary" :to="{ name: 'order-new' }"><Icon name="plus" :size="14" />{{ t('orders.actions.new') }}</RouterLink>
        <button v-else class="btn btn-primary" disabled :title="t('common.noPermission')"><Icon name="lock" :size="14" />{{ t('orders.actions.new') }}</button>
      </template>
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.orders')" class="tabs" />
    <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('orders.searchPlaceholder')" @clear="clearFilters" class="fb" />

    <DataTable :columns="columns" :rows="rows" :loading="loading" selectable v-model:selected="selected" :filtered="hasFilters"
      :highlight-keys="highlight" storage-key="orders" :default-sort="{ key: 'createdAt', dir: 'desc' }"
      :empty-title="t('orders.empty.title')" :empty-desc="t('orders.empty.desc')" empty-icon="list" :empty-action-label="can('orders.manage') ? t('orders.actions.new') : ''"
      :aria-label="t('nav.orders')" @empty-action="router.push({ name: 'order-new' })" @clear-filters="clearFilters" @row-click="openRow">
      <template #cell-id="{ row }">
        <div class="oid">
          <ChannelLogo :code="row.channel" :size="24" />
          <div>
            <div class="mono strong">{{ row.id }}</div>
            <div class="muted xs mono truncate ch-no">{{ row.channelOrderNo }}</div>
          </div>
        </div>
      </template>
      <template #cell-createdAt="{ value }"><DateTime :value="value" /></template>
      <template #cell-customer="{ row }"><div class="cust"><div class="truncate strong-n">{{ row.customer?.name }}</div><div class="muted xs truncate">{{ row.customer?.email || '-' }}</div></div></template>
      <template #cell-destination="{ row }"><span class="truncate dest" :title="`${row.shipTo?.city}, ${row.shipTo?.state}`">{{ row.shipTo?.city }}, {{ row.shipTo?.state }}</span></template>
      <template #cell-items="{ row }">
        <span class="truncate items-cell">{{ row.items?.[0]?.title ?? '-' }}</span>
        <span v-if="(row.items?.length ?? 0) > 1" class="tag more">+{{ row.items.length - 1 }}</span>
      </template>
      <template #cell-total="{ row }"><Money :value="row.total" /></template>
      <template #cell-score="{ row }"><ScoreBadge :score="row.addressCheck?.score ?? null" size="sm" /></template>
      <template #cell-status="{ row }">
        <StatusPill :status="row.status" size="sm" />
        <span v-if="row.storeDisconnected" class="tag xs-tag" :title="t('orders.detail.storeDisconnected')">{{ t('orders.disconnected') }}</span>
      </template>
      <template #cell-actions="{ row }"><Dropdown :items="rowMenu(row)" size="sm" :aria-label="t('common.actions')" /></template>
      <template #bulk="{ selected: sel }">
        <button class="btn btn-ghost btn-sm" :disabled="!can('shipments.create')" @click="bulkLabel(sel)"><Icon name="printer" :size="13" />{{ t('orders.bulk.label', { n: sel.length }) }}</button>
        <button class="btn btn-ghost btn-sm" :disabled="!can('orders.manage')" @click="bulkValidate(sel)"><Icon name="pin" :size="13" />{{ t('orders.bulk.validate') }}</button>
        <button class="btn btn-ghost btn-sm" :disabled="!can('orders.manage')" @click="hold(sel)"><Icon name="pause" :size="13" />{{ t('orders.bulk.hold') }}</button>
        <button class="btn btn-ghost btn-sm" :disabled="!can('orders.manage')" @click="openTag(sel)"><Icon name="tag" :size="13" />{{ t('orders.bulk.tag') }}</button>
        <button class="btn btn-ghost btn-sm" @click="bulkExport(sel)"><Icon name="download" :size="13" />{{ t('common.exportCsv') }}</button>
      </template>
    </DataTable>

    <Drawer v-model:open="drawerOpen" :title="drawerId ?? ''" :subtitle="t('orders.detail.drawerSub')" width="620px">
      <template #actions>
        <RouterLink v-if="drawerId" class="btn btn-ghost btn-sm" :to="{ name: 'order-detail', params: { id: drawerId } }"><Icon name="external" :size="13" />{{ t('orders.actions.fullPage') }}</RouterLink>
      </template>
      <OrderDetail v-if="drawerId" :order-id="drawerId" layout="drawer" @changed="onDetailChanged" />
    </Drawer>

    <SyncModal v-model:open="syncOpen" @synced="onSynced" />
    <CsvImportModal v-model:open="importOpen" @imported="onImported" />

    <Modal v-model:open="tagOpen" :title="t('orders.tagModal.title', { n: tagIds.length })" size="sm">
      <label class="field-label" for="tag-in">{{ t('orders.tagModal.label') }}</label>
      <input id="tag-in" v-model="tagValue" class="input" :class="{ invalid: tagError }" list="tag-list" :placeholder="t('orders.tagModal.placeholder')" @keyup.enter="applyTag" @input="tagError = ''" />
      <datalist id="tag-list"><option v-for="x in existingTags" :key="x" :value="x" /></datalist>
      <div v-if="tagError" class="field-error" role="alert">{{ tagError }}</div>
      <div v-if="existingTags.length" class="tag-sugg">
        <button v-for="x in existingTags.slice(0, 10)" :key="x" type="button" class="tag" @click="tagValue = x">{{ x }}</button>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="tagOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="tagging" @click="applyTag"><span v-if="tagging" class="spin" />{{ t('orders.tagModal.apply') }}</button>
      </template>
    </Modal>

    <Modal v-model:open="validating" :title="t('orders.validate.title')" size="sm" :closable="!!validateResult">
      <template v-if="!validateResult">
        <p>{{ t('orders.validate.running') }}</p>
        <ProgressBar :value="validateProgress" show-value />
      </template>
      <template v-else>
        <div class="val-grid">
          <div><div class="muted small">{{ t('orders.validate.checked') }}</div><div class="big mono">{{ validateSummary.total }}</div></div>
          <div><div class="muted small">{{ t('orders.validate.problems') }}</div><div class="big mono text-danger">{{ validateSummary.problems }}</div></div>
          <div><div class="muted small">{{ t('orders.validate.changed') }}</div><div class="big mono">{{ validateSummary.changed }}</div></div>
        </div>
      </template>
      <template #footer>
        <button v-if="validateResult && validateSummary.problems" class="btn btn-ghost" @click="validating = false; filters = { ...filters, score: 'lt70' }">{{ t('orders.validate.showProblems') }}</button>
        <button class="btn btn-primary" :disabled="!validateResult" @click="validating = false; selected = []">{{ t('common.close') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.tabs { margin-bottom: 12px; }
.fb { margin-bottom: 12px; }
.oid { display: flex; align-items: center; gap: 10px; }
.strong { font-weight: 600; }
.strong-n { font-weight: 500; }
.xs { font-size: 11.5px; }
.small { font-size: 12.5px; }
.items-cell { display: inline-block; max-width: 125px; vertical-align: middle; }
.ch-no { max-width: 100px; }
.cust { max-width: 140px; }
.dest { display: inline-block; max-width: 110px; vertical-align: middle; }
.more { margin-left: 6px; height: 20px; font-size: 11px; }
.xs-tag { margin-left: 6px; height: 20px; font-size: 11px; }
.tag-sugg { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.tag-sugg .tag { border: 0; cursor: pointer; }
.tag-sugg .tag:hover { background: var(--accent-soft); color: var(--accent-ink); }
.val-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center; }
.big { font-size: 24px; font-weight: 600; margin-top: 2px; }
.spin { width: 13px; height: 13px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
</style>
