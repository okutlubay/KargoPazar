<script setup>
// API documentation (spec 7.5): every endpoint with method, path, description, request/response
// schema, example response, cURL and JavaScript samples.
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import CodeBlock from '../CodeBlock.vue'
import SegmentedControl from '../SegmentedControl.vue'
import CopyButton from '../CopyButton.vue'
import { useI18n } from '../../i18n/index.js'
import { CONSOLE_ENDPOINTS, API_BASE_URL, API_VERSION, curlSample, jsSample, defaultParams } from '../../api/console.js'

const emit = defineEmits(['try'])
const { t } = useI18n()
const selected = ref(CONSOLE_ENDPOINTS[0].id)
const lang = ref('curl')
const filter = ref('')

const ep = computed(() => CONSOLE_ENDPOINTS.find(e => e.id === selected.value))
const list = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return CONSOLE_ENDPOINTS.filter(e => !q || `${e.method} ${e.path} ${t('apiConsole.endpoints.' + e.id + '.title')}`.toLowerCase().includes(q))
})
const sample = computed(() => (lang.value === 'curl' ? curlSample(ep.value, { params: defaultParams(ep.value) }) : jsSample(ep.value, { params: defaultParams(ep.value) })))
const requestExample = computed(() => {
  const s = typeof ep.value.sample === 'function' ? ep.value.sample() : ep.value.sample
  return s
})
const langOptions = [{ value: 'curl', label: 'cURL' }, { value: 'js', label: 'JavaScript' }]
function select(id) {
  selected.value = id
  document.querySelector('.doc-main')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
</script>

<template>
  <div class="docs">
    <aside class="panel doc-nav">
      <div class="nav-search">
        <Icon name="search" :size="13" />
        <input v-model="filter" class="nav-input" :placeholder="t('apiConsole.docs.filter')" :aria-label="t('apiConsole.docs.filter')" />
      </div>
      <button v-for="e in list" :key="e.id" type="button" class="nav-item" :class="{ active: e.id === selected }" @click="select(e.id)">
        <span class="method" :class="e.method.toLowerCase()">{{ e.method }}</span>
        <span class="path">{{ e.path }}</span>
      </button>
      <div v-if="!list.length" class="nav-empty">{{ t('common.emptyFiltered') }}</div>
    </aside>

    <div class="doc-main stack">
      <div class="panel panel-pad intro">
        <div class="panel-title">{{ t('apiConsole.docs.introTitle') }}</div>
        <div class="intro-grid">
          <div><div class="il">{{ t('apiConsole.baseUrl') }}</div><div class="iv"><code>{{ API_BASE_URL }}</code><CopyButton :text="API_BASE_URL" size="xs" /></div></div>
          <div><div class="il">{{ t('apiConsole.docs.auth') }}</div><div class="iv"><code>Authorization: Bearer &lt;key&gt;</code></div></div>
          <div><div class="il">{{ t('apiConsole.docs.version') }}</div><div class="iv"><code>KP-Version: {{ API_VERSION }}</code></div></div>
          <div><div class="il">{{ t('apiConsole.docs.rateLimit') }}</div><div class="iv">{{ t('apiConsole.docs.rateLimitValue') }}</div></div>
        </div>
        <p class="panel-sub">{{ t('apiConsole.docs.errorsDesc') }} <code>{"error": {"code": "VALIDATION", "message": "...", "details": {...}}}</code></p>
      </div>

      <article v-if="ep" class="panel panel-pad endpoint">
        <header class="ep-head">
          <div class="ep-line">
            <span class="method lg" :class="ep.method.toLowerCase()">{{ ep.method }}</span>
            <code class="ep-path">{{ ep.path }}</code>
          </div>
          <button class="btn btn-accent btn-sm" @click="emit('try', ep.id)"><Icon name="play" :size="13" /> {{ t('apiConsole.docs.try') }}</button>
        </header>
        <h3 class="ep-title">{{ t('apiConsole.endpoints.' + ep.id + '.title') }}</h3>
        <p class="ep-desc">{{ t('apiConsole.endpoints.' + ep.id + '.desc') }}</p>
        <div class="ep-meta">
          <span class="tag"><Icon name="key" :size="11" /> {{ t('apiConsole.docs.scope') }}: <code>{{ ep.scope }}</code></span>
          <span class="tag"><Icon name="link" :size="11" /> <code>{{ API_BASE_URL }}{{ ep.path.replace('/v1', '') }}</code></span>
        </div>

        <h4 class="sub-h">{{ ep.body === 'query' ? t('apiConsole.docs.queryParams') : ep.method === 'GET' || !ep.body ? t('apiConsole.docs.pathParams') : t('apiConsole.docs.requestBody') }}</h4>
        <div class="table-wrap">
          <table class="table-simple schema">
            <thead><tr><th>{{ t('apiConsole.docs.field') }}</th><th>{{ t('apiConsole.docs.type') }}</th><th>{{ t('apiConsole.docs.description') }}</th></tr></thead>
            <tbody>
              <tr v-for="f in ep.request" :key="f.name">
                <td><code>{{ f.name }}</code> <span v-if="f.required" class="req">{{ t('apiConsole.docs.required') }}</span></td>
                <td class="type">{{ f.type }}</td>
                <td>{{ t('apiConsole.fields.' + f.key) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeBlock v-if="requestExample" :code="requestExample" :title="t('apiConsole.docs.requestExample')" :max-height="260" />

        <h4 class="sub-h">{{ t('apiConsole.docs.response') }} <span class="tag tag-success">{{ ['createShipment', 'createOrder', 'createManifest', 'createWebhook'].includes(ep.id) ? '201 Created' : '200 OK' }}</span></h4>
        <div class="table-wrap">
          <table class="table-simple schema">
            <thead><tr><th>{{ t('apiConsole.docs.field') }}</th><th>{{ t('apiConsole.docs.type') }}</th><th>{{ t('apiConsole.docs.description') }}</th></tr></thead>
            <tbody>
              <tr v-for="f in ep.response" :key="f.name">
                <td><code>{{ f.name }}</code></td>
                <td class="type">{{ f.type }}</td>
                <td>{{ t('apiConsole.fields.' + f.key) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeBlock :code="ep.responseSample" :title="t('apiConsole.docs.responseExample')" :max-height="300" />

        <div class="sample-head">
          <h4 class="sub-h">{{ t('apiConsole.docs.sample') }}</h4>
          <SegmentedControl v-model="lang" :options="langOptions" size="sm" />
        </div>
        <CodeBlock :code="sample" :language="lang === 'curl' ? 'shell' : 'text'" :title="lang === 'curl' ? 'cURL' : 'JavaScript'" :max-height="360" />
      </article>
    </div>
  </div>
</template>

<style scoped>
.docs { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; align-items: start; }
.doc-nav { position: sticky; top: calc(var(--kpz-sticky-top, 64px) + 12px); padding: 8px; display: flex; flex-direction: column; gap: 2px; max-height: calc(100vh - 120px); overflow-y: auto; }
.nav-search { display: flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid var(--line-1); border-radius: 8px; margin-bottom: 6px; color: var(--ink-3); }
.nav-input { border: 0; outline: 0; height: 32px; flex: 1; min-width: 0; font: inherit; font-size: 13px; background: transparent; color: var(--ink-1); }
.nav-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; border: 0; background: transparent; text-align: left; cursor: pointer; font-size: 12.5px; color: var(--ink-2); }
.nav-item:hover { background: var(--bg-2); }
.nav-item.active { background: var(--accent-soft); color: var(--accent-ink); }
.nav-empty { padding: 10px; color: var(--ink-3); font-size: 12.5px; }
.path { font-family: var(--font-mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.method { font-family: var(--font-mono); font-size: 10px; font-weight: 700; width: 38px; flex: none; text-align: center; padding: 2px 0; border-radius: 5px; }
.method.lg { font-size: 12px; width: auto; padding: 3px 8px; }
.method.get { background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); }
.method.post { background: var(--accent-soft); color: var(--accent-ink); }
.method.delete { background: oklch(0.95 0.04 25); color: var(--danger); }
.intro-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin: 10px 0; }
.il { font-size: 11.5px; color: var(--ink-3); }
.iv { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 2px; }
.intro code, .endpoint code { font-family: var(--font-mono); font-size: 12px; }
.intro p { margin: 0; line-height: 1.6; }
.ep-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.ep-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ep-path { font-size: 15px !important; font-weight: 600; word-break: break-all; }
.ep-title { font-family: var(--font-display); font-size: 18px; margin: 14px 0 4px; }
.ep-desc { color: var(--ink-2); margin: 0 0 10px; line-height: 1.6; }
.ep-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.ep-meta .tag { height: auto; padding: 3px 8px; }
.sub-h { font-size: 13.5px; font-weight: 600; margin: 20px 0 8px; display: flex; align-items: center; gap: 8px; }
.schema td { font-size: 13px; }
.type { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); }
.req { font-size: 10.5px; color: var(--danger); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.endpoint :deep(.kpz-code), .endpoint > * + .kpz-code { margin-top: 10px; }
.sample-head { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; }
.sample-head .sub-h { margin: 0; }
.sample-head + * { margin-top: 8px; }
@media (max-width: 1024px) {
  .docs { grid-template-columns: 1fr; }
  .doc-nav { position: static; max-height: 260px; }
}
@media (max-width: 560px) { .intro-grid { grid-template-columns: 1fr; } }
</style>
