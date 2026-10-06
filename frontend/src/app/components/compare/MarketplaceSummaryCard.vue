<script setup>
// Overview "Marketplace summary": quote sets compared in the last 30 days, average alternatives, which
// kind of offer was chosen and the average saving vs the alternatives. New shipments carry
// `quoteChoice` (api/shipments.js); seed shipments get a deterministic one from their id.
//   <MarketplaceSummaryCard :shipments="shipments" :loading="loading" />
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Money from '../Money.vue'
import Skeleton from '../Skeleton.vue'
import { t, fmt } from '../../i18n/index.js'
import { seedQuoteChoice } from '../../api/quotePros.js'

const props = defineProps({
  shipments: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  days: { type: Number, default: 30 },
})

const KINDS = ['recommended', 'cheapest', 'fastest', 'other']
const COLORS = { recommended: 'var(--accent)', cheapest: 'oklch(0.62 0.13 155)', fastest: 'oklch(0.75 0.13 75)', other: 'var(--ink-4, #9aa0ae)' }

const stats = computed(() => {
  const since = Date.now() - props.days * 864e5
  const list = props.shipments.filter(s => !s.test && s.status !== 'voided' && new Date(s.createdAt).getTime() >= since)
  const choices = list.map(s => s.quoteChoice ?? seedQuoteChoice(s.id, s.total ?? s.walletCharge ?? 10))
  const n = choices.length
  const dist = Object.fromEntries(KINDS.map(k => [k, 0]))
  let alts = 0, saving = 0
  for (const c of choices) { dist[c.kind in dist ? c.kind : 'other']++; alts += c.alternatives || 0; saving += c.savingUsd || 0 }
  return {
    n,
    avgAlt: n ? alts / n : 0,
    avgSaving: n ? Math.round((saving / n) * 100) / 100 : 0,
    dist: KINDS.map(k => ({ key: k, count: dist[k], share: n ? dist[k] / n : 0 })),
  }
})
</script>

<template>
  <Card :title="t('compare.market.title')" :subtitle="t('compare.market.subtitle')" icon="sort" data-testid="marketplace-summary">
    <template #actions><RouterLink class="link small" :to="{ name: 'compare' }">{{ t('compare.market.open') }}</RouterLink></template>
    <div v-if="loading" class="ms-sk"><Skeleton variant="rect" :height="120" /></div>
    <div v-else-if="!stats.n" class="muted small">{{ t('compare.market.empty') }}</div>
    <div v-else class="ms">
      <div class="ms-kpis">
        <div class="ms-k"><span class="ms-l">{{ t('compare.market.compared') }}</span><span class="ms-v">{{ fmt.number(stats.n) }}</span></div>
        <div class="ms-k"><span class="ms-l">{{ t('compare.market.avgAlt') }}</span><span class="ms-v">{{ fmt.number(stats.avgAlt, 1) }}</span></div>
        <div class="ms-k"><span class="ms-l">{{ t('compare.market.saving') }}</span><span class="ms-v"><Money :value="stats.avgSaving" :mono="false" /></span></div>
      </div>
      <div class="ms-l">{{ t('compare.market.dist') }}</div>
      <div class="ms-bar" role="img" :aria-label="stats.dist.map(d => t('compare.market.kinds.' + d.key) + ' ' + fmt.percent(d.share, 0)).join(', ')">
        <span v-for="d in stats.dist" :key="d.key" :style="{ width: d.share * 100 + '%', background: COLORS[d.key] }" />
      </div>
      <ul class="ms-legend">
        <li v-for="d in stats.dist" :key="d.key"><i :style="{ background: COLORS[d.key] }" /><span>{{ t('compare.market.kinds.' + d.key) }}</span><span class="num">{{ fmt.percent(d.share, 0) }}</span></li>
      </ul>
      <div class="ms-note muted"><Icon name="info" :size="12" /> {{ t('compare.subtitle') }}</div>
    </div>
  </Card>
</template>

<style scoped>
.ms { display: flex; flex-direction: column; gap: 10px; }
.ms-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ms-k { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ms-l { font-size: 11.5px; color: var(--ink-3); }
.ms-v { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.ms-bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: var(--bg-3); }
.ms-bar span { display: block; height: 100%; }
.ms-legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; font-size: 12.5px; }
.ms-legend li { display: flex; align-items: center; gap: 6px; }
.ms-legend i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.ms-legend .num { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--ink-2); }
.ms-note { font-size: 11.5px; display: flex; gap: 5px; align-items: flex-start; line-height: 1.4; }
.muted { color: var(--ink-3); }
.small { font-size: 12.5px; }
</style>
