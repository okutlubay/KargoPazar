<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import ChartLegend from './ChartLegend.vue'
import { useI18n } from '@/app/i18n/index.js'
import { seriesColor, alpha } from './palette.js'
import {
  useElementSize, toNum, isFiniteNum, niceScale, linear, timeTicks, formatDate, formatNumber,
  linePath, monotonePath, segments, nearestIndex, textWidth, chartId,
} from './utils.js'

const props = defineProps({
  series: { type: Array, default: () => [] },
  bands: { type: Array, default: () => [] },
  markers: { type: Array, default: () => [] },
  shadedRanges: { type: Array, default: () => [] },
  xType: { type: String, default: 'time' },
  height: { type: Number, default: 260 },
  yFormat: { type: Function, default: null },
  xFormat: { type: Function, default: null },
  xTickFormat: { type: Function, default: null },
  yMin: { type: Number, default: null },
  yMax: { type: Number, default: null },
  yZero: { type: Boolean, default: true },
  xDomain: { type: Array, default: null },
  curve: { type: String, default: 'monotone' },
  dots: { type: Boolean, default: false },
  legend: { type: Boolean, default: true },
  grid: { type: Boolean, default: true },
  strokeWidth: { type: Number, default: 2 },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['hover', 'toggle'])

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)
const clipId = chartId('kc-line')
const hidden = ref(new Set())

function toggle(key) {
  const s = new Set(hidden.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  hidden.value = s
  emit('toggle', key, !s.has(key))
}

const prepared = computed(() => {
  const series = props.series.map((s, i) => {
    const pts = (s.points || [])
      .map(p => ({ x: toNum(p.x), y: p.y == null ? null : Number(p.y) }))
      .filter(p => isFiniteNum(p.x))
      .sort((a, b) => a.x - b.x)
    const byX = new Map()
    for (const p of pts) byX.set(p.x, p.y)
    return {
      key: s.key ?? 's' + i, label: s.label ?? '', color: seriesColor(i, s.color),
      dashed: !!s.dashed, area: !!s.area, width: s.width, pts, byX,
    }
  })
  const bands = props.bands.map((b, i) => {
    const pts = (b.points || [])
      .map(p => ({ x: toNum(p.x), lo: p.lo == null ? null : Number(p.lo), hi: p.hi == null ? null : Number(p.hi) }))
      .filter(p => isFiniteNum(p.x))
      .sort((a, b2) => a.x - b2.x)
    const byX = new Map()
    for (const p of pts) byX.set(p.x, p)
    return {
      key: b.key ?? 'b' + i, label: b.label ?? '', color: b.color || seriesColor(0),
      opacity: b.opacity ?? (i === 0 ? 0.12 : 0.18), pts, byX,
    }
  })
  return { series, bands }
})

const visSeries = computed(() => prepared.value.series.filter(s => !hidden.value.has(s.key)))
const visBands = computed(() => prepared.value.bands.filter(b => !hidden.value.has(b.key)))

const isEmpty = computed(() => {
  const { series, bands } = prepared.value
  const anyS = series.some(s => s.pts.some(p => isFiniteNum(p.y)))
  const anyB = bands.some(b => b.pts.some(p => isFiniteNum(p.lo) || isFiniteNum(p.hi)))
  return !anyS && !anyB
})

const xs = computed(() => {
  const set = new Set()
  for (const s of visSeries.value) for (const p of s.pts) if (isFiniteNum(p.y)) set.add(p.x)
  for (const b of visBands.value) for (const p of b.pts) if (isFiniteNum(p.lo) || isFiniteNum(p.hi)) set.add(p.x)
  return [...set].sort((a, b) => a - b)
})

const allXs = computed(() => {
  let min = Infinity, max = -Infinity
  for (const s of prepared.value.series) for (const p of s.pts) { if (p.x < min) min = p.x; if (p.x > max) max = p.x }
  for (const b of prepared.value.bands) for (const p of b.pts) { if (p.x < min) min = p.x; if (p.x > max) max = p.x }
  return [min, max]
})

const hasTopLabels = computed(() =>
  props.markers.some(m => m.label) || props.shadedRanges.some(r => r.label))

const yDomain = computed(() => {
  let min = Infinity, max = -Infinity
  for (const s of visSeries.value) for (const p of s.pts) if (isFiniteNum(p.y)) { if (p.y < min) min = p.y; if (p.y > max) max = p.y }
  for (const b of visBands.value) for (const p of b.pts) {
    if (isFiniteNum(p.lo)) { if (p.lo < min) min = p.lo; if (p.lo > max) max = p.lo }
    if (isFiniteNum(p.hi)) { if (p.hi < min) min = p.hi; if (p.hi > max) max = p.hi }
  }
  if (!isFiniteNum(min)) { min = 0; max = 1 }
  if (props.yZero) { if (min > 0) min = 0; if (max < 0) max = 0 }
  if (props.yMin != null) min = props.yMin
  if (props.yMax != null) max = props.yMax
  return [min, max]
})

const fmtY = v => (props.yFormat ? props.yFormat(v) : formatNumber(v, locale.value))
const fmtX = v => {
  if (props.xFormat) return props.xFormat(props.xType === 'time' ? new Date(v) : v)
  return props.xType === 'time' ? formatDate(v, locale.value) : formatNumber(v, locale.value)
}

const layout = computed(() => {
  const W = width.value
  const H = props.height
  const top = hasTopLabels.value ? 20 : 8
  const bottom = 24
  const plotH0 = Math.max(20, H - top - bottom)
  const count = Math.max(2, Math.floor(plotH0 / 44))
  const ys = niceScale(yDomain.value[0], yDomain.value[1], count)
  const yMinV = props.yMin != null ? props.yMin : ys.min
  const yMaxV = props.yMax != null ? props.yMax : ys.max
  const yTicks = ys.ticks.filter(v => v >= yMinV - 1e-9 && v <= yMaxV + 1e-9).map(v => ({ value: v, label: fmtY(v) }))
  const left = Math.max(28, Math.ceil(Math.max(0, ...yTicks.map(tk => textWidth(tk.label, 10.5)))) + 12)
  const right = 14
  const plotW = Math.max(10, W - left - right)
  const y = linear(yMinV, yMaxV, top + plotH0, top)

  let [x0, x1] = props.xDomain ? props.xDomain.map(toNum) : allXs.value
  if (!isFiniteNum(x0) || !isFiniteNum(x1)) { x0 = 0; x1 = 1 }
  if (x0 === x1) {
    const pad = props.xType === 'time' ? 86400000 : Math.max(1, Math.abs(x0) * 0.1)
    x0 -= pad; x1 += pad
  }
  const x = linear(x0, x1, left, left + plotW)
  const xCount = Math.max(2, Math.floor(plotW / 84))
  let xTicks
  if (props.xType === 'time') {
    xTicks = timeTicks(x0, x1, xCount, locale.value)
    if (props.xTickFormat) xTicks = xTicks.map(tk => ({ value: tk.value, label: props.xTickFormat(new Date(tk.value)) }))
  } else {
    const ns = niceScale(x0, x1, xCount)
    const f = props.xTickFormat || props.xFormat
    xTicks = ns.ticks.filter(v => v >= x0 - 1e-9 && v <= x1 + 1e-9)
      .map(v => ({ value: v, label: f ? f(v) : formatNumber(v, locale.value) }))
  }
  return { W, H, top, bottom, left, right, plotW, plotH: plotH0, x, y, yTicks, xTicks, x0, x1, yMinV, yMaxV }
})

const baselineY = computed(() => {
  const L = layout.value
  const v = Math.min(Math.max(0, L.yMinV), L.yMaxV)
  return L.y(v)
})

const pathFn = pts => (props.curve === 'linear' ? linePath(pts) : monotonePath(pts))

const seriesPaths = computed(() => {
  if (!width.value) return []
  const L = layout.value
  return visSeries.value.map(s => {
    const segs = segments(s.pts.map(p => (isFiniteNum(p.y) ? [L.x(p.x), L.y(p.y)] : null)))
    const line = segs.filter(sg => sg.length > 1).map(pathFn).join('')
    const area = s.area
      ? segs.filter(sg => sg.length > 1).map(sg =>
        pathFn(sg) + `L${sg[sg.length - 1][0]},${baselineY.value}L${sg[0][0]},${baselineY.value}Z`).join('')
      : ''
    const singles = segs.filter(sg => sg.length === 1).map(sg => sg[0])
    const dotPts = props.dots ? segs.flat() : singles
    return { ...s, line, area, dotPts }
  })
})

const bandPaths = computed(() => {
  if (!width.value) return []
  const L = layout.value
  return visBands.value.map(b => {
    const segs = segments(b.pts.map(p => (isFiniteNum(p.lo) && isFiniteNum(p.hi) ? p : null)))
    const d = segs.map(sg => {
      if (sg.length === 1) {
        const px = L.x(sg[0].x)
        return `M${px - 2},${L.y(sg[0].hi)}L${px + 2},${L.y(sg[0].hi)}L${px + 2},${L.y(sg[0].lo)}L${px - 2},${L.y(sg[0].lo)}Z`
      }
      const up = sg.map(p => [L.x(p.x), L.y(p.hi)])
      const lo = sg.map(p => [L.x(p.x), L.y(p.lo)]).reverse()
      const f = props.curve === 'linear' ? (pts, c) => (c ? linePath(pts).replace(/^M/, 'L') : linePath(pts)) : monotonePath
      return f(up, false) + f(lo, true) + 'Z'
    }).join('')
    return { ...b, d }
  })
})

const shaded = computed(() => {
  if (!width.value) return []
  const L = layout.value
  return props.shadedRanges.map((r, i) => {
    const a = Math.max(L.x0, toNum(r.from)), b = Math.min(L.x1, toNum(r.to))
    if (!(b >= a)) return null
    const xa = L.x(a), xb = L.x(b)
    return { key: r.key ?? 'r' + i, x: xa, w: Math.max(1, xb - xa), label: r.label, color: r.color || 'var(--warning)' }
  }).filter(Boolean)
})

const markerLines = computed(() => {
  if (!width.value) return []
  const L = layout.value
  return props.markers.map((m, i) => {
    const v = toNum(m.x)
    if (!isFiniteNum(v) || v < L.x0 || v > L.x1) return null
    const px = L.x(v)
    const anchor = px > L.left + L.plotW - 30 ? 'end' : px < L.left + 30 ? 'start' : 'middle'
    return { key: m.key ?? 'm' + i, x: px, label: m.label, dashed: m.dashed !== false, color: m.color || 'var(--ink-3)', anchor }
  }).filter(Boolean)
})

const legendItems = computed(() => [
  ...prepared.value.series.map(s => ({
    key: s.key, label: s.label, color: s.color, shape: s.dashed ? 'dashed' : 'line', off: hidden.value.has(s.key),
  })),
  ...prepared.value.bands.map(b => ({
    key: b.key, label: b.label, color: alpha(b.color, Math.min(1, b.opacity * 2.2)), shape: 'square', off: hidden.value.has(b.key),
  })),
])

const aria = computed(() => props.ariaLabel ||
  [t('charts.chart'), ...prepared.value.series.map(s => s.label)].filter(Boolean).join(', '))

/* ---------- hover ---------- */
const hoverIdx = ref(-1)
const pointerY = ref(0)
const svgRef = ref(null)
let raf = 0
let pending = null

function onPointerMove(e) {
  const box = svgRef.value.getBoundingClientRect()
  pending = { mx: e.clientX - box.left, my: e.clientY - box.top }
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const p = pending
    if (!p || !xs.value.length) return
    pointerY.value = p.my
    const idx = nearestIndex(xs.value, layout.value.x.invert(p.mx))
    if (idx !== hoverIdx.value) {
      hoverIdx.value = idx
      emit('hover', hover.value ? { x: hover.value.xRaw, rows: hover.value.rows } : null)
    }
  })
}
function onLeave() {
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  pending = null
  if (hoverIdx.value !== -1) { hoverIdx.value = -1; emit('hover', null) }
}
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf) })

const hover = computed(() => {
  const i = hoverIdx.value
  if (i < 0 || i >= xs.value.length || !width.value) return null
  const xv = xs.value[i]
  const L = layout.value
  const rows = []
  const dots = []
  for (const s of visSeries.value) {
    const yv = s.byX.get(xv)
    if (!isFiniteNum(yv)) continue
    rows.push({ key: s.key, label: s.label, color: s.color, value: yv, text: fmtY(yv), dashed: s.dashed, type: 'series' })
    dots.push({ key: s.key, x: L.x(xv), y: L.y(yv), color: s.color })
  }
  for (const b of visBands.value) {
    const p = b.byX.get(xv)
    if (!p || !(isFiniteNum(p.lo) || isFiniteNum(p.hi))) continue
    rows.push({
      key: b.key, label: b.label, color: alpha(b.color, Math.min(1, b.opacity * 2.2)), lo: p.lo, hi: p.hi,
      text: t('charts.range', { lo: fmtY(p.lo), hi: fmtY(p.hi) }), type: 'band',
    })
  }
  return { xRaw: props.xType === 'time' ? new Date(xv) : xv, px: L.x(xv), title: fmtX(xv), rows, dots }
})
</script>

<template>
  <div ref="root" class="kc-root kc-line">
    <div v-if="isEmpty" class="kc-empty" :style="{ height: height + 'px' }">{{ emptyText || t('charts.noData') }}</div>
    <template v-else>
      <div class="kc-plot" :style="{ height: height + 'px', position: 'relative' }">
        <svg
          v-if="width > 0"
          ref="svgRef"
          class="kc-svg"
          :width="layout.W"
          :height="layout.H"
          :viewBox="`0 0 ${layout.W} ${layout.H}`"
          role="img"
          :aria-label="aria"
          @pointermove="onPointerMove"
          @pointerleave="onLeave"
        >
          <defs>
            <clipPath :id="clipId">
              <rect :x="layout.left" :y="layout.top - 2" :width="layout.plotW" :height="layout.plotH + 4" />
            </clipPath>
          </defs>

          <g>
            <g v-for="r in shaded" :key="r.key">
              <rect :x="r.x" :y="layout.top" :width="r.w" :height="layout.plotH" :style="{ fill: alpha(r.color, 0.1) }" />
              <text v-if="r.label" class="kc-tick" :x="r.x + 4" :y="layout.top - 6" :style="{ fill: 'var(--ink-3)' }">{{ r.label }}</text>
            </g>
          </g>

          <g class="kc-axis">
            <template v-for="tk in layout.yTicks" :key="'y' + tk.value">
              <line v-if="grid" class="kc-grid" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.y(tk.value)" :y2="layout.y(tk.value)" />
              <text :x="layout.left - 8" :y="layout.y(tk.value)" text-anchor="end" dominant-baseline="middle">{{ tk.label }}</text>
            </template>
            <line class="kc-baseline" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.top + layout.plotH" :y2="layout.top + layout.plotH" />
            <text
              v-for="(tk, i) in layout.xTicks"
              :key="'x' + tk.value"
              :x="layout.x(tk.value)"
              :y="layout.top + layout.plotH + 16"
              :text-anchor="i === 0 && layout.x(tk.value) - layout.left < 20 ? 'start' : 'middle'"
            >{{ tk.label }}</text>
          </g>

          <g :clip-path="`url(#${clipId})`">
            <path
              v-for="b in bandPaths"
              :key="'band-' + b.key"
              class="kc-anim"
              :d="b.d"
              :style="{ fill: alpha(b.color, b.opacity) }"
            />
            <path
              v-for="s in seriesPaths.filter(s => s.area)"
              :key="'area-' + s.key"
              class="kc-anim"
              :d="s.area"
              :style="{ fill: alpha(s.color, 0.12) }"
            />
            <path
              v-for="s in seriesPaths"
              :key="'line-' + s.key"
              class="kc-anim"
              :d="s.line"
              fill="none"
              stroke-linejoin="round"
              stroke-linecap="round"
              :stroke-width="s.width || strokeWidth"
              :stroke-dasharray="s.dashed ? '5 4' : null"
              :style="{ stroke: s.color }"
            />
          </g>
          <g>
            <template v-for="s in seriesPaths" :key="'dots-' + s.key">
              <circle v-for="(p, i) in s.dotPts" :key="i" :cx="p[0]" :cy="p[1]" r="2.6" :style="{ fill: s.color }" />
            </template>
          </g>

          <g v-for="m in markerLines" :key="m.key">
            <line
              :x1="m.x" :x2="m.x" :y1="layout.top" :y2="layout.top + layout.plotH"
              stroke-width="1" :stroke-dasharray="m.dashed ? '3 3' : null" :style="{ stroke: m.color }"
            />
            <text v-if="m.label" class="kc-tick" :x="m.x" :y="layout.top - 6" :text-anchor="m.anchor" :style="{ fill: m.color }">{{ m.label }}</text>
          </g>

          <g v-if="hover" pointer-events="none">
            <line class="kc-grid" :x1="hover.px" :x2="hover.px" :y1="layout.top" :y2="layout.top + layout.plotH" :style="{ stroke: 'var(--line-strong)' }" />
            <circle
              v-for="d in hover.dots"
              :key="'h' + d.key"
              :cx="d.x" :cy="d.y" r="4" stroke-width="2"
              :style="{ fill: 'var(--surface)', stroke: d.color }"
            />
          </g>
          <rect
            :x="layout.left" :y="layout.top" :width="layout.plotW" :height="layout.plotH"
            fill="transparent" style="cursor: crosshair"
          />
        </svg>
        <ChartTooltip
          :visible="!!hover && hover.rows.length > 0"
          :x="hover ? hover.px : 0"
          :y="pointerY"
          :container-width="layout.W"
          :container-height="height"
        >
          <template v-if="hover">
            <slot name="tooltip" :x="hover.xRaw" :title="hover.title" :rows="hover.rows">
              <div class="kc-tip-title">{{ hover.title }}</div>
              <div v-for="r in hover.rows" :key="r.key" class="kc-tip-row">
                <span class="kc-tip-key">
                  <span class="kc-swatch" :class="r.type === 'band' ? '' : r.dashed ? 'dashed' : 'line'" :style="r.dashed ? { color: r.color } : { background: r.color }" />
                  {{ r.label }}
                </span>
                <span class="kc-tip-val">{{ r.text }}</span>
              </div>
            </slot>
          </template>
        </ChartTooltip>
      </div>
      <ChartLegend v-if="legend && legendItems.length > 1" :items="legendItems" @toggle="toggle" />
    </template>
  </div>
</template>
