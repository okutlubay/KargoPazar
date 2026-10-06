<script setup>
// Dynamic pricing (spec 6.3): dependency strip (demand forecast), lane recommendations with
// statuses and bulk approve / reject / edit, detail drawer (waterfall, price x profit sensitivity,
// price history, approval history), recompute and settings (margins, market cap, auto approve).
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar from '../../components/FilterBar.vue'
import StatusPill from '../../components/StatusPill.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import Drawer from '../../components/Drawer.vue'
import Modal from '../../components/Modal.vue'
import Toggle from '../../components/Toggle.vue'
import Spinner from '../../components/Spinner.vue'
import Skeleton from '../../components/Skeleton.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import Dropdown from '../../components/Dropdown.vue'
import FormField from '../../components/FormField.vue'
import Waterfall from '../../components/charts/Waterfall.vue'
import LineChart from '../../components/charts/LineChart.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listRecommendations, getRecommendation, recompute as apiRecompute, approve, reject, revoke, editPrice, checkPrice, getSettings, saveSettings } from '../../api/pricing.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const canManage = computed(() => can('ai.manage'))
const noPerm = computed(() => (canManage.value ? '' : t('aiPricing.noPermission')))

const STATUS_TONE = { proposed: 'warning', approved: 'success', rejected: 'danger', expired: 'neutral', none: 'neutral' }
const statusLabel = s => t(`aiModel.pricing.status.${s || 'none'}`)
const groupLabel = g => t(`aiModel.pricing.zoneGroup.${g}`)
const pct = (v, d = 1) => (v > 0 ? '+' : '') + fmt.percent(v, d)
function errText(e) {
  if (e?.code) {
    const k = `aiModel.errors.${e.code}`
    const s = t(k)
    if (s !== k) return s
  }
  return t('common.errorGeneric')
}

// ------------------------------------------------------------------ data
const loading = ref(true)
const showAll = ref(false)
const data = ref(null)
async function load() {
  try {
    data.value = await listRecommendations({ all: showAll.value })
  } catch (e) {
    toast.error(errText(e))
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(showAll, () => { loading.value = true; selected.value = []; load() })

const lanes = computed(() => data.value?.lanes || [])
const meta = computed(() => data.value?.meta || null)
const settings = computed(() => data.value?.settings || null)
const laneName = l => `${l.hub} · ${l.serviceName || l.service} · ${groupLabel(l.zoneGroup)}`

const kpi = computed(() => {
  const ls = lanes.value
  const live = ls.filter(l => l.status === 'proposed' || l.status === 'approved')
  const impact = live.reduce((s, l) => s + (l.impact || 0), 0)
  const avg = ls.length ? ls.reduce((s, l) => s + Math.abs(l.changePct || 0), 0) / ls.length : 0
  return {
    pending: ls.filter(l => l.status === 'proposed').length,
    approved: ls.filter(l => l.status === 'approved').length,
    impact,
    avg,
  }
})

// ------------------------------------------------------------------ filters
const search = ref('')
const filters = ref({ status: [], hub: [], group: [] })
const chips = computed(() => {
  const count = (fn, v) => lanes.value.filter(l => fn(l) === v).length
  return [
    { key: 'status', label: t('aiPricing.table.status'), options: ['proposed', 'approved', 'rejected', 'expired', 'none'].map(s => ({ value: s, label: statusLabel(s), count: count(l => l.status, s) })).filter(o => o.count) },
    { key: 'hub', label: t('aiPricing.table.hub'), options: ['NJ01', 'LA01'].map(h => ({ value: h, label: h, count: count(l => l.hub, h) })) },
    { key: 'group', label: t('aiPricing.table.group'), options: ['near', 'mid', 'far'].map(g => ({ value: g, label: groupLabel(g), count: count(l => l.zoneGroup, g) })) },
  ]
})
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const f = filters.value
  return lanes.value.filter(l =>
    (!f.status?.length || f.status.includes(l.status)) &&
    (!f.hub?.length || f.hub.includes(l.hub)) &&
    (!f.group?.length || f.group.includes(l.zoneGroup)) &&
    (!q || [l.lane, l.carrierName, l.serviceName, l.hub, groupLabel(l.zoneGroup)].some(v => String(v || '').toLowerCase().includes(q))))
})
const hasFilters = computed(() => !!search.value.trim() || Object.values(filters.value).some(v => v?.length))
function clearFilters() { search.value = ''; filters.value = { status: [], hub: [], group: [] } }

const selected = ref([])
const cols = computed(() => [
  { key: 'lane', label: t('aiPricing.table.cols.lane'), sortable: true, sortValue: l => l.lane },
  { key: 'forecastVolume', nowrap: true, label: t('aiPricing.table.cols.volume'), sortable: true, align: 'right', width: 100 },
  { key: 'currentPrice', nowrap: true, label: t('aiPricing.table.cols.current'), sortable: true, align: 'right', width: 90 },
  { key: 'finalPrice', nowrap: true, label: t('aiPricing.table.cols.recommended'), sortable: true, align: 'right', width: 110 },
  { key: 'range', nowrap: true, label: t('aiPricing.table.cols.range'), align: 'right', width: 150, hideBelow: 'lg' },
  { key: 'changePct', nowrap: true, label: t('aiPricing.table.cols.change'), sortable: true, align: 'right', width: 90 },
  { key: 'impact', nowrap: true, label: t('aiPricing.table.cols.impact'), sortable: true, align: 'right', width: 110, hideBelow: 'md' },
  { key: 'status', label: t('aiPricing.table.cols.status'), sortable: true, width: 130 },
  { key: 'actions', label: '', isAction: true, width: 96, align: 'right', hideable: false },
])
function rowMenu(l) {
  return [
    { key: 'details', label: t('aiPricing.actions.details'), icon: 'eye', onClick: () => openDrawer(l) },
    { key: 'edit', label: t('aiPricing.actions.edit'), icon: 'edit', disabled: !canManage.value, hint: noPerm.value, onClick: () => openEdit([l]) },
    l.status === 'approved'
      ? { key: 'revoke', label: t('aiPricing.actions.revoke'), icon: 'return', disabled: !canManage.value, onClick: () => doRevoke(l) }
      : { key: 'approve', label: t('aiPricing.actions.approve'), icon: 'check', disabled: !canManage.value, onClick: () => doApprove([l]) },
    { divider: true, key: 'd' },
    { key: 'reject', label: t('aiPricing.actions.reject'), icon: 'x-circle', danger: true, disabled: !canManage.value || l.status === 'rejected', onClick: () => openReject([l]) },
  ]
}

// ------------------------------------------------------------------ actions
const busy = ref(new Set())
const isBusy = l => busy.value.has(l.lane)
function setBusy(list, on) {
  const s = new Set(busy.value)
  for (const l of list) on ? s.add(l.lane) : s.delete(l.lane)
  busy.value = s
}
async function refreshDrawer() {
  if (drawer.open && drawer.lane) {
    try { drawer.lane = await getRecommendation(drawer.lane.lane) } catch { /* lane list reload covers it */ }
  }
}

async function doApprove(list) {
  const todo = list.filter(l => l.status !== 'approved')
  if (!todo.length) { toast.info(t('aiPricing.toast.nothingToApprove')); return }
  setBusy(todo, true)
  try {
    const res = await approve(todo.map(l => l.lane))
    selected.value = []
    await load()
    await refreshDrawer()
    toast.success(t('aiPricing.toast.approvedHint'), {
      title: t('aiPricing.toast.approved', { n: res.approved }),
      action: { label: t('common.undo'), onClick: () => undoApprove(todo) },
      duration: 6000,
    })
  } catch (e) {
    toast.error(errText(e))
  } finally { setBusy(todo, false) }
}
async function undoApprove(list) {
  try {
    for (const l of list) await revoke(l.lane)
    await load()
    await refreshDrawer()
    toast.info(t('aiPricing.toast.undone'))
  } catch (e) { toast.error(errText(e)) }
}
async function doRevoke(l) {
  setBusy([l], true)
  try {
    await revoke(l.lane)
    await load()
    await refreshDrawer()
    toast.info(t('aiPricing.toast.undone'))
  } catch (e) { toast.error(errText(e)) } finally { setBusy([l], false) }
}

// reject modal
const rej = reactive({ open: false, lanes: [], reason: '', error: '', saving: false })
const QUICK = ['competitor', 'contract', 'volume', 'margin']
function openReject(list) {
  Object.assign(rej, { open: true, lanes: list, reason: '', error: '', saving: false })
}
async function submitReject() {
  const r = rej.reason.trim()
  if (r.length < 3) { rej.error = t('aiModel.errors.REASON_REQUIRED'); return }
  rej.error = ''
  rej.saving = true
  try {
    for (const l of rej.lanes) await reject(l.lane, r)
    toast.success(t('aiPricing.toast.rejected', { n: rej.lanes.length }))
    rej.open = false
    selected.value = []
    await load()
    await refreshDrawer()
  } catch (e) {
    if (e?.code === 'REASON_REQUIRED') rej.error = errText(e)
    else toast.error(errText(e))
  } finally { rej.saving = false }
}

// edit modal
const ed = reactive({ open: false, lanes: [], price: '', pct: 0, error: '', saving: false })
const edSingle = computed(() => ed.lanes.length === 1 ? ed.lanes[0] : null)
function openEdit(list) {
  Object.assign(ed, { open: true, lanes: list, price: list.length === 1 ? String(list[0].finalPrice.toFixed(2)) : '', pct: 0, error: '', saving: false })
}
const liveWarnings = computed(() => {
  if (!edSingle.value) return []
  const p = Number(String(ed.price).replace(',', '.'))
  return checkPrice(edSingle.value.lane, p)
})
const bulkPreview = computed(() => ed.lanes.length > 1 ? ed.lanes.map(l => {
  const price = Math.round(l.recommendedPrice * (1 + ed.pct / 100) * 100) / 100
  return { l, price, warnings: checkPrice(l.lane, price) }
}) : [])
async function submitEdit() {
  ed.error = ''
  const entries = edSingle.value
    ? [{ l: edSingle.value, price: Number(String(ed.price).replace(',', '.')) }]
    : bulkPreview.value.map(x => ({ l: x.l, price: x.price }))
  if (entries.some(x => !Number.isFinite(x.price) || x.price <= 0)) { ed.error = t('aiModel.errors.INVALID_PRICE'); return }
  ed.saving = true
  try {
    const warns = []
    for (const x of entries) {
      const r = await editPrice(x.l.lane, x.price)
      warns.push(...r.warnings)
    }
    ed.open = false
    selected.value = []
    await load()
    await refreshDrawer()
    if (warns.length) toast.warning(t('aiPricing.toast.editedWarn', { w: t(`aiModel.pricing.warnings.${warns[0].code}`, warns[0].params) }))
    else toast.success(t('aiPricing.toast.edited'))
  } catch (e) {
    if (e?.code === 'INVALID_PRICE') ed.error = errText(e)
    else toast.error(errText(e))
  } finally { ed.saving = false }
}

// bulk helpers
const selLanes = computed(() => lanes.value.filter(l => selected.value.includes(l.lane)))

// ------------------------------------------------------------------ recompute
const rc = reactive({ running: false, pct: 0, label: '' })
async function runRecompute() {
  if (rc.running) return
  rc.running = true
  rc.pct = 0
  try {
    const res = await apiRecompute((p, s) => { rc.pct = p; rc.label = tx(s.label) })
    await load()
    await refreshDrawer()
    toast.success(res.autoApproved ? t('aiPricing.recomputedAuto', { n: res.changed, a: res.autoApproved }) : t('aiPricing.recomputed', { n: res.changed }))
  } catch (e) {
    toast.error(errText(e))
  } finally { rc.running = false }
}

// ------------------------------------------------------------------ settings
const st = reactive({ open: false, saving: false, loading: false, minMargin: 12, maxMargin: 28, marketCap: 1.05, autoApprove: false, autoBelow: 3, validityDays: 7, errors: {} })
async function openSettings() {
  st.open = true
  st.loading = true
  st.errors = {}
  try {
    const s = await getSettings()
    Object.assign(st, { minMargin: Math.round(s.minMargin * 1000) / 10, maxMargin: Math.round(s.maxMargin * 1000) / 10, marketCap: s.marketCapMultiplier, autoApprove: s.autoApprove, autoBelow: Math.round(s.autoApproveBelowPct * 1000) / 10, validityDays: s.validityDays })
  } catch (e) { toast.error(errText(e)) } finally { st.loading = false }
}
function validateSettings() {
  const e = {}
  const n = v => Number(String(v).replace(',', '.'))
  if (!(n(st.minMargin) >= 0 && n(st.minMargin) <= 50)) e.minMargin = true
  if (!(n(st.maxMargin) > n(st.minMargin) && n(st.maxMargin) <= 100)) e.maxMargin = true
  if (!(n(st.marketCap) >= 1 && n(st.marketCap) <= 1.5)) e.marketCapMultiplier = true
  if (!(n(st.autoBelow) >= 0 && n(st.autoBelow) <= 20)) e.autoApproveBelowPct = true
  st.errors = e
  return !Object.keys(e).length
}
async function submitSettings() {
  if (!validateSettings()) return
  const n = v => Number(String(v).replace(',', '.'))
  st.saving = true
  try {
    const res = await saveSettings({ minMargin: n(st.minMargin) / 100, maxMargin: n(st.maxMargin) / 100, marketCapMultiplier: n(st.marketCap), autoApprove: st.autoApprove, autoApproveBelowPct: n(st.autoBelow) / 100 })
    st.open = false
    await load()
    const r = res.recompute
    toast.success(r.autoApproved ? t('aiPricing.toast.savedAuto', { n: r.changed, a: r.autoApproved }) : t('aiPricing.toast.saved', { n: r.changed }))
  } catch (e) {
    if (e?.code === 'INVALID_SETTINGS' && e.details?.field) st.errors = { [e.details.field]: true }
    else toast.error(errText(e))
  } finally { st.saving = false }
}

// ------------------------------------------------------------------ drawer
const drawer = reactive({ open: false, lane: null, loading: false })
async function openDrawer(l) {
  drawer.open = true
  drawer.lane = l
  drawer.loading = true
  try { drawer.lane = await getRecommendation(l.lane) } catch (e) { toast.error(errText(e)) } finally { drawer.loading = false }
}
const dl = computed(() => drawer.lane)
const waterfallSteps = computed(() => {
  const l = dl.value
  if (!l?.waterfall) return []
  return l.waterfall
    .filter(s => s.key === 'current' || s.key === 'recommended' || (s.delta != null && Math.abs(s.delta) >= 0.005))
    .map(s => s.key === 'current'
      ? { label: t('aiModel.pricing.waterfall.current'), value: s.value ?? s.end, type: 'start' }
      : s.key === 'recommended'
        ? { label: t('aiModel.pricing.waterfall.recommended'), value: s.value ?? s.end, type: 'end' }
        : { label: t(`aiModel.pricing.waterfall.${s.key}`), value: s.delta, type: 'delta', note: t(`aiPricing.drawer.notes.${s.key}`) })
})
const sensSeries = computed(() => dl.value?.sensitivity ? [{ key: 'profit', label: t('aiPricing.drawer.profit'), points: dl.value.sensitivity.map(p => ({ x: p.price, y: p.profit })), area: true }] : [])
const sensMarkers = computed(() => {
  const l = dl.value
  if (!l) return []
  const out = [
    { key: 'cur', x: l.currentPrice, label: t('aiPricing.drawer.current'), color: 'var(--ink-3)' },
    { key: 'rec', x: l.recommendedPrice, label: t('aiPricing.drawer.recommended'), color: 'var(--accent)' },
  ]
  if (l.optimalPrice && Math.abs(l.optimalPrice - l.recommendedPrice) > 0.05) out.push({ key: 'opt', x: l.optimalPrice, label: t('aiPricing.drawer.optimalShort'), color: 'var(--success)' })
  return out
})
const histSeries = computed(() => {
  const l = dl.value
  if (!l?.priceHistory?.length) return []
  const pts = l.priceHistory.map(p => ({ x: p.weekStart, y: p.price }))
  const s = [{ key: 'hist', label: t('aiPricing.drawer.history'), points: pts }]
  const first = pts[0].x
  const last = pts[pts.length - 1].x
  s.push({ key: 'rec', label: t('aiPricing.drawer.recommended'), dashed: true, color: 'var(--accent)', points: [{ x: first, y: l.finalPrice }, { x: last, y: l.finalPrice }] })
  return s
})
function tryIt() {
  drawer.open = false
  router.push({ name: 'shipment-new' })
}
function reasonText(r) { return r == null ? '' : typeof r === 'string' ? r : tx(r) }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.aiPricing')" :subtitle="t('aiPricing.subtitle')" badge="AI">
      <template #actions>
        <button class="btn btn-ghost btn-sm" @click="openSettings"><Icon name="settings" :size="14" />{{ t('aiPricing.settings') }}</button>
        <button class="btn btn-accent btn-sm" :disabled="rc.running || !canManage" :title="noPerm" @click="runRecompute">
          <Spinner v-if="rc.running" :size="14" /><Icon v-else name="refresh" :size="14" />{{ rc.running ? t('aiPricing.recomputing') : t('aiPricing.recompute') }}
        </button>
      </template>
    </PageHeader>

    <!-- dependency strip -->
    <div class="panel dep">
      <div class="dep-row">
        <span class="dep-l"><Icon name="link" :size="14" />{{ t('aiPricing.dep.input') }}</span>
        <template v-if="meta">
          <router-link :to="{ name: 'ai-forecast' }" class="dep-chip">
            <Icon name="chart" :size="13" />{{ t('aiPricing.dep.forecast', { v: meta.forecastVersion }) }}
            <span class="dep-sub">({{ t('aiPricing.dep.trained', { d: fmt.relative(meta.forecastTrainedAt) }) }})</span>
          </router-link>
          <Icon name="arrow" :size="14" class="dep-arr" />
          <span class="dep-chip on"><Icon name="dollar" :size="13" />{{ t('aiModel.pricing.name') }} <span class="mono">{{ meta.modelVersion }}</span></span>
          <span class="dep-gen">{{ t('aiPricing.dep.generated', { d: fmt.relative(meta.generatedAt), m: fmt.dateTime(meta.generatedAt) }) }}</span>
        </template>
        <Skeleton v-else variant="lines" :lines="1" width="60%" />
      </div>
      <div v-if="meta?.stale" class="callout warn stale">
        <Icon name="alert" :size="14" />
        <span>{{ t('aiPricing.dep.stale', { cur: meta.currentForecastVersion, old: meta.forecastVersion }) }}</span>
        <button class="btn btn-sm btn-accent" :disabled="rc.running || !canManage" @click="runRecompute">{{ t('aiPricing.recompute') }}</button>
      </div>
      <div v-if="rc.running" class="rc-prog">
        <div class="rc-h"><span><Spinner :size="12" /> {{ rc.label || t('aiPricing.progress') }}</span><span class="num">{{ Math.round(rc.pct) }}%</span></div>
        <ProgressBar :value="rc.pct" size="sm" />
      </div>
    </div>

    <div class="grid-kpi blk">
      <KpiCard :label="t('aiPricing.kpi.pending')" :value="loading ? '' : fmt.number(kpi.pending)" icon="clock" :loading="loading" tone="warning" />
      <KpiCard :label="t('aiPricing.kpi.approved')" :value="loading ? '' : fmt.number(kpi.approved)" icon="check-circle" :loading="loading" tone="success" />
      <KpiCard :label="t('aiPricing.kpi.impact')" :value="loading ? '' : (kpi.impact >= 0 ? '+' : '') + fmt.money(kpi.impact)" :hint="t('aiPricing.kpi.impactHint')" icon="dollar" :loading="loading" tone="accent" />
      <KpiCard :label="t('aiPricing.kpi.avgChange')" :value="loading ? '' : '±' + fmt.percent(kpi.avg, 1)" :hint="settings ? t('aiPricing.kpi.auto') + ': ' + (settings.autoApprove ? t('aiPricing.kpi.autoOn', { p: fmt.percent(settings.autoApproveBelowPct, 0) }) : t('aiPricing.kpi.autoOff')) : ''" icon="scale" :loading="loading" />
    </div>

    <Card :title="t('aiPricing.table.title')" :subtitle="showAll ? t('aiPricing.table.subtitleAll', { n: data?.totalLanes ?? 0 }) : t('aiPricing.table.subtitle', { n: 20 })" icon="list" class="blk">
      <template #actions>
        <Toggle v-model="showAll" size="sm" :label="t('aiPricing.showAll', { n: data?.totalLanes ?? 42 })" />
      </template>
      <FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('aiPricing.table.search')" class="fb" @clear="clearFilters" />
      <DataTable :columns="cols" :rows="filtered" :loading="loading" row-key="lane" selectable v-model:selected="selected"
        :filtered="hasFilters" :empty-title="t('aiPricing.table.empty')" :empty-desc="t('aiPricing.table.emptyDesc')" empty-icon="dollar"
        storage-key="ai-pricing" :default-sort="null" :page-sizes="[25, 50]" @clear-filters="clearFilters" @row-click="openDrawer">
        <template #cell-lane="{ row }">
          <div class="lane">
            <CarrierLogo :code="row.carrier" :size="26" />
            <div class="lane-t">
              <div class="lane-n">{{ row.serviceName || row.carrierName }}</div>
              <div class="lane-s"><span class="hubtag">{{ row.hub }}</span> {{ groupLabel(row.zoneGroup) }}</div>
            </div>
          </div>
        </template>
        <template #cell-forecastVolume="{ row }"><span class="num">{{ fmt.number(row.forecastVolume, 0) }}</span></template>
        <template #cell-currentPrice="{ row }"><span class="num">{{ fmt.money(row.currentPrice) }}</span></template>
        <template #cell-finalPrice="{ row }">
          <span class="num rec">{{ fmt.money(row.finalPrice) }}</span>
          <span v-if="row.editedPrice != null" class="tag tag-accent ed">{{ t('aiPricing.table.edited') }}</span>
        </template>
        <template #cell-range="{ row }"><span class="num muted">{{ fmt.money(row.range[0]) }} - {{ fmt.money(row.range[1]) }}</span></template>
        <template #cell-changePct="{ row }"><span :class="['num', row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : '']">{{ pct(row.changePct) }}</span></template>
        <template #cell-impact="{ row }"><span :class="['num', row.impact >= 0 ? 'up' : 'down']">{{ (row.impact >= 0 ? '+' : '') + fmt.money(row.impact) }}</span></template>
        <template #cell-status="{ row }">
          <div class="st">
            <StatusPill :status="row.status || 'none'" :tone="STATUS_TONE[row.status || 'none']" :label="statusLabel(row.status)" size="sm" />
            <span v-if="row.status === 'approved' && row.validUntil" class="until">{{ t('aiPricing.table.until', { d: fmt.date(row.validUntil) }) }}</span>
            <span v-if="row.auto" class="until">{{ t('aiModel.pricing.autoApprovedBy') }}</span>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="acts" data-no-row-click>
            <Spinner v-if="isBusy(row)" :size="14" />
            <button v-else-if="row.status !== 'approved'" class="btn btn-soft btn-xs" :disabled="!canManage" :title="noPerm || t('aiPricing.actions.approve')" :aria-label="t('aiPricing.actions.approve')" @click.stop="doApprove([row])"><Icon name="check" :size="12" /></button>
            <Dropdown :items="rowMenu(row)" size="sm" :aria-label="t('common.actions')" />
          </div>
        </template>
        <template #bulk>
          <button class="btn btn-ghost btn-sm" :disabled="!canManage" @click="doApprove(selLanes)"><Icon name="check" :size="13" />{{ t('aiPricing.actions.approveSelected', { n: selLanes.length }) }}</button>
          <button class="btn btn-ghost btn-sm" :disabled="!canManage" @click="openEdit(selLanes)"><Icon name="edit" :size="13" />{{ t('aiPricing.actions.editSelected') }}</button>
          <button class="btn btn-ghost btn-sm" :disabled="!canManage" @click="openReject(selLanes)"><Icon name="x-circle" :size="13" />{{ t('aiPricing.actions.rejectSelected') }}</button>
        </template>
      </DataTable>
    </Card>

    <Card :title="t('aiPricing.activity')" icon="clock" class="blk">
      <ModelActivityLog module="pricing" :limit="8" />
    </Card>

    <!-- detail drawer -->
    <Drawer v-model:open="drawer.open" :title="dl ? laneName(dl) : ''" :subtitle="dl ? dl.lane : ''" width="680px">
      <div v-if="dl" class="dr">
        <div class="dr-top">
          <StatusPill :status="dl.status || 'none'" :tone="STATUS_TONE[dl.status || 'none']" :label="statusLabel(dl.status)" />
          <div class="prices">
            <div><span>{{ t('aiPricing.drawer.current') }}</span><b class="num">{{ fmt.money(dl.currentPrice) }}</b></div>
            <Icon name="arrow" :size="14" />
            <div><span>{{ t('aiPricing.drawer.recommended') }}</span><b class="num acc">{{ fmt.money(dl.finalPrice) }}</b></div>
            <div v-if="dl.activePrice != null"><span>{{ t('aiPricing.drawer.active') }}</span><b class="num">{{ fmt.money(dl.activePrice) }}</b></div>
          </div>
        </div>
        <div v-if="dl.status === 'rejected' && dl.rejectedReason" class="callout danger">{{ t('aiPricing.drawer.rejectedReason', { r: reasonText(dl.rejectedReason) }) }}</div>
        <div class="dr-acts">
          <button v-if="dl.status !== 'approved'" class="btn btn-accent btn-sm" :disabled="!canManage || isBusy(dl)" :title="noPerm" @click="doApprove([dl])"><Spinner v-if="isBusy(dl)" :size="13" /><Icon v-else name="check" :size="13" />{{ t('aiPricing.actions.approve') }}</button>
          <button v-else class="btn btn-ghost btn-sm" :disabled="!canManage || isBusy(dl)" @click="doRevoke(dl)"><Icon name="return" :size="13" />{{ t('aiPricing.actions.revoke') }}</button>
          <button class="btn btn-ghost btn-sm" :disabled="!canManage" :title="noPerm" @click="openEdit([dl])"><Icon name="edit" :size="13" />{{ t('aiPricing.actions.edit') }}</button>
          <button class="btn btn-ghost btn-sm" :disabled="!canManage || dl.status === 'rejected'" :title="noPerm" @click="openReject([dl])"><Icon name="x-circle" :size="13" />{{ t('aiPricing.actions.reject') }}</button>
        </div>

        <section>
          <h4>{{ t('aiPricing.drawer.summary') }}</h4>
          <dl class="kv sum">
            <dt>{{ t('aiPricing.drawer.forecastVolume') }}</dt><dd class="num">{{ fmt.number(dl.forecastVolume, 1) }}</dd>
            <dt>{{ t('aiPricing.drawer.baselineVolume') }}</dt><dd class="num">{{ fmt.number(dl.baselineVolume, 1) }}</dd>
            <dt>{{ t('aiPricing.drawer.demandFactor') }}</dt><dd class="num">{{ fmt.number(dl.demandFactor, 2) }}</dd>
            <dt>{{ t('aiPricing.drawer.targetMargin') }}</dt><dd class="num">{{ fmt.percent(dl.targetMargin, 1) }}</dd>
            <dt>{{ t('aiPricing.drawer.tier') }}</dt>
            <dd>
              {{ dl.tier?.discountPct ? t('aiPricing.drawer.tierValue', { p: fmt.number(dl.tier.discountPct * (dl.tier.discountPct < 1 ? 100 : 1), 0), n: dl.tier.threshold }) : t('aiPricing.drawer.tierNone') }}
              <div v-if="dl.tier?.next" class="muted small">{{ t('aiPricing.drawer.tierNext', { n: dl.tier.next.weeklyVolume ?? dl.tier.next.threshold, p: fmt.number((dl.tier.next.discountPct ?? 0) * ((dl.tier.next.discountPct ?? 0) < 1 ? 100 : 1), 0) }) }}</div>
            </dd>
            <dt>{{ t('aiPricing.drawer.cost') }}</dt><dd class="num">{{ fmt.money(dl.cost) }}</dd>
            <dt>{{ t('aiPricing.drawer.expectedCost') }}</dt><dd class="num">{{ fmt.money(dl.expectedCost) }}</dd>
            <dt>{{ t('aiPricing.drawer.marketRef') }}</dt><dd class="num">{{ fmt.money(dl.marketRef) }} <span class="muted">({{ t('aiPricing.drawer.marketCap') }} {{ fmt.money(dl.marketCap) }})</span></dd>
            <dt>{{ t('aiPricing.drawer.floor') }}</dt><dd class="num">{{ fmt.money(dl.floorPrice) }}</dd>
            <dt>{{ t('aiPricing.drawer.expectedProfit') }}</dt><dd class="num"><b>{{ fmt.money(dl.expectedProfit) }}</b> <span class="muted">{{ t('aiPricing.drawer.currentProfit') }}: {{ fmt.money(dl.currentProfit) }}</span></dd>
          </dl>
        </section>

        <section>
          <h4>{{ t('aiPricing.drawer.waterfall') }}</h4>
          <p class="hint">{{ t('aiPricing.drawer.waterfallHint') }}</p>
          <Waterfall :steps="waterfallSteps" :format="v => fmt.money(v)" :height="230" />
        </section>

        <section>
          <h4>{{ t('aiPricing.drawer.sensitivity') }}</h4>
          <p class="hint">{{ t('aiPricing.drawer.sensitivityHint') }}</p>
          <LineChart :series="sensSeries" :markers="sensMarkers" x-type="number" :height="210" :legend="false" :y-zero="false"
            :x-format="v => fmt.money(v)" :x-tick-format="v => fmt.money(v, 'USD', 0)" :y-format="v => fmt.money(v, 'USD', 0)" />
          <div class="optline">{{ t('aiPricing.drawer.optimal') }}: <b class="num">{{ fmt.money(dl.optimalPrice) }}</b></div>
        </section>

        <section>
          <h4>{{ t('aiPricing.drawer.history') }}</h4>
          <p class="hint">{{ t('aiPricing.drawer.historyHint') }}</p>
          <LineChart v-if="histSeries.length" :series="histSeries" :height="180" :y-zero="false" dots :y-format="v => fmt.money(v)" />
          <div v-else class="empty-s">{{ t('aiPricing.drawer.historyEmpty') }}</div>
        </section>

        <section>
          <h4>{{ t('aiPricing.drawer.overrides') }}</h4>
          <ul v-if="dl.overrides?.length" class="ovs">
            <li v-for="o in dl.overrides" :key="o.id">
              <span class="mono">{{ o.id }}</span>
              <b class="num">{{ fmt.money(o.price) }}</b>
              <span class="tag">{{ t(`aiPricing.drawer.ovStatus.${o.status}`) }}</span>
              <span class="muted">{{ t('aiPricing.drawer.by', { who: o.approvedBy || '-', d: fmt.dateTime(o.approvedAt) }) }}</span>
              <span class="muted">{{ t('aiPricing.drawer.validUntil', { d: fmt.date(o.validUntil) }) }}</span>
            </li>
          </ul>
          <div v-else class="empty-s">{{ t('aiPricing.drawer.overridesEmpty') }}</div>
        </section>

        <div class="callout neutral try">
          <Icon name="info" :size="14" />
          <span>{{ t('aiPricing.drawer.tryHint', { hub: dl.hub, zip: dl.refZip || '-' }) }}</span>
          <button class="btn btn-link" @click="tryIt">{{ t('aiPricing.drawer.tryIt') }}</button>
        </div>
      </div>
      <Skeleton v-else variant="lines" :lines="10" />
    </Drawer>

    <!-- reject -->
    <Modal v-model:open="rej.open" :title="rej.lanes.length > 1 ? t('aiPricing.reject.titleMany', { n: rej.lanes.length }) : t('aiPricing.reject.title')" :subtitle="rej.lanes.length === 1 ? laneName(rej.lanes[0]) : ''" size="md">
      <div class="quick">
        <button v-for="q in QUICK" :key="q" type="button" class="btn btn-ghost btn-xs" @click="rej.reason = t(`aiPricing.reject.quick.${q}`); rej.error = ''">{{ t(`aiPricing.reject.quick.${q}`) }}</button>
      </div>
      <FormField :label="t('aiPricing.reject.reason')" :hint="t('aiPricing.reject.reasonHint')" :error="rej.error" required v-slot="{ id, invalid, describedBy }">
        <textarea :id="id" v-model="rej.reason" class="input ta" rows="3" :aria-invalid="invalid" :aria-describedby="describedBy" @input="rej.error = ''" />
      </FormField>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="rej.saving" @click="rej.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger btn-sm" :disabled="rej.saving" @click="submitReject"><Spinner v-if="rej.saving" :size="13" />{{ t('aiPricing.reject.submit') }}</button>
      </template>
    </Modal>

    <!-- edit -->
    <Modal v-model:open="ed.open" :title="ed.lanes.length > 1 ? t('aiPricing.edit.titleMany', { n: ed.lanes.length }) : t('aiPricing.edit.title')" :subtitle="edSingle ? laneName(edSingle) : ''" size="md">
      <template v-if="edSingle">
        <FormField :label="t('aiPricing.edit.price')" :error="ed.error" required v-slot="{ id, invalid, describedBy }">
          <div class="price-row">
            <span class="cur mono">USD</span>
            <input :id="id" v-model="ed.price" class="input num" inputmode="decimal" :aria-invalid="invalid" :aria-describedby="describedBy" @keydown.enter.prevent="submitEdit" />
            <button type="button" class="btn btn-ghost btn-sm" @click="ed.price = edSingle.recommendedPrice.toFixed(2)">{{ t('aiPricing.edit.useRecommended') }}</button>
          </div>
        </FormField>
        <p class="hint">{{ t('aiPricing.edit.recommended', { p: fmt.money(edSingle.recommendedPrice), lo: fmt.money(edSingle.range[0]), hi: fmt.money(edSingle.range[1]) }) }}</p>
        <p v-if="meta?.refPackage" class="hint">{{ t('aiPricing.edit.refPackage', { l: meta.refPackage.lengthIn, w: meta.refPackage.widthIn, h: meta.refPackage.heightIn, lb: meta.refPackage.weightLb }) }}</p>
        <ul v-if="liveWarnings.length" class="warns">
          <li v-for="w in liveWarnings" :key="w.code"><Icon name="alert" :size="13" />{{ t(`aiModel.pricing.warnings.${w.code}`, w.params) }}</li>
        </ul>
        <p v-else class="okline"><Icon name="check-circle" :size="13" />{{ t('aiPricing.edit.noWarnings') }}</p>
      </template>
      <template v-else>
        <FormField :label="t('aiPricing.edit.bulkPct')" :error="ed.error" v-slot="{ id }">
          <div class="price-row">
            <input :id="id" v-model.number="ed.pct" type="number" step="0.5" min="-30" max="30" class="input num pctin" />
            <span class="cur">%</span>
          </div>
        </FormField>
        <table class="table-simple bulk-t">
          <thead><tr><th>{{ t('aiPricing.table.cols.lane') }}</th><th class="r">{{ t('aiPricing.table.cols.recommended') }}</th><th class="r">{{ t('aiPricing.edit.newPrice') }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="x in bulkPreview" :key="x.l.lane">
              <td>{{ laneName(x.l) }}</td>
              <td class="r num">{{ fmt.money(x.l.recommendedPrice) }}</td>
              <td class="r num"><b>{{ fmt.money(x.price) }}</b></td>
              <td><span v-if="x.warnings.length" class="wtag" :title="x.warnings.map(w => t(`aiModel.pricing.warnings.${w.code}`, w.params)).join(' · ')"><Icon name="alert" :size="13" /></span></td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="ed.saving" @click="ed.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="ed.saving" @click="submitEdit"><Spinner v-if="ed.saving" :size="13" />{{ ed.lanes.length > 1 ? t('aiPricing.edit.applyAll') : t('aiPricing.edit.submit') }}</button>
      </template>
    </Modal>

    <!-- settings -->
    <Modal v-model:open="st.open" :title="t('aiPricing.settingsPanel.title')" :subtitle="t('aiPricing.settingsPanel.subtitle')" size="md">
      <Skeleton v-if="st.loading" variant="lines" :lines="6" />
      <div v-else class="set">
        <div class="form-grid">
          <FormField :label="t('aiPricing.settingsPanel.minMargin')" :error="st.errors.minMargin ? t('aiPricing.settingsPanel.errors.minMargin') : ''" v-slot="{ id, invalid }">
            <input :id="id" v-model="st.minMargin" class="input num" inputmode="decimal" :aria-invalid="invalid" :disabled="!canManage" />
          </FormField>
          <FormField :label="t('aiPricing.settingsPanel.maxMargin')" :error="st.errors.maxMargin ? t('aiPricing.settingsPanel.errors.maxMargin') : ''" v-slot="{ id, invalid }">
            <input :id="id" v-model="st.maxMargin" class="input num" inputmode="decimal" :aria-invalid="invalid" :disabled="!canManage" />
          </FormField>
        </div>
        <p class="hint">{{ t('aiPricing.settingsPanel.marginHint') }}</p>
        <FormField :label="t('aiPricing.settingsPanel.marketCap')" :hint="t('aiPricing.settingsPanel.marketCapHint')" :error="st.errors.marketCapMultiplier ? t('aiPricing.settingsPanel.errors.marketCapMultiplier') : ''" v-slot="{ id, invalid }">
          <input :id="id" v-model="st.marketCap" class="input num" inputmode="decimal" :aria-invalid="invalid" :disabled="!canManage" />
        </FormField>
        <Toggle v-model="st.autoApprove" :label="t('aiPricing.settingsPanel.autoApprove')" :description="t('aiPricing.settingsPanel.autoApproveDesc')" :disabled="!canManage" />
        <FormField v-if="st.autoApprove" :label="t('aiPricing.settingsPanel.autoBelow')" :error="st.errors.autoApproveBelowPct ? t('aiPricing.settingsPanel.errors.autoApproveBelowPct') : ''" v-slot="{ id, invalid }">
          <input :id="id" v-model="st.autoBelow" class="input num" inputmode="decimal" :aria-invalid="invalid" :disabled="!canManage" />
        </FormField>
        <dl class="kv"><dt>{{ t('aiPricing.settingsPanel.validity') }}</dt><dd>{{ t('aiPricing.settingsPanel.validityValue', { n: st.validityDays }) }}</dd></dl>
      </div>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="st.saving" @click="st.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="st.saving || st.loading || !canManage" :title="noPerm" @click="submitSettings"><Spinner v-if="st.saving" :size="13" />{{ t('aiPricing.settingsPanel.save') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.blk { margin-bottom: 16px; }
.dep { padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.dep-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.dep-l { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-3); font-weight: 500; }
.dep-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--ink-1); text-decoration: none; font-weight: 500; }
a.dep-chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.dep-chip.on { background: var(--accent-soft); border-color: transparent; color: var(--accent-ink); }
.dep-sub { color: var(--ink-3); font-weight: 400; }
.dep-arr { color: var(--ink-3); }
.dep-gen { margin-left: auto; color: var(--ink-3); font-size: 12.5px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.stale { align-items: center; flex-wrap: wrap; margin: 0; }
.stale span { flex: 1; min-width: 200px; }
.rc-h { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--ink-2); margin-bottom: 4px; }
.rc-h span { display: inline-flex; gap: 6px; align-items: center; }
.fb { margin-bottom: 12px; }
.lane { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lane-t { min-width: 0; }
.lane-n { font-weight: 500; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lane-s { font-size: 12px; color: var(--ink-3); }
.hubtag { font-family: var(--font-mono); font-size: 11px; background: var(--bg-3); padding: 1px 5px; border-radius: 4px; color: var(--ink-2); }
.rec { font-weight: 600; }
.ed { height: 18px; font-size: 10.5px; margin-left: 4px; }
.muted { color: var(--ink-3); }
.small { font-size: 12px; }
.up { color: oklch(0.5 0.12 155); }
.down { color: var(--danger); }
.st { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.until { font-size: 11px; color: var(--ink-3); }
.acts { display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end; }
.dr { display: flex; flex-direction: column; gap: 18px; }
.dr-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.prices { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; color: var(--ink-3); }
.prices div { display: flex; flex-direction: column; font-size: 12px; }
.prices b { font-size: 18px; color: var(--ink-1); font-family: var(--font-display); }
.prices b.acc { color: var(--accent-ink); }
.dr-acts { display: flex; gap: 8px; flex-wrap: wrap; }
.dr h4 { margin: 0 0 4px; font-size: 14px; font-family: var(--font-display); }
.hint { margin: 0 0 8px; font-size: 12.5px; color: var(--ink-3); }
.sum { grid-template-columns: 190px 1fr; font-size: 13px; }
.optline { font-size: 12.5px; color: var(--ink-2); margin-top: 6px; }
.empty-s { font-size: 13px; color: var(--ink-3); padding: 14px; background: var(--bg-2); border-radius: var(--r-md); text-align: center; }
.ovs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ovs li { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 12.5px; padding: 8px 10px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.try { align-items: center; flex-wrap: wrap; }
.try span { flex: 1; min-width: 200px; }
.quick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.ta { height: auto; padding: 10px 12px; resize: vertical; }
.price-row { display: flex; align-items: center; gap: 8px; }
.price-row .input { max-width: 160px; }
.pctin { max-width: 110px; }
.cur { color: var(--ink-3); font-weight: 500; }
.warns { list-style: none; padding: 10px 12px; margin: 8px 0 0; background: oklch(0.97 0.05 80); border-radius: var(--r-md); display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: oklch(0.42 0.1 65); }
.warns li, .okline { display: flex; align-items: center; gap: 6px; }
.okline { font-size: 12.5px; color: oklch(0.45 0.1 155); margin: 8px 0 0; }
.bulk-t { margin-top: 12px; font-size: 12.5px; }
.r { text-align: right; }
.wtag { color: oklch(0.55 0.13 70); }
.set { display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 700px) { .dep-gen { margin-left: 0; } .sum { grid-template-columns: 1fr; } }
</style>
