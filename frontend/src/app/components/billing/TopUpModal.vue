<script setup>
// Wallet top-up modal with 3-D Secure simulation (spec 5.10). Used by Billing, shipment and batch screens.
//   <TopUpModal v-model:open="show" :preset-amount="250" @done="txn => ..." />
// Emits done(transaction) after the balance was credited.
import { computed, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import Spinner from '../Spinner.vue'
import Icon from '@/components/Icon.vue'
import CardForm from './CardForm.vue'
import CardBrand from './CardBrand.vue'
import AnimatedMoney from './AnimatedMoney.vue'
import { getWallet, topUpStart, topUpConfirm, topUpCancel } from '../../api/wallet.js'
import { errorText } from './apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../toast.js'
import { t, fmt } from '../../i18n/index.js'
import { fx, rate, toDisplay, fromDisplay } from '../../store/currency.js'
import FxNote from '../FxNote.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  presetAmount: { type: Number, default: null },
  reason: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'done'])

// Amounts are entered in the display currency and converted to USD (wallet currency) at the demo rate.
const PRESETS_BY_CUR = { TRY: [2500, 5000, 10000, 25000], USD: [50, 100, 250, 500], EUR: [50, 100, 250, 500], GBP: [50, 100, 200, 500] }
const DEFAULT_BY_CUR = { TRY: 10000, USD: 250, EUR: 250, GBP: 200 }
const MIN_USD = 25
const MAX_USD = 10000
const cur = computed(() => (PRESETS_BY_CUR[fx.display] ? fx.display : 'USD'))
const PRESETS_LIST = computed(() => PRESETS_BY_CUR[cur.value])
const step = ref('form') // form | 3ds | success
const wallet = ref(null)
const loadingWallet = ref(false)
const amountChoice = ref(DEFAULT_BY_CUR[cur.value])
const custom = ref('')
const cardChoice = ref('new')
const card = ref(emptyCard())
const cardForm = ref(null)
const busy = ref(false)
const error = ref('')
const serverErrors = ref({})
const amountError = ref('')
const challenge = ref(null)
const result = ref(null)
const fromBalance = ref(0)

function emptyCard() { return { number: '', exp: '', expMonth: null, expYear: null, cvc: '', holder: '', zip: '', save: true } }

/** Amount in the display currency (what the user picked or typed). */
const amountLocal = computed(() => (amountChoice.value === 'custom' ? Number(String(custom.value).replace(/\s/g, '').replace(',', '.')) : amountChoice.value))
/** Amount credited to the wallet (USD). */
const amount = computed(() => (amountLocal.value > 0 ? Math.round(fromDisplay(amountLocal.value, cur.value) * 100) / 100 : 0))
const minLocal = computed(() => Math.ceil(toDisplay(MIN_USD, cur.value)))
const maxLocal = computed(() => Math.floor(toDisplay(MAX_USD, cur.value)))
const local = (v, d = 2) => fmt.moneyNative(v, cur.value, d)
const usd = v => fmt.moneyNative(v, 'USD', 2)
const allowed = computed(() => can('billing.topup'))

async function load() {
  loadingWallet.value = true
  try {
    wallet.value = await getWallet()
    const def = wallet.value.cards.find(c => c.isDefault) ?? wallet.value.cards[0]
    cardChoice.value = def ? def.id : 'new'
  } catch (e) {
    error.value = errorText(e)
  } finally { loadingWallet.value = false }
}

watch(() => props.open, v => {
  if (!v) return
  step.value = 'form'
  error.value = ''
  serverErrors.value = {}
  amountError.value = ''
  result.value = null
  challenge.value = null
  card.value = emptyCard()
  // presetAmount is USD (e.g. the shortfall of a label purchase)
  const presetLocal = props.presetAmount ? Math.max(minLocal.value, Math.ceil(toDisplay(props.presetAmount, cur.value))) : null
  if (presetLocal && PRESETS_LIST.value.includes(presetLocal)) { amountChoice.value = presetLocal; custom.value = '' }
  else if (presetLocal) { amountChoice.value = 'custom'; custom.value = String(presetLocal) }
  else { amountChoice.value = DEFAULT_BY_CUR[cur.value]; custom.value = '' }
  load()
}, { immediate: true })

function validateAmount() {
  const a = amount.value
  if (!(a > 0)) amountError.value = t('billing.topup.amountRequired')
  else if (a < MIN_USD) amountError.value = t('billing.topup.amountMin', { min: local(minLocal.value, 0) })
  else if (a > MAX_USD) amountError.value = t('billing.topup.amountMax', { max: local(maxLocal.value, 0) })
  else amountError.value = ''
  return !amountError.value
}

const challengeText = computed(() => {
  const c = challenge.value
  if (!c) return ''
  return c.originalCurrency ? `${fmt.moneyNative(c.originalAmount, c.originalCurrency)} (${usd(c.amount)})` : usd(c.amount)
})

const selectedCard = computed(() => wallet.value?.cards.find(c => c.id === cardChoice.value) ?? null)

async function submit() {
  error.value = ''
  serverErrors.value = {}
  const okAmount = validateAmount()
  const okCard = cardChoice.value !== 'new' || cardForm.value?.validate()
  if (!okAmount || !okCard) return
  busy.value = true
  try {
    const original = cur.value === 'USD' ? {} : { originalAmount: amountLocal.value, originalCurrency: cur.value, fxRate: rate(cur.value) }
    const input = cardChoice.value === 'new'
      ? { amount: amount.value, ...original, newCard: { number: card.value.number, expMonth: card.value.expMonth, expYear: card.value.expYear, cvc: card.value.cvc, holder: card.value.holder, zip: card.value.zip, save: card.value.save !== false } }
      : { amount: amount.value, ...original, cardId: cardChoice.value }
    challenge.value = await topUpStart(input)
    step.value = '3ds'
  } catch (e) {
    error.value = errorText(e)
    if (e?.details && typeof e.details === 'object') serverErrors.value = e.details
  } finally { busy.value = false }
}

async function approve() {
  busy.value = true
  try {
    fromBalance.value = wallet.value?.balance ?? 0
    result.value = await topUpConfirm(challenge.value.challengeId, { approve: true })
    step.value = 'success'
    toast.success(t('billing.topup.success', { amount: challengeText.value }))
    emit('done', result.value.transaction)
  } catch (e) {
    error.value = errorText(e)
    step.value = 'form'
  } finally { busy.value = false }
}

async function deny() {
  busy.value = true
  try {
    await topUpConfirm(challenge.value.challengeId, { approve: false })
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
    step.value = 'form'
  }
}

function close() {
  if (step.value === '3ds' && challenge.value) topUpCancel(challenge.value.challengeId).catch(() => {})
  emit('update:open', false)
}
</script>

<template>
  <Modal :open="open" :title="t('billing.topup.title')" :subtitle="reason || t('billing.topup.subtitle')" size="md" :closable="!busy" @update:open="v => !v && close()">
    <!-- STEP 1: amount + card -->
    <form v-if="step === 'form'" class="tu" novalidate @submit.prevent="submit">
      <div class="bal">
        <span>{{ t('billing.topup.currentBalance') }}</span>
        <strong class="num">{{ wallet ? fmt.money(wallet.balance) : '-' }}</strong>
      </div>
      <div v-if="!allowed" class="callout warn"><Icon name="lock" /> {{ t('common.noPermission') }}</div>

      <fieldset class="fs">
        <legend class="lbl">{{ t('billing.topup.amount') }}</legend>
        <div class="amounts" role="radiogroup">
          <button v-for="p in PRESETS_LIST" :key="p" type="button" :data-testid="'topup-amount-' + p" role="radio" :aria-checked="amountChoice === p" :class="['amt', { on: amountChoice === p }]" @click="amountChoice = p; amountError = ''">
            {{ local(p, 0) }}
          </button>
          <button type="button" role="radio" :aria-checked="amountChoice === 'custom'" :class="['amt', { on: amountChoice === 'custom' }]" @click="amountChoice = 'custom'">{{ t('common.custom') }}</button>
        </div>
        <div v-if="amountChoice === 'custom'" class="custom">
          <span class="cur mono">{{ cur }}</span>
          <input v-model="custom" class="input num" :class="{ invalid: amountError }" inputmode="decimal" :placeholder="t('billing.topup.customPh', { min: fmt.number(minLocal) })" autofocus @blur="validateAmount" />
        </div>
        <div v-if="amountError" class="field-error">{{ amountError }}</div>
        <div v-if="cur !== 'USD' && amount > 0" class="hint num">{{ t('fx.wallet.converted', { amount: local(amountLocal), usd: usd(amount) }) }} <FxNote inline /></div>
        <div v-if="wallet?.autoTopup?.enabled" class="hint">{{ t('billing.topup.autoNote', { threshold: fmt.moneyDual(wallet.autoTopup.threshold, 0), amount: fmt.moneyDual(wallet.autoTopup.amount, 0) }) }}</div>
      </fieldset>

      <fieldset class="fs">
        <legend class="lbl">{{ t('billing.topup.paymentMethod') }}</legend>
        <div v-if="loadingWallet" class="cards-loading"><Spinner /> {{ t('common.loading') }}</div>
        <div v-else class="cards">
          <label v-for="c in wallet?.cards ?? []" :key="c.id" :class="['cardopt', { on: cardChoice === c.id }]">
            <input v-model="cardChoice" type="radio" name="tu-card" :value="c.id" />
            <CardBrand :brand="c.brand" size="sm" />
            <span class="mono">•••• {{ c.last4 }}</span>
            <span class="exp">{{ String(c.expMonth).padStart(2, '0') }}/{{ String(c.expYear).slice(-2) }}</span>
            <span v-if="c.isDefault" class="tag">{{ t('billing.cards.default') }}</span>
          </label>
          <label :class="['cardopt', { on: cardChoice === 'new' }]">
            <input v-model="cardChoice" type="radio" name="tu-card" value="new" />
            <Icon name="plus" :size="14" />
            <span>{{ t('billing.topup.newCard') }}</span>
          </label>
        </div>
        <CardForm v-if="cardChoice === 'new'" ref="cardForm" v-model="card" class="newcard" :server-errors="serverErrors" :disabled="busy" />
      </fieldset>

      <div v-if="error" class="callout danger" role="alert"><Icon name="x-circle" /> {{ error }}</div>
    </form>

    <!-- STEP 2: 3-D Secure -->
    <div v-else-if="step === '3ds'" class="tds">
      <div class="bank">
        <div class="bank-head"><Icon name="shield" :size="18" /> <span>3-D Secure</span><span class="bank-name">{{ t('billing.topup.bankName') }}</span></div>
        <h3>{{ t('billing.topup.threeDsTitle') }}</h3>
        <p>{{ t('billing.topup.threeDsDesc') }}</p>
        <dl class="kv">
          <dt>{{ t('billing.topup.merchant') }}</dt><dd>KargoPazar</dd>
          <dt>{{ t('billing.topup.amount') }}</dt><dd class="num"><strong>{{ challengeText }}</strong></dd>
          <dt>{{ t('billing.topup.card') }}</dt><dd><CardBrand :brand="challenge.card.brand" size="sm" /> <span class="mono">•••• {{ challenge.card.last4 }}</span></dd>
        </dl>
        <div class="demo-note"><span class="demo-badge">DEMO</span> {{ t('billing.topup.threeDsDemo') }}</div>
      </div>
      <div v-if="error" class="callout danger" role="alert">{{ error }}</div>
    </div>

    <!-- STEP 3: success -->
    <div v-else class="done">
      <div class="done-ic"><Icon name="check" :size="28" /></div>
      <h3>{{ t('billing.topup.doneTitle') }}</h3>
      <p>{{ t('billing.topup.doneDesc', { amount: challengeText }) }}</p>
      <div class="newbal">
        <span>{{ t('billing.topup.newBalance') }}</span>
        <AnimatedMoney :value="result?.balance ?? 0" :from="fromBalance" :duration="1200" class="big" />
      </div>
      <div class="txn mono">{{ result?.transaction?.id }}</div>
    </div>

    <template #footer>
      <template v-if="step === 'form'">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
        <button type="button" data-testid="topup-pay" class="btn btn-accent" :disabled="busy || !allowed || loadingWallet" @click="submit">
          <Spinner v-if="busy" :size="14" />
          {{ amount > 0 ? t('billing.topup.pay', { amount: cur === 'USD' ? usd(amount) : local(amountLocal) }) : t('billing.topup.payPlain') }}
        </button>
      </template>
      <template v-else-if="step === '3ds'">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="deny">{{ t('billing.topup.deny') }}</button>
        <button type="button" data-testid="topup-approve" class="btn btn-accent" :disabled="busy" @click="approve"><Spinner v-if="busy" :size="14" /> {{ t('billing.topup.approve') }}</button>
      </template>
      <template v-else>
        <button type="button" data-testid="topup-close" class="btn btn-primary" @click="emit('update:open', false)">{{ t('common.close') }}</button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.tu { display: flex; flex-direction: column; gap: 16px; }
.bal { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-radius: var(--r-md); background: var(--bg-2); font-size: 13px; color: var(--ink-2); }
.bal strong { font-size: 16px; color: var(--ink-1); }
.fs { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.lbl { font-size: 12.5px; font-weight: 600; color: var(--ink-2); padding: 0; margin-bottom: 2px; }
.amounts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.amt { height: 40px; border-radius: var(--r-md); border: 1px solid var(--line-2); background: var(--surface); font-weight: 600; font-size: 14px; cursor: pointer; font-variant-numeric: tabular-nums; }
.amt:hover { border-color: var(--line-strong); }
.amt.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); box-shadow: 0 0 0 1px var(--accent) inset; }
.custom { position: relative; }
.custom .cur { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-3); }
.custom .input { width: 100%; padding-left: 52px; }
.custom .cur { font-size: 12px; }
.hint { font-size: 12px; color: var(--ink-3); }
.cards { display: flex; flex-direction: column; gap: 6px; }
.cards-loading { display: flex; gap: 8px; align-items: center; color: var(--ink-3); font-size: 13px; }
.cardopt { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); cursor: pointer; font-size: 13.5px; }
.cardopt.on { border-color: var(--accent); background: color-mix(in oklch, var(--accent-soft) 55%, transparent); }
.cardopt input { accent-color: var(--accent); }
.cardopt .exp { color: var(--ink-3); font-size: 12.5px; margin-left: auto; }
.mono { font-family: var(--font-mono); }
.newcard { margin-top: 6px; }
.tds { display: flex; flex-direction: column; gap: 12px; }
.bank { border: 1px solid var(--line-2); border-radius: var(--r-lg); padding: 18px; background: linear-gradient(180deg, var(--bg-2), var(--surface)); }
.bank-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--ink-2); }
.bank-name { margin-left: auto; font-family: var(--font-display); font-weight: 700; color: var(--ink-1); }
.bank h3 { margin: 14px 0 4px; font-family: var(--font-display); font-size: 17px; }
.bank p { margin: 0 0 12px; color: var(--ink-2); font-size: 13.5px; }
.bank .kv { grid-template-columns: 110px 1fr; }
.bank dd { display: flex; align-items: center; gap: 6px; }
.demo-note { margin-top: 12px; font-size: 12px; color: var(--ink-3); display: flex; gap: 8px; align-items: center; }
.done { text-align: center; padding: 10px 0 4px; }
.done-ic { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 50%; display: grid; place-items: center; background: oklch(0.95 0.05 155); color: var(--success); animation: pop .4s ease; }
.done h3 { margin: 0 0 4px; font-family: var(--font-display); font-size: 18px; }
.done p { margin: 0; color: var(--ink-2); }
.newbal { margin: 16px auto 6px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink-3); }
.big { font-size: 30px; font-weight: 700; font-family: var(--font-display); color: var(--ink-1); }
.txn { font-size: 12px; color: var(--ink-3); }
@keyframes pop { from { transform: scale(.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@media (max-width: 520px) { .amounts { grid-template-columns: repeat(3, 1fr); } }
</style>
