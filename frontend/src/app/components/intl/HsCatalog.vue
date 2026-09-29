<script setup>
// Product catalog HS code status (spec 9.3 tab "HS codes", same data as AI > HS code suggestion 6.5).
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import DataTable from '@/app/components/DataTable.vue'
import FilterBar from '@/app/components/FilterBar.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import ProgressBar from '@/app/components/ProgressBar.vue'
import Spinner from '@/app/components/Spinner.vue'
import Modal from '@/app/components/Modal.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { can } from '@/app/store/session.js'
import { listCatalog } from '@/app/api/intl.js'
import { bulkSuggestForProducts, approveHsSuggestions, rejectHsSuggestion, hsCodeList, normalizeHsCode } from '@/app/api/ai.js'
import { errorText } from './stage.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const rows = ref([])
const loading = ref(true)
const search = ref('')
const filters = ref({ status: [] })
const bulk = ref(null)
const busy = ref({})
const codes = hsCodeList()

async function load(silent) {
  if (!silent) loading.value = true
  try { rows.value = await listCatalog() } catch (e) { toast.error(errorText(t, e)) } finally { loading.value = false }
}
onMounted(() => load())

const statusOf = p => (!p.hsCode && p.hsSuggestion ? 'ai_pending' : !p.hsCode ? 'missing' : p.hsSuggestion && p.hsSuggestion.code !== p.hsCode ? 'review' : 'confirmed')
const STATUS_TONE = { missing: 'danger', ai_pending: 'warning', review: 'warning', confirmed: 'success' }
const chips = computed(() => [{ key: 'status', label: t('common.status'), options: ['missing', 'ai_pending', 'review', 'confirmed'].map(s => ({ value: s, label: t('customsUi.hs.status.' + s), count: rows.value.filter(p => statusOf(p) === s).length })) }])
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(p => {
    if (filters.value.status?.length && !filters.value.status.includes(statusOf(p))) return false
    if (q && ![p.sku, p.title?.tr, p.title?.en, p.hsCode].some(v => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
})
const hasFilters = computed(() => !!(search.value || filters.value.status?.length))
function clear() { search.value = ''; filters.value = { status: [] } }
const counts = computed(() => ({
  total: rows.value.length,
  missing: rows.value.filter(p => !p.hsCode).length,
  pending: rows.value.filter(p => p.hsSuggestion).length,
  coverage: rows.value.length ? rows.value.filter(p => p.hsCode).length / rows.value.length : 0,
}))
const pendingRows = computed(() => rows.value.filter(p => p.hsSuggestion))

const columns = computed(() => [
  { key: 'sku', label: 'SKU', sortable: true, nowrap: true },
  { key: 'title', label: t('customsUi.hs.product'), value: p => tx(p.title), sortable: true },
  { key: 'origin', label: t('customsUi.hs.origin'), hideBelow: 'md' },
  { key: 'hsCode', label: t('customsUi.hs.code'), sortable: true },
  { key: 'status', label: t('common.status'), value: statusOf, sortable: true },
  { key: 'suggestion', label: t('customsUi.hs.suggestion'), hideBelow: 'md' },
  { key: 'actions', label: '', isAction: true, align: 'right' },
])
const desc = code => tx(codes.find(c => c.code === code)?.desc) || ''

async function bulkSuggest() {
  bulk.value = { pct: 0, done: 0, total: counts.value.missing }
  try {
    const res = await bulkSuggestForProducts({ onlyMissing: true, onProgress: (pct, info) => { bulk.value = { pct, done: info?.done ?? 0, total: info?.total ?? bulk.value.total } } })
    await load(true)
    toast.success(res.length ? t('customsUi.hs.bulkDone', { n: res.length }) : t('customsUi.hs.bulkNone'))
  } catch (e) { toast.error(errorText(t, e)) } finally { bulk.value = null }
}
async function approve(list) {
  const key = list.length === 1 ? list[0].sku : '__all'
  busy.value = { ...busy.value, [key]: true }
  try {
    const r = await approveHsSuggestions(list)
    await load(true)
    toast.success(t('customsUi.hs.approved', { n: r.approved?.length ?? list.length }))
  } catch (e) { toast.error(errorText(t, e)) } finally { busy.value = { ...busy.value, [key]: false } }
}
async function reject(p) {
  busy.value = { ...busy.value, [p.sku]: true }
  try { await rejectHsSuggestion(p.sku); await load(true); toast.info(t('customsUi.hs.rejected', { sku: p.sku })) } catch (e) { toast.error(errorText(t, e)) } finally { busy.value = { ...busy.value, [p.sku]: false } }
}

// ---- choose a different code
const edit = ref({ open: false, product: null, code: '', free: '', error: '' })
function openEdit(p) { edit.value = { open: true, product: p, code: p.hsSuggestion?.code || p.hsCode || '', free: '', error: '' } }
async function saveEdit() {
  const code = normalizeHsCode(edit.value.free || edit.value.code)
  if (!code) { edit.value.error = t('customsUi.hs.invalidCode'); return }
  edit.value.open = false
  await approve([{ sku: edit.value.product.sku, code }])
}
</script>

<template>
  <div class="hs">
    <div class="grid-kpi">
      <KpiCard :label="t('customsUi.hs.kpiProducts')" :value="counts.total" icon="tag" :loading="loading" />
      <KpiCard :label="t('customsUi.hs.kpiCoverage')" :value="counts.coverage" format="percent" :digits="0" icon="check-circle" tone="success" :loading="loading" />
      <KpiCard :label="t('customsUi.hs.kpiMissing')" :value="counts.missing" icon="alert" :tone="counts.missing ? 'danger' : ''" :loading="loading" />
      <KpiCard :label="t('customsUi.hs.kpiPending')" :value="counts.pending" icon="wand" tone="warning" :loading="loading" />
    </div>

    <div class="panel">
      <div class="bar">
        <FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('customsUi.hs.search')" @clear="clear">
          <template #actions>
            <button class="btn btn-ghost btn-sm" @click="router.push({ name: 'ai-hs' })"><Icon name="brain" :size="13" />{{ t('customsUi.hs.openModel') }}</button>
            <button v-if="pendingRows.length" class="btn btn-soft btn-sm" :disabled="busy.__all || !can('ai.manage')" @click="approve(pendingRows.map(p => ({ sku: p.sku })))">
              <Spinner v-if="busy.__all" :size="13" /><Icon v-else name="check" :size="13" />{{ t('customsUi.hs.approveAll', { n: pendingRows.length }) }}
            </button>
            <button class="btn btn-primary btn-sm" :disabled="!!bulk || !counts.missing" :title="!counts.missing ? t('customsUi.hs.noneMissing') : ''" @click="bulkSuggest">
              <Spinner v-if="bulk" :size="13" /><Icon v-else name="wand" :size="13" />{{ t('customsUi.hs.bulk') }}
            </button>
          </template>
        </FilterBar>
        <ProgressBar v-if="bulk" :value="bulk.pct" :label="t('customsUi.hs.bulkProgress', { done: bulk.done, total: bulk.total })" show-value size="sm" />
      </div>
      <DataTable :columns="columns" :rows="filtered" :loading="loading" row-key="sku" :filtered="hasFilters" :clickable="false" storage-key="customs-hs"
        :empty-title="t('customsUi.hs.empty')" empty-icon="tag" @clear-filters="clear">
        <template #cell-sku="{ value }"><span class="mono">{{ value }}</span></template>
        <template #cell-title="{ row }">{{ tx(row.title) }}</template>
        <template #cell-hsCode="{ row }">
          <span v-if="row.hsCode" class="code"><strong class="mono">{{ row.hsCode }}</strong><span class="muted">{{ desc(row.hsCode) }}</span></span>
          <span v-else class="tag tag-danger">{{ t('customsUi.hs.noCode') }}</span>
        </template>
        <template #cell-status="{ row }"><StatusPill :status="statusOf(row)" :label="t('customsUi.hs.status.' + statusOf(row))" :tone="STATUS_TONE[statusOf(row)]" size="sm" /></template>
        <template #cell-suggestion="{ row }">
          <span v-if="row.hsSuggestion" class="sug">
            <span class="tag tag-accent">AI</span><strong class="mono">{{ row.hsSuggestion.code }}</strong>
            <span class="num muted">{{ fmt.percent(row.hsSuggestion.prob, 0) }}</span>
            <span v-if="row.hsSuggestion.lowConfidence" class="tag tag-warning">{{ t('customsUi.hs.low') }}</span>
          </span>
          <span v-else class="muted">-</span>
        </template>
        <template #cell-actions="{ row }">
          <span class="acts">
            <template v-if="row.hsSuggestion">
              <button class="btn btn-soft btn-xs" :disabled="busy[row.sku] || !can('ai.manage')" @click="approve([{ sku: row.sku }])"><Icon name="check" :size="12" />{{ t('customsUi.hs.approve') }}</button>
              <button class="btn btn-ghost btn-xs" :disabled="busy[row.sku]" @click="reject(row)">{{ t('customsUi.hs.reject') }}</button>
            </template>
            <button class="btn btn-ghost btn-xs" :disabled="!can('ai.manage')" @click="openEdit(row)"><Icon name="edit" :size="12" />{{ t('customsUi.hs.change') }}</button>
          </span>
        </template>
      </DataTable>
    </div>

    <Modal v-model:open="edit.open" :title="t('customsUi.hs.changeTitle', { sku: edit.product?.sku || '' })" :subtitle="tx(edit.product?.title)" size="sm">
      <label class="fld">
        <span class="fl">{{ t('customsUi.hs.pick') }}</span>
        <select v-model="edit.code" class="select">
          <option v-for="c in codes" :key="c.code" :value="c.code">{{ c.code }} · {{ tx(c.desc) }}</option>
        </select>
      </label>
      <label class="fld">
        <span class="fl">{{ t('customsUi.hs.free') }}</span>
        <input v-model="edit.free" class="input mono" placeholder="630492" :class="{ invalid: edit.error }" @input="edit.error = ''" />
        <span v-if="edit.error" class="field-error">{{ edit.error }}</span>
      </label>
      <template #footer>
        <button class="btn btn-ghost" @click="edit.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" @click="saveEdit">{{ t('common.save') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.hs { display: flex; flex-direction: column; gap: 16px; }
.bar { padding: 14px 16px; border-bottom: 1px solid var(--line-1); display: flex; flex-direction: column; gap: 10px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.muted { color: var(--ink-3); font-size: 12px; }
.code { display: flex; flex-direction: column; }
.sug { display: inline-flex; align-items: center; gap: 6px; }
.acts { display: inline-flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.fld { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.fl { font-size: 12px; color: var(--ink-3); font-weight: 500; }
</style>
