<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import RouteMap from './RouteMap.vue'

const { t, lang } = useI18n()

const titleLines = computed(() => t.value.ai.title.split('\n'))

const modules = computed(() => [
  { code: 'ROUTE', name: lang.value === 'tr' ? 'Rota optimizasyonu' : 'Route optimization', desc: lang.value === 'tr' ? '12M gönderiden öğrenen graf modeli; gerçek zamanlı transit verisi ile ETA tahmini.' : 'Graph model trained on 12M shipments; ETA prediction with real-time transit data.', acc: '94.2%' },
  { code: 'PRICE', name: lang.value === 'tr' ? 'Dinamik fiyatlandırma' : 'Dynamic pricing', desc: lang.value === 'tr' ? 'Kur, sezon ve hacim faktörlerini işleyen ML; her 15 dk yeniden eğitim.' : 'ML processing FX, seasonality, volume; retrained every 15 min.', acc: '91.6%' },
  { code: 'HSCODE', name: lang.value === 'tr' ? 'HS kod tahmini' : 'HS code prediction', desc: lang.value === 'tr' ? 'Ürün başlık + açıklamadan 6 haneli gümrük kodu; 180+ ülke uyumlu.' : '6-digit HS code from product title + description; 180+ countries.', acc: '96.8%' },
  { code: 'ADDR', name: lang.value === 'tr' ? 'Adres doğrulama' : 'Address validation', desc: lang.value === 'tr' ? 'Tutarsız uluslararası adresleri normalize eder; teslim başarısı +%23.' : 'Normalizes inconsistent international addresses; +23% delivery success.', acc: '98.1%' },
  { code: 'CAT', name: lang.value === 'tr' ? 'Kategori sınıflandırma' : 'Category classification', desc: lang.value === 'tr' ? 'Etsy/Shopify ürünlerini kargo kategorilerine eşler.' : 'Maps Etsy/Shopify products to shipping categories.', acc: '93.4%' },
  { code: 'RETURN', name: lang.value === 'tr' ? 'İade tahmini' : 'Returns forecasting', desc: lang.value === 'tr' ? 'Sipariş başında iade olasılığı; sigorta önerisi tetikler.' : 'Predicts return likelihood at order time; triggers insurance suggestion.', acc: '87.9%' },
  { code: 'CUST', name: lang.value === 'tr' ? 'Gümrük kuralı motoru' : 'Customs rules engine', desc: lang.value === 'tr' ? 'Ülkeden ülkeye değişen istisnaları yönetir; 14k kural setiyle eğitildi.' : 'Handles country-by-country exceptions; trained on 14k rule set.', acc: '92.0%' },
])
</script>

<template>
  <section id="ai" class="ai-section">
    <div class="grid-bg" />
    <div class="glow" />

    <div class="container inner">
      <div class="layout">
        <div class="left">
          <div class="eyebrow accent">{{ t.ai.eyebrow }}</div>
          <h2 class="h-1 light-title">
            <template v-for="(line, i) in titleLines" :key="i">
              {{ line }}<br v-if="i < titleLines.length - 1" />
            </template>
          </h2>
          <p class="lede sub">{{ t.ai.sub }}</p>
          <RouteMap />
        </div>

        <div class="right">
          <div class="row table-head">
            <span class="mono">{{ lang === 'tr' ? 'Modül' : 'Module' }}</span>
            <span class="mono">{{ lang === 'tr' ? 'Doğruluk' : 'Accuracy' }}</span>
          </div>
          <div
            v-for="(m, i) in modules"
            :key="m.code"
            class="row module fade-up"
            :style="{ animationDelay: `${i * 0.06}s` }"
          >
            <span class="mono code">{{ m.code }}</span>
            <div class="col" style="flex: 1; gap: 2px">
              <span class="m-name">{{ m.name }}</span>
              <span class="m-desc">{{ m.desc }}</span>
            </div>
            <span class="mono acc">{{ m.acc }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-section {
  padding: 96px 0;
  position: relative;
  overflow: hidden;
  background: var(--ink-1);
  color: var(--bg);
}
.grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 64px 64px;
  -webkit-mask-image: radial-gradient(ellipse 80% 80% at 30% 50%, black 30%, transparent 75%);
          mask-image: radial-gradient(ellipse 80% 80% at 30% 50%, black 30%, transparent 75%);
}
.glow {
  position: absolute; top: -100px; right: -100px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, oklch(0.55 0.18 268 / 0.4), transparent 60%);
}
.inner { position: relative; z-index: 1; }
.layout { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
.left { display: flex; flex-direction: column; gap: 16px; max-width: 540px; }
.eyebrow.accent { color: oklch(0.78 0.10 268); }
.light-title { margin: 0; color: var(--bg); }
.sub { margin: 0; color: oklch(0.78 0.01 265); }

.right { display: flex; flex-direction: column; gap: 8px; }
.table-head {
  justify-content: space-between;
  padding: 0 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.table-head span {
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: oklch(0.65 0.01 265);
}
.module {
  padding: 16px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.025);
  gap: 14px;
}
.code {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  padding: 3px 7px; border-radius: 4px;
  background: var(--accent); color: white;
  flex: 0 0 auto;
}
.m-name { font-size: 14px; font-weight: 600; color: var(--bg); }
.m-desc { font-size: 12.5px; color: oklch(0.72 0.008 265); line-height: 1.4; }
.acc {
  font-family: var(--font-display); font-size: 18px; font-weight: 600;
  color: oklch(0.85 0.10 268);
  flex: 0 0 auto;
}

@media (max-width: 860px) {
  .ai-section { padding: 72px 0; }
  .layout { grid-template-columns: 1fr; }
}
</style>
