<script setup>
import { computed, useId } from 'vue'
import Icon from '@/components/Icon.vue'
import Skeleton from './Skeleton.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: null },
  // how to format a numeric value: 'number' | 'money' | 'percent' | 'weight' | fn(v) => string
  format: { type: [String, Function], default: 'number' },
  digits: { type: Number, default: null },
  delta: { type: Number, default: null }, // fraction, e.g. 0.124 = +12.4%
  deltaLabel: { type: String, default: '' }, // e.g. "önceki 30 güne göre"
  invert: { type: Boolean, default: false }, // true when a decrease is good (cost, exceptions)
  sparkline: { type: Array, default: null }, // [numbers]
  icon: { type: String, default: '' },
  hint: { type: String, default: '' }, // small text under the value
  loading: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  tone: { type: String, default: '' }, // '' | 'accent' | 'success' | 'warning' | 'danger' (sparkline/icon color)
})
const emit = defineEmits(['click'])
const { fmt } = useI18n()
const gid = 'spk' + useId().replace(/[^a-zA-Z0-9]/g, '')

const display = computed(() => {
  const v = props.value
  if (v == null || v === '') return '-'
  if (typeof v === 'string') return v
  if (typeof props.format === 'function') return props.format(v)
  switch (props.format) {
    case 'money': return fmt.money(v, 'USD', props.digits ?? 2)
    case 'percent': return fmt.percent(v, props.digits ?? 1)
    case 'weight': return fmt.weight(v, undefined, props.digits ?? 1)
    default: return fmt.number(v, props.digits ?? 0)
  }
})
const deltaDir = computed(() => (props.delta == null || Math.abs(props.delta) < 0.0005 ? 0 : props.delta > 0 ? 1 : -1))
const deltaGood = computed(() => (deltaDir.value === 0 ? null : (deltaDir.value > 0) !== props.invert))
const deltaText = computed(() => {
  if (props.delta == null) return ''
  const s = fmt.percent(Math.abs(props.delta), 1)
  return (deltaDir.value > 0 ? '+' : deltaDir.value < 0 ? '-' : '') + s
})

const W = 120, H = 36
const spark = computed(() => {
  const d = (props.sparkline || []).filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (d.length < 2) return null
  const min = Math.min(...d), max = Math.max(...d)
  const span = max - min || 1
  const pts = d.map((v, i) => [(i / (d.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  return { line, area: line + ` L${W} ${H} L0 ${H} Z`, last: pts[pts.length - 1] }
})
const sparkColor = computed(() => {
  if (props.tone) return `var(--${props.tone === 'accent' ? 'accent' : props.tone})`
  if (deltaGood.value === false) return 'var(--danger)'
  return 'var(--accent)'
})

function onClick() { if (props.clickable) emit('click') }
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="kpz-kpi card"
    :class="{ clickable }"
    @click="onClick"
  >
    <div class="kp-head">
      <span class="kp-label">{{ label }}</span>
      <Icon v-if="icon" :name="icon" :size="15" class="kp-icon" :style="tone ? { color: sparkColor } : null" />
    </div>
    <template v-if="loading">
      <Skeleton variant="rect" width="60%" :height="28" :radius="6" />
      <Skeleton variant="rect" width="40%" :height="12" :radius="4" />
    </template>
    <template v-else>
      <div class="kp-main">
        <div class="kp-value">{{ display }}</div>
        <svg v-if="spark" class="kp-spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" :stop-color="sparkColor" stop-opacity="0.18" />
              <stop offset="100%" :stop-color="sparkColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="spark.area" :fill="`url(#${gid})`" />
          <path :d="spark.line" fill="none" :stroke="sparkColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
      </div>
      <div v-if="delta != null || deltaLabel || hint" class="kp-foot">
        <span v-if="delta != null" class="mono kp-delta" :class="deltaGood === null ? 'flat' : deltaGood ? 'good' : 'bad'">
          <Icon v-if="deltaDir" :name="deltaDir > 0 ? 'chevron-up' : 'chevron-down'" :size="11" />
          {{ deltaText }}
        </span>
        <span v-if="deltaLabel" class="kp-dl">{{ deltaLabel }}</span>
        <span v-if="hint" class="kp-dl">{{ hint }}</span>
      </div>
    </template>
  </component>
</template>

<style scoped>
.kpz-kpi {
  display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; min-width: 0; text-align: left; width: 100%;
  font: inherit; color: inherit; transition: box-shadow 0.15s, border-color 0.15s, transform 0.15s;
}
.kpz-kpi.clickable { cursor: pointer; }
.kpz-kpi.clickable:hover { border-color: var(--line-2); box-shadow: var(--shadow-md); }
.kpz-kpi:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.kp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kp-label { font-size: 12.5px; font-weight: 500; color: var(--ink-3); }
.kp-icon { color: var(--ink-4); flex: none; }
.kp-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; min-height: 36px; }
.kp-value { font-family: var(--font-display); font-weight: 600; font-size: 26px; letter-spacing: -0.02em; line-height: 1.1; color: var(--ink-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.kp-spark { width: 96px; height: 34px; flex: none; overflow: visible; }
.kp-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.kp-delta { display: inline-flex; align-items: center; gap: 2px; font-size: 11.5px; font-weight: 600; padding: 1px 6px; border-radius: 5px; }
.kp-delta.good { color: oklch(0.42 0.11 155); background: oklch(0.96 0.04 155); }
.kp-delta.bad { color: oklch(0.47 0.16 25); background: oklch(0.96 0.03 25); }
.kp-delta.flat { color: var(--ink-3); background: var(--bg-3); }
.kp-dl { color: var(--ink-3); }
@media (max-width: 560px) { .kp-spark { width: 72px; } .kp-value { font-size: 22px; } }
</style>
