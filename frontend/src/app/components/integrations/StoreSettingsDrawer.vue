<script setup>
// Store settings (spec 7.2 "Yönet"): auto pull + frequency, tracking write-back, status mapping,
// SKU mapping, sync now, disconnect (orders are kept with a "disconnected" badge).
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Drawer from '../Drawer.vue'
import Toggle from '../Toggle.vue'
import SegmentedControl from '../SegmentedControl.vue'
import ChannelLogo from '../ChannelLogo.vue'
import StatusPill from '../StatusPill.vue'
import DateTime from '../DateTime.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import ProgressBar from '../ProgressBar.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { db } from '../../store/db.js'
import { getStore, updateStoreSettings, syncStore, disconnectStore } from '../../api/integrations.js'
import { channelName, storeIdentity, storeStatus, errorMessage, INTERNAL_STATUSES } from './storeUtils.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  storeId: { type: String, default: null },
})
const emit = defineEmits(['update:open', 'changed'])
const { t, tx, fmt } = useI18n()
const router = useRouter()

const loading = ref(false)
const store = ref(null)
const form = ref(null)
const saving = ref(false)
const syncPct = ref(null)
const disconnecting = ref(false)
const errors = ref({})
const mayManage = computed(() => can('integrations.manage'))

const products = computed(() => db.all('products'))
const dirty = computed(() => store.value && form.value && JSON.stringify(snapshot(store.value.settings)) !== JSON.stringify(snapshot(form.value)))

function snapshot(s) {
  return {
    autoPull: !!s?.autoPull, frequency: s?.frequency ?? '15m', writeBackTracking: !!s?.writeBackTracking,
    statusMap: (s?.statusMap ?? []).map(r => ({ external: String(r.external ?? '').trim(), internal: r.internal })),
    skuMap: (s?.skuMap ?? []).map(r => ({ external: String(r.external ?? '').trim(), internal: r.internal ?? '' })),
  }
}

async function load() {
  if (!props.storeId) return
  loading.value = true
  errors.value = {}
  try {
    store.value = await getStore(props.storeId)
    form.value = snapshot(store.value.settings)
  } catch (e) {
    toast.error(errorMessage(e))
    emit('update:open', false)
  } finally {
    loading.value = false
  }
}
watch(() => [props.open, props.storeId], ([o]) => { if (o) load() }, { immediate: true })

function addStatusRow() { form.value.statusMap.push({ external: '', internal: 'awaiting_shipment' }) }
function removeStatusRow(i) { form.value.statusMap.splice(i, 1) }
function addSkuRow() { form.value.skuMap.push({ external: '', internal: '' }) }
function removeSkuRow(i) { form.value.skuMap.splice(i, 1) }

function validate() {
  const e = {}
  const seen = new Set()
  form.value.statusMap.forEach((r, i) => {
    const v = r.external.trim().toLowerCase()
    if (!v) e['s' + i] = t('common.validation.required')
    else if (seen.has(v)) e['s' + i] = t('integrations.settings.duplicate')
    seen.add(v)
  })
  const seenSku = new Set()
  form.value.skuMap.forEach((r, i) => {
    const v = r.external.trim().toLowerCase()
    if (!v) e['k' + i] = t('common.validation.required')
    else if (seenSku.has(v)) e['k' + i] = t('integrations.settings.duplicate')
    else if (!r.internal) e['ki' + i] = t('integrations.settings.pickSku')
    seenSku.add(v)
  })
  errors.value = e
  if (Object.keys(e).length) {
    const first = Object.keys(e)[0]
    setTimeout(() => document.querySelector(`[data-err="${first}"]`)?.focus(), 0)
  }
  return !Object.keys(e).length
}

async function save() {
  if (!validate()) return
  saving.value = true
  try {
    const r = await updateStoreSettings(store.value.id, snapshot(form.value))
    store.value = { ...store.value, ...r }
    form.value = snapshot(r.settings)
    toast.success(t('integrations.settings.saved', { store: channelName(r.channel) }))
    emit('changed', r)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    saving.value = false
  }
}

async function syncNow() {
  if (syncPct.value != null) return
  syncPct.value = 0
  try {
    const r = await syncStore(store.value.id, { onProgress: p => { syncPct.value = p } })
    if (r.newOrders) toast.success(t('integrations.stores.syncDone', { store: channelName(store.value.channel), n: r.newOrders }), { action: { label: t('integrations.stores.viewOrders'), onClick: () => router.push({ path: '/orders', query: { channel: store.value?.channel } }) } })
    else toast.info(t('integrations.stores.syncNone', { store: channelName(store.value.channel) }))
    const fresh = await getStore(store.value.id)
    store.value = fresh
    emit('changed', fresh)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    syncPct.value = null
  }
}

async function disconnect() {
  const name = channelName(store.value.channel)
  const ok = await confirm({
    title: t('integrations.settings.disconnectTitle', { store: name }),
    message: t('integrations.settings.disconnectMsg', { store: name, n: store.value.orderCount ?? 0 }),
    confirmLabel: t('integrations.settings.disconnect'),
    danger: true,
  })
  if (!ok) return
  disconnecting.value = true
  try {
    const r = await disconnectStore(store.value.id)
    toast.success(t('integrations.settings.disconnected', { store: name }))
    emit('changed', r)
    emit('update:open', false)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    disconnecting.value = false
  }
}

function openLog() {
  emit('update:open', false)
  router.push({ name: 'sync-logs', query: { store: store.value.channel } })
}
const freqOptions = computed(() => [{ value: '15m', label: t('integrations.freq.15m') }, { value: '1h', label: t('integrations.freq.1h') }])
</script>

<template>
  <Drawer :open="open" :title="store ? t('integrations.settings.title', { store: channelName(store.channel) }) : t('integrations.settings.titleGeneric')" :subtitle="store ? storeIdentity(store) : ''" width="620px" @update:open="v => emit('update:open', v)">
    <div v-if="loading || !form" class="stack"><Skeleton variant="lines" :lines="4" /><Skeleton variant="rect" :height="160" /><Skeleton variant="lines" :lines="3" /></div>
    <div v-else class="stack-lg">
      <div class="head-card">
        <ChannelLogo :code="store.channel" :size="40" />
        <div class="grow">
          <div class="hc-name">{{ store.name }}</div>
          <div class="hc-sub">{{ t('integrations.settings.connectedSince') }} <DateTime :value="store.connectedAt" mode="date" /> · {{ t('integrations.stores.lastSync') }}: <DateTime v-if="store.lastSyncAt" :value="store.lastSyncAt" /><span v-else>-</span></div>
        </div>
        <StatusPill :status="storeStatus(store)" :label="t('integrations.stores.health.' + (store.health === 'error' ? 'error' : 'ok'))" />
      </div>

      <section>
        <h3 class="section-title">{{ t('integrations.settings.syncSection') }}</h3>
        <div class="setting">
          <Toggle v-model="form.autoPull" :label="t('integrations.settings.autoPull')" :description="t('integrations.settings.autoPullDesc')" :disabled="!mayManage" />
          <div class="freq" :class="{ dim: !form.autoPull }">
            <span class="freq-label">{{ t('integrations.settings.frequency') }}</span>
            <SegmentedControl v-model="form.frequency" :options="freqOptions" size="sm" :aria-label="t('integrations.settings.frequency')" />
          </div>
        </div>
        <div class="setting">
          <Toggle v-model="form.writeBackTracking" :label="t('integrations.settings.writeBack')" :description="t('integrations.settings.writeBackDesc', { store: channelName(store.channel) })" :disabled="!mayManage" />
        </div>
      </section>

      <section>
        <div class="sec-head">
          <h3 class="section-title">{{ t('integrations.settings.statusMap') }}</h3>
          <button class="btn btn-ghost btn-xs" :disabled="!mayManage" @click="addStatusRow"><Icon name="plus" :size="12" /> {{ t('integrations.settings.addRow') }}</button>
        </div>
        <p class="sec-desc">{{ t('integrations.settings.statusMapDesc', { store: channelName(store.channel) }) }}</p>
        <div class="map-table">
          <div class="map-row map-headrow">
            <span>{{ t('integrations.settings.externalStatus', { store: channelName(store.channel) }) }}</span><span /><span>{{ t('integrations.settings.internalStatus') }}</span><span />
          </div>
          <div v-for="(r, i) in form.statusMap" :key="'s' + i" class="map-row">
            <div>
              <input v-model="r.external" class="input input-sm mono" :class="{ invalid: errors['s' + i] }" :data-err="'s' + i" :aria-label="t('integrations.settings.externalStatus', { store: channelName(store.channel) })" :disabled="!mayManage" />
              <div v-if="errors['s' + i]" class="field-error">{{ errors['s' + i] }}</div>
            </div>
            <Icon name="arrow" :size="14" class="arrow" />
            <select v-model="r.internal" class="select input-sm" :aria-label="t('integrations.settings.internalStatus')" :disabled="!mayManage">
              <option v-for="st in INTERNAL_STATUSES" :key="st" :value="st">{{ t('status.' + st) }}</option>
            </select>
            <button class="btn-icon" :aria-label="t('integrations.settings.removeRow')" :disabled="!mayManage" @click="removeStatusRow(i)"><Icon name="trash" :size="14" /></button>
          </div>
          <div v-if="!form.statusMap.length" class="map-empty">{{ t('integrations.settings.statusMapEmpty') }}</div>
        </div>
      </section>

      <section>
        <div class="sec-head">
          <h3 class="section-title">{{ t('integrations.settings.skuMap') }}</h3>
          <button class="btn btn-ghost btn-xs" :disabled="!mayManage" @click="addSkuRow"><Icon name="plus" :size="12" /> {{ t('integrations.settings.addRow') }}</button>
        </div>
        <p class="sec-desc">{{ t('integrations.settings.skuMapDesc') }}</p>
        <div class="map-table">
          <div v-if="form.skuMap.length" class="map-row map-headrow">
            <span>{{ t('integrations.settings.externalSku', { store: channelName(store.channel) }) }}</span><span /><span>{{ t('integrations.settings.internalSku') }}</span><span />
          </div>
          <div v-for="(r, i) in form.skuMap" :key="'k' + i" class="map-row">
            <div>
              <input v-model="r.external" class="input input-sm mono" :class="{ invalid: errors['k' + i] }" :data-err="'k' + i" :placeholder="store.channel === 'amazon' ? 'B0C1XK9Z2Q' : 'LISTING-1042'" :aria-label="t('integrations.settings.externalSku', { store: channelName(store.channel) })" :disabled="!mayManage" />
              <div v-if="errors['k' + i]" class="field-error">{{ errors['k' + i] }}</div>
            </div>
            <Icon name="arrow" :size="14" class="arrow" />
            <div>
              <select v-model="r.internal" class="select input-sm" :class="{ invalid: errors['ki' + i] }" :data-err="'ki' + i" :aria-label="t('integrations.settings.internalSku')" :disabled="!mayManage">
                <option value="" disabled>{{ t('integrations.settings.pickSku') }}</option>
                <option v-for="p in products" :key="p.sku" :value="p.sku">{{ p.sku }} · {{ tx(p.title) }}</option>
              </select>
              <div v-if="errors['ki' + i]" class="field-error">{{ errors['ki' + i] }}</div>
            </div>
            <button class="btn-icon" :aria-label="t('integrations.settings.removeRow')" :disabled="!mayManage" @click="removeSkuRow(i)"><Icon name="trash" :size="14" /></button>
          </div>
          <div v-if="!form.skuMap.length" class="map-empty">
            {{ t('integrations.settings.skuMapEmpty') }}
            <button class="btn-link" :disabled="!mayManage" @click="addSkuRow">{{ t('integrations.settings.addFirstSku') }}</button>
          </div>
        </div>
      </section>

      <section>
        <div class="sec-head">
          <h3 class="section-title">{{ t('integrations.settings.recentLogs') }}</h3>
          <button class="btn-link" @click="openLog">{{ t('integrations.stores.viewLog') }}</button>
        </div>
        <div v-if="store.recentLogs?.length" class="logs">
          <div v-for="l in store.recentLogs.slice(0, 6)" :key="l.id" class="log-row">
            <StatusPill :status="l.result" size="sm" />
            <span class="log-op">{{ t('core.integrations.ops.' + l.op) }}</span>
            <span class="log-detail truncate" :title="tx(l.detail)">{{ tx(l.detail) }}</span>
            <DateTime :value="l.at" class="log-at" />
          </div>
        </div>
        <div v-else class="map-empty">{{ t('integrations.settings.noLogs') }}</div>
      </section>

      <ProgressBar v-if="syncPct != null" :value="syncPct" :label="t('integrations.stores.syncing')" show-value />
    </div>

    <template #footer>
      <div v-if="store && form" class="foot">
        <button class="btn btn-ghost btn-sm danger-text" :disabled="disconnecting || !mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="disconnect">
          <Spinner v-if="disconnecting" :size="13" /><Icon v-else name="x-circle" :size="14" /> {{ t('integrations.settings.disconnect') }}
        </button>
        <span class="spacer" />
        <span v-if="dirty" class="dirty">{{ t('integrations.settings.unsaved') }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="syncPct != null || !mayManage" @click="syncNow"><Spinner v-if="syncPct != null" :size="13" /><Icon v-else name="sync" :size="14" /> {{ t('integrations.stores.syncNow') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="saving || !dirty || !mayManage" @click="save"><Spinner v-if="saving" :size="13" /> {{ t('common.save') }}</button>
      </div>
    </template>
  </Drawer>
</template>

<style scoped>
.head-card { display: flex; gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--line-1); border-radius: 12px; background: var(--bg-2); }
.grow { flex: 1; min-width: 0; }
.hc-name { font-weight: 600; }
.hc-sub { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.setting { padding: 12px 0; border-bottom: 1px solid var(--line-1); display: flex; flex-direction: column; gap: 10px; }
.setting:last-child { border-bottom: 0; }
.freq { display: flex; align-items: center; gap: 12px; padding-left: 48px; }
.freq.dim { opacity: .5; pointer-events: none; }
.freq-label { font-size: 13px; color: var(--ink-2); }
.sec-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sec-head .section-title { margin: 0; }
.sec-desc { color: var(--ink-3); font-size: 12.5px; margin: 4px 0 10px; line-height: 1.5; }
.map-table { border: 1px solid var(--line-1); border-radius: 10px; overflow: hidden; }
.map-row { display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1.2fr) 32px; gap: 8px; align-items: start; padding: 8px 10px; border-bottom: 1px solid var(--line-1); }
.map-row:last-child { border-bottom: 0; }
.map-headrow { background: var(--bg-2); font-size: 11.5px; color: var(--ink-3); font-weight: 500; padding-top: 7px; padding-bottom: 7px; }
.arrow { color: var(--ink-4); margin-top: 9px; }
.input-sm { height: 34px; font-size: 13px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.map-empty { padding: 14px; color: var(--ink-3); font-size: 13px; text-align: center; }
.logs { border: 1px solid var(--line-1); border-radius: 10px; }
.log-row { display: grid; grid-template-columns: auto 110px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line-1); font-size: 12.5px; }
.log-row:last-child { border-bottom: 0; }
.log-op { color: var(--ink-2); }
.log-at { color: var(--ink-3); white-space: nowrap; }
.foot { display: flex; align-items: center; gap: 8px; width: 100%; flex-wrap: wrap; }
.spacer { flex: 1; }
.dirty { font-size: 12px; color: oklch(0.55 0.12 70); }
.danger-text { color: var(--danger); }
@media (max-width: 560px) {
  .map-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px; }
  .map-row .arrow { display: none; }
  .map-headrow { display: none; }
  .freq { padding-left: 0; }
  .log-row { grid-template-columns: auto 1fr; }
}
</style>
