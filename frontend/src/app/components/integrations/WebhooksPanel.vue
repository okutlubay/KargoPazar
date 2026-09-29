<script setup>
// Webhooks (spec 7.5): endpoints CRUD, events, send test event, delivery log with payload, resend failed.
import { ref, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import DataTable from '../DataTable.vue'
import FilterBar from '../FilterBar.vue'
import DateTime from '../DateTime.vue'
import Modal from '../Modal.vue'
import Drawer from '../Drawer.vue'
import FormField from '../FormField.vue'
import Toggle from '../Toggle.vue'
import Dropdown from '../Dropdown.vue'
import CodeBlock from '../CodeBlock.vue'
import CopyButton from '../CopyButton.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import EmptyState from '../EmptyState.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import {
  WEBHOOK_EVENTS, validateEndpointInput, listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint,
  restoreEndpoint, sendTestEvent, listDeliveries, resendDelivery,
} from '../../api/webhooks.js'
import { errorMessage, fieldError } from './storeUtils.js'

const { t, fmt } = useI18n()
const mayManage = computed(() => can('api.manage'))

const loading = ref(true)
const endpoints = ref([])
const deliveries = ref([])
const delLoading = ref(true)
const highlight = ref([])
const busy = ref({}) // id -> action
const search = ref('')
const filters = ref({ endpoint: [], result: [], event: [] })
const selected = ref(null)

// form modal
const formOpen = ref(false)
const editing = ref(null)
const form = ref({ url: '', description: '', events: [] })
const urlErr = ref('')
const eventsErr = ref('')
const saving = ref(false)
const createdSecret = ref(null)
const urlField = ref(null)

// test modal
const testOpen = ref(false)
const testEp = ref(null)
const testEvent = ref('')
const testing = ref(false)
const testResult = ref(null)

async function loadEndpoints({ silent = false } = {}) {
  if (!silent) loading.value = true
  try { endpoints.value = await listEndpoints() } catch (e) { toast.error(errorMessage(e)) } finally { loading.value = false }
}
async function loadDeliveries({ silent = false } = {}) {
  if (!silent) delLoading.value = true
  try { deliveries.value = await listDeliveries() } catch (e) { toast.error(errorMessage(e)) } finally { delLoading.value = false }
}
function reloadAll() { loadEndpoints({ silent: true }); loadDeliveries({ silent: true }) }
onMounted(() => { loadEndpoints(); loadDeliveries() })

function epUrl(id) { return endpoints.value.find(e => e.id === id)?.url ?? id }
function hostPath(url) { try { const u = new URL(url); return u.host + u.pathname } catch { return url } }

// ---------------- endpoint form
function openCreate() {
  editing.value = null
  form.value = { url: '', description: '', events: ['shipment.created', 'tracking.updated'] }
  urlErr.value = ''; eventsErr.value = ''; createdSecret.value = null
  formOpen.value = true
}
function openEdit(ep) {
  editing.value = ep
  form.value = { url: ep.url, description: ep.description ?? '', events: [...ep.events] }
  urlErr.value = ''; eventsErr.value = ''; createdSecret.value = null
  formOpen.value = true
}
function validateUrl() {
  const v = validateEndpointInput({ url: form.value.url, events: ['x'] })
  urlErr.value = v.errors.url ? fieldError(v.errors.url === 'https_url' ? 'webhook_url' : v.errors.url) : ''
  return !urlErr.value
}
function toggleEvent(e) {
  const s = new Set(form.value.events)
  s.has(e) ? s.delete(e) : s.add(e)
  form.value.events = WEBHOOK_EVENTS.filter(x => s.has(x))
  eventsErr.value = form.value.events.length ? '' : eventsErr.value
}
async function submitForm() {
  const okUrl = validateUrl()
  eventsErr.value = form.value.events.length ? '' : t('apiConsole.webhooks.eventsRequired')
  if (!okUrl) { urlField.value?.focus(); return }
  if (eventsErr.value) return
  saving.value = true
  try {
    if (editing.value) {
      await updateEndpoint(editing.value.id, { url: form.value.url, description: form.value.description, events: form.value.events })
      toast.success(t('apiConsole.webhooks.updated'))
      formOpen.value = false
    } else {
      const r = await createEndpoint({ ...form.value, events: [...form.value.events] })
      createdSecret.value = r.secret
      highlight.value = [r.endpoint.id]
      toast.success(t('apiConsole.webhooks.created'))
    }
    loadEndpoints({ silent: true })
  } catch (e) {
    if (e.details?.url) urlErr.value = e.details.url === 'exists' ? t('apiConsole.webhooks.exists') : fieldError(e.details.url === 'https_url' ? 'webhook_url' : e.details.url)
    toast.error(errorMessage(e))
  } finally {
    saving.value = false
  }
}

// ---------------- endpoint actions
async function setActive(ep, active) {
  busy.value = { ...busy.value, [ep.id]: 'status' }
  try {
    await updateEndpoint(ep.id, { status: active ? 'active' : 'inactive' })
    toast.success(active ? t('apiConsole.webhooks.enabled') : t('apiConsole.webhooks.disabled'))
    await loadEndpoints({ silent: true })
  } catch (e) { toast.error(errorMessage(e)) } finally { const b = { ...busy.value }; delete b[ep.id]; busy.value = b }
}
async function remove(ep) {
  const ok = await confirm({ title: t('apiConsole.webhooks.deleteTitle'), message: t('apiConsole.webhooks.deleteMsg', { url: ep.url }), confirmLabel: t('common.delete'), danger: true })
  if (!ok) return
  busy.value = { ...busy.value, [ep.id]: 'delete' }
  try {
    const snap = await deleteEndpoint(ep.id)
    toast.success(t('apiConsole.webhooks.deleted'), { action: { label: t('common.undo'), onClick: async () => { await restoreEndpoint(snap); toast.info(t('apiConsole.webhooks.restored')); reloadAll() } } })
    reloadAll()
  } catch (e) { toast.error(errorMessage(e)) } finally { const b = { ...busy.value }; delete b[ep.id]; busy.value = b }
}
function openTest(ep) {
  testEp.value = ep
  testEvent.value = ep.events[0] ?? WEBHOOK_EVENTS[0]
  testResult.value = null
  testOpen.value = true
}
async function runTest() {
  testing.value = true
  testResult.value = null
  try {
    const d = await sendTestEvent(testEp.value.id, testEvent.value)
    testResult.value = d
    highlight.value = [d.id]
    if (d.result === 'delivered') toast.success(t('apiConsole.webhooks.testOk', { status: d.status, ms: d.durationMs }))
    else toast.error(t('apiConsole.webhooks.testFail', { status: d.status }))
    reloadAll()
  } catch (e) { toast.error(errorMessage(e)) } finally { testing.value = false }
}
function menu(ep) {
  return [
    { key: 'test', label: t('apiConsole.webhooks.sendTest'), icon: 'play', disabled: !mayManage.value, onClick: () => openTest(ep) },
    { key: 'edit', label: t('common.edit'), icon: 'edit', disabled: !mayManage.value, onClick: () => openEdit(ep) },
    { key: 'log', label: t('apiConsole.webhooks.viewDeliveries'), icon: 'list', onClick: () => { filters.value = { ...filters.value, endpoint: [ep.id] }; document.querySelector('.deliveries')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } },
    { divider: true, key: 'd' },
    { key: 'delete', label: t('common.delete'), icon: 'trash', danger: true, disabled: !mayManage.value, onClick: () => remove(ep) },
  ]
}

// ---------------- deliveries
const chips = computed(() => [
  { key: 'endpoint', label: t('apiConsole.webhooks.endpoint'), options: endpoints.value.map(e => ({ value: e.id, label: hostPath(e.url) })) },
  { key: 'result', label: t('apiConsole.webhooks.result'), options: [{ value: 'delivered', label: t('apiConsole.webhooks.results.delivered'), count: deliveries.value.filter(d => d.result === 'delivered').length }, { value: 'failed', label: t('apiConsole.webhooks.results.failed'), count: deliveries.value.filter(d => d.result === 'failed').length }] },
  { key: 'event', label: t('apiConsole.webhooks.event'), options: WEBHOOK_EVENTS.map(e => ({ value: e, label: e })) },
])
const rows = computed(() => {
  const f = filters.value
  const q = search.value.trim().toLowerCase()
  return deliveries.value.filter(d => {
    if (f.endpoint?.length && !f.endpoint.includes(d.endpointId)) return false
    if (f.result?.length && !f.result.includes(d.result)) return false
    if (f.event?.length && !f.event.includes(d.event)) return false
    if (q && !`${d.id} ${d.event} ${JSON.stringify(d.payload?.data ?? {})}`.toLowerCase().includes(q)) return false
    return true
  })
})
const hasFilters = computed(() => !!(search.value || filters.value.endpoint?.length || filters.value.result?.length || filters.value.event?.length))
function clear() { search.value = ''; filters.value = { endpoint: [], result: [], event: [] } }
const columns = computed(() => [
  { key: 'at', label: t('apiConsole.log.time'), sortable: true, width: 140 },
  { key: 'event', label: t('apiConsole.webhooks.event'), width: 170 },
  { key: 'endpointId', label: t('apiConsole.webhooks.endpoint'), hideBelow: 'lg', value: r => hostPath(epUrl(r.endpointId)) },
  { key: 'status', label: 'HTTP', width: 80, sortable: true },
  { key: 'attempts', label: t('apiConsole.webhooks.attempts'), width: 90, align: 'right' },
  { key: 'durationMs', label: t('apiConsole.log.duration'), width: 100, align: 'right', hideBelow: 'md' },
  { key: 'actions', label: '', isAction: true, width: 140, align: 'right', hideable: false },
])
const canResend = d => d.result === 'failed' && !d.resentAt
async function resend(d) {
  busy.value = { ...busy.value, [d.id]: 'resend' }
  try {
    const r = await resendDelivery(d.id)
    highlight.value = [r.delivery.id]
    if (r.delivery.result === 'delivered') toast.success(t('apiConsole.webhooks.resentOk', { id: d.id }))
    else toast.error(t('apiConsole.webhooks.testFail', { status: r.delivery.status }))
    reloadAll()
    if (selected.value?.id === d.id) selected.value = { ...selected.value, resentAt: r.original.resentAt }
  } catch (e) { toast.error(errorMessage(e)) } finally { const b = { ...busy.value }; delete b[d.id]; busy.value = b }
}
function sigHeader(d) {
  const ts = Math.floor(new Date(d.at).getTime() / 1000)
  let h = 0
  const s = d.id + ts
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `t=${ts},v1=${h.toString(16).padStart(8, '0')}${(h ^ 0x5bd1e995).toString(16).padStart(8, '0')}`
}
function deliveryHeaders(d) {
  return `POST ${epUrl(d.endpointId)}\ncontent-type: application/json\nuser-agent: KargoPazar-Webhooks/1.0\nkp-event: ${d.event}\nkp-delivery: ${d.id}\nkp-signature: ${sigHeader(d)}`
}
</script>

<template>
  <div class="stack">
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">{{ t('apiConsole.webhooks.title') }}</div>
          <div class="panel-sub">{{ t('apiConsole.webhooks.desc') }}</div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="!mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="openCreate"><Icon name="plus" :size="14" /> {{ t('apiConsole.webhooks.add') }}</button>
      </div>
      <div v-if="loading" class="pad stack"><Skeleton variant="rect" :height="70" /><Skeleton variant="rect" :height="70" /></div>
      <EmptyState v-else-if="!endpoints.length" icon="webhook" :title="t('apiConsole.webhooks.emptyTitle')" :description="t('apiConsole.webhooks.emptyDesc')" :action-label="mayManage ? t('apiConsole.webhooks.add') : ''" @action="openCreate" />
      <div v-else class="eps">
        <div v-for="ep in endpoints" :key="ep.id" class="ep" :class="{ flash: highlight.includes(ep.id), off: ep.status !== 'active' }">
          <div class="ep-main">
            <div class="ep-url"><Icon name="webhook" :size="14" /><code class="truncate" :title="ep.url">{{ ep.url }}</code></div>
            <div v-if="ep.description" class="ep-desc">{{ ep.description }}</div>
            <div class="ep-events"><span v-for="e in ep.events" :key="e" class="tag ev">{{ e }}</span></div>
          </div>
          <div class="ep-stats">
            <div><span class="sl">{{ t('apiConsole.webhooks.successRate') }}</span><span class="sv" :class="{ bad: ep.stats?.successRate != null && ep.stats.successRate < 0.9 }">{{ ep.stats?.successRate == null ? '-' : fmt.percent(ep.stats.successRate, 0) }}</span></div>
            <div><span class="sl">{{ t('apiConsole.webhooks.failed') }}</span><span class="sv" :class="{ bad: ep.stats?.failed }">{{ ep.stats?.failed ?? 0 }}</span></div>
            <div><span class="sl">{{ t('apiConsole.webhooks.lastDelivery') }}</span><span class="sv"><DateTime v-if="ep.lastDeliveryAt" :value="ep.lastDeliveryAt" /><template v-else>-</template></span></div>
          </div>
          <div class="ep-actions">
            <Toggle :model-value="ep.status === 'active'" size="sm" :aria-label="t('apiConsole.webhooks.active')" :label="ep.status === 'active' ? t('status.active') : t('status.inactive')" :disabled="!!busy[ep.id] || !mayManage" @update:model-value="v => setActive(ep, v)" />
            <button class="btn btn-ghost btn-xs" :disabled="!mayManage || !!busy[ep.id]" @click="openTest(ep)"><Icon name="play" :size="12" /> {{ t('apiConsole.webhooks.sendTest') }}</button>
            <Dropdown :items="menu(ep)" size="sm" />
          </div>
        </div>
      </div>
    </div>

    <div class="panel deliveries">
      <div class="panel-head">
        <div>
          <div class="panel-title">{{ t('apiConsole.webhooks.deliveries') }}</div>
          <div class="panel-sub">{{ t('apiConsole.webhooks.deliveriesDesc') }}</div>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="delLoading" @click="loadDeliveries()"><Icon name="refresh" :size="13" /> {{ t('common.refresh') }}</button>
      </div>
      <div class="fb"><FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('apiConsole.webhooks.searchPh')" @clear="clear" /></div>
      <DataTable :columns="columns" :rows="rows" :loading="delLoading" :filtered="hasFilters" :default-sort="{ key: 'at', dir: 'desc' }" :highlight-keys="highlight" storage-key="webhook-deliveries"
        :empty-title="t('apiConsole.webhooks.noDeliveries')" empty-icon="webhook" :row-class="r => (canResend(r) ? 'row-failed' : '')" @clear-filters="clear" @row-click="r => (selected = r)">
        <template #cell-at="{ row }"><DateTime :value="row.at" /></template>
        <template #cell-event="{ row }"><code class="mono">{{ row.event }}</code> <span v-if="row.test" class="tag tag-warning tiny">test</span></template>
        <template #cell-endpointId="{ row }"><code class="mono truncate">{{ hostPath(epUrl(row.endpointId)) }}</code></template>
        <template #cell-status="{ row }"><span class="status" :class="row.status < 300 ? 'ok' : 'err'">{{ row.status }}</span></template>
        <template #cell-durationMs="{ row }"><span class="num">{{ fmt.number(row.durationMs) }} ms</span></template>
        <template #cell-actions="{ row }">
          <button v-if="canResend(row)" class="btn btn-ghost btn-xs" :disabled="!!busy[row.id] || !mayManage" @click.stop="resend(row)"><Spinner v-if="busy[row.id]" :size="11" /><Icon v-else name="refresh" :size="12" /> {{ t('apiConsole.webhooks.resend') }}</button>
          <span v-else-if="row.resentAt" class="tag tiny">{{ t('apiConsole.webhooks.resent') }}</span>
          <span v-else aria-hidden="true"></span>
        </template>
      </DataTable>
    </div>

    <!-- Endpoint form -->
    <Modal v-model:open="formOpen" :title="createdSecret ? t('apiConsole.webhooks.createdTitle') : editing ? t('apiConsole.webhooks.editTitle') : t('apiConsole.webhooks.add')" size="md">
      <div v-if="createdSecret" class="stack">
        <div class="callout warn"><Icon name="alert" :size="16" /><div>{{ t('apiConsole.webhooks.secretOnce') }}</div></div>
        <div class="secret"><code>{{ createdSecret }}</code><CopyButton :text="createdSecret" variant="button" size="sm" /></div>
        <p class="panel-sub">{{ t('apiConsole.webhooks.secretHow') }}</p>
      </div>
      <div v-else class="stack">
        <FormField ref="urlField" :label="t('apiConsole.webhooks.url')" :hint="t('apiConsole.webhooks.urlHint')" :error="urlErr" :value="form.url" required v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.url" class="input mono" :class="{ invalid }" placeholder="https://hooks.example.com/kargopazar" spellcheck="false" :aria-invalid="invalid" :aria-describedby="describedBy" @blur="validateUrl" />
        </FormField>
        <FormField :label="t('apiConsole.webhooks.description')" optional v-slot="{ id }">
          <input :id="id" v-model="form.description" class="input" maxlength="80" :placeholder="t('apiConsole.webhooks.descriptionPh')" />
        </FormField>
        <div>
          <div class="label">{{ t('apiConsole.webhooks.events') }} <span class="req">*</span></div>
          <div class="event-list" :class="{ invalid: eventsErr }">
            <label v-for="e in WEBHOOK_EVENTS" :key="e" class="event-opt">
              <input type="checkbox" :checked="form.events.includes(e)" @change="toggleEvent(e)" />
              <span><code>{{ e }}</code><span class="event-desc">{{ t('apiConsole.webhooks.eventDesc.' + e.replace('.', '_')) }}</span></span>
            </label>
          </div>
          <div v-if="eventsErr" class="field-error">{{ eventsErr }}</div>
        </div>
      </div>
      <template #footer>
        <template v-if="createdSecret"><button class="btn btn-primary btn-sm" @click="formOpen = false">{{ t('common.finish') }}</button></template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" @click="formOpen = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="submitForm"><Spinner v-if="saving" :size="13" /> {{ editing ? t('common.save') : t('apiConsole.webhooks.create') }}</button>
        </template>
      </template>
    </Modal>

    <!-- Test event -->
    <Modal v-model:open="testOpen" :title="t('apiConsole.webhooks.testTitle')" :subtitle="testEp ? testEp.url : ''" size="md">
      <div v-if="testEp" class="stack">
        <label class="fld">
          <span class="label">{{ t('apiConsole.webhooks.event') }}</span>
          <select v-model="testEvent" class="select">
            <option v-for="e in WEBHOOK_EVENTS" :key="e" :value="e">{{ e }}{{ testEp.events.includes(e) ? '' : ' (' + t('apiConsole.webhooks.notSubscribed') + ')' }}</option>
          </select>
        </label>
        <div v-if="testResult" class="test-res" :class="testResult.result">
          <Icon :name="testResult.result === 'delivered' ? 'check-circle' : 'x-circle'" :size="16" />
          <div>{{ testResult.result === 'delivered' ? t('apiConsole.webhooks.testOk', { status: testResult.status, ms: testResult.durationMs }) : t('apiConsole.webhooks.testFail', { status: testResult.status }) }}</div>
        </div>
        <CodeBlock v-if="testResult" :code="testResult.payload" :title="t('apiConsole.webhooks.payload')" :max-height="220" />
        <p v-else class="panel-sub">{{ t('apiConsole.webhooks.testDesc') }}</p>
      </div>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="testOpen = false">{{ t('common.close') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="testing" @click="runTest"><Spinner v-if="testing" :size="13" /><Icon v-else name="play" :size="13" /> {{ t('apiConsole.webhooks.send') }}</button>
      </template>
    </Modal>

    <!-- Delivery detail -->
    <Drawer :open="!!selected" :title="selected ? selected.id : ''" :subtitle="selected ? selected.event : ''" width="560px" @update:open="v => !v && (selected = null)">
      <div v-if="selected" class="stack">
        <dl class="kv">
          <dt>{{ t('apiConsole.log.time') }}</dt><dd><DateTime :value="selected.at" mode="absolute" /></dd>
          <dt>{{ t('apiConsole.webhooks.endpoint') }}</dt><dd class="mono">{{ epUrl(selected.endpointId) }}</dd>
          <dt>HTTP</dt><dd><span class="status" :class="selected.status < 300 ? 'ok' : 'err'">{{ selected.status }}</span> {{ t('apiConsole.httpStatus.' + selected.status) }}</dd>
          <dt>{{ t('apiConsole.webhooks.attempts') }}</dt><dd>{{ selected.attempts }}</dd>
          <dt>{{ t('apiConsole.log.duration') }}</dt><dd>{{ fmt.number(selected.durationMs) }} ms</dd>
          <template v-if="selected.resendOf"><dt>{{ t('apiConsole.webhooks.resendOf') }}</dt><dd class="mono">{{ selected.resendOf }}</dd></template>
          <template v-if="selected.resentAt"><dt>{{ t('apiConsole.webhooks.resent') }}</dt><dd><DateTime :value="selected.resentAt" mode="absolute" /></dd></template>
        </dl>
        <CodeBlock :code="deliveryHeaders(selected)" language="text" :title="t('apiConsole.webhooks.requestHeaders')" :max-height="160" />
        <CodeBlock :code="selected.payload" :title="t('apiConsole.webhooks.payload')" :max-height="300" />
        <CodeBlock :code="selected.response ?? (selected.status < 300 ? { received: true } : { error: 'internal_server_error' })" :title="t('apiConsole.webhooks.responseBody')" :max-height="120" />
      </div>
      <template v-if="selected && canResend(selected)" #footer>
        <button class="btn btn-primary btn-sm" :disabled="!!busy[selected.id] || !mayManage" @click="resend(selected)"><Spinner v-if="busy[selected.id]" :size="13" /><Icon v-else name="refresh" :size="13" /> {{ t('apiConsole.webhooks.resend') }}</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.pad { padding: 16px; }
.eps { display: flex; flex-direction: column; }
.ep { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 18px; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--line-1); transition: background .6s; }
.ep:last-child { border-bottom: 0; }
.ep.flash { background: oklch(0.97 0.04 155); }
.ep.off .ep-main { opacity: .6; }
.ep-url { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--ink-2); }
.ep-url code { font-family: var(--font-mono); font-size: 13px; color: var(--ink-1); font-weight: 500; }
.ep-desc { color: var(--ink-3); font-size: 12.5px; margin: 2px 0 0 22px; }
.ep-events { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0 22px; }
.ev { font-family: var(--font-mono); font-size: 11px; height: 20px; }
.ep-stats { display: flex; gap: 18px; }
.ep-stats > div { display: flex; flex-direction: column; }
.sl { font-size: 11px; color: var(--ink-3); }
.sv { font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.sv.bad { color: var(--danger); }
.ep-actions { display: flex; align-items: center; gap: 8px; }
.fb { padding: 12px 14px; border-bottom: 1px solid var(--line-1); }
.mono { font-family: var(--font-mono); font-size: 12px; }
.tiny { height: 18px; font-size: 10.5px; padding: 0 6px; }
.status { font-family: var(--font-mono); font-weight: 700; font-size: 11.5px; padding: 2px 6px; border-radius: 5px; }
.status.ok { background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); }
.status.err { background: oklch(0.95 0.04 25); color: var(--danger); }
:deep(.row-failed) td { background: oklch(0.985 0.012 25); }
.label { font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block; }
.req { color: var(--danger); }
.fld { display: flex; flex-direction: column; }
.event-list { border: 1px solid var(--line-1); border-radius: 10px; }
.event-list.invalid { border-color: var(--danger); }
.event-opt { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border-bottom: 1px solid var(--line-1); cursor: pointer; font-size: 13px; }
.event-opt:last-child { border-bottom: 0; }
.event-opt input { margin-top: 3px; accent-color: var(--accent); }
.event-opt code { font-family: var(--font-mono); font-size: 12px; font-weight: 600; display: block; }
.event-desc { color: var(--ink-3); font-size: 12px; }
.secret { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--ink-1); color: #fff; border-radius: 10px; }
.secret code { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; word-break: break-all; }
.test-res { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 10px; font-size: 13.5px; }
.test-res.delivered { background: oklch(0.95 0.05 155); color: oklch(0.38 0.1 155); }
.test-res.failed { background: oklch(0.95 0.04 25); color: oklch(0.45 0.16 25); }
@media (max-width: 1024px) {
  .ep { grid-template-columns: 1fr; gap: 10px; }
  .ep-actions { justify-content: flex-start; flex-wrap: wrap; }
}
</style>
