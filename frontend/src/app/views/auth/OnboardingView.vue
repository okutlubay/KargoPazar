<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Wordmark from '@/components/Wordmark.vue'
import Stepper from '../../components/Stepper.vue'
import Skeleton from '../../components/Skeleton.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import StatusPill from '../../components/StatusPill.vue'
import Money from '../../components/Money.vue'
import TopUpModal from '../../components/billing/TopUpModal.vue'
import OnboardingQuestions from './OnboardingQuestions.vue'
import StoreConnectModal from './StoreConnectModal.vue'
import { t, tx, locale, setLocale, fmt } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { advisePlan, emptyAnswers } from './planAdvisor.js'
import { getOnboarding, saveOnboardingProgress, completeOnboarding } from './signupApi.js'
import { listStores } from '../../api/integrations.js'
import { getWallet } from '../../api/wallet.js'

const router = useRouter()
const loading = ref(true)
const step = ref(0)
const maxReached = ref(0)
const answers = ref(emptyAnswers())
const chosenPlan = ref(null)
const signup = ref(null)
const questions = ref(null)
const finishing = ref(false)

const steps = computed(() => ['business', 'needs', 'recommendation', 'stores', 'wallet', 'done'].map(k => ({ key: k, label: t('signup.onb.steps.' + k) })))
const rec = computed(() => advisePlan(answers.value))

// ---- stores (step 4)
const stores = ref([])
const storesLoading = ref(false)
const connectOpen = ref(false)
const connectChannel = ref('shopify')
const connectedNow = ref([])
const wantedChannels = computed(() => (answers.value.channels ?? []).filter(c => c !== 'api'))
function storeOf(c) { return stores.value.find(s => s.channel === c) }
async function loadStores() {
  storesLoading.value = true
  try { stores.value = await listStores() } catch { toast.error(t('common.errorGeneric')) } finally { storesLoading.value = false }
}
function openConnect(c) { connectChannel.value = c; connectOpen.value = true }
async function onConnected(r) {
  if (!connectedNow.value.includes(r.store.channel)) connectedNow.value.push(r.store.channel)
  toast.success(t('signup.connect.doneToast', { name: r.store.name ?? r.store.channel, n: r.sync.newOrders }))
  await loadStores()
}

// ---- wallet (step 5)
const wallet = ref(null)
const topupAmount = ref(250)
const customAmount = ref('')
const topupOpen = ref(false)
const topupDone = ref(null)
const amountError = ref('')
async function loadWallet() {
  try { wallet.value = await getWallet() } catch { toast.error(t('common.errorGeneric')) }
}
const effectiveAmount = computed(() => topupAmount.value === 'custom' ? Number(customAmount.value) : topupAmount.value)
function openTopup() {
  amountError.value = ''
  if (!(effectiveAmount.value >= 25)) { amountError.value = t('signup.onb.wallet.min'); return }
  topupOpen.value = true
}
async function onTopupDone(txn) {
  topupDone.value = txn?.amount ?? effectiveAmount.value
  await loadWallet()
}

// ---- navigation
async function persist() {
  try { await saveOnboardingProgress({ step: step.value, maxReached: maxReached.value, answers: answers.value, chosenPlan: chosenPlan.value }) } catch {}
}
function go(i) {
  step.value = i
  maxReached.value = Math.max(maxReached.value, i)
  window.scrollTo({ top: 0, behavior: 'smooth' })
  persist()
}
function next() {
  if (step.value <= 2 && questions.value && !questions.value.validate()) return
  if (step.value === 2 && !chosenPlan.value) chosenPlan.value = rec.value.plan
  go(Math.min(step.value + 1, steps.value.length - 1))
}
function back() { if (step.value > 0) go(step.value - 1) }
function canNavigate(i) { return i <= maxReached.value && i !== step.value }

watch(step, s => {
  if (s === 3 && !stores.value.length) loadStores()
  if (s === 4 && !wallet.value) loadWallet()
})

// When answers change after the recommendation was shown, keep the user's own pick only if still set.
watch(() => rec.value.plan, (p, old) => { if (chosenPlan.value === old) chosenPlan.value = p })

async function finish() {
  finishing.value = true
  try {
    const connected = stores.value.filter(s => s.status === 'connected').map(s => s.channel).filter(c => wantedChannels.value.includes(c))
    await completeOnboarding({ answers: answers.value, recommendation: rec.value, chosenPlan: chosenPlan.value ?? rec.value.plan, stores: connected, topup: topupDone.value })
    toast.success(t('signup.onb.completedToast'), { duration: 6000 })
    router.replace({ name: 'overview' })
  } catch {
    toast.error(t('common.errorGeneric'))
  } finally { finishing.value = false }
}

async function exitWizard() {
  const ok = await confirm({ title: t('signup.onb.exitTitle'), message: t('signup.onb.exitMsg'), confirmLabel: t('signup.onb.exitConfirm') })
  if (!ok) return
  await persist()
  router.push({ name: 'overview' })
}

onMounted(async () => {
  try {
    const r = await getOnboarding()
    signup.value = r.signup
    const p = r.progress
    if (p?.answers) answers.value = { ...emptyAnswers(), ...p.answers }
    else if (r.answers) answers.value = { ...emptyAnswers(), ...r.answers }
    if (p) { step.value = Math.min(p.step ?? 0, 4); maxReached.value = Math.max(p.maxReached ?? 0, step.value); chosenPlan.value = p.chosenPlan ?? null }
    else if (r.answers?.chosenPlan) chosenPlan.value = r.answers.chosenPlan
  } catch {
    toast.error(t('common.errorGeneric'))
  } finally {
    loading.value = false
    if (step.value === 3) loadStores()
    if (step.value === 4) loadWallet()
  }
})

const hubName = h => t('signup.onb.hubNames.' + h)
</script>

<template>
  <div class="onb">
    <header class="top">
      <RouterLink :to="{ name: 'overview' }" class="brand" :aria-label="t('nav.overview')"><Wordmark /></RouterLink>
      <div class="top-right">
        <span class="demo-badge" :title="t('common.demoTip')">{{ t('common.demo') }}</span>
        <button class="lang mono" :aria-label="t('shell.language')" @click="setLocale(locale === 'tr' ? 'en' : 'tr')">
          <span :class="{ on: locale === 'tr' }">TR</span> / <span :class="{ on: locale === 'en' }">EN</span>
        </button>
        <button class="btn btn-ghost btn-sm" @click="exitWizard"><Icon name="x" :size="13" />{{ t('signup.onb.exit') }}</button>
      </div>
    </header>

    <main class="wrap">
      <div class="intro">
        <h1 class="title">{{ signup ? t('signup.onb.welcomeName', { name: signup.name.split(' ')[0] }) : t('signup.onb.welcome') }}</h1>
        <p class="sub">{{ t('signup.onb.sub') }}</p>
      </div>

      <Stepper v-model:current="step" :steps="steps" :max-reached="maxReached" :can-navigate="canNavigate" @navigate="go" />

      <section class="panel card-body">
        <div v-if="loading" class="pad"><Skeleton :lines="6" /></div>
        <template v-else>
          <header class="step-head">
            <div class="step-no mono">{{ t('signup.onb.stepOf', { n: step + 1, total: steps.length }) }}</div>
            <h2 class="step-title">{{ t('signup.onb.titles.' + steps[step].key) }}</h2>
            <p class="step-sub">{{ t('signup.onb.subs.' + steps[step].key) }}</p>
          </header>

          <div class="pad">
            <OnboardingQuestions v-if="step <= 2" ref="questions" v-model="answers" v-model:plan="chosenPlan" :step="step" />

            <!-- Step 4: stores -->
            <template v-else-if="step === 3">
              <div v-if="!wantedChannels.length" class="callout neutral"><Icon name="info" :size="15" />{{ t('signup.onb.stores.none') }}</div>
              <div v-else-if="storesLoading && !stores.length" class="stack"><Skeleton v-for="i in 3" :key="i" variant="rect" :height="58" /></div>
              <div v-else class="store-list">
                <div v-for="c in wantedChannels" :key="c" class="store-row">
                  <ChannelLogo :code="c" :size="34" show-name :sub="storeOf(c)?.status === 'connected' ? (storeOf(c).name || storeOf(c).shopDomain || '') : t('signup.onb.stores.notConnected')" />
                  <StatusPill :status="storeOf(c)?.status === 'connected' ? 'connected' : 'disconnected'" size="sm" />
                  <span v-if="connectedNow.includes(c)" class="tag tag-success">{{ t('signup.onb.stores.justNow') }}</span>
                  <button v-if="storeOf(c)?.status !== 'connected'" class="btn btn-primary btn-sm" @click="openConnect(c)"><Icon name="link" :size="13" />{{ t('signup.onb.stores.connect') }}</button>
                  <span v-else class="muted small">{{ t('signup.onb.stores.already') }}</span>
                </div>
              </div>
              <div v-if="(answers.channels ?? []).includes('api')" class="callout neutral mt"><Icon name="code" :size="15" />{{ t('signup.onb.stores.api') }}</div>
              <p class="muted small mt">{{ t('signup.onb.stores.laterNote') }}</p>
            </template>

            <!-- Step 5: wallet -->
            <template v-else-if="step === 4">
              <div class="wallet-row">
                <div class="bal">
                  <div class="muted small">{{ t('signup.onb.wallet.balance') }}</div>
                  <div class="bal-v mono"><Money v-if="wallet" :value="wallet.balance" /><Skeleton v-else :width="90" :height="22" variant="rect" /></div>
                </div>
                <div v-if="wallet?.autoTopup?.enabled" class="muted small">{{ t('signup.onb.wallet.auto', { threshold: fmt.money(wallet.autoTopup.threshold), amount: fmt.money(wallet.autoTopup.amount) }) }}</div>
              </div>
              <div v-if="topupDone" class="callout mt"><Icon name="check-circle" :size="15" />{{ t('signup.onb.wallet.done', { amount: fmt.money(topupDone) }) }}</div>
              <h3 class="q-title">{{ t('signup.onb.wallet.choose') }}</h3>
              <div class="amounts" role="radiogroup" :aria-label="t('signup.onb.wallet.choose')">
                <button v-for="v in [100, 250, 500]" :key="v" type="button" role="radio" :aria-checked="topupAmount === v" class="amt mono" :class="{ on: topupAmount === v }" @click="topupAmount = v; amountError = ''">{{ fmt.money(v, 'USD', 0) }}</button>
                <button type="button" role="radio" :aria-checked="topupAmount === 'custom'" class="amt" :class="{ on: topupAmount === 'custom' }" @click="topupAmount = 'custom'">{{ t('signup.onb.wallet.custom') }}</button>
              </div>
              <div v-if="topupAmount === 'custom'" class="custom">
                <label class="field-label" for="onb-amt">{{ t('signup.onb.wallet.customLabel') }}</label>
                <input id="onb-amt" v-model="customAmount" type="number" min="25" step="1" class="input" :class="{ invalid: amountError }" placeholder="150" />
              </div>
              <div v-if="amountError" class="field-error" role="alert">{{ amountError }}</div>
              <div class="mt">
                <button class="btn btn-accent" @click="openTopup"><Icon name="wallet" :size="14" />{{ t('signup.onb.wallet.topup', { amount: effectiveAmount >= 25 ? fmt.money(effectiveAmount) : '-' }) }}</button>
              </div>
              <p class="muted small mt">{{ t('signup.onb.wallet.note') }}</p>
            </template>

            <!-- Step 6: done -->
            <template v-else>
              <div class="done-hero">
                <span class="done-ic"><Icon name="check" :size="22" /></span>
                <div>
                  <div class="done-title">{{ t('signup.onb.done.title') }}</div>
                  <p class="muted">{{ t('signup.onb.done.sub') }}</p>
                </div>
              </div>
              <dl class="kv summary">
                <dt>{{ t('signup.onb.done.plan') }}</dt>
                <dd><strong>{{ t('signup.onb.plans.' + (chosenPlan ?? rec.plan) + '.name') }}</strong> <span v-if="(chosenPlan ?? rec.plan) === rec.plan" class="tag tag-accent">{{ t('signup.onb.recommended') }}</span></dd>
                <dt>{{ t('signup.onb.done.hub') }}</dt><dd>{{ rec.hub }} · {{ hubName(rec.hub) }}</dd>
                <dt>{{ t('signup.onb.done.volume') }}</dt><dd>{{ answers.volume ? t('signup.onb.volume.' + answers.volume) : '-' }}</dd>
                <dt>{{ t('signup.onb.done.channels') }}</dt>
                <dd class="chips"><ChannelLogo v-for="c in answers.channels" :key="c" :code="c" :size="20" /><span v-if="!answers.channels?.length">-</span></dd>
                <dt>{{ t('signup.onb.done.priority') }}</dt><dd>{{ (answers.priorities ?? []).slice(0, 3).map(p => t('signup.onb.prio.' + p)).join(' · ') }}</dd>
                <dt>{{ t('signup.onb.done.services') }}</dt><dd>{{ rec.services.map(s => tx(s.title)).join(', ') || '-' }}</dd>
                <dt>{{ t('signup.onb.done.topup') }}</dt><dd>{{ topupDone ? fmt.money(topupDone) : t('signup.onb.done.skipped') }}</dd>
              </dl>
              <div class="callout mt"><Icon name="info" :size="15" />{{ t('signup.onb.done.demoNote') }}</div>
            </template>
          </div>

          <footer class="foot">
            <button v-if="step > 0 && step < 5" class="btn btn-ghost" @click="back"><Icon name="chevron-left" :size="13" />{{ t('common.back') }}</button>
            <span v-else />
            <div class="foot-right">
              <button v-if="step === 3 || step === 4" class="btn btn-ghost" @click="next">{{ t('common.later') }}</button>
              <button v-if="step < 5" data-testid="onb-continue" class="btn btn-primary" @click="next">{{ t('common.continue') }}<Icon name="arrow" :size="13" /></button>
              <button v-else class="btn btn-primary btn-lg" :disabled="finishing" @click="finish"><span v-if="finishing" class="spin" />{{ t('signup.onb.done.cta') }}<Icon name="arrow" :size="13" /></button>
            </div>
          </footer>
        </template>
      </section>
    </main>

    <StoreConnectModal v-model:open="connectOpen" :channel="connectChannel" @connected="onConnected" />
    <TopUpModal v-model:open="topupOpen" :preset-amount="effectiveAmount >= 25 ? effectiveAmount : null" @done="onTopupDone" />
  </div>
</template>

<style scoped>
.onb { min-height: 100vh; background: var(--bg-2); }
.top { display: flex; align-items: center; justify-content: space-between; padding: 14px 28px; border-bottom: 1px solid var(--line-1); background: var(--surface); position: sticky; top: env(safe-area-inset-top, 0px); z-index: 10; }
.top-right { display: flex; align-items: center; gap: 12px; }
.lang { background: none; border: 0; color: var(--ink-3); cursor: pointer; font-size: 12px; }
.lang .on { color: var(--ink-1); font-weight: 600; }
.wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 64px; display: flex; flex-direction: column; gap: 20px; }
.title { font-family: var(--font-display); font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
.sub { color: var(--ink-3); margin: 4px 0 0; }
.card-body { overflow: hidden; }
.pad { padding: 20px 24px; }
.step-head { padding: 20px 24px 0; }
.step-no { font-size: 11.5px; color: var(--ink-3); letter-spacing: .06em; text-transform: uppercase; }
.step-title { margin: 4px 0 2px; font-family: var(--font-display); font-size: 19px; font-weight: 600; }
.step-sub { margin: 0; color: var(--ink-3); font-size: 13.5px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 24px; border-top: 1px solid var(--line-1); background: var(--bg); }
.foot-right { display: flex; gap: 8px; }
.q-title { margin: 18px 0 10px; font-size: 14.5px; font-weight: 600; font-family: var(--font-display); }
.small { font-size: 12.5px; }
.mt { margin-top: 14px; }
.store-list { display: flex; flex-direction: column; gap: 8px; }
.store-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--surface); flex-wrap: wrap; }
.store-row > :first-child { flex: 1; min-width: 180px; }
.wallet-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding: 14px 16px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); }
.bal-v { font-size: 22px; font-weight: 600; margin-top: 2px; }
.amounts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.amt { height: 46px; border-radius: var(--r-md); border: 1px solid var(--line-2); background: var(--surface); font-weight: 600; cursor: pointer; font-size: 14px; color: var(--ink-1); }
.amt.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.custom { margin-top: 10px; max-width: 220px; }
.done-hero { display: flex; gap: 14px; align-items: center; margin-bottom: 16px; }
.done-ic { width: 46px; height: 46px; border-radius: 999px; background: oklch(0.95 0.05 155); color: var(--success); display: grid; place-items: center; flex: none; }
.done-title { font-family: var(--font-display); font-weight: 600; font-size: 18px; }
.done-hero p { margin: 2px 0 0; }
.summary { grid-template-columns: 170px 1fr; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.spin { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
@media (max-width: 860px) {
  .top { padding: 12px 14px; }
  .pad, .step-head { padding-left: 16px; padding-right: 16px; }
  .foot { padding: 12px 16px; }
  .amounts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary { grid-template-columns: 1fr; }
}
</style>
