<script setup>
// Small card brand mark (visa, mastercard, amex, discover, null = generic card).
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps({ brand: { type: String, default: null }, size: { type: String, default: 'md' } })
const LABEL = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', discover: 'DISC' }
const label = computed(() => LABEL[props.brand] ?? null)
</script>

<template>
  <span class="cb" :class="[brand ? `cb-${brand}` : 'cb-none', `cb-${size}`]" :aria-label="brand || 'card'">
    <template v-if="brand === 'mastercard'"><i class="c1" /><i class="c2" /></template>
    <template v-else-if="label">{{ label }}</template>
    <Icon v-else name="card" :size="14" />
  </span>
</template>

<style scoped>
.cb { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 38px; height: 26px; border-radius: 5px; font-family: var(--font-display); font-weight: 800; font-size: 10.5px; letter-spacing: .02em; color: white; position: relative; overflow: hidden; }
.cb-sm { width: 30px; height: 20px; font-size: 8.5px; }
.cb-visa { background: #1a1f71; font-style: italic; }
.cb-amex { background: #2e77bb; font-size: 9px; }
.cb-discover { background: #e97a1f; font-size: 9px; }
.cb-mastercard { background: #222; }
.cb-none { background: var(--bg-3); color: var(--ink-3); }
.c1, .c2 { position: absolute; width: 14px; height: 14px; border-radius: 50%; top: 50%; transform: translateY(-50%); }
.cb-sm .c1, .cb-sm .c2 { width: 11px; height: 11px; }
.c1 { background: #eb001b; left: calc(50% - 11px); }
.c2 { background: #f79e1b; left: calc(50% - 3px); mix-blend-mode: screen; opacity: .95; }
</style>
