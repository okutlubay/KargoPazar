<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Card from '@/app/components/Card.vue'
import DataTable from '@/app/components/DataTable.vue'
import FilterBar from '@/app/components/FilterBar.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import CarrierLogo from '@/app/components/CarrierLogo.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import AdapterDiagram from '@/app/components/admin/AdapterDiagram.vue'
import CarrierWizard from '@/app/components/admin/CarrierWizard.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { can } from '@/app/store/session.js'
import { listCarriers } from '@/app/api/carriers.js'
import { errorText } from '@/app/components/settings/util.js'

const { t, fmt } = useI18n()
const router = useRouter()
const loading = ref(true)
const rows = ref([])
const search = ref('')
const filters = ref({ type: [], status: [] })
const wizardOpen = ref(false)
const highlight = ref([])
const locked = computed(() => !can('admin.platform'))

async function load() {
  try { rows.value = await listCarriers() } catch (e) { toast.error(errorText(e, 'admin')) } finally { loading.value = false }
}
onMounted(load)

const OPS = ['rates', 'label', 'void', 'track', 'manifest', 'address', 'pickup']
const chips = computed(() => [
  { key: 'type', label: t('admin.carriers.type'), options: ['domestic', 'regional', 'international'].map(v => ({ value: v, label: t('admin.types.' + v), count: rows.value.filter(r => r.type === v).length })) },
  { key: 'status', label: t('common.status'), options: [...new Set(rows.value.map(r => r.status))].map(v => ({ value: v, label: t('status.' + v), count: rows.value.filter(r => r.status === v).length })) },
])
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => {
    if (filters.value.type?.length && !filters.value.type.includes(r.type)) return false
    if (filters.value.status?.length && !filters.value.status.includes(r.status)) return false
    if (q && ![r.code, r.name, ...(r.services ?? []).map(s => s.name)].join(' ').toLowerCase().includes(q)) return false
    return true
  })
})
const hasFilters = computed(() => !!search.value || Object.values(filters.value).some(v => v?.length))
function clear() { search.value = ''; filters.value = { type: [], status: [] } }

function coverageText(r) {
  if (r.type === 'international') return t('admin.carriers.coverageIntl')
  if (Array.isArray(r.coverage) && r.coverage.length) return t('admin.carriers.coverageStates', { n: r.coverage.length })
  return t('admin.carriers.coverageAll')
}
const columns = computed(() => [
  { key: 'name', label: t('admin.carriers.carrier'), sortable: true },
  { key: 'type', label: t('admin.carriers.type'), sortable: true, format: v => t('admin.types.' + v) },
  { key: 'serviceCount', label: t('admin.carriers.services'), sortable: true, align: 'right' },
  { key: 'coverage', label: t('admin.carriers.coverage'), value: r => coverageText(r), hideBelow: 'lg' },
  { key: 'status', label: t('common.status'), sortable: true },
  { key: 'adapterVersion', label: t('admin.carriers.adapter'), hideBelow: 'md' },
  { key: 'connectedSince', label: t('admin.carriers.since'), sortable: true, hideBelow: 'lg' },
  { key: 'shipments30d', label: t('admin.carriers.shipments30'), sortable: true, align: 'right' },
  { key: 'apiHealth', label: t('admin.carriers.health'), sortValue: r => r.apiHealth?.avgMs ?? 9999, sortable: true },
])

const kpis = computed(() => {
  const active = rows.value.filter(r => r.status === 'active')
  const lat = active.map(r => r.apiHealth?.avgMs).filter(Boolean)
  return {
    active: active.length,
    services: active.reduce((s, r) => s + r.serviceCount, 0),
    shipments: rows.value.reduce((s, r) => s + (r.shipments30d ?? 0), 0),
    latency: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
  }
})

async function onWizardDone(c) {
  await load()
  highlight.value = [c.code]
  setTimeout(() => { highlight.value = [] }, 3000)
}
function healthTone(ms, status) {
  if (status !== 'active') return 'none'
  if (ms == null) return 'none'
  return ms < 500 ? 'ok' : ms < 700 ? 'slow' : 'bad'
}
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.adminCarriers')" :subtitle="t('admin.carriers.subtitle')">
      <template #actions>
        <button class="btn btn-primary" :disabled="locked" :title="locked ? t('common.noPermission') : undefined" @click="wizardOpen = true"><Icon name="plus" :size="14" />{{ t('admin.carriers.add') }}</button>
      </template>
    </PageHeader>

    <div class="grid-kpi">
      <KpiCard :label="t('admin.carriers.kpiActive')" :value="loading ? '' : String(kpis.active)" :loading="loading" icon="truck" />
      <KpiCard :label="t('admin.carriers.kpiServices')" :value="loading ? '' : String(kpis.services)" :loading="loading" icon="layers" />
      <KpiCard :label="t('admin.carriers.kpiShipments')" :value="loading ? '' : fmt.number(kpis.shipments)" :loading="loading" icon="box" />
      <KpiCard :label="t('admin.carriers.kpiLatency')" :value="loading || kpis.latency == null ? '-' : t('common.ms', { n: kpis.latency })" :loading="loading" icon="bolt" :hint="t('admin.carriers.kpiLatencyHint')" />
    </div>

    <Card padding="none" class="mt">
      <div class="fb">
        <FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('admin.carriers.searchPh')" @clear="clear" />
      </div>
      <DataTable
        :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" row-key="code" :paginate="false"
        :highlight-keys="highlight" storage-key="admin-carriers" :empty-title="t('admin.carriers.emptyTitle')" empty-icon="truck"
        @clear-filters="clear" @row-click="r => router.push({ name: 'admin-carrier-detail', params: { code: r.code } })"
      >
        <template #cell-name="{ row }"><CarrierLogo :code="row.code" :name="row.name" :color="row.color" :ink="row.ink" show-name :sub="row.code" /></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
        <template #cell-adapterVersion="{ row }"><span class="mono small">{{ row.adapterTemplate }} · v{{ row.adapterVersion }}</span></template>
        <template #cell-connectedSince="{ row }"><DateTime v-if="row.connectedSince" :value="row.connectedSince" mode="date" /><span v-else>-</span></template>
        <template #cell-shipments30d="{ value }"><span class="num">{{ fmt.number(value ?? 0) }}</span></template>
        <template #cell-apiHealth="{ row }">
          <span class="health"><i :class="healthTone(row.apiHealth?.avgMs, row.status)" />{{ row.apiHealth?.avgMs ? t('common.ms', { n: row.apiHealth.avgMs }) : '-' }}</span>
        </template>
      </DataTable>
    </Card>

    <div class="grid-2 mt">
      <Card :title="t('admin.carriers.opsTitle')" :subtitle="t('admin.carriers.opsDesc')" padding="none">
        <div class="table-wrap">
          <table class="table-simple ops">
            <thead><tr><th>{{ t('admin.carriers.carrier') }}</th><th v-for="o in OPS" :key="o" class="c">{{ t('admin.ops.' + o) }}</th></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.code">
                <td><CarrierLogo :code="r.code" :name="r.name" :color="r.color" :ink="r.ink" :size="22" show-name /></td>
                <td v-for="o in OPS" :key="o" class="c">
                  <Icon v-if="(r.supportedOps ?? []).includes(o)" name="check" :size="13" class="yes" :aria-label="t('common.yes')" />
                  <span v-else class="no">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card :title="t('admin.adapter.title')" :subtitle="t('admin.adapter.desc')">
        <AdapterDiagram :carriers="rows" />
      </Card>
    </div>

    <CarrierWizard v-model:open="wizardOpen" @done="onWizardDone" />
  </div>
</template>

<style scoped>
.mt { margin-top: 16px; }
.fb { padding: 12px 16px; border-bottom: 1px solid var(--line-1); }
.small { font-size: 12px; color: var(--ink-3); }
.health { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 12.5px; }
.health i { width: 8px; height: 8px; border-radius: 99px; background: var(--line-2); }
.health i.ok { background: var(--success); } .health i.slow { background: var(--warning); } .health i.bad { background: var(--danger); }
.ops th.c, .ops td.c { text-align: center; padding-left: 6px; padding-right: 6px; font-size: 11.5px; }
.ops td:first-child, .ops th:first-child { padding-left: 16px; }
.yes { color: var(--success); }
.no { color: var(--ink-4); }
@media (max-width: 1280px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
