<script setup>
import { computed } from 'vue'
import './charts.css'
import { useI18n } from '@/app/i18n/index.js'
import { scoreColor } from './palette.js'
import { isFiniteNum, clamp, formatNumber } from './utils.js'

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  size: { type: Number, default: 64 },
  thickness: { type: Number, default: null },
  color: { type: String, default: 'var(--accent)' },
  thresholds: { type: Array, default: null },
  label: { type: String, default: null },
  sublabel: { type: String, default: '' },
  format: { type: Function, default: null },
  ariaLabel: { type: String, default: '' },
})

const { t, fmt, locale } = useI18n()

const frac = computed(() => (isFiniteNum(props.value) ? clamp(props.value / (props.max || 100), 0, 1) : 0))
const stroke = computed(() => props.thickness || Math.max(3, Math.round(props.size * 0.1)))
const R = computed(() => props.size / 2 - stroke.value / 2 - 1)
const col = computed(() => (props.thresholds ? scoreColor(frac.value * 100, props.thresholds) : props.color))
const text = computed(() => {
  if (props.label != null) return props.label
  if (!isFiniteNum(props.value)) return '-'
  if (props.format) return props.format(props.value)
  return props.max === 100 ? fmt.percent(frac.value, 0) : formatNumber(props.value, locale.value)
})
const aria = computed(() => props.ariaLabel || `${t('charts.chart')}: ${text.value}`)
</script>

<template>
  <div class="kc-root kc-ring" :style="{ width: size + 'px' }">
    <div class="kc-ring-fig" :style="{ width: size + 'px', height: size + 'px' }">
      <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" role="img" :aria-label="aria">
        <circle :cx="size / 2" :cy="size / 2" :r="R" fill="none" :stroke-width="stroke" :style="{ stroke: 'var(--bg-3)' }" />
        <circle
          :cx="size / 2" :cy="size / 2" :r="R" fill="none" :stroke-width="stroke"
          pathLength="100" stroke-dasharray="100 100" stroke-linecap="round"
          class="kc-ring-val"
          :transform="`rotate(-90 ${size / 2} ${size / 2})`"
          :style="{ stroke: col, strokeDashoffset: 100 - frac * 100, opacity: frac > 0 ? 1 : 0 }"
        />
      </svg>
      <div class="kc-ring-center">
        <slot :value="value" :fraction="frac">
          <span class="kc-ring-text" :style="{ fontSize: Math.max(10, Math.round(size * 0.22)) + 'px' }">{{ text }}</span>
        </slot>
      </div>
    </div>
    <div v-if="sublabel" class="kc-ring-sub">{{ sublabel }}</div>
  </div>
</template>

<style>
.kc-ring { display: inline-flex; flex-direction: column; align-items: center; flex: 0 0 auto; }
.kc-ring-fig { position: relative; }
.kc-ring-val { transition: stroke-dashoffset 0.7s cubic-bezier(0.2, 0.8, 0.2, 1), stroke 0.3s ease; }
.kc-ring-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; }
.kc-ring-text { font-family: var(--font-display); font-weight: 600; color: var(--ink-1); letter-spacing: -0.01em; line-height: 1; }
.kc-ring-sub { font-size: 11.5px; color: var(--ink-3); margin-top: 6px; text-align: center; white-space: nowrap; }
</style>
