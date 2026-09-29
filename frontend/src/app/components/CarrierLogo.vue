<script>
import { CARRIERS } from '@/shared/carriers.js'

// Built-in fallback (used when the carrier is not in the db / shared defaults).
export const CARRIER_FALLBACK = {
  FDX: { name: 'FedEx', color: '#4D148C', ink: '#FFFFFF', short: 'FX' },
  UPS: { name: 'UPS', color: '#351C15', ink: '#FFB500', short: 'UPS' },
  USPS: { name: 'USPS', color: '#004B87', ink: '#FFFFFF', short: 'USPS' },
  DHLE: { name: 'DHL eCommerce', color: '#FFCC00', ink: '#D40511', short: 'DHL' },
  ONT: { name: 'OnTrac', color: '#F26F21', ink: '#FFFFFF', short: 'OT' },
  LSO: { name: 'LSO', color: '#00558C', ink: '#FFFFFF', short: 'LSO' },
  DHLX: { name: 'DHL Express', color: '#FFCC00', ink: '#D40511', short: 'DHL' },
  EVRI: { name: 'Evri', color: '#0A3B85', ink: '#FFFFFF', short: 'EV' },
}

export function initials(name = '') {
  const words = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// Deterministic muted color for unknown codes.
export function hashColor(str = '') {
  let h = 0
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `oklch(0.42 0.09 ${h % 360})`
}
</script>

<script setup>
import { computed } from 'vue'
import { db } from '@/app/store/db.js'

const props = defineProps({
  code: { type: String, required: true },
  name: { type: String, default: '' },
  color: { type: String, default: '' },
  ink: { type: String, default: '' },
  label: { type: String, default: '' }, // text inside the square (defaults to short code)
  size: { type: [Number, String], default: 28 },
  showName: { type: Boolean, default: false },
  sub: { type: String, default: '' }, // secondary line under the name (e.g. service name)
})

const info = computed(() => {
  const code = String(props.code || '').toUpperCase()
  let rec = null
  try { if (db.ready) rec = db.get('carriers', code) || null } catch { rec = null }
  const shared = CARRIERS.find(c => c.code === code)
  const fb = CARRIER_FALLBACK[code]
  const name = props.name || rec?.name || shared?.name || fb?.name || code
  return {
    name,
    color: props.color || rec?.color || shared?.color || fb?.color || hashColor(code),
    ink: props.ink || rec?.ink || shared?.ink || fb?.ink || '#FFFFFF',
    short: props.label || fb?.short || (code.length <= 4 ? code : initials(name)),
  }
})
const px = computed(() => Number(props.size) || 28)
const fontSize = computed(() => {
  const len = info.value.short.length
  const f = len <= 2 ? 0.4 : len === 3 ? 0.34 : 0.27
  return Math.max(8, Math.round(px.value * f)) + 'px'
})
</script>

<template>
  <span class="kpz-carrier">
    <span
      class="cl-square"
      role="img"
      :aria-label="info.name"
      :title="showName ? undefined : info.name"
      :style="{ width: px + 'px', height: px + 'px', background: info.color, color: info.ink, fontSize, borderRadius: Math.max(5, Math.round(px * 0.22)) + 'px' }"
    >{{ info.short }}</span>
    <span v-if="showName" class="cl-text">
      <span class="cl-name">{{ info.name }}</span>
      <span v-if="sub" class="cl-sub">{{ sub }}</span>
    </span>
  </span>
</template>

<style scoped>
.kpz-carrier { display: inline-flex; align-items: center; gap: 10px; min-width: 0; vertical-align: middle; }
.cl-square {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; letter-spacing: -0.01em; line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.cl-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.cl-name { font-weight: 500; font-size: 13.5px; color: var(--ink-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cl-sub { font-size: 12px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
