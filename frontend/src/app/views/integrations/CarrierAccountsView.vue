<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import Skeleton from '../../components/Skeleton.vue'
import CarrierConnectWizard from '../../components/integrations/CarrierConnectWizard.vue'
import CarrierAccountDrawer from '../../components/integrations/CarrierAccountDrawer.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listCarrierAccounts, OWN_ACCOUNT_CARRIERS } from '../../api/carriers.js'
import { errorMessage } from '../../components/integrations/storeUtils.js'

const { t, fmt } = useI18n()
const route = useRoute()
const loading = ref(true)
const accounts = ref([])
const wizardOpen = ref(false)
const wizardCarrier = ref(null)
const drawerId = ref(null)
const mayManage = computed(() => can('integrations.manage'))

const connected = computed(() => accounts.value.filter(a => a.status === 'connected'))
const available = computed(() => accounts.value.filter(a => a.status !== 'connected').map(a => a.carrier))

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try { accounts.value = await listCarrierAccounts() } catch (e) { toast.error(errorMessage(e)) } finally { loading.value = false }
}

function connect(code = null) {
  if (!mayManage.value) return
  wizardCarrier.value = code
  wizardOpen.value = true
}
function openDetail(a) { drawerId.value = a.id }
function onConnected() { load({ silent: true }) }
function onChanged() { load({ silent: true }) }

onMounted(async () => {
  await load()
  const c = typeof route.query.connect === 'string' ? route.query.connect.toUpperCase() : null
  if (c && OWN_ACCOUNT_CARRIERS.includes(c) && available.value.includes(c)) connect(c)
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.carrierAccounts')" :subtitle="t('integrations.accounts.subtitle')">
      <template #actions>
        <button class="btn btn-primary btn-sm" :disabled="loading || !available.length || !mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="connect()"><Icon name="plus" :size="14" /> {{ t('integrations.accounts.connectAccount') }}</button>
      </template>
    </PageHeader>

    <div class="callout intro-callout">
      <Icon name="info" :size="16" />
      <div>{{ t('integrations.accounts.intro') }}</div>
    </div>

    <div class="cards">
      <template v-if="loading">
        <div v-for="i in 4" :key="i" class="panel acc-card"><Skeleton variant="lines" :lines="5" /></div>
      </template>
      <template v-else>
        <article v-for="a in accounts" :key="a.carrier" class="panel acc-card" :class="{ off: a.status !== 'connected' }">
          <header class="ac-head">
            <CarrierLogo :code="a.carrier" :size="40" />
            <div class="grow">
              <div class="ac-name">{{ a.carrierName }}</div>
              <div class="ac-sub">{{ a.status === 'connected' ? t('integrations.accounts.accountNo', { masked: a.accountMasked }) : t('integrations.accounts.method.' + a.carrier) }}</div>
            </div>
            <StatusPill :status="a.status === 'connected' ? 'connected' : 'not_connected'" size="sm" />
          </header>

          <template v-if="a.status === 'connected'">
            <dl class="ac-kv">
              <div><dt>{{ t('integrations.accounts.discount') }}</dt><dd class="num strong">{{ fmt.percent(a.negotiatedDiscountPct ?? 0, 0) }}</dd></div>
              <div><dt>{{ t('integrations.accounts.verified') }}</dt><dd><span class="verified"><Icon name="check-circle" :size="13" /> <DateTime :value="a.verifiedAt" mode="date" /></span></dd></div>
              <div><dt>{{ t('integrations.accounts.shipments') }}</dt><dd class="num">{{ fmt.number(a.usage?.shipments ?? 0) }}</dd></div>
              <div><dt>{{ t('integrations.accounts.mode') }}</dt><dd>{{ t('core.carrierAccounts.modes.' + (a.mode ?? 'cheapest')) }}</dd></div>
            </dl>
            <footer class="ac-foot">
              <button class="btn btn-ghost btn-sm" @click="openDetail(a)"><Icon name="settings" :size="14" /> {{ t('integrations.accounts.details') }}</button>
              <span class="savings" v-if="a.usage?.estimatedSavings > 0">{{ t('integrations.accounts.savedSoFar', { amount: fmt.money(a.usage.estimatedSavings) }) }}</span>
            </footer>
          </template>
          <template v-else>
            <p class="ac-pitch">{{ a.previousMasked ? t('integrations.accounts.previously', { masked: a.previousMasked }) : t('integrations.accounts.pitch.' + a.carrier) }}</p>
            <footer class="ac-foot">
              <button :data-testid="'carrier-connect-' + a.carrier" class="btn btn-accent btn-sm" :disabled="!mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="connect(a.carrier)"><Icon name="link" :size="14" /> {{ t('integrations.accounts.connect') }}</button>
            </footer>
          </template>
        </article>
      </template>
    </div>

    <div v-if="!loading && connected.length" class="panel panel-pad how">
      <div class="how-icon"><Icon name="dollar" :size="18" /></div>
      <div>
        <div class="panel-title">{{ t('integrations.accounts.howTitle') }}</div>
        <p class="panel-sub">{{ t('integrations.accounts.howDesc') }}</p>
      </div>
    </div>

    <CarrierConnectWizard v-model:open="wizardOpen" :carrier="wizardCarrier" :available="available" @connected="onConnected" />
    <CarrierAccountDrawer :open="!!drawerId" :account-id="drawerId" @update:open="v => !v && (drawerId = null)" @changed="onChanged" />
  </div>
</template>

<style scoped>
.intro-callout { margin-bottom: 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 16px; }
.acc-card { padding: 18px; display: flex; flex-direction: column; gap: 14px; min-height: 210px; }
.acc-card.off { background: var(--bg); }
.ac-head { display: flex; align-items: center; gap: 12px; }
.grow { flex: 1; min-width: 0; }
.ac-name { font-family: var(--font-display); font-weight: 600; font-size: 16px; }
.ac-sub { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.ac-kv { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin: 0; }
.ac-kv dt { color: var(--ink-3); font-size: 12px; }
.ac-kv dd { margin: 2px 0 0; font-size: 13.5px; font-weight: 500; }
.strong { font-size: 16px !important; font-weight: 600 !important; color: var(--success); }
.verified { display: inline-flex; align-items: center; gap: 4px; color: var(--success); }
.ac-pitch { margin: 0; color: var(--ink-2); font-size: 13.5px; line-height: 1.5; }
.ac-foot { margin-top: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.savings { margin-left: auto; font-size: 12px; color: var(--success); font-weight: 500; }
.how { display: flex; gap: 14px; align-items: flex-start; }
.how-icon { width: 36px; height: 36px; border-radius: 10px; background: oklch(0.95 0.05 155); color: oklch(0.42 0.12 155); display: grid; place-items: center; flex: none; }
.how p { margin: 4px 0 0; line-height: 1.55; }
</style>
