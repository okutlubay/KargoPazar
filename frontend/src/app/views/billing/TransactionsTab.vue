<script setup>
// Wallet transactions (spec 5.10): date, type, description (shipment link), amount, balance. Filters + CSV.
import { computed, ref, watch, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import DataTable from '../../components/DataTable.vue'
import FilterBar, { inRange } from '../../components/FilterBar.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import Money from '../../components/Money.vue'
import { listTransactions, transactionsCsv } from '../../api/wallet.js'
import { errorText, downloadText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t, tx, fmt, locale } from '../../i18n/index.js'
import { db } from '../../store/db.js'

const TYPES = ['label', 'topup', 'refund', 'adjustment', 'plan_fee', 'opening']
const rows = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const filters = ref({ type: [], status: null })
const range = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  try { rows.value = await listTransactions() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(load)
// Reload when the wallet changes elsewhere (top-up, auto top-up, pending refund settled).
const txCount = computed(() => (db.doc('wallet').transactions ?? []).length + ':' + (db.doc('wallet').transactions ?? []).filter(x => x.status === 'pending').length)
watch(txCount, () => load())

const counts = computed(() => {
  const c = {}
  for (const r of rows.value) c[r.type] = (c[r.type] ?? 0) + 1
  return c
})
const chips = computed(() => [
  { key: 'type', label: t('billing.tx.type'), icon: 'filter', options: TYPES.filter(x => counts.value[x]).map(x => ({ value: x, label: t('core.txnTypes.' + x), count: counts.value[x] })) },
  { key: 'status', label: t('common.status'), multiple: false, options: [{ value: 'completed', label: t('status.completed') }, { value: 'pending', label: t('status.pending') }] },
])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => {
    if (filters.value.type?.length && !filters.value.type.includes(r.type)) return false
    if (filters.value.status && r.status !== filters.value.status) return false
    if (!inRange(r.at, range.value)) return false
    if (q && ![r.id, r.shipmentId, r.adjustmentId, tx(r.description)].some(v => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
})
const hasFilters = computed(() => !!search.value || !!filters.value.type?.length || !!filters.value.status || !!range.value)
function clear() { search.value = ''; filters.value = { type: [], status: null }; range.value = null }

const totals = computed(() => {
  let credit = 0, debit = 0
  for (const r of filtered.value) { if (r.status !== 'completed') continue; if (r.amount > 0) credit += r.amount; else debit += r.amount }
  return { credit, debit }
})

const columns = computed(() => [
  { key: 'at', label: t('common.date'), sortable: true, width: 150, nowrap: true },
  { key: 'type', label: t('billing.tx.type'), sortable: true, width: 150 },
  { key: 'description', label: t('billing.tx.description'), value: r => tx(r.description) },
  { key: 'amount', label: t('common.amount'), sortable: true, align: 'right', width: 120 },
  { key: 'balanceAfter', label: t('billing.tx.balance'), sortable: true, align: 'right', width: 120, hideBelow: 'md' },
  { key: 'status', label: t('common.status'), width: 130, hideBelow: 'lg' },
])

function exportCsv() {
  const list = filtered.value
  if (!list.length) { toast.warning(t('billing.tx.csvEmpty')); return }
  downloadText(`kargopazar-transactions-${new Date().toISOString().slice(0, 10)}.csv`, transactionsCsv(list, locale.value))
  toast.success(t('billing.tx.csvDone', { n: fmt.number(list.length) }))
}
const typeTone = { label: '', topup: 'tag-success', refund: 'tag-accent', adjustment: 'tag-warning', plan_fee: '', opening: '' }
</script>

<template>
  <div class="stack">
    <FilterBar v-model:search="search" v-model:filters="filters" v-model:range="range" :chips="chips" :search-placeholder="t('billing.tx.searchPh')" @clear="clear">
      <template #actions>
        <button class="btn btn-ghost btn-sm" @click="exportCsv"><Icon name="download" :size="14" /> {{ t('common.exportCsv') }}</button>
      </template>
    </FilterBar>
    <div v-if="error" class="callout danger">{{ error }} <button class="btn-link" @click="load">{{ t('common.retry') }}</button></div>
    <div v-if="!loading && filtered.length" class="tot">
      <span>{{ t('billing.tx.shown', { n: fmt.number(filtered.length) }) }}</span>
      <span>{{ t('billing.tx.credits') }} <Money :value="totals.credit" colored signed /></span>
      <span>{{ t('billing.tx.debits') }} <Money :value="totals.debit" colored /></span>
    </div>
    <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" :clickable="false" storage-key="billing-tx"
      :default-sort="{ key: 'at', dir: 'desc' }" :empty-title="t('billing.tx.empty')" empty-icon="wallet" @clear-filters="clear">
      <template #cell-at="{ row }"><DateTime :value="row.at" mode="short" /></template>
      <template #cell-type="{ row }"><span class="tag" :class="typeTone[row.type]">{{ t('core.txnTypes.' + row.type) }}</span><span v-if="row.auto" class="auto">{{ t('billing.tx.auto') }}</span></template>
      <template #cell-description="{ row }">
        <div class="desc">
          <span>{{ tx(row.description) }}</span>
          <RouterLink v-if="row.shipmentId" :to="`/shipments/${row.shipmentId}`" class="link mono">{{ row.shipmentId }}</RouterLink>
          <RouterLink v-if="row.adjustmentId" :to="{ path: '/billing', query: { tab: 'adjustments', id: row.adjustmentId } }" class="link mono">{{ row.adjustmentId }}</RouterLink>
          <span class="mono muted">{{ row.id }}</span>
        </div>
      </template>
      <template #cell-amount="{ row }"><Money :value="row.amount" colored signed /></template>
      <template #cell-balanceAfter="{ row }"><span v-if="row.balanceAfter == null" class="muted">-</span><Money v-else :value="row.balanceAfter" /></template>
      <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
    </DataTable>
  </div>
</template>

<style scoped>
.desc { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.muted { color: var(--ink-4); }
.auto { margin-left: 6px; font-size: 11px; color: var(--ink-3); }
.tot { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-3); }
</style>
