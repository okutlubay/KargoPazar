<script setup>
// Plan change confirmation with prorated fee (spec 5.11).
//   <ChangePlanModal v-model:open="x" :plan-id="'starter'" @changed="res => ..." />
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../../components/Modal.vue'
import Spinner from '../../components/Spinner.vue'
import Money from '../../components/Money.vue'
import TopUpModal from '../../components/billing/TopUpModal.vue'
import { quotePlanChange, changePlan } from '../../api/plan.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../../components/toast.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const props = defineProps({ open: { type: Boolean, default: false }, planId: { type: String, default: null } })
const emit = defineEmits(['update:open', 'changed'])
const q = ref(null)
const busy = ref(false)
const error = ref('')
const topupOpen = ref(false)

watch(() => [props.open, props.planId], () => { if (props.open && props.planId) { q.value = quotePlanChange(props.planId); error.value = '' } }, { immediate: true })

const plans = computed(() => Object.fromEntries((db.doc('rate_cards')?.plans ?? []).map(p => [p.id, p])))
const name = id => tx(plans.value[id]?.name) || id
const balance = computed(() => db.doc('wallet').balance)
const after = computed(() => (q.value ? balance.value - q.value.prorated : balance.value))
const auto = computed(() => db.doc('wallet').autoTopup)
const short = computed(() => q.value && q.value.prorated > 0 && after.value < 0 && !auto.value?.enabled)
const downgrade = computed(() => q.value?.direction === 'downgrade')

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const r = await changePlan(props.planId)
    toast.success(t('plan.change.done', { plan: name(r.plan) }))
    emit('changed', r)
    emit('update:open', false)
  } catch (e) {
    error.value = errorText(e, ['plan.errors'])
  } finally { busy.value = false }
}
</script>

<template>
  <Modal :open="open" :title="q ? t(downgrade ? 'plan.change.titleDown' : 'plan.change.titleUp', { plan: name(q.to) }) : ''" size="md" :closable="!busy" @update:open="v => emit('update:open', v)">
    <div v-if="q" class="cp">
      <div class="fromto">
        <div class="pl"><span>{{ t('plan.change.current') }}</span><strong>{{ name(q.from) }}</strong><small>{{ t('plan.perMonth', { fee: fmt.money(q.monthlyFrom, 'USD', 0) }) }} · {{ t('plan.markup', { pct: fmt.percent(q.markupFrom, 0) }) }}</small></div>
        <Icon name="arrow" :size="18" class="arr" />
        <div class="pl to"><span>{{ t('plan.change.new') }}</span><strong>{{ name(q.to) }}</strong><small>{{ t('plan.perMonth', { fee: fmt.money(q.monthlyTo, 'USD', 0) }) }} · {{ t('plan.markup', { pct: fmt.percent(q.markupTo, 0) }) }}</small></div>
      </div>

      <div class="calc">
        <div class="row"><span>{{ t('plan.change.feeDiff') }}</span><span class="num">{{ fmt.money(q.monthlyTo - q.monthlyFrom) }} / {{ t('plan.change.month') }}</span></div>
        <div class="row"><span>{{ t('plan.change.remaining') }}</span><span class="num">{{ t('plan.change.days', { left: q.daysLeft, days: q.days }) }}</span></div>
        <div class="row total">
          <span>{{ q.prorated >= 0 ? t('plan.change.chargeNow') : t('plan.change.creditNow') }}</span>
          <strong><Money :value="Math.abs(q.prorated)" /></strong>
        </div>
        <div class="formula">{{ t('plan.change.formula', { diff: fmt.money(q.monthlyTo - q.monthlyFrom), left: q.daysLeft, days: q.days }) }}</div>
        <div class="row"><span>{{ t('plan.change.walletAfter') }}</span><span class="num" :class="{ 'text-danger': after < 0 }">{{ fmt.money(after) }}</span></div>
        <div class="row"><span>{{ t('plan.change.nextInvoice') }}</span><span>{{ fmt.date(q.nextBillingAt) }} · {{ fmt.money(q.monthlyTo) }}</span></div>
      </div>

      <div v-if="q.markupTo !== q.markupFrom" class="callout neutral"><Icon name="info" /> {{ t(q.markupTo < q.markupFrom ? 'plan.change.markupDown' : 'plan.change.markupUp', { from: fmt.percent(q.markupFrom, 0), to: fmt.percent(q.markupTo, 0) }) }}</div>
      <div v-if="q.gained.length" class="feat ok">
        <strong>{{ t('plan.change.gained') }}</strong>
        <ul><li v-for="f in q.gained" :key="f"><Icon name="check" :size="12" /> {{ t('plan.features.' + f) }}</li></ul>
      </div>
      <div v-if="q.lost.length" class="feat lost">
        <strong>{{ t('plan.change.lost') }}</strong>
        <ul><li v-for="f in q.lost" :key="f"><Icon name="lock" :size="12" /> {{ t('plan.features.' + f) }}</li></ul>
      </div>
      <div v-if="q.storesOver" class="callout warn"><Icon name="alert" /> {{ t('plan.change.storesOver', { n: q.storesOver }) }}</div>
      <div v-if="q.usersOver" class="callout warn"><Icon name="alert" /> {{ t('plan.change.usersOver', { n: q.usersOver }) }}</div>
      <div v-if="short" class="callout danger"><Icon name="wallet" /> {{ t('plan.change.short') }} <button class="btn-link" @click="topupOpen = true">{{ t('billing.balance.topup') }}</button></div>
      <div v-if="error" class="callout danger" role="alert">{{ error }}</div>
    </div>
    <template #footer>
      <button class="btn btn-ghost" :disabled="busy" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
      <button :class="['btn', downgrade ? 'btn-danger' : 'btn-accent']" :disabled="busy || !can('settings.manage') || short" :title="can('settings.manage') ? '' : t('common.noPermission')" @click="submit">
        <Spinner v-if="busy" :size="14" /> {{ q && q.prorated > 0 ? t('plan.change.confirmPay', { amount: fmt.money(q.prorated) }) : t('plan.change.confirm') }}
      </button>
    </template>
  </Modal>
  <TopUpModal v-model:open="topupOpen" :preset-amount="q ? Math.max(25, Math.ceil(q.prorated - balance)) : null" :reason="t('plan.change.topupReason')" />
</template>

<style scoped>
.cp { display: flex; flex-direction: column; gap: 14px; }
.fromto { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; }
.pl { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.pl.to { border-color: var(--accent); background: var(--accent-soft); }
.pl span { font-size: 11.5px; color: var(--ink-3); }
.pl strong { font-family: var(--font-display); font-size: 17px; }
.pl small { font-size: 12px; color: var(--ink-3); }
.arr { color: var(--ink-3); }
.calc { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 6px 14px; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; font-size: 13.5px; border-bottom: 1px dashed var(--line-1); }
.row:last-child { border-bottom: 0; }
.row.total { font-size: 15px; }
.row.total strong { font-size: 17px; }
.formula { font-size: 11.5px; color: var(--ink-3); padding: 0 0 6px; font-family: var(--font-mono); }
.feat { font-size: 13px; }
.feat ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.feat li { display: inline-flex; align-items: center; gap: 5px; }
.feat.ok li { color: var(--success); }
.feat.lost li { color: var(--danger); }
</style>
