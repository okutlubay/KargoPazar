<script setup>
// Landing calculator: estimated duty row + expandable "See customs detail" box for first mile
// (origin -> US). No db on the landing: the pure landed cost engine runs on the bundled seed JSON.
import { ref, computed, watch } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import { computeLandedCost } from '../shared/landedCost.js'
import { money as fmtMoney } from '../shared/format.js'
import ratesSeed from '../app/data/seed/hs_duty_rates.json'
import countriesSeed from '../app/data/seed/countries.json'
import hsCodesSeed from '../app/data/seed/hs_codes.json'
import fxSeed from '../app/data/seed/fx.json'

const props = defineProps({ origin: { type: String, default: 'TR' } })
const { t, lang, f, money, num, fx } = useI18n()
const open = ref(false)
const hs = ref('6912.00')
const value = ref(100)
const ctx = { rates: ratesSeed, countries: countriesSeed, fx: fxSeed.rates, hsCodes: hsCodesSeed }
const codes = computed(() => hsCodesSeed.map((c) => ({ code: c.code, label: c.desc[lang.value] || c.desc.en })))
const res = computed(() => computeLandedCost({ hsCode: hs.value, origin: props.origin, dest: 'US', valueUsd: Number(value.value) || 0, incoterm: 'DDP' }, ctx))
// Lets the calculator price its end-to-end packages with the same HS code and value.
const emit = defineEmits(['estimate'])
watch(res, (r) => emit('estimate', { hsCode: hs.value, valueUsd: Number(value.value) || 0, totalUsd: r.totalUsd }), { immediate: true })
const usd = (v) => fmtMoney(v, lang.value, 'USD', 2)
const c = computed(() => t.value.customsCalc)
const pct = (v) => (lang.value === 'tr' ? '%' : '') + num((v || 0) * 100, (v || 0) * 100 % 1 ? 1 : 0) + (lang.value === 'tr' ? '' : '%')
const lineLabel = (l) => (l.key === 'fee' && l.label ? l.label[lang.value] || l.label.en : c.value.lines[l.key === 'tax' ? 'taxUs' : l.key])
const dmText = computed(() => {
  const dm = res.value.deMinimis
  if (dm.status === 'suspended') return c.value.dmSuspended
  return f(dm.applies ? c.value.dmApplies : c.value.dmExceeded, { amount: fmtMoney(dm.amount, lang.value, dm.currency, 0) })
})
</script>

<template>
  <div class="ce" data-testid="landing-customs">
    <div class="ce-row">
      <span class="ce-l"><Icon name="shield" :size="14" />{{ c.dutyRow }}</span>
      <span class="ce-v" data-testid="landing-duty">
        <strong>{{ money(res.totalUsd) }}</strong>
        <span v-if="fx.display !== 'USD'" class="muted">({{ usd(res.totalUsd) }})</span>
      </span>
    </div>
    <button type="button" class="ce-toggle" :aria-expanded="open" data-testid="landing-customs-toggle" @click="open = !open">
      {{ c.see }} <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="12" />
    </button>
    <div v-if="open" class="ce-box" data-testid="landing-customs-box">
      <div class="ce-inputs">
        <label>
          <span class="ce-lbl">{{ c.product }}</span>
          <select v-model="hs" class="select">
            <option v-for="o in codes" :key="o.code" :value="o.code">{{ o.code }} · {{ o.label }}</option>
          </select>
        </label>
        <label>
          <span class="ce-lbl">{{ c.value }}</span>
          <input v-model.number="value" type="number" min="1" step="1" class="input" />
        </label>
      </div>
      <table class="ce-t">
        <tbody>
          <tr v-for="l in res.lines" :key="l.key">
            <td>{{ lineLabel(l) }}<span v-if="l.rate != null && l.key !== 'fee'" class="muted"> ({{ pct(l.rate) }})</span></td>
            <td class="r">{{ usd(l.amountUsd) }}</td>
          </tr>
          <tr class="tot"><td>{{ c.total }}</td><td class="r">{{ usd(res.totalUsd) }}</td></tr>
        </tbody>
      </table>
      <p class="ce-note"><Icon name="info" :size="12" />{{ dmText }}</p>
      <p class="ce-note"><Icon name="clock" :size="12" />{{ f(c.clearance, { min: res.clearanceDays.min, max: res.clearanceDays.max }) }}</p>
      <p v-if="origin === 'TR'" class="ce-note"><Icon name="file" :size="12" />{{ c.etgb }}</p>
      <p class="ce-note">{{ c.ddp }}</p>
      <p class="ce-disc">{{ c.disclaimer }}</p>
    </div>
  </div>
</template>

<style scoped>
.ce { margin-top: 10px; border: 1px solid var(--line-1); border-radius: 12px; padding: 10px 12px; background: var(--bg-2); display: flex; flex-direction: column; gap: 6px; }
.ce-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ce-l { display: inline-flex; gap: 6px; align-items: center; font-size: 13.5px; font-weight: 600; color: var(--ink-1); }
.ce-v { display: inline-flex; gap: 6px; align-items: baseline; font-size: 14px; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.ce-toggle { align-self: flex-start; display: inline-flex; gap: 4px; align-items: center; background: none; border: 0; padding: 0; font: inherit; font-size: 12.5px; color: var(--accent); cursor: pointer; }
.ce-box { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px dashed var(--line-2); }
.ce-inputs { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }
.ce-inputs label { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ce-lbl { font-size: 12px; color: var(--ink-3); }
.ce-t { width: 100%; border-collapse: collapse; font-size: 13px; }
.ce-t td { padding: 4px 0; border-bottom: 1px solid var(--line-1); }
.ce-t .r { text-align: right; font-variant-numeric: tabular-nums; }
.ce-t .tot td { font-weight: 700; border-bottom: 0; }
.ce-note { display: flex; gap: 6px; align-items: flex-start; margin: 0; font-size: 12.5px; color: var(--ink-2); }
.ce-disc { margin: 0; font-size: 11.5px; color: var(--ink-3); }
@media (max-width: 560px) { .ce-inputs { grid-template-columns: 1fr; } }
</style>
