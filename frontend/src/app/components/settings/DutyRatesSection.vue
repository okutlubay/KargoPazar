<script setup>
// Settings > Customs rates: demo duty table per HS code and destination (hs_duty_rates).
// Edits base duty, TR origin additional duty, sales tax / VAT and processing fees.
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import Modal from '../Modal.vue'
import SegmentedControl from '../SegmentedControl.vue'
import Money from '../Money.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listDutyRates, saveDutyRate } from '../../api/duties.js'
import { errorText } from './util.js'

const { t, tx, fmt } = useI18n()
const loading = ref(true)
const rows = ref([])
const dest = ref('US')
const q = ref('')
const locked = computed(() => !can('settings.manage'))
const DESTS = ['US', 'GB', 'DE', 'TR']

async function load() {
  loading.value = true
  try { rows.value = await listDutyRates() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return rows.value.filter(r => r.dest === dest.value && (!s || r.hsCode.includes(s) || tx(r.hsDesc).toLowerCase().includes(s)))
})
const pct = v => fmt.percent(v || 0, (v || 0) * 100 % 1 ? 1 : 0)

// ---- edit modal
const edit = reactive({ open: false, row: null, saving: false, errors: {}, form: {} })
const toPct = v => (v == null ? '' : Math.round(v * 1e6) / 1e4)
function openEdit(r) {
  edit.row = r
  edit.errors = {}
  edit.form = {
    baseRate: toPct(r.baseRate),
    surchargeTR: toPct(r.originSurcharges?.TR || 0),
    salesTaxRate: toPct(r.salesTaxRate),
    fixed: r.fees?.fixed ?? 0,
    pct: toPct(r.fees?.pct || 0),
    min: r.fees?.min ?? 0,
    max: r.fees?.max ?? 0,
  }
  edit.open = true
}
const fromPct = v => (v === '' || v == null ? 0 : Number(v) / 100)
async function save() {
  const f = edit.form
  edit.saving = true
  edit.errors = {}
  try {
    const rec = await saveDutyRate(edit.row.id, {
      baseRate: fromPct(f.baseRate),
      salesTaxRate: fromPct(f.salesTaxRate),
      originSurcharges: { ...(edit.row.originSurcharges || {}), TR: fromPct(f.surchargeTR) },
      fees: { fixed: f.fixed, pct: fromPct(f.pct), min: f.min, max: f.max },
    })
    const i = rows.value.findIndex(r => r.id === rec.id)
    if (i >= 0) rows.value.splice(i, 1, rec)
    edit.open = false
    toast.success(t('customsInfo.rates.saved', { code: rec.hsCode, dest: rec.dest }))
  } catch (e) {
    if (e.code === 'VALIDATION' && e.details) edit.errors = e.details
    toast.error(e.code === 'VALIDATION' ? t('customsInfo.rates.invalid') : errorText(e))
  } finally { edit.saving = false }
}
const errOf = k => (edit.errors[k] ? t('customsInfo.rates.err.' + edit.errors[k]) : '')
</script>

<template>
  <div class="stack-lg" data-testid="duty-rates-section">
    <Card :title="t('customsInfo.rates.title')" :subtitle="t('customsInfo.rates.desc')">
      <div class="callout warn note" data-testid="duty-rates-note"><Icon name="info" :size="15" />{{ t('customsInfo.disclaimer') }}</div>
      <div class="bar">
        <SegmentedControl v-model="dest" :options="DESTS.map(d => ({ value: d, label: d }))" size="sm" :aria-label="t('customsInfo.rates.dest')" />
        <input v-model="q" class="input search" :placeholder="t('customsInfo.rates.search')" :aria-label="t('customsInfo.rates.search')" />
      </div>
      <div v-if="loading"><Skeleton :lines="8" /></div>
      <div v-else class="table-wrap">
        <table class="table-simple">
          <thead><tr>
            <th>HS</th><th class="r">{{ t('customsInfo.lines.duty') }}</th><th class="r">{{ t('customsInfo.rates.surchargeTR') }}</th>
            <th class="r">{{ dest === 'US' ? t('customsInfo.lines.taxUs') : t('customsInfo.lines.tax') }}</th><th>{{ t('customsInfo.lines.fee') }}</th><th class="r">{{ t('customsInfo.rates.updated') }}</th><th />
          </tr></thead>
          <tbody>
            <tr v-for="r in list" :key="r.id" :data-testid="'duty-row-' + r.id">
              <td><span class="mono strong">{{ r.hsCode }}</span><div class="muted small">{{ tx(r.hsDesc) }}</div></td>
              <td class="r num">{{ pct(r.baseRate) }}</td>
              <td class="r num">{{ r.originSurcharges?.TR ? pct(r.originSurcharges.TR) : '-' }}</td>
              <td class="r num">{{ pct(r.salesTaxRate) }}</td>
              <td class="small">{{ tx(r.fees?.label) }}<div class="muted">{{ r.fees?.pct ? pct(r.fees.pct) + ' · ' : '' }}<Money :value="r.fees?.min ?? 0" :currency="r.currency" :convert="false" :mono="false" /> - <Money :value="r.fees?.max ?? 0" :currency="r.currency" :convert="false" :mono="false" /></div></td>
              <td class="r small muted">{{ typeof r.updatedAt === 'string' ? fmt.date(r.updatedAt) : '-' }}</td>
              <td class="r"><button class="btn btn-ghost btn-sm" :disabled="locked" :title="locked ? t('common.noPermission') : ''" @click="openEdit(r)"><Icon name="edit" :size="13" />{{ t('common.edit') }}</button></td>
            </tr>
            <tr v-if="!list.length"><td colspan="7" class="muted">{{ t('customsInfo.rates.empty') }}</td></tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Modal v-model:open="edit.open" :title="edit.row ? t('customsInfo.rates.editTitle', { code: edit.row.hsCode, dest: edit.row.dest }) : ''" :subtitle="edit.row ? tx(edit.row.hsDesc) : ''" size="md">
      <div v-if="edit.row" class="eform" data-testid="duty-rate-form">
        <label class="f"><span class="field-label">{{ t('customsInfo.rates.base') }}</span><input v-model="edit.form.baseRate" type="number" step="0.01" min="0" class="input" :class="{ invalid: errOf('baseRate') }" /><span v-if="errOf('baseRate')" class="field-error">{{ errOf('baseRate') }}</span></label>
        <label class="f"><span class="field-label">{{ t('customsInfo.rates.surchargeTRField') }}</span><input v-model="edit.form.surchargeTR" type="number" step="0.01" min="0" class="input" :class="{ invalid: errOf('originSurcharges.TR') }" /><span v-if="errOf('originSurcharges.TR')" class="field-error">{{ errOf('originSurcharges.TR') }}</span></label>
        <label class="f"><span class="field-label">{{ edit.row.dest === 'US' ? t('customsInfo.rates.salesTax') : t('customsInfo.rates.vat') }}</span><input v-model="edit.form.salesTaxRate" type="number" step="0.01" min="0" class="input" :class="{ invalid: errOf('salesTaxRate') }" /><span v-if="errOf('salesTaxRate')" class="field-error">{{ errOf('salesTaxRate') }}</span></label>
        <div class="fees">
          <div class="field-label">{{ tx(edit.row.fees?.label) || t('customsInfo.lines.fee') }} ({{ edit.row.currency }})</div>
          <div class="fgrid">
            <label class="f"><span class="muted small">{{ t('customsInfo.rates.fixed') }}</span><input v-model="edit.form.fixed" type="number" step="0.01" min="0" class="input" :class="{ invalid: errOf('fees.fixed') }" /></label>
            <label class="f"><span class="muted small">{{ t('customsInfo.rates.feePct') }}</span><input v-model="edit.form.pct" type="number" step="0.0001" min="0" class="input" :class="{ invalid: errOf('fees.pct') }" /></label>
            <label class="f"><span class="muted small">{{ t('customsInfo.rates.min') }}</span><input v-model="edit.form.min" type="number" step="0.01" min="0" class="input" :class="{ invalid: errOf('fees.min') }" /></label>
            <label class="f"><span class="muted small">{{ t('customsInfo.rates.max') }}</span><input v-model="edit.form.max" type="number" step="0.01" min="0" class="input" :class="{ invalid: errOf('fees.max') }" /></label>
          </div>
          <span v-if="errOf('fees.max')" class="field-error">{{ errOf('fees.max') }}</span>
        </div>
        <p class="muted small">{{ t('customsInfo.disclaimer') }}</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="edit.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="edit.saving" data-testid="duty-rate-save" @click="save"><Spinner v-if="edit.saving" :size="13" />{{ t('common.save') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.note { margin-bottom: 12px; }
.bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.search { max-width: 260px; }
.r { text-align: right; }
.small { font-size: 12px; }
.strong { font-weight: 600; }
.eform { display: flex; flex-direction: column; gap: 12px; }
.f { display: flex; flex-direction: column; gap: 4px; }
.fgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 6px; }
@media (max-width: 640px) { .fgrid { grid-template-columns: 1fr 1fr; } }
</style>
