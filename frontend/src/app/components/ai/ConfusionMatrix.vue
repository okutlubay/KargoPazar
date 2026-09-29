<script setup>
// 2x2 confusion matrix. Rows = actual, columns = predicted. Positive class label comes from props.
//   <ConfusionMatrix :tp="26" :fp="1" :fn="0" :tn="53" :positive-label="t('..problem')" :negative-label="t('..ok')" />
import { computed } from 'vue'
import { useI18n } from '../../i18n/index.js'

const props = defineProps({
  tp: { type: Number, default: 0 },
  fp: { type: Number, default: 0 },
  fn: { type: Number, default: 0 },
  tn: { type: Number, default: 0 },
  positiveLabel: { type: String, required: true },
  negativeLabel: { type: String, required: true },
})
const { t, fmt } = useI18n()
const total = computed(() => props.tp + props.fp + props.fn + props.tn || 1)
const cells = computed(() => [
  [{ k: 'tp', v: props.tp, good: true }, { k: 'fn', v: props.fn, good: false }],
  [{ k: 'fp', v: props.fp, good: false }, { k: 'tn', v: props.tn, good: true }],
])
const shade = c => {
  const a = Math.min(1, c.v / total.value * 1.6)
  return c.good ? `color-mix(in oklch, var(--success) ${Math.round(12 + a * 40)}%, var(--surface))` : `color-mix(in oklch, var(--danger) ${Math.round(c.v ? 10 + a * 40 : 0)}%, var(--surface))`
}
</script>

<template>
  <div class="cm" role="table" :aria-label="t('aiHub.confusion.title')">
    <div class="corner" />
    <div class="axis top" role="columnheader">{{ t('aiHub.confusion.predicted') }}</div>
    <div class="corner" />
    <div class="h" role="columnheader">{{ positiveLabel }}</div>
    <div class="h" role="columnheader">{{ negativeLabel }}</div>
    <div class="axis side" role="rowheader">{{ t('aiHub.confusion.actual') }}</div>
    <template v-for="(row, r) in cells" :key="r">
      <div class="h side-h" role="rowheader">{{ r === 0 ? positiveLabel : negativeLabel }}</div>
      <div v-for="c in row" :key="c.k" class="cell" :style="{ background: shade(c) }" role="cell">
        <div class="v num">{{ fmt.number(c.v) }}</div>
        <div class="k">{{ t(`aiHub.confusion.${c.k}`) }}</div>
        <div class="p num">{{ fmt.percent(c.v / total, 1) }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cm { display: grid; grid-template-columns: 26px minmax(70px, auto) 1fr 1fr; gap: 6px; align-items: stretch; font-size: 12.5px; }
.corner { grid-column: 1 / 3; }
.axis.top { grid-column: 3 / 5; text-align: center; color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.h { color: var(--ink-2); font-weight: 500; text-align: center; align-self: end; }
.side-h { text-align: right; align-self: center; padding-right: 4px; grid-column: 2; }
.axis.side { grid-row: 3 / 5; grid-column: 1; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.cell { border-radius: 10px; border: 1px solid var(--line-1); padding: 12px 10px; text-align: center; min-height: 78px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
.v { font-family: var(--font-display); font-size: 22px; font-weight: 600; color: var(--ink-1); }
.k { font-size: 11.5px; color: var(--ink-2); }
.p { font-size: 11px; color: var(--ink-3); }
</style>
