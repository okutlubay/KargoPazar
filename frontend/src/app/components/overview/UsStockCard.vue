<script setup>
// Overview: US stock status per hub (NJ01, LA01): units on hand, low-stock SKUs,
// first-mile shipments on the way (count, units, earliest ETA) and the demand
// forecast stock-out insight with a "plan first-mile shipment" action.
import { ref, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Skeleton from '../Skeleton.vue'
import StockoutInsight from '../ai/StockoutInsight.vue'
import { useI18n } from '../../i18n/index.js'
import { stockoutInsight } from '../../api/forecast.js'

const LOW_STOCK = 5
const HUBS = ['NJ01', 'LA01']
const { t, tx, fmt } = useI18n()

const loading = ref(true)
const plans = ref([])
onMounted(async () => {
  try { plans.value = await Promise.all(HUBS.map(h => stockoutInsight(h))) } catch { plans.value = [] } finally { loading.value = false }
})

const hubs = computed(() => plans.value.map(p => {
  const low = p.items.filter(i => i.onHand <= LOW_STOCK).sort((a, b) => a.onHand - b.onHand || b.weekly - a.weekly)
  return { plan: p, hub: p.hub, onHand: p.onHand, skus: p.items.filter(i => i.onHand > 0).length, low, inbound: p.inbound, inboundShipments: p.inboundShipments, nextEta: p.nextEta }
}))
// the stock-out insight is shown for the hub that runs out first
const urgent = computed(() => [...plans.value].filter(p => p.weeks != null).sort((a, b) => a.weeks - b.weeks)[0] || null)
</script>

<template>
  <Card :title="t('stock.card.title')" :subtitle="t('stock.card.subtitle')" icon="warehouse" class="us-stock" data-testid="overview-us-stock-card">
    <template #actions><RouterLink class="link small" :to="{ name: 'intl' }" data-testid="overview-us-stock-intl-link">{{ t('stock.card.viewIntl') }}</RouterLink></template>
    <div v-if="loading" class="hubs"><Skeleton v-for="h in HUBS" :key="h" variant="rect" :height="150" /></div>
    <template v-else>
      <div class="hubs">
        <div v-for="h in hubs" :key="h.hub" class="hub" :data-testid="'overview-us-stock-' + h.hub">
          <div class="hub-head">
            <span class="hub-code mono">{{ h.hub }}</span>
            <span v-if="h.plan.weeks != null" class="tag" :class="h.plan.severity === 'danger' ? 'tag-danger' : h.plan.severity === 'warning' ? 'tag-warning' : ''">{{ t('stock.card.cover', { n: fmt.number(Math.max(1, Math.round(h.plan.weeks))) }) }}</span>
          </div>
          <template v-if="h.plan.items.length">
            <div class="row">
              <span class="lbl">{{ t('stock.card.onHand') }}</span>
              <span class="val num">{{ t('stock.card.unitsValue', { n: fmt.number(h.onHand) }) }} <small class="muted">{{ t('stock.card.skus', { n: h.skus }) }}</small></span>
            </div>
            <div class="row">
              <span class="lbl">{{ t('stock.card.low') }} <small class="muted">{{ t('stock.card.lowHint', { n: LOW_STOCK }) }}</small></span>
              <span class="val num" :class="{ warn: h.low.length }">{{ h.low.length }}</span>
            </div>
            <div v-if="h.low.length" class="chips">
              <span v-for="i in h.low.slice(0, 4)" :key="i.sku" class="chip" :title="tx(i.title)"><span class="mono">{{ i.sku }}</span> <b class="num">{{ i.onHand }}</b></span>
              <span v-if="h.low.length > 4" class="chip more">{{ t('stock.card.more', { n: h.low.length - 4 }) }}</span>
            </div>
            <div v-else class="muted xs">{{ t('stock.card.lowNone') }}</div>
            <div class="row inbound">
              <span class="lbl"><Icon name="plane" :size="12" /> {{ t('stock.card.inbound') }}</span>
              <span v-if="h.inboundShipments" class="val num">{{ t('stock.card.inboundValue', { n: h.inboundShipments, units: fmt.number(h.inbound) }) }}</span>
              <span v-else class="val muted">{{ t('stock.card.noInbound') }}</span>
            </div>
            <div v-if="h.nextEta" class="muted xs eta">{{ t('stock.card.eta', { d: fmt.date(h.nextEta) }) }}</div>
          </template>
          <div v-else class="muted small">{{ t('stock.card.empty') }}</div>
        </div>
      </div>
      <StockoutInsight v-if="urgent" :plan="urgent" compact class="stock-insight" testid="overview-stockout-plan" />
    </template>
  </Card>
</template>

<style scoped>
.us-stock { margin-bottom: 22px; }
.hubs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 760px) { .hubs { grid-template-columns: 1fr; } }
.hub { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--surface); min-width: 0; }
.hub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hub-code { font-weight: 700; font-size: 14px; color: var(--ink-1); }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 13px; }
.lbl { color: var(--ink-2); display: inline-flex; align-items: center; gap: 5px; }
.val { font-weight: 600; color: var(--ink-1); text-align: right; }
.val.warn { color: oklch(0.5 0.12 70); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line-1); font-size: 11.5px; color: var(--ink-2); }
.chip b { color: var(--danger); }
.chip.more { color: var(--ink-3); }
.inbound { padding-top: 6px; border-top: 1px dashed var(--line-1); }
.eta { margin-top: -4px; text-align: right; }
.xs { font-size: 11.5px; }
.small { font-size: 12.5px; }
.stock-insight { margin-top: 12px; }
</style>
