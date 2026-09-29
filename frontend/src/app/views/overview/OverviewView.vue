<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import FilterBar, { rangeBounds, presetRange } from '../../components/FilterBar.vue'
import KpiCard from '../../components/KpiCard.vue'
import AiInsightCard from '../../components/AiInsightCard.vue'
import Card from '../../components/Card.vue'
import DataTable from '../../components/DataTable.vue'
import StatusPill from '../../components/StatusPill.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import Money from '../../components/Money.vue'
import DateTime from '../../components/DateTime.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import BarChart from '../../components/charts/BarChart.vue'
import Donut from '../../components/charts/Donut.vue'
import { t, tx, fmt, locale } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { session, can, hasFeature } from '../../store/session.js'
import { listShipments } from '../../api/shipments.js'
import { listOrders } from '../../api/orders.js'
import { forecastSummary } from '../../api/forecast.js'
import { pendingCount } from '../../api/pricing.js'
import { batchOptimize } from '../../api/ai.js'
import { listAdjustments } from '../../api/wallet.js'
import { listStores } from '../../api/integrations.js'
import { db } from '../../store/db.js'
import { regionOf, REGIONS, isOnTime, daysBetween, carrierName, serviceName, hasKey } from '../../components/shipments/helpers.js'

const router = useRouter()
const RANGE_KEY = 'kpz_demo:ui:overview:range'
function loadRange() {
  try { const r = JSON.parse(localStorage.getItem(RANGE_KEY)); if (r?.preset) return r } catch {}
  return presetRange('last30')
}
const range = ref(loadRange())
watch(range, r => { try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)) } catch {} }, { deep: true })

const loading = ref(true)
const shipments = ref([])
const orders = ref([])
const adjustments = ref([])
const stores = ref([])
const forecast = ref(null)
const optimization = ref(null)
const optLoading = ref(true)

async function load() {
  loading.value = true
  try {
    const [s, o, a, st] = await Promise.all([listShipments({ includeTest: false }), listOrders(), listAdjustments(), listStores()])
    shipments.value = s
    orders.value = o
    adjustments.value = a
    stores.value = st
  } catch {
    toast.error(t('common.errorGeneric'))
  } finally {
    loading.value = false
  }
  forecastSummary().then(r => { forecast.value = r }).catch(() => { forecast.value = null })
  loadOptimization()
}

async function loadOptimization() {
  optLoading.value = true
  try {
    const ids = orders.value.filter(o => o.status === 'awaiting_shipment').map(o => o.id)
    optimization.value = ids.length ? { ...(await batchOptimize(ids)), ids } : { ids: [], totals: { savings: 0 } }
  } catch {
    optimization.value = null
  } finally { optLoading.value = false }
}

onMounted(load)

// ---- range + previous period
const bounds = computed(() => rangeBounds(range.value) ?? rangeBounds(presetRange('last30')))
const prevBounds = computed(() => {
  const b = bounds.value
  const len = b.to.getTime() - b.from.getTime()
  return { from: new Date(b.from.getTime() - len - 1), to: new Date(b.from.getTime() - 1) }
})
const live = s => s.status !== 'voided' && !s.test
const within = (s, b) => { const d = new Date(s.createdAt); return d >= b.from && d <= b.to }
const cur = computed(() => shipments.value.filter(s => live(s) && within(s, bounds.value)))
const prev = computed(() => shipments.value.filter(s => live(s) && within(s, prevBounds.value)))

function metrics(list) {
  const delivered = list.filter(s => s.status === 'delivered' && s.deliveredAt)
  const onTimeList = delivered.map(isOnTime).filter(v => v != null)
  return {
    count: list.length,
    spend: list.reduce((sum, s) => sum + (Number(s.walletCharge ?? s.total) || 0), 0),
    savings: list.reduce((sum, s) => sum + (s.aiPick?.chosen ? Number(s.aiPick.savingsVsDefault) || 0 : 0), 0),
    avgDays: delivered.length ? delivered.reduce((sum, s) => sum + daysBetween(s.createdAt, s.deliveredAt), 0) / delivered.length : null,
    onTime: onTimeList.length ? onTimeList.filter(Boolean).length / onTimeList.length : null,
    exceptions: list.filter(s => s.status === 'exception').length,
  }
}
const m = computed(() => metrics(cur.value))
const pm = computed(() => metrics(prev.value))
const delta = (a, b) => (a == null || b == null || !b ? null : (a - b) / Math.abs(b))

// buckets for sparklines / daily chart
const days = computed(() => {
  const out = []
  const d = new Date(bounds.value.from)
  d.setHours(0, 0, 0, 0)
  const end = new Date(Math.min(bounds.value.to.getTime(), Date.now()))
  while (d <= end && out.length < 400) { out.push(new Date(d)); d.setDate(d.getDate() + 1) }
  return out
})
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const byDay = computed(() => {
  const map = new Map(days.value.map(d => [dayKey(d), []]))
  for (const s of cur.value) { const k = dayKey(new Date(s.createdAt)); if (map.has(k)) map.get(k).push(s) }
  return map
})
const weekly = computed(() => days.value.length > 45)
const buckets = computed(() => {
  const list = days.value
  const size = weekly.value ? 7 : 1
  const out = []
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size)
    out.push({ start: chunk[0], items: chunk.flatMap(d => byDay.value.get(dayKey(d)) ?? []) })
  }
  return out
})
function spark(fn) {
  const n = Math.min(14, buckets.value.length)
  if (n < 2) return null
  const per = Math.ceil(buckets.value.length / n)
  const out = []
  for (let i = 0; i < buckets.value.length; i += per) out.push(fn(buckets.value.slice(i, i + per).flatMap(b => b.items)))
  return out
}
const sparks = computed(() => ({
  count: spark(l => l.length),
  spend: spark(l => l.reduce((s, x) => s + (x.walletCharge ?? x.total ?? 0), 0)),
  savings: spark(l => l.reduce((s, x) => s + (x.aiPick?.chosen ? x.aiPick.savingsVsDefault || 0 : 0), 0)),
  avgDays: spark(l => { const d = l.filter(x => x.deliveredAt); return d.length ? d.reduce((s, x) => s + daysBetween(x.createdAt, x.deliveredAt), 0) / d.length : null }),
  onTime: spark(l => { const v = l.map(isOnTime).filter(x => x != null); return v.length ? v.filter(Boolean).length / v.length : null }),
  exceptions: spark(l => l.filter(x => x.status === 'exception').length),
}))
const deltaLabel = computed(() => t('overview.vsPrev'))

const kpis = computed(() => [
  { key: 'count', label: t('overview.kpi.count'), value: m.value.count, format: 'number', delta: delta(m.value.count, pm.value.count), icon: 'box', to: { name: 'shipments' } },
  { key: 'spend', label: t('overview.kpi.spend'), value: m.value.spend, format: 'money', delta: delta(m.value.spend, pm.value.spend), invert: true, icon: 'wallet', to: { name: 'billing' } },
  { key: 'savings', label: t('overview.kpi.savings'), value: m.value.savings, format: 'money', delta: delta(m.value.savings, pm.value.savings), icon: 'spark', tone: 'accent', to: { name: 'ai-optimizer' } },
  { key: 'avgDays', label: t('overview.kpi.avgDays'), value: m.value.avgDays == null ? '-' : t('overview.daysValue', { n: fmt.number(m.value.avgDays, 1) }), format: 'number', delta: delta(m.value.avgDays, pm.value.avgDays), invert: true, icon: 'clock', to: { name: 'shipments', query: { tab: 'delivered' } } },
  { key: 'onTime', label: t('overview.kpi.onTime'), value: m.value.onTime == null ? '-' : m.value.onTime, format: 'percent', delta: delta(m.value.onTime, pm.value.onTime), icon: 'check-circle', tone: 'success', to: { name: 'shipments', query: { tab: 'delivered' } } },
  { key: 'exceptions', label: t('overview.kpi.exceptions'), value: m.value.exceptions, format: 'number', delta: delta(m.value.exceptions, pm.value.exceptions), invert: true, icon: 'alert', tone: 'danger', to: { name: 'shipments', query: { tab: 'exception' } } },
])

// ---- charts
const volumeChart = computed(() => ({
  categories: buckets.value.map(b => ({ key: b.start.toISOString(), label: weekly.value ? fmt.shortDate(b.start.toISOString()) : b.start.toLocaleDateString(locale.value === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' }) })),
  series: ['NJ01', 'LA01'].map((h, i) => ({ key: h, label: h, color: i === 0 ? 'var(--accent)' : 'oklch(0.68 0.11 190)', values: buckets.value.map(b => b.items.filter(s => s.hub === h).length) })),
}))
const carrierData = computed(() => {
  const map = new Map()
  for (const s of cur.value) map.set(s.carrier, (map.get(s.carrier) ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([code, value]) => ({ key: code, label: carrierName(code), value, color: db.get('carriers', code)?.color }))
})
const regionChart = computed(() => ({
  categories: REGIONS.map(r => ({ key: r, label: t('overview.regions.' + r) })),
  series: [{ key: 'n', label: t('overview.kpi.count'), values: REGIONS.map(r => cur.value.filter(s => regionOf(s.to?.state) === r).length) }],
}))

// ---- AI insights
const awaiting = computed(() => orders.value.filter(o => o.status === 'awaiting_shipment'))
const addressProblems = computed(() => orders.value.filter(o => (o.status === 'awaiting_shipment' || o.status === 'on_hold') && (o.addressCheck?.score ?? 100) < 70))
const pricingPending = computed(() => pendingCount())
const issueBreakdown = computed(() => {
  const map = new Map()
  for (const o of addressProblems.value) { const k = o.addressCheck?.issueType ?? 'other'; map.set(k, (map.get(k) ?? 0) + 1) }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: hasKey('orders.issueTypes.' + k) ? t('orders.issueTypes.' + k) : t('orders.issueTypes.other'), value: String(n), weight: n / Math.max(1, addressProblems.value.length) }))
})
const insights = computed(() => {
  const out = []
  if (addressProblems.value.length) out.push({
    key: 'address', title: t('overview.ai.address.title', { n: addressProblems.value.length }), description: t('overview.ai.address.desc'),
    action: t('overview.ai.address.action'), icon: 'search', to: { name: 'orders', query: { addressScore: 'lt70' } }, reason: issueBreakdown.value, meta: 'addr-ml',
  })
  if (forecast.value) out.push({
    key: 'forecast', title: t('overview.ai.forecast.title'), description: tx(forecast.value.text),
    action: t('overview.ai.forecast.action'), icon: 'chart', to: { name: 'ai-forecast' }, meta: forecast.value.version ? `forecast ${forecast.value.version}` : '',
    reason: [
      { label: t('overview.ai.forecast.next4'), value: fmt.number(forecast.value.next4) },
      { label: t('overview.ai.forecast.last4'), value: fmt.number(forecast.value.last4) },
      { label: t('overview.ai.forecast.band'), value: '±' + fmt.percent(forecast.value.bandPct, 1) },
    ],
  })
  if (awaiting.value.length) out.push({
    key: 'optimizer', loading: optLoading.value,
    title: t('overview.ai.optimizer.title', { n: awaiting.value.length }),
    description: optimization.value?.totals ? t('overview.ai.optimizer.desc', { amount: fmt.money(optimization.value.totals.savings), pct: fmt.percent(optimization.value.totals.savingsPct ?? 0, 0) }) : t('overview.ai.optimizer.calculating'),
    action: t('overview.ai.optimizer.action'), icon: 'layers', feature: 'batch',
    to: { name: 'batch', query: { orders: (optimization.value?.ids ?? awaiting.value.map(o => o.id)).join(',') } },
    reason: optimization.value?.totals ? [
      { label: t('overview.ai.optimizer.ai'), value: fmt.money(optimization.value.totals.ai?.cost ?? 0) },
      { label: t('overview.ai.optimizer.default'), value: fmt.money(optimization.value.totals.default?.cost ?? 0) },
      { label: t('overview.ai.optimizer.hubs'), value: Object.entries(optimization.value.byHub ?? {}).map(([h, v]) => `${h} ${typeof v === 'number' ? v : v?.count ?? v?.orders ?? ''}`).join(' · ') },
    ] : null, meta: 'optimizer',
  })
  if (pricingPending.value) out.push({
    key: 'pricing', title: t('overview.ai.pricing.title', { n: pricingPending.value }), description: t('overview.ai.pricing.desc'),
    action: t('overview.ai.pricing.action'), icon: 'dollar', to: { name: 'ai-pricing' }, meta: 'pricing',
    reason: [t('overview.ai.pricing.reason')],
  })
  return out.slice(0, 4)
})
function openInsight(i) {
  if (i.feature && !hasFeature(i.feature)) { toast.warning(t('common.upgradeRequired')); router.push({ name: 'plan' }); return }
  router.push(i.to)
}

// ---- to-do
const soonAdjustments = computed(() => adjustments.value.filter(a => a.status === 'charged' && a.disputeDeadline && new Date(a.disputeDeadline) > new Date() && daysBetween(new Date(), a.disputeDeadline) <= 7))
const hsPending = computed(() => db.all('products').filter(p => !p.hsCode || p.hsStatus === 'missing' || p.hsStatus === 'ai_pending').length)
const wooMissing = computed(() => stores.value.some(s => s.channel === 'woocommerce' && s.status !== 'connected'))
const todos = computed(() => [
  awaiting.value.length && { key: 'labels', icon: 'printer', text: t('overview.todo.labels', { n: awaiting.value.length }), to: { name: 'orders', query: { tab: 'awaiting_shipment' } }, tone: 'accent' },
  soonAdjustments.value.length && { key: 'adj', icon: 'scale', text: t('overview.todo.adjustments', { n: soonAdjustments.value.length }), to: { name: 'billing', query: { tab: 'adjustments' } }, tone: 'warning' },
  hsPending.value && { key: 'hs', icon: 'tag', text: t('overview.todo.hs', { n: hsPending.value }), to: { name: 'ai-hs' }, tone: 'accent' },
  wooMissing.value && { key: 'woo', icon: 'store', text: t('overview.todo.woo'), to: { name: 'stores' }, tone: 'neutral' },
  addressProblems.value.length && { key: 'addr', icon: 'pin', text: t('overview.todo.address', { n: addressProblems.value.length }), to: { name: 'orders', query: { addressScore: 'lt70' } }, tone: 'danger' },
].filter(Boolean))

// ---- recent shipments
const recent = computed(() => shipments.value.slice(0, 8))
const cols = computed(() => [
  { key: 'id', label: t('overview.recent.id'), nowrap: true },
  { key: 'to', label: t('overview.recent.recipient'), value: r => r.to?.name },
  { key: 'carrier', label: t('overview.recent.carrier') },
  { key: 'status', label: t('common.status') },
  { key: 'walletCharge', label: t('common.amount'), align: 'right' },
])
const greeting = computed(() => {
  const h = new Date().getHours()
  return t(h < 12 ? 'overview.greetMorning' : h < 18 ? 'overview.greetDay' : 'overview.greetEvening', { name: (session.user?.name ?? '').split(' ')[0] })
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.overview')" :subtitle="greeting">
      <template #actions>
        <RouterLink v-if="can('orders.manage')" class="btn btn-ghost" :to="{ name: 'orders' }"><Icon name="list" :size="14" />{{ t('overview.actions.orders') }}</RouterLink>
        <RouterLink v-if="can('shipments.create')" class="btn btn-primary" :to="{ name: 'shipment-new' }"><Icon name="plus" :size="14" />{{ t('overview.actions.newShipment') }}</RouterLink>
        <button v-else class="btn btn-primary" disabled :title="t('common.noPermission')"><Icon name="lock" :size="14" />{{ t('overview.actions.newShipment') }}</button>
      </template>
    </PageHeader>

    <div class="toolbar">
      <FilterBar v-model:range="range" :default-range="presetRange('last30')" :show-clear="false" />
      <span class="muted small">{{ t('overview.rangeNote', { from: fmt.date(bounds.from.toISOString()), to: fmt.date(bounds.to.toISOString()) }) }}</span>
    </div>

    <div class="grid-kpi kpis">
      <KpiCard v-for="k in kpis" :key="k.key" :label="k.label" :value="k.value" :format="k.format" :delta="k.delta" :delta-label="deltaLabel" :invert="k.invert"
        :sparkline="sparks[k.key]" :icon="k.icon" :tone="k.tone" :loading="loading" clickable @click="router.push(k.to)" />
    </div>

    <section class="ai-row">
      <div class="section-head">
        <h2 class="section-title"><span class="badge-ai"><Icon name="spark" :size="10" />AI</span> {{ t('overview.ai.title') }}</h2>
        <RouterLink class="link small" :to="{ name: 'ai' }">{{ t('overview.ai.hub') }}</RouterLink>
      </div>
      <div v-if="loading" class="grid-4"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="150" /></div>
      <div v-else-if="insights.length" class="grid-4 insights">
        <AiInsightCard v-for="i in insights" :key="i.key" :title="i.title" :description="i.description" :action-label="i.action" :action-icon="i.icon"
          :applying="i.loading" :reason="i.reason" :meta="i.meta" @apply="openInsight(i)" />
      </div>
      <div v-else class="panel"><EmptyState icon="spark" :title="t('overview.ai.emptyTitle')" :description="t('overview.ai.emptyDesc')" compact /></div>
    </section>

    <div class="charts">
      <Card :title="t('overview.charts.volume')" :subtitle="weekly ? t('overview.charts.weekly') : t('overview.charts.daily')" class="c-wide">
        <Skeleton v-if="loading" variant="rect" :height="240" />
        <BarChart v-else :categories="volumeChart.categories" :series="volumeChart.series" mode="stacked" :height="240" :empty-text="t('overview.charts.empty')" />
      </Card>
      <Card :title="t('overview.charts.carriers')">
        <Skeleton v-if="loading" variant="circle" :width="180" :height="180" />
        <Donut v-else :data="carrierData" :size="170" :center-label="t('overview.kpi.count')" :empty-text="t('overview.charts.empty')" />
      </Card>
      <Card :title="t('overview.charts.regions')">
        <Skeleton v-if="loading" variant="rect" :height="200" />
        <BarChart v-else :categories="regionChart.categories" :series="regionChart.series" horizontal show-values :legend="false" :empty-text="t('overview.charts.empty')" />
      </Card>
    </div>

    <div class="bottom">
      <Card :title="t('overview.todo.title')" padding="none">
        <div v-if="loading" class="pad"><Skeleton :lines="4" /></div>
        <ul v-else-if="todos.length" class="todos">
          <li v-for="td in todos" :key="td.key">
            <RouterLink :to="td.to" class="todo">
              <span class="todo-ic" :class="'t-' + td.tone"><Icon :name="td.icon" :size="14" /></span>
              <span class="todo-text">{{ td.text }}</span>
              <Icon name="chevron-right" :size="13" class="muted" />
            </RouterLink>
          </li>
        </ul>
        <EmptyState v-else icon="check-circle" :title="t('overview.todo.emptyTitle')" :description="t('overview.todo.emptyDesc')" compact />
      </Card>

      <Card :title="t('overview.recent.title')" padding="none" class="c-wide">
        <template #actions><RouterLink class="link small" :to="{ name: 'shipments' }">{{ t('common.viewAll') }}</RouterLink></template>
        <DataTable :columns="cols" :rows="recent" :loading="loading" :paginate="false" :column-menu="false" :sticky-header="false" dense
          :empty-title="t('overview.recent.emptyTitle')" :empty-desc="t('overview.recent.emptyDesc')" :empty-action-label="can('shipments.create') ? t('overview.actions.newShipment') : ''"
          @empty-action="router.push({ name: 'shipment-new' })" @row-click="r => router.push({ name: 'shipment-detail', params: { id: r.id } })">
          <template #cell-id="{ row }"><div class="mono strong">{{ row.id }}</div><div class="muted xs"><DateTime :value="row.createdAt" /></div></template>
          <template #cell-to="{ row }"><div class="truncate">{{ row.to?.name }}</div><div class="muted xs">{{ row.to?.city }}, {{ row.to?.state }}</div></template>
          <template #cell-carrier="{ row }"><span class="rc-car"><CarrierLogo :code="row.carrier" :size="22" /><span class="truncate rc-svc">{{ serviceName(row.carrier, row.service) }}</span></span></template>
          <template #cell-status="{ value }"><StatusPill :status="value" size="sm" /></template>
          <template #cell-walletCharge="{ row }"><Money :value="row.total ?? row.walletCharge" /></template>
        </DataTable>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.small { font-size: 12.5px; }
.xs { font-size: 11.5px; }
.strong { font-weight: 600; }
.kpis { margin-bottom: 22px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rc-car { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 240px; }
.rc-svc { font-size: 12.5px; min-width: 0; }
.ai-row { margin-bottom: 22px; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.section-title { display: flex; align-items: center; gap: 8px; margin: 0; }
.insights { align-items: stretch; }
.charts { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 16px; margin-bottom: 22px; }
.bottom { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; align-items: start; }
.pad { padding: 16px 20px; }
.todos { list-style: none; margin: 0; padding: 6px 0; }
.todo { display: flex; align-items: center; gap: 12px; padding: 10px 20px; color: var(--ink-1); font-size: 13.5px; }
.todo:hover { background: var(--bg-2); }
.todo-text { flex: 1; }
.todo-ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--bg-3); color: var(--ink-2); flex: none; }
.todo-ic.t-accent { background: var(--accent-soft); color: var(--accent); }
.todo-ic.t-warning { background: oklch(0.96 0.06 80); color: oklch(0.5 0.12 70); }
.todo-ic.t-danger { background: oklch(0.95 0.04 25); color: var(--danger); }
@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .kpis { grid-template-columns: 1fr; } }
@media (max-width: 1280px) {
  .charts { grid-template-columns: 1fr 1fr; }
  .charts .c-wide { grid-column: 1 / -1; }
  .bottom { grid-template-columns: 1fr; }
}
@media (max-width: 860px) {
  .charts { grid-template-columns: 1fr; }
}
</style>
