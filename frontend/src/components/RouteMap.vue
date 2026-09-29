<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n.js'

const { t } = useI18n()
const phase = ref(0)
let timer = null

// Simple equirectangular projection of the contiguous US into the SVG box.
const P = (lon, lat) => ({ x: 20 + (lon + 125) * 9.2, y: 30 + (49.5 - lat) * 11.5 })

const OUTLINE = [
  [-124.7, 48.4], [-123, 49], [-95.2, 49], [-89.6, 48], [-84.8, 46.5], [-82.5, 45.3], [-82.5, 41.7], [-79, 43.3], [-76, 44.2],
  [-74.9, 45], [-71.5, 45], [-69.2, 47.4], [-67.8, 47.1], [-67, 44.8], [-70.2, 43.7], [-70.6, 42], [-70, 41.6], [-71.9, 41.3],
  [-74, 40.6], [-74, 39.6], [-75.5, 39], [-76.3, 37.9], [-75.9, 36.6], [-75.5, 35.2], [-76.7, 34.7], [-78.5, 33.8], [-80.9, 32],
  [-81.4, 30.4], [-80, 26.8], [-80.4, 25.2], [-81.8, 26.1], [-82.8, 27.9], [-82.6, 29.3], [-84, 30.1], [-85.4, 29.7], [-87.6, 30.3],
  [-89.6, 30.2], [-89.4, 29.1], [-91, 29.3], [-93.8, 29.7], [-95, 29.1], [-97.2, 27.6], [-97.4, 26], [-99.1, 26.5], [-100.3, 28.4],
  [-101.4, 29.8], [-103.1, 29], [-104.5, 29.6], [-106.5, 31.8], [-108.2, 31.3], [-111.1, 31.3], [-114.8, 32.5], [-117.1, 32.5],
  [-118.5, 34], [-120.6, 34.6], [-121.9, 36.6], [-122.5, 37.8], [-123.8, 39.8], [-124.2, 41.9], [-124.1, 43.7], [-124, 46.2],
]
const outlinePath = OUTLINE.map(([lon, lat], i) => {
  const p = P(lon, lat)
  return `${i ? 'L' : 'M'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`
}).join(' ') + ' Z'

const HUBS = {
  NJ01: P(-74.07, 40.79),
  LA01: P(-118.25, 33.83),
}
const ORIGINS = {
  UK: { x: 735, y: 78 },
  TR: { x: 838, y: 150 },
}
const CITIES = [
  { name: 'Boston', hub: 'NJ01', ...P(-71.06, 42.36) },
  { name: 'Chicago', hub: 'NJ01', ...P(-87.63, 41.88) },
  { name: 'Atlanta', hub: 'NJ01', ...P(-84.39, 33.75) },
  { name: 'Miami', hub: 'NJ01', ...P(-80.19, 25.76) },
  { name: 'Austin', hub: 'LA01', ...P(-97.74, 30.27) },
  { name: 'Denver', hub: 'LA01', ...P(-104.99, 39.74) },
  { name: 'Seattle', hub: 'LA01', ...P(-122.33, 47.6) },
]

const arc = (a, b, lift) => {
  const cx = (a.x + b.x) / 2
  const cy = Math.max(6, Math.min(a.y, b.y) - lift)
  return `M ${a.x.toFixed(1)},${a.y.toFixed(1)} Q ${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
}

const FIRST_MILE = [
  { id: 'uk', from: ORIGINS.UK, to: HUBS.NJ01, lift: 70, color: 'var(--accent-2)' },
  { id: 'tr', from: ORIGINS.TR, to: HUBS.LA01, lift: 150, color: 'oklch(0.85 0.14 268)' },
].map((r) => ({ ...r, d: arc(r.from, r.to, r.lift) }))

const LAST_MILE = CITIES.map((c) => ({ ...c, d: arc(HUBS[c.hub], c, 24) }))

const hubLabels = computed(() => [
  { key: 'NJ01', ...HUBS.NJ01, label: t.value.ai.map.hubs.NJ01, anchor: 'end', dx: 10, dy: 36 },
  { key: 'LA01', ...HUBS.LA01, label: t.value.ai.map.hubs.LA01, anchor: 'start', dx: 14, dy: 26 },
])

onMounted(() => {
  timer = setInterval(() => { phase.value = (phase.value + 1) % 4 }, 1800)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="route-map">
    <div class="row" style="margin-bottom: 12px; gap: 8px">
      <span class="badge-ai map-badge">{{ t.ai.map.badge }}</span>
      <span class="mono hint">{{ t.ai.map.hint }}</span>
    </div>
    <svg viewBox="0 0 880 340" style="width: 100%; height: auto" role="img" :aria-label="t.ai.map.footRight">
      <defs>
        <pattern id="kpz-dots" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="rgba(255,255,255,0.22)" />
        </pattern>
      </defs>

      <path :d="outlinePath" fill="url(#kpz-dots)" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
      <line x1="640" y1="20" x2="640" y2="320" stroke="rgba(255,255,255,0.1)" stroke-dasharray="3 5" />

      <!-- last mile from hubs -->
      <g v-for="(c, i) in LAST_MILE" :key="c.name">
        <path :d="c.d" fill="none" stroke="oklch(0.78 0.10 268)" stroke-width="1" stroke-dasharray="2 4" :opacity="phase === 2 + (i % 2) ? 0.9 : 0.35" style="transition: opacity 0.6s" />
        <circle :cx="c.x" :cy="c.y" r="3.5" fill="oklch(0.85 0.06 268)" />
        <text :x="c.x" :y="c.y + 18" fill="oklch(0.7 0.01 265)" font-size="13" font-family="var(--font-mono)" text-anchor="middle">{{ c.name }}</text>
      </g>

      <!-- first mile air legs -->
      <g v-for="(r, i) in FIRST_MILE" :key="r.id">
        <path
          :d="r.d"
          :stroke="r.color"
          :stroke-width="phase === i ? 2.2 : 1.2"
          fill="none"
          :stroke-dasharray="phase === i ? '0' : '5 4'"
          :opacity="phase === i ? 1 : 0.55"
          style="transition: all 0.6s"
        />
        <circle v-if="phase === i" r="4.5" :fill="r.color">
          <animateMotion dur="1.6s" repeatCount="1" :path="r.d" />
        </circle>
      </g>

      <!-- origins -->
      <g>
        <circle :cx="ORIGINS.UK.x" :cy="ORIGINS.UK.y" r="5" fill="var(--accent-2)" stroke="var(--ink-1)" stroke-width="2" />
        <text :x="ORIGINS.UK.x" :y="ORIGINS.UK.y - 14" fill="var(--bg)" font-size="15" font-family="var(--font-mono)" text-anchor="middle">{{ t.ai.map.uk }}</text>
        <circle :cx="ORIGINS.TR.x" :cy="ORIGINS.TR.y" r="5" fill="oklch(0.85 0.14 268)" stroke="var(--ink-1)" stroke-width="2" />
        <text :x="ORIGINS.TR.x - 6" :y="ORIGINS.TR.y + 26" fill="var(--bg)" font-size="15" font-family="var(--font-mono)" text-anchor="end">{{ t.ai.map.tr }}</text>
      </g>

      <!-- hubs -->
      <g v-for="h in hubLabels" :key="h.key">
        <circle :cx="h.x" :cy="h.y" r="14" fill="var(--accent)" opacity="0.22" class="pulse" />
        <circle :cx="h.x" :cy="h.y" r="7" fill="var(--accent)" stroke="var(--ink-1)" stroke-width="2" />
        <text :x="h.x + h.dx" :y="h.y + h.dy" fill="var(--bg)" font-size="16" font-weight="600" font-family="var(--font-mono)" :text-anchor="h.anchor">{{ h.label }}</text>
      </g>
    </svg>
    <div class="row legend">
      <span class="row lg"><span class="sw solid" />{{ t.ai.map.legendFm }}</span>
      <span class="row lg"><span class="sw dashed" />{{ t.ai.map.legendLm }}</span>
    </div>
    <div class="row footer-row">
      <span class="mono hint">{{ t.ai.map.footLeft }}</span>
      <span class="mono accent-hint">{{ t.ai.map.footRight }}</span>
    </div>
  </div>
</template>

<style scoped>
.route-map {
  margin-top: 16px;
  padding: 20px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
}
.map-badge {
  background: rgba(139, 124, 220, 0.2) !important;
  color: oklch(0.85 0.10 268) !important;
}
.hint { font-size: 11px; color: oklch(0.65 0.01 265); }
.accent-hint { font-size: 11px; color: oklch(0.85 0.10 268); }
.legend { gap: 16px; margin-top: 8px; padding: 0 4px; flex-wrap: wrap; }
.lg { gap: 6px; font-size: 11px; color: oklch(0.72 0.01 265); }
.sw { width: 18px; height: 0; border-top: 2px solid var(--accent-2); }
.sw.dashed { border-top: 1.5px dashed oklch(0.78 0.10 268); }
.footer-row { margin-top: 8px; justify-content: space-between; padding: 0 4px; flex-wrap: wrap; gap: 6px; }
</style>
