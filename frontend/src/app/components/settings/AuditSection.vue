<script setup>
import { ref, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import DataTable from '../DataTable.vue'
import FilterBar, { inRange } from '../FilterBar.vue'
import DateTime from '../DateTime.vue'
import Drawer from '../Drawer.vue'
import CodeBlock from '../CodeBlock.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { listAuditLog } from '../../api/settings.js'
import { errorText, hasKey, downloadText } from './util.js'

const { t, tx, fmt } = useI18n()
const loading = ref(true)
const rows = ref([])
const search = ref('')
const filters = ref({ actor: [], category: [], source: [] })
const range = ref(null)
const selected = ref(null)

async function load() {
  loading.value = true
  try { rows.value = await listAuditLog() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

const category = a => String(a.action ?? '').split('.')[0]
function actionLabel(a) {
  const k = 'settings.audit.actions.' + String(a).replace(/\./g, '_')
  return hasKey(k) ? t(k) : a
}
function categoryLabel(c) { const k = 'settings.audit.categories.' + c; return hasKey(k) ? t(k) : c }
function srcLabel(s) { const k = 'settings.audit.sources.' + s; return hasKey(k) ? t(k) : s }
function summaryText(r) { return r.summary ? tx(r.summary) : '-' }

const chips = computed(() => {
  const by = (fn) => { const m = new Map(); for (const r of rows.value) { const k = fn(r); m.set(k, (m.get(k) ?? 0) + 1) } return [...m.entries()].sort((a, b) => b[1] - a[1]) }
  return [
    { key: 'actor', label: t('settings.audit.actor'), icon: 'user', options: by(r => r.actorName).map(([v, n]) => ({ value: v, label: v, count: n })) },
    { key: 'category', label: t('settings.audit.category'), icon: 'tag', options: by(category).map(([v, n]) => ({ value: v, label: categoryLabel(v), count: n })) },
    { key: 'source', label: t('settings.audit.source'), icon: 'code', options: by(r => r.source).map(([v, n]) => ({ value: v, label: srcLabel(v), count: n })) },
  ]
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const f = filters.value
  return rows.value.filter(r => {
    if (f.actor?.length && !f.actor.includes(r.actorName)) return false
    if (f.category?.length && !f.category.includes(category(r))) return false
    if (f.source?.length && !f.source.includes(r.source)) return false
    if (!inRange(r.at, range.value)) return false
    if (q) {
      const hay = [r.actorName, r.action, actionLabel(r.action), r.target, summaryText(r), r.ip].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})
const hasFilters = computed(() => !!search.value || Object.values(filters.value).some(v => v?.length) || !!range.value)
function clear() { search.value = ''; filters.value = { actor: [], category: [], source: [] }; range.value = null }

const columns = computed(() => [
  { key: 'at', label: t('settings.audit.when'), sortable: true, width: 170, nowrap: true },
  { key: 'actorName', label: t('settings.audit.actor'), sortable: true, nowrap: true },
  { key: 'action', label: t('settings.audit.action'), sortable: true, sortValue: r => actionLabel(r.action) },
  { key: 'summary', label: t('settings.audit.detail'), value: r => summaryText(r), hideBelow: 'md' },
  { key: 'target', label: t('settings.audit.target'), hideBelow: 'lg', format: v => v ?? '-' },
  { key: 'source', label: t('settings.audit.source'), hideBelow: 'lg' },
])

function exportCsv() {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = [t('settings.audit.when'), t('settings.audit.actor'), t('settings.audit.role'), t('settings.audit.action'), t('settings.audit.detail'), t('settings.audit.target'), t('settings.audit.source'), 'IP']
  const lines = filtered.value.map(r => [fmt.dateTime(r.at), r.actorName, r.actorRole ? t('roles.' + r.actorRole) : '', actionLabel(r.action), summaryText(r), r.target ?? '', srcLabel(r.source), r.ip ?? ''].map(esc).join(','))
  downloadText('kargopazar-audit-log.csv', '﻿' + [head.map(esc).join(','), ...lines].join('\n'), 'text/csv')
  toast.success(t('settings.audit.exported', { n: filtered.value.length }))
}
</script>

<template>
  <Card :title="t('settings.audit.title')" :subtitle="t('settings.audit.desc')" padding="none">
    <template #actions>
      <button class="btn btn-ghost btn-sm" :disabled="loading" :aria-label="t('common.refresh')" @click="load"><Icon name="refresh" :size="13" />{{ t('common.refresh') }}</button>
      <button class="btn btn-ghost btn-sm" :disabled="loading || !filtered.length" @click="exportCsv"><Icon name="download" :size="13" />{{ t('common.exportCsv') }}</button>
    </template>
    <div class="fb">
      <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('settings.audit.searchPh')" @clear="clear" />
    </div>
    <DataTable
      :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" :default-sort="{ key: 'at', dir: 'desc' }"
      storage-key="settings-audit" :empty-title="t('settings.audit.emptyTitle')" empty-icon="list" dense
      @clear-filters="clear" @row-click="r => (selected = r)"
    >
      <template #cell-at="{ row }"><DateTime :value="row.at" mode="absolute" /></template>
      <template #cell-actorName="{ row }">
        <div class="actor">
          <span class="an">{{ row.actorName }}</span>
          <span v-if="row.actorRole" class="ar">{{ t('roles.' + row.actorRole) }}</span>
        </div>
      </template>
      <template #cell-action="{ row }">
        <span class="act"><span class="cat mono">{{ categoryLabel(category(row)) }}</span>{{ actionLabel(row.action) }}</span>
      </template>
      <template #cell-summary="{ row }"><span class="sum">{{ summaryText(row) }}</span></template>
      <template #cell-target="{ value }"><span class="mono small">{{ value ?? '-' }}</span></template>
      <template #cell-source="{ value }"><span class="tag">{{ srcLabel(value) }}</span></template>
    </DataTable>
  </Card>

  <Drawer :open="!!selected" :title="selected ? actionLabel(selected.action) : ''" :subtitle="selected ? fmt.dateTime(selected.at) : ''" width="480px" @update:open="v => !v && (selected = null)">
    <div v-if="selected" class="stack">
      <dl class="kv">
        <dt>{{ t('settings.audit.actor') }}</dt><dd>{{ selected.actorName }}<span v-if="selected.actorRole"> · {{ t('roles.' + selected.actorRole) }}</span></dd>
        <dt>{{ t('settings.audit.action') }}</dt><dd class="mono">{{ selected.action }}</dd>
        <dt>{{ t('settings.audit.target') }}</dt><dd class="mono">{{ selected.target ?? '-' }}</dd>
        <dt>{{ t('settings.audit.detail') }}</dt><dd>{{ summaryText(selected) }}</dd>
        <dt>{{ t('settings.audit.source') }}</dt><dd>{{ srcLabel(selected.source) }}</dd>
        <dt>IP</dt><dd class="mono">{{ selected.ip ?? '-' }}</dd>
      </dl>
      <CodeBlock :code="selected" :title="t('settings.audit.raw')" :max-height="260" />
    </div>
  </Drawer>
</template>

<style scoped>
.fb { padding: 12px 16px; border-bottom: 1px solid var(--line-1); }
.actor { display: flex; flex-direction: column; }
.an { font-weight: 500; }
.ar { font-size: 11.5px; color: var(--ink-3); }
.act { display: inline-flex; align-items: center; gap: 6px; }
.cat { font-size: 10.5px; padding: 1px 6px; border-radius: 5px; background: var(--bg-3); color: var(--ink-3); text-transform: uppercase; letter-spacing: .04em; }
.sum { color: var(--ink-2); }
.small { font-size: 12px; }
</style>
