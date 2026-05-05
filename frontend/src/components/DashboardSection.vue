<script setup lang="ts">
import { ref, computed } from 'vue';
import { t, currentLang } from '../i18n';
import Icons from './Icons.vue';

const lang = computed(() => currentLang.value);
const tab = ref('shipments');

const shipments = [
  { id: 'SH-2814', to: 'Ann Brewer · MA, US', carrier: 'DHL Express', price: 38.40, status: 'in-transit', eta: '2 days' },
  { id: 'SH-2813', to: 'Lukas Müller · Berlin, DE', carrier: 'DHL Express', price: 24.80, status: 'delivered', eta: '—' },
  { id: 'SH-2812', to: 'Yuki Tanaka · Tokyo, JP', carrier: "FedEx Int'l", price: 52.10, status: 'in-transit', eta: '4 days' },
  { id: 'SH-2811', to: 'Sophie Dubois · Paris, FR', carrier: 'DHL Express', price: 22.40, status: 'label-printed', eta: '—' },
  { id: 'SH-2810', to: 'James Wilson · London, UK', carrier: 'Royal Mail', price: 19.80, status: 'delivered', eta: '—' },
  { id: 'SH-2809', to: 'Emma Walsh · Sydney, AU', carrier: 'DHL Express', price: 64.20, status: 'customs', eta: '5 days' },
  { id: 'SH-2808', to: 'Carlos Ramos · Madrid, ES', carrier: 'Aramex', price: 18.40, status: 'delivered', eta: '—' },
];

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  'in-transit': { label: lang.value === 'tr' ? 'Yolda' : 'In transit', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  'delivered': { label: lang.value === 'tr' ? 'Teslim edildi' : 'Delivered', color: 'var(--success)', bg: 'oklch(0.95 0.05 155)' },
  'label-printed': { label: lang.value === 'tr' ? 'Etiket hazır' : 'Label ready', color: 'var(--ink-2)', bg: 'var(--bg-3)' },
  'customs': { label: lang.value === 'tr' ? 'Gümrükte' : 'Customs', color: 'var(--warning)', bg: 'oklch(0.95 0.06 75)' },
};

const stats = [
  { label: lang.value === 'tr' ? 'Bu ay gönderi' : 'Shipments / mo', value: '1,284', trend: '+18%', up: true },
  { label: lang.value === 'tr' ? 'Tasarruf' : 'Savings', value: '$3,420', trend: '+24%', up: true },
  { label: lang.value === 'tr' ? 'Ort. teslim' : 'Avg delivery', value: '4.2d', trend: '-0.6d', up: true },
  { label: lang.value === 'tr' ? 'Müşteri' : 'Satisfaction', value: '4.8/5', trend: '+0.2', up: true },
];
</script>

<template>
  <section id="dashboard" class="section">
    <div class="container">
      <div style="text-align: center; margin-bottom: 56px;">
        <div class="eyebrow">{{ t.dashboard.eyebrow }}</div>
        <h2 class="h-1" style="margin: 12px 0 16px;">{{ t.dashboard.title }}</h2>
        <p class="lede" style="margin: 0; max-width: 680px; margin-left: auto; margin-right: auto;">{{ t.dashboard.sub }}</p>
      </div>

      <div style="border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-lg); border: 1px solid var(--line-1); overflow: hidden;">
        <!-- Top bar -->
        <div class="spread" style="height: 48px; padding: 0 16px; border-bottom: 1px solid var(--line-1); background: var(--bg-2);">
          <div class="row" style="gap: 6px;">
            <span style="width: 11px; height: 11px; border-radius: 999px; background: #FF5F57;"></span>
            <span style="width: 11px; height: 11px; border-radius: 999px; background: #FEBC2E;"></span>
            <span style="width: 11px; height: 11px; border-radius: 999px; background: #28C840;"></span>
          </div>
          <div class="row mono" style="gap: 6px; font-size: 11.5px; color: var(--ink-3); padding: 5px 12px; background: white; border-radius: 6px; border: 1px solid var(--line-1);">
            <Icons name="lock" :size="11" /> app.kargopazaryeri.com/{{ tab }}
          </div>
          <div class="row" style="gap: 8px;">
            <button style="width: 28px; height: 28px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); display: inline-flex; align-items: center; justify-content: center; color: var(--ink-3); cursor: pointer;">
              <Icons name="search" :size="13" />
            </button>
            <button style="width: 28px; height: 28px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); display: inline-flex; align-items: center; justify-content: center; color: var(--ink-3); cursor: pointer;">
              <Icons name="bell" :size="13" />
            </button>
            <span style="width: 28px; height: 28px; border-radius: 999px; background: var(--accent); color: white; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;">FC</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 220px 1fr; min-height: 600px;">
          <!-- Sidebar -->
          <aside style="border-right: 1px solid var(--line-1); padding: 14px; background: var(--bg-2);">
            <div class="mono" style="font-size: 10px; color: var(--ink-4); letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 10px 8px;">
              {{ lang === 'tr' ? 'Operasyon' : 'Operations' }}
            </div>
            <button
              v-for="[k, l, icon] in [['shipments', lang === 'tr' ? 'Gönderiler' : 'Shipments', 'truck'], ['orders', lang === 'tr' ? 'Siparişler' : 'Orders', 'box'], ['customers', lang === 'tr' ? 'Müşteriler' : 'Customers', 'pin']]"
              :key="k"
              @click="tab = k"
              :style="{
                width: '100%',
                padding: '8px 10px',
                border: 0,
                borderRadius: '7px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: tab === k ? 'var(--surface)' : 'transparent',
                color: tab === k ? 'var(--ink-1)' : 'var(--ink-2)',
                fontWeight: tab === k ? 600 : 500,
                fontSize: '13.5px',
                boxShadow: tab === k ? 'var(--shadow-sm)' : 'none',
                marginBottom: '1px',
                cursor: 'pointer',
              }"
            >
              <Icons :name="icon" :size="15" />
              <span style="flex: 1; text-align: left;">{{ l }}</span>
            </button>
          </aside>

          <!-- Main -->
          <div style="padding: 24px; overflow: hidden;">
            <template v-if="tab === 'shipments'">
              <div class="col" style="gap: 20px;">
                <div class="spread">
                  <div>
                    <h3 class="h-2" style="margin: 0;">{{ lang === 'tr' ? 'Gönderiler' : 'Shipments' }}</h3>
                    <p style="margin: 4px 0 0; font-size: 13.5px; color: var(--ink-3);">{{ lang === 'tr' ? 'Tüm aktif ve geçmiş gönderiler' : 'All active and past shipments' }}</p>
                  </div>
                  <div class="row" style="gap: 8px;">
                    <button class="btn btn-ghost btn-sm">{{ lang === 'tr' ? 'Filtre' : 'Filter' }}</button>
                    <button class="btn btn-primary btn-sm">
                      <Icons name="spark" /> {{ lang === 'tr' ? 'Yeni gönderi' : 'New shipment' }}
                    </button>
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
                  <div v-for="(s, i) in stats" :key="i" class="card" style="padding: 16px;">
                    <div class="mono" style="font-size: 10px; color: var(--ink-4); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px;">
                      {{ s.label }}
                    </div>
                    <div class="row" style="align-items: baseline; gap: 8px;">
                      <span style="font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.01em;">{{ s.value }}</span>
                      <span style="font-size: 11.5px; font-weight: 600; color: var(--success);">{{ s.trend }}</span>
                    </div>
                  </div>
                </div>

                <div class="card" style="overflow: hidden;">
                  <div class="row mono" style="padding: 10px 16px; background: var(--bg-2); border-bottom: 1px solid var(--line-1); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-4);">
                    <div style="flex: 0 0 90px;">ID</div>
                    <div style="flex: 2;">{{ lang === 'tr' ? 'Alıcı' : 'Recipient' }}</div>
                    <div style="flex: 1.4;">{{ lang === 'tr' ? 'Taşıyıcı' : 'Carrier' }}</div>
                    <div style="flex: 1;">{{ lang === 'tr' ? 'Durum' : 'Status' }}</div>
                    <div style="flex: 0.8;">ETA</div>
                    <div style="flex: 0.8; text-align: right;">{{ lang === 'tr' ? 'Tutar' : 'Amount' }}</div>
                  </div>
                  <div v-for="(s, i) in shipments" :key="s.id" class="row" :style="{
                    padding: '12px 16px',
                    borderBottom: i < shipments.length - 1 ? '1px solid var(--line-1)' : 'none',
                    fontSize: '13.5px',
                  }">
                    <div class="mono" style="flex: 0 0 90px; font-size: 12px; color: var(--ink-3);">{{ s.id }}</div>
                    <div style="flex: 2; font-weight: 500;">{{ s.to }}</div>
                    <div style="flex: 1.4; color: var(--ink-2);">{{ s.carrier }}</div>
                    <div style="flex: 1;">
                      <span class="row" style="display: inline-flex; gap: 5px; padding: 3px 9px; border-radius: 999px; background: var(--bg-3); color: var(--ink-2); font-size: 11.5px; font-weight: 600;">
                        <span style="width: 5px; height: 5px; border-radius: 999px; background: currentColor;"></span>
                        {{ lang === 'tr' ? 'Yolda' : s.status }}
                      </span>
                    </div>
                    <div style="flex: 0.8; color: var(--ink-2); font-size: 12.5px;">{{ s.eta }}</div>
                    <div class="mono" style="flex: 0.8; text-align: right; font-weight: 600;">${{ s.price.toFixed(2) }}</div>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="col" style="gap: 20px;">
                <h3 class="h-2" style="margin: 0;">{{ tab === 'orders' ? (lang === 'tr' ? 'Siparişler' : 'Orders') : (lang === 'tr' ? 'Müşteriler' : 'Customers') }}</h3>
                <div class="placeholder" style="min-height: 480px;">{{ tab.toUpperCase() }}</div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
