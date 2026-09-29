<script setup>
import { useI18n } from '@/app/i18n/index.js'

defineProps({
  size: { type: [Number, String], default: 16 },
  label: { type: String, default: '' },
})
const { t } = useI18n()
</script>

<template>
  <span class="kpz-spinner" role="status" :aria-label="label || t('common.loading')" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-opacity="0.2" stroke-width="1.8" />
      <path d="M14.2 8A6.2 6.2 0 0 0 8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  </span>
</template>

<style scoped>
.kpz-spinner { display: inline-flex; flex: none; color: currentColor; }
.kpz-spinner svg { animation: kpz-spin 0.8s linear infinite; }
@keyframes kpz-spin { to { transform: rotate(360deg); } }
</style>
