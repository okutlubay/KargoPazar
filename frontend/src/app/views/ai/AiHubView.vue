<script setup>
// AI hub (spec 6.0): six module cards with live metrics, architecture diagram, model activity log.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import StatusPill from '../../components/StatusPill.vue'
import Sparkline from '../../components/charts/Sparkline.vue'
import ArchitectureDiagram from '../../components/ai/ArchitectureDiagram.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { useModelActivity } from '../../components/ai/activity.js'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { aiModels, addressMetrics, hsMetrics, acceptanceStats } from '../../api/ai.js'
import { getModelInfo as forecastInfo } from '../../api/forecast.js'
import { listRecommendations } from '../../api/pricing.js'
import { automationStats } from '../../api/customs.js'

const { t, fmt } = useI18n()
const router = useRouter()
const loading = ref(true)
const refreshing = ref(false)
const data = ref(null)

const ICONS = { address: 'pin', forecast: 'chart', pricing: 'dollar', optimizer: 'route', hs: 'tag', customs: 'file' }
const ROUTES = { address: 'ai-address', forecast: 'ai-forecast', pricing: 'ai-pricing', optimizer: 'ai-optimizer', hs: 'ai-hs', customs: 'ai-customs-docs' }
const CONSUMER_ROUTES = { shipmentNew: 'shipment-new', batch: 'batch', rateCards: 'admin-rate-cards', customs: 'customs' }
const ORDER = ['address', 'forecast', 'pricing', 'optimizer', 'hs', 'customs']

async function load(manual = false) {
  if (manual) refreshing.value = true
  try {
    const [models, fc, pr, cs, am, hm, acc] = await Promise.all([aiModels(), forecastInfo(), listRecommendations({ all: true }), automationStats(), addressMetrics(), hsMetrics(), acceptanceStats({ days: 90 })])
    data.value = { models, fc, pr, cs, am, hm, acc }
    if (manual) toast.success(t('aiHub.refreshed'))
  } catch (e) {
    toast.error(t('aiHub.loadFailed'))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}
onMounted(() => load())

const cards = computed(() => {
  if (!data.value) return []
  const { models, fc, pr, cs, am, hm, acc } = data.value
  const byId = Object.fromEntries(models.map(m => [m.id, m]))
  const proposed = pr.lanes.filter(l => l.status === 'proposed')
  const impact = pr.lanes.filter(l => l.status === 'proposed' || l.status === 'approved').reduce((s, l) => s + (l.impact || 0), 0)
  const hist = key => (byId[key]?.history || []).map(h => h.metrics && Object.values(h.metrics)[0]).filter(v => typeof v === 'number')
  return [
    {
      key: 'address', version: byId.address.label, trainedAt: byId.address.lastTrainedAt,
      dataset: t('aiHub.modules.address.dataset', { n: fmt.number(am.datasetSize) }),
      metric: fmt.number(am.ml.f1, 3), metricSub: t('aiHub.modules.address.metricSub', { v: fmt.number(am.rulesOnly.f1, 3) }),
      pending: am.pendingFeedback, spark: hist('address'),
    },
    {
      key: 'forecast', version: fc.label, trainedAt: fc.trainedAt,
      dataset: t('aiHub.modules.forecast.dataset', { w: fmt.number(fc.trainWeeks), n: fmt.number(fc.series) }),
      metric: fmt.percent(fc.metric.value, 1), metricSub: t('aiHub.modules.forecast.metricSub', { v: fmt.number(fc.mae, 1), s: fc.sufficiency }),
      pending: 0, spark: [],
    },
    {
      key: 'pricing', version: pr.meta.modelVersion, trainedAt: pr.meta.generatedAt, computed: true,
      dataset: t('aiHub.modules.pricing.dataset', { n: pr.totalLanes }),
      metric: (impact >= 0 ? '+' : '') + fmt.money(impact), metricSub: t('aiHub.modules.pricing.metricSub', { n: proposed.length }),
      pending: 0, spark: [],
    },
    {
      key: 'optimizer', version: byId.optimizer.label, trainedAt: byId.optimizer.lastTrainedAt,
      dataset: t('aiHub.modules.optimizer.dataset', { n: fmt.number(byId.optimizer.datasetSize ?? 0) }),
      metric: fmt.percent(acc.acceptanceRate, 1), metricSub: t('aiHub.modules.optimizer.metricSub', { v: fmt.money(acc.totalSavings) }),
      pending: 0, spark: [],
    },
    {
      key: 'hs', version: byId.hs.label, trainedAt: byId.hs.lastTrainedAt,
      dataset: t('aiHub.modules.hs.dataset', { n: fmt.number(hm.datasetSize) }),
      metric: fmt.percent(hm.top1, 1), metricSub: t('aiHub.modules.hs.metricSub', { v: fmt.percent(hm.top3, 1) }),
      pending: hm.pendingFeedback, spark: hist('hs'),
    },
    {
      key: 'customs', version: byId.customs.label, trainedAt: byId.customs.lastTrainedAt,
      dataset: t('aiHub.modules.customs.dataset', { n: cs.shipments, i: cs.items }),
      metric: fmt.percent(cs.autoRate, 1), metricSub: t('aiHub.modules.customs.metricSub', { n: cs.cn22 + cs.cn23, i: cs.items }),
      pending: 0, spark: [],
    },
  ]
})


const versions = computed(() => Object.fromEntries(cards.value.map(c => [c.key, c.version])))
const recent = useModelActivity({ limit: 500 })
const events7 = computed(() => recent.value.filter(e => new Date(e.at).getTime() >= Date.now() - 7 * 86400000).length)
const pendingFeedback = computed(() => cards.value.reduce((s, c) => s + (c.pending || 0), 0))

function open(key) { router.push({ name: ROUTES[key] }) }
function openConsumer(key) { router.push({ name: CONSUMER_ROUTES[key] }) }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('aiHub.title')" :subtitle="t('aiHub.subtitle')" badge="AI">
      <template #actions>
        <button class="btn btn-ghost btn-sm" :disabled="refreshing || loading" @click="load(true)">
          <Icon name="refresh" :size="14" :class="{ spin: refreshing }" />{{ t('aiHub.refresh') }}
        </button>
      </template>
    </PageHeader>

    <div class="grid-kpi kpis">
      <KpiCard :label="t('aiHub.summary.active')" :value="loading ? '' : '6 / 6'" icon="brain" :loading="loading" tone="success" />
      <KpiCard :label="t('aiHub.summary.events')" :value="loading ? '' : fmt.number(events7)" icon="spark" :loading="loading" />
      <KpiCard :label="t('aiHub.summary.feedback')" :value="loading ? '' : fmt.number(pendingFeedback)" :hint="t('aiHub.summary.feedbackHint')" icon="edit" :loading="loading" />
      <KpiCard :label="t('aiHub.summary.dependencies')" :value="loading ? '' : '3'" icon="link" :loading="loading" />
    </div>

    <section class="modules">
      <template v-if="loading">
        <div v-for="i in 6" :key="i" class="panel panel-pad mcard"><Skeleton variant="lines" :lines="6" /></div>
      </template>
      <article v-for="c in cards" v-else :key="c.key" class="panel mcard" :data-module="c.key">
        <header class="mhead">
          <span class="micon"><Icon :name="ICONS[c.key]" :size="16" /></span>
          <div class="mtitle">
            <h3>{{ t(`aiHub.modules.${c.key}.name`) }}</h3>
            <span class="ver">{{ c.version }}</span>
          </div>
          <StatusPill status="active" :label="t('aiHub.card.active')" size="sm" />
        </header>
        <p class="mdesc">{{ t(`aiHub.modules.${c.key}.desc`) }}</p>
        <div class="metric">
          <div class="mlabel">{{ t(`aiHub.modules.${c.key}.metric`) }}</div>
          <div class="mrow">
            <div class="mval num">{{ c.metric }}</div>
            <div v-if="c.spark.length > 1" class="spark"><Sparkline :data="c.spark" :height="28" /></div>
          </div>
          <div class="msub">{{ c.metricSub }}</div>
        </div>
        <dl class="kv mkv">
          <dt>{{ c.computed ? t('aiHub.card.lastComputed') : t('aiHub.card.lastTrained') }}</dt>
          <dd :title="fmt.dateTime(c.trainedAt)">{{ fmt.relative(c.trainedAt) }}</dd>
          <dt>{{ t('aiHub.card.dataset') }}</dt>
          <dd>{{ c.dataset }}</dd>
        </dl>
        <footer class="mfoot">
          <span v-if="c.pending" class="tag tag-warning">{{ t('aiHub.card.pending', { n: c.pending }) }}</span>
          <span v-else />
          <button class="btn btn-soft btn-sm" @click="open(c.key)">{{ t('aiHub.card.open') }}<Icon name="arrow" :size="13" /></button>
        </footer>
      </article>
    </section>

    <Card :title="t('aiHub.arch.title')" :subtitle="t('aiHub.arch.subtitle')" icon="layers" class="block">
      <ArchitectureDiagram :versions="versions" @open="open" @open-consumer="openConsumer" />
    </Card>

    <Card :title="t('aiHub.activity.title')" :subtitle="t('aiHub.activity.subtitle')" icon="clock" class="block">
      <ModelActivityLog :limit="20" :loading="loading" />
    </Card>
  </div>
</template>

<style scoped>
.kpis { margin-bottom: 16px; }
.modules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
@media (max-width: 1180px) { .modules { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .modules { grid-template-columns: 1fr; } }
.mcard { display: flex; flex-direction: column; padding: 16px 18px; gap: 12px; }
.mhead { display: flex; align-items: flex-start; gap: 10px; }
.micon { width: 32px; height: 32px; border-radius: 9px; background: var(--accent-soft); color: var(--accent-ink); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.mtitle { flex: 1; min-width: 0; }
.mtitle h3 { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.ver { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3); }
.mdesc { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.5; min-height: 39px; }
.metric { background: var(--bg-2); border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 10px 12px; }
.mlabel { font-size: 12px; color: var(--ink-3); }
.mrow { display: flex; align-items: center; gap: 12px; }
.mval { font-family: var(--font-display); font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: var(--ink-1); }
.spark { flex: 1; max-width: 120px; }
.msub { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.mkv { grid-template-columns: 110px 1fr; font-size: 13px; }
.mfoot { display: flex; justify-content: space-between; align-items: center; margin-top: auto; gap: 8px; }
.block { margin-bottom: 16px; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
