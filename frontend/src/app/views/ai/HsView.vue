<script setup>
// HS code suggestion (spec 6.5): live metrics, test tool (top 3, influential words highlighted,
// confirm or choose another code), product catalog HS status with bulk AI suggestions + approval,
// retraining with before / after metrics and the kilim correction demo flow.
import { ref, computed, onMounted, reactive } from 'vue'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import Spinner from '../../components/Spinner.vue'
import Modal from '../../components/Modal.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar from '../../components/FilterBar.vue'
import StatusPill from '../../components/StatusPill.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import FormField from '../../components/FormField.vue'
import ContributionBars from '../../components/ai/ContributionBars.vue'
import HsCodePicker from '../../components/ai/HsCodePicker.vue'
import TrainingModal from '../../components/ai/TrainingModal.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { hsMetrics, suggestHs, recordHsFeedback, trainHs, bulkSuggestForProducts, approveHsSuggestions, rejectHsSuggestion, hsCodeList } from '../../api/ai.js'
import { listCatalogHs } from '../../api/customs.js'

const { t, tx, fmt } = useI18n()
const canManage = computed(() => can('ai.manage'))
const errText = e => {
  const k = `aiHs.errors.${e?.code}`
  const s = e?.code ? t(k) : k
  return s !== k ? s : t('common.errorGeneric')
}
const codeDesc = code => { const c = hsCodeList().find(x => x.code === code); return c ? tx(c.desc) : '' }

// ------------------------------------------------------------------ metrics
const metrics = ref(null)
async function loadMetrics() {
  try { metrics.value = await hsMetrics() } catch { toast.error(t('aiHs.loadFailed')) }
}

// ------------------------------------------------------------------ test tool
const KILIM = 'handwoven wool kilim pillow case 16x16'
const SAMPLES = [
  { key: 'kilim', title: KILIM, desc: '' },
  { key: 'mug', title: 'cute ceramic mug w/ handle 12oz', desc: 'stoneware coffee cup' },
  { key: 'towel', title: 'Turkish cotton peshtemal beach towel', desc: '' },
  { key: 'copper', title: 'hammered copper cezve coffee pot', desc: '' },
  { key: 'soap', title: 'olive oil soap bar handmade', desc: '' },
  { key: 'typo', title: 'silvr necklce with evil eye pendant', desc: '' },
]
const input = reactive({ title: '', desc: '' })
const titleErr = ref('')
const predicting = ref(false)
const result = ref(null)
const asked = ref(null) // { title, desc } of the current result
const chosen = ref(null)
const feedbackDone = ref(null) // { action, code, from }
const pending = ref(null)

async function predict(src = input) {
  titleErr.value = ''
  if (!String(src.title || '').trim()) { titleErr.value = t('aiHs.test.needTitle'); return }
  predicting.value = true
  try {
    const r = await suggestHs(src.title, src.desc, { source: 'test_tool' })
    result.value = r
    asked.value = { title: src.title, desc: src.desc }
    chosen.value = r.top[0]?.code || null
    feedbackDone.value = null
  } catch (e) { e?.code === 'TITLE_REQUIRED' ? (titleErr.value = errText(e)) : toast.error(t('aiHs.test.failed')) } finally { predicting.value = false }
}
function useSample(s) { input.title = s.title; input.desc = s.desc; predict() }

const lowWords = computed(() => new Set((result.value?.topWords || []).map(w => String(w.word).toLowerCase())))
const titleParts = computed(() => {
  if (!asked.value) return []
  return String(asked.value.title).split(/(\s+)/).map(p => {
    const k = p.toLowerCase().replace(/[^a-z0-9ğüşöçıİ]/gi, '')
    return { text: p, hl: !!k && lowWords.value.has(k) }
  })
})
const wordItems = computed(() => (result.value?.topWords || []).map(w => ({ key: w.word, label: w.word, value: w.contribution })))

async function confirmCode(code) {
  const predicted = result.value?.top[0]?.code || null
  try {
    const r = await recordHsFeedback({ title: asked.value.title, desc: asked.value.desc, code, predicted, source: 'test_tool' })
    pending.value = r.pending
    feedbackDone.value = { action: r.feedback.action, code: r.feedback.code, from: predicted }
    if (r.feedback.action === 'correct') toast.success(t('aiHs.test.corrected', { from: predicted, to: r.feedback.code }))
    else toast.success(t('aiHs.test.confirmed', { code: r.feedback.code }))
    loadMetrics()
  } catch (e) { toast.error(errText(e)) }
}

// choose another code (test tool and catalog)
const pick = reactive({ open: false, code: '', target: null, err: '', saving: false })
function openPick(target, current) { Object.assign(pick, { open: true, code: current || '', target, err: '', saving: false }) }
async function savePick() {
  if (!pick.code) { pick.err = t('aiHs.test.pickNeed'); return }
  pick.saving = true
  try {
    if (pick.target === 'test') await confirmCode(pick.code)
    else {
      await approveHsSuggestions([{ sku: pick.target, code: pick.code }])
      toast.success(t('aiHs.catalog.approved', { n: 1 }))
      await Promise.all([loadCatalog(true), loadMetrics()])
    }
    pick.open = false
  } catch (e) { toast.error(errText(e)) } finally { pick.saving = false }
}

// ------------------------------------------------------------------ catalog
const catLoading = ref(true)
const catalog = ref([])
const search = ref('')
const filters = ref({ status: [] })
const selected = ref([])
const bulk = reactive({ running: false, pct: 0, done: 0, total: 0 })
const rowBusy = ref(new Set())
async function loadCatalog(silent = false) {
  if (!silent) catLoading.value = true
  try { catalog.value = await listCatalogHs() } catch { toast.error(t('aiHs.loadFailed')) } finally { catLoading.value = false }
}
const productTitle = p => tx(p.title) || p.sku
const statusTone = s => ({ confirmed: 'success', missing: 'danger', ai_pending: 'warning' }[s] || 'neutral')
const chips = computed(() => [{ key: 'status', label: t('aiHs.catalog.statusChip'), options: ['missing', 'ai_pending', 'confirmed'].map(s => ({ value: s, label: t(`aiHs.catalog.status.${s}`), count: catalog.value.filter(p => p.hsStatus === s).length })) }])
const filteredCatalog = computed(() => {
  const q = search.value.trim().toLowerCase()
  const st = filters.value.status || []
  return catalog.value.filter(p => (!st.length || st.includes(p.hsStatus)) && (!q || p.sku.toLowerCase().includes(q) || productTitle(p).toLowerCase().includes(q) || String(p.hsCode || '').includes(q)))
})
const hasFilters = computed(() => !!search.value.trim() || (filters.value.status || []).length > 0)
function clearFilters() { search.value = ''; filters.value = { status: [] } }
const pendingRows = computed(() => catalog.value.filter(p => p.hsStatus === 'ai_pending' && p.hsSuggestion))
const cols = computed(() => [
  { key: 'sku', label: t('aiHs.catalog.cols.sku'), sortable: true, width: 130, nowrap: true },
  { key: 'title', label: t('aiHs.catalog.cols.title'), sortable: true, sortValue: p => productTitle(p) },
  { key: 'hsCode', label: t('aiHs.catalog.cols.code'), sortable: true, width: 100 },
  { key: 'hsStatus', label: t('aiHs.catalog.cols.status'), sortable: true, width: 170 },
  { key: 'suggestion', label: t('aiHs.catalog.cols.suggestion'), width: 200, hideBelow: 'md' },
  { key: 'actions', label: '', isAction: true, width: 230, align: 'right', hideable: false },
])

async function runBulk() {
  const missing = catalog.value.filter(p => !p.hsCode).length
  if (!missing) { toast.info(t('aiHs.catalog.bulkNone')); return }
  Object.assign(bulk, { running: true, pct: 0, done: 0, total: missing })
  try {
    const res = await bulkSuggestForProducts({ onlyMissing: true, onProgress: (p, s) => { bulk.pct = p; bulk.done = s.done; bulk.total = s.total } })
    await loadCatalog(true)
    filters.value = { status: [] }
    toast.success(t('aiHs.catalog.bulkDone', { n: res.length }))
  } catch (e) { toast.error(errText(e)) } finally { bulk.running = false }
}
async function approveRows(rows) {
  const items = rows.filter(p => p.hsSuggestion || p.hsCode).map(p => ({ sku: p.sku, code: p.hsSuggestion?.code || p.hsCode }))
  if (!items.length) return
  setBusy(items.map(i => i.sku), true)
  try {
    const r = await approveHsSuggestions(items)
    selected.value = []
    await Promise.all([loadCatalog(true), loadMetrics()])
    toast.success(t('aiHs.catalog.approved', { n: r.approved }))
  } catch (e) { toast.error(errText(e)) } finally { setBusy(items.map(i => i.sku), false) }
}
async function rejectRow(p) {
  setBusy([p.sku], true)
  try { await rejectHsSuggestion(p.sku); await loadCatalog(true); toast.info(t('aiHs.catalog.rejected')) } catch (e) { toast.error(errText(e)) } finally { setBusy([p.sku], false) }
}
function setBusy(skus, on) { const s = new Set(rowBusy.value); skus.forEach(k => (on ? s.add(k) : s.delete(k))); rowBusy.value = s }
const selRows = computed(() => catalog.value.filter(p => selected.value.includes(p.sku)))

// ------------------------------------------------------------------ retrain
const trainOpen = ref(false)
const train = reactive({ running: false, done: false, pct: 0, stage: 0, result: null, from: '', retest: null })
function openTrain() {
  Object.assign(train, { running: false, done: false, pct: 0, stage: 0, result: null, from: metrics.value?.label || '', retest: null })
  trainOpen.value = true
}
async function startTrain() {
  if (train.running || train.done) return
  train.running = true
  train.from = metrics.value?.label || ''
  const before = asked.value && result.value ? { title: asked.value.title, desc: asked.value.desc, top: result.value.top[0] } : null
  try {
    const res = await trainHs((p, s) => { train.pct = p; train.stage = s.stage })
    train.result = res
    train.done = true
    await loadMetrics()
    if (before) {
      const r = await suggestHs(before.title, before.desc, { source: 'retest' })
      train.retest = { title: before.title, before: before.top, after: r.top[0] }
      result.value = r
      asked.value = { title: before.title, desc: before.desc }
      chosen.value = r.top[0]?.code || null
      feedbackDone.value = null
    }
    pending.value = 0
  } catch (e) { toast.error(errText(e)) } finally { train.running = false }
}
const stageLabel = computed(() => {
  const list = t('aiHs.train.stages')
  return Array.isArray(list) && train.stage ? list[Math.min(list.length, train.stage) - 1] : ''
})

onMounted(() => { loadMetrics(); loadCatalog(); input.title = KILIM; predict() })
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.aiHs')" :subtitle="t('aiHs.subtitle')" badge="AI">
      <template #actions>
        <button class="btn btn-accent btn-sm" :disabled="!canManage" :title="canManage ? '' : t('aiHub.training.noPermission')" @click="openTrain">
          <Icon name="refresh" :size="14" />{{ t('aiHs.retrain') }}
          <span v-if="metrics?.pendingFeedback" class="cnt">{{ metrics.pendingFeedback }}</span>
        </button>
      </template>
    </PageHeader>

    <div class="grid-kpi kp blk">
      <KpiCard :label="t('aiHs.metrics.top1')" :value="metrics ? fmt.percent(metrics.top1, 1) : ''" :hint="metrics ? t('aiHs.metrics.top1Hint', { c: metrics.correctTop1, n: metrics.testSize }) : ''" :loading="!metrics" tone="accent" icon="target" />
      <KpiCard :label="t('aiHs.metrics.top3')" :value="metrics ? fmt.percent(metrics.top3, 1) : ''" :hint="t('aiHs.metrics.top3Hint')" :loading="!metrics" icon="check-circle" />
      <KpiCard :label="t('aiHs.metrics.train')" :value="metrics ? fmt.number(metrics.trainSize) : ''" :hint="metrics ? t('aiHs.metrics.trainHint', { n: metrics.testSize, d: metrics.datasetSize }) : ''" :loading="!metrics" icon="database" />
      <KpiCard :label="t('aiHs.metrics.classes')" :value="metrics ? fmt.number(metrics.classes) : ''" :hint="t('aiHs.metrics.classesHint')" :loading="!metrics" icon="tag" />
      <KpiCard :label="t('aiHs.metrics.corrections')" :value="metrics ? fmt.number(metrics.corrections) : ''" :hint="metrics ? t('aiHs.metrics.correctionsHint', { n: metrics.feedbackCount, p: metrics.pendingFeedback }) : ''" :loading="!metrics" icon="edit" />
    </div>

    <!-- test tool -->
    <Card :title="t('aiHs.test.title')" :subtitle="t('aiHs.test.subtitle')" icon="flask" class="blk">
      <div class="tool">
        <form class="tool-form" novalidate @submit.prevent="predict()">
          <FormField :label="t('aiHs.test.productTitle')" :error="titleErr" required v-slot="{ id, invalid }">
            <input :id="id" v-model="input.title" class="input" :aria-invalid="invalid" maxlength="160" @input="titleErr = ''" />
          </FormField>
          <FormField :label="t('aiHs.test.desc')" optional v-slot="{ id }">
            <textarea :id="id" v-model="input.desc" class="input ta" rows="2" :placeholder="t('aiHs.test.descPh')" />
          </FormField>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="predicting"><Spinner v-if="predicting" :size="13" /><Icon v-else name="wand" :size="13" />{{ predicting ? t('aiHs.test.running') : t('aiHs.test.run') }}</button>
          <div class="samples">
            <span>{{ t('aiHs.test.samples') }}</span>
            <button v-for="s in SAMPLES" :key="s.key" type="button" :class="['btn', 'btn-ghost', 'btn-xs', { kilim: s.key === 'kilim' }]" @click="useSample(s)">{{ s.key === 'kilim' ? t('aiHs.test.kilim') : s.title }}</button>
          </div>
        </form>

        <div class="tool-out">
          <Skeleton v-if="predicting && !result" variant="rect" :height="260" />
          <EmptyState v-else-if="!result" compact icon="tag" :title="t('aiHs.test.empty')" :description="t('aiHs.test.emptyDesc')" />
          <template v-else>
            <div class="hl-title">
              <span class="lbl">{{ t('aiHs.test.highlighted') }}:</span>
              <span class="words"><template v-for="(p, i) in titleParts" :key="i"><mark v-if="p.hl">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
            </div>
            <div v-if="result.lowConfidence" class="callout warn conf"><Icon name="alert" :size="14" />{{ t('aiHs.test.lowConfidence', { p: Math.round(result.confidence * 100), t: 55 }) }}</div>
            <div v-else class="conf ok"><Icon name="check-circle" :size="14" />{{ t('aiHs.test.highConfidence', { p: Math.round(result.confidence * 100) }) }}</div>

            <div class="tops" role="radiogroup" :aria-label="t('aiHs.test.top')">
              <button v-for="(s, i) in result.top" :key="s.code" type="button" role="radio" :aria-checked="chosen === s.code" :class="['topc', { on: chosen === s.code, first: i === 0 }]" @click="chosen = s.code">
                <div class="tc-h"><span class="rank">{{ t('aiHs.test.rank', { n: i + 1 }) }}</span><span class="code num">{{ s.code }}</span></div>
                <div class="tc-d">{{ tx(s.desc) }}</div>
                <div class="tc-c" :title="t('aiHs.test.customs')">{{ s.customsDesc }}</div>
                <div class="tc-p"><ProgressBar :value="s.prob * 100" size="sm" :tone="i === 0 ? 'accent' : 'ink'" /><span class="num">{{ fmt.percent(s.prob, 1) }}</span></div>
              </button>
            </div>

            <div class="fb-row">
              <button class="btn btn-accent btn-sm" :disabled="!chosen || !!feedbackDone" @click="confirmCode(chosen)"><Icon name="check" :size="13" />{{ t('aiHs.test.confirm') }} <span class="num">{{ chosen }}</span></button>
              <button class="btn btn-ghost btn-sm" :disabled="!!feedbackDone" @click="openPick('test', '')"><Icon name="search" :size="13" />{{ t('aiHs.test.other') }}</button>
              <span v-if="feedbackDone" class="tag tag-success"><Icon name="check" :size="12" />{{ feedbackDone.action === 'correct' ? t('aiHs.test.corrected', { from: feedbackDone.from, to: feedbackDone.code }) : t('aiHs.test.confirmed', { code: feedbackDone.code }) }}</span>
            </div>
            <div v-if="feedbackDone && pending" class="callout neutral pend">
              <Icon name="info" :size="14" /><span>{{ t('aiHs.test.pending', { n: pending }) }}</span>
              <button class="btn btn-sm btn-accent" :disabled="!canManage" @click="openTrain">{{ t('aiHs.test.retrainNow') }}</button>
            </div>

            <div class="words-box">
              <div class="sub-h">{{ t('aiHs.test.words') }}</div>
              <div class="hint">{{ t('aiHs.test.wordsHint', { code: result.top[0]?.code }) }}</div>
              <ContributionBars :items="wordItems" mode="positive" :format="v => fmt.number(v, 2)" />
            </div>
          </template>
        </div>
      </div>
    </Card>

    <!-- catalog -->
    <Card :title="t('aiHs.catalog.title')" :subtitle="t('aiHs.catalog.subtitle')" icon="box" class="blk">
      <template #actions>
        <button v-if="pendingRows.length" class="btn btn-soft btn-sm" :disabled="bulk.running" @click="approveRows(pendingRows)"><Icon name="check" :size="13" />{{ t('aiHs.catalog.approveAll', { n: pendingRows.length }) }}</button>
        <button class="btn btn-accent btn-sm" :disabled="bulk.running || catLoading" @click="runBulk"><Spinner v-if="bulk.running" :size="13" /><Icon v-else name="wand" :size="13" />{{ t('aiHs.catalog.bulk') }}</button>
      </template>
      <div v-if="bulk.running" class="bulkp">
        <div class="bh"><span>{{ t('aiHs.catalog.bulkRunning', { d: bulk.done, n: bulk.total }) }}</span><span class="num">{{ bulk.pct }}%</span></div>
        <ProgressBar :value="bulk.pct" size="sm" />
      </div>
      <FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('aiHs.catalog.search')" class="fbar" @clear="clearFilters" />
      <DataTable :columns="cols" :rows="filteredCatalog" :loading="catLoading" row-key="sku" selectable v-model:selected="selected" :clickable="false"
        :filtered="hasFilters" :empty-title="t('aiHs.catalog.empty')" empty-icon="box" storage-key="ai-hs-catalog" @clear-filters="clearFilters">
        <template #cell-title="{ row }"><span class="ptitle">{{ productTitle(row) }}</span></template>
        <template #cell-hsCode="{ row }"><span class="num code">{{ row.hsCode || '-' }}</span></template>
        <template #cell-hsStatus="{ row }"><StatusPill :status="row.hsStatus" :tone="statusTone(row.hsStatus)" :label="t(`aiHs.catalog.status.${row.hsStatus}`)" size="sm" /></template>
        <template #cell-suggestion="{ row }">
          <div v-if="row.hsSuggestion" class="sugg">
            <span class="num code">{{ row.hsSuggestion.code }}</span>
            <span :class="['num', 'pp', { low: row.hsSuggestion.lowConfidence }]">{{ fmt.percent(row.hsSuggestion.prob, 0) }}</span>
            <span class="sd" :title="codeDesc(row.hsSuggestion.code)">{{ codeDesc(row.hsSuggestion.code) }}</span>
            <span v-if="row.hsCode && row.hsCode === row.hsSuggestion.code" class="tag tag-success">{{ t('aiHs.catalog.agrees') }}</span>
          </div>
          <span v-else>-</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="acts">
            <Spinner v-if="rowBusy.has(row.sku)" :size="14" />
            <template v-else-if="row.hsStatus === 'ai_pending' && row.hsSuggestion">
              <button class="btn btn-soft btn-xs" @click="approveRows([row])"><Icon name="check" :size="12" />{{ t('aiHs.catalog.approve') }}</button>
              <button class="btn btn-ghost btn-xs" @click="openPick(row.sku, row.hsSuggestion.code)">{{ t('aiHs.catalog.choose') }}</button>
              <button class="btn btn-ghost btn-xs" :aria-label="t('aiHs.catalog.reject')" :title="t('aiHs.catalog.reject')" @click="rejectRow(row)"><Icon name="x" :size="12" /></button>
            </template>
            <button v-else class="btn btn-ghost btn-xs" @click="openPick(row.sku, row.hsCode)"><Icon name="edit" :size="12" />{{ t('aiHs.catalog.choose') }}</button>
          </div>
        </template>
        <template #bulk>
          <button class="btn btn-ghost btn-sm" @click="approveRows(selRows)"><Icon name="check" :size="13" />{{ t('aiHs.catalog.approveSelected') }}</button>
        </template>
      </DataTable>
    </Card>

    <Card :title="t('aiHs.activity')" icon="clock" class="blk">
      <ModelActivityLog module="hs" :limit="8" />
    </Card>

    <Modal v-model:open="pick.open" :title="t('aiHs.test.pickTitle')" :subtitle="t('aiHs.test.pickSubtitle')" size="md">
      <HsCodePicker v-model="pick.code" :highlight="pick.target === 'test' && result ? result.top.map(x => x.code) : []" @update:model-value="pick.err = ''" />
      <div v-if="pick.err" class="field-error">{{ pick.err }}</div>
      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="pick.saving" @click="pick.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="pick.saving" @click="savePick"><Spinner v-if="pick.saving" :size="13" />{{ t('aiHs.test.pickSave') }}<span v-if="pick.code" class="num"> {{ pick.code }}</span></button>
      </template>
    </Modal>

    <TrainingModal v-model:open="trainOpen" :title="t('aiHs.train.title')" :running="train.running" :done="train.done" :progress="train.pct"
      :step-label="stageLabel" :from-version="train.from" :to-version="train.result?.label || ''" :disabled="!canManage" :disabled-reason="t('aiHub.training.noPermission')" size="md" @start="startTrain">
      <template #intro>
        <p>{{ t('aiHs.train.intro') }}</p>
        <p v-if="metrics?.pendingFeedback" class="tag tag-accent">{{ t('aiHs.train.pending', { n: metrics.pendingFeedback }) }}</p>
        <p v-else class="muted">{{ t('aiHs.train.noPending') }}</p>
      </template>
      <template #live>
        <ol class="stages">
          <li v-for="(s, i) in t('aiHs.train.stages')" :key="i" :class="{ done: train.stage > i + 1 || train.done, cur: train.stage === i + 1 && !train.done }">
            <Icon :name="train.stage > i + 1 || train.done ? 'check-circle' : 'clock'" :size="13" />{{ s }}
          </li>
        </ol>
      </template>
      <template #result>
        <table class="table-simple">
          <thead><tr><th>{{ t('aiHub.common.metric') }}</th><th class="r">{{ t('aiHub.common.before') }}</th><th class="r">{{ t('aiHub.common.after') }}</th></tr></thead>
          <tbody>
            <tr><td>{{ t('aiHs.metrics.top1') }}</td><td class="r num">{{ fmt.percent(train.result.before.top1, 1) }}</td><td class="r num"><b>{{ fmt.percent(train.result.after.top1, 1) }}</b></td></tr>
            <tr><td>{{ t('aiHs.metrics.top3') }}</td><td class="r num">{{ fmt.percent(train.result.before.top3, 1) }}</td><td class="r num"><b>{{ fmt.percent(train.result.after.top3, 1) }}</b></td></tr>
            <tr><td>{{ t('aiHs.train.trainSize') }}</td><td class="r num">{{ train.result.before.trainSize }}</td><td class="r num"><b>{{ train.result.trainSize }}</b></td></tr>
            <tr><td>{{ t('aiHs.train.feedbackUsed') }}</td><td class="r num">-</td><td class="r num"><b>{{ train.result.feedbackUsed }}</b></td></tr>
          </tbody>
        </table>
        <div v-if="train.retest" class="retest">
          <div class="rt-t">{{ t('aiHs.train.retest', { title: train.retest.title }) }}</div>
          <div class="rt-row">
            <div><span class="muted">{{ t('aiHs.train.before') }}</span><b class="num">{{ train.retest.before?.code }}</b><span class="num muted">{{ fmt.percent(train.retest.before?.prob ?? 0, 0) }}</span></div>
            <Icon name="arrow" :size="14" />
            <div :class="{ changed: train.retest.before?.code !== train.retest.after?.code }"><span class="muted">{{ t('aiHs.train.after') }}</span><b class="num">{{ train.retest.after?.code }}</b><span class="num muted">{{ fmt.percent(train.retest.after?.prob ?? 0, 0) }}</span></div>
          </div>
          <div class="muted small">{{ codeDesc(train.retest.after?.code) }}</div>
        </div>
      </template>
    </TrainingModal>
  </div>
</template>

<style scoped>
.blk { margin-bottom: 16px; }
.kp { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@media (max-width: 1200px) { .kp { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 700px) { .kp { grid-template-columns: 1fr 1fr; } }
.cnt { background: var(--surface); color: var(--accent-ink); border-radius: 999px; font-size: 11px; padding: 0 6px; margin-left: 4px; font-weight: 600; }
.tool { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 22px; }
@media (max-width: 1000px) { .tool { grid-template-columns: 1fr; } }
.tool-form { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.tool-form > .btn { align-self: flex-start; }
.ta { height: auto; padding: 8px 12px; resize: vertical; }
.samples { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; color: var(--ink-3); }
.samples .btn { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.samples .kilim { border-color: var(--accent); color: var(--accent-ink); }
.tool-out { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.hl-title { font-size: 14px; line-height: 1.6; }
.hl-title .lbl { font-size: 12px; color: var(--ink-3); margin-right: 6px; }
.hl-title mark { background: oklch(0.93 0.08 90); color: var(--ink-1); padding: 1px 3px; border-radius: 4px; font-weight: 600; }
.conf { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; }
.conf.ok { color: oklch(0.45 0.1 155); }
.tops { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 760px) { .tops { grid-template-columns: 1fr; } }
.topc { text-align: left; background: var(--surface); border: 1px solid var(--line-2); border-radius: var(--r-md); padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; font: inherit; color: inherit; }
.topc:hover { border-color: var(--line-strong); }
.topc.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tc-h { display: flex; justify-content: space-between; align-items: baseline; }
.rank { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; }
.code { font-family: var(--font-mono); font-weight: 600; }
.topc .code { font-size: 16px; }
.tc-d { font-size: 13px; font-weight: 500; }
.tc-c { font-size: 11.5px; color: var(--ink-3); }
.tc-p { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.tc-p > :first-child { flex: 1; }
.fb-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pend { align-items: center; flex-wrap: wrap; margin: 0; }
.pend span { flex: 1; }
.words-box { border-top: 1px solid var(--line-1); padding-top: 10px; }
.sub-h { font-weight: 600; font-size: 13.5px; }
.hint { font-size: 12px; color: var(--ink-3); margin-bottom: 8px; }
.bulkp { margin-bottom: 12px; }
.bh { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--ink-2); margin-bottom: 4px; }
.fbar { margin-bottom: 12px; }
.ptitle { font-weight: 500; }
.sugg { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; }
.pp { color: oklch(0.45 0.1 155); }
.pp.low { color: oklch(0.55 0.13 70); }
.sd { color: var(--ink-3); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acts { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; }
.muted { color: var(--ink-3); }
.small { font-size: 12px; }
.r { text-align: right; }
.stages { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; font-size: 12.5px; color: var(--ink-3); }
.stages li { display: flex; gap: 6px; align-items: center; }
.stages li.done { color: var(--ink-1); }
.stages li.done svg { color: var(--success); }
.stages li.cur { color: var(--accent-ink); font-weight: 500; }
.retest { margin-top: 14px; padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); }
.rt-t { font-size: 13px; margin-bottom: 8px; }
.rt-row { display: flex; align-items: center; gap: 16px; }
.rt-row > div { display: flex; flex-direction: column; font-size: 12px; }
.rt-row b { font-size: 18px; font-family: var(--font-mono); }
.rt-row .changed b { color: oklch(0.45 0.12 155); }
</style>
