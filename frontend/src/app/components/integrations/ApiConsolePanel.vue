<script setup>
// API console (spec 7.5): endpoint + key select, editable JSON body, "Send" routes to the real
// fake-API (rate engine, shipment creation + wallet charge, test keys => test:true, invalid JSON => 400).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import CodeBlock from '../CodeBlock.vue'
import Tabs from '../Tabs.vue'
import Spinner from '../Spinner.vue'
import Skeleton from '../Skeleton.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { CONSOLE_ENDPOINTS, getEndpoint, sampleBody, defaultParams, buildPath, curlSample, sendConsoleRequest, API_BASE_URL } from '../../api/console.js'
import { listApiKeys, isTestKey } from '../../api/apiKeys.js'

const props = defineProps({ initialEndpoint: { type: String, default: null } })
const emit = defineEmits(['show-log'])
const { t, fmt } = useI18n()
const router = useRouter()

const HIST_KEY = 'kpz_demo:ui:apiConsoleHistory'
const endpointId = ref(getEndpoint(props.initialEndpoint) ? props.initialEndpoint : 'rates')
const keys = ref([])
const keysLoading = ref(true)
const keyId = ref('')
const params = ref({})
const body = ref('')
const bodyValid = ref(true)
const sending = ref(false)
const response = ref(null)
const resTab = ref('body')
const history = ref(loadHistory())

const ep = computed(() => getEndpoint(endpointId.value))
const key = computed(() => keys.value.find(k => k.id === keyId.value) ?? null)
const test = computed(() => isTestKey(key.value))
const balance = computed(() => db.doc('wallet')?.balance ?? 0)
const path = computed(() => buildPath(ep.value, params.value))
const curl = computed(() => curlSample(ep.value, { key: key.value ? key.value.prefix + '••••' : 'kp_live_xxxx', params: params.value }))
const missingScope = computed(() => key.value && !(key.value.scopes ?? []).includes(ep.value.scope))
const shipmentLink = computed(() => (response.value?.ok && response.value.body?.object === 'shipment' && response.value.body.id ? response.value.body.id : null))
const orderLink = computed(() => (response.value?.ok && response.value.body?.object === 'order' ? response.value.body.id : null))
const groups = computed(() => [
  { label: t('apiConsole.groups.shipping'), items: CONSOLE_ENDPOINTS.filter(e => ['rates', 'createShipment', 'getShipment', 'voidShipment', 'tracking', 'createManifest'].includes(e.id)) },
  { label: t('apiConsole.groups.orders'), items: CONSOLE_ENDPOINTS.filter(e => ['listOrders', 'createOrder', 'validateAddress'].includes(e.id)) },
  { label: t('apiConsole.groups.ai'), items: CONSOLE_ENDPOINTS.filter(e => ['hsSuggest', 'forecast'].includes(e.id)) },
  { label: t('apiConsole.groups.webhooks'), items: CONSOLE_ENDPOINTS.filter(e => ['createWebhook'].includes(e.id)) },
])

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') } catch { return [] }
}
function saveHistory() {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(history.value.slice(0, 12))) } catch {}
}

function resetBody() {
  body.value = sampleBody(ep.value)
  params.value = defaultParams(ep.value)
  bodyValid.value = true
}
watch(endpointId, () => { resetBody(); response.value = null })
watch(() => props.initialEndpoint, v => { if (getEndpoint(v)) endpointId.value = v })

async function loadKeys() {
  keysLoading.value = true
  try {
    keys.value = (await listApiKeys({ includeRevoked: true }))
    const active = keys.value.filter(k => k.status === 'active')
    if (!keys.value.some(k => k.id === keyId.value)) keyId.value = (active.find(k => k.env === 'live') ?? active[0])?.id ?? ''
  } finally {
    keysLoading.value = false
  }
}

async function send() {
  if (sending.value) return
  sending.value = true
  try {
    const r = await sendConsoleRequest({ endpointId: endpointId.value, params: { ...params.value }, body: body.value, apiKeyId: keyId.value || null })
    response.value = r
    resTab.value = 'body'
    history.value = [{ id: r.requestId, at: new Date().toISOString(), endpointId: endpointId.value, method: r.method, path: r.path, status: r.status, ms: r.ms, body: body.value, params: { ...params.value }, keyId: keyId.value }, ...history.value].slice(0, 12)
    saveHistory()
    if (r.ok && endpointId.value === 'createShipment') {
      if (r.test) toast.info(t('apiConsole.console.testCreated', { id: r.body.id }))
      else toast.success(t('apiConsole.console.liveCreated', { id: r.body.id, amount: fmt.money(r.body.charged) }))
    }
    loadKeys()
  } catch (e) {
    toast.error(String(e?.message || e))
  } finally {
    sending.value = false
  }
}

function replay(h) {
  endpointId.value = h.endpointId
  setTimeout(() => {
    body.value = h.body
    params.value = { ...h.params }
    if (keys.value.some(k => k.id === h.keyId)) keyId.value = h.keyId
  }, 0)
}
function clearHistory() { history.value = []; saveHistory() }

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send() }
}

const statusTone = s => (s < 300 ? 'ok' : s < 500 ? 'warn' : 'err')
const size = computed(() => (response.value ? new Blob([JSON.stringify(response.value.body)]).size : 0))
const resTabs = computed(() => [
  { key: 'body', label: t('apiConsole.console.body') },
  { key: 'headers', label: t('apiConsole.console.headers'), count: response.value ? Object.keys(response.value.headers).length : undefined },
])
const headersText = computed(() => (response.value ? Object.entries(response.value.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : ''))

onMounted(() => { resetBody(); loadKeys(); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="console">
    <section class="panel req">
      <div class="panel-head">
        <div class="panel-title"><Icon name="terminal" :size="14" /> {{ t('apiConsole.console.request') }}</div>
        <button class="btn btn-ghost btn-xs" @click="resetBody"><Icon name="refresh" :size="12" /> {{ t('apiConsole.console.loadSample') }}</button>
      </div>
      <div class="req-body stack">
        <div class="row2">
          <label class="fld">
            <span class="lbl">{{ t('apiConsole.console.endpoint') }}</span>
            <select v-model="endpointId" data-testid="api-console-endpoint" class="select">
              <optgroup v-for="g in groups" :key="g.label" :label="g.label">
                <option v-for="e in g.items" :key="e.id" :value="e.id">{{ e.method }} {{ e.path }}</option>
              </optgroup>
            </select>
          </label>
          <label class="fld">
            <span class="lbl">{{ t('apiConsole.console.apiKey') }}</span>
            <Skeleton v-if="keysLoading && !keys.length" variant="rect" :height="38" />
            <select v-else v-model="keyId" class="select">
              <option value="">{{ t('apiConsole.console.noKey') }}</option>
              <option v-for="k in keys" :key="k.id" :value="k.id">{{ k.name }} · {{ k.prefix }}… {{ k.status === 'revoked' ? '(' + t('status.revoked') + ')' : '' }}</option>
            </select>
          </label>
        </div>

        <div class="urlbar">
          <span class="method" :class="ep.method.toLowerCase()">{{ ep.method }}</span>
          <code class="truncate">{{ API_BASE_URL }}{{ path.replace('/v1', '') }}</code>
          <span class="tag scope"><Icon name="key" :size="11" /> {{ ep.scope }}</span>
        </div>
        <p class="ep-desc">{{ t('apiConsole.endpoints.' + ep.id + '.desc') }}</p>

        <div v-if="ep.params.length" class="params">
          <label v-for="p in ep.params" :key="p.name" class="fld">
            <span class="lbl">{{ t('apiConsole.console.pathParam', { name: p.name }) }}</span>
            <input v-model="params[p.name]" class="input mono" spellcheck="false" />
          </label>
        </div>

        <div v-if="!key" class="callout warn"><Icon name="alert" :size="15" /><div>{{ t('apiConsole.console.noKeyWarn') }}</div></div>
        <div v-else-if="key.status === 'revoked'" class="callout danger"><Icon name="alert" :size="15" /><div>{{ t('apiConsole.console.revokedWarn') }}</div></div>
        <div v-else-if="missingScope" class="callout warn"><Icon name="alert" :size="15" /><div>{{ t('apiConsole.console.scopeWarn', { scope: ep.scope }) }}</div></div>
        <div v-else-if="endpointId === 'createShipment' && test" class="callout"><Icon name="flask" :size="15" /><div>{{ t('apiConsole.console.testMode') }}</div></div>
        <div v-else-if="endpointId === 'createShipment'" class="callout danger"><Icon name="wallet" :size="15" /><div>{{ t('apiConsole.console.liveMode', { balance: fmt.money(balance) }) }}</div></div>
        <div v-else-if="endpointId === 'voidShipment' && !test" class="callout warn"><Icon name="alert" :size="15" /><div>{{ t('apiConsole.console.voidWarn') }}</div></div>

        <div v-if="ep.body">
          <div class="lbl">{{ ep.body === 'query' ? t('apiConsole.console.query') : t('apiConsole.console.bodyLabel') }}</div>
          <CodeBlock v-model="body" editable language="json" :rows="14" :title="ep.body === 'query' ? 'query.json' : 'body.json'" @valid="v => (bodyValid = v)" />
          <div v-if="!bodyValid" class="field-hint warn-text">{{ t('apiConsole.console.invalidHint') }}</div>
        </div>
        <div v-else class="callout neutral"><Icon name="info" :size="15" /><div>{{ t('apiConsole.console.noBody') }}</div></div>

        <div class="send-row">
          <span class="kbd-hint">{{ t('apiConsole.console.shortcut') }}</span>
          <button data-testid="api-console-send" class="btn btn-primary" :disabled="sending" @click="send">
            <Spinner v-if="sending" :size="14" /><Icon v-else name="play" :size="14" /> {{ sending ? t('apiConsole.console.sending') : t('apiConsole.console.send') }}
          </button>
        </div>
      </div>
    </section>

    <section class="stack res-col">
      <div class="panel res">
        <div class="panel-head">
          <div class="panel-title"><Icon name="code" :size="14" /> {{ t('apiConsole.console.response') }}</div>
          <div v-if="response" class="res-meta">
            <span data-testid="api-console-status" class="status" :class="statusTone(response.status)">{{ response.status }} {{ t('apiConsole.httpStatus.' + response.status) }}</span>
            <span class="meta">{{ t('common.ms', { n: response.ms }) }}</span>
            <span class="meta">{{ fmt.number(size) }} B</span>
            <span v-if="response.test" class="tag tag-warning">test</span>
          </div>
        </div>
        <div v-if="sending" class="res-empty"><Spinner :size="20" /><span>{{ t('apiConsole.console.waiting') }}</span></div>
        <div v-else-if="!response" class="res-empty">
          <Icon name="terminal" :size="22" />
          <span>{{ t('apiConsole.console.emptyTitle') }}</span>
          <span class="sub">{{ t('apiConsole.console.emptyDesc') }}</span>
        </div>
        <div v-else class="res-body">
          <Tabs v-model="resTab" :tabs="resTabs" variant="pill" class="res-tabs" />
          <CodeBlock v-if="resTab === 'body'" :code="response.body" :title="`${response.method} ${response.path}`" :max-height="520" />
          <CodeBlock v-else :code="headersText" language="text" :title="t('apiConsole.console.headers')" :max-height="520" />
          <div v-if="shipmentLink || orderLink" class="links">
            <RouterLink v-if="shipmentLink" class="btn btn-ghost btn-sm" :to="`/shipments/${shipmentLink}`"><Icon name="external" :size="13" /> {{ t('apiConsole.console.openShipment', { id: shipmentLink }) }}</RouterLink>
            <RouterLink v-if="orderLink" class="btn btn-ghost btn-sm" :to="`/orders/${orderLink}`"><Icon name="external" :size="13" /> {{ t('apiConsole.console.openOrder', { id: orderLink }) }}</RouterLink>
            <button data-testid="api-console-view-log" class="btn btn-ghost btn-sm" @click="emit('show-log')"><Icon name="list" :size="13" /> {{ t('apiConsole.console.viewInLog') }}</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">{{ t('apiConsole.console.curl') }}</div>
        </div>
        <div class="pad"><CodeBlock :code="curl" language="shell" title="cURL" :max-height="200" /></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">{{ t('apiConsole.console.history') }}</div>
          <button v-if="history.length" class="btn btn-ghost btn-xs" @click="clearHistory">{{ t('apiConsole.console.clearHistory') }}</button>
        </div>
        <div v-if="history.length" class="hist">
          <button v-for="h in history" :key="h.id" type="button" class="hist-row" @click="replay(h)">
            <span class="method sm" :class="h.method.toLowerCase()">{{ h.method }}</span>
            <code class="truncate">{{ h.path }}</code>
            <span class="status sm" :class="statusTone(h.status)">{{ h.status }}</span>
            <span class="meta">{{ fmt.relative(h.at) }}</span>
          </button>
        </div>
        <div v-else class="res-empty small"><span class="sub">{{ t('apiConsole.console.historyEmpty') }}</span></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.console { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.panel-title { display: flex; align-items: center; gap: 6px; }
.req-body { padding: 16px 18px 18px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fld { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.lbl { font-size: 12.5px; font-weight: 500; color: var(--ink-2); margin-bottom: 4px; display: block; }
.fld .lbl { margin-bottom: 0; }
.urlbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--line-1); border-radius: 10px; min-width: 0; }
.urlbar code { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; }
.scope { font-family: var(--font-mono); font-size: 11px; flex: none; }
.ep-desc { margin: -4px 0 0; color: var(--ink-3); font-size: 12.5px; line-height: 1.5; }
.params { display: grid; grid-template-columns: 1fr; gap: 10px; }
.mono { font-family: var(--font-mono); font-size: 13px; }
.method { font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 6px; flex: none; }
.method.sm { font-size: 10px; padding: 1px 5px; width: 40px; text-align: center; }
.method.get { background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); }
.method.post { background: var(--accent-soft); color: var(--accent-ink); }
.method.delete, .method.patch { background: oklch(0.96 0.06 80); color: oklch(0.45 0.1 70); }
.send-row { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.kbd-hint { font-size: 12px; color: var(--ink-3); }
.warn-text { color: oklch(0.55 0.12 70); }
.res-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.status { font-family: var(--font-mono); font-weight: 700; font-size: 12.5px; padding: 3px 8px; border-radius: 6px; }
.status.sm { font-size: 11px; padding: 1px 6px; }
.status.ok { background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); }
.status.warn { background: oklch(0.96 0.06 80); color: oklch(0.45 0.1 70); }
.status.err { background: oklch(0.95 0.04 25); color: var(--danger); }
.meta { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.res-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 220px; color: var(--ink-3); padding: 20px; text-align: center; }
.res-empty.small { min-height: 70px; }
.sub { color: var(--ink-3); font-size: 12.5px; }
.res-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.links { display: flex; gap: 8px; flex-wrap: wrap; }
.pad { padding: 12px 14px 14px; }
.hist { display: flex; flex-direction: column; }
.hist-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 14px; border: 0; border-bottom: 1px solid var(--line-1); background: transparent; text-align: left; cursor: pointer; font-size: 12.5px; }
.hist-row:last-child { border-bottom: 0; }
.hist-row:hover { background: var(--bg-2); }
.hist-row code { font-family: var(--font-mono); font-size: 12px; }
@media (max-width: 1100px) { .console { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .row2 { grid-template-columns: 1fr; } .kbd-hint { display: none; } }
</style>
