<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import { useI18n } from '@/app/i18n/index.js'
import { heatColor, mix } from './palette.js'
import { useElementSize, isFiniteNum } from './utils.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  cols: { type: Array, default: () => [] },
  values: { type: Array, default: () => [] },
  meta: { type: Array, default: null },
  format: { type: Function, default: null },
  metaFormat: { type: Function, default: null },
  domain: { type: Array, default: null },
  reverse: { type: Boolean, default: false },
  cornerLabel: { type: String, default: '' },
  colLabel: { type: String, default: '' },
  showValues: { type: Boolean, default: true },
  legend: { type: Boolean, default: true },
  cellHeight: { type: Number, default: 34 },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['select', 'hover'])

const { t, fmt } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)

const lbl = x => (x && typeof x === 'object' ? (x.label ?? x.key ?? '') : String(x ?? ''))
const rowLabels = computed(() => props.rows.map(lbl))
const colLabels = computed(() => props.cols.map(lbl))

const fmtV = v => (v == null || !isFiniteNum(v) ? '-' : props.format ? props.format(v) : fmt.percent(v, 0))
const fmtMeta = m => {
  if (m == null) return ''
  if (props.metaFormat) return props.metaFormat(m)
  if (typeof m === 'number') return t('charts.samples', { n: fmt.number(m) })
  return String(m)
}

const cellVal = (r, c) => {
  const row = props.values[r]
  const v = row ? row[c] : null
  return v == null || !isFiniteNum(Number(v)) ? null : Number(v)
}
const cellMeta = (r, c) => (props.meta && props.meta[r] ? props.meta[r][c] : null)

const dom = computed(() => {
  if (props.domain) return props.domain
  let lo = Infinity, hi = -Infinity
  props.rows.forEach((_, r) => props.cols.forEach((__, c) => {
    const v = cellVal(r, c)
    if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v }
  }))
  if (!isFiniteNum(lo)) return [0, 1]
  if (lo === hi) return [Math.min(0, lo), Math.max(1, hi)]
  return [lo, hi]
})

const isEmpty = computed(() => !props.rows.length || !props.cols.length)

function colorOf(v) {
  if (v == null) return 'var(--bg-3)'
  const [lo, hi] = dom.value
  let tt = hi === lo ? 1 : (v - lo) / (hi - lo)
  if (props.reverse) tt = 1 - tt
  return mix('var(--surface)', heatColor(tt), 0.6)
}

const compact = computed(() => width.value > 0 && width.value < 420)
const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(${compact.value ? 64 : 96}px, max-content) repeat(${props.cols.length}, minmax(0, 1fr))`,
}))

const hover = ref(null)
function enter(e, r, c) {
  const box = root.value.getBoundingClientRect()
  const cell = e.currentTarget.getBoundingClientRect()
  const v = cellVal(r, c), m = cellMeta(r, c)
  hover.value = {
    r, c, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top + cell.height / 2,
    title: `${rowLabels.value[r]} · ${colLabels.value[c]}`, text: v == null ? t('charts.noData') : fmtV(v), meta: fmtMeta(m),
    color: colorOf(v),
  }
  emit('hover', { row: props.rows[r], col: props.cols[c], r, c, value: v, meta: m })
}
function leave() {
  hover.value = null
  emit('hover', null)
}
function click(r, c) {
  emit('select', { row: props.rows[r], col: props.cols[c], r, c, value: cellVal(r, c), meta: cellMeta(r, c) })
}

const legendStops = computed(() => {
  const stops = [0, 0.25, 0.5, 0.75, 1].map(s => mix('var(--surface)', heatColor(props.reverse ? 1 - s : s), 0.6))
  return `linear-gradient(90deg, ${stops.join(', ')})`
})
const aria = computed(() => props.ariaLabel || [t('charts.chart'), props.cornerLabel, props.colLabel].filter(Boolean).join(', '))
</script>

<template>
  <div ref="root" class="kc-root kc-heat">
    <div v-if="isEmpty" class="kc-empty" :style="{ height: cellHeight * 4 + 'px' }">{{ emptyText || t('charts.noData') }}</div>
    <template v-else>
      <div class="kc-heat-grid" :class="{ compact }" :style="gridStyle" role="img" :aria-label="aria">
        <div class="kc-heat-corner">{{ cornerLabel }}</div>
        <div v-for="(cl, c) in colLabels" :key="'h' + c" class="kc-heat-colhead">{{ cl }}</div>
        <template v-for="(rl, r) in rowLabels" :key="'r' + r">
          <div class="kc-heat-rowhead" :title="rl">{{ rl }}</div>
          <div
            v-for="(cl, c) in colLabels"
            :key="r + ':' + c"
            class="kc-heat-cell"
            :class="{ empty: cellVal(r, c) == null, on: hover && hover.r === r && hover.c === c }"
            :style="{ background: colorOf(cellVal(r, c)), height: cellHeight + 'px' }"
            @mouseenter="enter($event, r, c)"
            @mouseleave="leave"
            @click="click(r, c)"
          >
            <span v-if="showValues && !compact">{{ cellVal(r, c) == null ? '-' : fmtV(cellVal(r, c)) }}</span>
          </div>
        </template>
      </div>
      <div v-if="legend" class="kc-heat-legend">
        <span v-if="colLabel" class="kc-heat-axis">{{ colLabel }}</span>
        <span class="kc-heat-scale" :aria-label="t('charts.legendScale')">
          <span class="kc-tick-html">{{ fmtV(reverse ? dom[1] : dom[0]) }}</span>
          <span class="kc-heat-bar" :style="{ background: legendStops }" />
          <span class="kc-tick-html">{{ fmtV(reverse ? dom[0] : dom[1]) }}</span>
        </span>
      </div>
      <ChartTooltip
        :visible="!!hover"
        :x="hover ? hover.x : 0"
        :y="hover ? hover.y : 0"
        :container-width="width"
        :offset="18"
      >
        <template v-if="hover">
          <slot name="tooltip" v-bind="hover">
            <div class="kc-tip-title">{{ hover.title }}</div>
            <div class="kc-tip-row">
              <span class="kc-tip-key"><span class="kc-swatch" :style="{ background: hover.color }" /></span>
              <span class="kc-tip-val">{{ hover.text }}</span>
            </div>
            <div v-if="hover.meta" class="kc-tip-sub">{{ hover.meta }}</div>
          </slot>
        </template>
      </ChartTooltip>
    </template>
  </div>
</template>

<style>
.kc-heat-grid { display: grid; gap: 3px; align-items: stretch; }
.kc-heat-corner, .kc-heat-colhead {
  font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-3); letter-spacing: 0.04em;
  text-transform: uppercase; padding: 0 2px 4px; align-self: end;
}
.kc-heat-colhead { text-align: center; }
.kc-heat-rowhead {
  font-size: 12.5px; color: var(--ink-2); font-weight: 500; display: flex; align-items: center;
  padding-right: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kc-heat-cell {
  display: flex; align-items: center; justify-content: center; border-radius: 5px; cursor: default;
  font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-1); font-weight: 500;
  transition: background 0.25s ease, box-shadow 0.12s ease, transform 0.12s ease;
}
.kc-heat-cell.empty {
  color: var(--ink-4);
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, var(--line-1) 5px 6px) !important;
}
.kc-heat-cell.on { box-shadow: 0 0 0 2px var(--ink-1); position: relative; z-index: 1; }
.kc-heat-grid.compact .kc-heat-rowhead { font-size: 11.5px; }
.kc-heat-legend { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
.kc-heat-axis { font-size: 11.5px; color: var(--ink-3); }
.kc-heat-scale { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.kc-heat-bar { width: 120px; height: 8px; border-radius: 999px; border: 1px solid var(--line-1); }
.kc-tick-html { font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-3); }
</style>
