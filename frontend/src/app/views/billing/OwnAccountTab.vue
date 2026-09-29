<script setup>
// Shipments made with the customer's own carrier account (spec 5.10, IP4): carrier charge goes to the
// customer's carrier account, only the platform fee is taken from the wallet.
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import DataTable from '../../components/DataTable.vue'
import FilterBar, { inRange } from '../../components/FilterBar.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import Money from '../../components/Money.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import { ownAccountShipments } from '../../api/wallet.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { db } from '../../store/db.js'
import { t, fmt } from '../../i18n/index.js'

const router = useRouter()
const rows = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const range = ref(null)

async function load() {
  loading.value = true
  try { rows.value = await ownAccountShipments() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(load)

const accounts = computed(() => Object.fromEntries(db.all('carrier_accounts').map(a => [a.id, a])))
const accLabel = id => {
  const a = accounts.value[id]
  if (!a) return id
  const num = String(a.accountNumber ?? a.accountMasked ?? '')
  return `${a.carrier} •••• ${num.slice(-2)}`
}
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => inRange(r.createdAt, range.value) && (!q || [r.id, r.trackingNo, r.to?.name, r.orderId].some(v => String(v ?? '').toLowerCase().includes(q))))
})
const hasFilters = computed(() => !!search.value || !!range.value)
function clear() { search.value = ''; range.value = null }
const totals = computed(() => ({
  n: filtered.value.length,
  carrier: filtered.value.reduce((s, r) => s + (r.carrierCharge || 0), 0),
  fees: filtered.value.reduce((s, r) => s + (r.walletCharge || 0), 0),
}))

const columns = computed(() => [
  { key: 'id', label: t('billing.own.shipment'), sortable: true, width: 120 },
  { key: 'createdAt', label: t('common.date'), sortable: true, hideBelow: 'md' },
  { key: 'carrier', label: t('billing.own.carrier') },
  { key: 'accountId', label: t('billing.own.account'), hideBelow: 'lg' },
  { key: 'trackingNo', label: t('billing.own.tracking'), hideBelow: 'lg' },
  { key: 'carrierCharge', label: t('billing.own.carrierCharge'), sortable: true, align: 'right' },
  { key: 'walletCharge', label: t('billing.own.walletCharge'), sortable: true, align: 'right' },
  { key: 'status', label: t('common.status'), width: 140 },
])
function carrierService(r) {
  const c = db.get('carriers', r.carrier)
  return c?.services?.find(s => s.code === r.service)?.name ?? r.service
}
</script>

<template>
  <div class="stack">
    <div class="callout neutral">{{ t('billing.own.explain') }}</div>
    <div class="grid-3 sums">
      <div class="panel panel-pad"><div class="k">{{ t('billing.own.count') }}</div><div class="v num">{{ fmt.number(totals.n) }}</div></div>
      <div class="panel panel-pad"><div class="k">{{ t('billing.own.sumCarrier') }}</div><div class="v"><Money :value="totals.carrier" /></div></div>
      <div class="panel panel-pad"><div class="k">{{ t('billing.own.sumFees') }}</div><div class="v"><Money :value="totals.fees" /></div></div>
    </div>
    <FilterBar v-model:search="search" v-model:range="range" :search-placeholder="t('billing.own.searchPh')" @clear="clear" />
    <div v-if="error" class="callout danger">{{ error }}</div>
    <DataTable :columns="columns" :rows="filtered" :loading="loading" :filtered="hasFilters" storage-key="billing-own"
      :default-sort="{ key: 'createdAt', dir: 'desc' }" :empty-title="t('billing.own.empty')" :empty-desc="t('billing.own.emptyDesc')"
      :empty-action-label="t('billing.own.connect')" empty-icon="truck" @clear-filters="clear" @empty-action="router.push('/integrations/carrier-accounts')"
      @row-click="r => router.push(`/shipments/${r.id}`)">
      <template #cell-id="{ row }"><span class="mono">{{ row.id }}</span></template>
      <template #cell-createdAt="{ row }"><DateTime :value="row.createdAt" mode="short" /></template>
      <template #cell-carrier="{ row }"><CarrierLogo :code="row.carrier" :size="22" show-name :sub="carrierService(row)" /></template>
      <template #cell-accountId="{ row }"><span class="tag tag-accent">{{ accLabel(row.accountId) }}</span></template>
      <template #cell-trackingNo="{ row }"><span class="mono">{{ row.trackingNo }}</span></template>
      <template #cell-carrierCharge="{ row }"><Money :value="row.carrierCharge" /></template>
      <template #cell-walletCharge="{ row }"><Money :value="row.walletCharge" /></template>
      <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
    </DataTable>
  </div>
</template>

<style scoped>
.sums .k { font-size: 12.5px; color: var(--ink-3); }
.sums .v { font-size: 20px; font-weight: 600; font-family: var(--font-display); margin-top: 2px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
</style>
