<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Spinner from '@/app/components/Spinner.vue'
import ProgressBar from '@/app/components/ProgressBar.vue'
import Drawer from '@/app/components/Drawer.vue'
import DateTime from '@/app/components/DateTime.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import BarChart from '@/app/components/charts/BarChart.vue'
import MiniBars from '@/app/components/charts/MiniBars.vue'
import TestLog from '@/app/components/intl/TestLog.vue'
import { errorText } from '@/app/components/intl/stage.js'
import { toast } from '@/app/components/toast.js'
import { confirm } from '@/app/components/confirm.js'
import { useI18n } from '@/app/i18n/index.js'
import { getTestData, runTests, downloadRunReport } from '@/app/api/tests.js'

const { t, tx, fmt } = useI18n()
const data = ref(null)
const loading = ref(true)
const running = ref(false)
const runLabel = ref('')
const progress = ref({ done: 0, total: 0 })
const live = ref({}) // scenarioId -> 'running' | result
const liveErr = ref({})
const lines = ref([])
const expanded = ref({})
const openSc = ref({})
const runDrawer = ref({ open: false, run: null })
const busyReport = ref('')

async function load(silent) {
  if (!silent) loading.value = true
  try { data.value = await getTestData() } catch (e) { toast.error(errorText(t, e)) } finally { loading.value = false }
}
onMounted(() => load())

const suites = computed(() => data.value?.suites || [])
const runs = computed(() => data.value?.runs || [])
const totalScenarios = computed(() => suites.value.reduce((s, x) => s + x.scenarios.length, 0))
const lastRun = computed(() => runs.value[0] || null)
const fixedCount = computed(() => runs.value.reduce((s, r) => s + (r.results || []).filter(x => x.fixNote).length, 0))
const scenarioById = computed(() => new Map(suites.value.flatMap(s => s.scenarios.map(sc => [sc.id, { ...sc, suiteId: s.id, suiteName: s.name }]))))

function statusOf(sc) { return live.value[sc.id] || sc.lastResult || 'skipped' }
function suiteStats(s) {
  const r = { passed: 0, failed: 0, skipped: 0 }
  for (const sc of s.scenarios) { const st = statusOf(sc); if (st in r) r[st]++ }
  return r
}

// ---- log rendering
function paramText(params = {}) {
  const out = {}
  for (const [k, v] of Object.entries(params)) {
    if (/Stage$/.test(k)) out[k] = t('intl.stages.' + v)
    else if (/Status$/.test(k)) out[k] = t('status.' + v)
    else if (k === 'error') out[k] = v ? tx(v) : ''
    else out[k] = v
  }
  return out
}
function renderLine(l) {
  if (l.text != null) return l
  if (l.kind === 'sum' && l.sumKey) return { at: l.at, kind: 'sum', text: t(l.sumKey, { ...l.params, rate: fmt.percent(l.params.rate, 1) }) }
  if (l.kind === 'req') return { at: l.at, kind: 'req', text: `→ ${l.method} ${l.path} ${l.status} (${l.ms} ms)` }
  const icon = l.kind === 'ok' ? '✓ ' : l.kind === 'fail' ? '✗ ' : l.kind === 'head' ? '▸ ' : '  '
  return { at: l.at, kind: l.kind, text: icon + t('tests.' + l.key, paramText(l.params)) }
}
// Raw lines are kept (key + params) and rendered on the fly, so the log follows a language switch.
const shownLines = computed(() => lines.value.map(renderLine))
function pushLine(l) {
  lines.value.push(l)
  if (lines.value.length > 800) lines.value.splice(0, lines.value.length - 800)
}

// ---- run
async function start({ suiteIds = null, scenarioIds = null, label }) {
  if (running.value) return
  running.value = true
  runLabel.value = label
  live.value = {}
  liveErr.value = {}
  progress.value = { done: 0, total: 0 }
  pushLine({ at: new Date().toISOString(), kind: 'sum', text: '$ kpz test ' + (scenarioIds ? scenarioIds.join(' ') : suiteIds ? suiteIds.join(' ') : '--all') })
  try {
    const run = await runTests({
      suiteIds, scenarioIds,
      onEvent: e => {
        if (e.type === 'start') progress.value = { done: 0, total: e.total }
        else if (e.type === 'scenario') live.value = { ...live.value, [e.scenarioId]: 'running' }
        else if (e.type === 'log') pushLine(e.line)
        else if (e.type === 'result') {
          live.value = { ...live.value, [e.result.scenarioId]: e.result.result }
          if (e.result.error) liveErr.value = { ...liveErr.value, [e.result.scenarioId]: e.result.error }
          progress.value = { done: e.done, total: e.total }
        }
      },
    })
    pushLine({ at: run.finishedAt, kind: 'sum', sumKey: 'tests.log.summary', params: { id: run.id, passed: run.passed, total: run.results.length, failed: run.failed, rate: run.passRate } })
    await load(true)
    if (run.failed) toast.error(t('tests.toast.failed', { id: run.id, n: run.failed }), { action: { label: t('tests.runs.open'), onClick: () => openRun(run) } })
    else toast.success(t('tests.toast.passed', { id: run.id, n: run.passed }), { action: { label: t('tests.report'), onClick: () => report(run.id) } })
  } catch (e) {
    toast.error(errorText(t, e))
  } finally { running.value = false; runLabel.value = '' }
}
const runAll = () => start({ label: t('tests.runAll') })
const runSuite = s => start({ suiteIds: [s.id], label: tx(s.name) })
const runOne = sc => start({ scenarioIds: [sc.id], label: sc.id })

onBeforeRouteLeave(async () => {
  if (!running.value) return true
  return await confirm({ title: t('tests.leaveTitle'), message: t('tests.leaveMsg'), confirmLabel: t('tests.leaveOk'), danger: true })
})
onBeforeUnmount(() => { /* runner keeps its own promise; results are saved when it finishes */ })

async function report(runId, suiteId) {
  busyReport.value = runId + (suiteId || '')
  try { const name = await downloadRunReport(runId, { suiteId }); toast.success(t('tests.reportDone', { name })) } catch (e) { toast.error(errorText(t, e)) } finally { busyReport.value = '' }
}
function openRun(run) { runDrawer.value = { open: true, run } }

const chronological = computed(() => [...runs.value].reverse())
const chart = computed(() => ({
  categories: chronological.value.map(r => ({ key: r.id, label: r.id.replace('RUN-', '#') })),
  series: [{ key: 'rate', label: t('tests.passRate'), values: chronological.value.map(r => Math.round((r.passRate || 0) * 1000) / 10), color: 'var(--success)' }],
}))
const drawerFailed = computed(() => (runDrawer.value.run?.results || []).filter(r => r.result !== 'passed'))
const drawerBySuite = computed(() => {
  const run = runDrawer.value.run
  if (!run) return []
  return suites.value.filter(s => run.suiteIds.includes(s.id)).map(s => {
    const res = run.results.filter(r => s.scenarios.some(sc => sc.id === r.scenarioId))
    return { suite: s, total: res.length, passed: res.filter(r => r.result === 'passed').length }
  }).filter(x => x.total)
})
const pct = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))
const scopeLabel = r => t('tests.scope.' + (r.scope || 'all'))
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.intlTests')" :subtitle="t('tests.subtitle')">
      <template #actions>
        <button class="btn btn-ghost" :disabled="!lastRun || !!busyReport" @click="report(lastRun.id)"><Spinner v-if="busyReport === lastRun?.id" :size="14" /><Icon v-else name="download" :size="14" />{{ t('tests.report') }}</button>
        <button class="btn btn-primary" :disabled="running || loading" @click="runAll"><Spinner v-if="running" :size="14" /><Icon v-else name="play" :size="14" />{{ t('tests.runAll') }}</button>
      </template>
    </PageHeader>

    <div class="grid-kpi kpis">
      <KpiCard :label="t('tests.kpi.scenarios')" :value="totalScenarios" icon="flask" :loading="loading" :hint="t('tests.kpi.suites', { n: suites.length })" />
      <KpiCard :label="t('tests.kpi.lastRate')" :value="lastRun?.passRate ?? null" format="percent" :digits="1" icon="check-circle" :tone="lastRun?.failed ? 'danger' : 'success'" :loading="loading" :hint="lastRun ? t('tests.kpi.lastRun', { id: lastRun.id, version: lastRun.version }) : ''" />
      <KpiCard :label="t('tests.kpi.runs')" :value="runs.length" icon="refresh" :loading="loading" :sparkline="chronological.map(r => r.passRate * 100)" tone="success" />
      <KpiCard :label="t('tests.kpi.fixed')" :value="fixedCount" icon="wand" :loading="loading" :hint="t('tests.kpi.fixedHint')" />
    </div>

    <div class="layout">
      <div class="left">
        <template v-if="loading"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="96" /></template>
        <section v-for="s in suites" v-else :key="s.id" class="panel suite">
          <header class="sh">
            <button type="button" class="exp" :aria-expanded="!!expanded[s.id]" @click="expanded = { ...expanded, [s.id]: !expanded[s.id] }">
              <Icon :name="expanded[s.id] ? 'chevron-down' : 'chevron-right'" :size="14" />
            </button>
            <div class="st">
              <strong>{{ tx(s.name) }}</strong>
              <span class="muted">{{ t('tests.category.' + s.category) }} · {{ t('tests.scenarioCount', { n: s.scenarios.length }) }}</span>
            </div>
            <div class="bars"><MiniBars :data="s.scenarios.map(sc => ({ status: statusOf(sc) === 'running' ? 'running' : statusOf(sc), label: sc.id, tooltip: tx(sc.name) }))" :height="18" /></div>
            <div class="ss">
              <span class="tag tag-success">{{ suiteStats(s).passed }}</span>
              <span v-if="suiteStats(s).failed" class="tag tag-danger">{{ suiteStats(s).failed }}</span>
            </div>
            <button class="btn btn-ghost btn-sm" :disabled="running" @click="runSuite(s)"><Icon name="play" :size="12" />{{ t('tests.runSuite') }}</button>
          </header>
          <div v-if="expanded[s.id]" class="table-wrap">
            <table class="table-simple sc">
              <thead><tr><th>ID</th><th>{{ t('tests.cols.name') }}</th><th>{{ t('tests.cols.engine') }}</th><th>{{ t('tests.cols.result') }}</th><th class="r">{{ t('tests.cols.duration') }}</th><th /></tr></thead>
              <tbody>
                <template v-for="sc in s.scenarios" :key="sc.id">
                  <tr :class="{ active: live[sc.id] === 'running' }">
                    <td class="mono">{{ sc.id }}</td>
                    <td><button type="button" class="nm" @click="openSc = { ...openSc, [sc.id]: !openSc[sc.id] }">{{ tx(sc.name) }}</button></td>
                    <td><span class="tag">{{ t('tests.engines.' + sc.engine) }}</span></td>
                    <td>
                      <span v-if="live[sc.id] === 'running'" class="run"><Spinner :size="12" />{{ t('status.running') }}</span>
                      <StatusPill v-else :status="statusOf(sc)" size="sm" />
                    </td>
                    <td class="r num muted">{{ sc.lastDurationMs ? t('common.ms', { n: sc.lastDurationMs }) : '-' }}</td>
                    <td class="r"><button class="btn btn-ghost btn-xs" :disabled="running" :aria-label="t('tests.runOne') + ' ' + sc.id" @click="runOne(sc)"><Icon name="play" :size="11" />{{ t('tests.runOne') }}</button></td>
                  </tr>
                  <tr v-if="openSc[sc.id] || liveErr[sc.id]" class="det">
                    <td />
                    <td colspan="5">
                      <div class="dgrid">
                        <div><span class="lbl">{{ t('tests.steps') }}</span><ol><li v-for="(st, i) in sc.steps" :key="i">{{ tx(st) }}</li></ol></div>
                        <div><span class="lbl">{{ t('tests.expected') }}</span><p>{{ tx(sc.expected) }}</p>
                          <p v-if="liveErr[sc.id]" class="err"><Icon name="x-circle" :size="12" /> {{ tx(liveErr[sc.id]) }}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="right">
        <div v-if="running || progress.total" class="panel panel-pad prog">
          <div class="pl"><strong>{{ running ? t('tests.running', { label: runLabel }) : t('tests.finished') }}</strong><span class="num muted">{{ progress.done }}/{{ progress.total }}</span></div>
          <ProgressBar :value="pct" :tone="Object.values(live).includes('failed') ? 'danger' : 'success'" size="sm" />
        </div>
        <TestLog :lines="shownLines" :running="running" :height="380" @clear="lines = []" />
      </div>
    </div>

    <div class="grid-2 hist">
      <section class="panel">
        <div class="panel-head"><span class="panel-title">{{ t('tests.history') }}</span><span class="panel-sub">{{ t('tests.historySub') }}</span></div>
        <div class="panel-pad">
          <Skeleton v-if="loading" variant="rect" :height="200" />
          <BarChart v-else :categories="chart.categories" :series="chart.series" :height="220" :value-format="v => fmt.number(v, 1) + '%'" :legend="false" show-values @select="({ index }) => openRun(chronological[index])" />
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><span class="panel-title">{{ t('tests.runs.title') }}</span><span class="panel-sub">{{ t('tests.runs.sub') }}</span></div>
        <div v-if="loading" class="panel-pad"><Skeleton :lines="5" /></div>
        <EmptyState v-else-if="!runs.length" compact icon="flask" :title="t('tests.runs.empty')" :action-label="t('tests.runAll')" @action="runAll" />
        <div v-else class="table-wrap">
          <table class="table-simple runs">
            <thead><tr><th>{{ t('tests.runs.id') }}</th><th>{{ t('common.date') }}</th><th>{{ t('tests.runs.version') }}</th><th>{{ t('tests.runs.scope') }}</th><th class="r">{{ t('tests.runs.result') }}</th><th /></tr></thead>
            <tbody>
              <tr v-for="r in runs" :key="r.id" class="clk" @click="openRun(r)">
                <td class="mono">{{ r.id }}</td>
                <td><DateTime :value="r.startedAt" mode="short" /></td>
                <td><span class="tag">{{ r.version }}</span> <span class="muted">{{ t('docs.test.envs.' + r.env) }}</span></td>
                <td class="muted">{{ scopeLabel(r) }}</td>
                <td class="r"><span class="num" :class="r.failed ? 'text-danger' : 'text-success'">{{ r.passed }}/{{ r.results.length }}</span> <span class="muted num">{{ fmt.percent(r.passRate, 1) }}</span></td>
                <td class="r"><button class="btn-icon" :aria-label="t('tests.report')" :title="t('tests.report')" :disabled="busyReport === r.id" @click.stop="report(r.id)"><Spinner v-if="busyReport === r.id" :size="13" /><Icon v-else name="download" :size="14" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <Drawer v-model:open="runDrawer.open" :title="runDrawer.run?.id || ''" :subtitle="runDrawer.run ? t('tests.runs.drawerSub', { version: runDrawer.run.version, by: runDrawer.run.triggeredBy, date: fmt.dateTime(runDrawer.run.startedAt) }) : ''" width="620px">
      <template #actions>
        <button v-if="runDrawer.run" class="btn btn-ghost btn-sm" :disabled="!!busyReport" @click="report(runDrawer.run.id)"><Icon name="download" :size="13" />{{ t('tests.reportShort') }}</button>
      </template>
      <div v-if="runDrawer.run" class="stack">
        <div class="grid-3 mini">
          <div class="mk"><span class="muted">{{ t('tests.runs.passed') }}</span><strong class="num text-success">{{ runDrawer.run.passed }}</strong></div>
          <div class="mk"><span class="muted">{{ t('tests.runs.failed') }}</span><strong class="num" :class="{ 'text-danger': runDrawer.run.failed }">{{ runDrawer.run.failed }}</strong></div>
          <div class="mk"><span class="muted">{{ t('tests.passRate') }}</span><strong class="num">{{ fmt.percent(runDrawer.run.passRate, 1) }}</strong></div>
        </div>
        <div class="bysuite">
          <div v-for="x in drawerBySuite" :key="x.suite.id" class="bs">
            <span>{{ tx(x.suite.name) }}</span>
            <span class="num" :class="x.passed === x.total ? 'text-success' : 'text-danger'">{{ x.passed }}/{{ x.total }}</span>
            <button class="btn btn-link" :disabled="!!busyReport" @click="report(runDrawer.run.id, x.suite.id)">PDF</button>
          </div>
        </div>
        <h4 class="section-title">{{ drawerFailed.length ? t('tests.runs.failures') : t('tests.runs.allPassed') }}</h4>
        <div v-for="f in drawerFailed" :key="f.scenarioId" class="fail">
          <div class="fh"><span class="mono">{{ f.scenarioId }}</span><strong>{{ tx(scenarioById.get(f.scenarioId)?.name) }}</strong><StatusPill :status="f.result" size="sm" /></div>
          <dl class="kv">
            <dt>{{ t('tests.runs.error') }}</dt><dd class="text-danger">{{ tx(f.error) || '-' }}</dd>
            <dt>{{ t('tests.runs.fixNote') }}</dt><dd>{{ f.fixNote ? tx(f.fixNote) : t('tests.runs.fixPending') }}</dd>
            <dt>{{ t('tests.runs.fixedIn') }}</dt><dd><span v-if="f.fixedIn" class="tag tag-success">{{ t('tests.runs.fixedInValue', { v: f.fixedIn }) }}</span><span v-else>-</span></dd>
          </dl>
        </div>
        <p v-if="!drawerFailed.length" class="muted">{{ t('tests.runs.allPassedDesc', { n: runDrawer.run.results.length }) }}</p>
      </div>
    </Drawer>
  </div>
</template>

<style scoped>
.kpis { margin-bottom: 16px; }
.layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.left, .right { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.right { position: sticky; top: calc(var(--kpz-sticky-top, 64px) + 12px); }
.suite { overflow: hidden; }
.sh { display: grid; grid-template-columns: 28px minmax(0, 1fr) 150px auto auto; gap: 12px; align-items: center; padding: 14px 16px; }
.exp { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line-1); background: var(--surface); display: grid; place-items: center; cursor: pointer; color: var(--ink-2); }
.st { display: flex; flex-direction: column; min-width: 0; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.ss { display: flex; gap: 4px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.sc { font-size: 13px; border-top: 1px solid var(--line-1); }
.sc tr.active td { background: var(--accent-soft); }
.nm { background: none; border: 0; padding: 0; font: inherit; color: var(--ink-1); cursor: pointer; text-align: left; }
.nm:hover { color: var(--accent); text-decoration: underline; }
.run { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); font-size: 12.5px; }
.r { text-align: right; }
.det td { background: var(--bg-2); }
.dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; font-size: 12.5px; }
.dgrid ol { margin: 4px 0 0; padding-left: 18px; }
.dgrid p { margin: 4px 0 0; }
.lbl { font-weight: 600; color: var(--ink-2); font-size: 12px; }
.err { color: var(--danger); display: flex; gap: 4px; align-items: flex-start; }
.prog { display: flex; flex-direction: column; gap: 8px; }
.pl { display: flex; justify-content: space-between; font-size: 13px; }
.hist { margin-top: 16px; }
.hist .panel-head { flex-wrap: wrap; row-gap: 2px; }
.hist .panel-sub { white-space: normal; }
.hist > .panel { min-width: 0; }
.runs { font-size: 13px; }
.clk { cursor: pointer; }
.clk:hover td { background: var(--bg-2); }
.mini .mk { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.mini strong { font-size: 20px; }
.bysuite { display: flex; flex-direction: column; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.bs { display: grid; grid-template-columns: 1fr auto 40px; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--line-1); font-size: 13px; align-items: center; }
.bs:last-child { border-bottom: 0; }
.fail { border: 1px solid oklch(0.9 0.05 25); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.fh { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
.fail .kv { grid-template-columns: 120px 1fr; font-size: 13px; }
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .right { position: static; }
}
@media (max-width: 700px) {
  .sh { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .sh .bars, .sh .ss { display: none; }
  .dgrid { grid-template-columns: 1fr; }
}
</style>
