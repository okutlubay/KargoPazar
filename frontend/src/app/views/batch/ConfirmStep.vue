<script setup>
// Batch step 3, confirmation (spec 5.7): total amount, wallet check (auto top-up / top-up modal), "Create N labels".
import { computed, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Skeleton from '../../components/Skeleton.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import TopUpModal from '../../components/billing/TopUpModal.vue'
import { getWallet } from '../../api/wallet.js'
import { can } from '../../store/session.js'
import { confirm } from '../../components/confirm.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({
  assignments: { type: Array, required: true },
  totals: { type: Object, default: null },
})
const emit = defineEmits(['back', 'create'])

const wallet = ref(null)
const loading = ref(true)
const showTopUp = ref(false)
async function load() {
  loading.value = true
  try { wallet.value = await getWallet() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

const round2 = v => Math.round(v * 100) / 100
const total = computed(() => round2(props.assignments.reduce((s, a) => s + a.quote.total, 0)))
const walletCharge = computed(() => round2(props.assignments.reduce((s, a) => s + (a.quote.walletCharge ?? a.quote.total), 0)))
const carrierCharge = computed(() => round2(props.assignments.reduce((s, a) => s + (a.quote.carrierCharge ?? 0), 0)))
const balance = computed(() => wallet.value?.balance ?? 0)
const after = computed(() => round2(balance.value - walletCharge.value))
const auto = computed(() => wallet.value?.autoTopup?.enabled ? wallet.value.autoTopup : null)
const state = computed(() => {
  if (!wallet.value) return 'loading'
  if (after.value >= 0) return 'ok'
  return auto.value ? 'auto' : 'short'
})
const shortfall = computed(() => Math.max(0, round2(walletCharge.value - balance.value)))
const suggestedTopUp = computed(() => Math.max(25, Math.ceil(shortfall.value / 50) * 50))
const allowed = computed(() => can('batch.run') && can('shipments.create'))

const byHub = computed(() => {
  const m = {}
  for (const a of props.assignments) { m[a.hub] = m[a.hub] || { hub: a.hub, n: 0, cost: 0 }; m[a.hub].n++; m[a.hub].cost = round2(m[a.hub].cost + a.quote.total) }
  return Object.values(m).sort((a, b) => a.hub.localeCompare(b.hub))
})
const byCarrier = computed(() => {
  const m = {}
  for (const a of props.assignments) { const c = a.quote.carrierCode; m[c] = m[c] || { code: c, name: a.quote.carrierName, n: 0 }; m[c].n++ }
  return Object.values(m).sort((a, b) => b.n - a.n)
})

async function create() {
  const ok = await confirm({
    title: t('batch.confirm.confirmTitle', { n: props.assignments.length }),
    message: t('batch.confirm.confirmMsg', { amount: fmt.money(walletCharge.value) }),
    confirmLabel: t('batch.confirm.create', { n: props.assignments.length }),
  })
  if (ok) emit('create')
}
function onTopUp() {
  toast.success(t('batch.confirm.topUpDone'))
  load()
}
</script>

<template>
  <div class="cf">
    <section class="panel">
      <div class="panel-head"><div class="panel-title">{{ t('batch.confirm.title') }}</div></div>
      <div class="cf-grid">
        <div class="stat"><div class="k">{{ t('batch.confirm.labels') }}</div><div class="v num">{{ fmt.number(assignments.length) }}</div></div>
        <div class="stat"><div class="k">{{ t('batch.confirm.total') }}</div><div class="v num">{{ fmt.money(total) }}</div></div>
        <div class="stat"><div class="k">{{ t('batch.confirm.walletCharge') }}</div><div class="v num">{{ fmt.money(walletCharge) }}</div>
          <div v-if="carrierCharge > 0" class="sub">{{ t('batch.confirm.carrierCharge') }}: {{ fmt.money(carrierCharge) }}</div></div>
        <div class="stat"><div class="k">{{ t('batch.opt.savings') }}</div><div class="v num pos">{{ fmt.money(totals?.totals?.savings ?? 0) }}</div>
          <div class="sub">{{ fmt.percent(totals?.totals?.savingsPct ?? 0, 1) }}</div></div>
      </div>
      <div class="split">
        <div>
          <div class="k">{{ t('batch.confirm.byHub') }}</div>
          <div class="chips"><span v-for="h in byHub" :key="h.hub" class="tag"><Icon name="warehouse" :size="12" /> {{ h.hub }} · {{ h.n }} · {{ fmt.money(h.cost) }}</span></div>
        </div>
        <div>
          <div class="k">{{ t('batch.opt.byCarrier') }}</div>
          <div class="chips"><span v-for="c in byCarrier" :key="c.code" class="ctag"><CarrierLogo :code="c.code" :size="18" /> {{ c.name }} · {{ c.n }}</span></div>
        </div>
      </div>
    </section>

    <section class="panel wallet">
      <div class="panel-head"><div class="panel-title"><Icon name="wallet" :size="15" /> {{ t('nav.billing') }}</div></div>
      <div v-if="loading" class="pad"><Skeleton :lines="3" /></div>
      <div v-else class="pad">
        <dl class="kv">
          <dt>{{ t('batch.confirm.balance') }}</dt><dd class="num strong">{{ fmt.money(balance) }}</dd>
          <dt>{{ t('batch.confirm.walletCharge') }}</dt><dd class="num">- {{ fmt.money(walletCharge) }}</dd>
          <dt>{{ t('batch.confirm.after') }}</dt><dd class="num strong" :class="{ 'neg-t': after < 0 }">{{ fmt.money(after) }}</dd>
        </dl>
        <div v-if="state === 'ok'" class="callout ok"><Icon name="check-circle" :size="16" /> {{ t('batch.confirm.ok') }}</div>
        <div v-else-if="state === 'auto'" class="callout"><Icon name="info" :size="16" /> {{ t('batch.confirm.autoTopup', { threshold: fmt.money(auto.threshold), amount: fmt.money(auto.amount) }) }}</div>
        <div v-else class="callout danger"><Icon name="alert" :size="16" />
          <div>{{ t('batch.confirm.insufficient', { shortfall: fmt.money(shortfall) }) }}
            <div><button class="btn btn-accent btn-sm top" :disabled="!can('billing.topup')" @click="showTopUp = true"><Icon name="plus" :size="13" /> {{ t('batch.confirm.topUp') }}</button></div>
          </div>
        </div>
        <div v-if="state !== 'ok' && state !== 'short'" class="topup-line"><button class="btn btn-link" @click="showTopUp = true">{{ t('batch.confirm.topUp') }}</button></div>
      </div>
    </section>

    <div class="foot">
      <button class="btn btn-ghost" @click="emit('back')"><Icon name="chevron-left" :size="14" /> {{ t('batch.opt.back') }}</button>
      <span :title="allowed ? '' : t('batch.confirm.noPermission')">
        <button class="btn btn-accent btn-lg" :disabled="!allowed || state === 'loading' || state === 'short' || !assignments.length" @click="create">
          <Icon name="printer" :size="15" /> {{ t('batch.confirm.create', { n: assignments.length }) }}
        </button>
      </span>
    </div>

    <TopUpModal v-model:open="showTopUp" :preset-amount="suggestedTopUp" @done="onTopUp" />
  </div>
</template>

<style scoped>
.cf { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.cf > .foot { grid-column: 1 / -1; }
.cf-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.stat { padding: 16px 20px; }
.stat + .stat { border-left: 1px solid var(--line-1); }
.k { font-size: 12px; color: var(--ink-3); }
.v { font-family: var(--font-display); font-size: 22px; font-weight: 700; margin-top: 4px; letter-spacing: -0.02em; }
.sub { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.pos { color: var(--success); }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 20px 18px; border-top: 1px solid var(--line-1); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.ctag { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 3px 8px 3px 3px; border-radius: 7px; background: var(--bg-2); }
.pad { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.panel-title { display: flex; align-items: center; gap: 6px; }
.strong { font-weight: 600; }
.neg-t { color: var(--danger); }
.callout.ok { background: oklch(0.96 0.05 155); color: oklch(0.38 0.1 155); }
.top { margin-top: 8px; }
.topup-line { font-size: 13px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
@media (max-width: 1100px) { .cf { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .cf-grid { grid-template-columns: 1fr 1fr; } .stat:nth-child(3) { border-left: 0; } .split { grid-template-columns: 1fr; } }
</style>
