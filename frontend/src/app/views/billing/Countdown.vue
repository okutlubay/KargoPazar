<script setup>
// Live countdown to a deadline ("12 g 4 sa 10 dk kaldı"), seconds shown during the last day.
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../../i18n/index.js'

const props = defineProps({ to: { type: String, default: null }, compact: { type: Boolean, default: false } })
const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))

const left = computed(() => (props.to ? new Date(props.to).getTime() - now.value : null))
const parts = computed(() => {
  const ms = Math.max(0, left.value ?? 0)
  const d = Math.floor(ms / 864e5)
  const h = Math.floor((ms % 864e5) / 36e5)
  const m = Math.floor((ms % 36e5) / 6e4)
  const s = Math.floor((ms % 6e4) / 1000)
  return { d, h, m, s }
})
const tone = computed(() => (left.value == null ? '' : left.value <= 0 ? 'over' : left.value < 3 * 864e5 ? 'soon' : ''))
const text = computed(() => {
  if (left.value == null) return '-'
  if (left.value <= 0) return t('billing.countdown.closed')
  const p = parts.value
  if (p.d >= 1) return t(props.compact ? 'billing.countdown.dh' : 'billing.countdown.dhm', p)
  return t('billing.countdown.hms', { h: p.h, m: String(p.m).padStart(2, '0'), s: String(p.s).padStart(2, '0') })
})
</script>

<template>
  <span class="cd num" :class="tone" :title="to ? new Date(to).toLocaleString() : ''">{{ text }}</span>
</template>

<style scoped>
.cd { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
.cd.soon { color: oklch(0.55 0.14 60); font-weight: 600; }
.cd.over { color: var(--ink-4); }
</style>
