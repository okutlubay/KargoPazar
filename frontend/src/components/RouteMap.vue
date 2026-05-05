<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const phase = ref(0)
let timer = null

const POINTS = {
  IST: { x: 470, y: 145, label: 'Istanbul' },
  LON: { x: 380, y: 110, label: 'London' },
  NYC: { x: 200, y: 145, label: 'New York' },
  DUB: { x: 530, y: 195, label: 'Dubai' },
  SYD: { x: 770, y: 280, label: 'Sydney' },
}

const ROUTES = [
  { from: 'IST', to: 'NYC', color: 'var(--accent-2)' },
  { from: 'IST', to: 'LON', color: 'oklch(0.78 0.10 268)' },
  { from: 'IST', to: 'DUB', color: 'oklch(0.85 0.14 268)' },
  { from: 'IST', to: 'SYD', color: 'oklch(0.7 0.16 268)' },
]

const pathFor = (r) => {
  const a = POINTS[r.from], b = POINTS[r.to]
  const cx = (a.x + b.x) / 2
  const cy = Math.min(a.y, b.y) - 60
  return `M ${a.x},${a.y} Q ${cx},${cy} ${b.x},${b.y}`
}

onMounted(() => {
  timer = setInterval(() => { phase.value = (phase.value + 1) % 4 }, 1800)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="route-map">
    <div class="row" style="margin-bottom: 12px; gap: 8px">
      <span class="badge-ai map-badge">ROUTE</span>
      <span class="mono hint">route_optimizer.predict() — live</span>
    </div>
    <svg viewBox="0 0 880 360" style="width: 100%; height: auto">
      <defs>
        <pattern id="dots" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="rgba(255,255,255,0.15)" />
        </pattern>
      </defs>
      <g opacity="0.6">
        <path d="M 100,80 Q 180,60 260,80 L 280,170 Q 200,210 130,200 L 100,80 Z" fill="url(#dots)" />
        <path d="M 350,70 Q 460,55 540,80 L 600,180 Q 480,210 360,180 L 350,70 Z" fill="url(#dots)" />
        <path d="M 540,100 Q 640,90 720,140 L 700,210 Q 620,220 540,180 L 540,100 Z" fill="url(#dots)" />
        <path d="M 720,240 Q 800,230 830,270 L 810,310 Q 750,320 720,290 L 720,240 Z" fill="url(#dots)" />
      </g>

      <g v-for="(r, i) in ROUTES" :key="i">
        <path
          :d="pathFor(r)"
          :stroke="r.color"
          :stroke-width="phase === i ? 2 : 1"
          fill="none"
          :stroke-dasharray="phase === i ? '0' : '4 4'"
          :opacity="phase === i ? 1 : 0.4"
          style="transition: all 0.6s"
        />
        <circle v-if="phase === i" r="4" :fill="r.color">
          <animateMotion dur="1.6s" repeatCount="1" :path="pathFor(r)" />
        </circle>
      </g>

      <g v-for="(p, k) in POINTS" :key="k">
        <circle :cx="p.x" :cy="p.y" r="6" fill="var(--accent)" stroke="var(--ink-1)" stroke-width="2" />
        <circle :cx="p.x" :cy="p.y" r="12" fill="var(--accent)" opacity="0.2" :class="k === 'IST' ? 'pulse' : ''" />
        <text :x="p.x" :y="p.y - 14" fill="var(--bg)" font-size="11" font-family="var(--font-mono)" text-anchor="middle">{{ p.label }}</text>
      </g>
    </svg>
    <div class="row footer-row">
      <span class="mono hint">4 {{ phase === 0 ? 'rotalar değerleniyor' : 'active routes' }}</span>
      <span class="mono accent-hint">↗ ETA -18%</span>
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
.footer-row { margin-top: 8px; justify-content: space-between; padding: 0 4px; }
</style>
