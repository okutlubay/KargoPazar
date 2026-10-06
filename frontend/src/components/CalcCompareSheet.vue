<script setup>
// Landing: sticky "compare" bar + full-screen side by side sheet for 2-4 selected offers.
//   <CalcCompareSheet v-model:keys="compareKeys" :offers="annotatedOffers" :recommended-key />
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import { compareMatrix, aiSummary, rowText, groupText, trackingText, yesNo, daysText, summaryText, badgeText, offerSubText } from './calcCompare.js'

const props = defineProps({
  keys: { type: Array, default: () => [] },
  offers: { type: Array, default: () => [] },
  recommendedKey: { type: String, default: null },
})
const emit = defineEmits(['update:keys'])
const { t, lang, f, money, num } = useI18n()
const open = ref(false)

const selected = computed(() => props.keys.map(k => props.offers.find(o => o.key === k)).filter(Boolean))
const rows = computed(() => compareMatrix(selected.value).filter(r => r.cells.some(c => c.value != null)))
const summary = computed(() => (selected.value.length >= 2 ? aiSummary(selected.value, props.recommendedKey) : []))

function cell(r, v) {
  if (v == null) return '-'
  switch (r.kind) {
    case 'money': return r.key === 'insurance' && !v ? yesNo(false, lang.value) : money(v)
    case 'days': return daysText({ etaMinDays: v[0], etaMaxDays: v[1] }, lang.value)
    case 'pct': return lang.value === 'tr' ? '%' + num(v * 100, 1) : num(v * 100, 1) + '%'
    case 'bool': return yesNo(v, lang.value)
    case 'tracking': return trackingText(v, lang.value)
    case 'number': return daysText({ etaMinDays: v, etaMaxDays: v }, lang.value)
    default: return String(v)
  }
}
function remove(key) {
  const next = props.keys.filter(k => k !== key)
  emit('update:keys', next)
  if (next.length < 2) open.value = false
}
const onKey = e => { if (e.key === 'Escape') open.value = false }
watch(open, v => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="keys.length" class="ccbar" data-testid="landing-compare-bar">
    <div class="ccbar-l">
      <strong>{{ f(t.quoteCompare.selected, { n: keys.length }) }}</strong>
      <span class="muted">{{ t.quoteCompare.hint }}</span>
    </div>
    <button type="button" class="btn btn-ghost btn-sm" @click="emit('update:keys', [])">{{ t.quoteCompare.clear }}</button>
    <button type="button" class="btn btn-accent btn-sm" :disabled="keys.length < 2" data-testid="landing-compare-open" @click="open = true">{{ t.quoteCompare.open }}</button>
  </div>
  <Teleport to="body">
    <div v-if="open" class="ccov" role="dialog" aria-modal="true" :aria-label="t.quoteCompare.title" @mousedown.self="open = false">
      <div class="ccpanel" data-testid="landing-compare-sheet">
        <header class="cchead">
          <div><div class="cct">{{ t.quoteCompare.title }}</div><div class="muted">{{ t.quoteCompare.subtitle }}</div></div>
          <button type="button" class="btn btn-ghost btn-sm" :aria-label="t.quoteCompare.close" @click="open = false"><Icon name="x" :size="14" /></button>
        </header>
        <div class="ccbody">
          <div class="ccscroll">
            <table class="cctable">
              <thead>
                <tr>
                  <th />
                  <th v-for="o in selected" :key="o.key" :class="{ ai: o.key === recommendedKey }">
                    <div class="ccname">{{ o.title || o.serviceName }}</div>
                    <div class="muted">{{ offerSubText(o, lang) }}</div>
                    <div class="ccb"><span v-for="b in o.badges" :key="b" class="ccbdg" :class="'b-' + b">{{ badgeText(b, lang) }}</span></div>
                    <button type="button" class="btn-x" @click="remove(o.key)">{{ t.quoteCompare.remove }}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.key">
                  <th scope="row">{{ rowText(r.key, lang) }}<span class="grp">{{ groupText(r.group, lang) }}</span></th>
                  <td v-for="c in r.cells" :key="c.key" :class="{ best: c.best, worst: c.worst }">{{ cell(r, c.value) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <section v-if="summary.length" class="ccai" data-testid="landing-ai-summary">
            <div class="ccai-h"><span class="badge-ai">AI</span>{{ t.quoteCompare.aiTitle }}</div>
            <ul><li v-for="(s, i) in summary" :key="i">{{ summaryText(s, selected, lang) }}</li></ul>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ccbar { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 10px; margin: 10px 16px; padding: 10px 14px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line-2); box-shadow: 0 8px 28px rgba(20, 22, 40, 0.14); }
.ccbar-l { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: 13px; }
.muted { color: var(--ink-3); font-size: 12px; font-weight: 400; }
.ccov { position: fixed; inset: 0; z-index: 1000; background: rgba(20, 22, 40, 0.35); display: flex; align-items: stretch; justify-content: center; padding: 24px; }
.ccpanel { background: var(--surface); border-radius: 14px; width: min(1180px, 100%); max-height: 100%; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(20, 22, 40, 0.3); }
.cchead { display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line-1); }
.cct { font-family: var(--font-display); font-weight: 600; font-size: 17px; }
.ccbody { padding: 16px 20px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.ccscroll { overflow-x: auto; border: 1px solid var(--line-1); border-radius: 10px; }
.cctable { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
.cctable th, .cctable td { padding: 8px 12px; border-bottom: 1px solid var(--line-1); text-align: left; vertical-align: top; }
.cctable tbody th { color: var(--ink-2); font-weight: 500; width: 200px; }
.cctable thead th { background: var(--bg-2); }
.cctable thead th.ai { background: var(--accent-soft); }
.grp { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-4); }
.ccname { font-weight: 600; }
.ccb { display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }
.ccbdg { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--bg-3); color: var(--ink-2); }
.b-ai { background: var(--accent); color: white; }
.b-cheapest { background: oklch(0.94 0.06 155); color: oklch(0.38 0.1 155); }
.b-fastest { background: oklch(0.95 0.06 80); color: oklch(0.42 0.1 70); }
.btn-x { border: 0; background: none; color: var(--ink-3); font-size: 11.5px; cursor: pointer; padding: 0; text-decoration: underline; }
td.best { background: oklch(0.95 0.06 155); color: oklch(0.36 0.1 155); font-weight: 600; }
td.worst { background: oklch(0.95 0.04 25); color: oklch(0.45 0.15 25); }
.ccai { border: 1px solid oklch(0.85 0.06 268); background: var(--accent-soft); border-radius: 10px; padding: 12px 16px; }
.ccai-h { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 6px; }
.ccai ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--ink-2); line-height: 1.5; }
@media (max-width: 680px) { .ccov { padding: 0; } .ccpanel { border-radius: 0; } .ccbar { flex-wrap: wrap; } }
</style>
