<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import ChartLegend from './ChartLegend.vue'
import { useI18n } from '@/app/i18n/index.js'
import { seriesColor } from './palette.js'
import { useElementSize, isFiniteNum, niceScale, linear, formatNumber, textWidth, clamp } from './utils.js'

const props = defineProps({
  categories: { type: Array, default: () => [] },
  series: { type: Array, default: () => [] },
  mode: { type: String, default: 'grouped' },
  horizontal: { type: Boolean, default: false },
  height: { type: Number, default: null },
  rowHeight: { type: Number, default: 28 },
  valueFormat: { type: Function, default: null },
  axisFormat: { type: Function, default: null },
  categoryFormat: { type: Function, default: null },
  showValues: { type: Boolean, default: false },
  showTotal: { type: Boolean, default: true },
  legend: { type: Boolean, default: true },
  grid: { type: Boolean, default: true },
  maxBarWidth: { type: Number, default: 48 },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['select', 'hover', 'toggle'])

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)
const hidden = ref(new Set())

function toggle(key) {
  const s = new Set(hidden.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  hidden.value = s
  emit('toggle', key, !s.has(key))
}

const fmtV = v => (props.valueFormat ? props.valueFormat(v) : formatNumber(v, locale.value))
const fmtAxis = v => (props.axisFormat ? props.axisFormat(v) : fmtV(v))
const catLabel = c => {
  const raw = c && typeof c === 'object' ? (c.label ?? c.key) : c
  return props.categoryFormat ? props.categoryFormat(raw) : String(raw ?? '')
}

const allSeries = computed(() => props.series.map((s, i) => ({
  key: s.key ?? 's' + i, label: s.label ?? '', color: seriesColor(i, s.color), values: s.values || [],
})))
const visSeries = computed(() => allSeries.value.filter(s => !hidden.value.has(s.key)))
const stacked = computed(() => props.mode === 'stacked')

const isEmpty = computed(() => !props.categories.length ||
  !allSeries.value.some(s => s.values.some(v => isFiniteNum(Number(v)) && v != null)))

const labels = computed(() => props.categories.map(catLabel))

const chartHeight = computed(() => {
  if (props.height) return props.height
  if (props.horizontal) return Math.max(80, props.categories.length * props.rowHeight + 30)
  return 240
})

const valueDomain = computed(() => {
  let min = 0, max = 0
  const n = props.categories.length
  for (let i = 0; i < n; i++) {
    let pos = 0, neg = 0
    for (const s of visSeries.value) {
      const v = Number(s.values[i])
      if (!isFiniteNum(v)) continue
      if (stacked.value) { if (v >= 0) pos += v; else neg += v } else { if (v > max) max = v; if (v < min) min = v }
    }
    if (stacked.value) { if (pos > max) max = pos; if (neg < min) min = neg }
  }
  if (min === 0 && max === 0) max = 1
  return [min, max]
})

const layout = computed(() => {
  const W = width.value, H = chartHeight.value, n = props.categories.length
  const labelsTop = props.showValues ? 16 : 8
  if (!props.horizontal) {
    const top = labelsTop, bottom = 26
    const plotH = Math.max(20, H - top - bottom)
    const ns = niceScale(valueDomain.value[0], valueDomain.value[1], Math.max(2, Math.floor(plotH / 44)))
    const ticks = ns.ticks.map(v => ({ value: v, label: fmtAxis(v) }))
    const left = Math.max(28, Math.ceil(Math.max(0, ...ticks.map(tk => textWidth(tk.label, 10.5)))) + 12)
    const right = 8
    const plotW = Math.max(10, W - left - right)
    const v = linear(ns.min, ns.max, top + plotH, top)
    const band = plotW / Math.max(1, n)
    const maxLabel = Math.max(1, ...labels.value.map(l => textWidth(l, 10.5)))
    const every = Math.max(1, Math.ceil((maxLabel + 8) / band))
    return { W, H, top, bottom, left, right, plotW, plotH, v, ticks, band, every, alongStart: left, zero: v(clamp(0, ns.min, ns.max)) }
  }
  const top = 4, bottom = 22
  const plotH = Math.max(10, H - top - bottom)
  const left = Math.min(Math.max(40, W * 0.38), Math.ceil(Math.max(0, ...labels.value.map(l => textWidth(l, 11.5)))) + 14)
  const right = props.showValues ? 12 + Math.ceil(textWidth(fmtV(valueDomain.value[1]), 10.5)) : 12
  const plotW = Math.max(10, W - left - right)
  const ns = niceScale(valueDomain.value[0], valueDomain.value[1], Math.max(2, Math.floor(plotW / 80)))
  const ticks = ns.ticks.map(v => ({ value: v, label: fmtAxis(v) }))
  const v = linear(ns.min, ns.max, left, left + plotW)
  const band = plotH / Math.max(1, n)
  return { W, H, top, bottom, left, right, plotW, plotH, v, ticks, band, every: 1, alongStart: top, zero: v(clamp(0, ns.min, ns.max)) }
})

const bars = computed(() => {
  if (!width.value) return []
  const L = layout.value
  const out = []
  const vs = visSeries.value
  const m = Math.max(1, vs.length)
  const inner = Math.min(L.band * 0.72, stacked.value ? props.maxBarWidth : props.maxBarWidth * m)
  props.categories.forEach((_, i) => {
    const bandStart = L.alongStart + i * L.band + (L.band - inner) / 2
    let pos = 0, neg = 0
    vs.forEach((s, j) => {
      const val = Number(s.values[i])
      if (!isFiniteNum(val)) return
      let a0, aw, b0, b1
      if (stacked.value) {
        a0 = bandStart; aw = inner
        if (val >= 0) { b0 = pos; b1 = pos + val; pos = b1 } else { b0 = neg; b1 = neg + val; neg = b1 }
      } else {
        const gap = m > 1 ? Math.min(3, inner / m * 0.15) : 0
        aw = Math.max(1, (inner - gap * (m - 1)) / m)
        a0 = bandStart + j * (aw + gap)
        b0 = 0; b1 = val
      }
      const p0 = L.v(b0), p1 = L.v(b1)
      const lo = Math.min(p0, p1), len = Math.max(val === 0 ? 0 : 1, Math.abs(p1 - p0))
      const rect = props.horizontal
        ? { x: lo, y: a0, width: len, height: aw }
        : { x: a0, y: lo, width: aw, height: len }
      out.push({ id: s.key + ':' + i, key: s.key, i, color: s.color, val, rect, end: p1, a0, aw, neg: val < 0 })
    })
  })
  return out
})

const valueLabels = computed(() => {
  if (!props.showValues || !width.value) return []
  const L = layout.value
  if (!stacked.value) {
    return bars.value.map(b => props.horizontal
      ? { id: b.id, x: b.end + (b.neg ? -4 : 4), y: b.a0 + b.aw / 2, anchor: b.neg ? 'end' : 'start', text: fmtV(b.val) }
      : { id: b.id, x: b.a0 + b.aw / 2, y: b.end + (b.neg ? 12 : -4), anchor: 'middle', text: fmtV(b.val) })
  }
  return props.categories.map((_, i) => {
    const mine = bars.value.filter(b => b.i === i)
    if (!mine.length) return null
    const total = mine.reduce((a, b) => a + b.val, 0)
    const ends = mine.map(b => b.end)
    const b0 = mine[0]
    return props.horizontal
      ? { id: 't' + i, x: Math.max(...ends, L.zero) + 4, y: b0.a0 + b0.aw / 2, anchor: 'start', text: fmtV(total) }
      : { id: 't' + i, x: b0.a0 + b0.aw / 2, y: Math.min(...ends, L.zero) - 4, anchor: 'middle', text: fmtV(total) }
  }).filter(Boolean)
})

const legendItems = computed(() => allSeries.value.map(s => ({
  key: s.key, label: s.label, color: s.color, shape: 'square', off: hidden.value.has(s.key),
})))

function fitLabel(lab) {
  const max = Math.max(3, Math.floor((layout.value.left - 14) / (11.5 * 0.6)))
  return lab.length > max ? lab.slice(0, max - 1) + '…' : lab
}

const aria = computed(() => props.ariaLabel ||
  [t('charts.chart'), ...allSeries.value.map(s => s.label)].filter(Boolean).join(', '))

/* hover */
const svgRef = ref(null)
const hoverIdx = ref(-1)
const pointer = ref({ x: 0, y: 0 })
function onMove(e) {
  const box = svgRef.value.getBoundingClientRect()
  const x = e.clientX - box.left, y = e.clientY - box.top
  pointer.value = { x, y }
  const L = layout.value
  const along = props.horizontal ? y : x
  const i = Math.floor((along - L.alongStart) / L.band)
  const idx = i >= 0 && i < props.categories.length ? i : -1
  if (idx !== hoverIdx.value) {
    hoverIdx.value = idx
    emit('hover', idx >= 0 ? { index: idx, category: props.categories[idx] } : null)
  }
}
function onLeave() {
  if (hoverIdx.value !== -1) { hoverIdx.value = -1; emit('hover', null) }
}
function onClick() {
  if (hoverIdx.value >= 0) emit('select', { index: hoverIdx.value, category: props.categories[hoverIdx.value] })
}

const hover = computed(() => {
  const i = hoverIdx.value
  if (i < 0 || !width.value) return null
  const L = layout.value
  const rows = visSeries.value
    .map(s => ({ key: s.key, label: s.label, color: s.color, value: Number(s.values[i]) }))
    .filter(r => isFiniteNum(r.value))
    .map(r => ({ ...r, text: fmtV(r.value) }))
  const total = rows.reduce((a, r) => a + r.value, 0)
  const center = L.alongStart + (i + 0.5) * L.band
  return {
    index: i, title: labels.value[i], rows,
    total: stacked.value && props.showTotal && rows.length > 1 ? fmtV(total) : null,
    tx: props.horizontal ? pointer.value.x : center,
    ty: props.horizontal ? center : pointer.value.y,
    band: props.horizontal
      ? { x: L.left, y: L.alongStart + i * L.band, width: L.plotW, height: L.band }
      : { x: L.alongStart + i * L.band, y: L.top, width: L.band, height: L.plotH },
  }
})
</script>

<template>
  <div ref="root" class="kc-root kc-bar">
    <div v-if="isEmpty" class="kc-empty" :style="{ height: chartHeight + 'px' }">{{ emptyText || t('charts.noData') }}</div>
    <template v-else>
      <div :style="{ height: chartHeight + 'px', position: 'relative' }">
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
          <rect v-if="hover" v-bind="hover.band" :style="{ fill: 'var(--bg-2)' }" pointer-events="none" />
          <g class="kc-axis">
            <template v-if="!horizontal">
              <template v-for="tk in layout.ticks" :key="'v' + tk.value">
                <line v-if="grid" class="kc-grid" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.v(tk.value)" :y2="layout.v(tk.value)" />
                <text :x="layout.left - 8" :y="layout.v(tk.value)" text-anchor="end" dominant-baseline="middle">{{ tk.label }}</text>
              </template>
              <line class="kc-baseline" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.zero" :y2="layout.zero" />
              <template v-for="(lab, i) in labels" :key="'c' + i">
                <text
                  v-if="i % layout.every === 0"
                  :x="layout.left + (i + 0.5) * layout.band"
                  :y="layout.top + layout.plotH + 17"
                  text-anchor="middle"
                >{{ lab }}</text>
              </template>
            </template>
            <template v-else>
              <template v-for="tk in layout.ticks" :key="'v' + tk.value">
                <line v-if="grid" class="kc-grid" :x1="layout.v(tk.value)" :x2="layout.v(tk.value)" :y1="layout.top" :y2="layout.top + layout.plotH" />
                <text :x="layout.v(tk.value)" :y="layout.top + layout.plotH + 15" text-anchor="middle">{{ tk.label }}</text>
              </template>
              <line class="kc-baseline" :x1="layout.zero" :x2="layout.zero" :y1="layout.top" :y2="layout.top + layout.plotH" />
              <text
                v-for="(lab, i) in labels"
                :key="'c' + i"
                :x="layout.left - 8"
                :y="layout.top + (i + 0.5) * layout.band"
                text-anchor="end"
                dominant-baseline="middle"
                :style="{ fontFamily: 'var(--font-body)', fontSize: '11.5px', fill: 'var(--ink-2)' }"
              >{{ fitLabel(lab) }}<title>{{ lab }}</title></text>
            </template>
          </g>
          <g>
            <rect
              v-for="b in bars"
              :key="b.id"
              class="kc-bar-rect"
              :class="{ 'kc-dim': hover && hover.index !== b.i }"
              v-bind="b.rect"
              rx="2"
              :style="{ fill: b.color }"
            />
          </g>
          <g v-if="valueLabels.length" pointer-events="none">
            <text
              v-for="l in valueLabels"
              :key="'l' + l.id"
              class="kc-tick"
              :x="l.x" :y="l.y" :text-anchor="l.anchor"
              :dominant-baseline="horizontal ? 'middle' : null"
              :style="{ fill: 'var(--ink-2)' }"
            >{{ l.text }}</text>
          </g>
        </svg>
        <ChartTooltip
          :visible="!!hover && hover.rows.length > 0"
          :x="hover ? hover.tx : 0"
          :y="hover ? hover.ty : 0"
          :container-width="layout.W"
          :container-height="chartHeight"
        >
          <template v-if="hover">
            <slot name="tooltip" :index="hover.index" :category="categories[hover.index]" :rows="hover.rows">
              <div class="kc-tip-title">{{ hover.title }}</div>
              <div v-for="r in hover.rows" :key="r.key" class="kc-tip-row">
                <span class="kc-tip-key"><span class="kc-swatch" :style="{ background: r.color }" />{{ r.label }}</span>
                <span class="kc-tip-val">{{ r.text }}</span>
              </div>
              <div v-if="hover.total" class="kc-tip-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line-1)">
                <span class="kc-tip-key">{{ t('charts.total') }}</span>
                <span class="kc-tip-val">{{ hover.total }}</span>
              </div>
            </slot>
          </template>
        </ChartTooltip>
      </div>
      <ChartLegend v-if="legend && legendItems.length > 1" :items="legendItems" @toggle="toggle" />
    </template>
  </div>
</template>

<style>
.kc-bar-rect { transition: opacity 0.15s ease, x 0.3s ease, y 0.3s ease, width 0.3s ease, height 0.3s ease; }
</style>
