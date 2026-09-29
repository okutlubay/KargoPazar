<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  value: { type: Number, default: 0 }, // 0-100
  label: { type: String, default: '' },
  showValue: { type: Boolean, default: false },
  indeterminate: { type: Boolean, default: false },
  // 'accent' | 'success' | 'warning' | 'danger' | 'ink'
  tone: { type: String, default: 'accent' },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg'
})
const { t, fmt } = useI18n()
const pct = computed(() => Math.max(0, Math.min(100, Number(props.value) || 0)))
const valueText = computed(() => t('common.progress', { n: fmt.number(pct.value, 0) }))
</script>

<template>
  <div class="kpz-progress" :class="['size-' + size, 'tone-' + tone]">
    <div v-if="label || showValue" class="pb-head">
      <span class="pb-label">{{ label }}</span>
      <span v-if="showValue && !indeterminate" class="mono pb-value">{{ valueText }}</span>
    </div>
    <div
      class="pb-track"
      role="progressbar"
      :aria-label="label || undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="indeterminate ? undefined : pct"
      :aria-valuetext="indeterminate ? undefined : valueText"
    >
      <div v-if="indeterminate" class="pb-bar pb-indet" />
      <div v-else class="pb-bar" :style="{ width: pct + '%' }" />
    </div>
  </div>
</template>

<style scoped>
.kpz-progress { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.pb-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12.5px; }
.pb-label { color: var(--ink-2); font-weight: 500; }
.pb-value { color: var(--ink-3); font-size: 11.5px; }
.pb-track { position: relative; width: 100%; background: var(--bg-3); border-radius: 999px; overflow: hidden; }
.size-sm .pb-track { height: 4px; }
.size-md .pb-track { height: 6px; }
.size-lg .pb-track { height: 10px; }
.pb-bar { height: 100%; border-radius: 999px; background: var(--pb-color); transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); }
.pb-indet { position: absolute; left: 0; top: 0; width: 35%; animation: kpz-indet 1.2s ease-in-out infinite; }
.tone-accent { --pb-color: var(--accent); }
.tone-success { --pb-color: var(--success); }
.tone-warning { --pb-color: var(--warning); }
.tone-danger { --pb-color: var(--danger); }
.tone-ink { --pb-color: var(--ink-1); }
@keyframes kpz-indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(290%); } }
</style>
