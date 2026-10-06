<script setup>
// Full-screen side by side comparison of 2-4 offers (rows: price breakdown, speed, service, customs).
//   <CompareSheet v-model:open="x" :offers="annotatedSelected" :recommended-key :selectable :model-value @select @remove />
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Drawer from '../Drawer.vue'
import Money from '../Money.vue'
import CarrierLogo from '../CarrierLogo.vue'
import { t, fmt } from '../../i18n/index.js'
import { compareMatrix, aiSummary } from '../../api/quotePros.js'
import { offerTitle, offerSub, summaryText } from './labels.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  offers: { type: Array, default: () => [] },
  recommendedKey: { type: String, default: null },
  modelValue: { type: String, default: null },
  selectable: { type: Boolean, default: true },
})
const emit = defineEmits(['update:open', 'select', 'remove'])

const rows = computed(() => compareMatrix(props.offers).filter(r => r.cells.some(c => c.value != null)))
const groups = computed(() => {
  const out = []
  for (const r of rows.value) {
    let g = out.find(x => x.key === r.group)
    if (!g) { g = { key: r.group, rows: [] }; out.push(g) }
    g.rows.push(r)
  }
  return out
})
const summary = computed(() => aiSummary(props.offers, props.recommendedKey))

function cellText(row, v) {
  if (v == null) return '-'
  switch (row.kind) {
    case 'days': return v[0] === v[1] ? t('compare.sheet.days', { n: v[1] }) : t('compare.card.days', { min: v[0], max: v[1] })
    case 'pct': return fmt.percent(v, 1)
    case 'bool': return v ? t('compare.sheet.yes') : t('compare.sheet.no')
    case 'tracking': return t('compare.sheet.tracking.' + v)
    case 'number': return t('compare.sheet.days', { n: v })
    default: return String(v)
  }
}
</script>

<template>
  <Drawer :open="open" :title="t('compare.sheet.title')" :subtitle="t('compare.sheet.subtitle')" width="min(1240px, 100vw)" @update:open="v => emit('update:open', v)">
    <div class="cs" data-testid="compare-sheet">
      <div class="cs-scroll">
        <table class="cs-table">
          <thead>
            <tr>
              <th class="cs-label">{{ t('compare.sheet.offer') }}</th>
              <th v-for="o in offers" :key="o.key" class="cs-offer" :class="{ ai: o.key === recommendedKey }">
                <div class="cs-head">
                  <CarrierLogo v-if="o.carrierCode" :code="o.carrierCode" :size="26" />
                  <div class="cs-names">
                    <span class="cs-title">{{ offerTitle(o) }}</span>
                    <span class="cs-sub">{{ offerSub(o) }}</span>
                    <span class="cs-badges">
                      <span v-for="b in o.badges" :key="b" class="qbdg" :class="'b-' + b"><Icon v-if="b === 'ai'" name="spark" :size="9" />{{ t('compare.badges.' + b) }}</span>
                    </span>
                  </div>
                </div>
                <div class="cs-actions">
                  <button v-if="selectable && o.selectable !== false" type="button" class="btn btn-sm" :class="modelValue === o.key ? 'btn-primary' : 'btn-ghost'" @click="emit('select', o.key)">
                    <Icon v-if="modelValue === o.key" name="check" :size="12" />{{ modelValue === o.key ? t('compare.results.chosen') : t('compare.sheet.choose') }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" :aria-label="t('compare.sheet.remove')" @click="emit('remove', o.key)"><Icon name="x" :size="12" /></button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody v-for="g in groups" :key="g.key">
            <tr class="cs-group"><td :colspan="offers.length + 1">{{ t('compare.sheet.groups.' + g.key) }}</td></tr>
            <tr v-for="r in g.rows" :key="r.key" :class="{ strong: r.key === 'total' }" :data-testid="'compare-row-' + r.key">
              <th scope="row" class="cs-label">{{ t('compare.sheet.rows.' + r.key) }}</th>
              <td v-for="c in r.cells" :key="c.key" :class="{ best: c.best, worst: c.worst }">
                <template v-if="r.kind === 'money' && c.value != null">
                  <span v-if="r.key === 'insurance' && !c.value">{{ t('compare.sheet.none') }}</span>
                  <Money v-else :value="c.value" />
                </template>
                <span v-else>{{ cellText(r, c.value) }}</span>
                <Icon v-if="c.best" name="check-circle" :size="12" class="cs-ic" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="summary.length" class="cs-ai" data-testid="ai-summary">
        <div class="cs-ai-h"><span class="badge-ai"><Icon name="spark" :size="10" />AI</span>{{ t('compare.sheet.aiTitle') }}</div>
        <ul>
          <li v-for="(s, i) in summary" :key="i">{{ summaryText(s, offers) }}</li>
        </ul>
      </section>
    </div>
  </Drawer>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 16px; }
.cs-scroll { overflow-x: auto; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.cs-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
.cs-table th, .cs-table td { padding: 9px 12px; border-bottom: 1px solid var(--line-1); text-align: left; vertical-align: middle; }
.cs-label { width: 190px; color: var(--ink-3); font-weight: 500; position: sticky; left: 0; background: var(--surface); z-index: 1; }
.cs-offer { vertical-align: top !important; min-width: 200px; background: var(--bg); }
.cs-offer.ai { background: color-mix(in oklch, var(--accent-soft) 60%, var(--surface)); }
.cs-head { display: flex; gap: 8px; align-items: flex-start; }
.cs-names { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cs-title { font-weight: 600; font-size: 13px; }
.cs-sub { font-size: 11.5px; color: var(--ink-3); font-weight: 400; }
.cs-badges { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
.cs-actions { display: flex; gap: 6px; margin-top: 8px; }
.cs-group td { background: var(--bg-2); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); font-weight: 600; padding: 6px 12px; }
tr.strong td { font-weight: 700; font-size: 14px; }
td.best { background: oklch(0.95 0.06 155); color: oklch(0.36 0.1 155); }
td.worst { background: oklch(0.95 0.04 25); color: oklch(0.45 0.15 25); }
.cs-ic { margin-left: 5px; vertical-align: -2px; }
.cs-ai { border: 1px solid oklch(0.85 0.06 268); background: color-mix(in oklch, var(--accent-soft) 50%, var(--surface)); border-radius: var(--r-md); padding: 12px 16px; }
.cs-ai-h { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 6px; }
.cs-ai ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--ink-2); line-height: 1.5; }
.qbdg { display: inline-flex; align-items: center; gap: 3px; height: 17px; padding: 0 6px; border-radius: 5px; font-size: 10px; font-weight: 600; background: var(--bg-3); color: var(--ink-2); }
.b-ai { background: var(--accent); color: white; }
.b-cheapest { background: oklch(0.94 0.06 155); color: oklch(0.38 0.1 155); }
.b-fastest { background: oklch(0.95 0.06 80); color: oklch(0.42 0.1 70); }
.b-reliable { background: oklch(0.94 0.04 220); color: oklch(0.4 0.1 230); }
.b-own { background: var(--ink-1); color: white; }
.b-dynamic { background: oklch(0.94 0.05 300); color: oklch(0.4 0.14 300); }
</style>
