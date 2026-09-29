<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import DataTable from '@/app/components/DataTable.vue'
import FilterBar, { inRange } from '@/app/components/FilterBar.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import DateTime from '@/app/components/DateTime.vue'
import Flag from '@/app/components/intl/Flag.vue'
import IntlRoute from '@/app/components/intl/IntlRoute.vue'
import StageProgress from '@/app/components/intl/StageProgress.vue'
import { stageTone, errorText } from '@/app/components/intl/stage.js'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { can } from '@/app/store/session.js'
import { listIntl, STAGES, originCountries, consolidationPointFor } from '@/app/api/intl.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const route = useRoute()

const rows = ref([])
const loading = ref(true)
const search = ref('')
const filters = ref({ origin: [], stage: route.query.stage ? [String(route.query.stage)] : [] })
const range = ref(null)

async function load() {
  loading.value = true
  try {
    rows.value = (await listIntl()).map(r => ({ ...r, consolidationCode: consolidationPointFor(r.origin, r.originPoint)?.code }))
  } catch (e) {
    toast.error(errorText(t, e))
  } finally { loading.value = false }
}
onMounted(load)

const origins = computed(() => {
  const codes = new Set([...originCountries().map(c => c.code), ...rows.value.map(r => r.origin)])
  return [...codes]
})
const chips = computed(() => [
  { key: 'origin', label: t('intl.list.origin'), icon: 'globe', options: origins.value.map(c => ({ value: c, label: tx(originCountries().find(x => x.code === c)?.name) || c, count: rows.value.filter(r => r.origin === c).length })) },
  { key: 'stage', label: t('intl.list.stage'), icon: 'route', options: STAGES.map(s => ({ value: s, label: t('intl.stages.' + s), count: rows.value.filter(r => r.stage === s).length })) },
])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => {
    if (filters.value.origin?.length && !filters.value.origin.includes(r.origin)) return false
    if (filters.value.stage?.length && !filters.value.stage.includes(r.stage)) return false
    if (!inRange(r.createdAt, range.value)) return false
    if (q && ![r.id, r.mawb, r.flight, r.sender?.name, r.sender?.company, r.dummyLabel?.ref].some(v => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
})
const hasFilters = computed(() => !!(search.value || filters.value.origin?.length || filters.value.stage?.length || range.value))
function clear() { search.value = ''; filters.value = { origin: [], stage: [] }; range.value = null }

const kpi = computed(() => {
  const all = rows.value
  const cutoff = Date.now() - 30 * 864e5
  return {
    active: all.filter(r => r.stage !== 'completed').length,
    air: all.filter(r => ['in_flight', 'us_customs', 'customs_cleared'].includes(r.stage)).length,
    docs: all.filter(r => r.customsStatus === 'docs_requested').length,
    completed: all.filter(r => r.stage === 'completed' && new Date(r.completedAt || r.createdAt).getTime() >= cutoff).length,
    kg: all.filter(r => r.stage !== 'completed').reduce((s, r) => s + (r.totalWeightKg || 0), 0),
  }
})

const columns = computed(() => [
  { key: 'id', label: t('intl.list.id'), sortable: true, nowrap: true },
  { key: 'origin', label: t('intl.list.origin'), sortable: true },
  { key: 'originPoint', label: t('intl.list.point'), hideBelow: 'lg' },
  { key: 'parcelCount', label: t('intl.list.parcels'), sortable: true, align: 'right' },
  { key: 'totalWeightKg', label: t('intl.list.weight'), sortable: true, align: 'right', hideBelow: 'md' },
  { key: 'stage', label: t('intl.list.stage'), sortable: true, sortValue: r => STAGES.indexOf(r.stage) },
  { key: 'route', label: t('intl.list.route'), hideBelow: 'lg', hideOnCard: true, width: 170 },
  { key: 'mawb', label: 'MAWB', hideBelow: 'md', nowrap: true },
  { key: 'destHub', label: t('intl.list.hub'), sortable: true },
  { key: 'eta', label: 'ETA', sortable: true, nowrap: true },
])

function pointLabel(r) {
  return r.originPoint === 'EVRI-NET' ? 'Evri' : r.originPoint
}
function open(row) { router.push({ name: 'intl-detail', params: { id: row.id } }) }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.intl')" :subtitle="t('intl.list.subtitle')">
      <template #actions>
        <RouterLink :to="{ name: 'customs' }" class="btn btn-ghost"><Icon name="shield" :size="14" />{{ t('nav.customs') }}</RouterLink>
        <button class="btn btn-primary" :disabled="!can('shipments.create')" :title="!can('shipments.create') ? t('common.noPermission') : ''" @click="router.push({ name: 'intl-new' })">
          <Icon name="plus" :size="14" />{{ t('intl.list.new') }}
        </button>
      </template>
    </PageHeader>

    <div class="grid-kpi kpis">
      <KpiCard :label="t('intl.kpi.active')" :value="kpi.active" icon="plane" :loading="loading" :hint="t('intl.kpi.activeHint', { kg: fmt.number(kpi.kg, 1) })" />
      <KpiCard :label="t('intl.kpi.air')" :value="kpi.air" icon="shield" :loading="loading" :hint="t('intl.kpi.airHint')" clickable @click="filters = { origin: [], stage: ['in_flight', 'us_customs', 'customs_cleared'] }" />
      <KpiCard :label="t('intl.kpi.docs')" :value="kpi.docs" icon="alert" :tone="kpi.docs ? 'danger' : ''" :loading="loading" :hint="t('intl.kpi.docsHint')" clickable @click="router.push({ name: 'customs', query: { tab: 'status' } })" />
      <KpiCard :label="t('intl.kpi.completed')" :value="kpi.completed" icon="check-circle" tone="success" :loading="loading" :hint="t('intl.kpi.completedHint')" />
    </div>

    <div class="panel">
      <div class="fb">
        <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('intl.list.search')" @clear="clear" />
      </div>
      <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" storage-key="intl" :default-sort="{ key: 'id', dir: 'desc' }"
        :empty-title="t('intl.list.emptyTitle')" :empty-desc="t('intl.list.emptyDesc')" empty-icon="plane" :empty-action-label="can('shipments.create') ? t('intl.list.new') : ''"
        :aria-label="t('nav.intl')" @empty-action="router.push({ name: 'intl-new' })" @clear-filters="clear" @row-click="open">
        <template #cell-id="{ row }">
          <span class="idc"><RouterLink :to="{ name: 'intl-detail', params: { id: row.id } }" class="link mono">{{ row.id }}</RouterLink>
            <span v-if="row.dummyLabel?.status === 'active'" class="tag tag-warning xs" :title="t('intl.list.dummyActive')">TMP</span>
          </span>
        </template>
        <template #cell-origin="{ row }">
          <span class="org"><Flag :code="row.origin" :size="13" /> <span>{{ row.origin }}</span></span>
        </template>
        <template #cell-originPoint="{ row }">
          <span class="pt"><span class="nw">{{ pointLabel(row) }}</span><span class="muted sm">{{ t('intl.handover.' + row.handover) }}</span></span>
        </template>
        <template #cell-parcelCount="{ value }"><span class="num">{{ value }}</span></template>
        <template #cell-totalWeightKg="{ row }"><span class="wt"><span class="num">{{ fmt.number(row.totalWeightKg, 1) }} kg</span><span class="muted num sm">{{ fmt.number(row.totalWeightKg * 2.20462, 1) }} lb</span></span></template>
        <template #cell-stage="{ row }">
          <div class="stg">
            <StatusPill :status="row.stage" :label="t('intl.stages.' + row.stage)" :tone="stageTone(row.stage, row.customsStatus)" size="sm" />
            <StageProgress :stage="row.stage" compact :blocked="row.customsStatus === 'docs_requested'" />
          </div>
        </template>
        <template #cell-route="{ row }"><IntlRoute :record="row" compact /></template>
        <template #cell-mawb="{ value }"><span class="mono">{{ value || '-' }}</span></template>
        <template #cell-destHub="{ value }"><span class="tag">{{ value }}</span></template>
        <template #cell-eta="{ row }">
          <span v-if="row.stage === 'completed'" class="muted">{{ t('intl.list.done') }}</span>
          <DateTime v-else :value="row.eta" mode="date" />
        </template>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.kpis { margin-bottom: 16px; }
.fb { padding: 14px 16px; border-bottom: 1px solid var(--line-1); }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.idc { display: inline-flex; align-items: center; gap: 6px; }
.xs { height: 18px; font-size: 10px; padding: 0 5px; font-family: var(--font-mono); }
.org { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
.pt, .wt { display: inline-flex; flex-direction: column; font-size: 13px; line-height: 1.35; white-space: nowrap; }
.wt { align-items: flex-end; }
.sm { font-size: 11.5px; }
.nw { white-space: nowrap; }
.muted { color: var(--ink-3); }
.stg { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
</style>
