<script setup>
// Billing top section: balance card, auto top-up settings, saved cards (spec 5.10).
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Skeleton from '../../components/Skeleton.vue'
import Toggle from '../../components/Toggle.vue'
import Spinner from '../../components/Spinner.vue'
import Dropdown from '../../components/Dropdown.vue'
import Modal from '../../components/Modal.vue'
import AnimatedMoney from '../../components/billing/AnimatedMoney.vue'
import FxNote from '../../components/FxNote.vue'
import CardBrand from '../../components/billing/CardBrand.vue'
import CardForm from '../../components/billing/CardForm.vue'
import Sparkline from '../../components/charts/Sparkline.vue'
import { db } from '../../store/db.js'
import { updateAutoTopup, addCard, removeCard, setDefaultCard } from '../../api/wallet.js'
import { errorText, fieldError } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { t, fmt } from '../../i18n/index.js'

// Balance trend (end-of-day balance over the last 16 days), derived reactively from wallet transactions.
const trend = computed(() => {
  const txns = [...(db.doc('wallet')?.transactions ?? [])].filter(x => x.balanceAfter != null && typeof x.at === 'string').sort((a, b) => a.at.localeCompare(b.at))
  if (txns.length < 2) return []
  const days = 16
  const out = []
  const start = new Date(); start.setHours(23, 59, 59, 999)
  let i = 0
  let last = txns[0].balanceAfter
  for (let d = days - 1; d >= 0; d--) {
    const end = new Date(start.getTime() - d * 86400000).toISOString()
    while (i < txns.length && txns[i].at <= end) { last = txns[i].balanceAfter; i++ }
    out.push(Math.round(last * 100) / 100)
  }
  return out
})

const props = defineProps({
  wallet: { type: Object, default: null },
  liveBalance: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['topup', 'changed', 'statement'])

const canTopup = computed(() => can('billing.topup'))

// ---- auto top-up
const auto = ref({ enabled: false, threshold: 200, amount: 500, cardId: null })
const autoErrors = ref({})
const savingAuto = ref(false)
watch(() => props.wallet?.autoTopup, v => { if (v) auto.value = { ...v } }, { immediate: true })
const autoDirty = computed(() => {
  const w = props.wallet?.autoTopup
  if (!w) return false
  return ['enabled', 'threshold', 'amount', 'cardId'].some(k => String(w[k]) !== String(auto.value[k]))
})
function validateAuto() {
  const e = {}
  if (!(Number(auto.value.threshold) >= 0)) e.threshold = t('common.validation.number')
  if (!(Number(auto.value.amount) >= 25)) e.amount = t('billing.auto.amountMin', { min: fmt.moneyNative(25, 'USD', 0) })
  autoErrors.value = e
  return !Object.keys(e).length
}
async function saveAuto(patch = null) {
  if (patch) auto.value = { ...auto.value, ...patch }
  if (!validateAuto()) return
  savingAuto.value = true
  try {
    const prev = { ...props.wallet.autoTopup }
    const r = await updateAutoTopup({ enabled: auto.value.enabled, threshold: Number(auto.value.threshold), amount: Number(auto.value.amount), cardId: auto.value.cardId })
    auto.value = { ...r }
    emit('changed')
    toast.success(r.enabled ? t('billing.auto.savedOn', { threshold: fmt.moneyDual(r.threshold, 0), amount: fmt.moneyDual(r.amount, 0) }) : t('billing.auto.savedOff'), {
      action: { label: t('common.undo'), onClick: async () => { await updateAutoTopup(prev); emit('changed') } },
    })
  } catch (e) {
    toast.error(errorText(e))
    if (e.details) autoErrors.value = Object.fromEntries(Object.entries(e.details).map(([k, v]) => [k, fieldError(v)]))
    auto.value = { ...props.wallet.autoTopup }
  } finally { savingAuto.value = false }
}
function onToggle(v) { saveAuto({ enabled: v }) }

// ---- cards
const addOpen = ref(false)
const newCard = ref(emptyCard())
const cardForm = ref(null)
const adding = ref(false)
const addErr = ref('')
const addServerErrors = ref({})
const makeDefault = ref(false)
function emptyCard() { return { number: '', exp: '', expMonth: null, expYear: null, cvc: '', holder: '', zip: '', save: true } }
function openAdd() { newCard.value = emptyCard(); addErr.value = ''; addServerErrors.value = {}; makeDefault.value = false; addOpen.value = true }
async function submitCard() {
  addErr.value = ''
  addServerErrors.value = {}
  if (!cardForm.value?.validate()) return
  adding.value = true
  try {
    const c = await addCard({ number: newCard.value.number, expMonth: newCard.value.expMonth, expYear: newCard.value.expYear, cvc: newCard.value.cvc, holder: newCard.value.holder, zip: newCard.value.zip, makeDefault: makeDefault.value })
    addOpen.value = false
    emit('changed')
    toast.success(t('billing.cards.added', { last4: c.last4 }))
  } catch (e) {
    addErr.value = errorText(e)
    if (e.details && typeof e.details === 'object') addServerErrors.value = e.details
  } finally { adding.value = false }
}
async function remove(c) {
  const ok = await confirm({
    title: t('billing.cards.removeTitle', { last4: c.last4 }),
    message: props.wallet.autoTopup?.cardId === c.id ? t('billing.cards.removeAutoWarn') : t('billing.cards.removeDesc'),
    confirmLabel: t('billing.cards.remove'),
    danger: true,
  })
  if (!ok) return
  try {
    await removeCard(c.id)
    emit('changed')
    toast.success(t('billing.cards.removed', { last4: c.last4 }))
  } catch (e) { toast.error(errorText(e)) }
}
async function makeDef(c) {
  try {
    await setDefaultCard(c.id)
    emit('changed')
    toast.success(t('billing.cards.defaultSet', { last4: c.last4 }))
  } catch (e) { toast.error(errorText(e)) }
}
function cardMenu(c) {
  return [
    { key: 'default', label: t('billing.cards.makeDefault'), icon: 'star', disabled: c.isDefault || !canTopup.value, onClick: () => makeDef(c) },
    { key: 'remove', label: t('billing.cards.remove'), icon: 'trash', danger: true, disabled: !canTopup.value, onClick: () => remove(c) },
  ]
}
const expired = c => { const n = new Date(); return c.expYear < n.getFullYear() || (c.expYear === n.getFullYear() && c.expMonth < n.getMonth() + 1) }
</script>

<template>
  <div class="wp">
    <!-- Balance -->
    <section class="panel bal">
      <div class="bal-top">
        <div>
          <div class="eyebrow"><Icon name="wallet" :size="14" /> {{ t('billing.balance.title') }}</div>
          <Skeleton v-if="loading && !wallet" variant="rect" :width="180" :height="40" />
          <div v-else class="amount"><AnimatedMoney :value="liveBalance" /></div>
          <FxNote v-if="!(loading && !wallet)" />
          <div v-if="wallet?.pendingRefunds" class="pending"><Icon name="clock" :size="12" /> {{ t('billing.balance.pending', { amount: fmt.money(wallet.pendingRefunds) }) }}</div>
        </div>
        <div class="bal-actions">
          <button class="btn btn-accent" :disabled="!canTopup" :title="canTopup ? '' : t('common.noPermission')" @click="emit('topup')"><Icon name="plus" :size="14" /> {{ t('billing.balance.topup') }}</button>
          <button class="btn btn-ghost btn-sm" @click="emit('statement')"><Icon name="file" :size="14" /> {{ t('billing.statement.button') }}</button>
        </div>
      </div>
      <div v-if="trend.length" class="trend">
        <div class="trend-l">{{ t('billing.balance.trend') }}</div>
        <Sparkline :data="trend" :height="44" />
      </div>
      <div class="sum">
        <div><span>{{ t('billing.balance.spend30') }}</span><strong class="num">{{ wallet ? fmt.money(wallet.summary.spend30d) : '-' }}</strong></div>
        <div><span>{{ t('billing.balance.labels30') }}</span><strong class="num">{{ wallet ? fmt.number(wallet.summary.labels30d) : '-' }}</strong></div>
        <div><span>{{ t('billing.balance.topups30') }}</span><strong class="num">{{ wallet ? fmt.money(wallet.summary.topups30d) : '-' }}</strong></div>
        <div><span>{{ t('billing.balance.adjustments30') }}</span><strong class="num">{{ wallet ? fmt.money(wallet.summary.adjustments30d) : '-' }}</strong></div>
      </div>
    </section>

    <!-- Auto top-up -->
    <section class="panel auto">
      <div class="panel-head">
        <div>
          <div class="panel-title">{{ t('billing.auto.title') }}</div>
          <div class="panel-sub">{{ t('billing.auto.desc') }}</div>
        </div>
        <Spinner v-if="savingAuto" :size="14" />
      </div>
      <div class="panel-pad">
        <Skeleton v-if="loading && !wallet" :lines="3" />
        <template v-else-if="wallet">
          <Toggle :model-value="auto.enabled" :label="auto.enabled ? t('billing.auto.on') : t('billing.auto.off')" :disabled="!canTopup || savingAuto || !wallet.cards.length" @update:model-value="onToggle" />
          <div v-if="!wallet.cards.length" class="hint">{{ t('billing.auto.noCard') }}</div>
          <div class="auto-grid" :class="{ dim: !auto.enabled }">
            <label class="fld">
              <span>{{ t('billing.auto.threshold') }}</span>
              <div class="money-in"><span>{{ wallet.currency }}</span><input v-model="auto.threshold" class="input num" :class="{ invalid: autoErrors.threshold }" inputmode="decimal" :disabled="!canTopup" @blur="validateAuto" /></div>
              <small v-if="autoErrors.threshold" class="field-error">{{ autoErrors.threshold }}</small>
            </label>
            <label class="fld">
              <span>{{ t('billing.auto.amount') }}</span>
              <div class="money-in"><span>{{ wallet.currency }}</span><input v-model="auto.amount" class="input num" :class="{ invalid: autoErrors.amount }" inputmode="decimal" :disabled="!canTopup" @blur="validateAuto" /></div>
              <small v-if="autoErrors.amount" class="field-error">{{ autoErrors.amount }}</small>
            </label>
            <label class="fld full">
              <span>{{ t('billing.auto.card') }}</span>
              <select v-model="auto.cardId" class="select" :disabled="!canTopup">
                <option v-for="c in wallet.cards" :key="c.id" :value="c.id">{{ t('billing.cards.brand.' + (c.brand || 'card')) }} •••• {{ c.last4 }}</option>
              </select>
            </label>
          </div>
          <p class="sentence">{{ auto.enabled ? t('billing.auto.sentence', { threshold: fmt.moneyDual(Number(auto.threshold) || 0, 0), amount: fmt.moneyDual(Number(auto.amount) || 0, 0) }) : t('billing.auto.sentenceOff') }}</p>
          <div class="row-end">
            <button class="btn btn-ghost btn-sm" :disabled="!autoDirty || savingAuto" @click="auto = { ...wallet.autoTopup }; autoErrors = {}">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary btn-sm" :disabled="!autoDirty || savingAuto || !canTopup" @click="saveAuto()"><Spinner v-if="savingAuto" :size="12" /> {{ t('common.save') }}</button>
          </div>
        </template>
      </div>
    </section>

    <!-- Cards -->
    <section class="panel cards">
      <div class="panel-head">
        <div class="panel-title">{{ t('billing.cards.title') }}</div>
        <button class="btn btn-ghost btn-sm" :disabled="!canTopup" @click="openAdd"><Icon name="plus" :size="13" /> {{ t('billing.cards.add') }}</button>
      </div>
      <div class="panel-pad clist">
        <Skeleton v-if="loading && !wallet" :lines="3" />
        <div v-else-if="!wallet?.cards.length" class="empty-cards">{{ t('billing.cards.empty') }}</div>
        <div v-for="c in wallet?.cards ?? []" v-else :key="c.id" class="crow">
          <CardBrand :brand="c.brand" />
          <div class="cinfo">
            <div><strong>{{ t('billing.cards.brand.' + (c.brand || 'card')) }} •••• {{ c.last4 }}</strong>
              <span v-if="c.isDefault" class="tag tag-accent">{{ t('billing.cards.default') }}</span>
              <span v-if="wallet.autoTopup?.cardId === c.id && wallet.autoTopup?.enabled" class="tag">{{ t('billing.cards.autoCard') }}</span>
            </div>
            <div class="csub">{{ c.holder }} · <span :class="{ 'text-danger': expired(c) }">{{ String(c.expMonth).padStart(2, '0') }}/{{ String(c.expYear).slice(-2) }}</span></div>
          </div>
          <Dropdown :items="cardMenu(c)" :aria-label="t('common.actions')" size="sm" />
        </div>
      </div>
    </section>

    <Modal v-model:open="addOpen" :title="t('billing.cards.addTitle')" size="sm" :closable="!adding">
      <form novalidate @submit.prevent="submitCard">
        <CardForm ref="cardForm" v-model="newCard" :show-save="false" :server-errors="addServerErrors" :disabled="adding" />
        <label class="checkbox mt"><input v-model="makeDefault" type="checkbox" /> {{ t('billing.cards.makeDefault') }}</label>
        <div v-if="addErr" class="callout danger mt" role="alert">{{ addErr }}</div>
      </form>
      <template #footer>
        <button class="btn btn-ghost" :disabled="adding" @click="addOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="adding" @click="submitCard"><Spinner v-if="adding" :size="14" /> {{ t('billing.cards.save') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.wp { display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 16px; align-items: stretch; }
.bal { padding: 20px; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; background: linear-gradient(135deg, var(--surface) 55%, var(--accent-soft)); }
.bal-top { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.eyebrow { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-3); font-weight: 500; }
.amount { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin-top: 4px; }
.pending { margin-top: 4px; font-size: 12.5px; color: oklch(0.55 0.12 70); display: flex; align-items: center; gap: 4px; }
.bal-actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.trend { padding: 0; }
.trend-l { font-size: 12px; color: var(--ink-3); margin-bottom: 4px; }
.sum { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; border-top: 1px solid var(--line-1); padding-top: 14px; }
.sum div { display: flex; flex-direction: column; gap: 2px; }
.sum span { font-size: 12px; color: var(--ink-3); }
.sum strong { font-size: 15px; }
.auto-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; transition: opacity .2s; }
.auto-grid.dim { opacity: .55; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink-2); }
.fld.full { grid-column: 1 / -1; }
.money-in { position: relative; }
.money-in span { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-3); font-size: 11.5px; font-family: var(--font-mono); }
.money-in .input { width: 100%; padding-left: 46px; }
.select { width: 100%; }
.sentence { font-size: 12.5px; color: var(--ink-3); margin: 10px 0 0; }
.hint { font-size: 12px; color: var(--ink-3); margin-top: 4px; }
.row-end { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.clist { display: flex; flex-direction: column; gap: 10px; }
.crow { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.cinfo { flex: 1; min-width: 0; font-size: 13.5px; }
.cinfo .tag { margin-left: 6px; }
.csub { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.empty-cards { color: var(--ink-3); font-size: 13px; }
.mt { margin-top: 12px; }
@media (max-width: 1280px) { .wp { grid-template-columns: 1fr 1fr; } .bal { grid-column: 1 / -1; } }
@media (max-width: 860px) { .wp { grid-template-columns: 1fr; } .bal-actions { align-items: flex-start; } }
</style>
