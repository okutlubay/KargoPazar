<script setup>
// Marketplace connection flow (spec 7.2): store details -> simulated OAuth consent -> (WooCommerce REST key)
// -> first sync -> connected. Denying shows "Connection cancelled" and restarts.
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import Stepper from '../Stepper.vue'
import FormField from '../FormField.vue'
import ChannelLogo from '../ChannelLogo.vue'
import ProgressBar from '../ProgressBar.vue'
import Spinner from '../Spinner.vue'
import { CHANNELS } from '../ChannelLogo.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { validateStoreInput, startStoreConnection, authorizeStoreConnection, initialSync, CHANNEL_META } from '../../api/integrations.js'
import { channelName, errorMessage, fieldError } from './storeUtils.js'
import { db } from '../../store/db.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  channel: { type: String, default: null },
})
const emit = defineEmits(['update:open', 'connected', 'manage'])
const { t, fmt } = useI18n()
const router = useRouter()

// phases: details | consent | authorizing | apikey | denied | sync | done
const phase = ref('details')
const form = ref({ shopUrl: '', siteUrl: '', region: 'US' })
const fieldErr = ref({})
const busy = ref(false)
const session = ref(null)
const apiKey = ref(null)
const keySteps = ref(0)
const syncPct = ref(0)
const result = ref(null)
const store = ref(null)
const error = ref('')
const inputRef = ref(null)

const meta = computed(() => CHANNEL_META[props.channel] ?? {})
const brand = computed(() => CHANNELS[props.channel] ?? { color: 'var(--ink-1)', ink: '#fff' })
const name = computed(() => channelName(props.channel))

const steps = computed(() => [
  { key: 'details', label: t('integrations.connect.steps.details') },
  { key: 'auth', label: t('integrations.connect.steps.auth'), error: phase.value === 'denied' },
  { key: 'done', label: t('integrations.connect.steps.done') },
])
const stepIndex = computed(() => ({ details: 0, consent: 1, authorizing: 1, apikey: 1, denied: 1, sync: 2, done: 2 })[phase.value] ?? 0)
const locked = computed(() => busy.value || phase.value === 'sync' || phase.value === 'authorizing' || phase.value === 'apikey')

const consentUrl = computed(() => {
  const d = session.value?.store?.domain
  switch (props.channel) {
    case 'shopify': return `https://${d ?? 'store.myshopify.com'}/admin/oauth/authorize?client_id=kargopazar&scope=read_orders,write_fulfillments`
    case 'etsy': return 'https://www.etsy.com/oauth/connect?client_id=kargopazar&scope=transactions_r%20listings_r'
    case 'amazon': return 'https://sellercentral.amazon.com/apps/authorize/consent?application_id=amzn1.sp.solution.kargopazar'
    case 'ebay': return 'https://auth.ebay.com/oauth2/authorize?client_id=KargoPazar-PRD&response_type=code'
    case 'woocommerce': return `${d ?? 'https://store.example'}/wc-auth/v1/authorize?app_name=KargoPazar&scope=read_write`
    default: return ''
  }
})
const created = computed(() => result.value?.orderIds?.map(id => db.get('orders', id)).filter(Boolean) ?? [])
const problems = computed(() => created.value.filter(o => (o.addressCheck?.score ?? 100) < 70))

function reset() {
  phase.value = 'details'
  form.value = { shopUrl: '', siteUrl: '', region: 'US' }
  fieldErr.value = {}
  busy.value = false
  session.value = null
  apiKey.value = null
  keySteps.value = 0
  syncPct.value = 0
  result.value = null
  store.value = null
  error.value = ''
}
watch(() => props.open, v => { if (v) reset() })

function close() {
  if (locked.value) return
  emit('update:open', false)
}

function validateField(key) {
  const v = validateStoreInput(props.channel, form.value)
  fieldErr.value = { ...fieldErr.value, [key]: v.errors[key] ? fieldError(v.errors[key]) : '' }
  return !v.errors[key]
}

async function start() {
  error.value = ''
  const v = validateStoreInput(props.channel, form.value)
  if (!v.valid) {
    const fe = {}
    for (const [k, c] of Object.entries(v.errors)) fe[k] = fieldError(c)
    fieldErr.value = fe
    inputRef.value?.focus?.()
    return
  }
  busy.value = true
  try {
    session.value = await startStoreConnection(props.channel, { ...form.value })
    phase.value = 'consent'
  } catch (e) {
    if (e.details) {
      const fe = {}
      for (const [k, c] of Object.entries(e.details)) fe[k] = fieldError(c)
      fieldErr.value = fe
    }
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function authorize(approve) {
  if (!session.value || busy.value) return
  busy.value = true
  error.value = ''
  if (!approve) {
    try {
      await authorizeStoreConnection(session.value.sessionId, { approve: false })
    } catch (e) {
      if (e.code === 'OAUTH_DENIED') {
        phase.value = 'denied'
        toast.warning(t('integrations.connect.cancelledToast', { store: name.value }))
      } else error.value = errorMessage(e)
    } finally {
      busy.value = false
    }
    return
  }
  phase.value = session.value.requiresApiKey ? 'apikey' : 'authorizing'
  let ticker = null
  if (session.value.requiresApiKey) {
    keySteps.value = 0
    ticker = setInterval(() => { if (keySteps.value < 2) keySteps.value++ }, 380)
  }
  try {
    const r = await authorizeStoreConnection(session.value.sessionId, { approve: true })
    store.value = r.store
    apiKey.value = r.apiKey
    if (ticker) { clearInterval(ticker); keySteps.value = 3; await sleep(700) }
    emit('connected', r.store)
    await runSync()
  } catch (e) {
    if (ticker) clearInterval(ticker)
    error.value = errorMessage(e)
    phase.value = e.code === 'SESSION_EXPIRED' ? 'details' : 'consent'
    if (e.code === 'SESSION_EXPIRED') session.value = null
  } finally {
    busy.value = false
  }
}

async function runSync() {
  phase.value = 'sync'
  syncPct.value = 0
  try {
    result.value = await initialSync(store.value.id, { onProgress: p => { syncPct.value = p } })
    phase.value = 'done'
    toast.success(t('integrations.connect.connectedToast', { store: name.value, n: result.value.newOrders }))
    emit('connected', store.value)
  } catch (e) {
    error.value = errorMessage(e)
    phase.value = 'done'
  }
}

function restart() {
  session.value = null
  error.value = ''
  phase.value = 'details'
}

function goOrders() {
  emit('update:open', false)
  router.push({ path: '/orders', query: { channel: props.channel } })
}
function goOrder(id) {
  emit('update:open', false)
  router.push(`/orders/${id}`)
}
function goSettings() {
  emit('update:open', false)
  emit('manage', store.value)
}
</script>

<template>
  <Modal :open="open" :title="t('integrations.connect.title', { store: name })" :subtitle="t('integrations.connect.subtitle')" size="lg" :closable="!locked" @update:open="v => !v && close()">
    <Stepper :steps="steps" :current="stepIndex" :can-navigate="() => false" class="stepper" />

    <!-- 1. Store details -->
    <section v-if="phase === 'details'" class="phase">
      <div class="intro">
        <ChannelLogo :code="channel" :size="44" />
        <div>
          <div class="intro-title">{{ t('integrations.connect.detailsTitle', { store: name }) }}</div>
          <div class="intro-sub">{{ t('integrations.connect.detailsDesc.' + channel) }}</div>
        </div>
      </div>

      <FormField v-if="meta.input === 'shopUrl'" :label="t('integrations.connect.shopUrl')" :hint="t('integrations.connect.shopUrlHint')" :error="fieldErr.shopUrl" :value="form.shopUrl" required v-slot="{ id, invalid, describedBy }">
        <input :id="id" ref="inputRef" v-model="form.shopUrl" class="input" :class="{ invalid }" :aria-invalid="invalid" :aria-describedby="describedBy" placeholder="anatolia-outlet.myshopify.com" autocomplete="off" spellcheck="false" @blur="validateField('shopUrl')" @keydown.enter.prevent="start" />
      </FormField>
      <FormField v-else-if="meta.input === 'siteUrl'" :label="t('integrations.connect.siteUrl')" :hint="t('integrations.connect.siteUrlHint')" :error="fieldErr.siteUrl" :value="form.siteUrl" required v-slot="{ id, invalid, describedBy }">
        <input :id="id" ref="inputRef" v-model="form.siteUrl" class="input" :class="{ invalid }" :aria-invalid="invalid" :aria-describedby="describedBy" placeholder="https://shop.anatoliahome.com" autocomplete="off" spellcheck="false" @blur="validateField('siteUrl')" @keydown.enter.prevent="start" />
      </FormField>
      <FormField v-else-if="meta.input === 'region'" :label="t('integrations.connect.region')" :hint="t('integrations.connect.regionHint')" :error="fieldErr.region" :value="form.region" required v-slot="{ id, invalid }">
        <select :id="id" v-model="form.region" class="select" :aria-invalid="invalid">
          <option value="US">{{ t('integrations.connect.regions.US') }}</option>
          <option value="CA" disabled>{{ t('integrations.connect.regions.CA') }}</option>
          <option value="UK" disabled>{{ t('integrations.connect.regions.UK') }}</option>
        </select>
      </FormField>
      <div v-else class="callout neutral"><Icon name="info" :size="15" /> {{ t('integrations.connect.redirectNote', { store: name }) }}</div>

      <div v-if="error" class="callout danger"><Icon name="alert" :size="15" /> {{ error }}</div>
    </section>

    <!-- 2. Consent screen (marketplace colors) -->
    <section v-else-if="phase === 'consent' || phase === 'authorizing'" class="phase">
      <div class="browser">
        <div class="chrome">
          <span class="dots"><i /><i /><i /></span>
          <div class="url"><Icon name="lock" :size="11" /><span class="truncate">{{ consentUrl }}</span></div>
        </div>
        <div class="consent" :style="{ '--brand': brand.color, '--brand-ink': brand.ink }">
          <div class="c-band">
            <span class="c-brandname">{{ name }}</span>
          </div>
          <div class="c-body">
            <div class="c-logos">
              <span class="kp-logo"><Icon name="logo" :size="44" /></span>
              <span class="c-arrows"><Icon name="chevron-left" :size="14" /><Icon name="chevron-right" :size="14" /></span>
              <ChannelLogo :code="channel" :size="44" />
            </div>
            <h3 class="c-title">{{ t('integrations.connect.consentTitle', { store: name }) }}</h3>
            <p class="c-sub">{{ t('integrations.connect.consentSub', { shop: session?.store?.name ?? name }) }}</p>
            <div class="c-perm-title">{{ t('integrations.connect.permissionsTitle') }}</div>
            <ul class="c-perms">
              <li v-for="p in session?.permissions ?? []" :key="p">
                <span class="c-check"><Icon name="check" :size="12" /></span>
                <div>
                  <div class="p-name">{{ t('core.integrations.permissions.' + p) }}</div>
                  <div class="p-desc">{{ t('integrations.connect.permDesc.' + p) }}</div>
                </div>
              </li>
            </ul>
            <p class="c-legal">{{ t('integrations.connect.consentLegal') }}</p>
            <div v-if="error" class="callout danger"><Icon name="alert" :size="15" /> {{ error }}</div>
            <div class="c-actions">
              <button class="btn btn-ghost" :disabled="busy" @click="authorize(false)">{{ t('integrations.connect.deny') }}</button>
              <button class="btn c-allow" :disabled="busy" @click="authorize(true)">
                <Spinner v-if="phase === 'authorizing'" :size="14" />
                {{ phase === 'authorizing' ? t('integrations.connect.authorizing') : t('integrations.connect.allow') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- WooCommerce REST API key -->
    <section v-else-if="phase === 'apikey'" class="phase center">
      <div class="big-icon accent"><Icon name="key" :size="22" /></div>
      <div class="phase-title">{{ t('integrations.connect.apiKeyTitle') }}</div>
      <ul class="checklist">
        <li v-for="(k, i) in ['consumer', 'permissions', 'webhooks']" :key="k" :class="{ done: keySteps > i, active: keySteps === i }">
          <span class="ck"><Icon v-if="keySteps > i" name="check" :size="12" /><Spinner v-else-if="keySteps === i" :size="12" /></span>
          {{ t('integrations.connect.apiKeySteps.' + k) }}
        </li>
      </ul>
      <p v-if="apiKey" class="mono-note">{{ t('integrations.connect.apiKeyCreated') }} <code>{{ apiKey.consumerKeyMasked }}</code></p>
    </section>

    <!-- Denied -->
    <section v-else-if="phase === 'denied'" class="phase center">
      <div class="big-icon danger"><Icon name="x-circle" :size="24" /></div>
      <div class="phase-title">{{ t('integrations.connect.cancelledTitle') }}</div>
      <p class="phase-desc">{{ t('integrations.connect.cancelledDesc', { store: name }) }}</p>
    </section>

    <!-- 3. First sync -->
    <section v-else-if="phase === 'sync'" class="phase center">
      <div class="big-icon accent"><Icon name="sync" :size="22" /></div>
      <div class="phase-title">{{ t('integrations.connect.syncTitle') }}</div>
      <p class="phase-desc">{{ t('integrations.connect.syncDesc', { store: name }) }}</p>
      <ProgressBar :value="syncPct" size="lg" show-value class="sync-bar" />
    </section>

    <!-- Done -->
    <section v-else-if="phase === 'done'" class="phase center">
      <div class="big-icon success"><Icon name="check-circle" :size="24" /></div>
      <div class="phase-title">{{ t('integrations.connect.doneTitle', { store: name }) }}</div>
      <p v-if="result" class="phase-desc">{{ result.newOrders ? t('integrations.connect.doneOrders', { n: result.newOrders }) : t('integrations.connect.doneNoOrders') }}</p>
      <div v-if="error" class="callout danger"><Icon name="alert" :size="15" /> {{ error }}</div>
      <div v-if="problems.length" class="callout warn left">
        <Icon name="alert" :size="15" />
        <div>
          {{ t('integrations.connect.problems', { n: problems.length }) }}
          <span v-for="o in problems" :key="o.id"> <button class="btn-link" @click="goOrder(o.id)">{{ o.id }}</button> ({{ t('integrations.connect.score', { n: o.addressCheck?.score }) }})</span>
        </div>
      </div>
      <div v-if="created.length" class="mini-list">
        <div v-for="o in created.slice(0, 5)" :key="o.id" class="mini-row">
          <span class="mono">{{ o.id }}</span>
          <span class="truncate">{{ o.customer?.name }} · {{ o.shipTo?.city }}, {{ o.shipTo?.state }}</span>
          <span class="num">{{ fmt.money(o.total ?? 0) }}</span>
        </div>
        <div v-if="created.length > 5" class="mini-more">{{ t('integrations.connect.more', { n: created.length - 5 }) }}</div>
      </div>
    </section>

    <template #footer>
      <template v-if="phase === 'details'">
        <button class="btn btn-ghost btn-sm" @click="close">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="start"><Spinner v-if="busy" :size="14" /> {{ t('integrations.connect.continueTo', { store: name }) }}</button>
      </template>
      <template v-else-if="phase === 'denied'">
        <button class="btn btn-ghost btn-sm" @click="close">{{ t('common.close') }}</button>
        <button class="btn btn-primary btn-sm" @click="restart"><Icon name="refresh" :size="14" /> {{ t('integrations.connect.restart') }}</button>
      </template>
      <template v-else-if="phase === 'done'">
        <button class="btn btn-ghost btn-sm" @click="goSettings">{{ t('integrations.connect.openSettings') }}</button>
        <button v-if="result?.newOrders" class="btn btn-ghost btn-sm" @click="goOrders">{{ t('integrations.stores.viewOrders') }}</button>
        <button class="btn btn-primary btn-sm" @click="close">{{ t('common.finish') }}</button>
      </template>
      <template v-else-if="phase === 'consent'">
        <button class="btn btn-ghost btn-sm" :disabled="busy" @click="restart">{{ t('common.back') }}</button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.stepper { margin-bottom: 18px; }
.phase { display: flex; flex-direction: column; gap: 14px; }
.phase.center { align-items: center; text-align: center; padding: 10px 0 6px; }
.intro { display: flex; gap: 14px; align-items: center; }
.intro-title { font-weight: 600; font-size: 15px; }
.intro-sub { color: var(--ink-3); font-size: 13px; margin-top: 2px; line-height: 1.5; }
.browser { border: 1px solid var(--line-2); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow-md); }
.chrome { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-3); border-bottom: 1px solid var(--line-1); }
.dots { display: flex; gap: 5px; }
.dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--line-strong); display: block; }
.url { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--line-1); border-radius: 7px; padding: 4px 9px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); }
.consent { background: var(--surface); }
.c-band { background: var(--brand); color: var(--brand-ink); padding: 10px 18px; font-weight: 700; letter-spacing: -0.01em; font-size: 15px; }
.c-body { padding: 16px 22px 16px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
.c-logos { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
.kp-logo { display: inline-flex; }
.c-arrows { display: inline-flex; color: var(--ink-4); }
.c-title { font-family: var(--font-display); font-size: 17px; margin: 4px 0 0; }
.c-sub { color: var(--ink-3); margin: 0; font-size: 13px; }
.c-perm-title { align-self: stretch; text-align: left; font-weight: 600; font-size: 12.5px; color: var(--ink-2); margin-top: 12px; }
.c-perms { list-style: none; margin: 0; padding: 0; align-self: stretch; text-align: left; border: 1px solid var(--line-1); border-radius: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: hidden; }
.c-perms li { display: flex; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--line-1); border-right: 1px solid var(--line-1); margin-bottom: -1px; }
.c-perms li:nth-child(2n) { border-right: 0; }
@media (max-width: 640px) { .c-perms { grid-template-columns: 1fr; } .c-perms li { border-right: 0; } }
.c-check { width: 20px; height: 20px; border-radius: 50%; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; flex: none; margin-top: 1px; }
.p-name { font-weight: 500; font-size: 13.5px; }
.p-desc { color: var(--ink-3); font-size: 12px; }
.c-legal { color: var(--ink-3); font-size: 11.5px; margin: 8px 0 0; line-height: 1.5; }
.c-actions { display: flex; gap: 10px; justify-content: flex-end; align-self: stretch; margin-top: 10px; }
.c-allow { background: var(--brand); color: var(--brand-ink); }
.c-allow:hover { filter: brightness(1.05); }
.big-icon { width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; }
.big-icon.accent { background: var(--accent-soft); color: var(--accent-ink); }
.big-icon.success { background: oklch(0.95 0.05 155); color: oklch(0.45 0.12 155); }
.big-icon.danger { background: oklch(0.95 0.04 25); color: var(--danger); }
.phase-title { font-family: var(--font-display); font-weight: 600; font-size: 18px; }
.phase-desc { color: var(--ink-2); margin: 0; max-width: 460px; line-height: 1.55; }
.sync-bar { width: 100%; max-width: 420px; }
.checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; text-align: left; }
.checklist li { display: flex; align-items: center; gap: 10px; color: var(--ink-3); font-size: 13.5px; }
.checklist li.active { color: var(--ink-1); }
.checklist li.done { color: var(--ink-1); }
.ck { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--line-2); display: grid; place-items: center; color: var(--accent); }
.checklist li.done .ck { background: var(--success); border-color: var(--success); color: #fff; }
.mono-note { font-size: 13px; color: var(--ink-2); margin: 0; }
.mono-note code, .mono { font-family: var(--font-mono); font-size: 12px; }
.callout.left { text-align: left; align-self: stretch; }
.mini-list { align-self: stretch; border: 1px solid var(--line-1); border-radius: 10px; text-align: left; }
.mini-row { display: grid; grid-template-columns: 90px 1fr auto; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--line-1); font-size: 13px; align-items: center; }
.mini-row:last-child { border-bottom: 0; }
.mini-more { padding: 8px 12px; color: var(--ink-3); font-size: 12.5px; }
</style>
