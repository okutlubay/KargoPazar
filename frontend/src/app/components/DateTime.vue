<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  value: { type: [String, Number, Date], default: null },
  // 'relative' (default, absolute in tooltip) | 'absolute' | 'date' | 'short'
  mode: { type: String, default: 'relative' },
})
const { fmt } = useI18n()
const iso = computed(() => {
  if (props.value == null || props.value === '') return null
  const d = props.value instanceof Date ? props.value : new Date(props.value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
})
const absolute = computed(() => fmt.dateTime(iso.value))
const text = computed(() => {
  if (!iso.value) return '-'
  if (props.mode === 'absolute') return absolute.value
  if (props.mode === 'date') return fmt.date(iso.value)
  if (props.mode === 'short') return fmt.shortDate(iso.value)
  return fmt.relative(iso.value)
})
</script>

<template>
  <time class="kpz-datetime" :datetime="iso || undefined" :title="iso && mode !== 'absolute' ? absolute : undefined">{{ text }}</time>
</template>

<style scoped>
.kpz-datetime { white-space: nowrap; }
</style>
