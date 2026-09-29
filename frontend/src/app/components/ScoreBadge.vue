<script>
export function scoreTone(score) {
  if (score == null || Number.isNaN(Number(score))) return 'neutral'
  if (score >= 85) return 'success'
  if (score >= 70) return 'warning'
  return 'danger'
}
</script>

<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  score: { type: Number, default: null }, // 0-100
  showLabel: { type: Boolean, default: false },
  label: { type: String, default: '' }, // override label text
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg'
})
const { t } = useI18n()
const tone = computed(() => scoreTone(props.score))
const value = computed(() => (props.score == null ? '-' : Math.round(props.score)))
const labelText = computed(() => props.label || t('components.score.' + (tone.value === 'neutral' ? 'none' : tone.value)))
</script>

<template>
  <span class="kpz-score" :class="['tone-' + tone, 'size-' + size]" :title="labelText" :aria-label="t('components.score.aria', { n: value, label: labelText })">
    <span class="mono sc-num">{{ value }}</span>
    <span v-if="showLabel" class="sc-label">{{ labelText }}</span>
  </span>
</template>

<style scoped>
.kpz-score {
  display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; white-space: nowrap;
  background: var(--sc-bg); color: var(--sc-ink); border: 1px solid var(--sc-line); font-weight: 600; line-height: 1;
}
.size-sm { height: 20px; padding: 0 7px; font-size: 11px; }
.size-md { height: 24px; padding: 0 9px; font-size: 12px; }
.size-lg { height: 32px; padding: 0 12px; font-size: 14px; }
.sc-num { font-weight: 600; }
.sc-label { font-weight: 500; font-family: var(--font-body); }
.tone-success { --sc-bg: oklch(0.96 0.04 155); --sc-ink: oklch(0.40 0.10 155); --sc-line: oklch(0.88 0.07 155); }
.tone-warning { --sc-bg: oklch(0.97 0.05 80); --sc-ink: oklch(0.45 0.10 65); --sc-line: oklch(0.89 0.09 80); }
.tone-danger { --sc-bg: oklch(0.96 0.03 25); --sc-ink: oklch(0.45 0.15 25); --sc-line: oklch(0.88 0.07 25); }
.tone-neutral { --sc-bg: var(--bg-3); --sc-ink: var(--ink-3); --sc-line: var(--line-1); }
</style>
