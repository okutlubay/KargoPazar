<script setup>
// Batch step 4, processing (spec 5.7): labels row by row (80-150 ms per row on screen), summary,
// one combined PDF (4x6, grouped by carrier) and "Create manifests".
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Spinner from '../../components/Spinner.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import StatusPill from '../../components/StatusPill.vue'
import TopUpModal from '../../components/billing/TopUpModal.vue'
import { createShipment } from '../../api/shipments.js'
import { createManifestsForShipments } from '../../api/manifests.js'
import { newBatchId, recordBatch, updateBatch, attachBatchManifests } from '../../api/ops.js'
import { summarizeAssignments } from '../../api/ai.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({
  assignments: { type: Array, required: true },
  totals: { type: Object, default: null },
  weight: { type: Number, default: 0.6 },
})
const emit = defineEmits(['done', 'new', 'history'])

const CONCURRENCY = 12
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rand = (a, b) => Math.round(a + Math.random() * (b - a))

const batchId = ref('')
const rows = reactive(props.assignments.map(a => ({ a, status: 'queued', shipment: null, error: '', code: '' })))
const running = ref(false)
const stopRequested = ref(false)
const recorded = ref(false)
const manifests = ref([])
const busy = ref('')
const showTopUp = ref(false)
const listEl = ref(null)

const done = computed(() => rows.filter(r => r.status === 'ok' || r.status === 'fail' || r.status === 'skipped').length)
const okRows = computed(() => rows.filter(r => r.status === 'ok'))
const failRows = computed(() => rows.filter(r => r.status === 'fail' || r.status === 'skipped'))
const pct = computed(() => (rows.length ? (done.value / rows.length) * 100 : 0))
const charged = computed(() => Math.round(okRows.value.reduce((s, r) => s + (r.shipment?.walletCharge ?? 0), 0) * 100) / 100)
const okTotals = computed(() => (okRows.value.length ? summarizeAssignments(okRows.value.map(r => r.a)).totals : null))
const fundsFailed = computed(() => rows.some(r => r.code === 'INSUFFICIENT_FUNDS'))

async function createOne(row) {
  const a = row.a
  const draft = {
    orderId: a.orderId, hub: a.hub, quoteKey: a.quote.key, pkg: a.package, weight: props.weight,
    ignoreHubRule: true, source: 'batch', batchId: batchId.value,
  }
  try {
    return { ok: true, res: await createShipment(draft) }
  } catch (e) {
    if (e?.code === 'QUOTE_UNAVAILABLE') {
      try { return { ok: true, res: await createShipment({ ...draft, quoteKey: undefined }) } } catch (e2) { return { ok: false, e: e2 } }
    }
    return { ok: false, e }
  }
}

async function run(list) {
  running.value = true
  stopRequested.value = false
  const promises = new Array(list.length)
  let launched = 0
  const launchUpTo = n => { while (launched < Math.min(n, list.length) && !stopRequested.value) { promises[launched] = createOne(list[launched]); launched++ } }
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    launchUpTo(i + CONCURRENCY)
    if (!promises[i]) { row.status = 'skipped'; row.error = t('batch.proc.skipped'); continue }
    row.status = 'working'
    scrollTo(i)
    await sleep(rand(80, 150))
    const r = await promises[i]
    if (r.ok) { row.status = 'ok'; row.shipment = r.res.shipment; row.error = ''; row.code = '' }
    else { row.status = 'fail'; row.error = errorText(r.e); row.code = r.e?.code ?? '' }
  }
  running.value = false
}

function scrollTo(i) {
  const el = listEl.value?.querySelector(`[data-i="${i}"]`)
  if (el && listEl.value) listEl.value.scrollTop = Math.max(0, el.offsetTop - listEl.value.clientHeight / 2)
}

function batchPayload() {
  const ok = okRows.value
  const tot = okTotals.value
  const hubs = {}
  for (const r of ok) hubs[r.shipment.hub] = (hubs[r.shipment.hub] ?? 0) + 1
  return {
    orderIds: ok.map(r => r.a.orderId),
    shipmentIds: ok.map(r => r.shipment.id),
    failed: failRows.value.length,
    hubs,
    totalCost: ok.reduce((s, r) => s + (r.shipment.total ?? 0), 0),
    defaultCost: tot?.default.cost ?? 0,
    savings: tot?.savings ?? 0,
    savingsPct: tot?.savingsPct ?? 0,
    avgEtaDays: tot?.ai.avgEtaDays ?? null,
    weight: props.weight,
  }
}

async function start() {
  batchId.value = newBatchId()
  await run(rows)
  try {
    await recordBatch({ id: batchId.value, ...batchPayload() })
    recorded.value = true
  } catch (e) { toast.error(errorText(e)) }
  emit('done')
}

async function retryFailed() {
  const list = rows.filter(r => r.status === 'fail' || r.status === 'skipped')
  if (!list.length) return
  list.forEach(r => { r.status = 'queued'; r.error = ''; r.code = '' })
  await run(list)
  try {
    if (recorded.value) await updateBatch(batchId.value, batchPayload())
    else { await recordBatch({ id: batchId.value, ...batchPayload() }); recorded.value = true }
  } catch (e) { toast.error(errorText(e)) }
  emit('done')
}

function stop() { stopRequested.value = true }

async function downloadPdf() {
  busy.value = 'pdf'
  try {
    const d = await import('../../docs/index.js')
    d.downloadCombinedLabels(okRows.value.map(r => r.shipment), { title: batchId.value })
    toast.success(t('batch.proc.pdfReady', { n: okRows.value.length }))
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = '' }
}

async function makeManifests() {
  busy.value = 'mnf'
  try {
    const list = await createManifestsForShipments(okRows.value.map(r => r.shipment.id))
    manifests.value = list
    if (recorded.value) await attachBatchManifests(batchId.value, list.map(m => m.id))
    toast.success(t('batch.proc.manifestsDone', { n: list.length }))
  } catch (e) { toast.error(errorText(e, ['manifests.errors'])) } finally { busy.value = '' }
}

onBeforeRouteLeave(() => {
  if (!running.value) return true
  return window.confirm(t('batch.proc.leaveWarn'))
})
function beforeUnload(e) { if (running.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); start() })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); stopRequested.value = true })
</script>

<template>
  <div class="proc">
    <section class="panel head">
      <div class="head-l">
        <span class="ico" :class="{ ok: !running && !failRows.length, warn: !running && failRows.length }">
          <Spinner v-if="running" :size="18" />
          <Icon v-else :name="failRows.length ? 'alert' : 'check-circle'" :size="18" />
        </span>
        <div>
          <div class="panel-title">{{ running ? t('batch.proc.running') : t('batch.proc.doneTitle') }}</div>
          <div class="panel-sub">
            <template v-if="running">{{ t('batch.proc.runningDesc', { done, total: rows.length }) }} · <span class="mono">{{ batchId }}</span></template>
            <template v-else>{{ t('batch.proc.doneDesc', { id: batchId, ok: okRows.length, failed: failRows.length }) }}</template>
          </div>
        </div>
      </div>
      <button v-if="running" class="btn btn-ghost btn-sm" :disabled="stopRequested" @click="stop"><Icon name="pause" :size="13" /> {{ t('batch.proc.stop') }}</button>
    </section>
    <ProgressBar :value="pct" :tone="!running && failRows.length ? 'warning' : running ? 'accent' : 'success'" size="md" show-value />

    <!-- summary -->
    <section v-if="!running" class="panel sum">
      <div class="stats">
        <div class="stat"><div class="k">{{ t('batch.proc.success') }}</div><div class="v num ok-t">{{ fmt.number(okRows.length) }}</div></div>
        <div class="stat"><div class="k">{{ t('batch.proc.failed') }}</div><div class="v num" :class="failRows.length ? 'neg-t' : ''">{{ fmt.number(failRows.length) }}</div></div>
        <div class="stat"><div class="k">{{ t('batch.proc.totalCharged') }}</div><div class="v num">{{ fmt.money(charged) }}</div></div>
        <div class="stat"><div class="k">{{ t('batch.proc.savings') }}</div><div class="v num ok-t">{{ fmt.money(okTotals?.savings ?? 0) }}</div></div>
      </div>
      <div class="actions">
        <button class="btn btn-accent" :disabled="!okRows.length || !!busy" @click="downloadPdf">
          <Spinner v-if="busy === 'pdf'" :size="14" /><Icon v-else name="download" :size="14" /> {{ t('batch.proc.pdf') }}
        </button>
        <button class="btn btn-primary" :disabled="!okRows.length || !!busy || manifests.length > 0" @click="makeManifests">
          <Spinner v-if="busy === 'mnf'" :size="14" /><Icon v-else name="file" :size="14" /> {{ t('batch.proc.manifests') }}
        </button>
        <button v-if="failRows.length" class="btn btn-ghost" :disabled="!!busy" @click="retryFailed"><Icon name="refresh" :size="14" /> {{ t('batch.proc.retryFailed') }}</button>
        <button v-if="fundsFailed" class="btn btn-ghost" @click="showTopUp = true"><Icon name="wallet" :size="14" /> {{ t('batch.confirm.topUp') }}</button>
        <span class="spacer" />
        <button class="btn btn-ghost" @click="emit('history')"><Icon name="clock" :size="14" /> {{ t('batch.proc.viewHistory') }}</button>
        <button class="btn btn-ghost" @click="emit('new')"><Icon name="plus" :size="14" /> {{ t('batch.proc.newBatch') }}</button>
      </div>
      <div class="hint"><Icon name="info" :size="12" /> {{ t('batch.proc.pdfHint') }}</div>
      <div v-if="manifests.length" class="mnf">
        <div class="k">{{ t('batch.proc.manifestsCreated') }}</div>
        <div class="mnf-list">
          <RouterLink v-for="m in manifests" :key="m.id" :to="`/manifests/${m.id}`" class="mnf-item">
            <CarrierLogo :code="m.carrier" :size="22" />
            <div><div class="mono strong">{{ m.id }}</div><div class="muted">{{ t('batch.proc.manifestLine', { carrier: m.carrier, hub: m.hub, n: m.parcels ?? m.totals?.parcels ?? 0 }) }}</div></div>
            <Icon name="chevron-right" :size="14" />
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- rows -->
    <section class="panel">
      <div ref="listEl" class="rows">
        <div v-for="(r, i) in rows" :key="r.a.orderId" :data-i="i" class="row" :class="r.status">
          <span class="st">
            <Spinner v-if="r.status === 'working'" :size="14" />
            <Icon v-else-if="r.status === 'ok'" name="check-circle" :size="15" />
            <Icon v-else-if="r.status === 'fail' || r.status === 'skipped'" name="x-circle" :size="15" />
            <span v-else class="dot" />
          </span>
          <span class="mono oid">{{ r.a.orderId }}</span>
          <span class="rc hide-sm">{{ r.a.recipient }}</span>
          <span class="svc"><CarrierLogo :code="(r.shipment?.carrier) || r.a.quote.carrierCode" :size="18" /> <span class="hide-sm">{{ r.a.quote.serviceName }}</span> <span class="tag">{{ r.shipment?.hub ?? r.a.hub }}</span></span>
          <span class="res">
            <template v-if="r.status === 'ok'"><RouterLink :to="`/shipments/${r.shipment.id}`" class="link mono">{{ r.shipment.trackingNo }}</RouterLink></template>
            <template v-else-if="r.status === 'fail' || r.status === 'skipped'"><span class="neg-t small">{{ r.error }}</span></template>
            <template v-else-if="r.status === 'working'"><span class="muted">{{ t('batch.proc.working') }}</span></template>
            <template v-else><span class="muted">{{ t('batch.proc.waiting') }}</span></template>
          </span>
          <span class="amt num">{{ fmt.money(r.shipment?.total ?? r.a.quote.total) }}</span>
        </div>
      </div>
    </section>

    <TopUpModal v-model:open="showTopUp" :preset-amount="250" />
  </div>
</template>

<style scoped>
.proc { display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; }
.head-l { display: flex; gap: 12px; align-items: center; }
.ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.ico.ok { background: oklch(0.95 0.05 155); color: var(--success); }
.ico.warn { background: oklch(0.96 0.06 80); color: oklch(0.55 0.14 60); }
.sum { padding: 0 0 14px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--line-1); }
.stat { padding: 14px 20px; }
.stat + .stat { border-left: 1px solid var(--line-1); }
.k { font-size: 12px; color: var(--ink-3); }
.v { font-family: var(--font-display); font-size: 22px; font-weight: 700; margin-top: 4px; }
.ok-t { color: var(--success); }
.neg-t { color: var(--danger); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px 6px; align-items: center; }
.spacer { flex: 1; }
.hint { padding: 0 20px; font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 4px; }
.mnf { padding: 12px 20px 0; }
.mnf-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; margin-top: 8px; }
.mnf-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); color: inherit; text-decoration: none; }
.mnf-item:hover { border-color: var(--accent); }
.mnf-item > div { flex: 1; min-width: 0; }
.rows { max-height: 460px; overflow-y: auto; position: relative; }
.row { display: grid; grid-template-columns: 22px 110px minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.3fr) 90px; gap: 10px; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--line-1); font-size: 13px; transition: background .2s; }
.row:last-child { border-bottom: 0; }
.row.working { background: var(--accent-soft); }
.row.ok .st { color: var(--success); }
.row.fail .st, .row.skipped .st { color: var(--danger); }
.row.queued { color: var(--ink-3); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); margin-left: 3px; }
.st { display: inline-flex; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.strong { font-weight: 600; }
.rc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.svc { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; }
.res { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt { text-align: right; }
.muted { color: var(--ink-3); font-size: 12px; }
.small { font-size: 12px; }
@media (max-width: 760px) {
  .stats { grid-template-columns: 1fr 1fr; }
  .stat:nth-child(3) { border-left: 0; }
  .row { grid-template-columns: 22px 1fr auto 80px; }
  .hide-sm, .rc { display: none; }
  .res { grid-column: 2 / -1; }
}
</style>
