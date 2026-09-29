<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import { useI18n } from '@/app/i18n/index.js'
import { alpha } from './palette.js'
import { useElementSize, isFiniteNum, niceScale, linear, formatNumber, textWidth } from './utils.js'

const props = defineProps({
  points: { type: Array, default: () => [] },
  height: { type: Number, default: 280 },
  xFormat: { type: Function, default: null },
  yFormat: { type: Function, default: null },
  rFormat: { type: Function, default: null },
  xLabel: { type: String, default: '' },
  yLabel: { type: String, default: '' },
  rLabel: { type: String, default: '' },
  rRange: { type: Array, default: () => [4, 14] },
  rDomain: { type: Array, default: null },
  xZero: { type: Boolean, default: false },
  yZero: { type: Boolean, default: false },
  yInvert: { type: Boolean, default: false },
  color: { type: String, default: 'var(--accent)' },
  highlightColor: { type: String, default: 'var(--accent)' },
  showLabels: { type: String, default: 'highlighted' },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['select', 'hover'])

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)

const fx = v => (props.xFormat ? props.xFormat(v) : formatNumber(v, locale.value))
const fy = v => (props.yFormat ? props.yFormat(v) : formatNumber(v, locale.value))
const fr = v => (props.rFormat ? props.rFormat(v) : formatNumber(v, locale.value))

const pts = computed(() => props.points
  .map((p, i) => ({ ...p, _i: i, _k: p.key ?? i, x: Number(p.x), y: Number(p.y), r: p.r == null ? null : Number(p.r) }))
  .filter(p => isFiniteNum(p.x) && isFiniteNum(p.y)))
const isEmpty = computed(() => pts.value.length === 0)

const layout = computed(() => {
  const W = width.value, H = props.height
  const top = 12, bottom = props.xLabel ? 40 : 26
  const plotH = Math.max(20, H - top - bottom)
  let xmin = Math.min(...pts.value.map(p => p.x)), xmax = Math.max(...pts.value.map(p => p.x))
  let ymin = Math.min(...pts.value.map(p => p.y)), ymax = Math.max(...pts.value.map(p => p.y))
  if (props.xZero) xmin = Math.min(0, xmin)
  if (props.yZero) ymin = Math.min(0, ymin)
  // breathing room so bubbles are not clipped by the frame
  const px = (xmax - xmin) * 0.06 || Math.abs(xmax) * 0.1 || 1
  const py = (ymax - ymin) * 0.08 || Math.abs(ymax) * 0.1 || 1
  const ys = niceScale(props.yZero ? ymin : ymin - py, ymax + py, Math.max(2, Math.floor(plotH / 48)))
  const yTicks = ys.ticks.map(v => ({ value: v, label: fy(v) }))
  const left = Math.max(28, Math.ceil(Math.max(0, ...yTicks.map(tk => textWidth(tk.label, 10.5)))) + 12) + (props.yLabel ? 16 : 0)
  const right = 16
  const plotW = Math.max(10, W - left - right)
  const xs = niceScale(props.xZero ? xmin : xmin - px, xmax + px, Math.max(2, Math.floor(plotW / 90)))
  const xTicks = xs.ticks.map(v => ({ value: v, label: fx(v) }))
  const x = linear(xs.min, xs.max, left, left + plotW)
  const y = props.yInvert ? linear(ys.min, ys.max, top, top + plotH) : linear(ys.min, ys.max, top + plotH, top)
  const rs = pts.value.map(p => p.r).filter(isFiniteNum)
  const [r0, r1] = props.rDomain || [Math.min(...rs), Math.max(...rs)]
  const rScale = v => {
    if (!isFiniteNum(v) || !rs.length) return (props.rRange[0] + props.rRange[1]) / 2
    if (r1 === r0) return (props.rRange[0] + props.rRange[1]) / 2
    // area-proportional sizing
    const tt = Math.max(0, Math.min(1, (v - r0) / (r1 - r0)))
    return Math.sqrt(props.rRange[0] ** 2 + tt * (props.rRange[1] ** 2 - props.rRange[0] ** 2))
  }
  return { W, H, top, bottom, left, right, plotW, plotH, x, y, xTicks, yTicks, rScale }
})

const dots = computed(() => {
  if (!width.value) return []
  const L = layout.value
  const list = pts.value.map(p => ({
    ...p, cx: L.x(p.x), cy: L.y(p.y), rad: L.rScale(p.r),
    fill: p.color || (p.highlighted ? props.highlightColor : props.color),
  }))
  // highlighted drawn last (on top); larger drawn first
  return list.sort((a, b) => (a.highlighted === b.highlighted ? b.rad - a.rad : a.highlighted ? 1 : -1))
})

const hoverKey = ref(null)
const svgRef = ref(null)
function onMove(e) {
  const box = svgRef.value.getBoundingClientRect()
  const mx = e.clientX - box.left, my = e.clientY - box.top
  let best = null, bd = Infinity
  for (const d of dots.value) {
    const dist = Math.hypot(d.cx - mx, d.cy - my) - d.rad
    if (dist < bd) { bd = dist; best = d }
  }
  const k = best && bd < 24 ? best._k : null
  if (k !== hoverKey.value) {
    hoverKey.value = k
    emit('hover', best && k != null ? props.points[best._i] : null)
  }
}
function onLeave() { if (hoverKey.value != null) { hoverKey.value = null; emit('hover', null) } }
function onClick() {
  const d = dots.value.find(p => p._k === hoverKey.value)
  if (d) emit('select', props.points[d._i])
}
const hovered = computed(() => dots.value.find(d => d._k === hoverKey.value) || null)
const labelled = computed(() => dots.value.filter(d => d.label &&
  (props.showLabels === 'all' || (props.showLabels === 'highlighted' && d.highlighted))))
const aria = computed(() => props.ariaLabel || [t('charts.chart'), props.xLabel, props.yLabel].filter(Boolean).join(', '))
</script>

<template>
  <div ref="root" class="kc-root kc-scatter">
    <div v-if="isEmpty" class="kc-empty" :style="{ height: height + 'px' }">{{ emptyText || t('charts.noData') }}</div>
    <div v-else :style="{ height: height + 'px', position: 'relative' }">
      <svg
        v-if="width > 0"
        ref="svgRef"
        class="kc-svg"
        :width="layout.W"
        :height="layout.H"
        :viewBox="`0 0 ${layout.W} ${layout.H}`"
        role="img"
        :aria-label="aria"
        @pointermove="onMove"
        @pointerleave="onLeave"
        @click="onClick"
      >
        <g class="kc-axis">
          <template v-for="tk in layout.yTicks" :key="'y' + tk.value">
            <line class="kc-grid" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.y(tk.value)" :y2="layout.y(tk.value)" />
            <text :x="layout.left - 8" :y="layout.y(tk.value)" text-anchor="end" dominant-baseline="middle">{{ tk.label }}</text>
          </template>
          <template v-for="tk in layout.xTicks" :key="'x' + tk.value">
            <line class="kc-grid" :x1="layout.x(tk.value)" :x2="layout.x(tk.value)" :y1="layout.top" :y2="layout.top + layout.plotH" />
            <text :x="layout.x(tk.value)" :y="layout.top + layout.plotH + 16" text-anchor="middle">{{ tk.label }}</text>
          </template>
          <rect :x="layout.left" :y="layout.top" :width="layout.plotW" :height="layout.plotH" fill="none" class="kc-baseline" />
          <text
            v-if="xLabel"
            :x="layout.left + layout.plotW / 2"
            :y="layout.H - 4"
            text-anchor="middle"
            :style="{ fontFamily: 'var(--font-body)', fontSize: '11.5px', fill: 'var(--ink-3)' }"
          >{{ xLabel }}</text>
          <text
            v-if="yLabel"
            :transform="`translate(10 ${layout.top + layout.plotH / 2}) rotate(-90)`"
            text-anchor="middle"
            dominant-baseline="middle"
            :style="{ fontFamily: 'var(--font-body)', fontSize: '11.5px', fill: 'var(--ink-3)' }"
          >{{ yLabel }}</text>
        </g>
        <g>
          <circle
            v-for="d in dots"
            :key="d._k"
            class="kc-scatter-dot"
            :class="{ 'kc-dim': hoverKey != null && hoverKey !== d._k && !d.highlighted }"
            :cx="d.cx"
            :cy="d.cy"
            :r="d.rad"
            :stroke-width="d.highlighted ? 2.5 : 1.25"
            :style="{
              fill: d.highlighted ? d.fill : alpha(d.fill, 0.28),
              stroke: d.highlighted ? 'var(--surface)' : d.fill,
            }"
          />
          <circle
            v-for="d in dots.filter(d => d.highlighted)"
            :key="'ring' + d._k"
            :cx="d.cx" :cy="d.cy" :r="d.rad + 4" fill="none" stroke-width="1.5"
            class="kc-scatter-ring"
            :style="{ stroke: d.fill }"
          />
          <circle
            v-if="hovered"
            :cx="hovered.cx" :cy="hovered.cy" :r="hovered.rad + 2" fill="none" stroke-width="1.5"
            pointer-events="none"
            :style="{ stroke: 'var(--ink-1)' }"
          />
        </g>
        <g pointer-events="none">
          <text
            v-for="d in labelled"
            :key="'l' + d._k"
            :x="d.cx + d.rad + 6"
            :y="d.cy"
            dominant-baseline="middle"
            :text-anchor="d.cx > layout.left + layout.plotW * 0.8 ? 'end' : 'start'"
            :dx="d.cx > layout.left + layout.plotW * 0.8 ? -(2 * d.rad + 12) : 0"
            :style="{ fontSize: '11.5px', fontWeight: 600, fill: 'var(--ink-1)', paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }"
          >{{ d.label }}</text>
        </g>
      </svg>
      <ChartTooltip
        :visible="!!hovered"
        :x="hovered ? hovered.cx + hovered.rad / 2 : 0"
        :y="hovered ? hovered.cy : 0"
        :container-width="layout.W"
        :container-height="height"
      >
        <template v-if="hovered">
          <slot name="tooltip" :point="points[hovered._i]">
            <div v-if="hovered.label" class="kc-tip-title">{{ hovered.label }}</div>
            <div v-if="hovered.sublabel" class="kc-tip-sub" style="margin-bottom: 4px">{{ hovered.sublabel }}</div>
            <div class="kc-tip-row">
              <span class="kc-tip-key">{{ xLabel }}</span><span class="kc-tip-val">{{ fx(hovered.x) }}</span>
            </div>
            <div class="kc-tip-row">
              <span class="kc-tip-key">{{ yLabel }}</span><span class="kc-tip-val">{{ fy(hovered.y) }}</span>
            </div>
            <div v-if="hovered.r != null && rLabel" class="kc-tip-row">
              <span class="kc-tip-key">{{ rLabel }}</span><span class="kc-tip-val">{{ fr(hovered.r) }}</span>
            </div>
          </slot>
        </template>
      </ChartTooltip>
    </div>
  </div>
</template>

<style>
.kc-scatter-dot { transition: opacity 0.15s ease, cx 0.35s ease, cy 0.35s ease, r 0.35s ease; cursor: pointer; }
.kc-scatter-ring { transition: cx 0.35s ease, cy 0.35s ease, r 0.35s ease; opacity: 0.45; }
</style>
