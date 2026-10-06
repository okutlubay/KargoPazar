<script setup>
// Monthly invoices (spec 5.10): list, detail lines, invoice PDF and period statement PDF.
import { computed, ref, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import DataTable from '../../components/DataTable.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import Money from '../../components/Money.vue'
import FxNote from '../../components/FxNote.vue'
import Drawer from '../../components/Drawer.vue'
import Spinner from '../../components/Spinner.vue'
import { listInvoices } from '../../api/wallet.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t, tx, fmt } from '../../i18n/index.js'

const rows = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref('')

async function load() {
  loading.value = true
  try { rows.value = await listInvoices() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(load)

const period = r => `${fmt.date(r.periodStart)} - ${fmt.date(r.periodEnd)}`
const columns = computed(() => [
  { key: 'id', label: t('billing.inv.number'), sortable: true, width: 150 },
  { key: 'period', label: t('billing.inv.period'), value: r => r.periodStart, sortable: true },
  { key: 'issuedAt', label: t('billing.inv.issued'), sortable: true, hideBelow: 'md' },
  { key: 'labels', label: t('billing.inv.labels'), align: 'right', value: r => r.lines?.find(l => l.code === 'labels')?.qty ?? 0, hideBelow: 'lg' },
  { key: 'total', label: t('common.total'), sortable: true, align: 'right' },
  { key: 'status', label: t('common.status'), width: 120 },
  { key: 'actions', label: '', isAction: true, align: 'right', width: 200 },
])

async function pdf(inv, kind) {
  busy.value = inv.id + kind
  try {
    const d = await import('../../docs/index.js')
    if (kind === 'invoice') d.downloadMonthlyInvoice(inv)
    else d.downloadInvoiceStatement(inv)
    toast.success(t(kind === 'invoice' ? 'billing.inv.pdfDone' : 'billing.inv.stmtDone', { id: inv.id }))
  } catch (e) {
    toast.error(errorText(e))
  } finally { busy.value = '' }
}

const open = ref(false)
const current = ref(null)
function openRow(r) { current.value = r; open.value = true }
</script>

<template>
  <div class="stack">
    <div v-if="error" class="callout danger">{{ error }}</div>
    <DataTable :columns="columns" :rows="rows" :loading="loading" :paginate="false" storage-key="billing-inv"
      :default-sort="{ key: 'period', dir: 'desc' }" :empty-title="t('billing.inv.empty')" empty-icon="file" @row-click="openRow">
      <template #cell-id="{ row }"><span class="mono">{{ row.id }}</span><span v-if="row.estimated" class="tag est">{{ t('billing.inv.estimated') }}</span></template>
      <template #cell-period="{ row }">{{ period(row) }}</template>
      <template #cell-issuedAt="{ row }"><DateTime :value="row.issuedAt" mode="date" /></template>
      <template #cell-labels="{ row }"><span class="num">{{ fmt.number(row.lines?.find(l => l.code === 'labels')?.qty ?? 0) }}</span></template>
      <template #cell-total="{ row }"><Money :value="row.total" /></template>
      <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
      <template #cell-actions="{ row }">
        <div class="acts">
          <button class="btn btn-ghost btn-xs" :disabled="!!busy" @click.stop="pdf(row, 'invoice')"><Spinner v-if="busy === row.id + 'invoice'" :size="12" /><Icon v-else name="download" :size="12" /> PDF</button>
          <button class="btn btn-ghost btn-xs" :disabled="!!busy" @click.stop="pdf(row, 'statement')"><Spinner v-if="busy === row.id + 'statement'" :size="12" /><Icon v-else name="file" :size="12" /> {{ t('billing.inv.statement') }}</button>
        </div>
      </template>
    </DataTable>

    <Drawer v-model:open="open" :title="current?.id ?? ''" :subtitle="current ? period(current) : ''" width="520px">
      <div v-if="current" class="stack">
        <div class="head-row"><StatusPill :status="current.status" /><span class="muted">{{ t('billing.inv.paidFrom') }}</span></div>
        <table class="table-simple">
          <thead><tr><th>{{ t('billing.inv.line') }}</th><th class="r">{{ t('billing.inv.qty') }}</th><th class="r">{{ t('common.amount') }}</th></tr></thead>
          <tbody>
            <tr v-for="l in current.lines" :key="l.code"><td>{{ tx(l.desc) }}</td><td class="r num">{{ fmt.number(l.qty) }}</td><td class="r"><Money :value="l.amount" /></td></tr>
          </tbody>
          <tfoot>
            <tr><td colspan="2">{{ t('billing.inv.subtotal') }}</td><td class="r"><Money :value="current.subtotal" /></td></tr>
            <tr><td colspan="2">{{ t('billing.inv.tax') }}</td><td class="r"><Money :value="current.tax" /></td></tr>
            <tr class="grand"><td colspan="2">{{ t('common.total') }}</td><td class="r"><Money :value="current.total" /></td></tr>
          </tfoot>
        </table>
        <FxNote />
        <div v-if="current.estimated" class="callout neutral">{{ t('billing.inv.estimatedNote') }}</div>
      </div>
      <template v-if="current" #footer>
        <button class="btn btn-ghost btn-sm" :disabled="!!busy" @click="pdf(current, 'statement')"><Icon name="file" :size="13" /> {{ t('billing.inv.statement') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="!!busy" @click="pdf(current, 'invoice')"><Spinner v-if="busy" :size="12" /><Icon v-else name="download" :size="13" /> {{ t('common.downloadPdf') }}</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.est { margin-left: 6px; }
.acts { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.r { text-align: right; }
.head-row { display: flex; justify-content: space-between; align-items: center; }
.muted { color: var(--ink-3); font-size: 12.5px; }
tfoot td { padding: 8px 12px; font-size: 13px; color: var(--ink-2); }
tfoot .grand td { font-weight: 700; color: var(--ink-1); border-top: 1px solid var(--line-2); }
</style>
