<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  value: { type: Object, default: null }, // { lengthIn, widthIn, heightIn } (always stored in inches)
  units: { type: String, default: null }, // 'imperial' | 'metric' (default: user preference)
  mono: { type: Boolean, default: true },
  alt: { type: Boolean, default: true }, // metric: show the inch equivalent in small text
})
const { fmt } = useI18n()
const text = computed(() => fmt.dims(props.value, props.units || undefined))
const altText = computed(() => (props.alt ? fmt.dimsAlt(props.value, props.units || undefined) : ''))
</script>

<template>
  <span class="kpz-dims" :class="{ mono }">{{ text }}<small v-if="altText" class="kpz-alt">{{ altText }}</small></span>
</template>

<style scoped>
.kpz-dims { white-space: nowrap; font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); letter-spacing: -0.01em; }
.kpz-alt { margin-left: 4px; font-size: 0.78em; font-weight: 400; color: var(--ink-3); }
</style>
