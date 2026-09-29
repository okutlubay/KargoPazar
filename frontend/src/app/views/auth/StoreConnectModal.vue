<script setup>
// Mini version of the marketplace connect flow (spec 7.2) used by the setup wizard step 4.
//   <StoreConnectModal v-model:open="x" :channel="'woocommerce'" @connected="r => ..." />
// Steps: store details -> authorization (approve / deny) -> first sync -> done.
import { ref, reactive, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../../components/Modal.vue'
import ChannelLogo, { CHANNELS } from '../../components/ChannelLogo.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import { t } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { CHANNEL_META, validateStoreInput, startStoreConnection, authorizeStoreConnection, initialSync } from '../../api/integrations.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  channel: { type: String, default: 'shopify' },
})
const emit = defineEmits(['update:open', 'connected'])

const stage = ref('info') // info | auth | apikey | sync | done
const input = reactive({ shopUrl: '', siteUrl: '', region: 'US' })
const fieldError = ref('')
const busy = ref(false)
const denied = ref(false)
const session = ref(null)
const progress = ref(0)
const result = ref(null)

const meta = computed(() => CHANNEL_META[props.channel] ?? { name: props.channel, input: null, permissions: [] })
const brand = computed(() => CHANNELS[props.channel] ?? { color: 'var(--ink-1)', ink: '#fff' })

watch(() => props.open, v => {
  if (v) { stage.value = 'info'; fieldError.value = ''; denied.value = false; session.value = null; progress.value = 0; result.value = null }
})

function close() { if (!busy.value) emit('update:open', false) }

async function start() {
  fieldError.value = ''
  const v = validateStoreInput(props.channel, input)
  if (!v.valid) {
    const code = Object.values(v.errors)[0]
    fieldError.value = t('core.validation.' + code)
    return
  }
  busy.value = true
  try {
    session.value = await startStoreConnection(props.channel, { ...input })
    denied.value = false
    stage.value = 'auth'
  } catch (e) {
    if (e.code === 'VALIDATION') fieldError.value = t('core.validation.' + Object.values(e.details ?? {})[0])
    else toast.error(t('core.errors.' + e.code))
  } finally { busy.value = false }
}

async function authorize(approve) {
  busy.value = true
  try {
    if (approve && session.value?.requiresApiKey) { stage.value = 'apikey'; await new Promise(r => setTimeout(r, 900)) }
    const r = await authorizeStoreConnection(session.value.sessionId, { approve })
    stage.value = 'sync'
    progress.value = 0
    const sync = await initialSync(r.store.id, { onProgress: p => { progress.value = p } })
    progress.value = 100
    result.value = { store: r.store, sync }
    stage.value = 'done'
    emit('connected', result.value)
  } catch (e) {
    if (e.code === 'OAUTH_DENIED') {
      denied.value = true
      stage.value = 'info'
      toast.warning(t('signup.connect.denied'))
    } else {
      toast.error(t('core.errors.' + e.code) || t('common.errorGeneric'))
      stage.value = 'info'
    }
  } finally { busy.value = false }
}
</script>

<template>
  <Modal :open="open" :title="t('signup.connect.title', { name: meta.name })" size="md" :closable="!busy" @update:open="v => !v && close()">
    <div class="sc">
      <ol class="sc-steps mono" aria-hidden="true">
        <li :class="{ on: stage === 'info', done: stage !== 'info' }">1 · {{ t('signup.connect.s1') }}</li>
        <li :class="{ on: stage === 'auth' || stage === 'apikey', done: ['sync', 'done'].includes(stage) }">2 · {{ t('signup.connect.s2') }}</li>
        <li :class="{ on: stage === 'sync' || stage === 'done' }">3 · {{ t('signup.connect.s3') }}</li>
      </ol>

      <template v-if="stage === 'info'">
        <div v-if="denied" class="callout danger" role="alert"><Icon name="x-circle" :size="15" />{{ t('signup.connect.denied') }}</div>
        <div class="sc-brand"><ChannelLogo :code="channel" :size="36" show-name :sub="t('signup.connect.infoSub')" /></div>
        <div v-if="meta.input === 'shopUrl'">
          <label class="field-label" for="sc-shop">{{ t('signup.connect.shopUrl') }}</label>
          <input id="sc-shop" v-model="input.shopUrl" class="input" :class="{ invalid: fieldError }" placeholder="my-store.myshopify.com" @keyup.enter="start" />
        </div>
        <div v-else-if="meta.input === 'siteUrl'">
          <label class="field-label" for="sc-site">{{ t('signup.connect.siteUrl') }}</label>
          <input id="sc-site" v-model="input.siteUrl" class="input" :class="{ invalid: fieldError }" placeholder="https://shop.example.com" @keyup.enter="start" />
        </div>
        <div v-else-if="meta.input === 'region'">
          <label class="field-label" for="sc-region">{{ t('signup.connect.region') }}</label>
          <select id="sc-region" v-model="input.region" class="input select"><option value="US">{{ t('signup.connect.regionUs') }}</option></select>
        </div>
        <p v-else class="muted">{{ t('signup.connect.noInput', { name: meta.name }) }}</p>
        <div v-if="fieldError" class="field-error" role="alert">{{ fieldError }}</div>
      </template>

      <template v-else-if="stage === 'auth' || stage === 'apikey'">
        <div class="consent" :style="{ '--brand': brand.color, '--brand-ink': brand.ink }">
          <div class="consent-bar">{{ meta.name }}</div>
          <div class="consent-logos">
            <span class="kp-logo"><Icon name="logo" :size="34" /></span>
            <Icon name="sync" :size="16" class="muted" />
            <ChannelLogo :code="channel" :size="34" />
          </div>
          <p class="consent-text">{{ t('signup.connect.consent', { name: meta.name }) }}</p>
          <ul class="perms">
            <li v-for="p in meta.permissions" :key="p"><Icon name="check" :size="12" />{{ t('core.integrations.permissions.' + p) }}</li>
          </ul>
          <div v-if="stage === 'apikey'" class="callout neutral"><span class="spin dark" />{{ t('signup.connect.apiKey') }}</div>
        </div>
      </template>

      <template v-else-if="stage === 'sync'">
        <p>{{ t('signup.connect.syncing', { name: meta.name }) }}</p>
        <ProgressBar :value="progress" show-value />
      </template>

      <template v-else-if="stage === 'done' && result">
        <div class="done">
          <span class="done-ic"><Icon name="check" :size="20" /></span>
          <div class="done-title">{{ t('signup.connect.done', { name: meta.name }) }}</div>
          <p class="muted">{{ t('signup.connect.doneOrders', { n: result.sync.newOrders }) }}</p>
        </div>
      </template>
    </div>
    <template #footer>
      <template v-if="stage === 'info'">
        <button class="btn btn-ghost" @click="close">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="busy" @click="start"><span v-if="busy" class="spin" />{{ t('common.continue') }}</button>
      </template>
      <template v-else-if="stage === 'auth'">
        <button class="btn btn-ghost" :disabled="busy" @click="authorize(false)">{{ t('signup.connect.deny') }}</button>
        <button class="btn btn-primary" :disabled="busy" @click="authorize(true)"><span v-if="busy" class="spin" />{{ t('signup.connect.allow') }}</button>
      </template>
      <template v-else-if="stage === 'done'">
        <button class="btn btn-primary" @click="emit('update:open', false)">{{ t('common.close') }}</button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.sc { display: flex; flex-direction: column; gap: 14px; }
.sc-steps { list-style: none; padding: 0; margin: 0; display: flex; gap: 14px; font-size: 11.5px; color: var(--ink-4); flex-wrap: wrap; }
.sc-steps .on { color: var(--accent); font-weight: 600; }
.sc-steps .done { color: var(--success); }
.consent { border: 1px solid var(--line-1); border-radius: var(--r-md); overflow: hidden; }
.consent-bar { background: var(--brand); color: var(--brand-ink); padding: 8px 14px; font-weight: 600; font-size: 13px; }
.consent-logos { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 18px 0 8px; }
.kp-logo { display: grid; }
.consent-text { text-align: center; margin: 0 16px 10px; font-size: 13.5px; }
.perms { list-style: none; margin: 0 16px 14px; padding: 10px 12px; border-radius: 8px; background: var(--bg-2); display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.perms li { display: flex; gap: 8px; align-items: center; }
.perms :deep(svg) { color: var(--success); }
.consent .callout { margin: 0 16px 14px; align-items: center; }
.done { text-align: center; padding: 12px 0; }
.done-ic { width: 44px; height: 44px; border-radius: 999px; background: oklch(0.95 0.05 155); color: var(--success); display: inline-grid; place-items: center; }
.done-title { font-weight: 600; font-size: 15px; margin-top: 10px; }
.spin { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; display: inline-block; }
.spin.dark { border-color: var(--line-2); border-top-color: var(--accent); }
@keyframes sp { to { transform: rotate(360deg); } }
</style>
