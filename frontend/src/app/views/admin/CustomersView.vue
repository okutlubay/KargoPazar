<script setup>
// Platform customers (spec 10.3): the 12 pilot companies, read only, with a 30 day shipment chart in the detail drawer.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Card from '@/app/components/Card.vue'
import DataTable from '@/app/components/DataTable.vue'
import FilterBar from '@/app/components/FilterBar.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Drawer from '@/app/components/Drawer.vue'
import ChannelLogo from '@/app/components/ChannelLogo.vue'
import Sparkline from '@/app/components/charts/Sparkline.vue'
import BarChart from '@/app/components/charts/BarChart.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { listCustomers } from '@/app/api/admin.js'
import { errorText } from '@/app/components/settings/util.js'

const { t, fmt, locale } = useI18n()
const router = useRouter()
const loading = ref(true)
const rows = ref([])
const search = ref('')
const filters = ref({ plan: [], status: [], hub: [] })
const selected = ref(null)
const drawerOpen = ref(false)

async function load() {
  loading.value = true
  try { rows.value = await listCustomers() } catch (e) { toast.error(errorText(e, 'admin')) } finally { loading.value = false }
}
onMounted(load)

const STATUS_TONE = { active: 'success', pilot: 'info', onboarding: 'warning' }
const PLANS = ['starter', 'professional', 'enterprise']
const chips = computed(() => [
  { key: 'plan', label: t('admin.customers.plan'), options: PLANS.map(p => ({ value: p, label: t('plans.' + p), count: rows.value.filter(r => r.plan === p).length })) },
  { key: 'status', label: t('common.status'), options: ['active', 'pilot', 'onboarding'].map(s => ({ value: s, label: t('admin.customers.status.' + s), count: rows.value.filter(r => r.status === s).length })) },
  { key: 'hub', label: t('admin.customers.hub'), options: ['NJ01', 'LA01'].map(h => ({ value: h, label: h, count: rows.value.filter(r => r.hub === h).length })) },
])
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => {
    for (const k of ['plan', 'status', 'hub']) if (filters.value[k]?.length && !filters.value[k].includes(r[k])) return false
    if (q && ![r.id, r.name, r.country, ...(r.channels ?? [])].join(' ').toLowerCase().includes(q)) return false
    return true
  })
})
const hasFilters = computed(() => !!search.value || Object.values(filters.value).some(v => v?.length))
function clear() { search.value = ''; filters.value = { plan: [], status: [], hub: [] } }

const columns = computed(() => [
  { key: 'name', label: t('admin.customers.company'), sortable: true },
  { key: 'plan', label: t('admin.customers.plan'), sortable: true, format: v => t('plans.' + v) },
  { key: 'monthlyVolume', label: t('admin.customers.monthly'), sortable: true, align: 'right' },
  { key: 'channels', label: t('admin.customers.channels'), hideBelow: 'md', sortValue: r => r.channels?.length ?? 0 },
  { key: 'hub', label: t('admin.customers.hub'), sortable: true },
  { key: 'pilotStartedAt', label: t('admin.customers.pilotStart'), sortable: true, hideBelow: 'lg' },
  { key: 'series', label: t('admin.customers.last30'), hideBelow: 'lg', hideOnCard: true },
  { key: 'status', label: t('common.status'), sortable: true },
])
const kpis = computed(() => ({
  total: rows.value.length,
  active: rows.value.filter(r => r.status === 'active').length,
  volume: rows.value.reduce((s, r) => s + (r.monthlyVolume ?? 0), 0),
  last30: rows.value.reduce((s, r) => s + (r.shipments30d ?? 0), 0),
}))

function open(r) { selected.value = r; drawerOpen.value = true }
const dayLabels = computed(() => (selected.value?.series ?? []).map(p => new Date(p.x).toLocaleDateString(locale.value === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' })))
const countryName = c => t('admin.customers.countries.' + c) || c
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.adminCustomers')" :subtitle="t('admin.customers.subtitle')" />

    <div class="grid-kpi">
      <KpiCard :label="t('admin.customers.kpiTotal')" :value="loading ? '' : String(kpis.total)" :loading="loading" icon="users" />
      <KpiCard :label="t('admin.customers.kpiActive')" :value="loading ? '' : String(kpis.active)" :loading="loading" icon="check-circle" />
      <KpiCard :label="t('admin.customers.kpiVolume')" :value="loading ? '' : fmt.number(kpis.volume)" :loading="loading" icon="box" :hint="t('admin.customers.kpiVolumeHint')" />
      <KpiCard :label="t('admin.customers.kpiLast30')" :value="loading ? '' : fmt.number(kpis.last30)" :loading="loading" icon="chart" />
    </div>

    <div class="callout neutral mt"><Icon name="info" :size="14" />{{ t('admin.customers.readOnly') }}</div>

    <Card padding="none" class="mt">
      <div class="fb"><FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('admin.customers.searchPh')" @clear="clear" /></div>
      <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" :paginate="false" storage-key="admin-customers"
        :empty-title="t('admin.customers.empty')" empty-icon="users" @clear-filters="clear" @row-click="open">
        <template #cell-name="{ row }">
          <div class="nm">
            <strong>{{ row.name }}</strong>
            <span class="sub mono">{{ row.id }} · {{ row.country }}<span v-if="row.isDemo" class="tag tag-accent demo">{{ t('admin.customers.demoAccount') }}</span></span>
          </div>
        </template>
        <template #cell-monthlyVolume="{ value }"><span class="num">{{ fmt.number(value) }}</span></template>
        <template #cell-channels="{ row }"><span class="chs"><ChannelLogo v-for="c in row.channels" :key="c" :code="c" :size="20" /></span><span v-if="!row.channels?.length">-</span></template>
        <template #cell-pilotStartedAt="{ value }"><DateTime :value="value" mode="date" /></template>
        <template #cell-series="{ row }"><div class="spark"><Sparkline :data="row.series.map(p => p.y)" :height="26" :aria-label="t('admin.customers.last30')" /></div></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" :tone="STATUS_TONE[row.status]" :label="t('admin.customers.status.' + row.status)" size="sm" /></template>
      </DataTable>
    </Card>

    <Drawer v-model:open="drawerOpen" :title="selected?.name ?? ''" :subtitle="selected ? `${selected.id} · ${t('plans.' + selected.plan)}` : ''" width="620px">
      <div v-if="selected" class="stack-lg">
        <div class="kpis3">
          <div><span class="l">{{ t('admin.customers.last30') }}</span><span class="v num">{{ fmt.number(selected.shipments30d) }}</span></div>
          <div><span class="l">{{ t('admin.customers.monthly') }}</span><span class="v num">{{ fmt.number(selected.monthlyVolume) }}</span></div>
          <div><span class="l">{{ t('admin.customers.dailyAvg') }}</span><span class="v num">{{ fmt.number(selected.shipments30d / 30, 1) }}</span></div>
        </div>
        <Card :title="t('admin.customers.chartTitle')" :subtitle="selected.isDemo ? t('admin.customers.chartLive') : t('admin.customers.chartSeed')">
          <BarChart :categories="dayLabels" :series="[{ key: 's', label: t('admin.customers.shipments'), values: selected.series.map(p => p.y) }]" :height="200" :legend="false" :max-bar-width="14" />
        </Card>
        <dl class="kv">
          <dt>{{ t('common.status') }}</dt><dd><StatusPill :status="selected.status" :tone="STATUS_TONE[selected.status]" :label="t('admin.customers.status.' + selected.status)" size="sm" /></dd>
          <dt>{{ t('admin.customers.plan') }}</dt><dd>{{ t('plans.' + selected.plan) }}</dd>
          <dt>{{ t('admin.customers.hub') }}</dt><dd>{{ selected.hub }}</dd>
          <dt>{{ t('admin.customers.country') }}</dt><dd>{{ countryName(selected.country) }}</dd>
          <dt>{{ t('admin.customers.pilotStart') }}</dt><dd><DateTime :value="selected.pilotStartedAt" mode="date" /></dd>
          <dt>{{ t('admin.customers.channels') }}</dt>
          <dd><span class="chs"><ChannelLogo v-for="c in selected.channels" :key="c" :code="c" :size="20" show-name /></span><span v-if="!selected.channels?.length">-</span></dd>
        </dl>
        <div v-if="selected.isDemo" class="callout"><Icon name="info" :size="14" />{{ t('admin.customers.demoNote') }}</div>
        <div v-else class="callout neutral"><Icon name="lock" :size="14" />{{ t('admin.customers.summaryOnly') }}</div>
      </div>
      <template #footer>
        <button v-if="selected?.isDemo" class="btn btn-ghost" @click="drawerOpen = false; router.push({ name: 'shipments' })">{{ t('admin.customers.openShipments') }}</button>
        <span class="grow" />
        <button class="btn btn-primary" @click="drawerOpen = false">{{ t('common.close') }}</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.mt { margin-top: 16px; }
.fb { padding: 14px 16px; border-bottom: 1px solid var(--line-1); }
.nm { display: flex; flex-direction: column; }
.sub { font-size: 11.5px; color: var(--ink-3); }
.demo { margin-left: 6px; font-family: var(--font-sans, inherit); }
.chs { display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.spark { width: 110px; }
.kpis3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.kpis3 > div { display: flex; flex-direction: column; padding: 12px; border: 1px solid var(--line-1); border-radius: 10px; }
.kpis3 .l { font-size: 12px; color: var(--ink-3); }
.kpis3 .v { font-size: 20px; font-weight: 600; }
.grow { flex: 1; }
</style>
