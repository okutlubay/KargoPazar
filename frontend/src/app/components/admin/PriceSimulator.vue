<script setup>
// Price simulator (spec 10.2): customer + shipment -> which tariff applies and the step by step breakdown.
import { ref, reactive, watch, onMounted, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import FormField from '../FormField.vue'
import SegmentedControl from '../SegmentedControl.vue'
import PackageForm from '../PackageForm.vue'
import Toggle from '../Toggle.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import CarrierLogo from '../CarrierLogo.vue'
import { useI18n } from '../../i18n/index.js'
import { simulatePrice } from '../../api/admin.js'
import { errorText, fieldText } from '../settings/util.js'

const props = defineProps({ customers: { type: Array, default: () => [] } })
const { t, fmt } = useI18n()

const input = reactive({ customerId: 'CUS-001', hub: 'NJ01', toZip: '78701', residential: true, declaredValue: 60, pkg: { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: 2, preset: 'custom' }, serviceKey: '' })
const loading = ref(false)
const res = ref(null)
const error = ref('')
const fieldErr = ref({})
let timer = null
let seq = 0

async function run() {
  const my = ++seq
  loading.value = true
  error.value = ''
  fieldErr.value = {}
  try {
    const r = await simulatePrice(JSON.parse(JSON.stringify(input)))
    if (my !== seq) return
    res.value = r
    if (!input.serviceKey) input.serviceKey = `${r.selected.carrierCode}-${r.selected.serviceCode}`
  } catch (e) {
    if (my !== seq) return
    error.value = errorText(e, 'admin')
    fieldErr.value = Object.fromEntries(Object.entries(e?.details ?? {}).map(([k, v]) => [k, fieldText(v, 'admin')]))
    res.value = null
  } finally { if (my === seq) loading.value = false }
}
function schedule() { clearTimeout(timer); timer = setTimeout(run, 350) }
watch(() => [input.customerId, input.hub, input.toZip, input.residential, input.declaredValue, input.pkg.lengthIn, input.pkg.widthIn, input.pkg.heightIn, input.pkg.weightLb, input.serviceKey], schedule)
onMounted(run)

function pick(q) { input.serviceKey = `${q.carrierCode}-${q.serviceCode}` }
const selKey = computed(() => (res.value ? `${res.value.selected.carrierCode}-${res.value.selected.serviceCode}` : ''))
const TARIFF_TONE = { platform: 'tag', custom: 'tag tag-accent', dynamic: 'tag tag-success' }
function stepLabel(s) {
  const p = { ...s.params }
  if ('pct' in p) p.pct = fmt.percent(p.pct, 1)
  if ('planPct' in p) p.planPct = fmt.percent(p.planPct, 0)
  if ('plan' in p) p.plan = t('plans.' + p.plan)
  for (const k of ['base', 'perLb', 'fee', 'before', 'free', 'per100', 'expected']) if (k in p) p[k] = fmt.money(p[k])
  if ('value' in p) p.value = fmt.money(p.value)
  return t('admin.sim.steps.' + s.code, p)
}
const strong = new Set(['cost', 'sell', 'total'])
</script>

<template>
  <div class="sim">
    <Card :title="t('admin.sim.inputTitle')" :subtitle="t('admin.sim.inputDesc')">
      <div class="stack">
        <FormField :label="t('admin.rates.customer')" :value="input.customerId" v-slot="{ id }">
          <select :id="id" v-model="input.customerId" class="select">
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }} · {{ t('plans.' + c.plan) }}</option>
          </select>
        </FormField>
        <div>
          <div class="lbl">{{ t('admin.sim.hub') }}</div>
          <SegmentedControl v-model="input.hub" :options="[{ value: 'NJ01', label: 'NJ01 · New Jersey' }, { value: 'LA01', label: 'LA01 · Los Angeles' }]" size="sm" block :aria-label="t('admin.sim.hub')" />
        </div>
        <div class="two">
          <FormField :label="t('admin.sim.zip')" :error="fieldErr.toZip" :value="input.toZip" v-slot="{ id, invalid }">
            <input :id="id" v-model="input.toZip" class="input mono" maxlength="5" inputmode="numeric" :aria-invalid="invalid || !!fieldErr.toZip" />
          </FormField>
          <FormField :label="t('admin.sim.declared')" :value="input.declaredValue" v-slot="{ id }">
            <input :id="id" v-model.number="input.declaredValue" type="number" min="0" step="10" class="input num" />
          </FormField>
        </div>
        <Toggle v-model="input.residential" :label="t('admin.sim.residential')" size="sm" />
        <PackageForm v-model="input.pkg" :show-summary="false" />
      </div>
    </Card>

    <div class="out">
      <div v-if="error" class="callout danger"><Icon name="alert" :size="14" />{{ error }}</div>
      <Card v-if="!res && loading" padding="md"><Skeleton :lines="8" /></Card>
      <template v-else-if="res">
        <Card :title="t('admin.sim.breakdownTitle')" padding="none">
          <template #actions>
            <Spinner v-if="loading" :size="14" />
            <span :class="TARIFF_TONE[res.tariff]">{{ t('admin.sim.tariff.' + res.tariff) }}</span>
          </template>
          <div class="sel">
            <CarrierLogo :code="res.selected.carrierCode" :name="res.selected.carrierName" show-name :sub="res.selected.serviceName" :size="30" />
            <div class="sel-meta">
              <span>{{ res.customer.name }} · {{ t('plans.' + res.customer.plan) }}</span>
              <span>{{ input.hub }} → {{ input.toZip }} {{ res.toState ?? '' }} · {{ t('admin.zone', { z: res.zone }) }}</span>
            </div>
            <div class="sel-total num">{{ fmt.money(res.selected.total) }}</div>
          </div>
          <ol class="steps">
            <li v-for="(s, i) in res.steps" :key="i" :class="{ strong: strong.has(s.code), hl: ['custom_markup', 'custom_fixed', 'dynamic', 'plan_markup'].includes(s.code) }">
              <span class="n mono">{{ i + 1 }}</span>
              <span class="d">{{ stepLabel(s) }}</span>
              <span class="a num">{{ s.amount != null ? fmt.money(s.amount) : '' }}</span>
            </li>
          </ol>
        </Card>

        <Card :title="t('admin.sim.allTitle', { n: res.quotes.length })" :subtitle="t('admin.sim.allDesc')" padding="none">
          <div class="table-wrap">
            <table class="table-simple quotes">
              <thead><tr><th>{{ t('admin.rates.service') }}</th><th class="r">{{ t('admin.sim.cost') }}</th><th class="r">{{ t('admin.sim.markup') }}</th><th class="r">{{ t('admin.sim.price') }}</th><th>{{ t('admin.sim.source') }}</th><th class="r">{{ t('admin.sim.eta') }}</th></tr></thead>
              <tbody>
                <tr v-for="q in res.quotes" :key="q.key" :class="{ on: `${q.carrierCode}-${q.serviceCode}` === selKey }" tabindex="0" @click="pick(q)" @keydown.enter="pick(q)">
                  <td><CarrierLogo :code="q.carrierCode" :name="q.carrierName" show-name :sub="q.serviceName" :size="22" /></td>
                  <td class="r num">{{ fmt.money(q.cost) }}</td>
                  <td class="r num">{{ q.markupPct != null ? fmt.percent(q.markupPct, 1) : '-' }}</td>
                  <td class="r num"><strong>{{ fmt.money(q.total) }}</strong></td>
                  <td><span :class="TARIFF_TONE[q.source] ?? 'tag'">{{ t('admin.sim.tariff.' + q.source) }}</span></td>
                  <td class="r">{{ t('admin.sim.days', { n: q.etaDays }) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sim { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; align-items: start; }
.out { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.lbl { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--ink-2); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sel { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--line-1); flex-wrap: wrap; }
.sel-meta { display: flex; flex-direction: column; font-size: 12.5px; color: var(--ink-3); flex: 1; min-width: 180px; }
.sel-total { font-family: var(--font-display); font-size: 24px; font-weight: 600; }
.steps { list-style: none; margin: 0; padding: 6px 0; }
.steps li { display: grid; grid-template-columns: 28px minmax(0, 1fr) 110px; gap: 10px; align-items: center; padding: 8px 20px; font-size: 13.5px; }
.steps li.hl { background: var(--accent-soft); }
.steps li.strong { font-weight: 600; border-top: 1px dashed var(--line-2); }
.n { width: 22px; height: 22px; border-radius: 6px; background: var(--bg-3); display: grid; place-items: center; font-size: 11px; color: var(--ink-3); }
.a { text-align: right; }
.r { text-align: right; }
.quotes tbody tr { cursor: pointer; }
.quotes tbody tr:hover { background: var(--bg-2); }
.quotes tbody tr.on { background: var(--accent-soft); }
@media (max-width: 1024px) { .sim { grid-template-columns: 1fr; } }
</style>
