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

const props = defineProps({
  open: { type: Boolean, default: false },
  presetAmount: { type: Number, default: null },
  reason: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'done'])

const PRESETS = [100, 250, 500, 1000]
const step = ref('form') // form | 3ds | success
const wallet = ref(null)
const loadingWallet = ref(false)
const amountChoice = ref(250)
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

const amount = computed(() => (amountChoice.value === 'custom' ? Number(String(custom.value).replace(',', '.')) : amountChoice.value))
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
  if (props.presetAmount && PRESETS.includes(props.presetAmount)) { amountChoice.value = props.presetAmount; custom.value = '' }
  else if (props.presetAmount) { amountChoice.value = 'custom'; custom.value = String(Math.max(25, Math.ceil(props.presetAmount))) }
  else { amountChoice.value = 250; custom.value = '' }
  load()
}, { immediate: true })

function validateAmount() {
  const a = amount.value
  if (!(a > 0)) amountError.value = t('billing.topup.amountRequired')
  else if (a < 25) amountError.value = t('billing.topup.amountMin')
  else if (a > 10000) amountError.value = t('billing.topup.amountMax')
  else amountError.value = ''
  return !amountError.value
}

const selectedCard = computed(() => wallet.value?.cards.find(c => c.id === cardChoice.value) ?? null)

async function submit() {
  error.value = ''
  serverErrors.value = {}
  const okAmount = validateAmount()
  const okCard = cardChoice.value !== 'new' || cardForm.value?.validate()
  if (!okAmount || !okCard) return
  busy.value = true
  try {
    const input = cardChoice.value === 'new'
      ? { amount: amount.value, newCard: { number: card.value.number, expMonth: card.value.expMonth, expYear: card.value.expYear, cvc: card.value.cvc, holder: card.value.holder, zip: card.value.zip, save: card.value.save !== false } }
      : { amount: amount.value, cardId: cardChoice.value }
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
    toast.success(t('billing.topup.success', { amount: fmt.money(challenge.value.amount) }))
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
          <button v-for="p in PRESETS" :key="p" type="button" role="radio" :aria-checked="amountChoice === p" :class="['amt', { on: amountChoice === p }]" @click="amountChoice = p; amountError = ''">
            {{ fmt.money(p, 'USD', 0) }}
          </button>
          <button type="button" role="radio" :aria-checked="amountChoice === 'custom'" :class="['amt', { on: amountChoice === 'custom' }]" @click="amountChoice = 'custom'">{{ t('common.custom') }}</button>
        </div>
        <div v-if="amountChoice === 'custom'" class="custom">
          <span class="cur">$</span>
          <input v-model="custom" class="input num" :class="{ invalid: amountError }" inputmode="decimal" :placeholder="t('billing.topup.customPh')" autofocus @blur="validateAmount" />
        </div>
        <div v-if="amountError" class="field-error">{{ amountError }}</div>
        <div v-if="wallet?.autoTopup?.enabled" class="hint">{{ t('billing.topup.autoNote', { threshold: fmt.money(wallet.autoTopup.threshold, 'USD', 0), amount: fmt.money(wallet.autoTopup.amount, 'USD', 0) }) }}</div>
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
          <dt>{{ t('billing.topup.amount') }}</dt><dd class="num"><strong>{{ fmt.money(challenge.amount) }}</strong></dd>
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
      <p>{{ t('billing.topup.doneDesc', { amount: fmt.money(challenge?.amount ?? 0) }) }}</p>
      <div class="newbal">
        <span>{{ t('billing.topup.newBalance') }}</span>
        <AnimatedMoney :value="result?.balance ?? 0" :from="fromBalance" :duration="1200" class="big" />
      </div>
      <div class="txn mono">{{ result?.transaction?.id }}</div>
    </div>

    <template #footer>
      <template v-if="step === 'form'">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
        <button type="button" class="btn btn-accent" :disabled="busy || !allowed || loadingWallet" @click="submit">
          <Spinner v-if="busy" :size="14" />
          {{ amount > 0 ? t('billing.topup.pay', { amount: fmt.money(amount) }) : t('billing.topup.payPlain') }}
        </button>
      </template>
      <template v-else-if="step === '3ds'">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="deny">{{ t('billing.topup.deny') }}</button>
        <button type="button" class="btn btn-accent" :disabled="busy" @click="approve"><Spinner v-if="busy" :size="14" /> {{ t('billing.topup.approve') }}</button>
      </template>
      <template v-else>
        <button type="button" class="btn btn-primary" @click="emit('update:open', false)">{{ t('common.close') }}</button>
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
.custom .input { width: 100%; padding-left: 24px; }
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
