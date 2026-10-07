<script setup>
// Marketplace offer list: every quote side by side with badges, deltas, rule based pros/cons,
// card / table / chart views, filters, sorting and a 2-4 offer side by side sheet.
//
//   <QuoteComparison v-model="selectedKey" :offers="offers" :recommended-key="key" />
//
// Props
//   offers          Offer[] (see api/quotePros.js; build them with api/compare.js)
//   modelValue      selected offer key (v-model), same contract as the old RateList
//   recommendedKey  AI pick (shown as a badge only)
//   loading         dims the list while new quotes load
//   selectable      show choose buttons (false = read only marketplace view)
//   sort            optional controlled sort ('recommended'|'ai'|'cheapest'|'fastest'|'reliable', v-model:sort)
//   hideSort        hide the built-in sort control (the parent renders one)
//   showFilters     filter bar (default true)
//   views           available views (default ['card', 'table', 'chart'])
//   aiReason        text for the AI "Why?" popover on the recommended offer
// Events
//   update:modelValue(key), select(offer), choice({ kind, alternatives, savingUsd }), update:sort(mode)
import { ref, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Money from '../Money.vue'
import CarrierLogo from '../CarrierLogo.vue'
import SegmentedControl from '../SegmentedControl.vue'
import WhyPopover from '../shipments/WhyPopover.vue'
import ScatterChart from '../charts/ScatterChart.vue'
import CompareSheet from './CompareSheet.vue'
import { t, fmt } from '../../i18n/index.js'
import { fromDisplay } from '@/shared/currency.js'
import { annotateOffers, sortOffers, filterOffers, deliveryWindow, quoteChoiceFor } from '../../api/quotePros.js'
import { offerTitle, offerSub, itemText, daysText } from './labels.js'

const props = defineProps({
  offers: { type: Array, default: () => [] },
  modelValue: { type: String, default: null },
  recommendedKey: { type: String, default: null },
  loading: { type: Boolean, default: false },
  selectable: { type: Boolean, default: true },
  sort: { type: String, default: null },
  hideSort: { type: Boolean, default: false },
  showFilters: { type: Boolean, default: true },
  views: { type: Array, default: () => ['card', 'table', 'chart'] },
  aiReason: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'select', 'choice', 'update:sort'])

const view = ref(props.views[0] || 'card')
const localSort = ref('recommended')
const sortMode = computed({
  get: () => (props.sort === 'ai' ? 'recommended' : props.sort) || localSort.value,
  set: v => { localSort.value = v; emit('update:sort', v) },
})
const blankFilters = () => ({ maxPrice: '', maxDays: '', carrier: '', ownOnly: false, signatureOnly: false, ddpOnly: false })
const filters = ref(blankFilters())
const filtersActive = computed(() => Object.entries(filters.value).some(([, v]) => v !== '' && v !== false))
function clearFilters() { filters.value = blankFilters() }

const ann = computed(() => annotateOffers(props.offers, { recommendedKey: props.recommendedKey }))
const all = computed(() => ann.value.offers)
const recKey = computed(() => ann.value.recommendedKey)
const visible = computed(() => {
  const f = filters.value
  // max price is typed in the display currency; offers are USD
  const maxPrice = f.maxPrice === '' || f.maxPrice == null ? '' : fromDisplay(Number(f.maxPrice))
  const list = filterOffers(all.value, { ...f, maxPrice, carriers: f.carrier ? [f.carrier] : [] })
  return sortOffers(list, sortMode.value, recKey.value)
})
const carrierOptions = computed(() => {
  const m = new Map()
  for (const o of all.value) if (o.carrierCode && !m.has(o.carrierCode)) m.set(o.carrierCode, o.carrierName)
  return [...m.entries()].map(([value, label]) => ({ value, label }))
})
const hasOwn = computed(() => all.value.some(o => o.source === 'own'))
const hasCross = computed(() => all.value.some(o => o.crossBorder))

// selection
function choose(o) {
  if (!props.selectable || o.selectable === false) return
  emit('update:modelValue', o.key)
  emit('select', o)
  const c = quoteChoiceFor(all.value, o.key, { recommendedKey: recKey.value })
  if (c) emit('choice', c)
}

// compare (2-4)
const compareKeys = ref([])
const sheetOpen = ref(false)
watch(() => props.offers, () => {
  const keys = new Set(props.offers.map(o => o.key))
  compareKeys.value = compareKeys.value.filter(k => keys.has(k))
})
function toggleCompare(key) {
  const i = compareKeys.value.indexOf(key)
  if (i >= 0) compareKeys.value.splice(i, 1)
  else if (compareKeys.value.length < 4) compareKeys.value.push(key)
}
const compared = computed(() => compareKeys.value.map(k => all.value.find(o => o.key === k)).filter(Boolean))
function removeCompared(key) {
  toggleCompare(key)
  if (compareKeys.value.length < 2) sheetOpen.value = false
}
function chooseFromSheet(key) {
  const o = all.value.find(x => x.key === key)
  if (o) choose(o)
}

// details
const openBreakdown = ref(new Set())
function toggleBreakdown(key) {
  const s = new Set(openBreakdown.value)
  s.has(key) ? s.delete(key) : s.add(key)
  openBreakdown.value = s
}
function windowText(o) {
  const w = deliveryWindow(o)
  if (!w) return '-'
  return w.from.slice(0, 10) === w.to.slice(0, 10) ? fmt.shortDate(w.from) : `${fmt.shortDate(w.from)} - ${fmt.shortDate(w.to)}`
}
function whyItems(o) {
  const c = o.aiScore?.components
  const items = []
  if (props.aiReason && o.key === recKey.value) items.push(props.aiReason)
  if (c) {
    for (const k of ['cost', 'speed', 'reliability']) if (c[k] != null) items.push({ label: t('shipments.rates.why.' + k), value: Math.round(c[k] * 100), weight: c[k] })
  }
  for (const p of o.pros) items.push('+ ' + itemText(p))
  return items
}

// chart
const chartPoints = computed(() => visible.value.map(o => ({
  key: o.key,
  x: o.total,
  y: o.etaMaxDays,
  r: o.onTimePct != null ? Math.round(o.onTimePct * 1000) / 10 : 90,
  label: offerTitle(o),
  sublabel: `${daysText(o)} · ${o.onTimePct != null ? fmt.percent(o.onTimePct, 1) : '-'}`,
  highlighted: o.key === props.modelValue || o.key === recKey.value,
  color: o.key === recKey.value ? 'var(--accent)' : o.badges.includes('cheapest') ? 'oklch(0.6 0.13 155)' : undefined,
})))
function onPoint(p) {
  const o = all.value.find(x => x.key === p?.key)
  if (o) choose(o)
}

const viewOptions = computed(() => props.views.map(v => ({ value: v, label: t('compare.views.' + v), icon: v === 'card' ? 'layers' : v === 'table' ? 'list' : 'chart' })))
const sortOptions = computed(() => ['recommended', 'cheapest', 'fastest', 'reliable'].map(v => ({ value: v, label: t('compare.sort.' + v), icon: v === 'recommended' ? 'spark' : undefined })))
const deltaPct = o => fmt.percent(o.deltaCheapest.pct, o.deltaCheapest.pct < 0.1 ? 1 : 0)
</script>

<template>
  <div class="qc" :class="{ busy: loading }" data-testid="quote-comparison">
    <!-- toolbar -->
    <div class="qc-tools">
      <SegmentedControl v-if="views.length > 1" v-model="view" size="sm" :options="viewOptions" :aria-label="t('compare.views.label')" data-testid="view-switcher" />
      <SegmentedControl v-if="!hideSort" v-model="sortMode" size="sm" :options="sortOptions" :aria-label="t('compare.sort.label')" data-testid="sort-switcher" />
      <span class="qc-count muted">{{ visible.length === all.length ? t('compare.results.count', { n: all.length }) : t('compare.results.countFiltered', { n: visible.length, total: all.length }) }}</span>
    </div>
    <div v-if="showFilters && all.length > 1" class="qc-filters" data-testid="compare-filters">
      <label class="qf"><span>{{ t('compare.filters.maxPrice') }} ({{ fmt.currency }})</span><input v-model="filters.maxPrice" class="input input-sm" type="number" min="0" step="1" :placeholder="t('compare.filters.any')" data-testid="filter-max-price" /></label>
      <label class="qf"><span>{{ t('compare.filters.maxDays') }}</span><input v-model="filters.maxDays" class="input input-sm" type="number" min="1" step="1" :placeholder="t('compare.filters.any')" data-testid="filter-max-days" /></label>
      <label class="qf"><span>{{ t('compare.filters.carrier') }}</span>
        <select v-model="filters.carrier" class="select input-sm" data-testid="filter-carrier">
          <option value="">{{ t('compare.filters.allCarriers') }}</option>
          <option v-for="c in carrierOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </label>
      <label v-if="hasOwn" class="checkbox qf-check"><input v-model="filters.ownOnly" type="checkbox" data-testid="filter-own" />{{ t('compare.filters.ownOnly') }}</label>
      <label class="checkbox qf-check"><input v-model="filters.signatureOnly" type="checkbox" data-testid="filter-signature" />{{ t('compare.filters.signatureOnly') }}</label>
      <label v-if="hasCross" class="checkbox qf-check"><input v-model="filters.ddpOnly" type="checkbox" data-testid="filter-ddp" />{{ t('compare.filters.ddpOnly') }}</label>
      <button v-if="filtersActive" type="button" class="btn-link small" @click="clearFilters">{{ t('compare.filters.clear') }}</button>
    </div>

    <div v-if="!visible.length" class="qc-empty">
      <Icon name="filter" :size="18" />
      <div><strong>{{ t('compare.results.empty') }}</strong><div class="muted small">{{ t('compare.results.emptyDesc') }}</div></div>
      <button v-if="filtersActive" type="button" class="btn btn-ghost btn-sm" @click="clearFilters">{{ t('compare.filters.clear') }}</button>
    </div>

    <!-- cards -->
    <div v-else-if="view === 'card'" class="qc-cards" role="radiogroup" :aria-label="t('compare.title')">
      <article v-for="o in visible" :key="o.key" class="qcard" :class="{ on: modelValue === o.key, ai: o.key === recKey, cmp: compareKeys.includes(o.key) }"
        data-testid="offer-card" :data-offer-key="o.key">
        <header class="qcard-head">
          <span class="qcard-logo">
            <CarrierLogo v-if="o.carrierCode && o.kind !== 'package'" :code="o.carrierCode" :size="32" />
            <span v-else class="pkg-ic"><Icon :name="o.kind === 'package' ? 'plane' : 'box'" :size="16" /></span>
          </span>
          <div class="qcard-names">
            <div class="qcard-title">{{ offerTitle(o) }}</div>
            <div class="qcard-sub">{{ offerSub(o) }}</div>
            <div class="qbadges">
              <span v-for="b in o.badges" :key="b" :data-testid="'offer-badge-' + b" class="qbdg" :class="'b-' + b"><Icon v-if="b === 'ai'" name="spark" :size="9" />{{ t('compare.badges.' + b) }}</span>
            </div>
          </div>
          <label class="cmp-check" :class="{ dis: !compareKeys.includes(o.key) && compareKeys.length >= 4 }" :title="!compareKeys.includes(o.key) && compareKeys.length >= 4 ? t('compare.bar.max') : ''">
            <input type="checkbox" :checked="compareKeys.includes(o.key)" :disabled="!compareKeys.includes(o.key) && compareKeys.length >= 4" data-testid="compare-checkbox" @change="toggleCompare(o.key)" />
            {{ t('compare.card.compare') }}
          </label>
        </header>

        <div class="qcard-metrics">
          <div class="qm">
            <span class="qm-l">{{ t('compare.card.total') }}</span>
            <span class="qm-v price"><Money :value="o.total" /></span>
            <span v-if="o.deltaCheapest.amount > 0" class="qm-d neg">+<Money :value="o.deltaCheapest.amount" :mono="false" /> (+{{ deltaPct(o) }}) {{ t('compare.card.vsCheapest') }}</span>
            <span v-else class="qm-d pos">{{ t('compare.card.cheapestNow') }}</span>
          </div>
          <div class="qm">
            <span class="qm-l">{{ t('compare.card.delivery') }}</span>
            <span class="qm-v">{{ daysText(o) }}</span>
            <span class="qm-d muted">{{ windowText(o) }}<template v-if="o.deltaFastestDays > 0"> · {{ t('compare.card.daysSlower', { n: o.deltaFastestDays }) }} {{ t('compare.card.vsFastest') }}</template><template v-else> · {{ t('compare.card.fastestNow') }}</template></span>
          </div>
          <div class="qm">
            <span class="qm-l">{{ t('compare.card.onTime') }}</span>
            <span class="qm-v">{{ o.onTimePct != null ? fmt.percent(o.onTimePct, 1) : '-' }}</span>
            <span class="ot-bar"><span :style="{ width: Math.max(4, ((o.onTimePct ?? 0.8) - 0.8) / 0.2 * 100) + '%' }" /></span>
          </div>
        </div>

        <ul class="pc-list" data-testid="offer-pros-cons">
          <li v-for="p in o.pros" :key="'p' + p.code" class="pc pro"><span class="pc-s">+</span>{{ itemText(p) }}</li>
          <li v-for="c in o.cons" :key="'c' + c.code" class="pc con"><span class="pc-s">-</span>{{ itemText(c) }}</li>
        </ul>

        <div v-if="openBreakdown.has(o.key)" class="legs">
          <div v-for="l in o.legs" :key="l.code" class="leg">
            <span>{{ t('compare.legs.' + l.code) }}<em v-if="l.estimated" class="muted"> ({{ t('compare.card.estimated') }})</em></span>
            <Money :value="l.amount" />
          </div>
        </div>

        <footer class="qcard-foot">
          <button type="button" class="btn-link small" :aria-expanded="openBreakdown.has(o.key)" @click="toggleBreakdown(o.key)">
            <Icon :name="openBreakdown.has(o.key) ? 'chevron-up' : 'chevron-down'" :size="12" />{{ t('compare.card.breakdown') }}
          </button>
          <WhyPopover v-if="o.key === recKey" :title="t('shipments.rates.why.title')" :items="whyItems(o)" size="xs" />
          <RouterLink v-if="o.connectHint" class="btn-link small" :to="{ name: 'carrier-accounts', query: { connect: o.connectHint.carrier } }"><Icon name="link" :size="11" />{{ t('compare.card.connect', { carrier: o.connectHint.carrierName }) }}</RouterLink>
          <span class="grow" />
          <template v-if="selectable">
            <button v-if="o.selectable !== false" type="button" role="radio" :aria-checked="modelValue === o.key" class="btn btn-sm" :class="modelValue === o.key ? 'btn-primary' : 'btn-ghost'" data-testid="offer-choose" @click="choose(o)">
              <Icon v-if="modelValue === o.key" name="check" :size="12" />{{ modelValue === o.key ? t('compare.results.chosen') : t('compare.results.choose') }}
            </button>
            <span v-else class="muted small">{{ t('compare.results.notSelectable') }}</span>
          </template>
        </footer>
      </article>
    </div>

    <!-- table -->
    <div v-else-if="view === 'table'" class="qc-table-wrap" data-testid="offer-table">
      <table class="qc-table">
        <thead>
          <tr>
            <th class="w-cmp"><span class="sr-only">{{ t('compare.card.compare') }}</span></th>
            <th>{{ t('compare.table.offer') }}</th>
            <th class="r">{{ t('compare.table.total') }}</th>
            <th class="r hide-sm">{{ t('compare.table.delta') }}</th>
            <th>{{ t('compare.table.eta') }}</th>
            <th class="r hide-sm">{{ t('compare.table.onTime') }}</th>
            <th class="hide-md">{{ t('compare.table.highlights') }}</th>
            <th v-if="selectable" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in visible" :key="o.key" :class="{ on: modelValue === o.key, ai: o.key === recKey }" data-testid="offer-row" :data-offer-key="o.key">
            <td class="w-cmp"><input type="checkbox" :checked="compareKeys.includes(o.key)" :disabled="!compareKeys.includes(o.key) && compareKeys.length >= 4" :aria-label="t('compare.card.compare')" data-testid="compare-checkbox" @change="toggleCompare(o.key)" /></td>
            <td>
              <div class="tn"><CarrierLogo v-if="o.carrierCode" :code="o.carrierCode" :size="22" /><div><div class="strong">{{ offerTitle(o) }}</div><div class="muted xs">{{ offerSub(o) }}</div>
                <div class="qbadges"><span v-for="b in o.badges" :key="b" :data-testid="'offer-badge-' + b" class="qbdg" :class="'b-' + b">{{ t('compare.badges.' + b) }}</span></div></div></div>
            </td>
            <td class="r strong"><Money :value="o.total" /></td>
            <td class="r hide-sm"><span v-if="o.deltaCheapest.amount > 0" class="neg">+<Money :value="o.deltaCheapest.amount" /> <span class="xs">(+{{ deltaPct(o) }})</span></span><span v-else class="pos">-</span></td>
            <td><div>{{ daysText(o) }}</div><div class="muted xs">{{ windowText(o) }}</div></td>
            <td class="r hide-sm">{{ o.onTimePct != null ? fmt.percent(o.onTimePct, 1) : '-' }}</td>
            <td class="hide-md xs">
              <div v-if="o.pros[0]" class="pro-t">+ {{ itemText(o.pros[0]) }}</div>
              <div v-if="o.cons[0]" class="con-t">- {{ itemText(o.cons[0]) }}</div>
            </td>
            <td v-if="selectable" class="r">
              <button v-if="o.selectable !== false" type="button" class="btn btn-xs" :class="modelValue === o.key ? 'btn-primary' : 'btn-ghost'" data-testid="offer-choose" @click="choose(o)">{{ modelValue === o.key ? t('compare.results.chosen') : t('compare.sheet.choose') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- chart -->
    <div v-else class="qc-chart" data-testid="offer-chart">
      <ScatterChart :points="chartPoints" :height="320" :x-label="t('compare.chart.x')" :y-label="t('compare.chart.y')" :r-label="t('compare.chart.r')"
        :x-format="v => fmt.money(v, 'USD', 0)" :r-format="v => fmt.number(v, 1) + '%'" :r-range="[5, 16]" show-labels="highlighted" :aria-label="t('compare.chart.aria')" @select="onPoint" />
    </div>

    <!-- sticky compare bar -->
    <div v-if="compareKeys.length" class="qc-bar" data-testid="compare-bar">
      <div class="qc-bar-l">
        <strong>{{ t('compare.bar.selected', { n: compareKeys.length }) }}</strong>
        <span class="muted small">{{ compareKeys.length < 2 ? t('compare.bar.hint') : t('compare.bar.max') }}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" @click="compareKeys = []">{{ t('compare.bar.clear') }}</button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="compareKeys.length < 2" data-testid="compare-open" @click="sheetOpen = true"><Icon name="layers" :size="13" />{{ t('compare.bar.open') }}</button>
    </div>

    <CompareSheet v-model:open="sheetOpen" :offers="compared" :recommended-key="recKey" :model-value="modelValue" :selectable="selectable" @select="chooseFromSheet" @remove="removeCompared" />
  </div>
</template>

<style scoped>
.qc { display: flex; flex-direction: column; gap: 10px; }
.qc.busy { opacity: .6; pointer-events: none; transition: opacity .15s; }
.qc-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.qc-count { margin-left: auto; font-size: 12.5px; }
.qc-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--bg); }
.qf { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--ink-3); }
.qf .input, .qf .select { height: 30px; font-size: 12.5px; width: 130px; }
.qf-check { font-size: 12.5px; height: 30px; }
.qc-empty { display: flex; align-items: center; gap: 12px; padding: 18px; border: 1px dashed var(--line-2); border-radius: var(--r-md); color: var(--ink-2); }
.qc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 10px; }
.qcard { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--surface); transition: border-color .15s, box-shadow .15s; }
.qcard:hover { border-color: var(--line-strong); }
.qcard.ai { border-color: oklch(0.85 0.06 268); }
.qcard.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.qcard.cmp { background: color-mix(in oklch, var(--bg-2) 60%, var(--surface)); }
.qcard-head { display: flex; gap: 10px; align-items: flex-start; }
.qcard-logo { flex: none; }
.pkg-ic { width: 32px; height: 32px; border-radius: 8px; background: var(--accent); color: white; display: grid; place-items: center; }
.qcard-names { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.qcard-title { font-weight: 600; font-size: 13.5px; line-height: 1.3; }
.qcard-sub { font-size: 12px; color: var(--ink-3); }
.qbadges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.qbdg { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600; background: var(--bg-3); color: var(--ink-2); white-space: nowrap; }
.b-ai { background: var(--accent); color: white; }
.b-cheapest { background: oklch(0.94 0.06 155); color: oklch(0.38 0.1 155); }
.b-fastest { background: oklch(0.95 0.06 80); color: oklch(0.42 0.1 70); }
.b-reliable { background: oklch(0.94 0.04 220); color: oklch(0.4 0.1 230); }
.b-own { background: var(--ink-1); color: white; }
.b-dynamic { background: oklch(0.94 0.05 300); color: oklch(0.4 0.14 300); }
.b-custom { background: oklch(0.94 0.04 220); color: oklch(0.4 0.1 230); }
.cmp-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-2); cursor: pointer; white-space: nowrap; flex: none; }
.cmp-check input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
.cmp-check.dis { opacity: .5; cursor: not-allowed; }
.qcard-metrics { display: grid; grid-template-columns: 1.2fr 1.1fr .8fr; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line-1); border-bottom: 1px solid var(--line-1); }
.qm { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.qm-l { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-3); }
.qm-v { font-weight: 600; font-size: 14px; }
.qm-v.price { font-size: 17px; font-family: var(--font-display); }
.qm-d { font-size: 11.5px; }
.ot-bar { height: 4px; border-radius: 4px; background: var(--bg-3); margin-top: 5px; overflow: hidden; }
.ot-bar span { display: block; height: 100%; background: oklch(0.6 0.13 155); border-radius: 4px; }
.pos { color: oklch(0.45 0.12 155); }
.neg { color: oklch(0.5 0.14 40); }
.pc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; line-height: 1.4; }
.pc { display: flex; gap: 6px; align-items: baseline; }
.pc-s { width: 14px; height: 14px; flex: none; border-radius: 4px; display: inline-grid; place-items: center; font-weight: 700; font-size: 11px; line-height: 1; transform: translateY(1px); }
.pro .pc-s { background: oklch(0.94 0.06 155); color: oklch(0.38 0.1 155); }
.con .pc-s { background: oklch(0.95 0.04 25); color: oklch(0.48 0.15 25); }
.con { color: var(--ink-2); }
.legs { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--bg-2); font-size: 12.5px; }
.leg { display: flex; justify-content: space-between; gap: 10px; }
.leg em { font-style: normal; }
.qcard-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: auto; }
.qcard-foot .btn-link { display: inline-flex; align-items: center; gap: 4px; }
.grow { flex: 1; }
.qc-table-wrap { overflow-x: auto; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.qc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.qc-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-3); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--line-1); background: var(--bg); }
.qc-table td { padding: 8px 10px; border-bottom: 1px solid var(--line-1); vertical-align: middle; }
.qc-table tr.ai td { background: color-mix(in oklch, var(--accent-soft) 40%, var(--surface)); }
.qc-table tr.on td { box-shadow: inset 0 0 0 9999px color-mix(in oklch, var(--accent-soft) 60%, transparent); }
.qc-table .r { text-align: right; }
.w-cmp { width: 32px; }
.w-cmp input { accent-color: var(--accent); }
.tn { display: flex; gap: 8px; align-items: flex-start; }
.pro-t { color: oklch(0.4 0.1 155); }
.con-t { color: oklch(0.48 0.15 25); }
.qc-chart { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px; background: var(--surface); }
.qc-bar { position: sticky; bottom: 12px; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line-strong); box-shadow: var(--shadow-lg); }
.qc-bar-l { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: 13px; }
.strong { font-weight: 600; }
.muted { color: var(--ink-3); }
.small { font-size: 12.5px; }
.xs { font-size: 11.5px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 860px) { .hide-md { display: none; } }
@media (max-width: 600px) {
  .hide-sm { display: none; }
  .qc-cards { grid-template-columns: 1fr; }
  .qcard-metrics { grid-template-columns: 1fr 1fr; }
  .qc-bar { flex-wrap: wrap; }
}
</style>
