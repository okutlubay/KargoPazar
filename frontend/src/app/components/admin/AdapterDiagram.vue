<script setup>
// Adapter architecture (spec 10.1): consumers -> common carrier interface -> one adapter per carrier.
import { computed } from 'vue'
import { useI18n } from '../../i18n/index.js'

const props = defineProps({
  carriers: { type: Array, default: () => [] }, // [{ code, name, color, ink, adapterTemplate, adapterVersion, status }]
  highlight: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})
const { t } = useI18n()

const OPS = ['getRates', 'createLabel', 'voidLabel', 'track', 'createManifest']
const ROW = 40
const W = 980
const list = computed(() => props.carriers)
const H = computed(() => Math.max(300, list.value.length * ROW + 40))
const midY = computed(() => H.value / 2)
const ifaceH = 44 + OPS.length * 26
const ifaceY = computed(() => midY.value - ifaceH / 2)
const consumers = computed(() => [t('admin.adapter.consumers.panel'), t('admin.adapter.consumers.api'), t('admin.adapter.consumers.batch'), t('admin.adapter.consumers.ai')])
const consumerY = i => midY.value - (consumers.value.length * 46) / 2 + i * 46
const adapterY = i => 20 + i * ROW
const TEMPLATE_TONE = { 'REST-JSON': 'var(--accent)', 'SOAP-XML': 'oklch(0.6 0.14 50)', 'CSV-SFTP': 'oklch(0.55 0.12 155)' }
function curve(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}
</script>

<template>
  <div class="adapter-diagram">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="t('admin.adapter.aria', { n: list.length })" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="ad-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-4)" />
        </marker>
      </defs>

      <!-- consumers -->
      <text x="20" :y="consumerY(0) - 14" class="cap">{{ t('admin.adapter.consumersTitle') }}</text>
      <g v-for="(c, i) in consumers" :key="c">
        <rect x="20" :y="consumerY(i)" width="190" height="34" rx="8" class="box soft" />
        <text x="36" :y="consumerY(i) + 21" class="lbl">{{ c }}</text>
        <path :d="curve(210, consumerY(i) + 17, 300, midY)" class="link" marker-end="url(#ad-arrow)" />
      </g>

      <!-- common interface -->
      <text x="300" :y="ifaceY - 12" class="cap">{{ t('admin.adapter.interfaceTitle') }}</text>
      <rect x="300" :y="ifaceY" width="250" :height="ifaceH" rx="12" class="box iface" />
      <text x="318" :y="ifaceY + 26" class="iface-title">ICarrierAdapter</text>
      <g v-for="(op, i) in OPS" :key="op">
        <rect x="316" :y="ifaceY + 38 + i * 26" width="218" height="20" rx="5" class="op" />
        <text x="326" :y="ifaceY + 52 + i * 26" class="mono op-t">{{ op }}()</text>
      </g>

      <!-- adapters -->
      <text x="640" y="12" class="cap">{{ t('admin.adapter.adaptersTitle', { n: list.length }) }}</text>
      <g v-for="(c, i) in list" :key="c.code" :class="['ad', { hl: highlight === c.code, dim: highlight && highlight !== c.code, off: c.status !== 'active' }]">
        <path :d="curve(550, midY, 640, adapterY(i) + 15)" class="link" :class="{ hot: highlight === c.code }" marker-end="url(#ad-arrow)" />
        <rect x="640" :y="adapterY(i)" width="320" height="30" rx="7" class="box" />
        <rect x="646" :y="adapterY(i) + 5" width="20" height="20" rx="5" :fill="c.color || 'var(--ink-3)'" />
        <text x="656" :y="adapterY(i) + 19" text-anchor="middle" class="code" :fill="c.ink || '#fff'">{{ c.code.slice(0, 2) }}</text>
        <text x="676" :y="adapterY(i) + 19" class="lbl">{{ c.name }}</text>
        <text x="850" :y="adapterY(i) + 19" text-anchor="end" class="tpl mono" :fill="TEMPLATE_TONE[c.adapterTemplate] || 'var(--ink-3)'">{{ c.adapterTemplate }}</text>
        <text x="950" :y="adapterY(i) + 19" text-anchor="end" class="ver mono">{{ c.status === 'active' ? 'v' + (c.adapterVersion || '1.0.0') : t('status.' + c.status) }}</text>
      </g>
    </svg>
    <div v-if="!compact" class="legend">
      <span v-for="(tone, k) in TEMPLATE_TONE" :key="k"><i :style="{ background: tone }" />{{ k }} · {{ t('admin.adapter.templates.' + k) }}</span>
    </div>
  </div>
</template>

<style scoped>
.adapter-diagram { width: 100%; overflow-x: auto; }
svg { width: 100%; min-width: 640px; height: auto; display: block; font-family: var(--font-sans, inherit); }
.cap { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; fill: var(--ink-4); font-family: var(--font-mono); }
.box { fill: var(--surface); stroke: var(--line-2); }
.box.soft { fill: var(--bg-2); }
.box.iface { fill: var(--ink-1); stroke: none; }
.iface-title { fill: var(--bg); font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
.op { fill: color-mix(in oklch, var(--bg) 12%, transparent); }
.op-t { fill: var(--bg); font-size: 12px; font-family: var(--font-mono); }
.lbl { fill: var(--ink-1); font-size: 13px; font-weight: 500; }
.code { font-size: 9px; font-weight: 700; font-family: var(--font-mono); }
.tpl { font-size: 11px; font-weight: 600; font-family: var(--font-mono); }
.ver { fill: var(--ink-3); font-size: 11px; font-family: var(--font-mono); }
.link { fill: none; stroke: var(--line-strong, var(--ink-4)); stroke-width: 1.2; }
.link.hot { stroke: var(--accent); stroke-width: 2; }
.ad.hl .box { stroke: var(--accent); stroke-width: 2; }
.ad.dim { opacity: .45; }
.ad.off .box { stroke-dasharray: 4 3; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--ink-3); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
</style>
