<script setup>
// Operations hub (spec 5.9): hub selector, intake, carrier handover, daily summary.
// Query: ?hub=NJ01|LA01&tab=intake|handover|summary
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import IntakeTab from './IntakeTab.vue'
import HandoverTab from './HandoverTab.vue'
import SummaryTab from './SummaryTab.vue'
import { listOpsHubs, US_HUB_CODES } from '../../api/ops.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()
const TABS = ['intake', 'handover', 'summary']
const HUB_KEY = 'kpz_demo:ui:opsHub'
let savedHub = null
try { savedHub = localStorage.getItem(HUB_KEY) } catch {}
const hub = ref(US_HUB_CODES.includes(route.query.hub) ? route.query.hub : US_HUB_CODES.includes(savedHub) ? savedHub : (db.doc('user')?.company?.defaultHub ?? 'NJ01'))
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'intake')
const hubs = ref([])

async function loadHubs() { try { hubs.value = await listOpsHubs() } catch {} }
onMounted(loadHubs)
watch([hub, tab], ([h, tb]) => {
  try { localStorage.setItem(HUB_KEY, h) } catch {}
  if (route.query.hub !== h || route.query.tab !== tb) router.replace({ query: { ...route.query, hub: h, tab: tb } })
})
watch(() => route.query, q => {
  if (US_HUB_CODES.includes(q.hub) && q.hub !== hub.value) hub.value = q.hub
  if (TABS.includes(q.tab) && q.tab !== tab.value) tab.value = q.tab
})

// Live counts from the store (reactive badges)
const pendingCount = code => db.all('shipments').filter(s => s.hub === code && !s.test && s.status === 'label_created' && !s.hubReceivedAt && !(s.events ?? []).some(e => e.code === 'hub_received')).length
const awaitingCount = computed(() => db.all('shipments').filter(s => s.hub === hub.value && s.status === 'label_created' && s.hubReceivedAt && !(s.events ?? []).some(e => e.code === 'picked_up')).length)
const tabs = computed(() => [
  { key: 'intake', label: t('ops.tabs.intake'), icon: 'scan', count: pendingCount(hub.value) || undefined },
  { key: 'handover', label: t('ops.tabs.handover'), icon: 'truck', count: awaitingCount.value || undefined },
  { key: 'summary', label: t('ops.tabs.summary'), icon: 'chart' },
])
const hubInfo = computed(() => hubs.value.find(h => h.code === hub.value) ?? db.all('hubs').find(h => h.code === hub.value))
function switchHub(code) { if (US_HUB_CODES.includes(code)) hub.value = code }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.ops')" :subtitle="t('ops.subtitle')" />
    <div class="hubs" role="radiogroup" :aria-label="t('ops.hubSelector')">
      <button v-for="code in US_HUB_CODES" :key="code" type="button" role="radio" :aria-checked="hub === code" :class="['hub', { on: hub === code }]" @click="hub = code">
        <span class="hub-code"><Icon name="warehouse" :size="16" /> {{ code }}</span>
        <span class="hub-name">{{ tx(db.all('hubs').find(h => h.code === code)?.name) }}</span>
        <span class="hub-meta">
          <span class="tag" :class="pendingCount(code) ? 'tag-warning' : 'tag-success'">{{ t('ops.pendingN', { n: pendingCount(code) }) }}</span>
          <span class="cut"><Icon name="clock" :size="12" /> {{ t('ops.cutoff', { time: db.all('hubs').find(h => h.code === code)?.cutoff ?? '16:00' }) }}</span>
        </span>
      </button>
    </div>
    <div v-if="hubInfo" class="addr"><Icon name="pin" :size="12" /> {{ hubInfo.address?.line1 }}, {{ hubInfo.address?.city }}, {{ hubInfo.address?.state }} {{ hubInfo.address?.zip }} · {{ t('ops.capacityLine', { load: fmt.number(hubInfo.todayLoad), cap: fmt.number(hubInfo.capacityDaily) }) }}</div>
    <div class="tabs-wrap"><Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.ops')" /></div>
    <IntakeTab v-if="tab === 'intake'" :hub="hub" @switch-hub="switchHub" @changed="loadHubs" />
    <HandoverTab v-else-if="tab === 'handover'" :hub="hub" @changed="loadHubs" @go-intake="tab = 'intake'" />
    <SummaryTab v-else :hub="hub" @go="v => (tab = v)" />
  </div>
</template>

<style scoped>
.hubs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.hub { text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: var(--r-lg); border: 1px solid var(--line-1); background: var(--surface); cursor: pointer; box-shadow: var(--shadow-sm); transition: border-color .15s, box-shadow .15s; }
.hub:hover { border-color: var(--line-strong); }
.hub.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset, var(--shadow-sm); }
.hub-code { display: flex; align-items: center; gap: 6px; font-family: var(--font-display); font-weight: 700; font-size: 17px; }
.hub-name { font-size: 13px; color: var(--ink-2); }
.hub-meta { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
.cut { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ink-3); }
.addr { margin-top: 8px; font-size: 12.5px; color: var(--ink-3); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.tabs-wrap { margin: 18px 0 14px; }
@media (max-width: 640px) { .hubs { grid-template-columns: 1fr; } }
</style>
