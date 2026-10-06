<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  lb: { type: Number, default: null }, // always stored in lb
  units: { type: String, default: null }, // 'imperial' | 'metric' (default: user preference)
  digits: { type: Number, default: 1 },
  mono: { type: Boolean, default: true },
  alt: { type: Boolean, default: true }, // metric: show the lb equivalent in small text
})
const { fmt } = useI18n()
const text = computed(() => fmt.weight(props.lb, props.units || undefined, props.digits))
const altText = computed(() => (props.alt ? fmt.weightAlt(props.lb, props.units || undefined, props.digits) : ''))
</script>

<template>
  <span class="kpz-weight" :class="{ mono }">{{ text }}<small v-if="altText" class="kpz-alt">{{ altText }}</small></span>
</template>

<style scoped>
.kpz-weight { white-space: nowrap; font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); letter-spacing: -0.01em; }
.kpz-alt { margin-left: 4px; font-size: 0.78em; font-weight: 400; color: var(--ink-3); }
</style>
