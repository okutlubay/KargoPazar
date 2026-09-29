<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import { useI18n } from '@/app/i18n/index.js'
import { useElementSize, isFiniteNum, niceScale, linear, formatNumber, textWidth } from './utils.js'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  format: { type: Function, default: null },
  height: { type: Number, default: 240 },
  showValues: { type: Boolean, default: true },
  baseline: { type: String, default: 'auto' },
  colors: { type: Object, default: () => ({}) },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['hover'])

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)

const fmtV = v => (props.format ? props.format(v) : formatNumber(v, locale.value))
const signed = v => (v > 0 ? '+' : v < 0 ? '-' : '') + fmtV(Math.abs(v))
const C = computed(() => ({
  start: 'oklch(0.55 0.03 265)', end: 'var(--accent)', up: 'var(--success)', down: 'var(--danger)', ...props.colors,
}))

const model = computed(() => {
  let run = 0
  return props.steps.map((s, i) => {
    const v = Number(s.value)
    const type = s.type || (i === 0 ? 'start' : 'delta')
    let from, to
    if (type === 'start') { from = 0; to = isFiniteNum(v) ? v : 0; run = to }
    else if (type === 'end') { from = 0; to = isFiniteNum(v) ? v : run; run = to }
    else { from = run; to = run + (isFiniteNum(v) ? v : 0); run = to }
    const delta = type === 'delta' ? to - from : to
    const color = s.color || (type === 'start' ? C.value.start : type === 'end' ? C.value.end : delta >= 0 ? C.value.up : C.value.down)
    return { i, label: s.label ?? '', type, from, to, delta, run, color, raw: s }
  })
})
const isEmpty = computed(() => model.value.length === 0)

const layout = computed(() => {
  const W = width.value, H = props.height
  const top = props.showValues ? 18 : 8, bottom = 34
  const plotH = Math.max(20, H - top - bottom)
  const levels = model.value.flatMap(m => (m.type === 'delta' ? [m.from, m.to] : [m.to]))
  let lo = Math.min(...levels), hi = Math.max(...levels)
  if (props.baseline === 'zero') { lo = Math.min(0, lo); hi = Math.max(0, hi) } else {
    const pad = (hi - lo) * 0.35 || Math.abs(hi) * 0.1 || 1
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad
  }
  const ns = niceScale(lo, hi, Math.max(2, Math.floor(plotH / 44)))
  const ticks = ns.ticks.map(v => ({ value: v, label: fmtV(v) }))
  const left = Math.max(28, Math.ceil(Math.max(0, ...ticks.map(tk => textWidth(tk.label, 10.5)))) + 12)
  const right = 8
  const plotW = Math.max(10, W - left - right)
  const y = linear(ns.min, ns.max, top + plotH, top)
  const n = model.value.length
  const band = plotW / Math.max(1, n)
  const bw = Math.min(56, band * 0.62)
  return { W, H, top, bottom, left, plotW, plotH, y, ticks, band, bw, floor: ns.min }
})

function wrap(label, maxPx) {
  const maxChars = Math.max(4, Math.floor(maxPx / 6.2))
  const words = String(label).split(/\s+/)
  const lines = ['']
  for (const w of words) {
    const cur = lines[lines.length - 1]
    if (!cur) lines[lines.length - 1] = w
    else if ((cur + ' ' + w).length <= maxChars) lines[lines.length - 1] = cur + ' ' + w
    else lines.push(w)
  }
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].slice(0, maxChars - 1) + '…' }
  return lines.map(l => (l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l))
}

const bars = computed(() => {
  if (!width.value) return []
  const L = layout.value
  return model.value.map((m, i) => {
    const cx = L.left + (i + 0.5) * L.band
    const base = m.type === 'delta' ? L.y(m.from) : L.y(L.floor > 0 ? L.floor : 0)
    const endY = L.y(m.to)
    const yTop = Math.min(base, endY), h = Math.max(1, Math.abs(base - endY))
    return {
      ...m, cx, x: cx - L.bw / 2, y: yTop, h, endY,
      labelY: m.type === 'delta' && m.delta < 0 ? yTop + h + 12 : yTop - 5,
      text: m.type === 'delta' ? signed(m.delta) : fmtV(m.to),
      lines: wrap(m.label, L.band - 4),
    }
  })
})

const connectors = computed(() => {
  const L = layout.value
  const out = []
  for (let i = 0; i < bars.value.length - 1; i++) {
    const a = bars.value[i], b = bars.value[i + 1]
    out.push({ key: i, x1: a.x + L.bw, x2: b.x, y: L.y(a.run) })
  }
  return out
})

const hoverIdx = ref(-1)
const svgRef = ref(null)
function onMove(e) {
  const box = svgRef.value.getBoundingClientRect()
  const i = Math.floor((e.clientX - box.left - layout.value.left) / layout.value.band)
  const idx = i >= 0 && i < model.value.length ? i : -1
  if (idx !== hoverIdx.value) { hoverIdx.value = idx; emit('hover', idx >= 0 ? props.steps[idx] : null) }
}
function onLeave() { if (hoverIdx.value !== -1) { hoverIdx.value = -1; emit('hover', null) } }
const hovered = computed(() => (hoverIdx.value >= 0 ? bars.value[hoverIdx.value] : null))
const aria = computed(() => props.ariaLabel ||
  [t('charts.chart'), ...model.value.map(m => `${m.label} ${m.type === 'delta' ? signed(m.delta) : fmtV(m.to)}`)].join(', '))
</script>

<template>
  <div ref="root" class="kc-root kc-waterfall">
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
      >
        <rect
          v-if="hovered"
          :x="layout.left + hovered.i * layout.band" :y="layout.top" :width="layout.band" :height="layout.plotH"
          :style="{ fill: 'var(--bg-2)' }"
        />
        <g class="kc-axis">
          <template v-for="tk in layout.ticks" :key="'y' + tk.value">
            <line class="kc-grid" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.y(tk.value)" :y2="layout.y(tk.value)" />
            <text :x="layout.left - 8" :y="layout.y(tk.value)" text-anchor="end" dominant-baseline="middle">{{ tk.label }}</text>
          </template>
          <line class="kc-baseline" :x1="layout.left" :x2="layout.left + layout.plotW" :y1="layout.top + layout.plotH" :y2="layout.top + layout.plotH" />
          <text
            v-for="b in bars"
            :key="'c' + b.i"
            :x="b.cx"
            :y="layout.top + layout.plotH + 14"
            text-anchor="middle"
            :style="{ fontFamily: 'var(--font-body)', fontSize: '11px', fill: 'var(--ink-2)' }"
          >
            <tspan v-for="(ln, k) in b.lines" :key="k" :x="b.cx" :dy="k ? 12 : 0">{{ ln }}</tspan>
          </text>
        </g>
        <g>
          <line
            v-for="c in connectors"
            :key="'k' + c.key"
            :x1="c.x1" :x2="c.x2" :y1="c.y" :y2="c.y"
            stroke-width="1" stroke-dasharray="3 3"
            :style="{ stroke: 'var(--ink-4)' }"
          />
          <rect
            v-for="b in bars"
            :key="'b' + b.i"
            class="kc-wf-bar"
            :x="b.x" :y="b.y" :width="layout.bw" :height="b.h" rx="3"
            :style="{ fill: b.color }"
          />
        </g>
        <g v-if="showValues" pointer-events="none">
          <text
            v-for="b in bars"
            :key="'v' + b.i"
            class="kc-tick"
            :x="b.cx" :y="b.labelY" text-anchor="middle"
            :style="{ fill: b.type === 'delta' ? b.color : 'var(--ink-1)', fontWeight: 600 }"
          >{{ b.text }}</text>
        </g>
      </svg>
      <ChartTooltip
        :visible="!!hovered"
        :x="hovered ? hovered.cx + layout.bw / 2 : 0"
        :y="hovered ? hovered.y + hovered.h / 2 : 0"
        :container-width="layout.W"
        :container-height="height"
      >
        <template v-if="hovered">
          <slot name="tooltip" :step="steps[hovered.i]" :cumulative="hovered.run">
            <div class="kc-tip-title">{{ hovered.label }}</div>
            <div class="kc-tip-row">
              <span class="kc-tip-key"><span class="kc-swatch" :style="{ background: hovered.color }" /></span>
              <span class="kc-tip-val">{{ hovered.text }}</span>
            </div>
            <div v-if="hovered.type === 'delta'" class="kc-tip-row">
              <span class="kc-tip-key">{{ t('charts.cumulative') }}</span>
              <span class="kc-tip-val">{{ fmtV(hovered.run) }}</span>
            </div>
            <div v-if="hovered.raw.note" class="kc-tip-sub" style="margin-top: 4px; white-space: normal">{{ hovered.raw.note }}</div>
          </slot>
        </template>
      </ChartTooltip>
    </div>
  </div>
</template>

<style>
.kc-wf-bar { transition: y 0.35s ease, height 0.35s ease, fill 0.2s ease; }
</style>
