<script setup>
// "Fark: +2 lb, +$4.20" weight difference card (spec 5.9).
import Icon from '@/components/Icon.vue'
import { t, fmt } from '../../i18n/index.js'

defineProps({
  lb: { type: Number, required: true },
  amount: { type: Number, required: true },
  wallet: { type: Boolean, default: true },
  preview: { type: Boolean, default: false },
  adjustmentId: { type: String, default: null },
  balance: { type: Number, default: null },
})
</script>

<template>
  <div class="diff" data-testid="ops-diff" :class="{ preview }" role="status">
    <Icon name="scale" :size="18" class="ic" />
    <div class="body">
      <div class="line">{{ t('ops.diff.label') }}: <strong>+{{ fmt.number(lb, 0) }} lb, +{{ fmt.money(amount) }}</strong></div>
      <div class="desc">
        <template v-if="preview">{{ wallet ? t('ops.diff.previewWallet') : t('ops.diff.previewCarrier') }}</template>
        <template v-else>
          {{ wallet ? t('ops.diff.charged', { balance: balance != null ? fmt.money(balance) : '-' }) : t('ops.diff.carrier') }}
          <RouterLink v-if="adjustmentId" :to="{ path: '/billing', query: { tab: 'adjustments', id: adjustmentId } }" class="link">{{ adjustmentId }}</RouterLink>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-md); background: oklch(0.96 0.06 80); color: oklch(0.38 0.1 65); border: 1px solid oklch(0.88 0.08 80); }
.diff.preview { background: oklch(0.97 0.04 80); border-style: dashed; }
.ic { margin-top: 2px; flex: 0 0 auto; }
.line { font-size: 14px; }
.line strong { font-family: var(--font-display); font-size: 16px; }
.desc { font-size: 12.5px; margin-top: 2px; opacity: .9; }
</style>
