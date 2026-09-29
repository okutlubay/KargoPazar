<script setup>
// Diverging bar list for model explanations (feature contributions, word influence).
//   <ContributionBars :items="[{ key, label, value, hint? }]" :format="v => v.toFixed(2)" />
// Positive values grow right (success), negative left (danger). `mode="positive"` draws one-sided bars.
import { computed } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  format: { type: Function, default: v => (v > 0 ? '+' : '') + (Math.round(v * 100) / 100) },
  mode: { type: String, default: 'diverging' }, // diverging | positive
  max: { type: Number, default: null },
  positiveColor: { type: String, default: 'var(--success)' },
  negativeColor: { type: String, default: 'var(--danger)' },
  highlightKey: { type: String, default: null },
})
const scale = computed(() => props.max ?? Math.max(1e-9, ...props.items.map(i => Math.abs(i.value))))
const pct = v => Math.min(100, (Math.abs(v) / scale.value) * 100)
</script>

<template>
  <ul :class="['cb', mode]">
    <li v-for="it in items" :key="it.key ?? it.label" :class="{ hl: highlightKey && it.key === highlightKey }">
      <div class="lbl" :title="it.hint || it.label">{{ it.label }}</div>
      <div class="track">
        <template v-if="mode === 'diverging'">
          <div class="half neg"><div v-if="it.value < 0" class="bar" :style="{ width: pct(it.value) + '%', background: negativeColor }" /></div>
          <div class="half pos"><div v-if="it.value > 0" class="bar" :style="{ width: pct(it.value) + '%', background: positiveColor }" /></div>
        </template>
        <div v-else class="one"><div class="bar" :style="{ width: pct(it.value) + '%', background: it.color || positiveColor }" /></div>
      </div>
      <div :class="['val', 'num', { neg: it.value < 0 && mode === 'diverging', pos: it.value > 0 && mode === 'diverging' }]">{{ format(it.value, it) }}</div>
    </li>
  </ul>
</template>

<style scoped>
.cb { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
li { display: grid; grid-template-columns: minmax(120px, 42%) 1fr 64px; gap: 10px; align-items: center; font-size: 12.5px; padding: 2px 4px; border-radius: 6px; }
li.hl { background: var(--accent-soft); }
.lbl { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.track { display: flex; height: 10px; align-items: stretch; }
.half { flex: 1; display: flex; }
.half.neg { justify-content: flex-end; border-right: 1px solid var(--line-strong); }
.one { flex: 1; background: var(--bg-3); border-radius: 5px; overflow: hidden; display: flex; }
.bar { height: 100%; border-radius: 3px; transition: width .35s ease; }
.half.neg .bar { border-radius: 3px 0 0 3px; }
.half.pos .bar { border-radius: 0 3px 3px 0; }
.val { text-align: right; color: var(--ink-2); }
.val.neg { color: var(--danger); }
.val.pos { color: oklch(0.5 0.12 155); }
</style>
