<script setup>
// Request log (spec 7.5): every request through the API layer (panel, API, webhook).
import { ref, computed, watch, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import FilterBar, { inRange } from '../FilterBar.vue'
import DataTable from '../DataTable.vue'
import DateTime from '../DateTime.vue'
import Toggle from '../Toggle.vue'
import KpiCard from '../KpiCard.vue'
import Drawer from '../Drawer.vue'
import CodeBlock from '../CodeBlock.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { listRequestLog, requestLogEntries } from '../../api/apiKeys.js'
import { errorMessage } from './storeUtils.js'

const { t, fmt } = useI18n()
const loading = ref(true)
const rows = ref([])
const search = ref('')
const filters = ref({ source: [], status: null, method: [] })
const range = ref(null)
const live = ref(true)
const highlight = ref([])
const selected = ref(null)

const liveRows = computed(() => requestLogEntries())

async function load() {
  loading.value = true
  try {
    await listRequestLog({ limit: 1 })
    rows.value = liveRows.value
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
  }
}

// Live mode follows the reactive log; new rows flash briefly
watch(liveRows, (next, prev) => {
  if (!live.value || loading.value) return
  const seen = new Set((prev ?? []).map(r => r.id))
  highlight.value = next.filter(r => !seen.has(r.id)).map(r => r.id)
  rows.value = next
})
function onLive(v) { live.value = v; if (v) rows.value = liveRows.value }

onMounted(load)

const chips = computed(() => [
  { key: 'source', label: t('apiConsole.log.source'), options: ['panel', 'api', 'webhook'].map(s => ({ value: s, label: t('apiConsole.log.sources.' + s), count: rows.value.filter(r => r.source === s).length })) },
  { key: 'status', label: t('apiConsole.log.status'), multiple: false, options: [{ value: 'ok', label: '2xx' }, { value: '4xx', label: '4xx' }, { value: '5xx', label: '5xx' }] },
  { key: 'method', label: t('apiConsole.log.method'), options: ['GET', 'POST', 'PATCH', 'DELETE'].map(m => ({ value: m, label: m })) },
])

const filtered = computed(() => {
  const f = filters.value
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => {
    if (f.source?.length && !f.source.includes(r.source)) return false
    if (f.method?.length && !f.method.includes(r.method)) return false
    if (f.status === 'ok' && r.status >= 400) return false
    if (f.status === '4xx' && !(r.status >= 400 && r.status < 500)) return false
    if (f.status === '5xx' && r.status < 500) return false
    if (!inRange(r.at, range.value)) return false
    if (q && !`${r.method} ${r.path} ${r.status} ${r.event ?? ''} ${r.id}`.toLowerCase().includes(q)) return false
    return true
  })
})
const hasFilters = computed(() => !!(search.value || filters.value.source?.length || filters.value.method?.length || filters.value.status || range.value))
function clear() { search.value = ''; filters.value = { source: [], status: null, method: [] }; range.value = null }

const stats = computed(() => {
  const day = new Date(Date.now() - 864e5).toISOString()
  const last = rows.value.filter(r => r.at >= day)
  const ms = last.map(r => r.ms).sort((a, b) => a - b)
  return {
    total: last.length,
    api: last.filter(r => r.source === 'api').length,
    errors: last.length ? last.filter(r => r.status >= 400).length / last.length : 0,
    p95: ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] : 0,
  }
})

const columns = computed(() => [
  { key: 'at', label: t('apiConsole.log.time'), sortable: true, width: 150 },
  { key: 'method', label: t('apiConsole.log.method'), width: 90 },
  { key: 'path', label: t('apiConsole.log.path') },
  { key: 'status', label: t('apiConsole.log.status'), sortable: true, width: 90 },
  { key: 'ms', label: t('apiConsole.log.duration'), sortable: true, width: 100, align: 'right' },
  { key: 'source', label: t('apiConsole.log.source'), width: 110 },
])
const tone = s => (s < 300 ? 'ok' : s < 500 ? 'warn' : 'err')
</script>

<template>
  <div class="stack">
    <div class="grid-kpi">
      <KpiCard :label="t('apiConsole.log.kpiTotal')" :value="loading ? null : stats.total" :loading="loading" icon="server" />
      <KpiCard :label="t('apiConsole.log.kpiApi')" :value="loading ? null : stats.api" :loading="loading" icon="code" />
      <KpiCard :label="t('apiConsole.log.kpiErrors')" :value="loading ? null : stats.errors" format="percent" :digits="1" :loading="loading" icon="alert" invert />
      <KpiCard :label="t('apiConsole.log.kpiP95')" :value="loading ? null : t('common.ms', { n: stats.p95 })" :loading="loading" icon="clock" />
    </div>
    <div class="panel">
      <div class="fb">
        <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('apiConsole.log.searchPh')" @clear="clear">
          <template #actions>
            <Toggle :model-value="live" size="sm" :label="t('apiConsole.log.live')" @update:model-value="onLive" />
            <button class="btn btn-ghost btn-sm" :aria-label="t('common.refresh')" :disabled="loading" @click="load()"><Icon name="refresh" :size="13" /></button>
          </template>
        </FilterBar>
      </div>
      <p class="note">{{ t('apiConsole.log.note') }}</p>
      <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" :default-sort="{ key: 'at', dir: 'desc' }" :highlight-keys="highlight"
        storage-key="request-log" dense :empty-title="t('apiConsole.log.emptyTitle')" :empty-desc="t('apiConsole.log.emptyDesc')" empty-icon="server" @clear-filters="clear" @row-click="r => (selected = r)">
        <template #cell-at="{ row }"><DateTime :value="row.at" /></template>
        <template #cell-method="{ row }"><span class="method" :class="row.method.toLowerCase()">{{ row.method }}</span></template>
        <template #cell-path="{ row }"><code class="path truncate" :title="row.path">{{ row.path }}</code><span v-if="row.event" class="ev">{{ row.event }}</span></template>
        <template #cell-status="{ row }"><span class="status" :class="tone(row.status)">{{ row.status }}</span></template>
        <template #cell-ms="{ row }"><span class="num">{{ fmt.number(row.ms) }} ms</span></template>
        <template #cell-source="{ row }"><span class="tag" :class="{ 'tag-accent': row.source === 'api', 'tag-warning': row.source === 'webhook' }">{{ t('apiConsole.log.sources.' + row.source) }}</span></template>
      </DataTable>
    </div>

    <Drawer :open="!!selected" :title="selected ? `${selected.method} ${selected.path}` : ''" :subtitle="selected ? t('apiConsole.log.sources.' + selected.source) : ''" width="520px" @update:open="v => !v && (selected = null)">
      <div v-if="selected" class="stack">
        <dl class="kv">
          <dt>{{ t('apiConsole.log.time') }}</dt><dd><DateTime :value="selected.at" mode="absolute" /></dd>
          <dt>{{ t('apiConsole.log.status') }}</dt><dd><span class="status" :class="tone(selected.status)">{{ selected.status }}</span> {{ t('apiConsole.httpStatus.' + selected.status) }}</dd>
          <dt>{{ t('apiConsole.log.duration') }}</dt><dd>{{ fmt.number(selected.ms) }} ms</dd>
          <dt>{{ t('apiConsole.log.requestId') }}</dt><dd class="mono">{{ selected.id }}</dd>
          <template v-if="selected.keyPrefix"><dt>{{ t('apiConsole.log.key') }}</dt><dd class="mono">{{ selected.keyPrefix }}…</dd></template>
          <template v-if="selected.event"><dt>{{ t('apiConsole.log.event') }}</dt><dd class="mono">{{ selected.event }}</dd></template>
          <template v-if="selected.ref"><dt>{{ t('apiConsole.log.ref') }}</dt><dd class="mono">{{ selected.ref }}</dd></template>
        </dl>
        <CodeBlock :code="selected" :title="t('apiConsole.log.raw')" :max-height="300" />
      </div>
    </Drawer>
  </div>
</template>

<style scoped>
.fb { padding: 12px 14px; border-bottom: 1px solid var(--line-1); }
.note { margin: 0; padding: 8px 16px; font-size: 12px; color: var(--ink-3); border-bottom: 1px solid var(--line-1); background: var(--bg-2); }
.method { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 5px; }
.method.get { background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); }
.method.post { background: var(--accent-soft); color: var(--accent-ink); }
.method.patch, .method.delete { background: oklch(0.96 0.06 80); color: oklch(0.45 0.1 70); }
.path { font-family: var(--font-mono); font-size: 12px; display: inline-block; max-width: 420px; vertical-align: middle; }
.ev { margin-left: 8px; font-size: 11px; color: var(--ink-3); font-family: var(--font-mono); }
.status { font-family: var(--font-mono); font-weight: 700; font-size: 11.5px; padding: 2px 6px; border-radius: 5px; }
.status.ok { background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); }
.status.warn { background: oklch(0.96 0.06 80); color: oklch(0.45 0.1 70); }
.status.err { background: oklch(0.95 0.04 25); color: var(--danger); }
.mono { font-family: var(--font-mono); font-size: 12px; }
</style>
