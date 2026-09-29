<script setup>
// Batch history (spec 5.7): previous batch runs (date, count, savings) with a detail drawer.
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar, { inRange } from '../../components/FilterBar.vue'
import KpiCard from '../../components/KpiCard.vue'
import Drawer from '../../components/Drawer.vue'
import Skeleton from '../../components/Skeleton.vue'
import Spinner from '../../components/Spinner.vue'
import StatusPill from '../../components/StatusPill.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import DateTime from '../../components/DateTime.vue'
import { listBatches, getBatch, attachBatchManifests } from '../../api/ops.js'
import { createManifestsForShipments } from '../../api/manifests.js'
import { can } from '../../store/session.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t, fmt } from '../../i18n/index.js'

const emit = defineEmits(['start'])

const loading = ref(true)
const list = ref([])
async function load() {
  loading.value = true
  try { list.value = await listBatches() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

const search = ref('')
const range = ref(null)
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return list.value.filter(b => (!q || b.id.toLowerCase().includes(q) || String(b.createdBy ?? '').toLowerCase().includes(q)) && inRange(b.at, range.value))
})
const filtered = computed(() => !!search.value || !!range.value)
function clear() { search.value = ''; range.value = null }

const kpi = computed(() => {
  const l = list.value
  const labels = l.reduce((s, b) => s + (b.labelCount ?? 0), 0)
  const savings = l.reduce((s, b) => s + (b.savings ?? 0), 0)
  const def = l.reduce((s, b) => s + (b.defaultCost ?? 0), 0)
  return { n: l.length, labels, savings, rate: def ? savings / def : 0 }
})

const columns = computed(() => [
  { key: 'id', label: t('batch.col.id'), sortable: true, nowrap: true },
  { key: 'at', label: t('batch.col.date'), sortable: true },
  { key: 'orderCount', label: t('batch.col.orders'), sortable: true, align: 'right' },
  { key: 'labelCount', label: t('batch.col.labels'), sortable: true, align: 'right' },
  { key: 'failed', label: t('batch.col.failed'), sortable: true, align: 'right', hideBelow: 'md' },
  { key: 'hubs', label: t('batch.col.hubs'), hideBelow: 'md' },
  { key: 'totalCost', label: t('batch.col.total'), sortable: true, align: 'right' },
  { key: 'savings', label: t('batch.col.savings'), sortable: true, align: 'right' },
  { key: 'manifestIds', label: t('batch.col.manifests'), hideBelow: 'lg', sortValue: r => r.manifestIds?.length ?? 0 },
  { key: 'createdBy', label: t('batch.col.by'), hideBelow: 'lg' },
])

// drawer
const open = ref(false)
const detail = ref(null)
const detailLoading = ref(false)
const busy = ref('')
async function openBatch(row) {
  open.value = true
  detail.value = null
  detailLoading.value = true
  try { detail.value = await getBatch(row.id) } catch (e) { toast.error(t('batch.hist.loadError')); open.value = false } finally { detailLoading.value = false }
}
const unmanifested = computed(() => (detail.value?.shipments ?? []).filter(s => !s.manifestId && s.status === 'label_created' && !s.test))
async function pdf() {
  busy.value = 'pdf'
  try {
    const d = await import('../../docs/index.js')
    const ships = detail.value.shipments.filter(s => s.status !== 'voided')
    d.downloadCombinedLabels(ships, { title: detail.value.id })
    toast.success(t('batch.proc.pdfReady', { n: ships.length }))
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = '' }
}
async function manifests() {
  busy.value = 'mnf'
  try {
    const created = await createManifestsForShipments(unmanifested.value.map(s => s.id))
    await attachBatchManifests(detail.value.id, created.map(m => m.id))
    toast.success(t('batch.proc.manifestsDone', { n: created.length }))
    detail.value = await getBatch(detail.value.id)
    load()
  } catch (e) { toast.error(errorText(e, ['manifests.errors'])) } finally { busy.value = '' }
}
const hubText = h => Object.entries(h ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '-'
</script>

<template>
  <div class="hist">
    <div class="grid-4 kpis">
      <KpiCard :label="t('batch.hist.batches')" :value="kpi.n" format="number" icon="layers" :loading="loading" />
      <KpiCard :label="t('batch.hist.labels')" :value="kpi.labels" format="number" icon="printer" :loading="loading" />
      <KpiCard :label="t('batch.hist.totalSavings')" :value="kpi.savings" format="money" icon="dollar" tone="success" :loading="loading" />
      <KpiCard :label="t('batch.hist.avgSavings')" :value="kpi.rate" format="percent" icon="spark" :loading="loading" />
    </div>
    <section class="panel">
      <div class="fb"><FilterBar v-model:search="search" v-model:range="range" :search-placeholder="t('batch.hist.searchPh')" @clear="clear" /></div>
      <DataTable :columns="columns" :rows="rows" :loading="loading" :filtered="filtered" :default-sort="{ key: 'at', dir: 'desc' }"
        :empty-title="t('batch.hist.empty')" :empty-desc="t('batch.hist.emptyDesc')" empty-icon="layers" :empty-action-label="t('batch.hist.start')"
        storage-key="batch-history" @empty-action="emit('start')" @clear-filters="clear" @row-click="openBatch">
        <template #cell-id="{ value }"><span class="mono strong">{{ value }}</span></template>
        <template #cell-at="{ value }"><DateTime :value="value" mode="short" /></template>
        <template #cell-failed="{ value }"><span :class="value ? 'neg-t' : 'muted'">{{ value || 0 }}</span></template>
        <template #cell-hubs="{ value }"><span class="small">{{ hubText(value) }}</span></template>
        <template #cell-totalCost="{ value }"><span class="num">{{ fmt.money(value) }}</span></template>
        <template #cell-savings="{ row }"><span class="num pos">{{ fmt.money(row.savings) }}</span> <span class="muted">({{ fmt.percent(row.savingsPct ?? 0, 1) }})</span></template>
        <template #cell-manifestIds="{ value }"><span class="small">{{ value?.length ? value.join(', ') : '-' }}</span></template>
        <template #cell-createdBy="{ value }">{{ value || '-' }}</template>
      </DataTable>
    </section>

    <Drawer v-model:open="open" :title="t('batch.hist.detail', { id: detail?.id ?? '' })" :subtitle="detail ? fmt.dateTime(detail.at) : ''">
      <div v-if="detailLoading" class="pad"><Skeleton :lines="6" /></div>
      <div v-else-if="detail" class="pad">
        <dl class="kv">
          <dt>{{ t('batch.col.orders') }}</dt><dd>{{ detail.orderCount }}</dd>
          <dt>{{ t('batch.col.labels') }}</dt><dd>{{ detail.labelCount }} <span v-if="detail.failed" class="neg-t">· {{ t('batch.col.failed') }} {{ detail.failed }}</span></dd>
          <dt>{{ t('batch.col.hubs') }}</dt><dd>{{ hubText(detail.hubs) }}</dd>
          <dt>{{ t('batch.col.total') }}</dt><dd class="num">{{ fmt.money(detail.totalCost) }}</dd>
          <dt>{{ t('batch.opt.defaultRule') }}</dt><dd class="num">{{ fmt.money(detail.defaultCost) }}</dd>
          <dt>{{ t('batch.col.savings') }}</dt><dd class="num pos">{{ fmt.money(detail.savings) }} ({{ fmt.percent(detail.savingsPct ?? 0, 1) }})</dd>
          <dt>{{ t('batch.col.by') }}</dt><dd>{{ detail.createdBy || '-' }}</dd>
          <dt>{{ t('batch.col.manifests') }}</dt>
          <dd>
            <template v-if="detail.manifestIds?.length"><RouterLink v-for="m in detail.manifestIds" :key="m" :to="`/manifests/${m}`" class="link mono mr">{{ m }}</RouterLink></template>
            <span v-else class="muted">{{ t('batch.hist.noManifest') }}</span>
          </dd>
        </dl>
        <div class="acts">
          <button class="btn btn-ghost btn-sm" :disabled="!detail.shipments.length || !!busy" @click="pdf"><Spinner v-if="busy === 'pdf'" :size="12" /><Icon v-else name="download" :size="13" /> {{ t('batch.hist.downloadPdf') }}</button>
          <button v-if="unmanifested.length" class="btn btn-soft btn-sm" :disabled="!!busy || !can('shipments.create')" @click="manifests"><Spinner v-if="busy === 'mnf'" :size="12" /><Icon v-else name="file" :size="13" /> {{ t('batch.hist.createManifests') }}</button>
        </div>
        <div class="sh-title">{{ t('batch.hist.shipments') }}</div>
        <table class="table-simple">
          <tbody>
            <tr v-for="s in detail.shipments" :key="s.id">
              <td><CarrierLogo :code="s.carrier" :size="20" /></td>
              <td><RouterLink :to="`/shipments/${s.id}`" class="link mono">{{ s.id }}</RouterLink><div class="muted mono">{{ s.trackingNo }}</div></td>
              <td><StatusPill :status="s.status" size="sm" /></td>
              <td class="r num">{{ fmt.money(s.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Drawer>
  </div>
</template>

<style scoped>
.hist { display: flex; flex-direction: column; gap: 14px; }
.fb { padding: 12px 16px 4px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.strong { font-weight: 600; }
.muted { color: var(--ink-3); font-size: 12px; }
.small { font-size: 12.5px; white-space: nowrap; }
.num { white-space: nowrap; }
.pos { color: var(--success); font-weight: 500; }
.neg-t { color: var(--danger); }
.pad { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.acts { display: flex; gap: 8px; flex-wrap: wrap; }
.sh-title { font-weight: 600; font-size: 13.5px; }
.r { text-align: right; }
.mr { margin-right: 8px; }
</style>
