<script setup>
// Own carrier account detail (spec 7.4): usage, "always use my account" toggle, discount, disconnect.
import { ref, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Drawer from '../Drawer.vue'
import Toggle from '../Toggle.vue'
import CarrierLogo from '../CarrierLogo.vue'
import StatusPill from '../StatusPill.vue'
import DateTime from '../DateTime.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import KpiCard from '../KpiCard.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listCarrierAccounts, updateCarrierAccount, disconnectCarrierAccount } from '../../api/carriers.js'
import { listShipments } from '../../api/shipments.js'
import { errorMessage } from './storeUtils.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  accountId: { type: String, default: null },
})
const emit = defineEmits(['update:open', 'changed'])
const { t, fmt } = useI18n()

const loading = ref(false)
const acc = ref(null)
const shipments = ref([])
const savingMode = ref(false)
const editDisc = ref(false)
const discInput = ref('')
const discErr = ref('')
const savingDisc = ref(false)
const disconnecting = ref(false)
const mayManage = computed(() => can('integrations.manage'))

async function load() {
  if (!props.accountId) return
  loading.value = true
  try {
    const [list, ships] = await Promise.all([listCarrierAccounts(), listShipments({ account: 'own' })])
    acc.value = list.find(a => a.id === props.accountId) ?? null
    shipments.value = ships.filter(s => s.account === `own:${props.accountId}`)
    if (!acc.value) emit('update:open', false)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
  }
}
watch(() => [props.open, props.accountId], ([o]) => { if (o) { editDisc.value = false; load() } }, { immediate: true })

const always = computed({
  get: () => acc.value?.mode === 'always',
  set: v => setMode(v ? 'always' : 'cheapest'),
})

async function setMode(mode) {
  if (!acc.value || savingMode.value) return
  const prev = acc.value.mode
  acc.value = { ...acc.value, mode }
  savingMode.value = true
  try {
    await updateCarrierAccount(acc.value.id, { mode })
    toast.success(t('integrations.accounts.modeSaved', { mode: t('core.carrierAccounts.modes.' + mode) }), {
      action: { label: t('common.undo'), onClick: () => setMode(prev) },
    })
    emit('changed')
  } catch (e) {
    acc.value = { ...acc.value, mode: prev }
    toast.error(errorMessage(e))
  } finally {
    savingMode.value = false
  }
}

function startEdit() {
  discInput.value = String(Math.round((acc.value.negotiatedDiscountPct ?? 0) * 100))
  discErr.value = ''
  editDisc.value = true
}
function validateDisc() {
  const n = Number(String(discInput.value).replace(',', '.'))
  if (String(discInput.value).trim() === '') discErr.value = t('common.validation.required')
  else if (!Number.isFinite(n)) discErr.value = t('common.validation.number')
  else if (n < 0 || n > 60) discErr.value = t('integrations.wizard.manualRange')
  else discErr.value = ''
  return !discErr.value
}
async function saveDisc() {
  if (!validateDisc()) return
  savingDisc.value = true
  try {
    const r = await updateCarrierAccount(acc.value.id, { discountPct: Number(String(discInput.value).replace(',', '.')) / 100 })
    acc.value = { ...acc.value, ...r }
    editDisc.value = false
    toast.success(t('integrations.accounts.discountSaved', { pct: fmt.percent(r.negotiatedDiscountPct, 0) }))
    emit('changed')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    savingDisc.value = false
  }
}

async function disconnect() {
  const ok = await confirm({
    title: t('integrations.accounts.disconnectTitle', { carrier: acc.value.carrierName }),
    message: t('integrations.accounts.disconnectMsg', { carrier: acc.value.carrierName, masked: acc.value.accountMasked }),
    confirmLabel: t('integrations.accounts.disconnect'),
    danger: true,
  })
  if (!ok) return
  disconnecting.value = true
  try {
    await disconnectCarrierAccount(acc.value.id)
    toast.success(t('integrations.accounts.disconnected', { carrier: acc.value.carrierName }))
    emit('changed')
    emit('update:open', false)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <Drawer :open="open" :title="acc ? t('integrations.accounts.detailTitle', { carrier: acc.carrierName }) : t('integrations.accounts.details')" :subtitle="acc ? t('integrations.accounts.accountNo', { masked: acc.accountMasked }) : ''" width="580px" @update:open="v => emit('update:open', v)">
    <div v-if="loading || !acc" class="stack"><Skeleton variant="lines" :lines="3" /><Skeleton variant="rect" :height="120" /><Skeleton variant="lines" :lines="4" /></div>
    <div v-else class="stack-lg">
      <div class="head-card">
        <CarrierLogo :code="acc.carrier" :size="40" />
        <div class="grow">
          <div class="hc-name">{{ acc.carrierName }} · {{ acc.accountMasked }}</div>
          <div class="hc-sub"><Icon name="check-circle" :size="12" class="ok" /> {{ t('integrations.accounts.verifiedOn') }} <DateTime :value="acc.verifiedAt" mode="date" /></div>
        </div>
        <StatusPill status="connected" />
      </div>

      <section>
        <h3 class="section-title">{{ t('integrations.accounts.usage') }}</h3>
        <div class="kpi-grid">
          <KpiCard :label="t('integrations.accounts.usageShipments')" :value="acc.usage?.shipments ?? 0" :hint="t('integrations.accounts.last30', { n: acc.usage?.shipments30d ?? 0 })" />
          <KpiCard :label="t('integrations.accounts.usageCharges')" :value="acc.usage?.carrierCharges ?? 0" format="money" :hint="t('integrations.accounts.billedByCarrier')" />
          <KpiCard :label="t('integrations.accounts.usageFees')" :value="acc.usage?.platformFees ?? 0" format="money" :hint="t('integrations.accounts.perLabel')" />
          <KpiCard :label="t('integrations.accounts.usageSavings')" :value="acc.usage?.estimatedSavings ?? 0" format="money" tone="success" :hint="t('integrations.accounts.vsPlatform')" />
        </div>
      </section>

      <section>
        <h3 class="section-title">{{ t('integrations.accounts.preferences') }}</h3>
        <div class="setting">
          <Toggle v-model="always" :label="t('core.carrierAccounts.modes.always')" :description="always ? t('integrations.accounts.modeDesc.always') : t('integrations.accounts.modeDescOff')" :disabled="savingMode || !mayManage" />
        </div>
        <div class="setting disc">
          <div>
            <div class="s-label">{{ t('integrations.accounts.discount') }}</div>
            <div class="s-desc">{{ t('integrations.accounts.ratesSource.' + (acc.ratesSource ?? 'fetched')) }}</div>
          </div>
          <div v-if="!editDisc" class="disc-view">
            <span class="disc-value">{{ fmt.percent(acc.negotiatedDiscountPct ?? 0, 0) }}</span>
            <button class="btn btn-ghost btn-xs" :disabled="!mayManage" @click="startEdit"><Icon name="edit" :size="12" /> {{ t('common.edit') }}</button>
          </div>
          <div v-else class="disc-edit">
            <div class="affix"><input v-model="discInput" class="input input-sm" :class="{ invalid: discErr }" inputmode="decimal" :aria-label="t('integrations.accounts.discount')" @blur="validateDisc" @keydown.enter.prevent="saveDisc" /><span>%</span></div>
            <button class="btn btn-ghost btn-xs" :disabled="savingDisc" @click="editDisc = false">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary btn-xs" :disabled="savingDisc" @click="saveDisc"><Spinner v-if="savingDisc" :size="11" /> {{ t('common.save') }}</button>
            <div v-if="discErr" class="field-error full">{{ discErr }}</div>
          </div>
        </div>
        <dl class="kv details">
          <dt>{{ t('core.carrierAccounts.fields.billingZip') }}</dt><dd>{{ acc.billingZip || '-' }}</dd>
          <dt>{{ t('core.carrierAccounts.fields.country') }}</dt><dd>{{ acc.country || '-' }}</dd>
          <dt>{{ t('integrations.accounts.connectedAt') }}</dt><dd><DateTime :value="acc.connectedAt" mode="absolute" /></dd>
          <template v-if="acc.clientId"><dt>{{ t('core.carrierAccounts.fields.clientId') }}</dt><dd class="mono">{{ acc.clientId }}</dd></template>
        </dl>
      </section>

      <section>
        <h3 class="section-title">{{ t('integrations.accounts.recent') }}</h3>
        <div v-if="shipments.length" class="ships">
          <RouterLink v-for="s in shipments.slice(0, 6)" :key="s.id" :to="`/shipments/${s.id}`" class="ship-row">
            <span class="mono">{{ s.id }}</span>
            <span class="truncate">{{ s.to?.city }}, {{ s.to?.state }}</span>
            <StatusPill :status="s.status" size="sm" />
            <span class="num">{{ fmt.money(s.carrierCharge || s.price) }}</span>
          </RouterLink>
        </div>
        <div v-else class="empty-mini">{{ t('integrations.accounts.noShipments') }}</div>
      </section>
    </div>
    <template v-if="acc" #footer>
      <button class="btn btn-ghost btn-sm danger-text" :disabled="disconnecting || !mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="disconnect">
        <Spinner v-if="disconnecting" :size="13" /><Icon v-else name="x-circle" :size="14" /> {{ t('integrations.accounts.disconnect') }}
      </button>
      <button class="btn btn-primary btn-sm" @click="emit('update:open', false)">{{ t('common.close') }}</button>
    </template>
  </Drawer>
</template>

<style scoped>
.head-card { display: flex; gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--line-1); border-radius: 12px; background: var(--bg-2); }
.grow { flex: 1; min-width: 0; }
.hc-name { font-weight: 600; }
.hc-sub { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; display: flex; align-items: center; gap: 4px; }
.ok { color: var(--success); }
.kpi-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.setting { padding: 12px 0; border-bottom: 1px solid var(--line-1); }
.setting.disc { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.s-label { font-weight: 500; font-size: 14px; }
.s-desc { color: var(--ink-3); font-size: 12.5px; }
.disc-view { display: flex; align-items: center; gap: 10px; }
.disc-value { font-family: var(--font-display); font-weight: 600; font-size: 20px; color: var(--success); }
.disc-edit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.disc-edit .full { flex-basis: 100%; text-align: right; }
.affix { display: flex; align-items: center; gap: 4px; }
.affix .input { width: 72px; }
.input-sm { height: 30px; font-size: 13px; }
.details { margin-top: 12px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.ships { border: 1px solid var(--line-1); border-radius: 10px; }
.ship-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto 72px; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line-1); font-size: 13px; color: var(--ink-1); }
.ship-row:last-child { border-bottom: 0; }
.ship-row:hover { background: var(--bg-2); }
.ship-row .num { text-align: right; }
.empty-mini { color: var(--ink-3); font-size: 13px; padding: 14px; text-align: center; border: 1px dashed var(--line-2); border-radius: 10px; }
.danger-text { color: var(--danger); margin-right: auto; }
@media (max-width: 560px) { .kpi-grid { grid-template-columns: 1fr; } .ship-row { grid-template-columns: 90px 1fr 70px; } .ship-row :nth-child(3) { display: none; } }
</style>
