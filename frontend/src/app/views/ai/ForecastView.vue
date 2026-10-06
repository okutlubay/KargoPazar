<script setup>
// Demand forecast (spec 6.2): breakdown selector, main chart with bands / today / holiday shading,
// decomposition, metrics + sufficiency gauge, 12 week table, live insights, retrain, CSV, pricing link.
import { ref, computed, onMounted, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import Toggle from '../../components/Toggle.vue'
import Spinner from '../../components/Spinner.vue'
import AiInsightCard from '../../components/AiInsightCard.vue'
import LineChart from '../../components/charts/LineChart.vue'
import BarChart from '../../components/charts/BarChart.vue'
import GaugeScore from '../../components/charts/GaugeScore.vue'
import TrainingModal from '../../components/ai/TrainingModal.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listBreakdowns, getForecast, retrain, downloadCsv, stockoutInsight } from '../../api/forecast.js'
import StockoutInsight from '../../components/ai/StockoutInsight.vue'

const { t, tx, fmt, locale } = useI18n()
const router = useRouter()
const canManage = computed(() => can('ai.manage'))

const breakdowns = listBreakdowns()
const group = ref('total')
const key = ref('total')
const groupOptions = computed(() => breakdowns.map(b => ({ value: b.group, label: tx(b.label) })))
const items = computed(() => breakdowns.find(b => b.group === group.value)?.items || [])
const itemLabel = it => (typeof it.label === 'string' ? (group.value === 'byRegion' ? t(`aiModel.forecast.regions.${it.label}`) : it.label) : tx(it.label))
const itemOptions = computed(() => items.value.map(it => ({ value: it.key, label: itemLabel(it) })))
watch(group, g => { key.value = items.value[0]?.key || 'total' })

const loading = ref(true)
const data = ref(null)
const showFitted = ref(false)
let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  try {
    const r = await getForecast(key.value)
    if (my === seq) data.value = r
  } catch (e) {
    toast.error(t('aiForecastUi.loadFailed'))
  } finally {
    if (my === seq) loading.value = false
  }
}
watch(key, load)
onMounted(load)

// US hub stock-out insight (forecast x on-hand + inbound first-mile stock), per hub
const stockPlans = ref([])
const stockHubs = computed(() => (key.value === 'byHub.LA01' ? ['LA01'] : key.value === 'byHub.NJ01' ? ['NJ01'] : ['NJ01', 'LA01']))
async function loadStock() {
  try { stockPlans.value = await Promise.all(stockHubs.value.map(h => stockoutInsight(h))) } catch { stockPlans.value = [] }
}
watch(stockHubs, loadStock)
onMounted(loadStock)

const seriesLabel = computed(() => (data.value ? (typeof data.value.label === 'string' ? data.value.label : tx(data.value.label)) : ''))

// ------------------------------------------------------------------ chart
const lastHist = computed(() => data.value?.history?.[data.value.history.length - 1])
const chartSeries = computed(() => {
  const d = data.value
  if (!d) return []
  const last = lastHist.value
  const out = [{ key: 'act', label: t('aiForecastUi.chart.actual'), color: 'var(--ink-1)', points: d.history.map(p => ({ x: p.weekStart, y: p.y })), width: 1.8 }]
  if (showFitted.value) out.push({ key: 'fit', label: t('aiForecastUi.chart.fitted'), color: 'var(--ink-4)', dashed: true, width: 1.2, points: d.fitted.map(p => ({ x: p.weekStart, y: p.yhat })) })
  out.push({ key: 'fc', label: t('aiForecastUi.chart.forecast'), color: 'var(--accent)', dashed: true, width: 2.2, points: [{ x: last.weekStart, y: last.y }, ...d.forecast.map(p => ({ x: p.weekStart, y: p.yhat }))] })
  return out
})
const chartBands = computed(() => {
  const d = data.value
  if (!d) return []
  const last = lastHist.value
  const start = { x: last.weekStart, lo: last.y, hi: last.y }
  return [
    { key: 'b95', label: t('aiForecastUi.chart.band95'), color: 'var(--accent)', opacity: 0.1, points: [start, ...d.forecast.map(p => ({ x: p.weekStart, lo: p.lo95, hi: p.hi95 }))] },
    { key: 'b80', label: t('aiForecastUi.chart.band80'), color: 'var(--accent)', opacity: 0.2, points: [start, ...d.forecast.map(p => ({ x: p.weekStart, lo: p.lo80, hi: p.hi80 }))] },
  ]
})
const markers = computed(() => [{ x: new Date().toISOString(), label: t('aiForecastUi.chart.today'), color: 'var(--danger)' }])
// holiday season: last week of November + first two weeks of December, every year in range
const shaded = computed(() => {
  const d = data.value
  if (!d) return []
  const first = new Date(d.history[0].weekStart)
  const lastF = new Date(d.forecast[d.forecast.length - 1].weekStart)
  const out = []
  for (let y = first.getFullYear(); y <= lastF.getFullYear(); y++) {
    const to = new Date(y, 11, 15)
    out.push({ key: 'h' + y, from: new Date(y, 10, 22).toISOString(), to: to.toISOString(), label: to <= lastF ? t('aiForecastUi.chart.holiday') : '' })
  }
  return out
})
const pointMap = computed(() => {
  const m = new Map()
  if (!data.value) return m
  for (const p of data.value.history) m.set(new Date(p.weekStart).toDateString(), { actual: p.y })
  for (const p of data.value.forecast) m.set(new Date(p.weekStart).toDateString(), { ...(m.get(new Date(p.weekStart).toDateString()) || {}), f: p })
  return m
})
function tipInfo(x) {
  const d = x instanceof Date ? x : new Date(x)
  return pointMap.value.get(d.toDateString()) || null
}

// ------------------------------------------------------------------ decomposition
const trendSeries = computed(() => data.value ? [
  { key: 'val', label: t('aiForecastUi.chart.actual'), color: 'var(--ink-4)', width: 1, points: data.value.history.map(p => ({ x: p.weekStart, y: p.y })) },
  { key: 'trend', label: t('aiForecastUi.decomposition.trend'), color: 'var(--accent)', width: 2, points: data.value.decomposition.trend.map(p => ({ x: p.weekStart, y: p.value })) },
] : [])
const monthCats = computed(() => Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleString(locale.value === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' })))
const seasonalSeries = computed(() => data.value ? [{ key: 'si', label: t('aiForecastUi.decomposition.seasonality'), color: 'var(--accent)', values: data.value.decomposition.seasonalIndex }] : [])
const residCats = computed(() => (data.value?.decomposition.residuals || []).map(r => fmt.shortDate(r.weekStart)))
const residSeries = computed(() => data.value ? [{ key: 'r', label: t('aiForecastUi.decomposition.residuals'), color: 'var(--warning)', values: data.value.decomposition.residuals.map(r => r.value) }] : [])
const backtestSeries = computed(() => data.value ? [
  { key: 'y', label: t('aiForecastUi.metrics.backtestActual'), color: 'var(--ink-1)', points: data.value.metrics.backtest.map(p => ({ x: p.weekStart, y: p.y })) },
  { key: 'yhat', label: t('aiForecastUi.metrics.backtestPredicted'), color: 'var(--accent)', dashed: true, points: data.value.metrics.backtest.map(p => ({ x: p.weekStart, y: p.yhat })) },
] : [])

const pctSigned = v => (v > 0 ? '+' : '') + fmt.percent(v, 1)
const insightTone = s => (s === 'warning' || s === 'danger' ? 'accent' : 'plain')

// ------------------------------------------------------------------ actions
const downloading = ref(false)
async function csv() {
  downloading.value = true
  try {
    const r = await downloadCsv(key.value)
    toast.success(t('aiForecastUi.csvDone', { file: r.filename }))
  } catch { toast.error(t('common.errorGeneric')) } finally { downloading.value = false }
}
function goPricing() { router.push({ name: 'ai-pricing' }) }
function openInsight(ins) { if (ins.link) router.push(ins.link) }

const trainOpen = ref(false)
const train = reactive({ running: false, done: false, pct: 0, step: null, steps: [], result: null, from: '' })
function openTrain() {
  Object.assign(train, { running: false, done: false, pct: 0, step: null, steps: [], result: null, from: data.value ? `forecast ${data.value.meta.version}` : '' })
  trainOpen.value = true
}
async function startTrain() {
  if (train.running || train.done) return
  train.running = true
  try {
    const res = await retrain((pct, step) => {
      train.pct = pct
      train.step = step
      train.steps = [...train.steps, step]
    })
    train.result = res
    train.done = true
    train.pct = 100
    toast.success(t('aiForecastUi.train.success', { v: res.version }), { action: { label: t('aiForecastUi.toPricing'), onClick: goPricing } })
    await load()
    loadStock()
  } catch (e) {
    toast.error(e?.code === 'FORBIDDEN' ? t('aiHub.training.noPermission') : t('aiForecastUi.train.failed'))
  } finally { train.running = false }
}
const STEP_KEYS = ['load', 'ma', 'trend', 'seasonal', 'holiday', 'residuals', 'backtest', 'sufficiency', 'publish']
const stepDone = k => train.steps.some(s => s.key === k)
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.aiForecast')" :subtitle="t('aiForecastUi.subtitle')" badge="AI">
      <template #actions>
        <button class="btn btn-ghost btn-sm" :disabled="downloading || loading" @click="csv"><Spinner v-if="downloading" :size="14" /><Icon v-else name="download" :size="14" />{{ t('aiForecastUi.csv') }}</button>
        <button class="btn btn-ghost btn-sm" @click="goPricing"><Icon name="dollar" :size="14" />{{ t('aiForecastUi.toPricing') }}</button>
        <button class="btn btn-accent btn-sm" :disabled="!canManage || !data" :title="canManage ? '' : t('aiHub.training.noPermission')" @click="openTrain"><Icon name="refresh" :size="14" />{{ t('aiForecastUi.retrain') }}</button>
      </template>
    </PageHeader>

    <div class="selector panel">
      <div class="sel-row">
        <span class="sel-l">{{ t('aiForecastUi.breakdown') }}</span>
        <SegmentedControl v-model="group" :options="groupOptions" size="sm" :aria-label="t('aiForecastUi.breakdown')" />
      </div>
      <div v-if="group !== 'total'" class="sel-row">
        <span class="sel-l">{{ t('aiForecastUi.series') }}</span>
        <SegmentedControl v-model="key" :options="itemOptions" size="sm" :aria-label="t('aiForecastUi.series')" />
      </div>
      <div v-if="data" class="meta">
        <span><em>{{ t('aiForecastUi.meta.version') }}</em><b class="mono">forecast {{ data.meta.version }}</b></span>
        <span><em>{{ t('aiForecastUi.meta.trained') }}</em><b :title="fmt.dateTime(data.meta.trainedAt)">{{ fmt.relative(data.meta.trainedAt) }}</b></span>
        <span><em>{{ t('aiForecastUi.meta.weeks') }}</em><b>{{ t('aiForecastUi.meta.weeksValue', { n: data.meta.trainWeeks }) }}</b></span>
        <span><em>{{ t('aiForecastUi.meta.pending') }}</em><b>{{ t('aiForecastUi.meta.pendingValue', { n: data.meta.pendingShipments, w: data.meta.pendingWeeks }) }}</b></span>
      </div>
    </div>

    <Card :title="t('aiForecastUi.chart.title') + (seriesLabel ? ' · ' + seriesLabel : '')" :subtitle="t('aiForecastUi.chart.subtitle')" icon="chart" class="blk">
      <template #actions><Toggle v-model="showFitted" size="sm" :label="t('aiForecastUi.chart.showFitted')" /></template>
      <Skeleton v-if="loading && !data" variant="rect" :height="320" />
      <div v-else :class="{ dim: loading }">
        <LineChart :series="chartSeries" :bands="chartBands" :markers="markers" :shaded-ranges="shaded" :height="320" :y-format="v => fmt.number(v)">
          <template #tooltip="{ x }">
            <div class="tip">
              <div class="tip-t">{{ t('aiForecastUi.chart.tipWeek', { d: fmt.date(x) }) }}</div>
              <template v-if="tipInfo(x)">
                <div v-if="tipInfo(x).actual != null" class="tip-r"><span><i class="dot act" />{{ t('aiForecastUi.chart.tipActual') }}</span><b>{{ fmt.number(tipInfo(x).actual) }}</b></div>
                <template v-if="tipInfo(x).f">
                  <div class="tip-r"><span><i class="dot fc" />{{ t('aiForecastUi.chart.tipForecast') }}</span><b>{{ fmt.number(tipInfo(x).f.yhat, 1) }}</b></div>
                  <div class="tip-r sub"><span>{{ t('aiForecastUi.chart.tipLo') }}</span><span>{{ fmt.number(tipInfo(x).f.lo80, 1) }}</span></div>
                  <div class="tip-r sub"><span>{{ t('aiForecastUi.chart.tipHi') }}</span><span>{{ fmt.number(tipInfo(x).f.hi80, 1) }}</span></div>
                  <div class="tip-r sub"><span>{{ t('aiForecastUi.chart.tipLo95') }}</span><span>{{ fmt.number(tipInfo(x).f.lo95, 1) }}</span></div>
                  <div class="tip-r sub"><span>{{ t('aiForecastUi.chart.tipHi95') }}</span><span>{{ fmt.number(tipInfo(x).f.hi95, 1) }}</span></div>
                  <div v-if="tipInfo(x).f.holiday" class="tip-h">{{ t(`aiModel.forecast.holiday.${tipInfo(x).f.holiday}`) }}</div>
                </template>
              </template>
            </div>
          </template>
        </LineChart>
      </div>
    </Card>

    <div class="metrics blk">
      <div class="kpis">
        <KpiCard :label="t('aiForecastUi.metrics.mape')" :value="data ? fmt.percent(data.metrics.mape, 1) : ''" :hint="t('aiForecastUi.metrics.mapeHint', { n: data?.metrics.holdout ?? 8 })" :loading="!data" tone="accent" />
        <KpiCard :label="t('aiForecastUi.metrics.mae')" :value="data ? fmt.number(data.metrics.mae, 1) : ''" :hint="t('aiForecastUi.metrics.maeHint')" :loading="!data" />
        <KpiCard :label="t('aiForecastUi.metrics.next4')" :value="data ? fmt.number(data.summary.next4) : ''" :delta="data?.summary.changePct" :hint="data ? t('aiForecastUi.metrics.next4Hint', { n: fmt.number(data.summary.last4), pct: pctSigned(data.summary.changePct) }) : ''" :loading="!data" />
        <KpiCard :label="t('aiForecastUi.metrics.band')" :value="data ? '±' + fmt.percent(data.summary.bandPct, 1) : ''" :hint="data ? t('aiForecastUi.metrics.bandHint', { n: fmt.number(data.summary.band80) }) : ''" :loading="!data" />
      </div>
      <Card :title="t('aiForecastUi.metrics.sufficiency')" icon="target" class="suff">
        <Skeleton v-if="!data" variant="rect" :height="200" />
        <template v-else>
          <GaugeScore :value="data.sufficiency.score" :size="190" :label="`${data.sufficiency.months} / 24`" />
          <ul class="parts">
            <li v-for="p in data.sufficiency.parts" :key="p.key">
              <div class="pl"><span>{{ tx(p.label) }}</span><span class="num">{{ fmt.number(p.score, 1) }} / {{ p.max }}</span></div>
              <div class="pbar"><i :style="{ width: (p.score / p.max * 100) + '%' }" /></div>
              <div class="pd">{{ tx(p.detail) }}</div>
            </li>
          </ul>
          <p class="callout neutral stext"><Icon name="info" :size="14" /><span>{{ tx(data.sufficiency.text) }}</span></p>
        </template>
      </Card>
      <Card :title="t('aiForecastUi.metrics.backtest')" icon="check-circle" class="bt">
        <Skeleton v-if="!data" variant="rect" :height="200" />
        <LineChart v-else :series="backtestSeries" :height="200" :y-zero="false" dots :y-format="v => fmt.number(v)" />
      </Card>
    </div>

    <Card :title="t('aiForecastUi.decomposition.title')" :subtitle="t('aiForecastUi.decomposition.subtitle')" icon="layers" class="blk">
      <Skeleton v-if="!data" variant="rect" :height="180" />
      <div v-else class="decomp">
        <div>
          <div class="dh">{{ t('aiForecastUi.decomposition.trend') }}</div>
          <div class="dsub">{{ t('aiForecastUi.decomposition.trendHint', { s: fmt.number(data.decomposition.slope, 2) }) }}</div>
          <LineChart :series="trendSeries" :height="160" :legend="false" :y-format="v => fmt.number(v)" />
        </div>
        <div>
          <div class="dh">{{ t('aiForecastUi.decomposition.seasonality') }}</div>
          <div class="dsub">{{ t('aiForecastUi.decomposition.seasonalityHint') }}</div>
          <BarChart :categories="monthCats" :series="seasonalSeries" :height="160" :legend="false" :value-format="v => fmt.number(v, 2)" />
          <div class="hadj"><span>{{ t('aiForecastUi.decomposition.holidayAdj') }}:</span>
            <span v-for="(v, k) in data.decomposition.holidayAdj" :key="k" class="tag tag-warning">{{ t(`aiModel.forecast.holiday.${k}`) }} x{{ fmt.number(v, 2) }}</span>
          </div>
        </div>
        <div>
          <div class="dh">{{ t('aiForecastUi.decomposition.residuals') }}</div>
          <div class="dsub">{{ t('aiForecastUi.decomposition.residualsHint', { s: fmt.number(data.decomposition.sigma, 1) }) }}</div>
          <BarChart :categories="residCats" :series="residSeries" :height="160" :legend="false" :max-bar-width="6" :value-format="v => fmt.number(v, 1)" />
        </div>
      </div>
    </Card>

    <div class="grid-tab blk">
      <Card :title="t('aiForecastUi.table.title')" :subtitle="t('aiForecastUi.table.subtitle')" icon="list" padding="none">
        <Skeleton v-if="!data" variant="lines" :lines="10" class="pad" />
        <div v-else class="table-wrap">
          <table class="table-simple ftable">
            <thead><tr>
              <th>{{ t('aiForecastUi.table.week') }}</th><th class="r">{{ t('aiForecastUi.table.forecast') }}</th>
              <th class="r">{{ t('aiForecastUi.table.lo') }}</th><th class="r">{{ t('aiForecastUi.table.hi') }}</th>
              <th class="r hide-sm">{{ t('aiForecastUi.table.lo95') }}</th><th class="r hide-sm">{{ t('aiForecastUi.table.hi95') }}</th>
              <th class="r">{{ t('aiForecastUi.table.lastYear') }}</th><th class="r">{{ t('aiForecastUi.table.change') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="p in data.forecast" :key="p.weekStart" :class="{ hol: p.holiday }">
                <td class="wkc"><div class="wk">{{ fmt.date(p.weekStart) }}</div><div class="h">{{ t('aiForecastUi.table.horizon', { n: p.h }) }}<template v-if="p.holiday"> · <span class="hol-t">{{ t(`aiModel.forecast.holiday.${p.holiday}`) }}</span></template></div></td>
                <td class="r num"><b>{{ fmt.number(p.yhat, 1) }}</b></td>
                <td class="r num">{{ fmt.number(p.lo80, 1) }}</td><td class="r num">{{ fmt.number(p.hi80, 1) }}</td>
                <td class="r num hide-sm">{{ fmt.number(p.lo95, 1) }}</td><td class="r num hide-sm">{{ fmt.number(p.hi95, 1) }}</td>
                <td class="r num">{{ p.lastYear != null ? fmt.number(p.lastYear) : '-' }}</td>
                <td :class="['r', 'num', p.lastYear ? (p.yhat >= p.lastYear ? 'text-success' : 'text-danger') : '']">{{ p.lastYear ? pctSigned(p.yhat / p.lastYear - 1) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card :title="t('aiForecastUi.insights.title')" :subtitle="t('aiForecastUi.insights.subtitle')" icon="spark">
        <div v-if="!data" class="ins"><Skeleton v-for="i in 3" :key="i" variant="rect" :height="80" /></div>
        <div v-else class="ins">
          <StockoutInsight v-for="sp in stockPlans" :key="'stock-' + sp.hub" :plan="sp" compact :testid="'forecast-stockout-plan-' + sp.hub" />
          <AiInsightCard v-for="ins in data.insights" :key="ins.id" :title="t(`aiForecastUi.insightTitles.${ins.id}`)" :description="tx(ins)" compact
            :tone="insightTone(ins.severity)" :hide-action="!ins.link" :action-label="t('aiForecastUi.insights.open')" action-icon="arrow"
            :reason="[`${seriesLabel} · forecast ${data.meta.version}`, t('aiForecastUi.metrics.mape') + ' ' + fmt.percent(data.metrics.mape, 1)]" :reason-title="t('aiForecastUi.insights.reason')"
            @apply="openInsight(ins)" />
        </div>
      </Card>
    </div>

    <Card :title="t('aiForecastUi.activity')" icon="clock" class="blk">
      <ModelActivityLog module="forecast" :limit="6" />
    </Card>

    <TrainingModal v-model:open="trainOpen" :title="t('aiForecastUi.train.title')" :running="train.running" :done="train.done" :progress="train.pct"
      :step-label="train.step ? tx(train.step.label) : ''" :from-version="train.from" :to-version="train.result ? `forecast ${train.result.version}` : ''"
      :disabled="!canManage" :disabled-reason="t('aiHub.training.noPermission')" size="md" @start="startTrain">
      <template #intro>
        <p>{{ t('aiForecastUi.train.intro') }}</p>
        <p v-if="data" class="tag tag-accent">{{ t('aiForecastUi.train.pending', { n: data.meta.pendingShipments, w: data.meta.pendingWeeks }) }}</p>
      </template>
      <template #live>
        <ol class="steps">
          <li v-for="k in STEP_KEYS" :key="k" :class="{ done: stepDone(k), cur: train.running && !stepDone(k) && STEP_KEYS.find(x => !stepDone(x)) === k }">
            <Icon :name="stepDone(k) ? 'check-circle' : 'clock'" :size="14" />{{ t(`aiModel.forecast.steps.${k}`) }}
          </li>
        </ol>
      </template>
      <template #result>
        <table class="table-simple">
          <thead><tr><th>{{ t('aiHub.common.metric') }}</th><th class="r">{{ t('aiHub.common.before') }}</th><th class="r">{{ t('aiHub.common.after') }}</th></tr></thead>
          <tbody>
            <tr><td>MAPE</td><td class="r num">{{ fmt.percent(train.result.previousMetrics.mape, 1) }}</td><td class="r num"><b>{{ fmt.percent(train.result.metrics.mape, 1) }}</b></td></tr>
            <tr><td>MAE</td><td class="r num">{{ fmt.number(train.result.previousMetrics.mae, 1) }}</td><td class="r num"><b>{{ fmt.number(train.result.metrics.mae, 1) }}</b></td></tr>
            <tr><td>{{ t('aiForecastUi.metrics.sufficiency') }}</td><td class="r num">{{ train.result.previousMetrics.sufficiency }}</td><td class="r num"><b>{{ train.result.metrics.sufficiency }}</b></td></tr>
            <tr><td>{{ t('aiForecastUi.train.weeks') }}</td><td class="r num">{{ train.result.previousTrainWeeks }}</td><td class="r num"><b>{{ train.result.trainWeeks }}</b></td></tr>
          </tbody>
        </table>
        <div class="callout warn next"><Icon name="dollar" :size="14" /><span>{{ t('aiForecastUi.train.pricingHint') }}</span><button class="btn btn-link" @click="trainOpen = false; goPricing()">{{ t('aiForecastUi.toPricing') }}</button></div>
      </template>
    </TrainingModal>
  </div>
</template>

<style scoped>
.selector { padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.sel-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; overflow-x: auto; }
.sel-l { font-size: 12.5px; color: var(--ink-3); min-width: 72px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 13px; border-top: 1px solid var(--line-1); padding-top: 10px; }
.meta em { font-style: normal; color: var(--ink-3); margin-right: 6px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.blk { margin-bottom: 16px; }
.dim { opacity: .55; transition: opacity .15s; }
.tip { min-width: 190px; font-size: 12.5px; }
.tip-t { font-weight: 600; margin-bottom: 6px; }
.tip-r { display: flex; justify-content: space-between; gap: 14px; padding: 1px 0; }
.tip-r span { display: inline-flex; align-items: center; gap: 6px; }
.tip-r.sub { color: var(--ink-3); font-size: 12px; }
.tip-h { margin-top: 4px; color: oklch(0.5 0.12 70); font-weight: 500; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot.act { background: var(--ink-1); } .dot.fc { background: var(--accent); }
.metrics { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1200px) { .metrics { grid-template-columns: 1fr 1fr; } .kpis { grid-column: 1 / -1; } }
@media (max-width: 760px) { .metrics { grid-template-columns: 1fr; } }
.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.parts { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 8px; }
.pl { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--ink-2); }
.pbar { height: 6px; background: var(--bg-3); border-radius: 3px; overflow: hidden; margin: 3px 0; }
.pbar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
.pd { font-size: 11.5px; color: var(--ink-3); }
.stext { margin: 12px 0 0; font-size: 12.5px; }
.decomp { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
@media (max-width: 1000px) { .decomp { grid-template-columns: 1fr; } }
.dh { font-weight: 600; font-size: 13.5px; }
.dsub { font-size: 12px; color: var(--ink-3); margin-bottom: 6px; }
.hadj { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--ink-3); margin-top: 8px; }
.grid-tab { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1100px) { .grid-tab { grid-template-columns: 1fr; } }
.ftable td, .ftable th { padding: 8px 12px; }
.ftable tr.hol td { background: oklch(0.985 0.03 85); }
.wkc { white-space: nowrap; }
.wk { font-weight: 500; }
.hol-t { color: oklch(0.5 0.12 70); font-weight: 500; }
.h { font-size: 11.5px; color: var(--ink-3); }
.r { text-align: right; }
.pad { padding: 16px; }
.ins { display: flex; flex-direction: column; gap: 10px; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink-3); }
.steps li { display: flex; align-items: center; gap: 8px; }
.steps li.done { color: var(--ink-1); }
.steps li.done svg { color: var(--success); }
.steps li.cur { color: var(--accent-ink); font-weight: 500; }
.next { margin-top: 12px; align-items: center; flex-wrap: wrap; }
@media (max-width: 700px) { .hide-sm { display: none; } }
</style>
