<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import { useI18n } from '@/app/i18n/index.js'
import { seriesColor } from './palette.js'
import { useElementSize, isFiniteNum, formatNumber, ringSlice } from './utils.js'

const props = defineProps({
  data: { type: Array, default: () => [] },
  size: { type: Number, default: 180 },
  thickness: { type: Number, default: null },
  legend: { type: Boolean, default: true },
  legendPosition: { type: String, default: 'auto' },
  valueFormat: { type: Function, default: null },
  centerLabel: { type: String, default: null },
  centerValue: { type: String, default: null },
  showValues: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['select', 'hover'])

const { t, fmt, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)
const active = ref(null)

const fmtV = v => (props.valueFormat ? props.valueFormat(v) : formatNumber(v, locale.value))

const items = computed(() => {
  const rows = props.data.map((d, i) => ({
    key: d.key ?? 'd' + i, label: d.label ?? '', value: Math.max(0, Number(d.value) || 0), color: seriesColor(i, d.color), raw: d,
  }))
  const total = rows.reduce((a, r) => a + r.value, 0)
  return { rows: rows.map(r => ({ ...r, pct: total ? r.value / total : 0 })), total }
})
const isEmpty = computed(() => !(items.value.total > 0))

const stacked = computed(() => {
  if (props.legendPosition === 'bottom') return true
  if (props.legendPosition === 'right') return false
  return width.value > 0 && width.value < props.size + 190
})
const diameter = computed(() => Math.max(60, Math.min(props.size, width.value || props.size)))
const ring = computed(() => props.thickness || Math.max(10, Math.round(diameter.value * 0.15)))

const slices = computed(() => {
  const D = diameter.value, c = D / 2, rO = c - 2, rI = rO - ring.value
  const { rows, total } = items.value
  const nonZero = rows.filter(r => r.value > 0).length
  const pad = nonZero > 1 ? 0.012 : 0
  let a = 0
  return rows.map(r => {
    const span = total ? (r.value / total) * Math.PI * 2 : 0
    const a0 = a + pad / 2, a1 = a + span - pad / 2
    a += span
    if (r.value <= 0 || a1 <= a0) return null
    return { ...r, d: ringSlice(c, c, rO, rI, a0, a1), dHover: ringSlice(c, c, rO + 2, rI, a0, a1) }
  }).filter(Boolean)
})

const activeItem = computed(() => items.value.rows.find(r => r.key === active.value) || null)
const pctText = p => fmt.percent(p, p < 0.1 && p > 0 ? 1 : 0)

function setActive(key) {
  active.value = key
  const it = items.value.rows.find(r => r.key === key)
  emit('hover', it ? it.raw : null)
}

const aria = computed(() => props.ariaLabel ||
  [t('charts.chart'), ...items.value.rows.map(r => `${r.label} ${pctText(r.pct)}`)].join(', '))
</script>

<template>
  <div ref="root" class="kc-root kc-donut" :class="{ stacked }">
    <div v-if="isEmpty" class="kc-empty" :style="{ height: size + 'px' }">{{ emptyText || t('charts.noData') }}</div>
    <template v-else>
      <div class="kc-donut-figure" :style="{ width: diameter + 'px', height: diameter + 'px' }">
        <svg :width="diameter" :height="diameter" :viewBox="`0 0 ${diameter} ${diameter}`" role="img" :aria-label="aria">
          <path
            v-for="s in slices"
            :key="s.key"
            class="kc-anim kc-donut-slice"
            :class="{ 'kc-dim': active && active !== s.key }"
            :d="active === s.key ? s.dHover : s.d"
            :style="{ fill: s.color }"
            @mouseenter="setActive(s.key)"
            @mouseleave="setActive(null)"
            @click="emit('select', s.raw)"
          />
        </svg>
        <div class="kc-donut-center" :style="{ padding: ring + 6 + 'px' }">
          <slot name="center" :total="items.total" :active="activeItem">
            <template v-if="activeItem">
              <div class="kc-donut-val">{{ pctText(activeItem.pct) }}</div>
              <div class="kc-donut-lbl">{{ activeItem.label }}</div>
            </template>
            <template v-else>
              <div class="kc-donut-val">{{ centerValue ?? fmtV(items.total) }}</div>
              <div class="kc-donut-lbl">{{ centerLabel ?? t('charts.total') }}</div>
            </template>
          </slot>
        </div>
      </div>
      <ul v-if="legend" class="kc-donut-legend">
        <li
          v-for="r in items.rows"
          :key="r.key"
          :class="{ 'kc-dim': active && active !== r.key }"
          class="kc-fade"
          @mouseenter="setActive(r.key)"
          @mouseleave="setActive(null)"
          @click="emit('select', r.raw)"
        >
          <span class="kc-swatch" :style="{ background: r.color }" />
          <span class="kc-donut-name">{{ r.label }}</span>
          <span v-if="showValues" class="kc-donut-num">{{ fmtV(r.value) }}</span>
          <span class="kc-donut-pct">{{ pctText(r.pct) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style>
.kc-donut { display: flex; align-items: center; gap: 24px; }
.kc-donut.stacked { flex-direction: column; align-items: center; gap: 14px; }
.kc-donut-figure { position: relative; flex: 0 0 auto; }
.kc-donut-slice { cursor: pointer; transition: opacity 0.18s ease, d 0.18s ease; }
.kc-donut-center {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; pointer-events: none; min-width: 0;
}
.kc-donut-val { font-family: var(--font-display); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; color: var(--ink-1); line-height: 1.15; }
.kc-donut-lbl { font-size: 11.5px; color: var(--ink-3); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kc-donut-legend { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-width: 0; width: 100%; display: flex; flex-direction: column; gap: 4px; }
.kc-donut-legend li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 3px 6px; border-radius: 6px; cursor: pointer; }
.kc-donut-legend li:hover { background: var(--bg-2); }
.kc-donut-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
.kc-donut-num { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3); }
.kc-donut-pct { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-1); font-weight: 500; min-width: 40px; text-align: right; }
</style>
