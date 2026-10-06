<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  value: { type: Number, default: null },
  // Currency of `value`. USD amounts are converted to the display currency (topbar selector)
  // unless convert is false; other currencies are shown as they are (customs local values).
  currency: { type: String, default: 'USD' },
  convert: { type: Boolean, default: true },
  digits: { type: Number, default: 2 },
  signed: { type: Boolean, default: false }, // prefix "+" for positive values
  colored: { type: Boolean, default: false }, // green positive / red negative
  mono: { type: Boolean, default: true },
})
const { fmt } = useI18n()
const text = computed(() => {
  const s = props.convert ? fmt.money(props.value, props.currency, props.digits) : fmt.moneyNative(props.value, props.currency, props.digits)
  return props.signed && props.value > 0 ? '+' + s : s
})
const tone = computed(() => {
  if (!props.colored || !props.value) return ''
  return props.value > 0 ? 'pos' : 'neg'
})
</script>

<template>
  <span class="kpz-money" :class="[tone, { mono }]">{{ text }}</span>
</template>

<style scoped>
.kpz-money { white-space: nowrap; font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); letter-spacing: -0.01em; }
.pos { color: oklch(0.48 0.12 155); }
.neg { color: var(--danger); }
</style>
