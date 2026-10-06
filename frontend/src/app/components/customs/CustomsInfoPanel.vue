<script setup>
// "Gümrük Bilgilendirme" / "Customs Information" panel: rates, de minimis, landed cost line by line,
// DDP vs DDU, required documents, Türkiye export side (ETGB), restrictions and clearance time.
//   <CustomsInfoPanel :items="[{ hsCode, title, valueUsd | unitValueUsd + qty, qty, origin }]" dest="US" origin="TR" v-model:incoterm="x" />
// Works for one line (shipment creation) and multi line bulk stock shipments (per line + total).
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Money from '../Money.vue'
import { useI18n } from '../../i18n/index.js'
import { estimateLandedCostMulti, normalizeHs, landedCostContext } from '../../api/landedCost.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  dest: { type: String, default: 'US' },
  origin: { type: String, default: 'TR' },
  incoterm: { type: String, default: 'DDP' },
  weightKg: { type: Number, default: null },
  showIncoterm: { type: Boolean, default: true },
  collapsible: { type: Boolean, default: true },
  defaultOpen: { type: Boolean, default: true },
})
const emit = defineEmits(['update:incoterm'])
const { t, tx, fmt } = useI18n()
const open = ref(props.defaultOpen)

const valid = computed(() => (props.items || [])
  .map(i => ({ ...i, hsCode: normalizeHs(i.hsCode) }))
  .filter(i => i.hsCode))
const res = computed(() => (valid.value.length ? estimateLandedCostMulti(valid.value, { dest: props.dest, origin: props.origin, incoterm: props.incoterm }) : null))
const multi = computed(() => valid.value.length > 1)
const cur = computed(() => res.value?.destCurrency || 'USD')
const showDisplay = computed(() => fmt.currency !== cur.value)
const ctx = computed(() => landedCostContext())
const countryName = code => {
  const c = ctx.value.countries.find(x => x.code === code)
  return c ? tx(c.name) : code
}
// unique HS rows for the rate table
const rateRows = computed(() => {
  const seen = new Map()
  for (const it of res.value?.items || []) {
    const r = it.result
    if (!seen.has(r.hsCode)) seen.set(r.hsCode, r)
  }
  return [...seen.values()]
})
const pct = v => (v == null ? '-' : fmt.percent(v, v * 100 % 1 ? 1 : 0))
const lineLabel = l => (l.key === 'fee' && l.label ? tx(l.label) : t(l.labelKey))
const dm = computed(() => res.value?.deMinimis)
const dmKey = computed(() => (!dm.value || dm.value.none ? 'none' : dm.value.status === 'suspended' ? 'suspended' : dm.value.applies ? 'applies' : 'exceeded'))
const form = computed(() => ((res.value?.valueUsd || 0) <= 400 ? 'cn22' : 'cn23'))
const docs = computed(() => {
  const out = [
    { key: 'commercial_invoice', auto: true },
    { key: form.value, auto: true },
    { key: 'origin_declaration', auto: true },
  ]
  if (props.dest === 'US') out.push({ key: 'us_manifest', auto: true })
  if (props.origin === 'TR') out.push({ key: 'etgb', auto: false })
  return out
})
// Türkiye micro export (ETGB): up to 15,000 EUR and 300 kg per shipment
const ETGB_EUR = 15000
const ETGB_KG = 300
const valueEur = computed(() => (res.value ? Math.round(res.value.valueUsd * (Number(ctx.value.fx?.EUR) || 0.85) * 100) / 100 : 0))
const etgbOk = computed(() => valueEur.value <= ETGB_EUR && (props.weightKg == null || props.weightKg <= ETGB_KG))
const incoterms = computed(() => res.value?.incoterms || { DDP: { sellerUsd: 0, buyerUsd: 0 }, DDU: { sellerUsd: 0, buyerUsd: 0, collectionFeeUsd: 0 } })
function pickIncoterm(k) { if (k !== props.incoterm) emit('update:incoterm', k) }
const notes = computed(() => rateRows.value.map(r => r.note).filter(Boolean).filter((n, i, a) => a.findIndex(x => tx(x) === tx(n)) === i))
</script>

<template>
  <section v-if="res" class="cip" data-testid="customs-info-panel">
    <header class="cip-head">
      <button v-if="collapsible" type="button" class="cip-toggle" :aria-expanded="open" @click="open = !open">
        <Icon name="shield" :size="15" />
        <span class="cip-title">{{ t('customsInfo.panel.title') }}</span>
        <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="13" />
      </button>
      <div v-else class="cip-toggle static"><Icon name="shield" :size="15" /><span class="cip-title">{{ t('customsInfo.panel.title') }}</span></div>
      <div class="cip-sum" data-testid="customs-info-total">
        <span class="muted">{{ t('customsInfo.panel.estimated') }}</span>
        <strong><Money :value="res.totalDest" :currency="cur" :convert="false" /></strong>
        <span v-if="showDisplay" class="muted">(<Money :value="res.totalUsd" />)</span>
      </div>
    </header>

    <div v-show="open" class="cip-body">
      <!-- route + HS -->
      <div class="cip-route">
        <span class="pill"><Icon name="plane" :size="12" />{{ countryName(origin) }} ({{ origin }}) → {{ countryName(dest) }} ({{ dest }})</span>
        <span class="pill"><Icon name="clock" :size="12" />{{ t('customsInfo.panel.clearance', { min: res.clearanceDays.min, max: res.clearanceDays.max }) }}</span>
        <span v-if="multi" class="pill"><Icon name="layers" :size="12" />{{ t('customsInfo.panel.lines', { n: valid.length }) }}</span>
      </div>

      <div v-if="res.prohibited.length" class="callout danger" data-testid="customs-info-prohibited">
        <Icon name="alert" :size="15" />
        <div><strong>{{ t('customsInfo.panel.prohibitedTitle') }}</strong>
          <ul class="plain"><li v-for="(p, i) in res.prohibited" :key="i">{{ t('customsInfo.panel.prohibited.' + p.side, { code: p.hsCode, category: tx(p.category), country: countryName(p.country), prefix: p.prefix }) }}</li></ul>
        </div>
      </div>
      <div v-else class="callout success-soft"><Icon name="check-circle" :size="15" />{{ t('customsInfo.panel.noRestriction', { dest: countryName(dest) }) }}</div>
      <div v-if="res.missing.length" class="callout warn"><Icon name="info" :size="15" />{{ t('customsInfo.panel.missing', { codes: res.missing.filter(Boolean).join(', '), dest }) }}</div>

      <!-- rates -->
      <div class="blk">
        <h4 class="blk-t">{{ t('customsInfo.panel.rates') }}</h4>
        <div class="table-wrap">
          <table class="table-simple rates">
            <thead><tr><th>{{ t('customsInfo.panel.hs') }}</th><th class="r">{{ t('customsInfo.lines.duty') }}</th><th class="r">{{ t('customsInfo.panel.surchargeCol', { origin }) }}</th><th class="r">{{ dest === 'US' ? t('customsInfo.lines.taxUs') : t('customsInfo.lines.tax') }}</th><th>{{ t('customsInfo.lines.fee') }}</th></tr></thead>
            <tbody>
              <tr v-for="r in rateRows" :key="r.hsCode">
                <td><span class="mono strong">{{ r.hsCode }}</span><div class="muted small">{{ r.hsDesc ? tx(r.hsDesc) : t('customsInfo.panel.unknownHs') }}</div></td>
                <template v-if="r.rateFound">
                  <td class="r num">{{ pct(r.rate.baseRate) }}</td>
                  <td class="r num">{{ pct(r.rate.originSurcharges?.[origin] || 0) }}</td>
                  <td class="r num">{{ pct(r.rate.salesTaxRate) }}</td>
                  <td class="small">{{ r.rate.fees ? tx(r.rate.fees.label) : '-' }}
                    <div v-if="r.rate.fees" class="muted">{{ r.rate.fees.pct ? pct(r.rate.fees.pct) + ' · ' : '' }}{{ t('customsInfo.panel.feeRange', { min: fmt.moneyNative(r.rate.fees.min, r.destCurrency), max: fmt.moneyNative(r.rate.fees.max, r.destCurrency) }) }}</div>
                  </td>
                </template>
                <td v-else colspan="4" class="muted">{{ t('customsInfo.panel.noRate') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="dm" :class="dmKey" data-testid="customs-info-deminimis">
          <Icon :name="dmKey === 'applies' ? 'check-circle' : dmKey === 'suspended' ? 'alert' : 'info'" :size="14" />
          <span>{{ t('customsInfo.panel.deMinimis.' + dmKey, { amount: dm && dm.amount != null ? fmt.moneyNative(dm.amount, dm.currency, 0) : '-', country: countryName(dest) }) }}</span>
        </div>
      </div>

      <!-- landed cost -->
      <div class="blk">
        <h4 class="blk-t">{{ t('customsInfo.panel.landed') }}</h4>
        <div v-if="multi" class="table-wrap">
          <table class="table-simple per-line" data-testid="customs-info-lines">
            <thead><tr><th>{{ t('customsInfo.panel.item') }}</th><th>HS</th><th class="r">{{ t('customsInfo.panel.value') }}</th><th class="r">{{ t('customsInfo.panel.dutyTotal') }}</th><th class="r">{{ t('customsInfo.lines.tax') }}</th><th class="r">{{ t('customsInfo.lines.fee') }}</th><th class="r">{{ t('common.total') }}</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in res.items" :key="i">
                <td>{{ it.title || '-' }}<div class="muted small">{{ t('customsInfo.panel.qty', { n: it.qty }) }}</div></td>
                <td class="mono">{{ it.result.hsCode }}</td>
                <td class="r"><Money :value="it.valueUsd" currency="USD" :convert="false" /></td>
                <td class="r"><Money :value="it.result.lines.filter(l => l.key === 'duty' || l.key === 'surcharge').reduce((s, l) => s + l.amountDest, 0)" :currency="cur" :convert="false" /></td>
                <td class="r"><Money :value="it.result.lines.filter(l => l.key === 'tax').reduce((s, l) => s + l.amountDest, 0)" :currency="cur" :convert="false" /></td>
                <td class="r"><Money :value="it.result.lines.filter(l => l.key === 'fee').reduce((s, l) => s + l.amountDest, 0)" :currency="cur" :convert="false" /></td>
                <td class="r strong"><Money :value="it.result.totalDest" :currency="cur" :convert="false" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <table class="table-simple lc">
          <tbody>
            <tr class="muted-row"><td>{{ t('customsInfo.panel.customsValue') }}</td><td class="r"><Money :value="res.valueUsd" currency="USD" :convert="false" /></td><td class="r muted">{{ cur !== 'USD' ? fmt.moneyNative(res.valueUsd * res.fxPerUsd, cur) : '' }}</td></tr>
            <tr v-for="l in res.lines" :key="l.key">
              <td>{{ lineLabel(l) }}<span v-if="l.rate != null && l.key !== 'fee'" class="muted"> ({{ pct(l.rate) }})</span><span v-if="l.waived" class="tag tag-success sm">{{ t('customsInfo.panel.waived') }}</span></td>
              <td class="r"><Money :value="l.amountDest" :currency="cur" :convert="false" /></td>
              <td class="r muted"><Money v-if="showDisplay" :value="l.amountUsd" /></td>
            </tr>
            <tr class="tot"><td>{{ t('customsInfo.panel.totalDuties') }}</td><td class="r"><Money :value="res.totalDest" :currency="cur" :convert="false" /></td><td class="r"><Money v-if="showDisplay" :value="res.totalUsd" /></td></tr>
          </tbody>
        </table>
        <p v-for="(n, i) in notes" :key="i" class="muted small note"><Icon name="info" :size="12" />{{ tx(n) }}</p>
      </div>

      <!-- DDP / DDU -->
      <div v-if="showIncoterm" class="blk">
        <h4 class="blk-t">{{ t('customsInfo.panel.incoterm') }}</h4>
        <div class="inco" role="radiogroup" :aria-label="t('customsInfo.panel.incoterm')" data-testid="ddp-ddu-toggle">
          <button v-for="k in ['DDP', 'DDU']" :key="k" type="button" role="radio" :aria-checked="incoterm === k" :class="['ic', { on: incoterm === k }]" :data-testid="'incoterm-' + k" @click="pickIncoterm(k)">
            <div class="ic-h">
              <strong>{{ k }}</strong><span class="muted small">{{ t('customsInfo.incoterm.' + k + '.name') }}</span>
              <span v-if="k === 'DDP' && dest === 'US'" class="tag tag-accent sm">{{ t('customsInfo.incoterm.recommended') }}</span>
            </div>
            <div class="ic-cost">
              <span>{{ t('customsInfo.incoterm.seller') }} <Money :value="incoterms[k].sellerUsd" /></span>
              <span>{{ t('customsInfo.incoterm.buyer') }} <Money :value="incoterms[k].buyerUsd" /></span>
            </div>
            <ul class="pc">
              <li v-for="(p, i) in t('customsInfo.incoterm.' + k + '.pros')" :key="'p' + i" class="pro"><Icon name="check" :size="12" />{{ p }}</li>
              <li v-for="(c, i) in t('customsInfo.incoterm.' + k + '.cons')" :key="'c' + i" class="con"><Icon name="x" :size="12" />{{ c }}</li>
              <li v-if="k === 'DDU'" class="con"><Icon name="x" :size="12" />{{ t('customsInfo.incoterm.DDU.feeLine', { fee: fmt.money(incoterms.DDU.collectionFeeUsd || 0) }) }}</li>
            </ul>
          </button>
        </div>
      </div>

      <!-- documents -->
      <div class="blk">
        <h4 class="blk-t">{{ t('customsInfo.panel.docs') }}</h4>
        <ul class="docs">
          <li v-for="d in docs" :key="d.key">
            <Icon name="file" :size="14" />
            <span class="dn"><strong>{{ t('customsInfo.docs.' + d.key + '.name') }}</strong><span class="muted small">{{ t('customsInfo.docs.' + d.key + '.desc') }}</span></span>
            <span :class="['tag', d.auto ? 'tag-success' : '']">{{ d.auto ? t('customsInfo.docs.auto') : t('customsInfo.docs.byBroker') }}</span>
          </li>
        </ul>
      </div>

      <!-- Türkiye export side -->
      <div v-if="origin === 'TR'" class="blk">
        <h4 class="blk-t">{{ t('customsInfo.etgb.title') }}</h4>
        <div class="callout" :class="etgbOk ? 'neutral' : 'warn'">
          <Icon name="info" :size="15" />
          <span>{{ etgbOk ? t('customsInfo.etgb.inScope', { eur: fmt.moneyNative(valueEur, 'EUR', 0) }) : t('customsInfo.etgb.outScope', { eur: fmt.moneyNative(valueEur, 'EUR', 0) }) }}</span>
        </div>
        <p class="muted small">{{ t('customsInfo.etgb.scope') }}</p>
        <div class="etgb-fields">
          <span v-for="k in ['gtip', 'desc', 'qty', 'value', 'origin', 'dest', 'invoice', 'exporter']" :key="k" class="ef"><Icon name="check" :size="11" />{{ t('customsInfo.etgb.fields.' + k) }}</span>
        </div>
      </div>

      <p class="disclaimer muted small"><Icon name="info" :size="12" />{{ t('customsInfo.disclaimer') }}</p>
    </div>
  </section>
</template>

<style scoped>
.cip { border: 1px solid var(--line-2); border-radius: var(--r-md); background: var(--surface); overflow: hidden; }
.cip-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: var(--bg-2); border-bottom: 1px solid var(--line-1); flex-wrap: wrap; }
.cip-toggle { display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; font: inherit; color: var(--ink-1); cursor: pointer; }
.cip-toggle.static { cursor: default; }
.cip-title { font-weight: 600; font-size: 14px; }
.cip-sum { display: inline-flex; align-items: baseline; gap: 6px; font-size: 13px; }
.cip-body { padding: 14px; display: flex; flex-direction: column; gap: 14px; }
.cip-route { display: flex; flex-wrap: wrap; gap: 6px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line-1); font-size: 12px; color: var(--ink-2); }
.blk { display: flex; flex-direction: column; gap: 8px; }
.blk-t { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-3); font-weight: 600; }
.r { text-align: right; }
.small { font-size: 12px; }
.strong { font-weight: 600; }
.sm { font-size: 10.5px; padding: 1px 6px; margin-left: 6px; }
.plain { margin: 4px 0 0; padding-left: 16px; }
.callout.success-soft { background: oklch(0.97 0.03 155); color: oklch(0.4 0.1 155); border: 1px solid oklch(0.9 0.05 155); }
.dm { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; padding: 8px 10px; border-radius: var(--r-md); background: var(--bg-2); }
.dm.suspended { background: oklch(0.97 0.05 80); color: oklch(0.42 0.1 70); }
.dm.applies { background: oklch(0.97 0.03 155); color: oklch(0.4 0.1 155); }
.lc .tot td { font-weight: 700; border-top: 1px solid var(--line-2); }
.lc .muted-row td { color: var(--ink-3); }
.note { display: flex; gap: 6px; align-items: flex-start; margin: 0; }
.inco { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ic { text-align: left; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line-2); border-radius: var(--r-md); padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
.ic:hover { border-color: var(--line-strong); }
.ic.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.ic-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ic-cost { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
.pc { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.pc li { display: flex; gap: 6px; align-items: flex-start; }
.pro { color: oklch(0.42 0.1 155); }
.con { color: var(--ink-2); }
.con :deep(svg) { color: var(--danger); flex: none; margin-top: 2px; }
.pro :deep(svg) { flex: none; margin-top: 2px; }
.docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.docs li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.dn { display: flex; flex-direction: column; min-width: 0; }
.etgb-fields { display: flex; flex-wrap: wrap; gap: 6px; }
.ef { display: inline-flex; gap: 5px; align-items: center; font-size: 12px; padding: 3px 8px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line-1); }
.disclaimer { display: flex; gap: 6px; align-items: center; margin: 0; }
@media (max-width: 760px) { .inco { grid-template-columns: 1fr; } }
</style>
