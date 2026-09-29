<script>
// Marketplace / order channel logos, same square style as the landing Integrations section.
export const CHANNELS = {
  shopify: { name: 'Shopify', color: '#5E8E3E', ink: '#FFFFFF', short: 'S' },
  etsy: { name: 'Etsy', color: '#F1641E', ink: '#FFFFFF', short: 'Etsy' },
  amazon: { name: 'Amazon', color: '#FF9900', ink: '#131A22', short: 'a' },
  ebay: { name: 'eBay', color: '#E53238', ink: '#FFFFFF', short: 'eb' },
  woocommerce: { name: 'WooCommerce', color: '#7F54B3', ink: '#FFFFFF', short: 'Woo' },
  woo: { name: 'WooCommerce', color: '#7F54B3', ink: '#FFFFFF', short: 'Woo' },
  manual: { nameKey: 'components.channel.manual', color: 'var(--ink-2)', ink: '#FFFFFF', icon: 'edit' },
  api: { nameKey: 'components.channel.api', color: 'var(--ink-1)', ink: '#FFFFFF', icon: 'code' },
  csv: { nameKey: 'components.channel.csv', color: 'var(--ink-3)', ink: '#FFFFFF', icon: 'upload' },
}
</script>

<script setup>
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'
import { hashColor, initials } from './CarrierLogo.vue'

const props = defineProps({
  code: { type: String, required: true },
  name: { type: String, default: '' },
  color: { type: String, default: '' },
  ink: { type: String, default: '' },
  size: { type: [Number, String], default: 28 },
  showName: { type: Boolean, default: false },
  sub: { type: String, default: '' },
})
const { t } = useI18n()

const info = computed(() => {
  const key = String(props.code || '').toLowerCase()
  const c = CHANNELS[key] || {}
  const name = props.name || (c.nameKey ? t(c.nameKey) : c.name) || props.code
  return {
    name,
    color: props.color || c.color || hashColor(key),
    ink: props.ink || c.ink || '#FFFFFF',
    short: c.short || (c.icon ? '' : initials(name)),
    icon: c.icon || null,
  }
})
const px = computed(() => Number(props.size) || 28)
const fontSize = computed(() => {
  const len = info.value.short.length
  const f = len <= 1 ? 0.5 : len === 2 ? 0.4 : len === 3 ? 0.34 : 0.28
  return Math.max(8, Math.round(px.value * f)) + 'px'
})
</script>

<template>
  <span class="kpz-channel">
    <span
      class="ch-square"
      role="img"
      :aria-label="info.name"
      :title="showName ? undefined : info.name"
      :style="{ width: px + 'px', height: px + 'px', background: info.color, color: info.ink, fontSize, borderRadius: Math.max(5, Math.round(px * 0.24)) + 'px' }"
    >
      <Icon v-if="info.icon" :name="info.icon" :size="Math.round(px * 0.5)" />
      <template v-else>{{ info.short }}</template>
    </span>
    <span v-if="showName" class="ch-text">
      <span class="ch-name">{{ info.name }}</span>
      <span v-if="sub" class="ch-sub">{{ sub }}</span>
    </span>
  </span>
</template>

<style scoped>
.kpz-channel { display: inline-flex; align-items: center; gap: 10px; min-width: 0; vertical-align: middle; }
.ch-square {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; line-height: 1; letter-spacing: -0.01em;
}
.ch-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.ch-name { font-weight: 500; font-size: 13.5px; color: var(--ink-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-sub { font-size: 12px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
