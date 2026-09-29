<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import { useI18n } from '@/app/i18n/index.js'
import { scoreColor, alpha } from './palette.js'
import { useElementSize, isFiniteNum, arcPath, clamp, formatNumber } from './utils.js'

const props = defineProps({
  value: { type: Number, default: null },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  label: { type: String, default: '' },
  sublabel: { type: String, default: '' },
  thresholds: { type: Array, default: () => [70, 85] },
  size: { type: Number, default: 200 },
  thickness: { type: Number, default: null },
  color: { type: String, default: null },
  format: { type: Function, default: null },
  showZones: { type: Boolean, default: true },
  showScale: { type: Boolean, default: true },
  ariaLabel: { type: String, default: '' },
})

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)

const W = computed(() => Math.max(90, Math.min(props.size, width.value || props.size)))
const stroke = computed(() => props.thickness || Math.max(8, Math.round(W.value * 0.08)))
const R = computed(() => W.value / 2 - stroke.value / 2 - 2)
const cx = computed(() => W.value / 2)
const cy = computed(() => W.value / 2)
const H = computed(() => W.value / 2 + stroke.value / 2 + 4)

const hasValue = computed(() => isFiniteNum(props.value))
const frac = computed(() => (hasValue.value ? clamp((props.value - props.min) / ((props.max - props.min) || 1), 0, 1) : 0))
const col = computed(() => props.color || scoreColor(hasValue.value ? props.value : null, props.thresholds))
const text = computed(() => (!hasValue.value ? '-' : props.format ? props.format(props.value) : formatNumber(props.value, locale.value, 0)))

const HALF = Math.PI / 2
const angle = v => -HALF + clamp((v - props.min) / ((props.max - props.min) || 1), 0, 1) * Math.PI
const track = computed(() => arcPath(cx.value, cy.value, R.value, -HALF, HALF))
const zones = computed(() => {
  if (!props.showZones) return []
  const [a, b] = props.thresholds
  return [
    { key: 'lo', d: arcPath(cx.value, cy.value, R.value, -HALF, angle(a)), c: 'var(--danger)' },
    { key: 'mid', d: arcPath(cx.value, cy.value, R.value, angle(a), angle(b)), c: 'var(--warning)' },
    { key: 'hi', d: arcPath(cx.value, cy.value, R.value, angle(b), HALF), c: 'var(--success)' },
  ]
})
const tip = computed(() => {
  const a = -HALF + frac.value * Math.PI
  return { x: cx.value + R.value * Math.sin(a), y: cy.value - R.value * Math.cos(a) }
})
const aria = computed(() => props.ariaLabel || [props.label || t('charts.chart'), text.value].join(': '))
</script>

<template>
  <div ref="root" class="kc-root kc-gauge">
    <div class="kc-gauge-fig" :style="{ width: W + 'px' }">
      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="aria">
        <title>{{ aria }}</title>
        <path :d="track" fill="none" :stroke-width="stroke" stroke-linecap="round" :style="{ stroke: 'var(--bg-3)' }" />
        <path
          v-for="z in zones"
          :key="z.key"
          :d="z.d"
          fill="none"
          :stroke-width="stroke"
          :style="{ stroke: alpha(z.c, 0.18) }"
        />
        <path
          v-if="hasValue"
          :d="track"
          fill="none"
          pathLength="100"
          :stroke-width="stroke"
          stroke-linecap="round"
          stroke-dasharray="100 100"
          class="kc-gauge-val"
          :style="{ stroke: col, strokeDashoffset: 100 - frac * 100 }"
        />
        <circle
          v-if="hasValue"
          :cx="tip.x" :cy="tip.y" :r="stroke / 2 + 1.5" stroke-width="2.5"
          class="kc-gauge-knob"
          :style="{ fill: 'var(--surface)', stroke: col }"
        />
      </svg>
      <div class="kc-gauge-center">
        <div class="kc-gauge-num" :style="{ fontSize: Math.round(W * 0.16) + 'px' }">{{ text }}</div>
        <div v-if="label" class="kc-gauge-lbl">{{ label }}</div>
      </div>
      <div v-if="showScale" class="kc-gauge-scale">
        <span>{{ formatNumber(min, locale) }}</span><span>{{ formatNumber(max, locale) }}</span>
      </div>
    </div>
    <div v-if="sublabel" class="kc-gauge-sub">{{ sublabel }}</div>
  </div>
</template>

<style>
.kc-gauge { display: flex; flex-direction: column; align-items: center; }
.kc-gauge-fig { position: relative; }
.kc-gauge-val { transition: stroke-dashoffset 0.7s cubic-bezier(0.2, 0.8, 0.2, 1), stroke 0.3s ease; }
.kc-gauge-knob { transition: cx 0.7s cubic-bezier(0.2, 0.8, 0.2, 1), cy 0.7s cubic-bezier(0.2, 0.8, 0.2, 1); }
.kc-gauge-center { position: absolute; left: 0; right: 0; bottom: 4px; display: flex; flex-direction: column; align-items: center; pointer-events: none; }
.kc-gauge-num { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.02em; line-height: 1; color: var(--ink-1); }
.kc-gauge-lbl { font-size: 11.5px; color: var(--ink-3); margin-top: 4px; text-align: center; }
.kc-gauge-scale { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: var(--ink-4); padding: 2px 2px 0; }
.kc-gauge-sub { font-size: 12px; color: var(--ink-3); margin-top: 6px; text-align: center; max-width: 320px; }
</style>
