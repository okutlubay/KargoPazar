<script setup>
import { ref, computed } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, lang } = useI18n()

const STORES = [
  { code: 'etsy', name: 'Etsy', color: '#F1641E', logo: 'Etsy', desc: { tr: 'Etsy mağazanızı bağlayın, yapımcı dostu fiyatlar.', en: 'Connect your Etsy shop, maker-friendly rates.' } },
  { code: 'shopify', name: 'Shopify', color: '#5E8E3E', logo: 'S', desc: { tr: 'Shopify mağazanız için tek tıkla kurulum.', en: 'One-click setup for your Shopify store.' } },
  { code: 'woo', name: 'WooCommerce', color: '#7F54B3', logo: 'Woo', desc: { tr: 'WordPress + Woo mağazaları için resmi eklenti.', en: 'Official plugin for WordPress + Woo stores.' } },
  { code: 'amazon', name: 'Amazon', color: '#FF9900', logo: 'a', desc: { tr: 'Amazon SPN sertifikalı entegrasyon (yakında).', en: 'Amazon SPN-certified integration (soon).' }, soon: true },
  { code: 'ebay', name: 'eBay', color: '#E53238', logo: 'eb', desc: { tr: 'eBay Trading API ile tam senkronizasyon.', en: 'Full sync via eBay Trading API.' } },
  { code: 'ttu', name: "Trendyol Int'l", color: '#F27A1A', logo: 'TY', desc: { tr: 'Trendyol uluslararası gönderiler için.', en: 'For Trendyol international shipments.' } },
]

const selected = ref('etsy')
const step = ref(0)

const store = computed(() => STORES.find(s => s.code === selected.value))

const pick = (code) => { selected.value = code; step.value = 0 }

const oauthScopes = computed(() => [
  [lang.value === 'tr' ? 'Sipariş listesi & detayları' : 'Order list & details', 'read'],
  [lang.value === 'tr' ? 'Ürün katalog & stok' : 'Product catalog & inventory', 'read/write'],
  [lang.value === 'tr' ? 'Müşteri adres bilgileri' : 'Customer addresses', 'read'],
  [lang.value === 'tr' ? 'Kargo durumu güncellemesi' : 'Shipping status updates', 'write'],
])

const stepLabel = computed(() => {
  if (step.value === 0) return lang.value === 'tr' ? 'Mağaza seç' : 'Pick store'
  if (step.value === 1) return 'OAuth'
  return lang.value === 'tr' ? 'Bağlandı' : 'Connected'
})

const browserUrl = computed(() => {
  if (step.value === 0) return 'app.kargopazar.com/connect'
  if (step.value === 1) return `${store.value.code}.com/oauth/authorize`
  return 'app.kargopazar.com/connected'
})
</script>

<template>
  <section id="integrations" class="section">
    <div class="container">
      <SectionHeader :eyebrow="t.integrations.eyebrow" :title="t.integrations.title" :sub="t.integrations.sub" />

      <div class="layout">
        <!-- Store list -->
        <div class="card list">
          <div class="mono list-head">{{ lang === 'tr' ? 'Pazaryeri seçin' : 'Pick a marketplace' }}</div>
          <div class="col" style="gap: 2px">
            <button
              v-for="s in STORES"
              :key="s.code"
              :class="['store-btn', { active: selected === s.code }]"
              @click="pick(s.code)"
            >
              <span class="store-logo" :style="{ background: s.color }">{{ s.logo }}</span>
              <div class="col" style="flex: 1; gap: 2px">
                <span class="row" style="gap: 8px">
                  <span class="store-name">{{ s.name }}</span>
                  <span v-if="s.soon" class="mono soon">{{ lang === 'tr' ? 'Yakında' : 'Soon' }}</span>
                </span>
                <span class="store-desc">{{ s.desc[lang] }}</span>
              </div>
              <Icon v-if="selected === s.code" name="arrow" />
            </button>
          </div>
        </div>

        <!-- OAuth flow -->
        <div class="card flow">
          <div class="window-bar">
            <div class="dots">
              <span class="dot dot-r" />
              <span class="dot dot-y" />
              <span class="dot dot-g" />
            </div>
            <div class="mono url">{{ browserUrl }}</div>
            <div style="width: 50px" />
          </div>

          <!-- Step 0: connect start -->
          <div v-if="step === 0" class="screen center">
            <div class="store-big" :style="{ background: store.color }">{{ store.logo }}</div>
            <div class="col" style="gap: 6px; align-items: center">
              <h3 class="h-3" style="margin: 0">{{ store.name }} {{ lang === 'tr' ? 'mağazanı bağla' : 'store' }}</h3>
              <p class="screen-sub">
                <template v-if="lang === 'tr'">
                  {{ store.name }} hesabınla güvenli OAuth bağlantısı kuracağız. Şifrenizi asla görmüyoruz.
                </template>
                <template v-else>
                  We'll establish a secure OAuth connection with your {{ store.name }} account. We never see your password.
                </template>
              </p>
            </div>
            <button class="btn btn-accent" @click="step = 1">
              <Icon name="lock" />
              {{ lang === 'tr' ? `${store.name} ile bağlan` : `Connect with ${store.name}` }}
            </button>
            <div class="row mono trust">
              <span class="row" style="gap: 4px"><Icon name="lock" :size="11" /> 256-bit TLS</span>
              <span>·</span><span>OAuth 2.0</span><span>·</span><span>SOC 2</span>
            </div>
          </div>

          <!-- Step 1: OAuth -->
          <div v-else-if="step === 1" class="screen oauth">
            <div class="row" style="gap: 10px; justify-content: center">
              <div class="oauth-icon dark">
                <Icon name="logo" :size="22" />
              </div>
              <div class="row" style="gap: 4px; color: var(--ink-4)">
                <span v-for="i in 3" :key="i" class="oauth-dot" />
              </div>
              <div class="oauth-icon" :style="{ background: store.color }">{{ store.logo }}</div>
            </div>
            <h3 class="h-3" style="margin: 0; text-align: center">
              {{ lang === 'tr' ? "KargoPazar'a izin ver" : 'Authorize KargoPazar' }}
            </h3>
            <p class="screen-sub" style="text-align: center">
              <template v-if="lang === 'tr'">
                Bu uygulama {{ store.name }} hesabınızdaki şu bilgilere erişmek istiyor:
              </template>
              <template v-else>
                This app wants to access the following on your {{ store.name }} account:
              </template>
            </p>
            <div class="card-soft scope-list">
              <div
                v-for="([label, scope], i) in oauthScopes"
                :key="i"
                :class="['scope-row', { sep: i > 0 }]"
              >
                <span class="check"><Icon name="check" /></span>
                <span class="scope-label">{{ label }}</span>
                <span class="mono scope-tag">{{ scope }}</span>
              </div>
            </div>
            <div class="row" style="gap: 8px">
              <button class="btn btn-ghost" style="flex: 1" @click="step = 0">{{ lang === 'tr' ? 'İptal' : 'Cancel' }}</button>
              <button class="btn btn-accent" style="flex: 2" @click="step = 2">{{ lang === 'tr' ? 'İzin ver ve bağla' : 'Authorize and connect' }}</button>
            </div>
          </div>

          <!-- Step 2: connected -->
          <div v-else class="screen center">
            <div class="success-circle"><Icon name="check" :size="26" /></div>
            <div class="col" style="gap: 6px; align-items: center">
              <h3 class="h-3" style="margin: 0">{{ store.name }} {{ lang === 'tr' ? 'bağlandı' : 'connected' }}</h3>
              <p class="screen-sub">{{ lang === 'tr' ? 'Siparişler senkronize ediliyor…' : 'Syncing orders…' }}</p>
            </div>
            <div class="card-soft sync-stats">
              <div class="row sync-row">
                <div class="col sync-stat"><span class="num">284</span><span class="mono lbl">{{ lang === 'tr' ? 'Sipariş' : 'Orders' }}</span></div>
                <div class="vdiv" />
                <div class="col sync-stat"><span class="num">56</span><span class="mono lbl">{{ lang === 'tr' ? 'Ürün' : 'Products' }}</span></div>
                <div class="vdiv" />
                <div class="col sync-stat"><span class="num">192</span><span class="mono lbl">{{ lang === 'tr' ? 'Müşteri' : 'Customers' }}</span></div>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" @click="step = 0">{{ lang === 'tr' ? 'Tekrar dene' : 'Try again' }}</button>
          </div>

          <div class="footer-bar">
            <div class="row" style="gap: 6px">
              <span v-for="i in 3" :key="i" :class="['progress', { done: i - 1 <= step }]" />
            </div>
            <span class="mono step-label">{{ step + 1 }}/3 — {{ stepLabel }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.layout {
  margin-top: 56px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: stretch;
}
.list { padding: 8px; }
.list-head {
  padding: 12px 12px 8px;
  font-size: 10.5px; color: var(--ink-4);
  letter-spacing: 0.08em; text-transform: uppercase;
}
.store-btn {
  border: 0; text-align: left;
  padding: 12px; border-radius: 8px;
  background: transparent;
  display: flex; align-items: center; gap: 12px;
  width: 100%;
}
.store-btn.active { background: var(--bg-2); }
.store-logo {
  width: 36px; height: 36px; border-radius: 8px;
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 14px;
}
.store-name { font-weight: 600; font-size: 14.5px; }
.soon {
  font-size: 9.5px; padding: 1px 6px; border-radius: 3px;
  background: var(--bg-3); color: var(--ink-3);
  letter-spacing: 0.04em; text-transform: uppercase;
}
.store-desc { font-size: 12px; color: var(--ink-3); line-height: 1.4; }

.flow { overflow: hidden; display: flex; flex-direction: column; }
.window-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-2);
}
.dots { display: flex; align-items: center; gap: 6px; }
.dots .dot { width: 9px; height: 9px; border-radius: 999px; }
.dots .dot-r { background: #FF5F57; }
.dots .dot-y { background: #FEBC2E; }
.dots .dot-g { background: #28C840; }
.url { font-size: 11px; color: var(--ink-3); }

.screen {
  padding: 32px; flex: 1;
  display: flex; flex-direction: column; gap: 18px;
}
.screen.center { justify-content: center; align-items: center; text-align: center; }
.screen.oauth { padding: 28px; }

.store-big {
  width: 56px; height: 56px; border-radius: 12px;
  color: white; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 22px;
}
.screen-sub { margin: 0; font-size: 13.5px; color: var(--ink-3); max-width: 320px; line-height: 1.5; }
.trust { gap: 16px; font-size: 11px; color: var(--ink-4); margin-top: 8px; }

.oauth-icon {
  width: 40px; height: 40px; border-radius: 8px;
  color: white; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 16px;
}
.oauth-icon.dark { background: var(--ink-1); }
.oauth-dot { width: 4px; height: 4px; border-radius: 999px; background: var(--ink-4); }

.scope-list { padding: 14px; background: var(--bg-2); }
.scope-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0;
}
.scope-row.sep { border-top: 1px dashed var(--line-2); }
.check { color: var(--success); }
.scope-label { font-size: 13px; flex: 1; }
.scope-tag { font-size: 10.5px; color: var(--ink-4); text-transform: uppercase; letter-spacing: 0.05em; }

.success-circle {
  width: 56px; height: 56px; border-radius: 999px;
  background: var(--success); color: white;
  display: flex; align-items: center; justify-content: center;
}
.sync-stats { padding: 16px; width: 100%; background: var(--bg-2); }
.sync-row { justify-content: space-around; }
.sync-stat { gap: 2px; }
.sync-stat .num { font-family: var(--font-display); font-size: 22px; font-weight: 600; }
.sync-stat .lbl { font-size: 10px; color: var(--ink-4); text-transform: uppercase; letter-spacing: 0.06em; }
.vdiv { width: 1px; align-self: stretch; background: var(--line-1); }

.footer-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 1px solid var(--line-1);
  background: var(--bg-2); margin-top: auto;
}
.progress { height: 4px; width: 28px; border-radius: 999px; background: var(--line-2); }
.progress.done { background: var(--accent); }
.step-label { font-size: 11px; color: var(--ink-3); }
</style>
