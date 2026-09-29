<script setup>
import { ref, computed } from 'vue'
import './charts.css'
import ChartTooltip from './ChartTooltip.vue'
import { useI18n } from '@/app/i18n/index.js'
import { statusColor } from './palette.js'
import { useElementSize, isFiniteNum, formatNumber } from './utils.js'

const props = defineProps({
  data: { type: Array, default: () => [] },
  height: { type: Number, default: 28 },
  gap: { type: Number, default: 3 },
  max: { type: Number, default: null },
  min: { type: Number, default: 0 },
  color: { type: String, default: 'var(--accent)' },
  format: { type: Function, default: null },
  radius: { type: Number, default: 2 },
  minBarHeight: { type: Number, default: 3 },
  ariaLabel: { type: String, default: '' },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['select', 'hover'])

const { t, locale } = useI18n()
const root = ref(null)
const { width } = useElementSize(root)

const fmtV = v => (props.format ? props.format(v) : formatNumber(v, locale.value))
const hasValues = computed(() => props.data.some(d => isFiniteNum(Number(d?.value)) && d?.value != null))
const maxV = computed(() => props.max ?? Math.max(0, ...props.data.map(d => Number(d?.value)).filter(isFiniteNum)))

const bars = computed(() => props.data.map((d, i) => {
  const v = d && d.value != null ? Number(d.value) : null
  let h = 1
  if (hasValues.value) {
    const span = (maxV.value - props.min) || 1
    h = isFiniteNum(v) ? Math.max(0, Math.min(1, (v - props.min) / span)) : 0
  }
  const color = d?.color || (d?.status ? statusColor(d.status) : props.color)
  return {
    i, h, color, value: v, label: d?.label ?? '',
    text: d?.tooltip ?? (isFiniteNum(v) ? fmtV(v) : ''),
    empty: hasValues.value ? !isFiniteNum(v) : false,
  }
}))

const hover = ref(null)
function enter(e, b) {
  const box = root.value.getBoundingClientRect()
  const r = e.currentTarget.getBoundingClientRect()
  hover.value = { ...b, x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }
  emit('hover', props.data[b.i])
}
function leave() { hover.value = null; emit('hover', null) }
const aria = computed(() => props.ariaLabel || t('charts.chart'))
</script>

<template>
  <div ref="root" class="kc-root kc-minibars">
    <div v-if="!data.length" class="kc-empty" :style="{ height: Math.max(28, height) + 'px', padding: '4px' }">{{ emptyText || t('charts.noData') }}</div>
    <div
      v-else
      class="kc-mb-strip"
      :style="{ height: height + 'px', gap: (width && width / data.length < 6 ? 1 : gap) + 'px' }"
      role="img"
      :aria-label="aria"
    >
      <div
        v-for="b in bars"
        :key="b.i"
        class="kc-mb-cell"
        :class="{ on: hover && hover.i === b.i }"
        @mouseenter="enter($event, b)"
        @mouseleave="leave"
        @click="emit('select', data[b.i], b.i)"
      >
        <div
          class="kc-mb-bar"
          :class="{ empty: b.empty }"
          :style="{
            height: b.empty ? '100%' : `max(${minBarHeight}px, ${b.h * 100}%)`,
            background: b.empty ? 'var(--bg-3)' : b.color,
            borderRadius: radius + 'px',
          }"
        />
      </div>
    </div>
    <ChartTooltip
      :visible="!!hover && !!(hover.label || hover.text)"
      :x="hover ? hover.x : 0"
      :y="hover ? hover.y : 0"
      :container-width="width"
      :offset="10"
    >
      <template v-if="hover">
        <slot name="tooltip" :item="data[hover.i]" :index="hover.i">
          <div v-if="hover.label" class="kc-tip-title" style="margin-bottom: 2px">{{ hover.label }}</div>
          <div v-if="hover.text" class="kc-tip-row">
            <span class="kc-tip-key"><span class="kc-swatch" :style="{ background: hover.color }" /></span>
            <span class="kc-tip-val">{{ hover.text }}</span>
          </div>
        </slot>
      </template>
    </ChartTooltip>
  </div>
</template>

<style>
.kc-mb-strip { display: flex; align-items: stretch; width: 100%; }
.kc-mb-cell { flex: 1 1 0; min-width: 1px; display: flex; align-items: flex-end; cursor: default; }
.kc-mb-bar { width: 100%; transition: height 0.3s ease, background 0.2s ease, opacity 0.15s ease; }
.kc-mb-strip:hover .kc-mb-cell:not(.on) .kc-mb-bar { opacity: 0.55; }
.kc-minibars .kc-tip { min-width: 0; }
</style>
