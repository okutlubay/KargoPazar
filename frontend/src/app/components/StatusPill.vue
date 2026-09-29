<script>
// Single color map for every status code in i18n `status.*`.
// Tones: success (green), warning (amber), danger (red), info (accent/blue), neutral (gray).
export const STATUS_TONES = {
  // success
  delivered: 'success', completed: 'success', success: 'success', shipped: 'success', connected: 'success',
  active: 'success', approved: 'success', cleared: 'success', passed: 'success', paid: 'success',
  operational: 'success', live: 'success',
  // warning / pending
  awaiting_shipment: 'warning', on_hold: 'warning', pending: 'warning', warning: 'warning', disputed: 'warning',
  reviewing: 'warning', suggested: 'warning', due: 'warning', degraded: 'warning', pending_review: 'warning',
  invited: 'warning', returned: 'warning', test: 'warning',
  // danger
  exception: 'danger', voided: 'danger', cancelled: 'danger', failed: 'danger', error: 'danger',
  rejected: 'danger', down: 'danger', revoked: 'danger',
  // in progress
  in_transit: 'info', out_for_delivery: 'info', label_created: 'info', labeled: 'info', created: 'info',
  handed_over: 'info', submitted: 'info', running: 'info',
  // neutral
  draft: 'neutral', inactive: 'neutral', disconnected: 'neutral', skipped: 'neutral', expired: 'neutral',
  waived: 'neutral', replaced: 'neutral', charged: 'neutral',
}

export function statusTone(status) {
  return STATUS_TONES[status] || 'neutral'
}
</script>

<script setup>
import { computed } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  status: { type: String, required: true },
  label: { type: String, default: '' },
  size: { type: String, default: 'md' }, // 'sm' | 'md'
  tone: { type: String, default: '' }, // override tone
  dot: { type: Boolean, default: true },
})
const { t } = useI18n()
const resolvedTone = computed(() => props.tone || statusTone(props.status))
const text = computed(() => {
  if (props.label) return props.label
  const v = t('status.' + props.status)
  return typeof v === 'string' && v !== 'status.' + props.status ? v : props.status
})
</script>

<template>
  <span class="kpz-status" :class="['tone-' + resolvedTone, 'size-' + size]">
    <span v-if="dot" class="st-dot" :class="{ 'pulse': resolvedTone === 'info' && status === 'running' }" aria-hidden="true" />
    <span class="st-text">{{ text }}</span>
  </span>
</template>

<style scoped>
.kpz-status {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  border-radius: 999px; font-weight: 500; white-space: nowrap; line-height: 1;
  background: var(--st-bg); color: var(--st-ink); border: 1px solid var(--st-line);
}
.size-md { height: 24px; padding: 0 9px; font-size: 12px; }
.size-sm { height: 20px; padding: 0 7px; font-size: 11px; gap: 5px; }
.st-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--st-dot); flex: none; }
.st-text { overflow: hidden; text-overflow: ellipsis; }
.tone-success { --st-bg: oklch(0.96 0.04 155); --st-ink: oklch(0.40 0.10 155); --st-line: oklch(0.90 0.06 155); --st-dot: var(--success); }
.tone-warning { --st-bg: oklch(0.97 0.05 80); --st-ink: oklch(0.45 0.10 65); --st-line: oklch(0.91 0.08 80); --st-dot: var(--warning); }
.tone-danger { --st-bg: oklch(0.96 0.03 25); --st-ink: oklch(0.45 0.15 25); --st-line: oklch(0.90 0.06 25); --st-dot: var(--danger); }
.tone-info { --st-bg: var(--accent-soft); --st-ink: var(--accent-ink); --st-line: oklch(0.90 0.06 268); --st-dot: var(--accent); }
.tone-neutral { --st-bg: var(--bg-3); --st-ink: var(--ink-2); --st-line: var(--line-1); --st-dot: var(--ink-4); }
</style>
