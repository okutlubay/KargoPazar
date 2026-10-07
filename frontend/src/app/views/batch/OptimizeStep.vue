<script setup>
// Batch step 2, AI batch optimization (spec 5.7): progress, hub grouping, carrier distribution,
// default rule vs AI comparison and per-row service dropdowns with live totals.
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar from '../../components/FilterBar.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import Popover from '../../components/Popover.vue'
import Slider from '../../components/Slider.vue'
import AlternativesList from '../../components/compare/AlternativesList.vue'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const props = defineProps({
  loading: Boolean,
  progress: { type: Object, default: () => ({ pct: 0, done: 0, total: 0 }) },
  error: { type: String, default: '' },
  result: { type: Object, default: null },
  assignments: { type: Array, default: () => [] },
  totals: { type: Object, default: null },
  weight: { type: Number, default: 0.6 },
  serviceEstimate: { type: Number, default: 0 },
  orderCount: { type: Number, default: 0 },
})
const emit = defineEmits(['select', 'reset-all', 'rerun', 'weight', 'back', 'next'])

const hubCount = computed(() => db.all('hubs').filter(h => ['NJ01', 'LA01'].includes(h.code)).length || 2)
const runningText = computed(() => t('batch.opt.running', {
  orders: fmt.number(props.progress.total || props.orderCount),
  services: fmt.number(props.result?.evaluated?.services ?? props.serviceEstimate),
  hubs: hubCount.value,
}))
const eta = q => q.effectiveEtaDays ?? q.etaDays
const days = n => t('batch.opt.days', { n: fmt.number(n, Number.isInteger(n) ? 0 : 1) })
const pct = v => fmt.percent(v, 1)

const hubs = computed(() => {
  const by = props.totals?.byHub ?? {}
  return ['NJ01', 'LA01'].map(code => ({
    code,
    name: tx(db.all('hubs').find(h => h.code === code)?.name),
    count: by[code]?.count ?? 0,
    cost: by[code]?.cost ?? 0,
    cap: props.result?.capacity?.[code] ?? null,
  }))
})
const carriers = computed(() => {
  const by = props.totals?.byCarrier ?? {}
  const n = props.assignments.length || 1
  return Object.values(by).sort((a, b) => b.count - a.count).map(c => ({
    ...c, share: c.count / n,
    services: Object.entries(c.services).sort((a, b) => b[1] - a[1]).map(([name, k]) => `${name} (${k})`).join(', '),
  }))
})
const changed = computed(() => props.assignments.filter(a => a.quote.key !== a.aiQuoteKey).length)
const defaultRule = computed(() => props.totals?.totals?.default?.rule ?? { carrier: 'UPS', service: 'GROUND' })
const defaultCarrierName = computed(() => db.get('carriers', defaultRule.value.carrier)?.name ?? defaultRule.value.carrier)
const defaultHub = computed(() => db.doc('user')?.company?.defaultHub ?? 'NJ01')

// table
const search = ref('')
const filters = ref({ hub: [] })
const chips = computed(() => [{ key: 'hub', label: t('batch.opt.filterHub'), options: hubs.value.map(h => ({ value: h.code, label: h.code, count: h.count })) }])
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return props.assignments.filter(a => {
    if (filters.value.hub?.length && !filters.value.hub.includes(a.hub)) return false
    if (!q) return true
    return [a.orderId, a.recipient, a.destination?.city, a.destination?.state, a.destination?.zip].some(v => String(v ?? '').toLowerCase().includes(q))
  })
})
const filtered = computed(() => !!search.value || !!filters.value.hub?.length)
function clearFilters() { search.value = ''; filters.value = { hub: [] } }
const columns = computed(() => [
  { key: 'orderId', label: t('batch.col.order'), sortable: true, nowrap: true },
  { key: 'destination', label: t('batch.col.destination'), sortable: true, sortValue: r => r.destination?.state, hideBelow: 'lg' },
  { key: 'hub', label: t('batch.col.hub'), sortable: true, width: 80 },
  { key: 'service', label: t('batch.col.service'), sortable: true, sortValue: r => r.quote.carrierName + r.quote.serviceName },
  { key: 'eta', label: t('batch.col.eta'), sortable: true, align: 'right', sortValue: r => eta(r.quote), hideBelow: 'md' },
  { key: 'price', label: t('batch.col.price'), sortable: true, align: 'right', sortValue: r => r.quote.total },
  { key: 'savings', label: t('batch.col.savings'), sortable: true, align: 'right', hideBelow: 'md' },
  { key: 'reason', label: t('batch.col.reason'), align: 'center', width: 70 },
])
const optionLabel = (q, isAi) => `${q.serviceName} · ${fmt.money(q.total)} · ${days(eta(q))}${q.source === 'own' ? ' · ' + t('batch.opt.own') : ''}${isAi ? ' · AI' : ''}`
const weightPct = computed(() => Math.round(props.weight * 100))
function onWeight(v) { emit('weight', Math.round(v) / 100) }
</script>

<template>
  <div class="opt">
    <!-- running -->
    <section v-if="loading" class="panel run">
      <div class="run-head">
        <span class="ai-dot"><Icon name="brain" :size="18" /></span>
        <div>
          <div class="panel-title">{{ runningText }}</div>
          <div class="panel-sub">{{ t('batch.opt.model') }}</div>
        </div>
      </div>
      <ProgressBar :value="progress.pct" show-value size="lg" />
      <div class="panel-sub">{{ t('batch.opt.progress', { done: progress.done, total: progress.total }) }}</div>
      <div class="grid-3 sk"><Skeleton variant="rect" :height="96" /><Skeleton variant="rect" :height="96" /><Skeleton variant="rect" :height="96" /></div>
    </section>

    <!-- error -->
    <section v-else-if="error" class="panel">
      <EmptyState icon="alert" :title="t('batch.opt.failed')" :description="error" :action-label="t('batch.opt.retry')" action-icon="refresh" @action="emit('rerun')" />
    </section>

    <template v-else-if="result && totals">
      <!-- header strip -->
      <section class="panel strip" data-testid="batch-opt-done">
        <div class="strip-l">
          <span class="ai-dot"><Icon name="spark" :size="16" /></span>
          <div>
            <div class="panel-title">{{ t('batch.opt.done', { orders: fmt.number(result.evaluated.orders), candidates: fmt.number(result.evaluated.candidates) }) }}</div>
            <div class="panel-sub">{{ runningText }}</div>
          </div>
        </div>
        <div class="strip-r">
          <div class="slider" data-testid="batch-opt-slider"><Slider :model-value="weightPct" :min="0" :max="100" :step="5" :label="t('batch.opt.strategy')" :left-label="t('batch.opt.speed')" :right-label="t('batch.opt.cost')" :format="v => v + '%'" @change="onWeight" /></div>
          <button class="btn btn-ghost btn-sm" @click="emit('rerun')"><Icon name="refresh" :size="13" /> {{ t('batch.opt.rerun') }}</button>
        </div>
      </section>

      <div class="grid-top">
        <!-- comparison -->
        <section class="panel cmp">
          <div class="panel-head"><div class="panel-title">{{ t('batch.opt.compare') }}</div></div>
          <div class="cmp-body">
            <div class="cmp-col">
              <div class="cmp-h">{{ t('batch.opt.defaultRule') }}</div>
              <div class="cmp-d">{{ t('batch.opt.defaultRuleDesc', { carrier: defaultCarrierName, hub: defaultHub }) }}</div>
              <div class="cmp-k">{{ t('batch.opt.totalCost') }}</div>
              <div class="cmp-v num">{{ fmt.money(totals.totals.default.cost) }}</div>
              <div class="cmp-k">{{ t('batch.opt.avgEta') }}</div>
              <div class="cmp-v2 num">{{ days(totals.totals.default.avgEtaDays) }}</div>
            </div>
            <div class="cmp-col ai">
              <div class="cmp-h"><Icon name="spark" :size="13" /> {{ t('batch.opt.aiTitle') }}</div>
              <div class="cmp-d">{{ t('batch.opt.aiDesc') }}</div>
              <div class="cmp-k">{{ t('batch.opt.totalCost') }}</div>
              <div class="cmp-v num">{{ fmt.money(totals.totals.ai.cost) }}</div>
              <div class="cmp-k">{{ t('batch.opt.avgEta') }}</div>
              <div class="cmp-v2 num">{{ days(totals.totals.ai.avgEtaDays) }}</div>
            </div>
          </div>
          <div class="save" data-testid="batch-opt-savings" :class="{ neg: totals.totals.savings < 0 }">
            <Icon name="dollar" :size="15" />
            <span>{{ t('batch.opt.savings') }}</span>
            <strong class="num">{{ t('batch.opt.savingsLine', { amount: fmt.money(totals.totals.savings), pct: pct(totals.totals.savingsPct) }) }}</strong>
          </div>
        </section>

        <!-- hubs -->
        <section class="panel">
          <div class="panel-head"><div class="panel-title">{{ t('batch.opt.byHub') }}</div></div>
          <div class="hubs">
            <div v-for="h in hubs" :key="h.code" class="hub">
              <div class="hub-top"><span class="hub-code"><Icon name="warehouse" :size="14" /> {{ h.code }}</span><span class="hub-n num">{{ fmt.number(h.count) }}</span></div>
              <div class="hub-name">{{ h.name }}</div>
              <ProgressBar :value="assignments.length ? (h.count / assignments.length) * 100 : 0" size="sm" />
              <div class="hub-meta"><span>{{ t('batch.opt.hubOrders', { n: h.count }) }} · {{ fmt.money(h.cost) }}</span><span v-if="h.cap">{{ t('batch.opt.capacity', { used: fmt.number(h.cap.todayLoad + h.count), limit: fmt.number(h.cap.limit) }) }}</span></div>
            </div>
          </div>
        </section>
      </div>

      <!-- carriers -->
      <section class="panel">
        <div class="panel-head"><div class="panel-title">{{ t('batch.opt.byCarrier') }}</div></div>
        <div class="table-scroll">
          <table class="table-simple">
            <thead><tr><th>{{ t('batch.col.carrier') }}</th><th class="r">{{ t('batch.col.count') }}</th><th>{{ t('batch.col.share') }}</th><th class="hide-md">{{ t('batch.col.services') }}</th><th class="r">{{ t('batch.col.cost') }}</th></tr></thead>
            <tbody>
              <tr v-for="c in carriers" :key="c.carrier">
                <td><CarrierLogo :code="c.carrier" :size="22" show-name /></td>
                <td class="r num">{{ fmt.number(c.count) }}</td>
                <td class="share"><div class="bar"><span :style="{ width: (c.share * 100).toFixed(1) + '%' }" /></div><span class="num">{{ pct(c.share) }}</span></td>
                <td class="hide-md small muted">{{ c.services }}</td>
                <td class="r num">{{ fmt.money(c.cost) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- excluded by optimizer -->
      <section v-if="result.excluded?.length" class="callout warn">
        <Icon name="alert" :size="16" />
        <div>
          <strong>{{ t('batch.opt.excludedTitle') }}</strong>
          <div v-for="ex in result.excluded" :key="ex.orderId" class="small"><RouterLink :to="`/orders/${ex.orderId}`" class="mono">{{ ex.orderId }}</RouterLink> · {{ t('batch.opt.excludedReasons.' + ex.reason) }}</div>
        </div>
      </section>

      <!-- assignments -->
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">{{ t('batch.opt.assignments') }}</div>
            <div class="panel-sub">{{ changed ? t('batch.opt.changedN', { n: changed }) : t('batch.opt.assignmentsHint') }}</div>
          </div>
          <button v-if="changed" class="btn btn-ghost btn-sm" @click="emit('reset-all')"><Icon name="return" :size="13" /> {{ t('batch.opt.resetAll') }}</button>
        </div>
        <div class="fb"><FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('batch.opt.searchPh')" @clear="clearFilters" /></div>
        <DataTable :columns="columns" :rows="rows" row-key="orderId" :clickable="false" :filtered="filtered" :page-sizes="[25, 50, 100]" dense
          storage-key="batch-assign" @clear-filters="clearFilters">
          <template #cell-orderId="{ row }">
            <div class="oid"><ChannelLogo :code="row.channel" :size="18" /><div><RouterLink :to="`/orders/${row.orderId}`" class="link mono">{{ row.orderId }}</RouterLink><div class="muted">{{ row.recipient }}</div></div></div>
          </template>
          <template #cell-destination="{ row }"><span class="small">{{ row.destination?.city }}, {{ row.destination?.state }} {{ row.destination?.zip }}</span></template>
          <template #cell-hub="{ row }">
            <span class="tag">{{ row.hub }}</span>
            <div v-if="row.shiftedFrom" class="muted">{{ t('batch.opt.shifted', { from: row.shiftedFrom }) }}</div>
          </template>
          <template #cell-service="{ row }">
            <div class="svc">
              <CarrierLogo :code="row.quote.carrierCode" :size="20" />
              <select class="select sel" :value="row.quote.key" :aria-label="t('batch.col.service')" @change="emit('select', row.orderId, $event.target.value)">
                <option v-for="alt in row.alternatives" :key="alt.quote.key" :value="alt.quote.key">{{ optionLabel(alt.quote, alt.quote.key === row.aiQuoteKey) }}</option>
              </select>
              <span v-if="row.quote.key !== row.aiQuoteKey" class="tag tag-warning chg">{{ t('batch.opt.changed') }}
                <button class="btn-link x" :aria-label="t('batch.opt.resetRow')" :title="t('batch.opt.resetRow')" @click="emit('select', row.orderId, row.aiQuoteKey)"><Icon name="return" :size="11" /></button>
              </span>
              <span v-else class="tag tag-accent chg">AI</span>
            </div>
            <div v-if="row.estimatedPackage" class="muted"><Icon name="scale" :size="11" /> {{ t('batch.opt.estimatedPkg') }}</div>
            <AlternativesList v-if="row.alternatives?.length > 1" :alternatives="row.alternatives" :selected-key="row.quote.key" :recommended-key="row.aiQuoteKey" @select="k => emit('select', row.orderId, k)" />
          </template>
          <template #cell-eta="{ row }"><span class="num">{{ days(eta(row.quote)) }}</span></template>
          <template #cell-price="{ row }"><span class="num strong">{{ fmt.money(row.quote.total) }}</span></template>
          <template #cell-savings="{ row }"><span class="num" :class="row.savings > 0 ? 'pos' : row.savings < 0 ? 'neg-t' : 'muted'">{{ row.savings ? fmt.money(row.savings) : '-' }}</span></template>
          <template #cell-reason="{ row }">
            <Popover placement="bottom-end" :width="300" :aria-label="t('batch.opt.why')">
              <template #trigger="{ toggle, id }">
                <button class="btn btn-ghost btn-xs" :aria-controls="id" :aria-label="t('batch.opt.why')" @click.stop="toggle"><Icon name="info" :size="12" /></button>
              </template>
              <div class="why">
                <div class="why-t"><Icon name="spark" :size="13" /> {{ t('batch.opt.why') }}</div>
                <p>{{ tx(row.reason) || '-' }}</p>
                <div v-for="k in ['cost', 'speed', 'reliability']" :key="k" class="why-row">
                  <span>{{ t('batch.opt.comp.' + k) }}</span>
                  <div class="bar"><span :style="{ width: Math.round((row.components?.[k] ?? 0) * 100) + '%' }" /></div>
                  <span class="num">{{ fmt.number((row.components?.[k] ?? 0) * 100, 0) }}</span>
                </div>
                <div class="why-row"><span>{{ t('batch.opt.comp.score') }}</span><span /><span class="num strong">{{ fmt.number(row.score * 100, 0) }}</span></div>
              </div>
            </Popover>
          </template>
        </DataTable>
      </section>

      <div class="foot">
        <button class="btn btn-ghost" @click="emit('back')"><Icon name="chevron-left" :size="14" /> {{ t('batch.opt.back') }}</button>
        <div class="foot-r">
          <span class="sum num">{{ fmt.money(totals.totals.ai.cost) }} · {{ t('batch.scope.count', { n: assignments.length }) }}</span>
          <button class="btn btn-primary" :disabled="!assignments.length" @click="emit('next')">{{ t('batch.opt.next') }} <Icon name="arrow" :size="14" /></button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.opt { display: flex; flex-direction: column; gap: 14px; }
.run { padding: 22px; display: flex; flex-direction: column; gap: 12px; }
.run-head { display: flex; gap: 12px; align-items: center; }
.ai-dot { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.sk { margin-top: 6px; }
.strip { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 18px; flex-wrap: wrap; }
.strip-l { display: flex; gap: 12px; align-items: center; min-width: 0; }
.strip-r { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.slider { width: 240px; max-width: 100%; }
.grid-top { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; }
.cmp-body { display: grid; grid-template-columns: 1fr 1fr; }
.cmp-col { padding: 16px 20px; display: flex; flex-direction: column; gap: 2px; }
.cmp-col + .cmp-col { border-left: 1px solid var(--line-1); }
.cmp-col.ai { background: linear-gradient(180deg, var(--accent-soft), transparent 80%); }
.cmp-h { font-weight: 600; display: flex; align-items: center; gap: 5px; }
.cmp-col.ai .cmp-h { color: var(--accent-ink); }
.cmp-d { font-size: 12px; color: var(--ink-3); margin-bottom: 10px; min-height: 30px; }
.cmp-k { font-size: 12px; color: var(--ink-3); margin-top: 6px; }
.cmp-v { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.cmp-v2 { font-size: 15px; font-weight: 600; }
.save { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line-1); background: oklch(0.96 0.05 155); color: oklch(0.38 0.1 155); border-radius: 0 0 var(--r-lg) var(--r-lg); font-size: 13.5px; flex-wrap: wrap; }
.save strong { margin-left: auto; font-size: 15px; }
.save.neg { background: oklch(0.96 0.06 80); color: oklch(0.42 0.1 70); }
.hubs { display: flex; flex-direction: column; gap: 14px; padding: 16px 20px; }
.hub { display: flex; flex-direction: column; gap: 6px; }
.hub-top { display: flex; justify-content: space-between; align-items: baseline; }
.hub-code { font-family: var(--font-display); font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.hub-n { font-family: var(--font-display); font-size: 22px; font-weight: 700; }
.hub-name { font-size: 12px; color: var(--ink-3); }
.hub-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-3); gap: 8px; flex-wrap: wrap; }
.table-scroll { overflow-x: auto; }
.r { text-align: right; }
.share { display: flex; align-items: center; gap: 8px; min-width: 140px; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: var(--bg-2); overflow: hidden; min-width: 50px; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
.fb { padding: 12px 16px 4px; }
.oid { display: flex; align-items: center; gap: 8px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.muted { color: var(--ink-3); font-size: 12px; }
.small { font-size: 12.5px; }
.strong { font-weight: 600; }
.pos { color: var(--success); font-weight: 500; }
.neg-t { color: var(--danger); }
.svc { display: flex; align-items: center; gap: 6px; }
.sel { height: 32px; font-size: 12.5px; padding: 0 8px; flex: 1; min-width: 200px; max-width: 340px; }
.num { white-space: nowrap; }
.chg { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.x { display: inline-flex; color: inherit; }
.why { padding: 12px 14px; font-size: 13px; }
.why-t { font-weight: 600; display: flex; align-items: center; gap: 5px; color: var(--accent-ink); }
.why p { margin: 6px 0 10px; color: var(--ink-2); line-height: 1.45; }
.why-row { display: grid; grid-template-columns: 90px 1fr 32px; gap: 8px; align-items: center; font-size: 12px; color: var(--ink-3); margin-top: 4px; }
.why-row .num { text-align: right; color: var(--ink-1); }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.foot-r { display: flex; align-items: center; gap: 12px; }
.sum { font-size: 13px; color: var(--ink-2); }
@media (max-width: 1100px) { .grid-top { grid-template-columns: 1fr; } }
@media (max-width: 1024px) { .hide-md { display: none; } }
@media (max-width: 640px) { .cmp-body { grid-template-columns: 1fr; } .cmp-col + .cmp-col { border-left: 0; border-top: 1px solid var(--line-1); } .sel { min-width: 0; width: 100%; } .svc { flex-wrap: wrap; } }
</style>
