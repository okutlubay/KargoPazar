<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import { useI18n } from '@/app/i18n/index.js'
import { alpha } from './palette.js'
import { useElementSize, isFiniteNum, linear, monotonePath, linePath, segments, formatNumber, clamp, chartId } from './utils.js'

const props = defineProps({
  data: { type: Array, default: () => [] },
  color: { type: String, default: 'var(--accent)' },
  height: { type: Number, default: 32 },
  area: { type: Boolean, default: true },
  strokeWidth: { type: Number, default: 1.5 },
  showLast: { type: Boolean, default: true },
  curve: { type: String, default: 'monotone' },
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  tooltip: { type: Boolean, default: false },
  labels: { type: Array, default: null },
  format: { type: Function, default: null },
  ariaLabel: { type: String, default: '' },
})

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)
const gid = chartId('kc-spark')

const vals = computed(() => props.data.map(v => (v == null || !isFiniteNum(Number(v)) ? null : Number(v))))
const finite = computed(() => vals.value.filter(v => v != null))
const isEmpty = computed(() => finite.value.length === 0)

const geo = computed(() => {
  const W = width.value, H = props.height, pad = 2 + props.strokeWidth
  let lo = props.min ?? Math.min(...finite.value), hi = props.max ?? Math.max(...finite.value)
  if (lo === hi) { lo -= 1; hi += 1 }
  const n = vals.value.length
  const x = linear(0, Math.max(1, n - 1), pad, W - pad)
  const y = linear(lo, hi, H - pad, pad)
  const pts = vals.value.map((v, i) => (v == null ? null : [n === 1 ? W / 2 : x(i), y(v)]))
  const segs = segments(pts)
  const f = props.curve === 'linear' ? linePath : monotonePath
  const line = segs.filter(s => s.length > 1).map(s => f(s)).join('')
  const areaD = segs.filter(s => s.length > 1).map(s => f(s) + `L${s[s.length - 1][0]},${H}L${s[0][0]},${H}Z`).join('')
  let last = null
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i]) { last = pts[i]; break }
  return { W, H, x, pts, line, areaD, last, singles: segs.filter(s => s.length === 1).map(s => s[0]) }
})

const fmtV = v => (props.format ? props.format(v) : formatNumber(v, locale.value))

const hoverIdx = ref(-1)
function onMove(e) {
  if (!props.tooltip || !vals.value.length) return
  const box = e.currentTarget.getBoundingClientRect()
  const i = clamp(Math.round(geo.value.x.invert(e.clientX - box.left)), 0, vals.value.length - 1)
  hoverIdx.value = vals.value[i] == null ? -1 : i
}
const hoverPt = computed(() => (hoverIdx.value >= 0 ? geo.value.pts[hoverIdx.value] : null))
const aria = computed(() => props.ariaLabel || t('charts.chart'))
</script>

<template>
  <div ref="root" class="kc-root kc-spark" :style="{ height: height + 'px' }">
    <svg
      v-if="width > 0 && !isEmpty"
      :width="geo.W"
      :height="geo.H"
      :viewBox="`0 0 ${geo.W} ${geo.H}`"
      role="img"
      :aria-label="aria"
      @pointermove="onMove"
      @pointerleave="hoverIdx = -1"
    >
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :style="{ stopColor: color, stopOpacity: 0.22 }" />
          <stop offset="1" :style="{ stopColor: color, stopOpacity: 0 }" />
        </linearGradient>
      </defs>
      <path v-if="area && geo.areaD" :d="geo.areaD" :fill="`url(#${gid})`" />
      <path
        :d="geo.line" fill="none" :stroke-width="strokeWidth" stroke-linejoin="round" stroke-linecap="round"
        :style="{ stroke: color }"
      />
      <circle v-for="(p, i) in geo.singles" :key="'s' + i" :cx="p[0]" :cy="p[1]" r="2" :style="{ fill: color }" />
      <circle v-if="showLast && geo.last" :cx="geo.last[0]" :cy="geo.last[1]" r="2.4" :style="{ fill: color }" />
      <circle
        v-if="hoverPt" :cx="hoverPt[0]" :cy="hoverPt[1]" r="3.2" stroke-width="1.5"
        :style="{ fill: 'var(--surface)', stroke: color }"
      />
    </svg>
    <div v-else-if="isEmpty" class="kc-spark-empty" :style="{ background: alpha('var(--line-2)', 0.6) }" :aria-label="t('charts.noData')" role="img" />
    <ChartTooltip
      v-if="tooltip"
      :visible="!!hoverPt"
      :x="hoverPt ? hoverPt[0] : 0"
      :y="height / 2"
      :container-width="geo.W"
      :offset="10"
    >
      <template v-if="hoverPt">
        <div v-if="labels && labels[hoverIdx] != null" class="kc-tip-sub">{{ labels[hoverIdx] }}</div>
        <div class="kc-tip-val">{{ fmtV(vals[hoverIdx]) }}</div>
      </template>
    </ChartTooltip>
  </div>
</template>

<style>
.kc-spark { min-width: 24px; }
.kc-spark .kc-tip { min-width: 0; padding: 4px 8px; }
.kc-spark-empty { position: absolute; left: 0; right: 0; top: 50%; height: 1px; }
</style>
