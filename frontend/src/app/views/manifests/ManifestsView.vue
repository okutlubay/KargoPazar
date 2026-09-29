<script setup>
// Manifests list (spec 5.8): carrier handover manifests and air cargo customs manifests.
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar, { inRange } from '../../components/FilterBar.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import Spinner from '../../components/Spinner.vue'
import Money from '../../components/Money.vue'
import CreateManifestModal from './CreateManifestModal.vue'
import { listManifests } from '../../api/manifests.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { manifestStatusLabel, manifestStatusTone, manifestKindLabel } from './manifestLabels.js'
import { can } from '../../store/session.js'
import { toast } from '../../components/toast.js'
import { db } from '../../store/db.js'
import { t, fmt } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()
const rows = ref([])
const loading = ref(true)
const error = ref('')
const tab = ref(['carrier', 'air_customs'].includes(route.query.type) ? route.query.type : 'all')
const search = ref('')
const filters = ref({ hub: [], carrier: [], status: [] })
const range = ref(null)
const createOpen = ref(route.query.create === '1')
const highlight = ref([])
const busy = ref('')

async function load() {
  error.value = ''
  try { rows.value = await listManifests() } catch (e) { error.value = errorText(e, ['manifests.errors']) } finally { loading.value = false }
}
onMounted(load)
const sig = computed(() => db.all('manifests').map(m => m.id + m.status).join('|'))
watch(sig, load)
watch(tab, v => router.replace({ query: { ...route.query, type: v === 'all' ? undefined : v } }))
watch(createOpen, v => { if (!v && route.query.create) router.replace({ query: { ...route.query, create: undefined } }) })

const tabs = computed(() => [
  { key: 'all', label: t('common.all'), count: rows.value.length },
  { key: 'carrier', label: t('manifests.types.carrier'), count: rows.value.filter(r => r.type === 'carrier').length },
  { key: 'air_customs', label: t('manifests.types.air_customs'), count: rows.value.filter(r => r.type === 'air_customs').length },
])
const statuses = computed(() => [...new Set(rows.value.map(r => r.status))])
const carriers = computed(() => [...new Set(rows.value.filter(r => r.carrier).map(r => r.carrier))])
const chips = computed(() => [
  { key: 'hub', label: t('manifests.col.hub'), options: ['NJ01', 'LA01'].map(h => ({ value: h, label: h })) },
  { key: 'carrier', label: t('manifests.col.carrier'), options: carriers.value.map(c => ({ value: c, label: db.get('carriers', c)?.name ?? c })) },
  { key: 'status', label: t('common.status'), options: statuses.value.map(s => ({ value: s, label: manifestStatusLabel(s) })) },
])
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const f = filters.value
  return rows.value.filter(r => {
    if (tab.value !== 'all' && r.type !== tab.value) return false
    if (f.hub?.length && !f.hub.includes(r.hub)) return false
    if (f.carrier?.length && !f.carrier.includes(r.carrier)) return false
    if (f.status?.length && !f.status.includes(r.status)) return false
    if (!inRange(r.createdAt, range.value)) return false
    if (q && ![r.id, r.mawb, r.flight, r.carrier, ...(r.shipmentIds ?? []), ...(r.hawbs ?? []).map(h => h.hawb)].some(v => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
})
const hasFilters = computed(() => !!search.value || !!filters.value.hub?.length || !!filters.value.carrier?.length || !!filters.value.status?.length || !!range.value)
function clear() { search.value = ''; filters.value = { hub: [], carrier: [], status: [] }; range.value = null }

const columns = computed(() => [
  { key: 'id', label: t('manifests.col.id'), sortable: true, width: 110 },
  { key: 'kind', label: t('manifests.col.type'), value: r => manifestKindLabel(r) },
  { key: 'hub', label: t('manifests.col.hub'), sortable: true, width: 80 },
  { key: 'carrier', label: t('manifests.col.carrierFlight'), value: r => r.carrier ?? r.flight },
  { key: 'parcels', label: t('manifests.col.parcels'), sortable: true, align: 'right', width: 90 },
  { key: 'weightLb', label: t('manifests.col.weight'), sortable: true, align: 'right', hideBelow: 'md' },
  { key: 'createdAt', label: t('manifests.col.created'), sortable: true, hideBelow: 'md' },
  { key: 'status', label: t('common.status'), sortable: true },
  { key: 'actions', label: '', isAction: true, align: 'right', width: 70 },
])

async function pdf(m) {
  busy.value = m.id
  try {
    const d = await import('../../docs/index.js')
    d.downloadManifest(m)
    toast.success(t('manifests.pdfDone', { id: m.id }))
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = '' }
}
function onCreated(m) {
  highlight.value = [m.id]
  tab.value = m.type === 'air_customs' ? 'air_customs' : tab.value === 'air_customs' ? 'carrier' : tab.value
  load()
  setTimeout(() => router.push(`/manifests/${m.id}`), 700)
}
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.manifests')" :subtitle="t('manifests.subtitle')">
      <template #actions>
        <RouterLink :to="{ path: '/ops', query: { tab: 'handover' } }" class="btn btn-ghost"><Icon name="warehouse" :size="14" /> {{ t('manifests.goOps') }}</RouterLink>
        <button class="btn btn-accent" :disabled="!can('shipments.create')" :title="can('shipments.create') ? '' : t('common.noPermission')" @click="createOpen = true"><Icon name="plus" :size="14" /> {{ t('manifests.create.button') }}</button>
      </template>
    </PageHeader>
    <div class="tabs-wrap"><Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.manifests')" /></div>
    <div class="stack">
      <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('manifests.searchPh')" @clear="clear" />
      <div v-if="error" class="callout danger">{{ error }} <button class="btn-link" @click="load">{{ t('common.retry') }}</button></div>
      <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" storage-key="manifests" :highlight-keys="highlight"
        :default-sort="{ key: 'createdAt', dir: 'desc' }" :empty-title="t('manifests.empty')" :empty-desc="t('manifests.emptyDesc')" :empty-action-label="t('manifests.create.button')" empty-icon="file"
        @empty-action="createOpen = true" @clear-filters="clear" @row-click="r => router.push(`/manifests/${r.id}`)">
        <template #cell-id="{ row }"><span class="mono strong">{{ row.id }}</span></template>
        <template #cell-kind="{ row }"><span class="kind"><Icon :name="row.type === 'air_customs' ? 'plane' : 'truck'" :size="13" /> {{ manifestKindLabel(row) }}</span></template>
        <template #cell-carrier="{ row }">
          <CarrierLogo v-if="row.carrier" :code="row.carrier" :size="22" show-name />
          <span v-else class="flight"><span class="mono">{{ row.flight }}</span><small class="mono">MAWB {{ row.mawb }}</small></span>
        </template>
        <template #cell-parcels="{ row }"><span class="num">{{ fmt.number(row.parcels) }}</span></template>
        <template #cell-weightLb="{ row }"><span class="num">{{ row.type === 'air_customs' ? `${fmt.number(row.weightKg, 1)} kg` : fmt.weight(row.weightLb) }}</span><div v-if="row.valueUsd" class="small"><Money :value="row.valueUsd" /></div></template>
        <template #cell-createdAt="{ row }"><DateTime :value="row.createdAt" mode="short" /></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" :label="manifestStatusLabel(row.status)" :tone="manifestStatusTone(row.status)" size="sm" /></template>
        <template #cell-actions="{ row }">
          <button class="btn-icon" :aria-label="t('common.downloadPdf')" :title="t('common.downloadPdf')" :disabled="busy === row.id" @click.stop="pdf(row)">
            <Spinner v-if="busy === row.id" :size="14" /><Icon v-else name="download" :size="15" />
          </button>
        </template>
      </DataTable>
    </div>
    <CreateManifestModal v-model:open="createOpen" @created="onCreated" />
  </div>
</template>

<style scoped>
.tabs-wrap { margin: 4px 0 14px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.strong { font-weight: 600; }
.kind { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.flight { display: flex; flex-direction: column; }
.flight small { color: var(--ink-3); font-size: 11px; }
.small { font-size: 11.5px; color: var(--ink-3); }
</style>
