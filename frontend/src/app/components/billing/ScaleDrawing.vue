<script setup>
// Measurement drawing used instead of a scale photo (spec 3.9 photoPlaceholder, 5.9, 5.10):
// parcel on a platform scale with the measured dimensions and the digital weight readout.
//   <ScaleDrawing :measured="{ weightLb, lengthIn, widthIn, heightIn }" :declared="{...}" :hub="'NJ01'" />
import { computed } from 'vue'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({
  measured: { type: Object, default: null },
  declared: { type: Object, default: null },
  hub: { type: String, default: '' },
  at: { type: String, default: '' },
  reading: { type: Boolean, default: false },
  height: { type: Number, default: 190 },
})

const m = computed(() => props.measured ?? props.declared ?? {})
const dims = computed(() => ({ l: Number(m.value.lengthIn) || 12, w: Number(m.value.widthIn) || 10, h: Number(m.value.heightIn) || 6 }))
// box geometry: isometric-ish, scaled to fit
const box = computed(() => {
  const { l, w, h } = dims.value
  const s = Math.min(120 / (l + w * 0.5), 70 / (h + w * 0.35), 7)
  const bw = l * s, bh = h * s, dx = w * s * 0.5, dy = w * s * 0.35
  const x = 150 - (bw + dx) / 2
  const y = 118 - bh
  return { x, y, bw, bh, dx, dy }
})
const heavier = computed(() => props.declared && props.measured && Number(props.measured.weightLb) > Number(props.declared.weightLb) + 0.05)
const readout = computed(() => (props.reading ? '- - . -' : (Number(m.value.weightLb) || 0).toFixed(1)))
</script>

<template>
  <figure class="sd" :aria-label="t('billing.scale.aria')">
    <svg :viewBox="`0 0 300 ${height}`" width="100%" :height="height" role="img">
      <defs>
        <pattern id="sd-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="var(--line-1)" stroke-width="0.6" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="300" :height="height" fill="url(#sd-grid)" rx="8" />
      <!-- box -->
      <g :class="{ pulse: reading }">
        <polygon :points="`${box.x},${box.y} ${box.x + box.dx},${box.y - box.dy} ${box.x + box.dx + box.bw},${box.y - box.dy} ${box.x + box.bw},${box.y}`" fill="oklch(0.86 0.06 70)" stroke="oklch(0.55 0.08 60)" stroke-width="1" />
        <polygon :points="`${box.x + box.bw},${box.y} ${box.x + box.bw + box.dx},${box.y - box.dy} ${box.x + box.bw + box.dx},${box.y - box.dy + box.bh} ${box.x + box.bw},${box.y + box.bh}`" fill="oklch(0.74 0.07 65)" stroke="oklch(0.55 0.08 60)" stroke-width="1" />
        <rect :x="box.x" :y="box.y" :width="box.bw" :height="box.bh" fill="oklch(0.8 0.07 68)" stroke="oklch(0.55 0.08 60)" stroke-width="1" />
        <rect :x="box.x + box.bw * 0.12" :y="box.y + box.bh * 0.2" :width="Math.min(38, box.bw * 0.45)" :height="Math.min(24, box.bh * 0.55)" fill="white" stroke="var(--ink-3)" stroke-width="0.6" />
        <g :transform="`translate(${box.x + box.bw * 0.12 + 3}, ${box.y + box.bh * 0.2 + 4})`">
          <rect v-for="i in 9" :key="i" :x="i * 3" y="0" :width="i % 3 ? 1 : 2" :height="Math.min(10, box.bh * 0.3)" fill="var(--ink-1)" />
        </g>
        <!-- tape -->
        <line :x1="box.x + box.bw / 2" :y1="box.y" :x2="box.x + box.bw / 2 + box.dx" :y2="box.y - box.dy" stroke="oklch(0.6 0.05 60)" stroke-width="3" opacity=".6" />
      </g>
      <!-- dimension labels -->
      <text :x="box.x + box.bw / 2" :y="box.y + box.bh + 13" text-anchor="middle" class="dim">L {{ fmt.number(dims.l, 0) }} in</text>
      <text :x="box.x - 6" :y="box.y + box.bh / 2 + 3" text-anchor="end" class="dim">H {{ fmt.number(dims.h, 0) }}</text>
      <text :x="box.x + box.bw + box.dx + 6" :y="box.y - box.dy / 2" class="dim">W {{ fmt.number(dims.w, 0) }}</text>
      <!-- scale -->
      <rect x="60" :y="132" width="180" height="10" rx="3" fill="var(--ink-2)" />
      <rect x="80" :y="142" width="140" height="22" rx="4" fill="var(--ink-1)" />
      <rect x="112" :y="146" width="76" height="14" rx="2" fill="oklch(0.3 0.05 150)" />
      <text x="150" :y="157" text-anchor="middle" class="lcd" :class="{ warn: heavier }">{{ readout }} lb</text>
      <circle cx="96" :cy="153" r="3" fill="var(--success)" />
      <circle cx="204" :cy="153" r="3" fill="var(--ink-3)" />
      <text v-if="hub" x="12" y="20" class="meta">{{ hub }}</text>
      <text v-if="at" x="288" y="20" text-anchor="end" class="meta">{{ at }}</text>
    </svg>
  </figure>
</template>

<style scoped>
.sd { margin: 0; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--surface); overflow: hidden; }
svg { display: block; }
.dim { font-size: 9.5px; fill: var(--ink-3); font-family: var(--font-mono); }
.lcd { font-size: 10.5px; fill: oklch(0.9 0.15 150); font-family: var(--font-mono); font-weight: 600; letter-spacing: .04em; }
.lcd.warn { fill: oklch(0.88 0.15 80); }
.meta { font-size: 10px; fill: var(--ink-3); font-family: var(--font-mono); }
.pulse { animation: sdp 0.6s ease-in-out infinite alternate; }
@keyframes sdp { from { transform: translateY(0) } to { transform: translateY(1.5px) } }
</style>
