<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import Skeleton from '../../components/Skeleton.vue'
import Spinner from '../../components/Spinner.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import KpiCard from '../../components/KpiCard.vue'
import ConnectStoreModal from '../../components/integrations/ConnectStoreModal.vue'
import StoreSettingsDrawer from '../../components/integrations/StoreSettingsDrawer.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listStores, listSyncLogs, syncStore, syncAllStores, retrySync, STORE_CHANNELS } from '../../api/integrations.js'
import { channelName, storeIdentity, storeStatus, errorMessage } from '../../components/integrations/storeUtils.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const loadError = ref(false)
const stores = ref([])
const errors = ref([]) // unresolved error logs
const syncing = ref({}) // storeId -> progress
const syncingAll = ref(false)
const syncAllProgress = ref(0)
const retrying = ref(null)
const connectOpen = ref(false)
const connectChannel = ref(null)
const drawerOpen = ref(false)
const drawerId = ref(null)
const mayManage = computed(() => can('integrations.manage'))

const ordered = computed(() => STORE_CHANNELS.map(ch => stores.value.find(s => s.channel === ch)).filter(Boolean))
const connected = computed(() => stores.value.filter(s => s.status === 'connected'))
const orders30d = computed(() => connected.value.reduce((a, s) => a + (s.orders30d ?? 0), 0))
const lastSync = computed(() => connected.value.map(s => s.lastSyncAt).filter(Boolean).sort().pop() ?? null)

function errorsFor(ch) { return errors.value.filter(l => l.store === ch) }

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  loadError.value = false
  try {
    const [s, e] = await Promise.all([listStores(), listSyncLogs({ result: 'error' })])
    stores.value = s
    errors.value = e.filter(l => !l.resolvedAt)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function openConnect(ch) {
  if (!mayManage.value) return
  connectChannel.value = ch
  connectOpen.value = true
}
function openManage(s) {
  drawerId.value = s.id
  drawerOpen.value = true
}
function viewLog(s) {
  router.push({ name: 'sync-logs', query: { store: s.channel } })
}

async function syncOne(s) {
  if (syncing.value[s.id] != null) return
  syncing.value = { ...syncing.value, [s.id]: 0 }
  try {
    const r = await syncStore(s.id, { onProgress: p => { syncing.value = { ...syncing.value, [s.id]: p } } })
    if (r.newOrders) {
      toast.success(t('integrations.stores.syncDone', { store: channelName(s.channel), n: r.newOrders }), {
        action: { label: t('integrations.stores.viewOrders'), onClick: () => router.push({ path: '/orders', query: { channel: s.channel } }) },
      })
    } else toast.info(t('integrations.stores.syncNone', { store: channelName(s.channel) }))
    await load({ silent: true })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    const n = { ...syncing.value }; delete n[s.id]; syncing.value = n
  }
}

async function syncAll() {
  if (syncingAll.value) return
  syncingAll.value = true
  syncAllProgress.value = 0
  try {
    const res = await syncAllStores({ onProgress: p => { syncAllProgress.value = p } })
    const total = res.reduce((a, r) => a + r.newOrders, 0)
    const parts = res.map(r => `${r.name} ${r.newOrders}`).join(' · ')
    if (total) {
      toast.success(t('integrations.stores.syncAllDone', { n: total, parts }), {
        action: { label: t('integrations.stores.viewOrders'), onClick: () => router.push('/orders') },
      })
    } else toast.info(t('integrations.stores.syncAllNone'))
    await load({ silent: true })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    syncingAll.value = false
  }
}

async function retry(log) {
  retrying.value = log.id
  try {
    await retrySync(log.id)
    toast.success(t('integrations.logs.retried', { id: log.id }))
    await load({ silent: true })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    retrying.value = null
  }
}

function onConnected() { load({ silent: true }) }
function onChanged() { load({ silent: true }) }

onMounted(async () => {
  await load()
  const q = route.query.connect
  if (typeof q === 'string' && STORE_CHANNELS.includes(q)) {
    const s = stores.value.find(x => x.channel === q)
    if (s && s.status !== 'connected') openConnect(q)
  }
  const m = route.query.manage
  if (typeof m === 'string') {
    const s = stores.value.find(x => x.channel === m || x.id === m)
    if (s && s.status === 'connected') openManage(s)
  }
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.stores')" :subtitle="t('integrations.stores.subtitle')">
      <template #actions>
        <RouterLink class="btn btn-ghost btn-sm" :to="{ name: 'sync-logs' }"><Icon name="list" :size="14" /> {{ t('integrations.stores.syncLog') }}</RouterLink>
        <button class="btn btn-primary btn-sm" :disabled="syncingAll || loading || !connected.length || !mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="syncAll">
          <Spinner v-if="syncingAll" :size="14" /><Icon v-else name="sync" :size="14" />
          {{ syncingAll ? t('integrations.stores.syncingAll', { n: syncAllProgress }) : t('integrations.stores.syncAll') }}
        </button>
      </template>
    </PageHeader>

    <div class="grid-kpi kpis">
      <KpiCard :label="t('integrations.stores.kpiConnected')" :value="loading ? null : `${connected.length} / ${stores.length}`" :loading="loading" icon="store" />
      <KpiCard :label="t('integrations.stores.kpiOrders30')" :value="loading ? null : orders30d" :loading="loading" icon="box" />
      <KpiCard :label="t('integrations.stores.kpiLastSync')" :value="loading ? null : (lastSync ? fmt.relative(lastSync) : '-')" :loading="loading" icon="clock" />
      <KpiCard :label="t('integrations.stores.kpiErrors')" :value="loading ? null : errors.length" :loading="loading" icon="alert" :tone="errors.length ? 'danger' : undefined" clickable @click="router.push({ name: 'sync-logs', query: { result: 'error', open: '1' } })" />
    </div>

    <div v-if="loadError" class="callout danger">
      <Icon name="alert" :size="16" />
      <div>{{ t('integrations.loadError') }} <button class="btn-link" @click="load()">{{ t('common.retry') }}</button></div>
    </div>

    <div class="cards">
      <template v-if="loading">
        <div v-for="i in 5" :key="i" class="panel store-card"><Skeleton variant="lines" :lines="5" /></div>
      </template>
      <template v-else>
        <article v-for="s in ordered" :key="s.id" :data-testid="'store-card-' + s.channel" class="panel store-card" :class="{ off: s.status !== 'connected', err: storeStatus(s) === 'error' }">
          <header class="sc-head">
            <ChannelLogo :code="s.channel" :size="42" />
            <div class="sc-title">
              <div class="sc-name">{{ channelName(s.channel) }}</div>
              <div class="sc-id truncate" :title="storeIdentity(s)">{{ s.status === 'connected' ? (storeIdentity(s) || s.name) : (s.disconnectedAt ? storeIdentity(s) || t('integrations.stores.notConnectedDesc') : t('integrations.stores.notConnectedDesc')) }}</div>
            </div>
            <StatusPill :status="storeStatus(s)" :label="storeStatus(s) === 'error' ? t('integrations.stores.health.error') : storeStatus(s) === 'connected' ? t('integrations.stores.health.ok') : t('integrations.stores.health.off')" />
          </header>

          <dl v-if="s.status === 'connected'" class="sc-kv">
            <div><dt>{{ t('integrations.stores.lastSync') }}</dt><dd><DateTime v-if="s.lastSyncAt" :value="s.lastSyncAt" /><span v-else>-</span></dd></div>
            <div><dt>{{ t('integrations.stores.orders30d') }}</dt><dd class="num">{{ fmt.number(s.orders30d ?? 0) }}</dd></div>
            <div><dt>{{ t('integrations.stores.autoPull') }}</dt><dd>{{ s.settings?.autoPull ? t('integrations.stores.every', { f: t('integrations.freq.' + (s.settings?.frequency ?? '15m')) }) : t('integrations.stores.off') }}</dd></div>
            <div><dt>{{ t('integrations.stores.writeBack') }}</dt><dd>{{ s.settings?.writeBackTracking ? t('integrations.stores.on') : t('integrations.stores.off') }}</dd></div>
          </dl>
          <div v-else class="sc-empty">
            <p v-if="s.disconnectedAt">{{ t('integrations.stores.disconnectedAt', { date: fmt.dateTime(s.disconnectedAt) }) }}</p>
            <p v-else>{{ t('integrations.stores.connectPitch.' + s.channel) }}</p>
          </div>

          <div v-if="s.status === 'connected' && errorsFor(s.channel).length" class="callout danger sc-err">
            <Icon name="alert" :size="15" />
            <div class="grow">
              <div class="err-title">{{ t('integrations.stores.unresolved', { n: errorsFor(s.channel).length }) }}</div>
              <div class="err-detail">{{ tx(errorsFor(s.channel)[0].detail) }}</div>
            </div>
            <button class="btn btn-ghost btn-xs" :disabled="retrying === errorsFor(s.channel)[0].id || !mayManage" @click="retry(errorsFor(s.channel)[0])">
              <Spinner v-if="retrying === errorsFor(s.channel)[0].id" :size="12" /> {{ t('common.retry') }}
            </button>
          </div>

          <ProgressBar v-if="syncing[s.id] != null" :value="syncing[s.id]" size="sm" :label="t('integrations.stores.syncing')" show-value />

          <footer class="sc-foot">
            <template v-if="s.status === 'connected'">
              <button class="btn btn-ghost btn-sm" @click="openManage(s)"><Icon name="settings" :size="14" /> {{ t('integrations.stores.manage') }}</button>
              <button class="btn btn-ghost btn-sm" :disabled="syncing[s.id] != null || !mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="syncOne(s)">
                <Spinner v-if="syncing[s.id] != null" :size="13" /><Icon v-else name="sync" :size="14" /> {{ t('integrations.stores.syncNow') }}
              </button>
              <button class="btn-link log-link" @click="viewLog(s)">{{ t('integrations.stores.viewLog') }}</button>
            </template>
            <template v-else>
              <button :data-testid="'store-connect-' + s.channel" class="btn btn-accent btn-sm" :disabled="!mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="openConnect(s.channel)">
                <Icon name="link" :size="14" /> {{ s.disconnectedAt ? t('integrations.stores.reconnect') : t('integrations.stores.connect') }}
              </button>
              <button v-if="s.disconnectedAt" class="btn-link log-link" @click="viewLog(s)">{{ t('integrations.stores.viewLog') }}</button>
            </template>
          </footer>
        </article>
      </template>
    </div>

    <div class="panel panel-pad how">
      <div class="how-icon"><Icon name="sync" :size="18" /></div>
      <div>
        <div class="panel-title">{{ t('integrations.stores.howTitle') }}</div>
        <p class="panel-sub">{{ t('integrations.stores.howDesc') }}</p>
      </div>
    </div>

    <ConnectStoreModal v-model:open="connectOpen" :channel="connectChannel" @connected="onConnected" @manage="s => s && openManage(s)" />
    <StoreSettingsDrawer v-model:open="drawerOpen" :store-id="drawerId" @changed="onChanged" />
  </div>
</template>

<style scoped>
.kpis { margin-bottom: 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin: 16px 0; }
.store-card { padding: 18px; display: flex; flex-direction: column; gap: 14px; min-height: 230px; }
.store-card.off { background: var(--bg); }
.store-card.err { border-color: oklch(0.85 0.06 25); }
.sc-head { display: flex; align-items: center; gap: 12px; }
.sc-title { flex: 1; min-width: 0; }
.sc-name { font-family: var(--font-display); font-weight: 600; font-size: 16px; }
.sc-id { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.sc-kv { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin: 0; }
.sc-kv dt { color: var(--ink-3); font-size: 12px; }
.sc-kv dd { margin: 2px 0 0; font-size: 13.5px; font-weight: 500; }
.sc-empty p { margin: 0; color: var(--ink-2); font-size: 13.5px; line-height: 1.5; }
.sc-err { align-items: flex-start; padding: 10px 12px; }
.sc-err .grow { flex: 1; min-width: 0; }
.err-title { font-weight: 600; font-size: 13px; }
.err-detail { font-size: 12.5px; opacity: .9; }
.sc-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.log-link { margin-left: auto; font-size: 13px; }
.how { display: flex; gap: 14px; align-items: flex-start; }
.how-icon { width: 36px; height: 36px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-ink); display: grid; place-items: center; flex: none; }
.how p { margin: 4px 0 0; line-height: 1.55; }
</style>
