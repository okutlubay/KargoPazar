<script setup>
// Compact "Alternatives (N)" expander for batch rows: the same badges and pros/cons as the compare page.
//   <AlternativesList :alternatives="[{ quote, score, components }]" :selected-key :recommended-key @select="key => ..." />
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Money from '../Money.vue'
import CarrierLogo from '../CarrierLogo.vue'
import { t } from '../../i18n/index.js'
import { annotateOffers, sortOffers } from '../../api/quotePros.js'
import { offersFromQuotes } from '../../api/compare.js'
import { offerTitle, offerSub, itemText, daysText } from './labels.js'

const props = defineProps({
  alternatives: { type: Array, default: () => [] },
  selectedKey: { type: String, default: null },
  recommendedKey: { type: String, default: null },
  declaredValue: { type: Number, default: 0 },
})
const emit = defineEmits(['select'])
const open = ref(false)

const offers = computed(() => {
  if (!open.value) return []
  const quotes = props.alternatives.map(a => ({ ...a.quote, etaDays: a.quote.effectiveEtaDays ?? a.quote.etaDays, aiScore: a.score != null ? { score: a.score, components: a.components } : a.quote.aiScore }))
  const ann = annotateOffers(offersFromQuotes(quotes, { declaredValue: props.declaredValue }), { recommendedKey: props.recommendedKey })
  return sortOffers(ann.offers, 'recommended', ann.recommendedKey)
})
const others = computed(() => Math.max(0, props.alternatives.length - 1))
</script>

<template>
  <div class="alts">
    <button type="button" class="btn-link alts-toggle" :aria-expanded="open" data-testid="batch-alternatives-toggle" @click="open = !open">
      <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="11" />{{ open ? t('compare.alternatives.hide') : t('compare.alternatives.toggle', { n: others }) }}
    </button>
    <ul v-if="open" class="alts-list" data-testid="batch-alternatives">
      <li v-for="o in offers" :key="o.key" class="alt" :class="{ on: o.key === selectedKey }">
        <div class="alt-top">
          <CarrierLogo :code="o.carrierCode" :size="18" />
          <span class="alt-name">{{ offerTitle(o) }}<span v-if="o.source === 'own'" class="muted"> · {{ offerSub(o) }}</span></span>
          <span class="alt-badges"><span v-for="b in o.badges" :key="b" class="qbdg" :class="'b-' + b">{{ t('compare.badges.' + b) }}</span></span>
          <span class="grow" />
          <span class="muted">{{ daysText(o) }}</span>
          <Money :value="o.total" />
          <span v-if="o.key === selectedKey" class="tag tag-accent">{{ t('compare.alternatives.current') }}</span>
          <button v-else type="button" class="btn btn-ghost btn-xs" @click="emit('select', o.key)">{{ t('compare.alternatives.use') }}</button>
        </div>
        <div class="alt-pc">
          <span v-for="p in o.pros" :key="'p' + p.code" class="pro">+ {{ itemText(p) }}</span>
          <span v-for="c in o.cons" :key="'c' + c.code" class="con">- {{ itemText(c) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.alts { margin-top: 4px; }
.alts-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
.alts-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-width: 420px; max-width: 640px; }
.alt { padding: 7px 9px; border: 1px solid var(--line-1); border-radius: 8px; background: var(--surface); font-size: 12px; }
.alt.on { border-color: var(--accent); background: color-mix(in oklch, var(--accent-soft) 40%, var(--surface)); }
.alt-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.alt-name { font-weight: 600; }
.alt-badges { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.alt-pc { display: flex; flex-wrap: wrap; gap: 3px 12px; margin-top: 4px; line-height: 1.4; }
.pro { color: oklch(0.4 0.1 155); }
.con { color: oklch(0.48 0.15 25); }
.muted { color: var(--ink-3); font-weight: 400; }
.grow { flex: 1; }
.qbdg { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px; font-size: 10px; font-weight: 600; background: var(--bg-3); color: var(--ink-2); }
.b-ai { background: var(--accent); color: white; }
.b-cheapest { background: oklch(0.94 0.06 155); color: oklch(0.38 0.1 155); }
.b-fastest { background: oklch(0.95 0.06 80); color: oklch(0.42 0.1 70); }
.b-reliable { background: oklch(0.94 0.04 220); color: oklch(0.4 0.1 230); }
.b-own { background: var(--ink-1); color: white; }
.b-dynamic { background: oklch(0.94 0.05 300); color: oklch(0.4 0.14 300); }
@media (max-width: 640px) { .alts-list { min-width: 0; } }
</style>
