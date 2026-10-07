<script setup>
// Wallet & invoices (spec 5.10). ?tab=transactions|adjustments|invoices|own, ?topup=1 opens the top-up modal.
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import TopUpModal from '../../components/billing/TopUpModal.vue'
import WalletPanels from './WalletPanels.vue'
import TransactionsTab from './TransactionsTab.vue'
import AdjustmentsTab from './AdjustmentsTab.vue'
import InvoicesTab from './InvoicesTab.vue'
import OwnAccountTab from './OwnAccountTab.vue'
import StatementModal from './StatementModal.vue'
import { getWallet } from '../../api/wallet.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { db } from '../../store/db.js'
import { t } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()
const TABS = ['transactions', 'adjustments', 'invoices', 'own']
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'transactions')
watch(tab, v => { if (route.query.tab !== v) router.replace({ query: { ...route.query, tab: v, id: undefined } }) })
watch(() => route.query.tab, v => { if (TABS.includes(v)) tab.value = v })

const wallet = ref(null)
const loading = ref(true)
const error = ref('')
const topupOpen = ref(route.query.topup === '1')
const statementOpen = ref(false)

async function load() {
  loading.value = !wallet.value
  error.value = ''
  try { wallet.value = await getWallet() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(load)

// Live balance straight from the store so every charge (labels, adjustments, refunds) animates here.
const liveBalance = computed(() => db.doc('wallet').balance)
watch(() => [db.doc('wallet').balance, (db.doc('wallet').cards ?? []).length], () => load())

const counts = computed(() => ({
  transactions: (db.doc('wallet').transactions ?? []).length,
  adjustments: db.all('adjustments').filter(a => a.status === 'charged' && a.disputeDeadline && new Date(a.disputeDeadline) > new Date()).length,
  invoices: db.all('invoices').length,
  own: db.all('shipments').filter(s => String(s.account ?? '').startsWith('own:')).length,
}))
const tabs = computed(() => [
  { key: 'transactions', label: t('billing.tabs.transactions'), count: counts.value.transactions },
  { key: 'adjustments', label: t('billing.tabs.adjustments'), count: counts.value.adjustments || undefined },
  { key: 'invoices', label: t('billing.tabs.invoices'), count: counts.value.invoices },
  { key: 'own', label: t('billing.tabs.own'), count: counts.value.own },
])
function onTopupDone() { load() }
watch(topupOpen, v => { if (!v && route.query.topup) router.replace({ query: { ...route.query, topup: undefined } }) })
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.billing')" :subtitle="t('billing.subtitle')">
      <template #actions>
        <button class="btn btn-ghost" @click="statementOpen = true"><Icon name="file" :size="14" /> {{ t('billing.statement.button') }}</button>
        <button data-testid="billing-topup" class="btn btn-accent" :disabled="!can('billing.topup')" :title="can('billing.topup') ? '' : t('common.noPermission')" @click="topupOpen = true"><Icon name="plus" :size="14" /> {{ t('billing.balance.topup') }}</button>
      </template>
    </PageHeader>
    <div v-if="error" class="callout danger mb">{{ error }} <button class="btn-link" @click="load">{{ t('common.retry') }}</button></div>
    <WalletPanels :wallet="wallet" :live-balance="liveBalance" :loading="loading" @topup="topupOpen = true" @changed="load" @statement="statementOpen = true" />
    <div class="tabs-wrap">
      <Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.billing')" />
    </div>
    <TransactionsTab v-if="tab === 'transactions'" />
    <AdjustmentsTab v-else-if="tab === 'adjustments'" />
    <InvoicesTab v-else-if="tab === 'invoices'" />
    <OwnAccountTab v-else />

    <TopUpModal v-model:open="topupOpen" @done="onTopupDone" />
    <StatementModal v-model:open="statementOpen" />
  </div>
</template>

<style scoped>
.tabs-wrap { margin: 24px 0 14px; }
.mb { margin-bottom: 12px; }
</style>
