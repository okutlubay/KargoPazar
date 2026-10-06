<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Tabs from '@/app/components/Tabs.vue'
import DataTable from '@/app/components/DataTable.vue'
import FilterBar, { inRange } from '@/app/components/FilterBar.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Drawer from '@/app/components/Drawer.vue'
import Spinner from '@/app/components/Spinner.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import CustomsNavTabs from '@/app/components/customs/CustomsNavTabs.vue'
import Flag from '@/app/components/intl/Flag.vue'
import HsCatalog from '@/app/components/intl/HsCatalog.vue'
import CustomsUpload from '@/app/components/intl/CustomsUpload.vue'
import { CUSTOMS_TONES, stageTone, errorText, fileSize } from '@/app/components/intl/stage.js'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { listCustomsDocuments, downloadCustomsDocument, listAirManifests, downloadAirManifest, customsQueue, getIntlSync, countryConfig } from '@/app/api/intl.js'
import { deMinimisSuspended } from '@/shared/countries.js'

const { t, tx, fmt } = useI18n()
// US de minimis: when suspended every shipment is dutiable (no threshold)
const usDm = computed(() => {
  const dm = countryConfig('US')?.deMinimis
  return { suspended: deMinimisSuspended(dm), amount: Number(dm?.amount ?? 800), currency: dm?.currency || 'USD' }
})
const route = useRoute()
const router = useRouter()
const TABS = ['hs', 'docs', 'manifests', 'status']
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'hs')
watch(tab, v => { if (route.query.tab !== v) router.replace({ query: { ...route.query, tab: v, q: undefined } }) })
watch(() => route.query.tab, v => { if (TABS.includes(v)) tab.value = v })

// ---------------- documents
const docs = ref([])
const docsLoading = ref(false)
const docsLoaded = ref(false)
const dSearch = ref(tab.value === 'docs' ? String(route.query.q || '') : '')
const dFilters = ref({ type: [], origin: [] })
const dRange = ref(null)
const busyKey = ref('')
async function loadDocs() {
  docsLoading.value = true
  try { docs.value = await listCustomsDocuments(); docsLoaded.value = true } catch (e) { toast.error(errorText(t, e)) } finally { docsLoading.value = false }
}
const DOC_TYPES = ['commercial_invoice', 'cn22', 'cn23', 'dummy_label', 'air_manifest', 'upload']
const dChips = computed(() => [
  { key: 'type', label: t('customsUi.docs.type'), icon: 'file', options: DOC_TYPES.map(k => ({ value: k, label: t('intl.docTypes.' + k), count: docs.value.filter(d => d.type === k).length })) },
  { key: 'origin', label: t('intl.list.origin'), icon: 'globe', options: [...new Set(docs.value.map(d => d.origin))].map(o => ({ value: o, label: o, count: docs.value.filter(d => d.origin === o).length })) },
])
const docsFiltered = computed(() => {
  const q = dSearch.value.trim().toLowerCase()
  return docs.value.filter(d => {
    if (dFilters.value.type?.length && !dFilters.value.type.includes(d.type)) return false
    if (dFilters.value.origin?.length && !dFilters.value.origin.includes(d.origin)) return false
    if (!inRange(d.at, dRange.value)) return false
    if (q && ![d.number, d.intlId, d.name].some(v => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
})
const dHasFilters = computed(() => !!(dSearch.value || dFilters.value.type?.length || dFilters.value.origin?.length || dRange.value))
function dClear() { dSearch.value = ''; dFilters.value = { type: [], origin: [] }; dRange.value = null }
const docCols = computed(() => [
  { key: 'number', label: t('customsUi.docs.number'), sortable: true, nowrap: true },
  { key: 'type', label: t('customsUi.docs.type'), sortable: true, value: d => t('intl.docTypes.' + d.type) },
  { key: 'intlId', label: t('customsUi.docs.shipment'), sortable: true },
  { key: 'origin', label: t('intl.list.origin'), sortable: true, hideBelow: 'md' },
  { key: 'valueUsd', label: t('customsUi.docs.value'), sortable: true, align: 'right', hideBelow: 'md' },
  { key: 'at', label: t('common.date'), sortable: true },
  { key: 'status', label: t('common.status') },
  { key: 'actions', label: '', isAction: true, align: 'right' },
])
async function dl(d) {
  busyKey.value = d.key
  try { const name = await downloadCustomsDocument(d.key); toast.success(t('intl.detail.downloaded', { name })) } catch (e) { toast.error(errorText(t, e)) } finally { busyKey.value = '' }
}
const DOC_STATUS_TONE = { generated: 'success', active: 'warning', replaced: 'neutral', uploaded: 'info', created: 'neutral', customs_submitted: 'info', customs_cleared: 'success', handed_over: 'info' }

// ---------------- manifests
const manifests = ref([])
const mLoading = ref(false)
const mLoaded = ref(false)
const mSearch = ref(tab.value === 'manifests' ? String(route.query.q || '') : '')
const mFilters = ref({ status: [], hub: [] })
const drawer = ref({ open: false, m: null })
async function loadManifests() {
  mLoading.value = true
  try {
    manifests.value = await listAirManifests(); mLoaded.value = true
    if (route.query.q && tab.value === 'manifests') {
      const m = manifests.value.find(x => x.id === route.query.q)
      if (m) drawer.value = { open: true, m }
    }
  } catch (e) { toast.error(errorText(t, e)) } finally { mLoading.value = false }
}
const M_STATUSES = ['created', 'customs_submitted', 'customs_cleared']
const mChips = computed(() => [
  { key: 'status', label: t('common.status'), options: M_STATUSES.map(s => ({ value: s, label: t('customsUi.manifests.status.' + s), count: manifests.value.filter(m => m.status === s).length })) },
  { key: 'hub', label: t('intl.list.hub'), options: ['NJ01', 'LA01'].map(h => ({ value: h, label: h, count: manifests.value.filter(m => m.hub === h).length })) },
])
const mFiltered = computed(() => {
  const q = mSearch.value.trim().toLowerCase()
  return manifests.value.filter(m => {
    if (mFilters.value.status?.length && !mFilters.value.status.includes(m.status)) return false
    if (mFilters.value.hub?.length && !mFilters.value.hub.includes(m.hub)) return false
    if (q && ![m.id, m.mawb, m.flight, m.route, ...(m.hawbs || []).map(h => h.intlShipmentId)].some(v => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
})
const mHasFilters = computed(() => !!(mSearch.value || mFilters.value.status?.length || mFilters.value.hub?.length))
function mClear() { mSearch.value = ''; mFilters.value = { status: [], hub: [] } }
const mCols = computed(() => [
  { key: 'id', label: t('customsUi.manifests.id'), sortable: true, nowrap: true },
  { key: 'mawb', label: 'MAWB', sortable: true, nowrap: true },
  { key: 'flight', label: t('intl.detail.flight'), sortable: true },
  { key: 'hub', label: t('intl.list.hub'), sortable: true, hideBelow: 'md' },
  { key: 'hawbs', label: 'HAWB', value: m => (m.hawbs || []).length, sortable: true, align: 'right' },
  { key: 'weight', label: 'kg', value: m => m.totals?.weightKg ?? 0, sortable: true, align: 'right', hideBelow: 'md' },
  { key: 'value', label: t('customsUi.docs.value'), value: m => m.totals?.valueUsd ?? 0, sortable: true, align: 'right', hideBelow: 'lg' },
  { key: 'createdAt', label: t('common.date'), sortable: true },
  { key: 'status', label: t('common.status'), sortable: true },
  { key: 'actions', label: '', isAction: true, align: 'right' },
])
async function dlManifest(m) {
  busyKey.value = m.id
  try { const name = await downloadAirManifest(m.id); toast.success(t('intl.detail.downloaded', { name })) } catch (e) { toast.error(errorText(t, e)) } finally { busyKey.value = '' }
}

// ---------------- customs status
const queue = ref([])
const qLoading = ref(false)
const qLoaded = ref(false)
const upload = ref({ open: false, rec: null })
async function loadQueue() {
  qLoading.value = true
  try { queue.value = await customsQueue(); qLoaded.value = true } catch (e) { toast.error(errorText(t, e)) } finally { qLoading.value = false }
}
const qCols = computed(() => [
  { key: 'id', label: t('customsUi.docs.shipment'), sortable: true, nowrap: true },
  { key: 'origin', label: t('intl.list.origin'), sortable: true },
  { key: 'mawb', label: 'MAWB', hideBelow: 'md', nowrap: true },
  { key: 'hawb', label: 'HAWB', hideBelow: 'lg' },
  { key: 'stage', label: t('intl.list.stage'), sortable: true },
  { key: 'customsStatus', label: t('customsUi.status.customs'), sortable: true },
  { key: 'declaredValueUsd', label: t('customsUi.docs.value'), sortable: true, align: 'right' },
  { key: 'actions', label: '', isAction: true, align: 'right' },
])
const qKpi = computed(() => ({
  flight: queue.value.filter(r => r.stage === 'in_flight').length,
  review: queue.value.filter(r => r.stage === 'us_customs').length,
  docs: queue.value.filter(r => r.customsStatus === 'docs_requested').length,
  cleared: queue.value.filter(r => r.stage === 'customs_cleared').length,
}))
function openUpload(r) { upload.value = { open: true, rec: getIntlSync(r.id) } }
async function onUploaded() { await loadQueue(); if (docsLoaded.value) loadDocs() }

watch(tab, v => {
  if (v === 'docs' && !docsLoaded.value) loadDocs()
  if (v === 'manifests' && !mLoaded.value) loadManifests()
  if (v === 'status' && !qLoaded.value) loadQueue()
}, { immediate: true })

const tabs = computed(() => [
  { key: 'hs', label: t('customsUi.tabs.hs'), icon: 'tag' },
  { key: 'docs', label: t('customsUi.tabs.docs'), icon: 'file', count: docsLoaded.value ? docs.value.length : undefined },
  { key: 'manifests', label: t('customsUi.tabs.manifests'), icon: 'list', count: mLoaded.value ? manifests.value.length : undefined },
  { key: 'status', label: t('customsUi.tabs.status'), icon: 'shield', count: qLoaded.value ? qKpi.value.docs || undefined : undefined },
])
const openIntl = r => router.push({ name: 'intl-detail', params: { id: r.intlId || r.id } })
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.customs')" :subtitle="t('customsUi.subtitle')">
      <template #actions>
        <RouterLink :to="{ name: 'ai-customs-docs' }" class="btn btn-ghost"><Icon name="brain" :size="14" />{{ t('customsUi.openAutomation') }}</RouterLink>
        <RouterLink :to="{ name: 'intl' }" class="btn btn-ghost"><Icon name="plane" :size="14" />{{ t('nav.intl') }}</RouterLink>
      </template>
    </PageHeader>
    <CustomsNavTabs />
    <Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.customs')" class="tabs" />

    <HsCatalog v-if="tab === 'hs'" />

    <div v-else-if="tab === 'docs'" class="panel">
      <div class="bar"><FilterBar v-model:search="dSearch" v-model:filters="dFilters" v-model:range="dRange" :chips="dChips" :search-placeholder="t('customsUi.docs.search')" @clear="dClear" /></div>
      <DataTable :columns="docCols" :rows="docsFiltered" :loading="docsLoading" row-key="key" :filtered="dHasFilters" storage-key="customs-docs" :default-sort="{ key: 'at', dir: 'desc' }"
        :empty-title="t('customsUi.docs.empty')" :empty-desc="t('customsUi.docs.emptyDesc')" empty-icon="file" @clear-filters="dClear" @row-click="openIntl">
        <template #cell-number="{ row }"><span class="mono strong">{{ row.number }}</span></template>
        <template #cell-type="{ row }"><span class="ty"><Icon :name="row.type === 'air_manifest' ? 'list' : row.type === 'dummy_label' ? 'tag' : row.type === 'upload' ? 'upload' : 'file'" :size="13" />{{ t('intl.docTypes.' + row.type) }}</span></template>
        <template #cell-intlId="{ row }"><RouterLink :to="{ name: 'intl-detail', params: { id: row.intlId } }" class="link mono">{{ row.intlId }}</RouterLink></template>
        <template #cell-origin="{ row }"><span class="org"><Flag :code="row.origin" :size="11" />{{ row.origin }}</span></template>
        <template #cell-valueUsd="{ value }"><span class="num">{{ fmt.money(value) }}</span></template>
        <template #cell-at="{ value }"><DateTime :value="value" mode="date" /></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" :label="t('customsUi.docs.status.' + row.status)" :tone="DOC_STATUS_TONE[row.status]" size="sm" /></template>
        <template #cell-actions="{ row }">
          <button class="btn btn-ghost btn-xs" :disabled="busyKey === row.key || (row.type === 'upload' && !row.hasFile)" :title="row.type === 'upload' && !row.hasFile ? t('intl.detail.fileNotStored') : ''" @click.stop="dl(row)">
            <Spinner v-if="busyKey === row.key" :size="12" /><Icon v-else name="download" :size="12" />{{ t('common.download') }}
          </button>
        </template>
      </DataTable>
    </div>

    <div v-else-if="tab === 'manifests'" class="panel">
      <div class="bar">
        <FilterBar v-model:search="mSearch" v-model:filters="mFilters" :chips="mChips" :search-placeholder="t('customsUi.manifests.search')" @clear="mClear">
          <template #actions><RouterLink :to="{ name: 'manifests' }" class="btn btn-ghost btn-sm"><Icon name="external" :size="13" />{{ t('customsUi.manifests.all') }}</RouterLink></template>
        </FilterBar>
      </div>
      <DataTable :columns="mCols" :rows="mFiltered" :loading="mLoading" :filtered="mHasFilters" storage-key="customs-manifests" :default-sort="{ key: 'createdAt', dir: 'desc' }"
        :empty-title="t('customsUi.manifests.empty')" empty-icon="list" @clear-filters="mClear" @row-click="m => (drawer = { open: true, m })">
        <template #cell-id="{ value }"><span class="mono strong">{{ value }}</span></template>
        <template #cell-mawb="{ value }"><span class="mono">{{ value }}</span></template>
        <template #cell-flight="{ row }">{{ row.flight }}<div class="muted mono">{{ row.route }}</div></template>
        <template #cell-hawbs="{ row }"><span class="num">{{ (row.hawbs || []).length }}</span></template>
        <template #cell-weight="{ row }"><span class="num">{{ fmt.number(row.totals?.weightKg || 0, 1) }}</span></template>
        <template #cell-value="{ row }"><span class="num">{{ fmt.money(row.totals?.valueUsd || 0) }}</span></template>
        <template #cell-createdAt="{ value }"><DateTime :value="value" mode="date" /></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" :label="t('customsUi.manifests.status.' + row.status)" :tone="CUSTOMS_TONES[row.status]" size="sm" /></template>
        <template #cell-actions="{ row }">
          <button class="btn btn-ghost btn-xs" :disabled="busyKey === row.id" @click.stop="dlManifest(row)"><Spinner v-if="busyKey === row.id" :size="12" /><Icon v-else name="download" :size="12" />PDF</button>
        </template>
      </DataTable>
    </div>

    <div v-else class="stack">
      <div class="grid-kpi">
        <KpiCard :label="t('customsUi.status.inFlight')" :value="qKpi.flight" icon="plane" :loading="qLoading" />
        <KpiCard :label="t('customsUi.status.review')" :value="qKpi.review" icon="shield" tone="warning" :loading="qLoading" />
        <KpiCard :label="t('customsUi.status.docs')" :value="qKpi.docs" icon="alert" :tone="qKpi.docs ? 'danger' : ''" :loading="qLoading" />
        <KpiCard :label="t('customsUi.status.cleared')" :value="qKpi.cleared" icon="check-circle" tone="success" :loading="qLoading" />
      </div>
      <div v-for="r in queue.filter(x => x.customsStatus === 'docs_requested')" :key="r.id" class="callout danger req">
        <Icon name="alert" :size="16" />
        <div class="rq">
          <strong>{{ t('customsUi.status.requestTitle', { id: r.id, date: fmt.dateTime(r.customsRequest?.at) }) }}</strong>
          <span>{{ tx(r.customsRequest?.note) }}</span>
          <ul><li v-for="(d, i) in r.customsRequest?.docs || []" :key="i">{{ tx(d) }}</li></ul>
        </div>
        <button class="btn btn-danger" @click="openUpload(r)"><Icon name="upload" :size="14" />{{ t('intl.detail.uploadDocs') }}</button>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">{{ t('customsUi.status.title') }}</span><span class="panel-sub">{{ t('customsUi.status.sub') }}</span></div>
        <DataTable :columns="qCols" :rows="queue" :loading="qLoading" storage-key="customs-queue" :paginate="false"
          :empty-title="t('customsUi.status.empty')" :empty-desc="t('customsUi.status.emptyDesc')" empty-icon="shield" :row-class="r => (r.customsStatus === 'docs_requested' ? 'row-danger' : '')" @row-click="openIntl">
          <template #cell-id="{ row }"><RouterLink :to="{ name: 'intl-detail', params: { id: row.id } }" class="link mono">{{ row.id }}</RouterLink></template>
          <template #cell-origin="{ row }"><span class="org"><Flag :code="row.origin" :size="11" />{{ row.origin }}</span></template>
          <template #cell-mawb="{ value }"><span class="mono">{{ value || '-' }}</span></template>
          <template #cell-hawb="{ value }"><span class="mono">{{ value }}</span></template>
          <template #cell-stage="{ row }"><StatusPill :status="row.stage" :label="t('intl.stages.' + row.stage)" :tone="stageTone(row.stage, row.customsStatus)" size="sm" /></template>
          <template #cell-customsStatus="{ row }"><StatusPill :status="row.customsStatus" :label="t('intl.customsStatus.' + row.customsStatus)" :tone="CUSTOMS_TONES[row.customsStatus]" size="sm" /></template>
          <template #cell-declaredValueUsd="{ row }">
            <span class="num">{{ fmt.money(row.declaredValueUsd) }}</span>
            <span v-if="usDm.suspended" class="tag tag-warning dm" :title="t('customsUi.status.deMinimisSuspendedTip')">{{ t('customsUi.status.deMinimisSuspended') }}</span>
            <span v-else-if="row.declaredValueUsd > usDm.amount" class="tag tag-warning dm" :title="t('customsUi.status.deMinimisTip', { v: fmt.moneyNative(usDm.amount, usDm.currency, 0) })">{{ t('customsUi.status.deMinimis', { v: fmt.moneyNative(usDm.amount, usDm.currency, 0) }) }}</span>
          </template>
          <template #cell-actions="{ row }">
            <button v-if="row.customsStatus === 'docs_requested'" class="btn btn-danger btn-xs" @click.stop="openUpload(row)"><Icon name="upload" :size="12" />{{ t('intl.upload.choose') }}</button>
            <RouterLink v-else :to="{ name: 'intl-detail', params: { id: row.id } }" class="btn btn-ghost btn-xs" @click.stop>{{ t('common.open') }}</RouterLink>
          </template>
        </DataTable>
      </div>
    </div>

    <Drawer v-model:open="drawer.open" :title="drawer.m?.id || ''" :subtitle="drawer.m ? drawer.m.flight + ' · MAWB ' + drawer.m.mawb : ''" width="640px">
      <template #actions>
        <button v-if="drawer.m" class="btn btn-ghost btn-sm" :disabled="busyKey === drawer.m.id" @click="dlManifest(drawer.m)"><Icon name="download" :size="13" />PDF</button>
      </template>
      <div v-if="drawer.m" class="stack">
        <dl class="kv">
          <dt>{{ t('common.status') }}</dt><dd><StatusPill :status="drawer.m.status" :label="t('customsUi.manifests.status.' + drawer.m.status)" :tone="CUSTOMS_TONES[drawer.m.status]" size="sm" /></dd>
          <dt>{{ t('intl.detail.flight') }}</dt><dd>{{ drawer.m.flight }} ({{ drawer.m.route }})</dd>
          <dt>{{ t('intl.list.hub') }}</dt><dd>{{ drawer.m.hub }}</dd>
          <dt>{{ t('common.total') }}</dt><dd class="num">{{ drawer.m.totals?.parcels }} · {{ fmt.number(drawer.m.totals?.weightKg || 0, 1) }} kg · {{ fmt.money(drawer.m.totals?.valueUsd || 0) }}</dd>
        </dl>
        <div class="table-wrap">
          <table class="table-simple sm">
            <thead><tr><th>HAWB</th><th>{{ t('customsUi.docs.shipment') }}</th><th>{{ t('intl.manifest.contents') }}</th><th>HS</th><th class="r">{{ t('intl.manifest.value') }}</th></tr></thead>
            <tbody>
              <tr v-for="h in drawer.m.hawbs" :key="h.hawb">
                <td class="mono">{{ h.hawb }}</td>
                <td><RouterLink :to="{ name: 'intl-detail', params: { id: h.intlShipmentId } }" class="link mono">{{ h.intlShipmentId }}</RouterLink><div class="muted">{{ h.shipper }}</div></td>
                <td>{{ h.contents }}</td>
                <td class="mono">{{ (h.hsCodes || []).slice(0, 3).join(', ') }}<span v-if="(h.hsCodes || []).length > 3" class="muted"> +{{ h.hsCodes.length - 3 }}</span></td>
                <td class="r num">{{ fmt.money(h.valueUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>

    <CustomsUpload v-model:open="upload.open" :record="upload.rec" @uploaded="onUploaded" />
  </div>
</template>

<style scoped>
.tabs { margin-bottom: 16px; }
.bar { padding: 14px 16px; border-bottom: 1px solid var(--line-1); }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.strong { font-weight: 600; }
.muted { color: var(--ink-3); font-size: 12px; }
.ty { display: inline-flex; align-items: center; gap: 6px; }
.org { display: inline-flex; align-items: center; gap: 6px; }
.req { align-items: flex-start; }
.rq { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.rq ul { margin: 4px 0 0; padding-left: 18px; }
.dm { margin-left: 6px; height: 18px; font-size: 10.5px; }
.r { text-align: right; }
.table-simple.sm { font-size: 12.5px; }
:deep(.row-danger) td { background: oklch(0.985 0.012 25); }
@media (max-width: 560px) { .req { flex-wrap: wrap; } .req .rq { min-width: calc(100% - 30px); } }
</style>
