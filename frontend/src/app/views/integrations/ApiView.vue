<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import CopyButton from '../../components/CopyButton.vue'
import ApiKeysPanel from '../../components/integrations/ApiKeysPanel.vue'
import ApiDocsPanel from '../../components/integrations/ApiDocsPanel.vue'
import ApiConsolePanel from '../../components/integrations/ApiConsolePanel.vue'
import RequestLogPanel from '../../components/integrations/RequestLogPanel.vue'
import WebhooksPanel from '../../components/integrations/WebhooksPanel.vue'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { API_BASE_URL } from '../../api/console.js'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const TABS = ['keys', 'docs', 'console', 'logs', 'webhooks']

const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'keys')
const consoleEndpoint = ref(typeof route.query.endpoint === 'string' ? route.query.endpoint : null)

const activeKeys = computed(() => db.all('api_keys').filter(k => k.status === 'active').length)
const endpoints = computed(() => (db.doc('webhooks')?.endpoints ?? []).length)
const tabs = computed(() => [
  { key: 'keys', label: t('apiConsole.tabs.keys'), icon: 'key', count: activeKeys.value },
  { key: 'docs', label: t('apiConsole.tabs.docs'), icon: 'file' },
  { key: 'console', label: t('apiConsole.tabs.console'), icon: 'terminal' },
  { key: 'logs', label: t('apiConsole.tabs.logs'), icon: 'list' },
  { key: 'webhooks', label: t('apiConsole.tabs.webhooks'), icon: 'webhook', count: endpoints.value },
])

watch(tab, v => { if (route.query.tab !== v) router.replace({ query: { ...route.query, tab: v, endpoint: v === 'console' ? route.query.endpoint : undefined } }) })
watch(() => route.query.tab, v => { if (TABS.includes(v) && v !== tab.value) tab.value = v })

function tryEndpoint(id) {
  consoleEndpoint.value = id
  tab.value = 'console'
  router.replace({ query: { tab: 'console', endpoint: id } })
}
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.api')" :subtitle="t('apiConsole.subtitle')">
      <template #actions>
        <div class="base">
          <span class="base-label">{{ t('apiConsole.baseUrl') }}</span>
          <code>{{ API_BASE_URL }}</code>
          <CopyButton :text="API_BASE_URL" size="xs" :aria-label="t('apiConsole.copyBase')" />
        </div>
      </template>
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.api')" class="tabs" />

    <ApiKeysPanel v-if="tab === 'keys'" @open-console="tryEndpoint('rates')" />
    <ApiDocsPanel v-else-if="tab === 'docs'" @try="tryEndpoint" />
    <ApiConsolePanel v-else-if="tab === 'console'" :initial-endpoint="consoleEndpoint" @show-log="tab = 'logs'" />
    <RequestLogPanel v-else-if="tab === 'logs'" />
    <WebhooksPanel v-else-if="tab === 'webhooks'" />

    <p class="foot-note"><Icon name="info" :size="12" /> {{ t('apiConsole.sandboxNote') }}</p>
  </div>
</template>

<style scoped>
.tabs { margin-bottom: 18px; }
.base { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border: 1px solid var(--line-1); border-radius: 10px; background: var(--surface); }
.base-label { font-size: 12px; color: var(--ink-3); }
.base code { font-family: var(--font-mono); font-size: 12.5px; }
.foot-note { margin: 20px 0 0; color: var(--ink-3); font-size: 12px; display: flex; gap: 6px; align-items: center; }
@media (max-width: 560px) { .base-label { display: none; } .base code { font-size: 11px; } }
</style>
