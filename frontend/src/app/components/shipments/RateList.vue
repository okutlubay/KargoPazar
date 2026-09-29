<script setup>
// Rate shopping list (spec 5.5 step 4): badges, own account double rows, connect hints, AI "Neden?".
//   <RateList :result="rateResult" v-model="quoteKey" :sort="'ai'|'cheapest'|'fastest'" :loading />
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import CarrierLogo from '../CarrierLogo.vue'
import Money from '../Money.vue'
import Popover from '../Popover.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { hasKey } from './helpers.js'

const props = defineProps({
  result: { type: Object, default: null },
  modelValue: { type: String, default: null },
  sort: { type: String, default: 'ai' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const byKey = computed(() => new Map((props.result?.quotes ?? []).map(q => [q.key, q])))
const rows = computed(() => {
  const qs = props.result?.quotes ?? []
  const primary = qs.filter(q => !(q.source === 'own' && q.platformKey && byKey.value.has(q.platformKey)))
  const cmp = {
    cheapest: (a, b) => a.total - b.total || (a.etaDays ?? 99) - (b.etaDays ?? 99),
    fastest: (a, b) => (a.etaDays ?? 99) - (b.etaDays ?? 99) || a.total - b.total,
    ai: (a, b) => (b.aiScore?.score ?? -1) - (a.aiScore?.score ?? -1) || a.total - b.total,
  }[props.sort] ?? (() => 0)
  const sorted = [...primary].sort((a, b) => {
    // AI pick always first in AI sort
    if (props.sort === 'ai') {
      const ka = groupHasAi(a), kb = groupHasAi(b)
      if (ka !== kb) return ka ? -1 : 1
    }
    return cmp(bestOf(a), bestOf(b))
  })
  const out = []
  for (const q of sorted) {
    out.push({ q, own: false })
    if (q.ownKey && byKey.value.has(q.ownKey)) out.push({ q: byKey.value.get(q.ownKey), own: true, platform: q })
  }
  return out
})
function groupHasAi(q) { return q.key === props.result?.aiPickKey || (q.ownKey && q.ownKey === props.result?.aiPickKey) }
function bestOf(q) {
  const own = q.ownKey ? byKey.value.get(q.ownKey) : null
  if (!own) return q
  if (props.sort === 'ai') return (own.aiScore?.score ?? -1) > (q.aiScore?.score ?? -1) ? own : q
  return own.total < q.total ? own : q
}

const aiQuote = computed(() => byKey.value.get(props.result?.aiPickKey) ?? null)
const reasonText = computed(() => {
  const r = props.result?.ai
  if (!r) return ''
  if (r.reason) return tx(r.reason)
  const k = 'core.aiReasons.' + r.reasonCode
  return hasKey(k) ? t(k) : ''
})
const components = computed(() => {
  const c = aiQuote.value?.aiScore?.components
  if (!c) return []
  const raw = c.weights ?? {}
  const sum = (raw.cost ?? 0) + (raw.speed ?? 0) + (raw.reliability ?? 0) || 1
  // show the relative share of each weight so the three add up to 100%
  const w = { cost: (raw.cost ?? 0) / sum, speed: (raw.speed ?? 0) / sum, reliability: (raw.reliability ?? 0) / sum }
  return [
    { label: t('shipments.rates.why.cost'), value: `${Math.round(c.cost * 100)} · ${t('shipments.rates.why.weight', { n: Math.round((w.cost ?? 0) * 100) })}`, weight: c.cost },
    { label: t('shipments.rates.why.speed'), value: `${Math.round(c.speed * 100)} · ${t('shipments.rates.why.weight', { n: Math.round((w.speed ?? 0) * 100) })}`, weight: c.speed },
    { label: t('shipments.rates.why.reliability'), value: `${Math.round(c.reliability * 100)} · ${t('shipments.rates.why.weight', { n: Math.round((w.reliability ?? 0) * 100) })}`, weight: c.reliability },
    ...(c.risk ? [{ label: t('shipments.rates.why.risk'), value: '-' + Math.round(c.risk * 100) }] : []),
  ]
})
const badgeLabel = (b, q) => {
  if (b === 'own') return t('core.badges.own')
  return t('core.badges.' + b)
}
const visibleBadges = q => (q.badges ?? []).filter(b => b !== 'own' || !q.platformKey)
function etaText(q) {
  if (!q.etaDays) return '-'
  return t('shipments.rates.eta', { n: q.etaDays })
}
function ownLabel(q) {
  return t('core.badges.ownAccountLabel', { carrier: q.carrierName, masked: q.accountLabel ?? '' })
}
</script>

<template>
  <div class="rl" :class="{ busy: loading }">
    <div class="rl-head" aria-hidden="true">
      <span>{{ t('shipments.rates.cols.service') }}</span>
      <span class="hide-md">{{ t('shipments.rates.cols.eta') }}</span>
      <span class="hide-md">{{ t('shipments.rates.cols.onTime') }}</span>
      <span class="r">{{ t('shipments.rates.cols.price') }}</span>
    </div>
    <div role="radiogroup" :aria-label="t('shipments.steps.rates')" class="rl-list">
      <template v-for="row in rows" :key="row.q.key">
        <label class="rate" :class="{ on: modelValue === row.q.key, ai: row.q.key === result?.aiPickKey, own: row.own, sub: row.own }">
          <input type="radio" name="quote" :value="row.q.key" :checked="modelValue === row.q.key" @change="emit('update:modelValue', row.q.key)" />
          <span class="svc">
            <CarrierLogo v-if="!row.own" :code="row.q.carrierCode" :size="30" />
            <span v-else class="own-ic"><Icon name="key" :size="13" /></span>
            <span class="svc-text">
              <span class="svc-name">{{ row.own ? ownLabel(row.q) : row.q.serviceName }}</span>
              <span class="svc-sub">
                <template v-if="!row.own">{{ row.q.carrierName }}<template v-if="row.q.ownKey"> · {{ t('core.badges.platformRate') }}</template></template>
                <template v-else>{{ row.q.serviceName }}</template>
              </span>
              <span class="badges">
                <span v-for="b in visibleBadges(row.q)" :key="b" class="bdg" :class="'b-' + b"><Icon v-if="b === 'ai'" name="spark" :size="9" />{{ badgeLabel(b, row.q) }}</span>
                <span v-if="row.own && row.q.savingsVsPlatform > 0" class="bdg b-save">{{ t('core.badges.cheaperBy', { amount: fmt.money(row.q.savingsVsPlatform) }) }}</span>
                <span v-else-if="row.own && row.q.savingsVsPlatform < 0" class="bdg b-neutral">{{ t('core.badges.pricierBy', { amount: fmt.money(-row.q.savingsVsPlatform) }) }}</span>
              </span>
            </span>
          </span>
          <span class="eta hide-md">
            <span class="mono">{{ etaText(row.q) }}</span>
            <span v-if="row.q.etaDate" class="muted xs">{{ fmt.date(row.q.etaDate) }}</span>
          </span>
          <span class="ontime hide-md mono">{{ row.q.onTimePct != null ? fmt.percent(row.q.onTimePct, 0) : '-' }}</span>
          <span class="price">
            <Money :value="row.q.total" />
            <span class="show-md muted xs">{{ etaText(row.q) }}</span>
            <Popover v-if="row.q.key === result?.aiPickKey" :width="330" placement="bottom-end" :aria-label="t('shipments.rates.why.title')">
              <template #trigger="{ toggle, open, id }">
                <button type="button" class="why" :aria-expanded="open" :aria-controls="id" @click.prevent.stop="toggle"><Icon name="spark" :size="10" />{{ t('common.why') }}</button>
              </template>
              <div class="why-body">
                <div class="why-head"><span class="badge-ai"><Icon name="spark" :size="10" />AI</span>{{ t('shipments.rates.why.title') }}</div>
                <p class="why-reason">{{ reasonText }}</p>
                <ul class="why-list">
                  <li v-for="c in components" :key="c.label">
                    <div class="why-row"><span>{{ c.label }}</span><span class="mono">{{ c.value }}</span></div>
                    <div v-if="c.weight != null" class="why-bar"><span :style="{ width: Math.max(3, c.weight * 100) + '%' }" /></div>
                  </li>
                </ul>
                <div v-if="aiQuote?.aiScore" class="why-row total"><span>{{ t('shipments.rates.why.score') }}</span><span class="mono">{{ fmt.number(aiQuote.aiScore.score * 100, 0) }}</span></div>
                <div v-if="result?.defaultQuote" class="why-save">
                  {{ result.aiSavingsVsDefault > 0 ? t('shipments.rates.why.savings', { amount: fmt.money(result.aiSavingsVsDefault), total: fmt.money(result.defaultQuote.total) }) : t('shipments.rates.why.noSavings') }}
                </div>
                <div class="muted xs">{{ t('shipments.rates.why.source.' + (result?.ai?.source ?? 'fallback')) }}</div>
              </div>
            </Popover>
          </span>
        </label>
        <div v-if="!row.own && row.q.connectHint" class="hint">
          <RouterLink :to="{ name: 'carrier-accounts', query: { connect: row.q.connectHint.carrier } }" class="hint-link"><Icon name="link" :size="11" />{{ t('core.badges.connectHint', { carrier: row.q.connectHint.carrierName }) }}</RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rl.busy { opacity: .6; pointer-events: none; transition: opacity .15s; }
.rl-head { display: grid; grid-template-columns: minmax(0, 1fr) 120px 90px 120px; gap: 12px; padding: 0 14px 6px 44px; font-size: 11.5px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; }
.r { text-align: right; }
.rl-list { display: flex; flex-direction: column; gap: 6px; }
.rate { position: relative; display: grid; grid-template-columns: 20px minmax(0, 1fr) 120px 90px 120px; gap: 12px; align-items: center; padding: 11px 14px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--surface); cursor: pointer; transition: border-color .15s, box-shadow .15s, background .15s; }
.rate:hover { border-color: var(--line-strong); }
.rate input { accent-color: var(--accent); width: 16px; height: 16px; margin: 0; }
.rate.ai { background: color-mix(in oklch, var(--accent-soft) 55%, var(--surface)); border-color: oklch(0.85 0.06 268); }
.rate.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.rate.sub { margin-left: 28px; margin-top: -4px; border-top-left-radius: 4px; border-top-right-radius: 4px; background: var(--bg); }
.rate.sub::before { content: ''; position: absolute; left: -16px; top: -8px; width: 12px; height: 26px; border-left: 1px solid var(--line-2); border-bottom: 1px solid var(--line-2); border-bottom-left-radius: 6px; }
.svc { display: flex; align-items: center; gap: 10px; min-width: 0; }
.own-ic { width: 30px; height: 30px; border-radius: 8px; background: var(--ink-1); color: white; display: grid; place-items: center; flex: none; }
.svc-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.svc-name { font-weight: 600; font-size: 13.5px; }
.svc-sub { font-size: 12px; color: var(--ink-3); }
.badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.bdg { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: .02em; background: var(--bg-3); color: var(--ink-2); font-family: var(--font-mono); }
.b-ai { background: var(--accent); color: white; }
.b-cheapest { background: oklch(0.94 0.06 155); color: oklch(0.38 0.1 155); }
.b-fastest { background: oklch(0.95 0.06 80); color: oklch(0.42 0.1 70); }
.b-dynamic { background: oklch(0.94 0.05 300); color: oklch(0.4 0.14 300); }
.b-own, .b-save { background: var(--ink-1); color: white; }
.b-custom { background: oklch(0.94 0.04 220); color: oklch(0.4 0.1 230); }
.b-rule { background: oklch(0.95 0.04 25); color: oklch(0.45 0.16 25); }
.b-neutral { background: var(--bg-3); color: var(--ink-3); }
.eta { display: flex; flex-direction: column; font-size: 13px; }
.ontime { font-size: 13px; color: var(--ink-2); }
.price { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-weight: 600; font-size: 14.5px; }
.xs { font-size: 11.5px; font-weight: 400; }
.why { display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 7px; border-radius: 5px; border: 1px solid oklch(0.85 0.06 268); background: var(--surface); color: var(--accent-ink); font-size: 11px; font-weight: 600; cursor: pointer; }
.why:hover { background: var(--accent-soft); }
.hint { margin: -2px 0 2px 44px; }
.hint-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--accent); }
.hint-link:hover { text-decoration: underline; }
.why-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.why-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.why-reason { margin: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
.why-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; }
.why-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; }
.why-row.total { font-weight: 600; border-top: 1px solid var(--line-1); padding-top: 6px; }
.why-bar { height: 4px; border-radius: 4px; background: var(--bg-3); margin-top: 3px; overflow: hidden; }
.why-bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.why-save { font-size: 12.5px; padding: 8px 10px; border-radius: 8px; background: oklch(0.96 0.04 155); color: oklch(0.38 0.1 155); }
.show-md { display: none; }
@media (max-width: 860px) {
  .rl-head { grid-template-columns: minmax(0, 1fr) 100px; padding-left: 44px; }
  .rate { grid-template-columns: 20px minmax(0, 1fr) 100px; }
  .hide-md { display: none; }
  .show-md { display: block; }
  .rate.sub { margin-left: 14px; }
}
</style>
