<script setup>
// Address validation (spec 6.1): live metrics, confusion matrix, rules vs rules+ML, feature importance,
// test tool with samples, recent validations from every flow, retrain with a live loss curve.
import { ref, computed, onMounted, reactive } from 'vue'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar from '../../components/FilterBar.vue'
import ScoreBadge from '../../components/ScoreBadge.vue'
import Spinner from '../../components/Spinner.vue'
import AddressForm from '../../components/AddressForm.vue'
import BarChart from '../../components/charts/BarChart.vue'
import GaugeScore from '../../components/charts/GaugeScore.vue'
import LineChart from '../../components/charts/LineChart.vue'
import ConfusionMatrix from '../../components/ai/ConfusionMatrix.vue'
import ContributionBars from '../../components/ai/ContributionBars.vue'
import TrainingModal from '../../components/ai/TrainingModal.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { db } from '../../store/db.js'
import { addressMetrics, featureImportances, validateAddress, recentValidations, trainAddressModel, recordAddressFeedback } from '../../api/ai.js'

const { t, tx, fmt } = useI18n()
const canManage = computed(() => can('ai.manage'))

// ------------------------------------------------------------------ metrics
const loading = ref(true)
const metrics = ref(null)
const importances = ref([])
async function loadMetrics() {
  const [m, f] = await Promise.all([addressMetrics(), featureImportances()])
  metrics.value = m
  importances.value = f
}

const compareCats = computed(() => ['accuracy', 'precision', 'recall', 'f1'].map(k => ({ key: k, label: t(`aiAddress.metrics.${k}`).replace(/ \(.*\)$/, '') })))
const compareSeries = computed(() => metrics.value ? [
  { key: 'rules', label: t('aiAddress.compare.rules'), color: 'var(--ink-4)', values: ['accuracy', 'precision', 'recall', 'f1'].map(k => metrics.value.rulesOnly[k]) },
  { key: 'ml', label: t('aiAddress.compare.combined'), color: 'var(--accent)', values: ['accuracy', 'precision', 'recall', 'f1'].map(k => metrics.value.ml[k]) },
] : [])
const liftText = computed(() => {
  const m = metrics.value
  if (!m) return ''
  const d = m.ml.f1 - m.rulesOnly.f1
  if (Math.abs(d) < 0.0005) return t('aiAddress.compare.liftNone')
  return t('aiAddress.compare.lift', { from: fmt.number(m.rulesOnly.f1, 3), to: fmt.number(m.ml.f1, 3), delta: (d > 0 ? '+' : '') + fmt.number(d * 100, 1), n: Math.max(0, m.rulesOnly.confusion.fn - m.ml.confusion.fn) })
})
const featureItems = computed(() => importances.value.map(f => ({ key: f.feature, label: tx(f.label), value: f.weight })))

// ------------------------------------------------------------------ test tool
const blank = () => ({ name: '', company: '', line1: '', line2: '', city: '', state: '', zip: '', country: 'US', residential: true })
const form = ref(blank())
const carrier = ref('')
const validating = ref(false)
const result = ref(null)
const lastInput = ref(null)
const feedbackState = ref(null) // 'applied' | 'rejected'
const pending = ref(0)

const SAMPLES = [
  { key: 'missingUnit', addr: { name: 'Rachel Greer', line1: '484 Market St', line2: '', city: 'San Diego', state: 'CA', zip: '92101' } },
  { key: 'zipMismatch', addr: { name: 'Siobhan Nguyen', line1: '4667 Tremont St', line2: 'Apt 11F', city: 'Boston', state: 'MA', zip: '02141' } },
  { key: 'typo', addr: { name: 'Emily Castillo', line1: '3624 Trypn St', line2: '', city: 'Charlotte', state: 'NC', zip: '28204' } },
  { key: 'poBox', addr: { name: 'Bridget Diaz', line1: 'P.O. Box 4717', line2: '', city: 'Montclair', state: 'NJ', zip: '07043' }, carrier: 'UPS' },
  { key: 'clean', addr: { name: 'Santiago Nakamura', line1: '841 Pennsylvania Ave', line2: 'Unit 16', city: 'Washington', state: 'DC', zip: '20005' } },
  { key: 'noStreet', addr: { name: 'Anika Iverson', line1: 'Shattuck Ave', line2: '', city: 'Berkeley', state: 'CA', zip: '94709' } },
]
const CARRIERS = [
  { value: '', label: () => t('aiAddress.test.carrierAny') },
  { value: 'UPS', label: () => 'UPS' }, { value: 'FDX', label: () => 'FedEx' }, { value: 'USPS', label: () => 'USPS' },
  { value: 'DHLE', label: () => 'DHL eCommerce' }, { value: 'ONT', label: () => 'OnTrac' }, { value: 'LSO', label: () => 'LSO' },
]

function useSample(s) {
  form.value = { ...blank(), ...s.addr }
  carrier.value = s.carrier || ''
  run()
}

async function run() {
  const a = form.value
  if (!String(a.line1 || '').trim() && !String(a.zip || '').trim()) { toast.warning(t('aiAddress.test.needLine')); return }
  validating.value = true
  feedbackState.value = null
  try {
    const input = { ...a }
    result.value = await validateAddress(input, { source: 'test_tool', carrier: carrier.value || undefined })
    lastInput.value = input
    loadRecent(true)
  } catch (e) {
    toast.error(t('aiAddress.test.failed'))
  } finally {
    validating.value = false
  }
}
function clearTool() { form.value = blank(); carrier.value = ''; result.value = null; feedbackState.value = null }

const scoreItems = computed(() => (result.value?.contributions || []).slice(0, 9).map(c => ({ key: c.feature, label: tx(c.label), value: c.contribution })))
const suggestion = computed(() => result.value?.suggestion || null)
function changed(field) { return suggestion.value?.changedFields?.includes(field) }
const suggestionLines = computed(() => {
  const d = suggestion.value?.display
  if (!d) return []
  return [
    { f: 'line1', v: d.line1 }, { f: 'line2', v: d.line2 },
    { f: 'city', v: [d.city, d.state].filter(Boolean).join(', ') , fields: ['city', 'state'] }, { f: 'zip', v: d.zip },
  ].filter(x => x.v)
})
const lineChanged = l => (l.fields || [l.f]).some(changed)

async function applySuggestion() {
  const s = suggestion.value
  if (!s) return
  const before = { ...lastInput.value }
  const after = { ...before, ...(s.patch || {}) }
  try {
    const r = await recordAddressFeedback({ before, after, accepted: true, issueType: result.value.issueType, carrier: carrier.value || null, source: 'test_tool' })
    pending.value = r.pending
    feedbackState.value = 'applied'
    form.value = { ...form.value, ...(s.patch || {}) }
    if (s.carrier) carrier.value = s.carrier
    toast.success(t('aiAddress.test.applied'))
    await run()
    feedbackState.value = 'applied'
  } catch (e) { toast.error(t('common.errorGeneric')) }
}
async function rejectSuggestion() {
  const s = suggestion.value
  if (!s) return
  try {
    const r = await recordAddressFeedback({ before: { ...lastInput.value }, after: null, accepted: false, issueType: result.value.issueType, carrier: carrier.value || null, source: 'test_tool' })
    pending.value = r.pending
    feedbackState.value = 'rejected'
    toast.info(t('aiAddress.test.rejected'))
  } catch (e) { toast.error(t('common.errorGeneric')) }
}
const issueIcon = sev => (sev === 'error' ? 'x-circle' : sev === 'warning' ? 'alert' : 'info')

// ------------------------------------------------------------------ recent validations
const recentLoading = ref(true)
const recent = ref([])
const search = ref('')
const filters = ref({ source: [] })
async function loadRecent(silent = false) {
  if (!silent) recentLoading.value = true
  try {
    const live = await recentValidations({ limit: 200 })
    // order imports scored before this session (addressCheck stored on the order)
    const seen = new Set(live.map(v => v.orderId).filter(Boolean))
    const hist = db.all('orders').filter(o => o.addressCheck?.checkedAt && !seen.has(o.id)).map(o => ({
      id: 'OV-' + o.id, at: o.addressCheck.checkedAt, source: o.channel === 'manual' ? 'panel' : o.channel === 'api' ? 'api' : 'order_import', orderId: o.id,
      address: o.shipTo, score: o.addressCheck.score, issueType: o.addressCheck.issueType ?? o.addressCheck.issues?.[0]?.code ?? null, suggested: !!o.addressCheck.suggestion, modelVersion: o.addressCheck.modelVersion || null,
    }))
    recent.value = [...live, ...hist].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  } finally { recentLoading.value = false }
}
const sourceOptions = computed(() => {
  const counts = {}
  for (const r of recent.value) counts[r.source] = (counts[r.source] || 0) + 1
  return Object.keys(counts).map(s => ({ value: s, label: t(`aiAddress.sources.${s}`), count: counts[s] }))
})
const chips = computed(() => [{ key: 'source', label: t('aiAddress.recent.source'), options: sourceOptions.value }])
const addrLine = a => a ? [a.line1, a.line2, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '-'
const filteredRecent = computed(() => {
  const q = search.value.trim().toLowerCase()
  const src = filters.value.source || []
  return recent.value.filter(r => (!src.length || src.includes(r.source)) && (!q || addrLine(r.address).toLowerCase().includes(q) || String(r.orderId || '').toLowerCase().includes(q) || String(r.address?.name || '').toLowerCase().includes(q)))
})
const hasFilters = computed(() => !!search.value.trim() || (filters.value.source || []).length > 0)
function clearFilters() { search.value = ''; filters.value = { source: [] } }
const cols = computed(() => [
  { key: 'at', label: t('aiAddress.recent.cols.at'), sortable: true, width: 130, nowrap: true },
  { key: 'source', label: t('aiAddress.recent.cols.source'), sortable: true, width: 150 },
  { key: 'orderId', label: t('aiAddress.recent.cols.order'), sortable: true, width: 110, hideBelow: 'md' },
  { key: 'address', label: t('aiAddress.recent.cols.address'), sortValue: r => addrLine(r.address) },
  { key: 'score', label: t('aiAddress.recent.cols.score'), sortable: true, align: 'right', width: 80 },
  { key: 'issueType', label: t('aiAddress.recent.cols.issue'), sortable: true, hideBelow: 'md' },
  { key: 'suggested', label: t('aiAddress.recent.cols.suggested'), align: 'center', width: 90, hideBelow: 'lg' },
  { key: 'modelVersion', label: t('aiAddress.recent.cols.version'), width: 120, hideBelow: 'lg' },
])

// ------------------------------------------------------------------ retrain
const trainOpen = ref(false)
const train = reactive({ running: false, done: false, pct: 0, iter: 0, points: [], result: null, from: '' })
function openTrain() {
  Object.assign(train, { running: false, done: false, pct: 0, iter: 0, points: [], result: null, from: metrics.value?.label || '' })
  trainOpen.value = true
}
async function startTrain() {
  if (train.running || train.done) return
  train.running = true
  train.from = metrics.value?.label || ''
  try {
    const res = await trainAddressModel((pct, p) => {
      train.pct = pct
      train.iter = p?.iter ?? train.iter
      if (p?.points) train.points = p.points.slice()
    })
    train.result = res
    train.points = res.lossCurve || train.points
    train.pct = 100
    train.done = true
    toast.success(t('aiAddress.train.success', { v: res.label }))
    await loadMetrics()
    pending.value = 0
  } catch (e) {
    toast.error(e?.code === 'FORBIDDEN' ? t('aiHub.training.noPermission') : t('aiAddress.train.failed'))
  } finally { train.running = false }
}
const lossSeries = computed(() => [
  { key: 'train', label: t('aiAddress.train.trainLoss'), color: 'var(--accent)', points: train.points.map(p => ({ x: p.iter, y: p.loss })) },
  { key: 'test', label: t('aiAddress.train.testLoss'), color: 'var(--warning)', dashed: true, points: train.points.map(p => ({ x: p.iter, y: p.testLoss })) },
])
const deltaRows = computed(() => {
  const r = train.result
  if (!r) return []
  return ['accuracy', 'precision', 'recall', 'f1'].map(k => ({ k, before: r.previousMetrics.ml[k], after: r.metrics.ml[k], delta: r.delta[k] }))
})

onMounted(async () => {
  try { await loadMetrics() } catch { toast.error(t('common.errorGeneric')) } finally { loading.value = false }
  loadRecent()
  pending.value = metrics.value?.pendingFeedback ?? 0
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.aiAddress')" :subtitle="t('aiAddress.subtitle')" badge="AI">
      <template #actions>
        <button class="btn btn-accent btn-sm" :disabled="loading || !canManage" :title="canManage ? '' : t('aiHub.training.noPermission')" @click="openTrain">
          <Icon name="refresh" :size="14" />{{ t('aiAddress.retrain') }}
        </button>
      </template>
    </PageHeader>

    <div class="meta panel">
      <template v-if="metrics">
        <div><span class="ml">{{ t('aiAddress.meta.version') }}</span><span class="mv mono">{{ metrics.label }}</span></div>
        <div><span class="ml">{{ t('aiAddress.meta.trained') }}</span><span class="mv" :title="fmt.dateTime(metrics.lastTrainedAt)">{{ fmt.relative(metrics.lastTrainedAt) }}</span></div>
        <div><span class="ml">{{ t('aiAddress.meta.split') }}</span><span class="mv num">{{ t('aiAddress.meta.splitValue', { train: metrics.trainSize, test: metrics.testSize }) }}</span></div>
        <div><span class="ml">{{ t('aiAddress.meta.features') }}</span><span class="mv num">{{ metrics.featureCount }}</span></div>
        <div><span class="ml">{{ t('aiAddress.meta.feedback') }}</span><span class="mv num">{{ pending }}</span></div>
        <div class="algo">{{ t('aiAddress.meta.algo', { iter: metrics.training.iterations, lr: metrics.training.learningRate, l2: metrics.training.l2 }) }}</div>
      </template>
      <Skeleton v-else variant="lines" :lines="1" />
    </div>

    <div class="grid-kpi5">
      <KpiCard :label="t('aiAddress.metrics.accuracy')" :value="metrics ? fmt.percent(metrics.ml.accuracy, 1) : ''" :hint="t('aiAddress.metrics.accuracyHint')" :loading="loading" />
      <KpiCard :label="t('aiAddress.metrics.precision')" :value="metrics ? fmt.percent(metrics.ml.precision, 1) : ''" :hint="t('aiAddress.metrics.precisionHint')" :loading="loading" />
      <KpiCard :label="t('aiAddress.metrics.recall')" :value="metrics ? fmt.percent(metrics.ml.recall, 1) : ''" :hint="t('aiAddress.metrics.recallHint')" :loading="loading" />
      <KpiCard :label="t('aiAddress.metrics.f1')" :value="metrics ? fmt.number(metrics.ml.f1, 3) : ''" :hint="t('aiAddress.metrics.f1Hint')" :loading="loading" tone="accent" />
      <KpiCard :label="t('aiAddress.metrics.sizes')" :value="metrics ? `${metrics.trainSize} / ${metrics.testSize}` : ''" :hint="metrics ? t('aiAddress.metrics.sizesHint', { n: metrics.datasetSize, p: Math.round(metrics.dataset.problems / metrics.dataset.total * 100) }) : ''" :loading="loading" />
    </div>

    <div class="grid-2 blk">
      <Card :title="t('aiHub.confusion.title')" :subtitle="metrics ? t('aiAddress.confusion.caption', { n: metrics.testSize }) : ''" icon="layers">
        <Skeleton v-if="!metrics" variant="rect" :height="180" />
        <ConfusionMatrix v-else v-bind="metrics.ml.confusion" :positive-label="t('aiAddress.confusion.problem')" :negative-label="t('aiAddress.confusion.ok')" />
        <p v-if="metrics" class="note">{{ t('aiAddress.metrics.positive', { t: metrics.threshold }) }}</p>
      </Card>
      <Card :title="t('aiAddress.compare.title')" :subtitle="t('aiAddress.compare.subtitle')" icon="chart">
        <Skeleton v-if="!metrics" variant="rect" :height="200" />
        <template v-else>
          <BarChart :categories="compareCats" :series="compareSeries" :height="200" :value-format="v => fmt.number(v, 3)" :axis-format="v => fmt.number(v, 1)" show-values />
          <div class="callout lift"><Icon name="spark" :size="15" /><span>{{ liftText }}</span></div>
        </template>
      </Card>
    </div>

    <Card :title="t('aiAddress.features.title')" :subtitle="t('aiAddress.features.subtitle')" icon="bar" class="blk">
      <Skeleton v-if="loading" variant="lines" :lines="8" />
      <template v-else>
        <div class="flegend"><span><i class="sw ok" />{{ t('aiAddress.features.deliverable') }}</span><span><i class="sw bad" />{{ t('aiAddress.features.problem') }}</span></div>
        <ContributionBars :items="featureItems" :format="v => (v > 0 ? '+' : '') + fmt.number(v, 3)" />
      </template>
    </Card>

    <Card :title="t('aiAddress.test.title')" :subtitle="t('aiAddress.test.subtitle')" icon="flask" class="blk">
      <div class="tool">
        <div class="tool-left">
          <div class="samples">
            <span class="sl">{{ t('aiAddress.test.samples') }}</span>
            <div class="sbtns">
              <button v-for="s in SAMPLES" :key="s.key" class="btn btn-ghost btn-xs" :data-sample="s.key" @click="useSample(s)">{{ t(`aiAddress.test.sample.${s.key}`) }}</button>
            </div>
          </div>
          <AddressForm v-model="form" :show-phone="false" :show-email="false" :show-residential="false" />
          <div class="tool-row">
            <label class="clab" for="addr-carrier">{{ t('aiAddress.test.carrier') }}</label>
            <select id="addr-carrier" v-model="carrier" class="select">
              <option v-for="c in CARRIERS" :key="c.value" :value="c.value">{{ c.label() }}</option>
            </select>
          </div>
          <div class="tool-actions">
            <button class="btn btn-ghost btn-sm" :disabled="validating" @click="clearTool">{{ t('aiAddress.test.clear') }}</button>
            <button class="btn btn-accent btn-sm" data-action="validate" :disabled="validating" @click="run">
              <Spinner v-if="validating" :size="14" /><Icon v-else name="check-circle" :size="14" />{{ validating ? t('aiAddress.test.validating') : t('aiAddress.test.validate') }}
            </button>
          </div>
        </div>
        <div class="tool-right">
          <div v-if="validating && !result" class="res-loading"><Skeleton variant="circle" :width="140" :height="80" /><Skeleton variant="lines" :lines="6" /></div>
          <EmptyState v-else-if="!result" icon="pin" :title="t('aiAddress.test.empty')" :description="t('aiAddress.test.emptyDesc')" compact />
          <div v-else :class="['res', { dim: validating }]">
            <div class="res-top">
              <GaugeScore :value="result.score" :label="t('aiAddress.test.score')" :size="180" />
              <div class="res-meta">
                <ScoreBadge :score="result.score" show-label size="lg" />
                <div class="rm"><span>{{ t('aiAddress.test.residential') }}</span><b>{{ result.residential?.value ? t('aiAddress.test.residentialYes') : t('aiAddress.test.residentialNo') }}</b></div>
                <div class="rm sub">{{ tx(result.residential?.reason) }}</div>
                <div class="rm"><span class="tag" :class="result.mlApplied ? 'tag-accent' : ''">{{ result.mlApplied ? t('aiAddress.test.mlApplied') : t('aiAddress.test.rulesOnly') }}</span><span class="mono ver">{{ result.modelVersion }}</span></div>
              </div>
            </div>

            <div class="sect">
              <div class="sh">{{ t('aiAddress.test.issues') }}</div>
              <div v-if="!result.issues.filter(i => i.severity !== 'info').length && !result.issues.length" class="ok-line"><Icon name="check-circle" :size="14" />{{ t('aiAddress.test.noIssues') }}</div>
              <ul v-else class="issues">
                <li v-for="(i, idx) in result.issues" :key="idx" :class="i.severity">
                  <Icon :name="issueIcon(i.severity)" :size="14" />
                  <span class="it">{{ tx(i.label) }}</span>
                  <span class="tag src">{{ i.source === 'ml' ? t('aiAddress.test.sourceMl') : t('aiAddress.test.sourceRule') }}</span>
                  <span v-if="i.impact" class="imp num">{{ t('aiAddress.test.impact', { n: i.impact }) }}</span>
                </li>
              </ul>
              <div v-if="result.carrierAdvice" class="callout warn adv"><Icon name="truck" :size="14" /><span>{{ tx(result.carrierAdvice.label) }}</span></div>
            </div>

            <div class="sect">
              <div class="sh">{{ t('aiAddress.test.suggestion') }}</div>
              <div v-if="!suggestion" class="muted">{{ t('aiAddress.test.noSuggestion') }}</div>
              <div v-else class="sugg">
                <div v-if="suggestion.carrier && !suggestion.changedFields?.length" class="sugg-addr">{{ t('aiAddress.test.carrierSuggestion', { carrier: suggestion.carrier, service: suggestion.service === 'GA' ? 'Ground Advantage' : suggestion.service }) }}</div>
                <div v-else class="sugg-addr">
                  <div v-for="l in suggestionLines" :key="l.f" :class="{ ch: lineChanged(l) }">{{ l.v }}</div>
                </div>
                <div class="sugg-meta">
                  <span v-if="suggestion.score != null">{{ t('aiAddress.test.suggestionScore', { s: suggestion.score }) }}</span>
                  <span>{{ t('aiAddress.test.suggestionSource', { src: (suggestion.sources || [suggestion.source]).map(s => t(`aiAddress.suggestionSources.${s}`)).join(', ') }) }}</span>
                  <span v-if="suggestion.confidence != null">{{ t('aiAddress.test.confidence', { p: fmt.percent(suggestion.confidence, 0) }) }}</span>
                </div>
                <div class="sugg-actions">
                  <button class="btn btn-accent btn-sm" data-action="apply" :disabled="!!feedbackState || validating" @click="applySuggestion"><Icon name="wand" :size="14" />{{ t('aiAddress.test.apply') }}</button>
                  <button class="btn btn-ghost btn-sm" :disabled="!!feedbackState || validating" @click="rejectSuggestion">{{ t('aiAddress.test.reject') }}</button>
                </div>
              </div>
              <div v-if="feedbackState && pending" class="field-hint">{{ t('aiAddress.test.pendingInfo', { n: pending }) }}</div>
            </div>

            <div class="sect">
              <div class="sh">{{ t('aiAddress.test.contributions') }}</div>
              <div class="muted small">{{ t('aiAddress.test.contributionsHint') }}</div>
              <ContributionBars :items="scoreItems" :format="v => (v > 0 ? '+' : '') + fmt.number(v, 2)" />
            </div>
          </div>
        </div>
      </div>
    </Card>

    <Card :title="t('aiAddress.recent.title')" :subtitle="t('aiAddress.recent.subtitle')" icon="list" class="blk" padding="none">
      <div class="fb"><FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('aiAddress.recent.search')" @clear="clearFilters" /></div>
      <DataTable :columns="cols" :rows="filteredRecent" :loading="recentLoading" :filtered="hasFilters" :page-size="25" :default-sort="{ key: 'at', dir: 'desc' }" :clickable="false"
        :empty-title="t('aiAddress.recent.empty')" :empty-desc="t('aiAddress.recent.emptyDesc')" empty-icon="pin" storage-key="ai-address-recent" dense @clear-filters="clearFilters">
        <template #cell-at="{ row }"><span :title="fmt.dateTime(row.at)">{{ fmt.relative(row.at) }}</span></template>
        <template #cell-source="{ row }"><span :class="['tag', row.source === 'test_tool' ? 'tag-accent' : '']">{{ t(`aiAddress.sources.${row.source}`) }}</span></template>
        <template #cell-orderId="{ row }"><RouterLink v-if="row.orderId" :to="{ name: 'order-detail', params: { id: row.orderId } }" class="link mono">{{ row.orderId }}</RouterLink><span v-else>-</span></template>
        <template #cell-address="{ row }"><div class="addr"><b>{{ row.address?.name || '-' }}</b><span>{{ addrLine(row.address) }}</span></div></template>
        <template #cell-score="{ row }"><ScoreBadge :score="row.score" size="sm" /></template>
        <template #cell-issueType="{ row }">{{ row.issueType ? t(`aiAddress.issueTypes.${row.issueType}`) : '-' }}</template>
        <template #cell-suggested="{ row }"><span v-if="row.suggested" class="tag tag-success">{{ t('aiAddress.recent.suggestedYes') }}</span><span v-else>-</span></template>
        <template #cell-modelVersion="{ row }"><span class="mono small">{{ row.modelVersion || '-' }}</span></template>
      </DataTable>
    </Card>

    <Card :title="t('aiAddress.activity')" icon="clock" class="blk">
      <ModelActivityLog module="address" :limit="8" />
    </Card>

    <TrainingModal v-model:open="trainOpen" :title="t('aiAddress.train.title')" :running="train.running" :done="train.done" :progress="train.pct"
      :step-label="t('aiAddress.train.iterLabel', { i: train.iter, n: metrics?.training?.iterations || 300 })"
      :from-version="train.from" :to-version="train.result?.label || ''" :disabled="!canManage" :disabled-reason="t('aiHub.training.noPermission')" @start="startTrain">
      <template #intro>
        <p>{{ t('aiAddress.train.intro', { iter: metrics?.training?.iterations, lr: metrics?.training?.learningRate, l2: metrics?.training?.l2 }) }}</p>
        <p class="tag tag-accent">{{ t('aiAddress.train.feedback', { n: pending }) }}</p>
      </template>
      <template #live>
        <div class="sh">{{ t('aiAddress.train.loss') }}</div>
        <LineChart :series="lossSeries" x-type="number" :height="200" :y-zero="false" :x-format="x => t('aiAddress.train.iteration') + ' ' + x" :x-tick-format="x => String(x)" :y-format="v => fmt.number(v, 3)" curve="linear" />
      </template>
      <template #result>
        <div class="sh">{{ t('aiAddress.train.resultTitle') }}</div>
        <table class="table-simple">
          <thead><tr><th>{{ t('aiHub.common.metric') }}</th><th class="r">{{ t('aiHub.common.before') }}</th><th class="r">{{ t('aiHub.common.after') }}</th><th class="r">{{ t('aiHub.common.change') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in deltaRows" :key="r.k">
              <td>{{ t(`aiAddress.metrics.${r.k}`) }}</td>
              <td class="r num">{{ fmt.number(r.before, 3) }}</td>
              <td class="r num"><b>{{ fmt.number(r.after, 3) }}</b></td>
              <td :class="['r', 'num', r.delta > 0 ? 'text-success' : r.delta < 0 ? 'text-danger' : '']">{{ (r.delta > 0 ? '+' : '') + fmt.number(r.delta, 4) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="note">{{ t('aiAddress.train.feedbackUsed', { n: train.result?.feedbackUsed ?? 0, train: train.result?.trainSize ?? 0 }) }}</p>
      </template>
    </TrainingModal>
  </div>
</template>

<style scoped>
.meta { display: flex; flex-wrap: wrap; gap: 8px 28px; align-items: center; padding: 12px 18px; margin-bottom: 16px; font-size: 13px; }
.meta > div { display: flex; gap: 8px; align-items: baseline; }
.ml { color: var(--ink-3); }
.mv { color: var(--ink-1); font-weight: 500; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.algo { margin-left: auto; color: var(--ink-3); font-size: 12.5px; }
.grid-kpi5 { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
@media (max-width: 1100px) { .grid-kpi5 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .grid-kpi5 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 960px) { .grid-2 { grid-template-columns: 1fr; } }
.blk { margin-bottom: 16px; }
.note { font-size: 12.5px; color: var(--ink-3); margin: 10px 0 0; }
.lift { margin-top: 12px; }
.flegend { display: flex; gap: 18px; font-size: 12.5px; color: var(--ink-3); margin-bottom: 10px; }
.flegend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 12px; height: 8px; border-radius: 2px; display: inline-block; }
.sw.ok { background: var(--success); } .sw.bad { background: var(--danger); }
.tool { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 24px; }
@media (max-width: 1100px) { .tool { grid-template-columns: 1fr; } }
.samples { margin-bottom: 14px; }
.sl { font-size: 12px; color: var(--ink-3); display: block; margin-bottom: 6px; }
.sbtns { display: flex; flex-wrap: wrap; gap: 6px; }
.tool-row { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
.clab { font-size: 13px; font-weight: 500; color: var(--ink-2); }
.tool-row .select { max-width: 260px; }
.tool-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.tool-right { border-left: 1px solid var(--line-1); padding-left: 24px; min-width: 0; }
@media (max-width: 1100px) { .tool-right { border-left: 0; padding-left: 0; border-top: 1px solid var(--line-1); padding-top: 16px; } }
.res { display: flex; flex-direction: column; gap: 18px; transition: opacity .15s; }
.res.dim { opacity: .5; }
.res-loading { display: flex; flex-direction: column; gap: 14px; }
.res-top { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.res-meta { display: flex; flex-direction: column; gap: 6px; font-size: 13px; align-items: flex-start; }
.rm { display: flex; gap: 8px; align-items: center; }
.rm span { color: var(--ink-3); }
.rm.sub { color: var(--ink-3); font-size: 12px; }
.ver { font-size: 11.5px; }
.sect { display: flex; flex-direction: column; gap: 8px; }
.sh { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--ink-3); }
.issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.issues li { display: grid; grid-template-columns: 16px 1fr auto auto; gap: 8px; align-items: center; font-size: 13px; padding: 7px 10px; border-radius: 8px; background: var(--bg-2); }
.issues li.error { background: oklch(0.97 0.025 25); } .issues li.error svg { color: var(--danger); }
.issues li.warning { background: oklch(0.975 0.04 80); } .issues li.warning svg { color: oklch(0.6 0.14 70); }
.issues li.info svg { color: var(--ink-3); }
.src { height: 20px; font-size: 11px; }
.imp { font-size: 12px; color: var(--danger); font-weight: 500; }
.ok-line { display: flex; align-items: center; gap: 6px; color: var(--success); font-size: 13px; }
.adv { font-size: 13px; }
.muted { color: var(--ink-3); font-size: 13px; }
.small { font-size: 12px; }
.sugg { border: 1px solid oklch(0.85 0.05 268); background: var(--accent-soft); border-radius: var(--r-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.sugg-addr { font-size: 13.5px; color: var(--ink-1); line-height: 1.5; }
.sugg-addr .ch { font-weight: 600; background: oklch(0.93 0.09 95); border-radius: 4px; padding: 0 4px; display: inline-block; }
.sugg-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--accent-ink); }
.sugg-actions { display: flex; gap: 8px; }
.fb { padding: 14px 16px 0; }
.addr { display: flex; flex-direction: column; font-size: 13px; line-height: 1.35; }
.addr span { color: var(--ink-3); font-size: 12.5px; }
.r { text-align: right; }
</style>
