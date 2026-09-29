<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import FilterBar, { inRange } from '../../components/FilterBar.vue'
import DataTable from '../../components/DataTable.vue'
import StatusPill from '../../components/StatusPill.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import DateTime from '../../components/DateTime.vue'
import Drawer from '../../components/Drawer.vue'
import CodeBlock from '../../components/CodeBlock.vue'
import Spinner from '../../components/Spinner.vue'
import KpiCard from '../../components/KpiCard.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listSyncLogs, retrySync, listStores, STORE_CHANNELS } from '../../api/integrations.js'
import { channelName, errorMessage } from '../../components/integrations/storeUtils.js'

const { t, tx } = useI18n()
const route = useRoute()
const router = useRouter()

const OPS = ['order_pull', 'tracking_push', 'status_update', 'inventory']
const RESULTS = ['success', 'warning', 'error']

const loading = ref(true)
const logs = ref([])
const stores = ref([])
const search = ref('')
const filters = ref({ store: [], result: [], op: [], state: null })
const range = ref(null)
const retrying = ref(null)
const highlight = ref([])
const drawer = ref(null)
const mayManage = computed(() => can('integrations.manage'))

function initFromQuery() {
  const q = route.query
  const f = { store: [], result: [], op: [], state: null }
  if (typeof q.store === 'string' && STORE_CHANNELS.includes(q.store)) f.store = [q.store]
  if (typeof q.result === 'string' && RESULTS.includes(q.result)) f.result = [q.result]
  if (typeof q.op === 'string' && OPS.includes(q.op)) f.op = [q.op]
  if (q.open === '1') f.state = 'open'
  filters.value = f
}

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const [l, s] = await Promise.all([listSyncLogs(), stores.value.length ? Promise.resolve(stores.value) : listStores()])
    logs.value = l
    stores.value = s
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
  }
}

const chips = computed(() => [
  { key: 'store', label: t('integrations.logs.store'), icon: 'store', options: STORE_CHANNELS.map(ch => ({ value: ch, label: channelName(ch), count: logs.value.filter(l => l.store === ch).length })) },
  { key: 'result', label: t('integrations.logs.result'), options: RESULTS.map(r => ({ value: r, label: t('status.' + r), count: logs.value.filter(l => l.result === r).length })) },
  { key: 'op', label: t('integrations.logs.op'), options: OPS.map(o => ({ value: o, label: t('core.integrations.ops.' + o) })) },
  { key: 'state', label: t('integrations.logs.state'), multiple: false, options: [{ value: 'open', label: t('integrations.logs.openErrors'), count: logs.value.filter(isOpen).length }, { value: 'resolved', label: t('integrations.logs.resolved') }] },
])

function isOpen(l) { return l.result === 'error' && !l.resolvedAt }

const rows = computed(() => {
  const f = filters.value
  const q = search.value.trim().toLowerCase()
  return logs.value.filter(l => {
    if (f.store?.length && !f.store.includes(l.store)) return false
    if (f.result?.length && !f.result.includes(l.result)) return false
    if (f.op?.length && !f.op.includes(l.op)) return false
    if (f.state === 'open' && !isOpen(l)) return false
    if (f.state === 'resolved' && !l.resolvedAt) return false
    if (!inRange(l.at, range.value)) return false
    if (q && ![l.id, l.orderId, l.trackingNo, tx(l.detail), channelName(l.store)].some(v => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
})
const hasFilters = computed(() => !!(search.value || filters.value.store?.length || filters.value.result?.length || filters.value.op?.length || filters.value.state || range.value))

const kpi = computed(() => {
  const day = new Date(Date.now() - 864e5).toISOString()
  const last = logs.value.filter(l => l.at >= day)
  return {
    today: last.length,
    success: logs.value.length ? logs.value.filter(l => l.result === 'success').length / logs.value.length : 0,
    open: logs.value.filter(isOpen).length,
    pushes: logs.value.filter(l => l.op === 'tracking_push' && l.result === 'success').length,
  }
})

const columns = computed(() => [
  { key: 'at', label: t('integrations.logs.time'), sortable: true, width: 150 },
  { key: 'store', label: t('integrations.logs.store'), sortable: true, width: 150 },
  { key: 'op', label: t('integrations.logs.op'), sortable: true, width: 150, format: v => t('core.integrations.ops.' + v) },
  { key: 'result', label: t('integrations.logs.result'), sortable: true, width: 150 },
  { key: 'detail', label: t('integrations.logs.detail'), value: r => tx(r.detail) },
  { key: 'ref', label: t('integrations.logs.ref'), hideBelow: 'lg', width: 170, value: r => r.orderId ?? r.trackingNo ?? '' },
  { key: 'actions', label: '', isAction: true, width: 120, align: 'right', hideable: false },
])

function clearFilters() {
  search.value = ''
  filters.value = { store: [], result: [], op: [], state: null }
  range.value = null
  router.replace({ query: {} })
}

async function retry(log) {
  if (retrying.value) return
  retrying.value = log.id
  try {
    const r = await retrySync(log.id)
    toast.success(t('integrations.logs.retried', { id: log.id }))
    await load({ silent: true })
    highlight.value = [r.log.id, log.id]
    if (drawer.value?.id === log.id) drawer.value = logs.value.find(l => l.id === log.id) ?? null
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    retrying.value = null
  }
}

function openRow(row) { drawer.value = row }
const retriedBy = computed(() => drawer.value ? logs.value.find(l => l.retryOf === drawer.value.id) : null)
const retryOfLog = computed(() => drawer.value?.retryOf ? logs.value.find(l => l.id === drawer.value.retryOf) : null)
function storeConnected(ch) { return stores.value.find(s => s.channel === ch)?.status === 'connected' }

watch(() => route.query, () => initFromQuery())
onMounted(() => { initFromQuery(); load() })
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.syncLogs')" :subtitle="t('integrations.logs.subtitle')">
      <template #actions>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" /> {{ t('common.refresh') }}</button>
      </template>
    </PageHeader>

    <div class="grid-kpi kpis">
      <KpiCard :label="t('integrations.logs.kpi24h')" :value="loading ? null : kpi.today" :loading="loading" icon="sync" />
      <KpiCard :label="t('integrations.logs.kpiSuccess')" :value="loading ? null : kpi.success" format="percent" :digits="1" :loading="loading" icon="check-circle" />
      <KpiCard :label="t('integrations.logs.kpiPushes')" :value="loading ? null : kpi.pushes" :loading="loading" icon="upload" />
      <KpiCard :label="t('integrations.logs.kpiOpen')" :value="loading ? null : kpi.open" :loading="loading" icon="alert" :tone="kpi.open ? 'danger' : 'success'" clickable @click="filters = { ...filters, state: 'open' }" />
    </div>

    <div class="panel">
      <div class="fb">
        <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('integrations.logs.searchPh')" @clear="clearFilters" />
      </div>
      <DataTable :columns="columns" :rows="rows" :loading="loading" :filtered="hasFilters" :default-sort="{ key: 'at', dir: 'desc' }"
        storage-key="sync-logs" :highlight-keys="highlight" :empty-title="t('integrations.logs.emptyTitle')" :empty-desc="t('integrations.logs.emptyDesc')" empty-icon="sync"
        :row-class="r => (isOpen(r) ? 'row-open' : '')" @clear-filters="clearFilters" @row-click="openRow">
        <template #cell-at="{ row }"><DateTime :value="row.at" /></template>
        <template #cell-store="{ row }"><ChannelLogo :code="row.store" :size="22" show-name /></template>
        <template #cell-result="{ row }">
          <div class="res">
            <StatusPill :status="row.result" size="sm" />
            <span v-if="row.resolvedAt" class="tag tag-success">{{ t('integrations.logs.resolvedTag') }}</span>
            <span v-else-if="row.retryOf" class="tag">{{ t('integrations.logs.retryTag') }}</span>
          </div>
        </template>
        <template #cell-detail="{ row }"><span class="detail">{{ tx(row.detail) }}</span></template>
        <template #cell-ref="{ row }">
          <RouterLink v-if="row.orderId" :to="`/orders/${row.orderId}`" class="link mono" data-no-row-click>{{ row.orderId }}</RouterLink>
          <div v-if="row.trackingNo" class="mono sub truncate" :title="row.trackingNo">{{ row.trackingNo }}</div>
          <span v-if="!row.orderId && !row.trackingNo">-</span>
        </template>
        <template #cell-actions="{ row }">
          <button v-if="isOpen(row)" class="btn btn-ghost btn-xs" :disabled="retrying === row.id || !mayManage || !storeConnected(row.store)" :title="!mayManage ? t('common.noPermission') : !storeConnected(row.store) ? t('core.errors.STORE_NOT_CONNECTED') : ''" @click.stop="retry(row)">
            <Spinner v-if="retrying === row.id" :size="12" /><Icon v-else name="refresh" :size="12" /> {{ t('common.retry') }}
          </button>
          <span v-else aria-hidden="true"></span>
        </template>
      </DataTable>
    </div>

    <Drawer :open="!!drawer" :title="drawer ? drawer.id : ''" :subtitle="drawer ? `${channelName(drawer.store)} · ${t('core.integrations.ops.' + drawer.op)}` : ''" width="520px" @update:open="v => !v && (drawer = null)">
      <div v-if="drawer" class="stack">
        <div class="res"><StatusPill :status="drawer.result" /><span v-if="drawer.resolvedAt" class="tag tag-success">{{ t('integrations.logs.resolvedTag') }}</span></div>
        <p class="drawer-detail">{{ tx(drawer.detail) }}</p>
        <dl class="kv">
          <dt>{{ t('integrations.logs.time') }}</dt><dd><DateTime :value="drawer.at" mode="absolute" /></dd>
          <dt>{{ t('integrations.logs.store') }}</dt><dd>{{ channelName(drawer.store) }}</dd>
          <dt>{{ t('integrations.logs.op') }}</dt><dd>{{ t('core.integrations.ops.' + drawer.op) }}</dd>
          <dt>{{ t('integrations.logs.attempts') }}</dt><dd>{{ drawer.attempts ?? 1 }}</dd>
          <template v-if="drawer.count != null"><dt>{{ t('integrations.logs.count') }}</dt><dd>{{ drawer.count }}</dd></template>
          <template v-if="drawer.orderId"><dt>{{ t('integrations.logs.order') }}</dt><dd><RouterLink class="link" :to="`/orders/${drawer.orderId}`">{{ drawer.orderId }}</RouterLink></dd></template>
          <template v-if="drawer.trackingNo"><dt>{{ t('integrations.logs.tracking') }}</dt><dd class="mono">{{ drawer.trackingNo }}</dd></template>
          <template v-if="drawer.resolvedAt"><dt>{{ t('integrations.logs.resolvedAt') }}</dt><dd><DateTime :value="drawer.resolvedAt" mode="absolute" /></dd></template>
          <template v-if="retriedBy"><dt>{{ t('integrations.logs.retriedBy') }}</dt><dd><button class="btn-link" @click="drawer = retriedBy">{{ retriedBy.id }}</button></dd></template>
          <template v-if="retryOfLog"><dt>{{ t('integrations.logs.retryOf') }}</dt><dd><button class="btn-link" @click="drawer = retryOfLog">{{ retryOfLog.id }}</button></dd></template>
        </dl>
        <CodeBlock :code="drawer" :title="t('integrations.logs.raw')" :max-height="280" />
      </div>
      <template v-if="drawer && isOpen(drawer)" #footer>
        <button class="btn btn-primary btn-sm" :disabled="retrying === drawer.id || !mayManage || !storeConnected(drawer.store)" @click="retry(drawer)">
          <Spinner v-if="retrying === drawer.id" :size="13" /><Icon v-else name="refresh" :size="14" /> {{ t('common.retry') }}
        </button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.kpis { margin-bottom: 16px; }
.fb { padding: 12px 14px; border-bottom: 1px solid var(--line-1); }
.res { display: flex; align-items: flex-start; gap: 4px; flex-direction: column; }
.res .tag { height: 18px; font-size: 10.5px; padding: 0 6px; white-space: nowrap; }
.detail { color: var(--ink-1); }
.mono { font-family: var(--font-mono); font-size: 12px; }
.sub { color: var(--ink-3); max-width: 170px; }
.drawer-detail { margin: 0; font-size: 14px; line-height: 1.55; }
:deep(.row-open) td { background: oklch(0.985 0.012 25); }
</style>
