<script setup>
import { computed, inject } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import { round2 } from '../shared/rateEngine.js'
import Icon from './Icon.vue'

const { t, f, money } = useI18n()
const pricing = inject('kpzPricing')

const titleLines = computed(() => t.value.hero.title.split('\n'))

const sidebarItems = computed(() => {
  const s = t.value.hero.side
  return [
    { key: 'overview', label: s.overview, icon: 'home' },
    { key: 'orders', label: s.orders, icon: 'list', count: '58' },
    { key: 'shipments', label: s.shipments, icon: 'box', active: true },
    { key: 'batch', label: s.batch, icon: 'layers' },
    { key: 'manifests', label: s.manifests, icon: 'file' },
    { key: 'ops', label: s.ops, icon: 'warehouse' },
    { key: 'track', label: s.track, icon: 'radar' },
  ]
})

// Fixed sample from the spec: NJ01 → Austin TX 78701, 2 lb, 10x8x4 in.
// Priced with the demo account's context (plan + customer rate card) because
// the frame shows the logged-in panel; OnTrac only ships from LA01.
const SAMPLE = { zip: '78701', state: 'TX', pkg: { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: 2 } }
const ROWS = [
  { key: 'UPS-GROUND', hub: 'NJ01', logo: 'UPS' },
  { key: 'USPS-GA', hub: 'NJ01', logo: 'USPS' },
  { key: 'FDX-HOME', hub: 'NJ01', logo: 'FDX' },
  { key: 'DHLE-EXP', hub: 'NJ01', logo: 'DHL' },
  { key: 'ONT-GROUND', hub: 'LA01', logo: 'ONT' },
]

const account = computed(() => {
  const u = pricing.data.value.user || {}
  return { plan: (u.company && u.company.plan) || 'enterprise', customerId: u.customerId || null }
})

const rows = computed(() => {
  const byHub = {}
  for (const hub of ['NJ01', 'LA01']) {
    byHub[hub] = pricing.quoteDomestic({ hub, zip: SAMPLE.zip, state: SAMPLE.state, pkg: SAMPLE.pkg, ...account.value })
  }
  const out = []
  for (const r of ROWS) {
    const q = byHub[r.hub].find((x) => x.key === r.key)
    if (!q) continue
    const c = pricing.carrierMeta(q.carrierCode)
    out.push({ ...r, quote: q, name: q.serviceName, color: c.color, ink: c.ink })
  }
  return out
})

const aiKey = computed(() => {
  const ranked = pricing.rankQuotes(rows.value.map((r) => r.quote))
  return ranked.length ? ranked[0].quote.key : null
})
const cheapestKey = computed(() => {
  if (!rows.value.length) return null
  return rows.value.reduce((m, r) => (r.quote.total < m.quote.total ? r : m)).key
})

// "For 3 orders, UPS Ground instead of FedEx": savings computed from the same quotes.
const aiCard = computed(() => {
  const from = rows.value.find((r) => r.key === 'FDX-HOME')
  if (!from) return null
  let to = rows.value.find((r) => r.key === 'UPS-GROUND')
  if (!to || to.quote.total >= from.quote.total) {
    to = rows.value.filter((r) => r.key !== 'FDX-HOME').sort((a, b) => a.quote.total - b.quote.total)[0]
  }
  if (!to) return null
  const saving = round2(3 * (from.quote.total - to.quote.total))
  if (saving <= 0) return null
  return { from: `${from.quote.carrierName}`, to: to.quote.serviceName, amount: money(saving) }
})

const aiCardParts = computed(() => {
  if (!aiCard.value) return []
  // Split the sentence so carrier names and the amount can be bold.
  const tpl = t.value.hero.aiCard
  const parts = []
  let last = 0
  tpl.replace(/\{(\w+)\}/g, (m, k, idx) => {
    if (idx > last) parts.push({ text: tpl.slice(last, idx) })
    parts.push({ text: aiCard.value[k], bold: true, accent: k === 'to' })
    last = idx + m.length
    return m
  })
  if (last < tpl.length) parts.push({ text: tpl.slice(last) })
  return parts
})

const logos = ['Shopify', 'Etsy', 'Amazon', 'eBay', 'WooCommerce', 'FedEx', 'UPS', 'USPS', 'DHL', 'OnTrac']
</script>

<template>
  <section id="top" class="hero">
    <div class="grid-bg" />
    <div class="glow" />

    <div class="container hero-inner">
      <div class="hero-text">
        <span class="pill fade-up">
          <Icon name="spark" />
          {{ t.hero.pill }}
        </span>
        <h1 class="h-display fade-up" style="animation-delay: 0.05s">
          <template v-for="(line, i) in titleLines" :key="i">
            <span v-if="i === 1" class="accent-line">{{ line }}</span>
            <template v-else>{{ line }}</template>
            <br v-if="i < titleLines.length - 1" />
          </template>
        </h1>
        <p class="lede fade-up" style="animation-delay: 0.1s; max-width: 720px">{{ t.hero.sub }}</p>
        <div class="cta-row fade-up" style="animation-delay: 0.15s">
          <a :href="APP_LINKS.signup" class="btn btn-primary btn-lg">{{ t.hero.cta1 }} <Icon name="arrow" /></a>
          <a :href="APP_LINKS.demo" class="btn btn-ghost btn-lg"><Icon name="play" /> {{ t.hero.cta2 }}</a>
        </div>
        <div class="mono meta fade-up" style="animation-delay: 0.2s">{{ t.hero.meta }}</div>
      </div>

      <div class="product fade-up" style="animation-delay: 0.25s">
        <div class="product-frame">
          <div class="window-bar">
            <div class="dots">
              <span class="dot dot-r" />
              <span class="dot dot-y" />
              <span class="dot dot-g" />
            </div>
            <div class="mono url">{{ t.hero.url }}</div>
            <div class="bar-spacer" />
          </div>

          <div class="product-content">
            <aside class="sidebar">
              <div class="mono section-label">{{ t.hero.groupOps }}</div>
              <div v-for="it in sidebarItems" :key="it.key" :class="['side-item', { active: it.active }]">
                <span class="row side-label"><Icon :name="it.icon" :size="14" />{{ it.label }}</span>
                <span v-if="it.count" class="mono count">{{ it.count }}</span>
              </div>
              <div class="hr" />
              <div class="mono section-label">{{ t.hero.groupAi }}</div>
              <div v-if="aiCard" class="ai-card">
                <div class="ai-card-head">
                  <span class="badge-ai">AI</span>
                  <span class="time">{{ t.hero.aiTime }}</span>
                </div>
                <div class="ai-card-body">
                  <template v-for="(p, i) in aiCardParts" :key="i">
                    <b v-if="p.bold" :class="{ 'accent-text': p.accent }">{{ p.text }}</b>
                    <template v-else>{{ p.text }}</template>
                  </template>
                </div>
              </div>
            </aside>

            <div class="main">
              <div class="main-head">
                <div class="head-text">
                  <div class="h-3" style="margin-bottom: 4px">{{ t.hero.shipTitle }}</div>
                  <div class="mono sub">{{ t.hero.shipSub }}</div>
                  <div class="mono sub pkg">{{ t.hero.pkgLine }}</div>
                </div>
                <span class="pill"><span class="dot accent-dot" />{{ t.hero.aiReady }}</span>
              </div>

              <div class="carrier-table">
                <div class="row mono table-head">
                  <div class="c-carrier">{{ t.hero.cols.carrier }}</div>
                  <div class="c-eta">{{ t.hero.cols.eta }}</div>
                  <div class="c-tag">{{ t.hero.cols.tag }}</div>
                  <div class="c-price">{{ t.hero.cols.price }}</div>
                </div>
                <div
                  v-for="(r, i) in rows"
                  :key="r.key"
                  :class="['row', 'table-row', { last: i === rows.length - 1, recommended: r.key === aiKey }]"
                >
                  <div class="row c-carrier" style="gap: 10px">
                    <span class="logo-square" :style="{ background: r.color, color: r.ink }">{{ r.logo }}</span>
                    <span class="col" style="gap: 1px; min-width: 0">
                      <span class="svc-name">{{ r.name }}</span>
                      <span v-if="r.hub !== 'NJ01'" class="mono via">{{ f(t.hero.viaHub, { hub: r.hub }) }}</span>
                    </span>
                  </div>
                  <div class="c-eta eta">{{ f(r.quote.etaDays === 1 ? t.common.day : t.common.days, { n: r.quote.etaDays }) }}</div>
                  <div class="c-tag">
                    <span v-if="r.key === aiKey" class="tag rec">{{ t.hero.tagAi }}</span>
                    <span v-else-if="r.key === cheapestKey" class="tag">{{ t.hero.tagCheapest }}</span>
                  </div>
                  <div class="mono c-price price">{{ money(r.quote.total) }}</div>
                </div>
              </div>
              <div class="mono engine-note"><Icon name="info" :size="12" /> {{ t.hero.engineNote }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="logo-cloud">
      <div class="container">
        <div class="mono logos-label">{{ t.logos }}</div>
        <div class="logos-row">
          <span v-for="l in logos" :key="l" class="logo-text">{{ l }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero { position: relative; overflow: hidden; padding-top: 32px; padding-bottom: 0; }
.grid-bg {
  position: absolute; inset: 0; z-index: 0;
  background-image:
    linear-gradient(to right, oklch(0.92 0.005 265 / 0.5) 1px, transparent 1px),
    linear-gradient(to bottom, oklch(0.92 0.005 265 / 0.5) 1px, transparent 1px);
  background-size: 64px 64px;
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%);
          mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%);
}
.glow {
  position: absolute; top: -200px; left: 50%; transform: translateX(-50%);
  width: 900px; max-width: 100vw; height: 600px; border-radius: 50%;
  background: radial-gradient(ellipse, oklch(0.85 0.10 268 / 0.35), transparent 60%);
  z-index: 0; pointer-events: none;
}
.hero-inner { position: relative; z-index: 1; padding-top: 80px; padding-bottom: 96px; }
.hero-text { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 24px; max-width: 900px; margin: 0 auto; }
.accent-line { color: var(--accent-ink); }
.cta-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; }
.meta { font-size: 12px; color: var(--ink-3); }

.product { margin-top: 64px; }
.product-frame {
  max-width: 1100px;
  margin: 0 auto;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--line-1);
  overflow: hidden;
}
.window-bar {
  display: flex; align-items: center; justify-content: space-between;
  height: 38px; padding: 0 14px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-2);
}
.bar-spacer { width: 60px; }
.dots { display: flex; align-items: center; gap: 6px; }
.dots .dot { width: 11px; height: 11px; border-radius: 999px; }
.dots .dot-r { background: #FF5F57; }
.dots .dot-y { background: #FEBC2E; }
.dots .dot-g { background: #28C840; }
.url {
  font-size: 11.5px; color: var(--ink-3);
  padding: 4px 10px; background: var(--surface);
  border-radius: 6px; border: 1px solid var(--line-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.product-content { display: grid; grid-template-columns: 240px 1fr; min-height: 460px; }
.sidebar { border-right: 1px solid var(--line-1); padding: 16px; background: var(--bg-2); }
.section-label { font-size: 10.5px; color: var(--ink-3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px; }
.side-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; border-radius: 6px; font-size: 13px; font-weight: 500;
  color: var(--ink-2); margin-bottom: 2px;
}
.side-label { gap: 9px; }
.side-item.active { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.side-item .count { font-size: 11px; opacity: 0.7; }
.hr { height: 1px; background: var(--line-1); margin: 16px 0; }
.ai-card { padding: 12px; background: white; border: 1px solid var(--line-2); border-radius: var(--r-lg); }
.ai-card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.ai-card-head .time { font-size: 11.5px; color: var(--ink-3); }
.ai-card-body { font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
.ai-card-body b { color: var(--ink-1); }
.ai-card-body .accent-text { color: var(--accent-ink); }

.main { padding: 24px; min-width: 0; }
.main-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.head-text { text-align: left; min-width: 0; }
.main-head .sub { font-size: 12px; color: var(--ink-3); }
.main-head .pkg { margin-top: 2px; color: var(--ink-4); }
.accent-dot { background: var(--accent) !important; }

.carrier-table { border: 1px solid var(--line-1); border-radius: 10px; overflow: hidden; text-align: left; }
.table-head {
  padding: 10px 14px; background: var(--bg-2);
  border-bottom: 1px solid var(--line-1);
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-3);
}
.table-row { padding: 11px 14px; border-bottom: 1px solid var(--line-1); background: white; font-size: 13.5px; }
.table-row.last { border-bottom: none; }
.table-row.recommended { background: var(--accent-soft); }
.c-carrier { flex: 2.2; min-width: 0; }
.c-eta { flex: 0.9; }
.c-tag { flex: 1; }
.c-price { flex: 0.9; text-align: right; }
.svc-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.via { font-size: 10.5px; color: var(--ink-3); }
.eta { color: var(--ink-2); }
.price { font-weight: 600; }
.logo-square {
  width: 30px; height: 30px; border-radius: 6px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 8.5px; font-weight: 700;
}
.tag {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 4px;
  background: var(--ink-1); color: white; letter-spacing: 0.04em; white-space: nowrap;
}
.tag.rec { background: var(--accent); }
.engine-note { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px; color: var(--ink-3); text-align: left; }

.logo-cloud { border-top: 1px solid var(--line-1); border-bottom: 1px solid var(--line-1); background: var(--bg-2); padding: 32px 0; }
.logos-label { font-size: 11px; color: var(--ink-3); text-align: center; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 20px; }
.logos-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px 28px; opacity: 0.7; }
.logo-text { font-family: var(--font-display); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; color: var(--ink-2); }

@media (max-width: 860px) {
  .hero-inner { padding-top: 48px; padding-bottom: 64px; }
  .product-content { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .main { padding: 16px; }
  .main-head { flex-direction: column; }
  .c-tag { display: none; }
  .logos-row { justify-content: center; }
  .logo-text { font-size: 17px; }
}
@media (max-width: 480px) {
  .bar-spacer { display: none; }
  .c-eta { flex: 0.8; font-size: 12.5px; }
}
</style>
