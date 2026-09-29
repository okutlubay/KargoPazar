<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import { useI18n } from '@/app/i18n/index.js'
import { seriesColor, statusColor, alpha } from './palette.js'
import { useElementSize, textWidth, clamp } from './utils.js'

const props = defineProps({
  months: { type: Number, default: 24 },
  bars: { type: Array, default: () => [] },
  current: { type: Number, default: null },
  currentLabel: { type: String, default: null },
  showTicks: { type: Boolean, default: true },
  showLabels: { type: Boolean, default: true },
  showGrid: { type: Boolean, default: true },
  rowHeight: { type: Number, default: 16 },
  laneGap: { type: Number, default: 4 },
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['select', 'hover'])

const { t } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)

const M = computed(() => Math.max(1, Math.round(props.months)))
const monthLabel = n => t('charts.monthShort', { n })

const tickEvery = computed(() => {
  const per = (width.value || 600) / M.value
  const need = textWidth(monthLabel(M.value), 10) + 8
  return [1, 2, 3, 4, 6, 12].find(k => per * k >= need) || 12
})
const ticks = computed(() => {
  const out = []
  for (let n = 1; n <= M.value; n++) {
    if ((n - 1) % tickEvery.value === 0) out.push(n)
  }
  return out
})

const laid = computed(() => {
  const list = props.bars.map((b, i) => {
    const from = clamp(Math.round(Math.min(b.from, b.to)), 1, M.value)
    const to = clamp(Math.round(Math.max(b.from, b.to)), 1, M.value)
    return { ...b, _i: i, from, to, key: b.key ?? i }
  }).sort((a, b) => a.from - b.from || a.to - b.to)
  const laneEnds = []
  for (const b of list) {
    let lane = laneEnds.findIndex(end => end < b.from)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.to) } else laneEnds[lane] = b.to
    b.lane = lane
  }
  return { list, lanes: Math.max(1, laneEnds.length) }
})

const trackHeight = computed(() => laid.value.lanes * props.rowHeight + (laid.value.lanes - 1) * props.laneGap)

function barStyle(b) {
  const left = ((b.from - 1) / M.value) * 100
  const w = ((b.to - b.from + 1) / M.value) * 100
  const base = b.color || (b.status ? statusColor(b.status) : seriesColor(0))
  const planned = b.status === 'planned'
  return {
    left: `calc(${left}% + 1px)`,
    width: `calc(${w}% - 2px)`,
    top: b.lane * (props.rowHeight + props.laneGap) + 'px',
    height: props.rowHeight + 'px',
    background: planned
      ? `repeating-linear-gradient(135deg, ${alpha(base, 0.18)} 0 6px, ${alpha(base, 0.32)} 6px 12px)`
      : base,
    border: planned ? `1px solid ${alpha(base, 0.6)}` : '0',
    color: planned ? 'var(--ink-1)' : '#fff',
  }
}
const labelFits = b => props.showLabels && b.label &&
  ((b.to - b.from + 1) / M.value) * (width.value || 0) > textWidth(b.label, 11) + 12

const currentLeft = computed(() => {
  if (props.current == null) return null
  const c = clamp(props.current, 1, M.value)
  return ((c - 0.5) / M.value) * 100
})

const hover = ref(null)
function enter(e, b) {
  const box = root.value.getBoundingClientRect()
  const r = e.currentTarget.getBoundingClientRect()
  hover.value = {
    ...b, x: clamp(e.clientX - box.left, r.left - box.left, r.right - box.left), y: r.top - box.top + r.height / 2,
    range: b.from === b.to ? monthLabel(b.from) : t('charts.monthRange', { from: b.from, to: b.to }),
  }
  emit('hover', props.bars[b._i])
}
function leave() { hover.value = null; emit('hover', null) }
const aria = computed(() => props.ariaLabel ||
  [t('charts.chart'), ...laid.value.list.map(b => `${b.label} ${t('charts.monthRange', { from: b.from, to: b.to })}`)].join(', '))
</script>

<template>
  <div
    ref="root"
    class="kc-root kc-gantt"
    role="img"
    :aria-label="aria"
    :style="{ paddingTop: current != null && showTicks ? '18px' : '2px' }"
  >
    <div class="kc-gantt-track" :style="{ height: trackHeight + 'px' }">
      <template v-if="showGrid">
        <div
          v-for="n in M"
          :key="'g' + n"
          class="kc-gantt-col"
          :class="{ alt: n % 2 === 0 }"
          :style="{ left: ((n - 1) / M) * 100 + '%', width: (1 / M) * 100 + '%' }"
        />
      </template>
      <div
        v-for="b in laid.list"
        :key="b.key"
        class="kc-gantt-bar"
        :class="['st-' + (b.status || 'none'), { on: hover && hover.key === b.key }]"
        :style="barStyle(b)"
        @mouseenter="enter($event, b)"
        @mouseleave="leave"
        @click="emit('select', bars[b._i])"
      >
        <span v-if="labelFits(b)" class="kc-gantt-label">{{ b.label }}</span>
      </div>
      <div v-if="currentLeft != null" class="kc-gantt-now" :style="{ left: currentLeft + '%' }">
        <span v-if="showTicks" class="kc-gantt-now-lbl">{{ currentLabel ?? t('charts.current') }}</span>
      </div>
    </div>
    <div v-if="showTicks" class="kc-gantt-ticks">
      <span
        v-for="n in ticks"
        :key="'t' + n"
        class="kc-gantt-tick"
        :class="{ cur: current === n }"
        :style="{ left: ((n - 0.5) / M) * 100 + '%' }"
      >{{ monthLabel(n) }}</span>
    </div>
    <ChartTooltip
      :visible="!!hover"
      :x="hover ? hover.x : 0"
      :y="hover ? hover.y : 0"
      :container-width="width"
      :offset="12"
    >
      <template v-if="hover">
        <slot name="tooltip" :bar="bars[hover._i]">
          <div v-if="hover.label" class="kc-tip-title" style="white-space: normal">{{ hover.label }}</div>
          <div class="kc-tip-row">
            <span class="kc-tip-key"><span class="kc-swatch" :style="{ background: hover.color || (hover.status ? statusColor(hover.status) : seriesColor(0)) }" />{{ hover.range }}</span>
          </div>
          <div v-if="hover.tooltip" class="kc-tip-sub" style="white-space: normal">{{ hover.tooltip }}</div>
        </slot>
      </template>
    </ChartTooltip>
  </div>
</template>

<style>
.kc-gantt { padding-top: 2px; }
.kc-gantt-track { position: relative; width: 100%; }
.kc-gantt-col { position: absolute; top: -2px; bottom: -2px; border-left: 1px solid var(--line-1); }
.kc-gantt-col.alt { background: color-mix(in oklch, var(--bg-2) 70%, transparent); }
.kc-gantt-col:last-of-type { border-right: 1px solid var(--line-1); }
.kc-gantt-bar {
  position: absolute; border-radius: 4px; display: flex; align-items: center; overflow: hidden;
  padding: 0 6px; box-sizing: border-box; cursor: default;
  transition: left 0.3s ease, width 0.3s ease, box-shadow 0.12s ease, filter 0.12s ease;
}
.kc-gantt-bar.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--ink-2); z-index: 1; }
.kc-gantt-bar.st-active { background-image: linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0) 100%) !important; background-size: 200% 100%; animation: kcGanttShine 2.4s linear infinite; }
.kc-gantt-label { font-size: 10.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kc-gantt-now { position: absolute; top: -6px; bottom: -6px; width: 0; border-left: 1.5px dashed var(--danger); z-index: 2; pointer-events: none; }
.kc-gantt-now-lbl {
  position: absolute; top: -16px; left: 0; transform: translateX(-50%); font-family: var(--font-mono);
  font-size: 9.5px; color: var(--danger); white-space: nowrap; letter-spacing: 0.04em;
}
.kc-gantt-ticks { position: relative; height: 18px; margin-top: 6px; }
.kc-gantt-tick {
  position: absolute; top: 0; transform: translateX(-50%); font-family: var(--font-mono);
  font-size: 10px; color: var(--ink-3); white-space: nowrap;
}
.kc-gantt-tick.cur { color: var(--danger); font-weight: 600; }
@keyframes kcGanttShine { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .kc-gantt-bar.st-active { animation: none; } }
</style>
