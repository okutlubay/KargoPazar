<script setup>
// Demand forecast -> US hub stock-out insight with a "plan first-mile shipment" action
// that opens /intl/new prefilled with the proposed SKUs (api/forecast.js computeStockout).
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AiInsightCard from '../AiInsightCard.vue'
import Icon from '@/components/Icon.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { hasFeature, can } from '../../store/session.js'
import { firstMileQuery } from '../../api/forecast.js'

const props = defineProps({
  plan: { type: Object, required: true }, // computeStockout(hub) result
  compact: { type: Boolean, default: false },
  testid: { type: String, default: '' }, // data-testid of the action button
})
const { t, fmt } = useI18n()
const router = useRouter()

const weeks = computed(() => Math.max(1, Math.round(props.plan.weeks ?? 0)))
const atRisk = computed(() => props.plan.weeks != null && props.plan.weeks < props.plan.targetWeeks && props.plan.recommended.length > 0)
const units = computed(() => props.plan.recommended.reduce((s, i) => s + i.qty, 0))
const reason = computed(() => [
  { label: t('stock.insight.weekly'), value: t('stock.insight.weeklyValue', { n: fmt.number(props.plan.weeklyUnits, 0), s: fmt.number(props.plan.weeklyShipments, 0), u: fmt.number(props.plan.unitsPerShipment, 1) }) },
  { label: t('stock.insight.onHand'), value: fmt.number(props.plan.onHand) },
  { label: t('stock.insight.inbound'), value: fmt.number(props.plan.inbound) },
  { label: t('stock.insight.cover'), value: t('stock.insight.weeksValue', { n: fmt.number(props.plan.weeksTotal ?? 0, 1) }) },
  ...(atRisk.value ? [{ label: t('stock.insight.proposal'), value: t('stock.insight.proposalValue', { skus: props.plan.recommended.length, units: fmt.number(units.value) }) }] : []),
  ...props.plan.recommended.slice(0, 5).map(i => ({ label: i.sku, value: `${fmt.number(i.cover ?? 0, 1)} / +${i.qty}`, weight: Math.min(1, (i.cover ?? 0) / props.plan.targetWeeks) })),
  { label: t('stock.insight.basis') },
])

function plan() {
  if (!hasFeature('intl')) { toast.warning(t('common.upgradeRequired')); router.push({ name: 'plan' }); return }
  router.push({ name: 'intl-new', query: firstMileQuery(props.plan, 'TR') })
}
</script>

<template>
  <AiInsightCard
    :title="t(atRisk ? 'stock.insight.title' : 'stock.insight.titleOk', { hub: plan.hub })"
    :description="t(atRisk ? 'stock.insight.text' : 'stock.insight.textOk', { hub: plan.hub, weeks })"
    :reason="reason" :reason-title="t('stock.insight.reasonTitle')" :meta="plan.version ? `forecast ${plan.version}` : ''"
    :tone="atRisk ? 'accent' : 'plain'" :compact="compact" hide-action
  >
    <template #actions>
      <button v-if="atRisk" type="button" class="btn btn-accent btn-sm" :data-testid="testid || undefined" :disabled="!can('shipments.create')" @click="plan">
        <Icon name="plane" :size="13" />{{ t('stock.insight.action') }}
      </button>
    </template>
  </AiInsightCard>
</template>
