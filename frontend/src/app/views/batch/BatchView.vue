<script setup>
// Batch operations (spec 5.7): entry from an order selection (?orders= or ?ids=) or all waiting orders,
// 1 pre-check, 2 AI batch optimization, 3 confirm, 4 processing; plus batch history (?tab=history).
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import Stepper from '../../components/Stepper.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import FeatureLock from '../plan/FeatureLock.vue'
import PrecheckStep from './PrecheckStep.vue'
import OptimizeStep from './OptimizeStep.vue'
import ConfirmStep from './ConfirmStep.vue'
import ProcessStep from './ProcessStep.vue'
import BatchHistory from './BatchHistory.vue'
import { listOrders } from '../../api/orders.js'
import { batchOptimize, summarizeAssignments } from '../../api/ai.js'
import { db } from '../../store/db.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t, fmt } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()

const TABS = ['run', 'history']
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'run')
const tabs = computed(() => [
  { key: 'run', label: t('batch.tabs.run'), icon: 'layers' },
  { key: 'history', label: t('batch.tabs.history'), icon: 'clock', count: db.all('batches').length || undefined },
])
watch(tab, v => { if (route.query.tab !== v) router.replace({ query: { ...route.query, tab: v } }) })
watch(() => route.query.tab, v => { if (TABS.includes(v) && v !== tab.value) tab.value = v })

// ---------------------------------------------------------------- scope
function queryIds() {
  const raw = route.query.orders ?? route.query.ids
  const s = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  return [...new Set(String(s).split(',').map(x => x.trim()).filter(Boolean))]
}
const selectedIds = ref(queryIds())
const mode = computed(() => (selectedIds.value.length ? 'selected' : 'all'))
const loading = ref(true)
const allOrders = ref([])

const isEligible = o => o.status === 'awaiting_shipment' && !o.shipmentId
const scopeOrders = computed(() => {
  if (mode.value === 'all') return allOrders.value.filter(isEligible)
  const set = new Set(selectedIds.value)
  return allOrders.value.filter(o => set.has(o.id))
})
const eligible = computed(() => scopeOrders.value.filter(isEligible))
const skipped = computed(() => scopeOrders.value.filter(o => !isEligible(o)).map(order => ({ order, reason: order.status })))
const excluded = ref([])
const included = computed(() => eligible.value.filter(o => !excluded.value.includes(o.id)))
const orderValue = list => list.reduce((s, o) => s + (o.items ?? []).reduce((a, i) => a + (Number(i.unitPrice) || 0) * (Number(i.qty) || 1), 0), 0)

async function loadOrders({ initial = false } = {}) {
  if (initial) loading.value = true
  try {
    allOrders.value = await listOrders()
    if (initial) excluded.value = eligible.value.filter(o => (o.addressCheck?.score ?? 100) < 70).map(o => o.id)
    else excluded.value = excluded.value.filter(id => eligible.value.some(o => o.id === id))
  } catch (e) {
    toast.error(errorText(e))
  } finally { loading.value = false }
}
onMounted(() => loadOrders({ initial: true }))

function useAll() {
  selectedIds.value = []
  const q = { ...route.query }
  delete q.orders
  delete q.ids
  router.replace({ query: q })
  resetRun()
  excluded.value = eligible.value.filter(o => (o.addressCheck?.score ?? 100) < 70).map(o => o.id)
}

// ---------------------------------------------------------------- steps
const step = ref(0)
const maxReached = ref(0)
const running = ref(false) // processing in progress (locks navigation)
const finished = ref(false)
const steps = computed(() => [
  { key: 'precheck', label: t('batch.steps.precheck'), description: t('batch.steps.precheckDesc') },
  { key: 'optimize', label: t('batch.steps.optimize'), description: t('batch.steps.optimizeDesc') },
  { key: 'confirm', label: t('batch.steps.confirm'), description: t('batch.steps.confirmDesc') },
  { key: 'process', label: t('batch.steps.process'), description: t('batch.steps.processDesc') },
])
const canNavigate = target => !running.value && !finished.value && target <= maxReached.value && target < 3
function go(i) {
  step.value = i
  if (i > maxReached.value) maxReached.value = i
}

// ---------------------------------------------------------------- optimization
const opt = ref(null)
const optError = ref('')
const optLoading = ref(false)
const optProgress = ref({ pct: 0, done: 0, total: 0 })
const weight = ref(db.doc('user')?.preferences?.optimizerWeight ?? 0.6)
const assignments = ref([])
const optimizedFor = ref('')

const serviceEstimate = computed(() => {
  const domestic = db.all('carriers').filter(c => c.status === 'active' && c.type !== 'international')
  const own = db.all('carrier_accounts').filter(a => a.status === 'connected')
  const ownSvc = own.reduce((s, a) => s + (domestic.find(c => c.code === a.carrier)?.services?.length ?? 0), 0)
  return domestic.reduce((s, c) => s + (c.services?.length ?? 0), 0) + ownSvc
})

async function runOptimize() {
  const ids = included.value.map(o => o.id)
  optLoading.value = true
  optError.value = ''
  optProgress.value = { pct: 0, done: 0, total: ids.length }
  try {
    const res = await batchOptimize(ids, {
      weight: weight.value,
      onProgress: (pct, p) => { optProgress.value = { pct, done: p.done, total: p.total } },
    })
    opt.value = res
    assignments.value = res.assignments.map(a => ({ ...a, aiQuoteKey: a.aiQuoteKey ?? a.quote.key }))
    optimizedFor.value = ids.join(',') + '|' + weight.value
  } catch (e) {
    optError.value = errorText(e)
  } finally { optLoading.value = false }
}

function toOptimize() {
  go(1)
  const key = included.value.map(o => o.id).join(',') + '|' + weight.value
  if (!opt.value || optimizedFor.value !== key) runOptimize()
}

const totals = computed(() => (assignments.value.length ? summarizeAssignments(assignments.value) : null))

function selectService(orderId, key) {
  const a = assignments.value.find(x => x.orderId === orderId)
  const alt = a?.alternatives.find(r => r.quote.key === key)
  if (!alt) return
  a.quote = alt.quote
  a.score = alt.score
  a.components = alt.components
  a.savings = a.defaultQuote ? Math.round((a.defaultQuote.total - alt.quote.total) * 100) / 100 : 0
}
function resetAll() {
  for (const a of assignments.value) if (a.quote.key !== a.aiQuoteKey) selectService(a.orderId, a.aiQuoteKey)
}
function setWeight(w) {
  weight.value = w
  runOptimize()
}

// ---------------------------------------------------------------- processing
const processList = ref([])
function startProcessing() {
  processList.value = assignments.value.map(a => ({ ...a }))
  running.value = true
  go(3)
}
function onProcessed() {
  running.value = false
  finished.value = true
  loadOrders()
}
function resetRun() {
  step.value = 0
  maxReached.value = 0
  opt.value = null
  optimizedFor.value = ''
  assignments.value = []
  processList.value = []
  running.value = false
  finished.value = false
}
async function newBatch() {
  selectedIds.value = []
  const q = { ...route.query }
  delete q.orders
  delete q.ids
  router.replace({ query: { ...q, tab: 'run' } })
  resetRun()
  await loadOrders({ initial: true })
}
function showHistory() { tab.value = 'history' }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.batch')" :subtitle="t('batch.subtitle')" />
    <FeatureLock feature="batch">
      <div class="tabs-wrap"><Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.batch')" /></div>

      <BatchHistory v-if="tab === 'history'" @start="tab = 'run'" />

      <template v-else>
        <!-- loading -->
        <div v-if="loading" class="panel pad"><Skeleton :lines="4" /></div>

        <!-- nothing to do -->
        <div v-else-if="!eligible.length && !finished" class="panel">
          <EmptyState v-if="mode === 'all'" icon="box" :title="t('batch.empty.title')" :description="t('batch.empty.desc')"
            :action-label="t('batch.empty.action')" action-icon="list" @action="router.push({ name: 'orders' })" />
          <EmptyState v-else icon="alert" :title="t('batch.empty.noneEligible')" :description="t('batch.empty.noneEligibleDesc')"
            :action-label="t('batch.scope.useAll')" action-icon="layers" @action="useAll" />
        </div>

        <template v-else>
          <!-- scope -->
          <div v-if="step < 3" class="scope panel">
            <div class="scope-main">
              <span class="scope-ico"><Icon :name="mode === 'selected' ? 'check-circle' : 'layers'" :size="18" /></span>
              <div>
                <div class="scope-title">{{ mode === 'selected' ? t('batch.scope.selected') : t('batch.scope.all') }}</div>
                <div class="scope-sub">
                  {{ t('batch.scope.count', { n: fmt.number(eligible.length) }) }} · {{ t('batch.scope.value', { amount: fmt.money(orderValue(eligible)) }) }}
                  <template v-if="excluded.length"> · <span class="warn-t">{{ t('batch.scope.excludedN', { n: excluded.length }) }}</span></template>
                </div>
              </div>
            </div>
            <div class="scope-actions">
              <span class="tag tag-accent">{{ t('batch.scope.ready', { n: included.length }) }}</span>
              <button v-if="mode === 'selected' && step === 0" class="btn btn-ghost btn-sm" @click="useAll"><Icon name="layers" :size="13" /> {{ t('batch.scope.useAll') }}</button>
              <RouterLink v-if="step === 0" :to="{ name: 'orders' }" class="btn btn-ghost btn-sm"><Icon name="list" :size="13" /> {{ t('batch.scope.pickOrders') }}</RouterLink>
            </div>
          </div>

          <div class="stepper-wrap panel">
            <Stepper v-model:current="step" :steps="steps" :max-reached="maxReached" :can-navigate="canNavigate" :aria-label="t('nav.batch')" />
          </div>

          <!-- step 1: pre-check -->
          <template v-if="step === 0">
            <PrecheckStep :orders="eligible" :skipped="skipped" v-model:excluded="excluded" @refresh="loadOrders()" />
            <div class="foot">
              <span v-if="!included.length" class="warn-t small"><Icon name="alert" :size="13" /> {{ t('batch.pre.noneLeft') }}</span>
              <button class="btn btn-primary" :disabled="!included.length" @click="toOptimize">
                {{ t('batch.pre.next', { n: included.length }) }} <Icon name="arrow" :size="14" />
              </button>
            </div>
          </template>

          <!-- step 2: optimization -->
          <OptimizeStep v-else-if="step === 1"
            :loading="optLoading" :progress="optProgress" :error="optError" :result="opt" :assignments="assignments" :totals="totals"
            :weight="weight" :service-estimate="serviceEstimate" :order-count="included.length"
            @select="selectService" @reset-all="resetAll" @rerun="runOptimize" @weight="setWeight"
            @back="go(0)" @next="go(2)" />

          <!-- step 3: confirm -->
          <ConfirmStep v-else-if="step === 2" :assignments="assignments" :totals="totals" @back="go(1)" @create="startProcessing" />

          <!-- step 4: processing -->
          <ProcessStep v-else :assignments="processList" :totals="totals" :weight="weight"
            @done="onProcessed" @new="newBatch" @history="showHistory" />
        </template>
      </template>
    </FeatureLock>
  </div>
</template>

<style scoped>
.tabs-wrap { margin: 4px 0 14px; }
.pad { padding: 20px; }
.scope { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; flex-wrap: wrap; }
.scope-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.scope-ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.scope-title { font-weight: 600; }
.scope-sub { font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
.scope-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.stepper-wrap { margin: 12px 0 14px; padding: 14px 18px; }
.foot { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.warn-t { color: oklch(0.55 0.14 60); display: inline-flex; align-items: center; gap: 4px; }
.small { font-size: 12.5px; }
</style>
