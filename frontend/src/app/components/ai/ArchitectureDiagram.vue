<script setup>
// AI architecture diagram (spec 6.0): data sources -> 6 modules -> consuming screens,
// with module dependency arrows (forecast -> pricing, address -> optimizer, hs -> customs).
// Hover (or focus) a module to highlight its connections and see its inputs / outputs.
//   <ArchitectureDiagram :versions="{ address: 'addr-ml v1.3', ... }" @open="key => router.push(...)" />
import { ref, computed } from 'vue'
import { useI18n } from '../../i18n/index.js'

const props = defineProps({
  versions: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['open', 'open-consumer'])
const { t } = useI18n()

const W = 1100
const H = 700
const SRC = { x: 16, w: 196, h: 54 }
const MOD = { x: 408, w: 272, h: 74 }
const CON = { x: 872, w: 214, h: 56 }
const TOP = 56

const sources = ['orders', 'shipments', 'addressFeedback', 'catalog', 'rates']
const modules = ['forecast', 'pricing', 'address', 'optimizer', 'hs', 'customs']
const consumers = ['shipmentNew', 'batch', 'rateCards', 'customs']

const inEdges = {
  forecast: ['shipments'],
  pricing: ['rates', 'shipments'],
  address: ['orders', 'addressFeedback'],
  optimizer: ['shipments', 'rates', 'catalog'],
  hs: ['catalog'],
  customs: ['catalog', 'shipments'],
}
const outEdges = {
  forecast: [],
  pricing: ['rateCards', 'shipmentNew'],
  address: ['shipmentNew', 'batch'],
  optimizer: ['shipmentNew', 'batch'],
  hs: ['customs'],
  customs: ['customs'],
}
const deps = [['forecast', 'pricing'], ['address', 'optimizer'], ['hs', 'customs']]

function column(list, box) {
  const span = H - TOP - 16
  const gap = (span - list.length * box.h) / Math.max(1, list.length - 1)
  return Object.fromEntries(list.map((k, i) => [k, { x: box.x, y: TOP + i * (box.h + gap), w: box.w, h: box.h }]))
}
const srcPos = column(sources, SRC)
const conPos = column(consumers, CON)
const modPos = (() => {
  // pairs of dependent modules sit close together
  const pos = {}
  const pairGap = 30
  const groupGap = (H - TOP - 16 - 6 * MOD.h - 3 * pairGap) / 2
  let y = TOP
  modules.forEach((k, i) => {
    pos[k] = { x: MOD.x, y, w: MOD.w, h: MOD.h }
    y += MOD.h + (i % 2 === 0 ? pairGap : groupGap)
  })
  return pos
})()

const hover = ref(null)
const tip = ref(null)

function curve(x1, y1, x2, y2) {
  const dx = (x2 - x1) * 0.5
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

const edges = computed(() => {
  const out = []
  for (const m of modules) {
    const mp = modPos[m]
    inEdges[m].forEach((s, i) => {
      const sp = srcPos[s]
      const spread = (i - (inEdges[m].length - 1) / 2) * 12
      out.push({ key: `${s}-${m}`, module: m, from: s, d: curve(sp.x + sp.w, sp.y + sp.h / 2, mp.x, mp.y + mp.h / 2 + spread), kind: 'in' })
    })
    outEdges[m].forEach((c, i) => {
      const cp = conPos[c]
      const spread = (i - (outEdges[m].length - 1) / 2) * 12
      out.push({ key: `${m}-${c}`, module: m, to: c, d: curve(mp.x + mp.w, mp.y + mp.h / 2 + spread, cp.x, cp.y + cp.h / 2), kind: 'out' })
    })
  }
  return out
})

const depPaths = computed(() => deps.map(([a, b]) => {
  const pa = modPos[a]
  const pb = modPos[b]
  const x = pa.x + pa.w - 34
  return { key: `${a}-${b}`, a, b, d: `M${x},${pa.y + pa.h} L${x},${pb.y - 3}`, lx: x - 8, ly: (pa.y + pa.h + pb.y) / 2 + 4 }
}))

function related(m) {
  if (!hover.value) return true
  if (hover.value === m) return true
  return deps.some(([a, b]) => (a === hover.value && b === m) || (b === hover.value && a === m))
}
function edgeActive(e) { return !hover.value || e.module === hover.value }
function nodeActive(kind, key) {
  if (!hover.value) return true
  if (kind === 'src') return inEdges[hover.value].includes(key)
  return outEdges[hover.value].includes(key)
}

const wrap = ref(null)
function show(m, ev) {
  hover.value = m
  const r = wrap.value?.getBoundingClientRect()
  const box = ev?.currentTarget?.getBoundingClientRect?.()
  if (!r || !box) { tip.value = { m, x: 0, y: 0 }; return }
  const left = box.left - r.left + (wrap.value.scrollLeft || 0)
  // left of the module column (over the dimmed sources) so dependent modules stay visible
  const x = left - 312 >= 0 ? left - 312 : Math.min(left + box.width + 12, (wrap.value.scrollWidth || r.width) - 304)
  tip.value = { m, x, y: Math.max(0, box.top - r.top - 6) }
}
function hide() { hover.value = null; tip.value = null }
const list = key => { const v = t(key); return Array.isArray(v) ? v : [] }
</script>

<template>
  <div ref="wrap" data-testid="ai-arch-diagram" class="arch" @mouseleave="hide">
    <svg :viewBox="`0 0 ${W} ${H}`" class="svg" role="img" :aria-label="t('aiHub.arch.aria')">
      <defs>
        <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--line-strong)" />
        </marker>
        <marker id="arch-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
      </defs>

      <text :x="SRC.x" y="24" class="col-title">{{ t('aiHub.arch.columns.sources') }}</text>
      <text :x="MOD.x" y="24" class="col-title">{{ t('aiHub.arch.columns.modules') }}</text>
      <text :x="CON.x" y="24" class="col-title">{{ t('aiHub.arch.columns.consumers') }}</text>

      <g class="edges">
        <path v-for="e in edges" :key="e.key" :d="e.d" :class="['edge', { dim: !edgeActive(e), hot: hover && edgeActive(e) }]" marker-end="url(#arch-arrow)" />
      </g>

      <g v-for="s in sources" :key="s" :class="['node src', { dim: !nodeActive('src', s) }]">
        <rect :x="srcPos[s].x" :y="srcPos[s].y" :width="srcPos[s].w" :height="srcPos[s].h" rx="10" />
        <text :x="srcPos[s].x + 14" :y="srcPos[s].y + 23" class="n-title">{{ t(`aiHub.arch.sources.${s}.name`) }}</text>
        <text :x="srcPos[s].x + 14" :y="srcPos[s].y + 40" class="n-sub">{{ t(`aiHub.arch.sources.${s}.sub`) }}</text>
      </g>

      <g v-for="c in consumers" :key="c" :class="['node con', { dim: !nodeActive('con', c) }]" tabindex="0" role="link" @click="emit('open-consumer', c)" @keydown.enter="emit('open-consumer', c)">
        <rect :x="conPos[c].x" :y="conPos[c].y" :width="conPos[c].w" :height="conPos[c].h" rx="10" />
        <text :x="conPos[c].x + 14" :y="conPos[c].y + 24" class="n-title">{{ t(`aiHub.arch.consumers.${c}.name`) }}</text>
        <text :x="conPos[c].x + 14" :y="conPos[c].y + 41" class="n-sub">{{ t(`aiHub.arch.consumers.${c}.sub`) }}</text>
      </g>

      <g v-for="m in modules" :key="m" :data-testid="'arch-mod-' + m" :class="['node mod', { dim: !related(m), on: hover === m }]" tabindex="0" role="button"
        :aria-label="t(`aiHub.modules.${m}.name`)"
        @mouseenter="show(m, $event)" @focus="show(m, $event)" @blur="hide" @click="emit('open', m)" @keydown.enter="emit('open', m)">
        <rect :x="modPos[m].x" :y="modPos[m].y" :width="modPos[m].w" :height="modPos[m].h" rx="12" />
        <circle :cx="modPos[m].x + 18" :cy="modPos[m].y + 21" r="4" class="dot" />
        <text :x="modPos[m].x + 30" :y="modPos[m].y + 25" class="m-title">{{ t(`aiHub.modules.${m}.name`) }}</text>
        <text :x="modPos[m].x + 16" :y="modPos[m].y + 45" class="m-io">{{ t(`aiHub.arch.io.${m}.short`) }}</text>
        <text :x="modPos[m].x + 16" :y="modPos[m].y + 62" class="m-ver">{{ versions[m] || '' }}</text>
      </g>

      <g class="deps">
        <g v-for="d in depPaths" :key="d.key" :class="{ dim: hover && !related(d.a) && !related(d.b) }">
          <path :d="d.d" class="dep" marker-end="url(#arch-arrow-accent)" />
          <text :x="d.lx" :y="d.ly" class="dep-label" text-anchor="end">{{ t(`aiHub.arch.depLabels.${d.a}`) }}</text>
        </g>
      </g>
    </svg>

    <div class="legend">
      <span><i class="lg-edge" />{{ t('aiHub.arch.legend.data') }}</span>
      <span><i class="lg-dep" />{{ t('aiHub.arch.legend.dependency') }}</span>
      <span class="hint">{{ t('aiHub.arch.legend.hint') }}</span>
    </div>

    <div v-if="tip" class="tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }" role="tooltip">
      <div class="tip-title">{{ t(`aiHub.modules.${tip.m}.name`) }}</div>
      <div class="tip-cols">
        <div>
          <div class="tip-h">{{ t('aiHub.arch.inputs') }}</div>
          <ul><li v-for="(x, i) in list(`aiHub.arch.io.${tip.m}.inputs`)" :key="i">{{ x }}</li></ul>
        </div>
        <div>
          <div class="tip-h">{{ t('aiHub.arch.outputs') }}</div>
          <ul><li v-for="(x, i) in list(`aiHub.arch.io.${tip.m}.outputs`)" :key="i">{{ x }}</li></ul>
        </div>
      </div>
      <div class="tip-algo">{{ t(`aiHub.arch.io.${tip.m}.algo`) }}</div>
    </div>
  </div>
</template>

<style scoped>
.arch { position: relative; overflow-x: auto; }
.svg { display: block; width: 100%; min-width: 860px; height: auto; font-family: var(--font-body); }
.col-title { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; fill: var(--ink-3); }
.edge { fill: none; stroke: var(--line-2); stroke-width: 1.4; transition: opacity .15s, stroke .15s; }
.edge.hot { stroke: var(--accent-2); stroke-width: 1.8; }
.edge.dim, .node.dim, .deps .dim { opacity: .22; }
.node { transition: opacity .15s; }
.node rect { fill: var(--surface); stroke: var(--line-2); stroke-width: 1; }
.src rect { fill: var(--bg-2); }
.con rect { fill: var(--bg-2); }
.con { cursor: pointer; }
.con:hover rect, .con:focus rect { stroke: var(--line-strong); }
.mod { cursor: pointer; outline: none; }
.mod rect { stroke: oklch(0.85 0.05 268); fill: var(--surface); filter: drop-shadow(0 1px 1.5px rgba(20, 22, 40, .06)); }
.mod.on rect, .mod:focus rect { stroke: var(--accent); stroke-width: 1.6; fill: var(--accent-soft); }
.dot { fill: var(--success); }
.n-title { font-size: 13.5px; font-weight: 600; fill: var(--ink-1); }
.n-sub { font-size: 11.5px; fill: var(--ink-3); }
.m-title { font-size: 14px; font-weight: 600; fill: var(--ink-1); font-family: var(--font-display); }
.m-io { font-size: 11.5px; fill: var(--ink-2); }
.m-ver { font-size: 11px; fill: var(--accent-ink); font-family: var(--font-mono); }
.dep-label { font-size: 10.5px; fill: var(--accent-ink); font-weight: 500; }
.dep { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 4 3; }
.legend { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--ink-3); margin-top: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 8px; }
.lg-edge { display: inline-block; width: 22px; height: 0; border-top: 1.6px solid var(--line-strong); }
.lg-dep { display: inline-block; width: 22px; height: 0; border-top: 2px dashed var(--accent); }
.hint { margin-left: auto; }
.tip { position: absolute; z-index: 5; width: 300px; background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-md); box-shadow: var(--shadow-md); padding: 12px 14px; font-size: 12.5px; pointer-events: none; }
.tip-title { font-weight: 600; font-size: 13.5px; margin-bottom: 8px; }
.tip-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tip-h { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); margin-bottom: 4px; font-weight: 600; }
.tip ul { margin: 0; padding-left: 14px; color: var(--ink-2); line-height: 1.45; }
.tip-algo { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-1); color: var(--ink-3); }
</style>
