<script setup>
import { ref, computed, inject, watch } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, f, money } = useI18n()
const pricing = inject('kpzPricing')

const tab = ref('shipments')
const filter = ref('all')
watch(tab, () => { filter.value = 'all' })

const STORES = [
  { key: 'shopify', label: 'Shopify', color: '#5E8E3E' },
  { key: 'etsy', label: 'Etsy', color: '#F1641E' },
  { key: 'amazon', label: 'Amazon', color: '#FF9900' },
  { key: 'ebay', label: 'eBay', color: '#E53238' },
]

// Sample rows shaped like the demo account's seed data (US recipients, US carriers).
const SHIPMENT_ROWS = [
  { id: 'SHP-20931', name: 'Ann Brewer', city: 'Austin', state: 'TX', zip: '78701', hub: 'NJ01', key: 'UPS-GROUND', w: 2, status: 'in_transit', eta: 3 },
  { id: 'SHP-20930', name: 'Marcus Lee', city: 'Brooklyn', state: 'NY', zip: '11201', hub: 'NJ01', key: 'USPS-GA', w: 1, status: 'out_for_delivery', eta: 1 },
  { id: 'SHP-20929', name: 'Priya Natarajan', city: 'Seattle', state: 'WA', zip: '98101', hub: 'LA01', key: 'ONT-GROUND', w: 3, status: 'label_created', eta: 2 },
  { id: 'SHP-20928', name: 'Daniel Ortiz', city: 'Chicago', state: 'IL', zip: '60601', hub: 'NJ01', key: 'FDX-HOME', w: 4, status: 'in_transit', eta: 2 },
  { id: 'SHP-20927', name: 'Hannah Kim', city: 'Boston', state: 'MA', zip: '02108', hub: 'NJ01', key: 'USPS-PM', w: 1, status: 'delivered' },
  { id: 'SHP-20926', name: 'Rachel Green', city: 'Denver', state: 'CO', zip: '80202', hub: 'LA01', key: 'DHLE-EXP', w: 2, status: 'exception' },
  { id: 'SHP-20925', name: 'Tom Alvarez', city: 'Miami', state: 'FL', zip: '33101', hub: 'NJ01', key: 'UPS-GROUND', w: 5, status: 'delivered' },
]

const ORDER_ROWS = [
  { id: 'ORD-10482', channel: 'etsy', no: 'ETS-49102', name: 'Ann Brewer', dest: 'Austin, TX', items: 2, score: 96, status: 'awaiting_shipment' },
  { id: 'ORD-10481', channel: 'shopify', no: '#SH-5531', name: 'Olivia Carter', dest: 'Portland, OR', items: 1, score: 91, status: 'awaiting_shipment' },
  { id: 'ORD-10480', channel: 'amazon', no: '113-4471902-5520137', name: 'Kevin Brooks', dest: 'Phoenix, AZ', items: 3, score: 88, status: 'labeled' },
  { id: 'ORD-10479', channel: 'etsy', no: 'ETS-49087', name: 'Grace Wu', dest: 'San Diego, CA', items: 1, score: 52, status: 'on_hold' },
  { id: 'ORD-10478', channel: 'ebay', no: '12-10988-44721', name: 'Samuel Price', dest: 'Atlanta, GA', items: 2, score: 94, status: 'shipped' },
  { id: 'ORD-10477', channel: 'shopify', no: '#SH-5529', name: 'Emily Foster', dest: 'Jersey City, NJ', items: 4, score: 99, status: 'shipped' },
  { id: 'ORD-10476', channel: 'amazon', no: '113-9920184-3301825', name: 'Nathan Hughes', dest: 'Dallas, TX', items: 1, score: 67, status: 'awaiting_shipment' },
  { id: 'ORD-10475', channel: 'ebay', no: '12-10971-39015', name: 'Laura Bennett', dest: 'Philadelphia, PA', items: 1, score: 90, status: 'awaiting_shipment' },
]

const MANIFEST_ROWS = [
  { id: 'MNF-0412', carrier: 'UPS', hub: 'NJ01', count: 18, status: 'open' },
  { id: 'MNF-0411', carrier: 'USPS', hub: 'NJ01', count: 24, status: 'submitted' },
  { id: 'MNF-0410', carrier: 'OnTrac', hub: 'LA01', count: 9, status: 'closed' },
  { id: 'MNF-0409', carrier: 'FedEx', hub: 'NJ01', count: 15, status: 'closed' },
  { id: 'MNF-0408', carrier: 'DHL eCommerce', hub: 'LA01', count: 11, status: 'closed' },
]

const account = computed(() => {
  const u = pricing.data.value.user || {}
  return { plan: (u.company && u.company.plan) || 'enterprise', customerId: u.customerId || null }
})

const shipments = computed(() => SHIPMENT_ROWS.map((r) => {
  const quotes = pricing.quoteDomestic({ hub: r.hub, zip: r.zip, state: r.state, pkg: { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: r.w }, ...account.value })
  const q = quotes.find((x) => x.key === r.key)
  return { ...r, carrier: q ? q.serviceName : r.key, amount: q ? q.total : null }
}))

const FILTERS = {
  shipments: ['all', 'in_transit', 'delivered', 'exception'],
  orders: ['all', 'awaiting_shipment', 'on_hold', 'shipped'],
  manifests: ['all', 'open', 'closed'],
  store: ['all', 'awaiting_shipment', 'shipped'],
}
const isStore = computed(() => STORES.some((s) => s.key === tab.value))
const filterKeys = computed(() => FILTERS[isStore.value ? 'store' : tab.value])
const filterLabel = (k) => (k === 'all' ? t.value.dashboard.filterAll : t.value.dashboard.status[k])
const pass = (status) => filter.value === 'all' || status === filter.value

const shipmentRows = computed(() => shipments.value.filter((r) => pass(r.status)))
const orderRows = computed(() => ORDER_ROWS.filter((r) => (!isStore.value || r.channel === tab.value) && pass(r.status)))
const manifestRows = computed(() => MANIFEST_ROWS.filter((r) => pass(r.status)))
const storeLabel = computed(() => (STORES.find((s) => s.key === tab.value) || {}).label)
const channelLabel = (c) => (STORES.find((s) => s.key === c) || { label: c }).label

const opItems = computed(() => [
  { key: 'shipments', label: t.value.dashboard.tabs.shipments, icon: 'box', count: '420' },
  { key: 'orders', label: t.value.dashboard.tabs.orders, icon: 'list', count: '58' },
  { key: 'manifests', label: t.value.dashboard.tabs.manifests, icon: 'file', count: '24' },
])
const storeCount = { shopify: 46, etsy: 38, amazon: 22, ebay: 14 }

const stats = computed(() => [
  { l: t.value.dashboard.stats.week, v: '38' },
  { l: t.value.dashboard.stats.pending, v: '58' },
  { l: t.value.dashboard.stats.address, v: '9', warn: true },
  { l: t.value.dashboard.stats.balance, v: money(1248.6) },
])

const TONES = {
  in_transit: 'accent', out_for_delivery: 'accent', label_created: 'neutral', delivered: 'success', exception: 'danger',
  awaiting_shipment: 'warning', on_hold: 'danger', labeled: 'neutral', shipped: 'accent',
  open: 'warning', submitted: 'accent', closed: 'success',
}
const scoreTone = (s) => (s >= 85 ? 'success' : s >= 70 ? 'warning' : 'danger')
const urlPath = computed(() => (isStore.value ? 'orders?channel=' + tab.value : tab.value))
</script>

<template>
  <section id="dashboard" class="section">
    <div class="container">
      <SectionHeader :eyebrow="t.dashboard.eyebrow" :title="t.dashboard.title" :sub="t.dashboard.sub" />

      <div class="dash">
        <div class="topbar">
          <div class="dots">
            <span class="dot dot-r" /><span class="dot dot-y" /><span class="dot dot-g" />
          </div>
          <div class="row mono url">
            <Icon name="lock" :size="11" /> kargopazar.com/app/#/{{ urlPath }}
          </div>
          <div class="row" style="gap: 8px">
            <span class="demo-pill mono">{{ t.dashboard.preview }}</span>
            <span class="avatar" aria-hidden="true">DK</span>
          </div>
        </div>

        <div class="body">
          <aside class="side">
            <div class="mono group-label">{{ t.dashboard.groupOps }}</div>
            <button
              v-for="it in opItems"
              :key="it.key"
              type="button"
              :class="['side-item', { active: tab === it.key }]"
              @click="tab = it.key"
            >
              <Icon :name="it.icon" :size="15" />
              <span class="lbl">{{ it.label }}</span>
              <span class="mono cnt">{{ it.count }}</span>
            </button>
            <div class="mono group-label second">{{ t.dashboard.groupInt }}</div>
            <button
              v-for="s in STORES"
              :key="s.key"
              type="button"
              :class="['side-item', { active: tab === s.key }]"
              @click="tab = s.key"
            >
              <span class="dot-pin" :style="{ background: s.color }" />
              <span class="lbl">{{ s.label }}</span>
              <span class="mono cnt">{{ storeCount[s.key] }}</span>
            </button>
          </aside>

          <div class="main">
            <div class="main-head">
              <div>
                <div class="row" style="gap: 10px">
                  <h3 class="h-2" style="margin: 0">{{ isStore ? storeLabel : t.dashboard.tabs[tab] }}</h3>
                  <span v-if="isStore" class="pill"><span class="dot" />{{ t.dashboard.connected }}</span>
                </div>
                <p class="head-sub">
                  {{ isStore ? f(t.dashboard.storeSub, { name: storeLabel }) : t.dashboard[tab + 'Sub'] }}
                </p>
              </div>
              <a :href="APP_LINKS.newShipment" class="btn btn-primary btn-sm"><Icon name="plus" /> {{ t.dashboard.newShipment }}</a>
            </div>

            <div v-if="tab === 'shipments'" class="stats-grid">
              <div v-for="(s, i) in stats" :key="i" class="card stat-card">
                <div class="mono lbl">{{ s.l }}</div>
                <div :class="['val', { warn: s.warn }]">{{ s.v }}</div>
              </div>
            </div>

            <div class="chips" role="group">
              <button
                v-for="k in filterKeys"
                :key="k"
                type="button"
                :class="['chip', { active: filter === k }]"
                :aria-pressed="filter === k"
                @click="filter = k"
              >{{ filterLabel(k) }}</button>
            </div>

            <!-- shipments -->
            <div v-if="tab === 'shipments'" class="card table-card">
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t.dashboard.cols.id }}</th>
                      <th>{{ t.dashboard.cols.recipient }}</th>
                      <th>{{ t.dashboard.cols.carrier }}</th>
                      <th>{{ t.dashboard.cols.status }}</th>
                      <th>{{ t.dashboard.cols.eta }}</th>
                      <th class="r">{{ t.dashboard.cols.amount }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in shipmentRows" :key="s.id">
                      <td class="mono id">{{ s.id }}</td>
                      <td><span class="strong">{{ s.name }}</span><span class="muted"> · {{ s.city }}, {{ s.state }}</span></td>
                      <td class="muted2">{{ s.carrier }}</td>
                      <td><span :class="['status', TONES[s.status]]"><span class="sd" />{{ t.dashboard.status[s.status] }}</span></td>
                      <td class="muted2">{{ s.eta ? f(s.eta === 1 ? t.common.day : t.common.days, { n: s.eta }) : '-' }}</td>
                      <td class="mono r strong">{{ s.amount != null ? money(s.amount) : '-' }}</td>
                    </tr>
                    <tr v-if="!shipmentRows.length"><td colspan="6" class="empty-cell">{{ t.dashboard.filterEmpty }}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- orders (all or per store) -->
            <div v-else-if="tab === 'orders' || isStore" class="card table-card">
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t.dashboard.cols.order }}</th>
                      <th>{{ t.dashboard.cols.channel }}</th>
                      <th>{{ t.dashboard.cols.recipient }}</th>
                      <th>{{ t.dashboard.cols.items }}</th>
                      <th>{{ t.dashboard.cols.score }}</th>
                      <th>{{ t.dashboard.cols.status }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="o in orderRows" :key="o.id">
                      <td><span class="mono id">{{ o.id }}</span><div class="mono tiny">{{ o.no }}</div></td>
                      <td class="muted2">{{ channelLabel(o.channel) }}</td>
                      <td><span class="strong">{{ o.name }}</span><span class="muted"> · {{ o.dest }}</span></td>
                      <td class="muted2">{{ f(t.dashboard.itemsN, { n: o.items }) }}</td>
                      <td><span :class="['score', scoreTone(o.score)]">{{ o.score }}</span></td>
                      <td><span :class="['status', TONES[o.status]]"><span class="sd" />{{ t.dashboard.status[o.status] }}</span></td>
                    </tr>
                    <tr v-if="!orderRows.length"><td colspan="6" class="empty-cell">{{ t.dashboard.filterEmpty }}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- manifests -->
            <div v-else class="card table-card">
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t.dashboard.cols.id }}</th>
                      <th>{{ t.dashboard.cols.carrier }}</th>
                      <th>{{ t.dashboard.cols.hub }}</th>
                      <th>{{ t.dashboard.cols.count }}</th>
                      <th>{{ t.dashboard.cols.status }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="m in manifestRows" :key="m.id">
                      <td class="mono id">{{ m.id }}</td>
                      <td class="strong">{{ m.carrier }}</td>
                      <td class="mono muted2">{{ m.hub }}</td>
                      <td class="muted2">{{ f(t.dashboard.pkgN, { n: m.count }) }}</td>
                      <td><span :class="['status', TONES[m.status]]"><span class="sd" />{{ t.dashboard.status[m.status] }}</span></td>
                    </tr>
                    <tr v-if="!manifestRows.length"><td colspan="5" class="empty-cell">{{ t.dashboard.filterEmpty }}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="demo-cta">
        <p class="demo-sub">{{ t.dashboard.openDemoSub }}</p>
        <a :href="APP_LINKS.demo" class="btn btn-accent btn-lg"><Icon name="play" /> {{ t.dashboard.openDemo }} <Icon name="arrow" /></a>
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
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  height: 48px; padding: 0 16px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-2);
}
.dots { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.dots .dot { width: 11px; height: 11px; border-radius: 999px; }
.dots .dot-r { background: #FF5F57; }
.dots .dot-y { background: #FEBC2E; }
.dots .dot-g { background: #28C840; }
.url {
  gap: 6px; font-size: 11.5px; color: var(--ink-3);
  padding: 5px 12px; background: white;
  border-radius: 6px; border: 1px solid var(--line-1);
  white-space: nowrap; overflow: hidden; min-width: 0;
}
.demo-pill {
  font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 5px; background: oklch(0.95 0.08 90); color: oklch(0.42 0.1 75);
  white-space: nowrap;
}
.avatar {
  width: 28px; height: 28px; border-radius: 999px; flex: 0 0 auto;
  background: var(--accent); color: white;
  font-size: 11.5px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}

.body { display: grid; grid-template-columns: 220px 1fr; min-height: 560px; }
.side { border-right: 1px solid var(--line-1); padding: 14px; background: var(--bg-2); }
.group-label {
  font-size: 10px; color: var(--ink-4);
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 6px 10px 8px;
}
.group-label.second { padding-top: 18px; }
.side-item {
  width: 100%; padding: 8px 10px; cursor: pointer;
  border: 0; border-radius: 7px;
  display: flex; align-items: center; gap: 10px;
  background: transparent;
  color: var(--ink-2);
  font: inherit; font-weight: 500; font-size: 13.5px;
  margin-bottom: 1px;
}
.side-item:hover { background: var(--bg-3); }
.side-item.active { background: var(--surface); color: var(--ink-1); font-weight: 600; box-shadow: var(--shadow-sm); }
.side-item .lbl { flex: 1; text-align: left; }
.side-item .cnt { font-size: 11px; color: var(--ink-4); }
.dot-pin { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }

.main { padding: 24px; overflow: hidden; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.main-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head-sub { margin: 4px 0 0; font-size: 13.5px; color: var(--ink-3); }

.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat-card { padding: 14px 16px; }
.stat-card .lbl { font-size: 10px; color: var(--ink-4); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
.stat-card .val { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.stat-card .val.warn { color: var(--danger); }

.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  height: 28px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2);
  font: inherit; font-size: 12.5px; font-weight: 500;
}
.chip.active { background: var(--ink-1); border-color: var(--ink-1); color: var(--bg); }

.table-card { overflow: hidden; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 620px; }
th {
  text-align: left; padding: 10px 14px; background: var(--bg-2);
  border-bottom: 1px solid var(--line-1);
  font-family: var(--font-mono); font-weight: 500;
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-4); white-space: nowrap;
}
td { padding: 11px 14px; border-bottom: 1px solid var(--line-1); vertical-align: middle; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: var(--bg-2); }
.r { text-align: right; }
.id { font-size: 12px; color: var(--ink-3); white-space: nowrap; }
.tiny { font-size: 10.5px; color: var(--ink-4); margin-top: 2px; }
.strong { font-weight: 600; }
.muted { color: var(--ink-3); }
.muted2 { color: var(--ink-2); white-space: nowrap; }
.empty-cell { text-align: center; color: var(--ink-3); padding: 28px 14px; }

.status {
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  padding: 3px 9px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600;
}
.sd { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.status.accent { background: var(--accent-soft); color: var(--accent-ink); }
.status.success { background: oklch(0.95 0.05 155); color: oklch(0.45 0.12 155); }
.status.warning { background: oklch(0.95 0.06 75); color: oklch(0.5 0.12 65); }
.status.danger { background: oklch(0.95 0.04 25); color: var(--danger); }
.status.neutral { background: var(--bg-3); color: var(--ink-2); }
.score {
  display: inline-flex; min-width: 32px; justify-content: center;
  padding: 2px 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 12px; font-weight: 600;
}
.score.success { background: oklch(0.95 0.05 155); color: oklch(0.45 0.12 155); }
.score.warning { background: oklch(0.95 0.06 75); color: oklch(0.5 0.12 65); }
.score.danger { background: oklch(0.95 0.04 25); color: var(--danger); }

.demo-cta { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 36px; text-align: center; }
.demo-sub { margin: 0; color: var(--ink-2); font-size: 15px; max-width: 560px; }

@media (max-width: 860px) {
  .body { grid-template-columns: 1fr; }
  .side { border-right: 0; border-bottom: 1px solid var(--line-1); display: flex; flex-wrap: wrap; gap: 4px; }
  .group-label { display: none; }
  .side-item { width: auto; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .main { padding: 16px; }
  .demo-pill { display: none; }
}
</style>
