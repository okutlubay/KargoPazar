<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'

const { t } = useI18n()

const titleLines = computed(() => t.value.hero.title.split('\n'))

const sidebarItems = [
  ['Gönderiler', '324', true],
  ['Siparişler', '1.2k', false],
  ['Pazaryerleri', '4', false],
  ['Faturalar', '—', false],
  ['Müşteriler', '892', false],
]

const carrierRows = [
  { name: 'DHL Express', logo: 'DHL', time: '2-3 gün', price: 38.40, recommended: true, tag: 'AI ÖNER' },
  { name: 'FedEx International', logo: 'FX', time: '3-4 gün', price: 42.10 },
  { name: 'UPS Worldwide', logo: 'UPS', time: '3-5 gün', price: 39.80 },
  { name: 'Aramex Global', logo: 'AX', time: '5-7 gün', price: 28.20, tag: 'EN UCUZ' },
  { name: 'PTT Yurtdışı', logo: 'PTT', time: '7-12 gün', price: 22.40 },
]

const logos = ['DHL', 'FedEx', 'UPS', 'Aramex', 'Etsy', 'Shopify', 'TNT', 'USPS', 'Royal Mail']
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
        <p class="lede fade-up" style="animation-delay: 0.1s; max-width: 680px">{{ t.hero.sub }}</p>
        <div class="cta-row fade-up" style="animation-delay: 0.15s">
          <a href="#calc" class="btn btn-primary btn-lg">{{ t.hero.cta1 }} <Icon name="arrow" /></a>
          <a href="#dashboard" class="btn btn-ghost btn-lg">▶  {{ t.hero.cta2 }}</a>
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
            <div class="mono url">app.kargopazar.com / shipments / new</div>
            <div style="width: 60px" />
          </div>

          <div class="product-content">
            <aside class="sidebar">
              <div class="mono section-label">OPERASYON</div>
              <div
                v-for="[l, c, active] in sidebarItems"
                :key="l"
                :class="['side-item', { active }]"
              >
                <span>{{ l }}</span>
                <span class="mono count">{{ c }}</span>
              </div>
              <div class="hr" />
              <div class="mono section-label">AI ASİSTAN</div>
              <div class="ai-card">
                <div class="ai-card-head">
                  <span class="badge-ai">AI</span>
                  <span class="time">2dk önce</span>
                </div>
                <div class="ai-card-body">
                  3 sipariş için <b>FedEx</b> yerine <b class="accent-text">DHL Express</b> önerilir. Tahmini tasarruf: <b>$24.80</b>
                </div>
              </div>
            </aside>

            <div class="main">
              <div class="main-head">
                <div>
                  <div class="h-3" style="margin-bottom: 4px">Yeni gönderi · #SH-2814</div>
                  <div class="mono sub">Etsy → Order #ETS-49102 · Ann Brewer · Massachusetts, US</div>
                </div>
                <span class="pill"><span class="dot accent-dot" />AI önerisi hazır</span>
              </div>

              <div class="carrier-table">
                <div class="row mono table-head">
                  <div style="flex: 2">Taşıyıcı</div>
                  <div style="flex: 1">Süre</div>
                  <div style="flex: 1">Etiket</div>
                  <div style="flex: 1; text-align: right">Fiyat</div>
                </div>
                <div
                  v-for="(r, i) in carrierRows"
                  :key="i"
                  :class="['row', 'table-row', { last: i === carrierRows.length - 1, recommended: r.recommended }]"
                >
                  <div class="row" style="flex: 2; gap: 10px">
                    <span :class="['logo-square', { rec: r.recommended }]">{{ r.logo }}</span>
                    <span style="font-weight: 500">{{ r.name }}</span>
                  </div>
                  <div style="flex: 1; color: var(--ink-2)">{{ r.time }}</div>
                  <div style="flex: 1">
                    <span v-if="r.tag" :class="['tag', { rec: r.recommended }]">{{ r.tag }}</span>
                  </div>
                  <div class="mono" style="flex: 1; text-align: right; font-weight: 600">${{ r.price.toFixed(2) }}</div>
                </div>
              </div>
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
  width: 900px; height: 600px; border-radius: 50%;
  background: radial-gradient(ellipse, oklch(0.85 0.10 268 / 0.35), transparent 60%);
  z-index: 0; pointer-events: none;
}
.hero-inner { position: relative; z-index: 1; padding-top: 80px; padding-bottom: 96px; }
.hero-text { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 24px; max-width: 880px; margin: 0 auto; }
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
.dots { display: flex; align-items: center; gap: 6px; }
.dots .dot { width: 11px; height: 11px; border-radius: 999px; }
.dots .dot-r { background: #FF5F57; }
.dots .dot-y { background: #FEBC2E; }
.dots .dot-g { background: #28C840; }
.url {
  font-size: 11.5px; color: var(--ink-3);
  padding: 4px 10px; background: var(--surface);
  border-radius: 6px; border: 1px solid var(--line-1);
}
.product-content { display: grid; grid-template-columns: 240px 1fr; min-height: 460px; }
.sidebar { border-right: 1px solid var(--line-1); padding: 16px; background: var(--bg-2); }
.section-label { font-size: 10.5px; color: var(--ink-3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px; }
.side-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 6px; font-size: 13.5px; font-weight: 500;
  color: var(--ink-2); margin-bottom: 2px;
}
.side-item.active { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.side-item .count { font-size: 11px; opacity: 0.7; }
.hr { height: 1px; background: var(--line-1); margin: 16px 0; }
.ai-card {
  padding: 12px; background: white; border: 1px solid var(--line-2); border-radius: var(--r-lg);
}
.ai-card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.ai-card-head .time { font-size: 11.5px; color: var(--ink-3); }
.ai-card-body { font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
.ai-card-body b { color: var(--ink-1); }
.ai-card-body .accent-text, .accent-text { color: var(--accent-ink); }

.main { padding: 24px; }
.main-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.main-head .sub { font-size: 12px; color: var(--ink-3); }
.accent-dot { background: var(--accent) !important; }

.carrier-table { border: 1px solid var(--line-1); border-radius: 10px; overflow: hidden; }
.table-head {
  padding: 10px 14px; background: var(--bg-2);
  border-bottom: 1px solid var(--line-1);
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-3);
}
.table-row { padding: 12px 14px; border-bottom: 1px solid var(--line-1); background: white; font-size: 13.5px; }
.table-row.last { border-bottom: none; }
.table-row.recommended { background: var(--accent-soft); }
.logo-square {
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--ink-1); color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 9px; font-weight: 700;
}
.logo-square.rec { background: var(--accent); }
.tag {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 4px;
  background: var(--ink-1); color: white; letter-spacing: 0.04em;
}
.tag.rec { background: var(--accent); }

.logo-cloud { border-top: 1px solid var(--line-1); border-bottom: 1px solid var(--line-1); background: var(--bg-2); padding: 32px 0; }
.logos-label { font-size: 11px; color: var(--ink-3); text-align: center; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 20px; }
.logos-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 24px; opacity: 0.7; }
.logo-text { font-family: var(--font-display); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; color: var(--ink-2); }
</style>
