<script setup>
import { ref, computed } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, lang } = useI18n()

const tab = ref('shipments')

const opItems = computed(() => [
  { key: 'shipments', label: lang.value === 'tr' ? 'Gönderiler' : 'Shipments', icon: 'truck', count: '324' },
  { key: 'orders', label: lang.value === 'tr' ? 'Siparişler' : 'Orders', icon: 'box', count: '1.2k' },
  { key: 'customers', label: lang.value === 'tr' ? 'Müşteriler' : 'Customers', icon: 'pin', count: '892' },
])

const integrationItems = [
  { key: 'etsy', label: 'Etsy', count: '284' },
  { key: 'shopify', label: 'Shopify', count: '156' },
  { key: 'woo', label: 'WooCommerce', count: '38' },
]

const stats = computed(() => [
  { l: lang.value === 'tr' ? 'Bu ay gönderi' : 'Shipments / mo', v: '1,284', d: '+18%', up: true },
  { l: lang.value === 'tr' ? 'Tasarruf' : 'Savings', v: '$3,420', d: '+24%', up: true },
  { l: lang.value === 'tr' ? 'Ort. teslim' : 'Avg delivery', v: '4.2d', d: '-0.6d', up: true },
  { l: lang.value === 'tr' ? 'Müşteri' : 'Satisfaction', v: '4.8/5', d: '+0.2', up: true },
])

const shipments = [
  { id: 'SH-2814', to: 'Ann Brewer · MA, US', carrier: 'DHL Express', price: 38.40, status: 'in-transit', eta: '2 days' },
  { id: 'SH-2813', to: 'Lukas Müller · Berlin, DE', carrier: 'DHL Express', price: 24.80, status: 'delivered', eta: '—' },
  { id: 'SH-2812', to: 'Yuki Tanaka · Tokyo, JP', carrier: "FedEx Int'l", price: 52.10, status: 'in-transit', eta: '4 days' },
  { id: 'SH-2811', to: 'Sophie Dubois · Paris, FR', carrier: 'DHL Express', price: 22.40, status: 'label-printed', eta: '—' },
  { id: 'SH-2810', to: 'James Wilson · London, UK', carrier: 'Royal Mail', price: 19.80, status: 'delivered', eta: '—' },
  { id: 'SH-2809', to: 'Emma Walsh · Sydney, AU', carrier: 'DHL Express', price: 64.20, status: 'customs', eta: '5 days' },
  { id: 'SH-2808', to: 'Carlos Ramos · Madrid, ES', carrier: 'Aramex', price: 18.40, status: 'delivered', eta: '—' },
]

const statusMap = computed(() => ({
  'in-transit': { l: lang.value === 'tr' ? 'Yolda' : 'In transit', c: 'var(--accent)', bg: 'var(--accent-soft)' },
  'delivered': { l: lang.value === 'tr' ? 'Teslim edildi' : 'Delivered', c: 'var(--success)', bg: 'oklch(0.95 0.05 155)' },
  'label-printed': { l: lang.value === 'tr' ? 'Etiket hazır' : 'Label ready', c: 'var(--ink-2)', bg: 'var(--bg-3)' },
  'customs': { l: lang.value === 'tr' ? 'Gümrükte' : 'Customs', c: 'var(--warning)', bg: 'oklch(0.95 0.06 75)' },
}))

const storeName = (k) => ({ etsy: 'Etsy', shopify: 'Shopify', woo: 'WooCommerce' })[k]
</script>

<template>
  <section id="dashboard" class="section">
    <div class="container">
      <SectionHeader :eyebrow="t.dashboard.eyebrow" :title="t.dashboard.title" :sub="t.dashboard.sub" />

      <div class="dash">
        <!-- top bar -->
        <div class="topbar">
          <div class="dots">
            <span class="dot dot-r" /><span class="dot dot-y" /><span class="dot dot-g" />
          </div>
          <div class="row mono url">
            <Icon name="lock" :size="11" /> app.kargopazar.com/{{ tab }}
          </div>
          <div class="row" style="gap: 8px">
            <button class="ico-btn"><Icon name="search" :size="13" /></button>
            <button class="ico-btn"><Icon name="bell" :size="13" /></button>
            <span class="avatar">FC</span>
          </div>
        </div>

        <div class="body">
          <!-- sidebar -->
          <aside class="side">
            <div class="mono group-label">{{ lang === 'tr' ? 'Operasyon' : 'Operations' }}</div>
            <button
              v-for="it in opItems"
              :key="it.key"
              :class="['side-item', { active: tab === it.key }]"
              @click="tab = it.key"
            >
              <Icon :name="it.icon" :size="15" />
              <span class="lbl">{{ it.label }}</span>
              <span class="mono cnt">{{ it.count }}</span>
            </button>
            <div class="mono group-label">{{ lang === 'tr' ? 'Entegrasyonlar' : 'Integrations' }}</div>
            <button
              v-for="it in integrationItems"
              :key="it.key"
              :class="['side-item', { active: tab === it.key }]"
              @click="tab = it.key"
            >
              <span class="dot-pin" />
              <span class="lbl">{{ it.label }}</span>
              <span class="mono cnt">{{ it.count }}</span>
            </button>
          </aside>

          <!-- main -->
          <div class="main">
            <!-- shipments -->
            <div v-if="tab === 'shipments'" class="col" style="gap: 20px">
              <div class="row" style="justify-content: space-between">
                <div>
                  <h3 class="h-2" style="margin: 0">{{ lang === 'tr' ? 'Gönderiler' : 'Shipments' }}</h3>
                  <p class="head-sub">{{ lang === 'tr' ? 'Tüm aktif ve geçmiş gönderiler' : 'All active and past shipments' }}</p>
                </div>
                <div class="row" style="gap: 8px">
                  <button class="btn btn-ghost btn-sm">{{ lang === 'tr' ? 'Filtre' : 'Filter' }}</button>
                  <button class="btn btn-primary btn-sm"><Icon name="spark" /> {{ lang === 'tr' ? 'Yeni gönderi' : 'New shipment' }}</button>
                </div>
              </div>

              <div class="stats-grid">
                <div v-for="(s, i) in stats" :key="i" class="card stat-card">
                  <div class="mono lbl">{{ s.l }}</div>
                  <div class="row" style="align-items: baseline; gap: 8px">
                    <span class="val">{{ s.v }}</span>
                    <span :class="['delta', { up: s.up }]">{{ s.d }}</span>
                  </div>
                </div>
              </div>

              <div class="card table-card">
                <div class="row mono table-head">
                  <div style="flex: 0 0 90px">ID</div>
                  <div style="flex: 2">{{ lang === 'tr' ? 'Alıcı' : 'Recipient' }}</div>
                  <div style="flex: 1.4">{{ lang === 'tr' ? 'Taşıyıcı' : 'Carrier' }}</div>
                  <div style="flex: 1">{{ lang === 'tr' ? 'Durum' : 'Status' }}</div>
                  <div style="flex: 0.8">ETA</div>
                  <div style="flex: 0.8; text-align: right">{{ lang === 'tr' ? 'Tutar' : 'Amount' }}</div>
                </div>
                <div
                  v-for="(s, i) in shipments"
                  :key="s.id"
                  :class="['row', 'table-row', { last: i === shipments.length - 1 }]"
                >
                  <div class="mono id" style="flex: 0 0 90px">{{ s.id }}</div>
                  <div style="flex: 2; font-weight: 500">{{ s.to }}</div>
                  <div style="flex: 1.4; color: var(--ink-2)">{{ s.carrier }}</div>
                  <div style="flex: 1">
                    <span class="row pill-status" :style="{ background: statusMap[s.status].bg, color: statusMap[s.status].c }">
                      <span class="status-dot" :style="{ background: statusMap[s.status].c }" />
                      {{ statusMap[s.status].l }}
                    </span>
                  </div>
                  <div class="eta" style="flex: 0.8">{{ s.eta }}</div>
                  <div class="mono price" style="flex: 0.8">${{ s.price.toFixed(2) }}</div>
                </div>
              </div>
            </div>

            <!-- orders -->
            <div v-else-if="tab === 'orders'" class="col" style="gap: 20px">
              <h3 class="h-2" style="margin: 0">{{ lang === 'tr' ? 'Siparişler' : 'Orders' }}</h3>
              <div class="placeholder ph">{{ lang === 'tr' ? 'SİPARİŞ TABLOSU' : 'ORDERS TABLE' }}</div>
            </div>

            <!-- customers -->
            <div v-else-if="tab === 'customers'" class="col" style="gap: 20px">
              <h3 class="h-2" style="margin: 0">{{ lang === 'tr' ? 'Müşteriler' : 'Customers' }}</h3>
              <div class="placeholder ph">{{ lang === 'tr' ? 'MÜŞTERİ HARİTASI' : 'CUSTOMERS MAP' }}</div>
            </div>

            <!-- store views -->
            <div v-else class="col" style="gap: 20px">
              <div class="row" style="gap: 10px">
                <h3 class="h-2" style="margin: 0">{{ storeName(tab) }}</h3>
                <span class="pill"><span class="dot" />{{ lang === 'tr' ? 'Bağlı' : 'Connected' }}</span>
              </div>
              <div class="placeholder ph">{{ storeName(tab).toUpperCase() }} ORDERS</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dash {
  margin-top: 56px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--line-1);
  overflow: hidden;
}
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  height: 48px; padding: 0 16px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-2);
}
.dots { display: flex; align-items: center; gap: 6px; }
.dots .dot { width: 11px; height: 11px; border-radius: 999px; }
.dots .dot-r { background: #FF5F57; }
.dots .dot-y { background: #FEBC2E; }
.dots .dot-g { background: #28C840; }
.url {
  gap: 6px; font-size: 11.5px; color: var(--ink-3);
  padding: 5px 12px; background: white;
  border-radius: 6px; border: 1px solid var(--line-1);
}
.ico-btn {
  width: 28px; height: 28px;
  border: 1px solid var(--line-2); border-radius: 6px;
  background: var(--surface);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink-3);
}
.avatar {
  width: 28px; height: 28px; border-radius: 999px;
  background: var(--accent); color: white;
  font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}

.body { display: grid; grid-template-columns: 220px 1fr; min-height: 600px; }
.side { border-right: 1px solid var(--line-1); padding: 14px; background: var(--bg-2); }
.group-label {
  font-size: 10px; color: var(--ink-4);
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 6px 10px 8px;
}
.group-label:nth-of-type(2) { padding-top: 16px; }
.side-item {
  width: 100%; padding: 8px 10px;
  border: 0; border-radius: 7px;
  display: flex; align-items: center; gap: 10px;
  background: transparent;
  color: var(--ink-2);
  font-weight: 500; font-size: 13.5px;
  margin-bottom: 1px;
}
.side-item.active { background: var(--surface); color: var(--ink-1); font-weight: 600; box-shadow: var(--shadow-sm); }
.side-item .lbl { flex: 1; text-align: left; }
.side-item .cnt { font-size: 11px; color: var(--ink-4); }
.dot-pin { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); flex: 0 0 auto; }

.main { padding: 24px; overflow: hidden; }
.head-sub { margin: 4px 0 0; font-size: 13.5px; color: var(--ink-3); }

.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat-card { padding: 16px; }
.stat-card .lbl { font-size: 10px; color: var(--ink-4); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
.stat-card .val { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
.delta { font-size: 11.5px; font-weight: 600; color: var(--danger); }
.delta.up { color: var(--success); }

.table-card { overflow: hidden; }
.table-head {
  padding: 10px 16px; background: var(--bg-2);
  border-bottom: 1px solid var(--line-1);
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-4);
}
.table-row { padding: 12px 16px; border-bottom: 1px solid var(--line-1); font-size: 13.5px; }
.table-row.last { border-bottom: none; }
.id { font-size: 12px; color: var(--ink-3); }
.eta { color: var(--ink-2); font-size: 12.5px; }
.price { text-align: right; font-weight: 600; }

.pill-status {
  display: inline-flex; gap: 5px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600;
}
.status-dot { width: 5px; height: 5px; border-radius: 999px; }

.ph { min-height: 480px; }

@media (max-width: 860px) {
  .body { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
