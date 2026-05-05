<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, lang } = useI18n()

const items = [
  { icon: 'truck', title: '30+ uluslararası taşıyıcı', en: '30+ international carriers', desc: 'DHL, FedEx, UPS, Aramex, TNT ve yerel taşıyıcılar tek API üzerinden. Saniyede 12 fiyat sorgusu.', enDesc: 'DHL, FedEx, UPS, Aramex, TNT and local carriers via single API. 12 rate quotes per second.', tag: 'Çekirdek' },
  { icon: 'brain', title: 'AI rota & fiyat motoru', en: 'AI route & price engine', desc: 'Geçmiş 12M gönderiden öğrenen 7 ayrı model: rota, fiyat, gümrük, adres, kategori, hacim, iade tahmini.', enDesc: '7 models trained on 12M shipments: route, price, customs, address, category, volume, returns.', tag: 'AI' },
  { icon: 'box', title: 'Etsy & Shopify entegrasyonu', en: 'Etsy & Shopify integration', desc: 'OAuth ile bağlan; siparişler, ürünler ve müşteriler otomatik akar. Çift yönlü stok senkronu.', enDesc: 'Connect via OAuth; orders, products, customers flow automatically. Two-way inventory sync.', tag: 'Pazaryeri' },
  { icon: 'globe', title: 'Otomatik gümrük dokümanları', en: 'Automated customs docs', desc: 'HS kod tahmini, fatura, CN22/CN23 ve menşe sertifikası otomatik. 180+ ülke kuralı.', enDesc: 'HS code prediction, commercial invoice, CN22/CN23 and origin certificate automated. 180+ countries.', tag: 'Gümrük' },
  { icon: 'lock', title: 'Kendi kargo hesabınız', en: 'Your own carrier account', desc: 'Anlaşmalı tarifeleriniz varsa hesabınızı bağlayın. OAuth tabanlı yetkilendirme; veriniz şifrelenir.', enDesc: 'Already have negotiated rates? Connect your account. OAuth authorization; data encrypted at rest.', tag: 'Esnek' },
  { icon: 'bolt', title: 'Toplu etiket & manifest', en: 'Bulk labels & manifest', desc: '100 siparişi 1 dakikada işleyin. PDF etiket havuzu, taşıyıcı bazlı manifest, otomatik birleştirme.', enDesc: 'Process 100 orders in 1 minute. PDF label batch, per-carrier manifest, auto-grouping.', tag: 'Operasyon' },
]

const titleFor = (it) => lang.value === 'tr' ? it.title : it.en
const descFor = (it) => lang.value === 'tr' ? it.desc : it.enDesc
</script>

<template>
  <section id="product" class="section">
    <div class="container">
      <SectionHeader :eyebrow="t.features.eyebrow" :title="t.features.title" :sub="t.features.sub" />
      <div class="grid">
        <div v-for="(it, i) in items" :key="i" class="feature-card">
          <div class="head">
            <div class="icon-tile">
              <Icon :name="it.icon" :size="16" />
            </div>
            <span class="mono tag">{{ it.tag }}</span>
          </div>
          <h3 class="h-3">{{ titleFor(it) }}</h3>
          <p class="desc">{{ descFor(it) }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1px;
  background: var(--line-1);
  border: 1px solid var(--line-1);
  border-radius: 16px;
  overflow: hidden;
  margin-top: 56px;
}
.feature-card {
  background: var(--surface);
  padding: 32px 28px;
  min-height: 210px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: background 0.2s;
}
.feature-card:hover { background: var(--bg-2); }
.head { display: flex; align-items: center; justify-content: space-between; }
.icon-tile {
  width: 36px; height: 36px; border-radius: 8px;
  background: var(--accent-soft); color: var(--accent-ink);
  display: flex; align-items: center; justify-content: center;
}
.tag {
  font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-4); font-weight: 500;
}
.h-3 { margin: 0; }
.desc { margin: 0; font-size: 14.5px; color: var(--ink-2); line-height: 1.55; }
</style>
