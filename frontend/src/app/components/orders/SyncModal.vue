<script setup>
// "Senkronize et" (spec 5.4, 7.3): pulls new orders from every connected store with progress
// and per store results. Emits `synced` with the new order ids (the list highlights them).
import { ref, watch, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import ProgressBar from '../ProgressBar.vue'
import ChannelLogo from '../ChannelLogo.vue'
import { t } from '../../i18n/index.js'
import { syncAllStores, listStores } from '../../api/integrations.js'
import { apiErrorText } from '../shipments/helpers.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'synced'])

const running = ref(false)
const progress = ref(0)
const current = ref('')
const stores = ref([])
const results = ref(null)
const error = ref('')

watch(() => props.open, v => { if (v) run() })

async function run() {
  running.value = true
  progress.value = 0
  results.value = null
  error.value = ''
  current.value = ''
  try {
    stores.value = (await listStores()).filter(s => s.status === 'connected')
    const r = await syncAllStores({ onProgress: (p, ch) => { progress.value = p; current.value = ch } })
    progress.value = 100
    results.value = r
    emit('synced', r.flatMap(x => x.orderIds))
  } catch (e) {
    error.value = apiErrorText(e)
  } finally { running.value = false }
}
const total = computed(() => (results.value ?? []).reduce((s, r) => s + r.newOrders, 0))
function resultFor(ch) { return results.value?.find(r => r.channel === ch) }
function state(ch) {
  if (resultFor(ch)) return 'done'
  if (current.value === ch && running.value) return 'running'
  return 'waiting'
}
</script>

<template>
  <Modal :open="open" :title="t('orders.sync.title')" :subtitle="t('orders.sync.sub')" size="md" :closable="!running" @update:open="v => emit('update:open', v)">
    <ProgressBar :value="progress" show-value :tone="error ? 'danger' : results ? 'success' : 'accent'" />
    <ul class="list">
      <li v-for="s in stores" :key="s.id" :class="'st-' + state(s.channel)">
        <ChannelLogo :code="s.channel" :size="28" show-name :sub="s.name || s.shopDomain || ''" />
        <span class="res">
          <template v-if="resultFor(s.channel)">
            <Icon name="check-circle" :size="14" class="ok" />
            {{ resultFor(s.channel).newOrders ? t('core.integrations.syncResult', { store: resultFor(s.channel).name, n: resultFor(s.channel).newOrders }) : t('core.integrations.syncNone', { store: resultFor(s.channel).name }) }}
          </template>
          <template v-else-if="state(s.channel) === 'running'"><span class="spin" />{{ t('orders.sync.pulling') }}</template>
          <span v-else class="muted">{{ t('orders.sync.waiting') }}</span>
        </span>
      </li>
    </ul>
    <div v-if="error" class="callout danger" role="alert"><Icon name="alert" :size="15" />{{ error }}</div>
    <div v-else-if="results" class="callout" :class="{ neutral: !total }"><Icon :name="total ? 'check-circle' : 'info'" :size="15" />{{ total ? t('orders.sync.done', { n: total }) : t('orders.sync.none') }}</div>
    <template #footer>
      <button v-if="error" class="btn btn-ghost" @click="run">{{ t('common.retry') }}</button>
      <button class="btn btn-primary" :disabled="running" @click="emit('update:open', false)">{{ running ? t('orders.sync.running') : t('common.close') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.list { list-style: none; margin: 14px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line-1); }
.list li.st-running { border-color: var(--accent); background: var(--accent-soft); }
.res { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; }
.ok { color: var(--success); }
.spin { width: 13px; height: 13px; border-radius: 999px; border: 2px solid var(--line-2); border-top-color: var(--accent); animation: sp .7s linear infinite; display: inline-block; }
@keyframes sp { to { transform: rotate(360deg); } }
</style>
