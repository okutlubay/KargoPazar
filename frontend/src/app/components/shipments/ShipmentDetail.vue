<script setup>
// Shipment detail body (spec 5.6) used by the drawer (Shipments list) and the full page.
//   <ShipmentDetail :shipment-id="id" layout="drawer|page" @changed="..." />
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import StatusPill from '../StatusPill.vue'
import CarrierLogo from '../CarrierLogo.vue'
import ChannelLogo from '../ChannelLogo.vue'
import Money from '../Money.vue'
import Weight from '../Weight.vue'
import DateTime from '../DateTime.vue'
import Skeleton from '../Skeleton.vue'
import EmptyState from '../EmptyState.vue'
import CopyButton from '../CopyButton.vue'
import Modal from '../Modal.vue'
import Dropdown from '../Dropdown.vue'
import LabelPreview from './LabelPreview.vue'
import RateList from './RateList.vue'
import { copyText } from '../CopyButton.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { can } from '../../store/session.js'
import {
  getShipment, voidLabel, reprintLabel, createDummyLabel, markDummyReplaced, quoteReturn, createReturnLabel,
  trackingProgressStep, advanceTracking,
} from '../../api/shipments.js'
import { listTransactions } from '../../api/wallet.js'
import { apiErrorText, serviceName, carrierName, hasKey } from './helpers.js'
import Dims from '../Dims.vue'
import Tabs from '../Tabs.vue'
import CustomsRecordTab from '../customs/CustomsRecordTab.vue'
import { useRoute } from 'vue-router'

const props = defineProps({
  shipmentId: { type: String, required: true },
  layout: { type: String, default: 'drawer' },
})
const emit = defineEmits(['changed', 'loaded'])
const router = useRouter()
const route = useRoute()

// tabs: overview (existing content) and customs; the page layout keeps the tab in ?tab=customs
const DETAIL_TABS = ['overview', 'customs']
const tab = ref(props.layout === 'page' && DETAIL_TABS.includes(route.query.tab) ? route.query.tab : 'overview')
const detailTabs = computed(() => DETAIL_TABS.map(k => ({ key: k, label: t('customsInfo.tabs.' + k), icon: k === 'customs' ? 'shield' : undefined })))
watch(tab, v => { if (props.layout === 'page' && (route.query.tab || 'overview') !== v) router.replace({ query: { ...route.query, tab: v === 'overview' ? undefined : v } }) })
watch(() => route.query.tab, v => { if (props.layout === 'page') tab.value = DETAIL_TABS.includes(v) ? v : 'overview' })
watch(() => props.shipmentId, () => { if (props.layout !== 'page') tab.value = 'overview' })

const s = ref(null)
const loading = ref(true)
const notFound = ref(false)
const busy = ref('')
const refundTxn = ref(null)
let refundTimer = null

async function load(quiet = false) {
  if (!quiet) loading.value = true
  notFound.value = false
  try {
    s.value = await getShipment(props.shipmentId)
    emit('loaded', s.value)
    loadRefund()
  } catch (e) {
    if (e.code === 'NOT_FOUND') notFound.value = true
    else toast.error(apiErrorText(e))
  } finally { loading.value = false }
}
watch(() => props.shipmentId, () => load(), { immediate: true })
async function refresh() { await load(true); emit('changed', s.value) }
onBeforeUnmount(() => clearTimeout(refundTimer))

async function loadRefund() {
  clearTimeout(refundTimer)
  refundTxn.value = null
  if (!s.value?.refundTxnId) return
  try {
    const [txn] = await listTransactions({ q: s.value.refundTxnId })
    refundTxn.value = txn ?? null
    if (txn?.status === 'pending') {
      const left = txn.completesAt ? Math.max(500, new Date(txn.completesAt).getTime() - Date.now() + 400) : 3000
      refundTimer = setTimeout(async () => {
        await loadRefund()
        if (refundTxn.value?.status === 'completed') { toast.success(t('shipments.detail.refundCompleted', { amount: fmt.money(refundTxn.value.amount) })); emit('changed', s.value) }
      }, left)
    }
  } catch {}
}

const intl = computed(() => (s.value?.to?.country || 'US') !== 'US' || !!s.value?.customs)
const hasCustoms = computed(() => !!s.value && (intl.value || s.value.flow === 'stock' || s.value.flow === 'direct' || (!!s.value.origin && s.value.origin !== (s.value.to?.country || 'US'))))
const own = computed(() => String(s.value?.account ?? '').startsWith('own:'))
const step = computed(() => (s.value ? trackingProgressStep(s.value.status, s.value.events ?? []) : 0))
const events = computed(() => [...(s.value?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)))
const routeNodes = computed(() => {
  let r = s.value?.route ?? []
  if (!r.length) return []
  // the destination may also be a transfer city on the lane (e.g. Phoenix on LA01 to Dallas): end the route there
  const dest = s.value?.to?.city && s.value?.to?.state ? `${s.value.to.city}, ${s.value.to.state}` : null
  const di = dest ? r.indexOf(dest) : -1
  if (di > 0 && di < r.length - 1) r = r.slice(0, di + 1)
  const n = r.length
  const doneIdx = s.value.status === 'delivered' ? n - 1 : step.value >= 3 ? n - 1 : step.value === 2 ? Math.max(1, Math.min(n - 2, Math.floor((n - 1) / 2))) : 0
  return r.map((loc, i) => ({ loc, done: i <= doneIdx, current: i === doneIdx && s.value.status !== 'delivered', first: i === 0, last: i === n - 1 }))
})
const breakdownTotal = computed(() => (s.value?.breakdown ?? []).reduce((sum, b) => sum + b.amount, 0))
const aiReason = computed(() => {
  const a = s.value?.aiPick
  if (!a) return ''
  if (a.reason) return tx(a.reason)
  const k = 'core.aiReasons.' + a.reasonCode
  return hasKey(k) ? t(k) : ''
})
const suggestedName = computed(() => {
  const k = s.value?.aiPick?.suggested
  if (!k) return '-'
  const [c, svc] = String(k).split(':')[0].split('-')
  return `${carrierName(c)} ${serviceName(c, svc)}`.replace(`${carrierName(c)} ${carrierName(c)}`, carrierName(c))
})

// ---- void
async function voidIt() {
  const usps = s.value.carrier === 'USPS'
  const ok = await confirm({
    title: t('shipments.void.title', { id: s.value.id }),
    message: t('shipments.void.message', { amount: fmt.money(s.value.walletCharge ?? 0) }) + (usps ? ' ' + t('shipments.void.uspsNote') : ''),
    confirmLabel: t('shipments.void.confirm'), danger: true,
  })
  if (!ok) return
  busy.value = 'void'
  try {
    const r = await voidLabel(s.value.id, { reason: 'panel' })
    await refresh()
    if (!r.refund) toast.success(t('shipments.void.doneNoRefund'))
    else if (r.refund.status === 'pending') toast.info(t('shipments.void.donePending', { amount: fmt.money(r.refund.amount) }), { duration: 6000 })
    else toast.success(t('shipments.void.done', { amount: fmt.money(r.refund.amount) }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

// ---- documents
async function docs() { return import('../../docs/index.js') }
async function downloadLabel() { (await docs()).downloadLabel(s.value) }
async function reprint() {
  busy.value = 'reprint'
  try {
    await reprintLabel(s.value.id)
    ;(await docs()).printLabel(s.value)
    await refresh()
    toast.success(t('shipments.detail.reprinted'))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
async function downloadInvoice() {
  try {
    const d = await docs()
    const data = d.buildCustomsData(s.value, { order: s.value.order ?? null, items: s.value.customs?.items?.map(i => ({ description: i.description, hsCode: i.hsCode, origin: i.origin, qty: +i.qty, unitValue: +i.unitValue, totalValue: +i.qty * +i.unitValue })) ?? undefined, contentType: s.value.customs?.contentType })
    d.downloadCommercialInvoice(data)
  } catch (e) { if (import.meta.env.DEV) console.warn(e); toast.error(t('common.errorGeneric')) }
}

// ---- temporary (dummy) label
async function createDummy() {
  busy.value = 'dummy'
  try {
    const r = await createDummyLabel({ shipmentId: s.value.id })
    await refresh()
    toast.success(r.existing ? t('shipments.dummy.exists', { ref: r.dummyLabel.ref }) : t('shipments.dummy.created', { ref: r.dummyLabel.ref }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
async function downloadDummy() {
  const dl = s.value.dummyLabel
  ;(await docs()).downloadLabel(s.value, { dummy: true, platformRef: dl.ref, replaced: dl.status === 'replaced' })
}
async function replaceDummy() {
  const ok = await confirm({ title: t('shipments.dummy.replaceTitle'), message: t('shipments.dummy.replaceMsg', { ref: s.value.dummyLabel.ref, tracking: s.value.trackingNo }), confirmLabel: t('shipments.dummy.replace') })
  if (!ok) return
  busy.value = 'replace'
  try {
    await markDummyReplaced({ shipmentId: s.value.id }, { finalShipmentId: s.value.id, finalTrackingNo: s.value.trackingNo })
    await refresh()
    toast.success(t('shipments.dummy.replaced'))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

// ---- share tracking
const trackUrl = computed(() => (s.value ? `${location.origin}${location.pathname}#/track/${s.value.trackingNo}` : ''))
async function share() {
  if (await copyText(trackUrl.value)) toast.success(t('shipments.detail.shareCopied'))
  else toast.error(t('common.errorGeneric'))
}

// ---- return label
const retOpen = ref(false)
const retLoading = ref(false)
const retResult = ref(null)
const retKey = ref(null)
const retBusy = ref(false)
async function openReturn() {
  retOpen.value = true
  retLoading.value = true
  retResult.value = null
  try {
    retResult.value = await quoteReturn(s.value.id)
    retKey.value = retResult.value.aiPickKey ?? retResult.value.cheapestKey
  } catch (e) { toast.error(apiErrorText(e)); retOpen.value = false } finally { retLoading.value = false }
}
async function confirmReturn() {
  retBusy.value = true
  try {
    const r = await createReturnLabel(s.value.id, { quoteKey: retKey.value })
    retOpen.value = false
    await refresh()
    toast.success(t('shipments.ret.done', { id: r.shipment.id, amount: fmt.money(r.shipment.total ?? r.shipment.walletCharge) }), { action: { label: t('common.view'), onClick: () => router.push({ name: 'shipment-detail', params: { id: r.shipment.id } }) } })
  } catch (e) { toast.error(apiErrorText(e)) } finally { retBusy.value = false }
}

// ---- demo scan
async function scan() {
  busy.value = 'scan'
  try {
    const r = await advanceTracking(s.value.id)
    await refresh()
    const last = r.events?.[r.events.length - 1]
    toast.info(t('shipments.detail.scanned', { event: t('core.events.' + (last?.code ?? r.status)), loc: last?.loc ?? '' }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

const moreItems = computed(() => {
  if (!s.value) return []
  const x = s.value
  return [
    { key: 'dummy', label: t('shipments.actions.dummy'), icon: 'file', disabled: x.status === 'voided' || !can('shipments.create') || x.dummyLabel?.status === 'active', onClick: createDummy },
    { key: 'return', label: t('shipments.actions.return'), icon: 'return', disabled: !['in_transit', 'out_for_delivery', 'delivered', 'exception'].includes(x.status) || !!x.returnShipmentId || x.isReturn || !can('shipments.create'), onClick: openReturn },
    { key: 'scan', label: t('shipments.actions.scan'), icon: 'scan', hint: t('shipments.actions.scanHint'), disabled: ['delivered', 'voided', 'returned'].includes(x.status), onClick: scan },
    { divider: true },
    { key: 'track', label: t('shipments.actions.openTracking'), icon: 'radar', onClick: () => router.push({ name: 'track', params: { trackingNo: x.trackingNo } }) },
  ]
})
defineExpose({ reload: () => load(true) })
</script>

<template>
  <div class="sd" :class="'l-' + layout">
    <div v-if="loading" class="stack"><Skeleton variant="rect" :height="80" /><Skeleton variant="rect" :height="90" /><Skeleton variant="rect" :height="200" /></div>
    <EmptyState v-else-if="notFound" icon="search" :title="t('shipments.detail.notFound')" :description="t('shipments.detail.notFoundDesc', { id: shipmentId })" :action-label="t('shipments.detail.back')" @action="router.push({ name: 'shipments' })" />
    <template v-else-if="s">
      <!-- header -->
      <section class="head-card">
        <div class="hc-top">
          <CarrierLogo :code="s.carrier" :size="40" />
          <div class="hc-titles">
            <div class="hc-svc">{{ serviceName(s.carrier, s.service) }}
              <span v-if="own" class="tag tag-accent"><Icon name="key" :size="10" />{{ t('core.badges.own') }}</span>
              <span v-if="s.isReturn" class="tag tag-warning"><Icon name="return" :size="10" />{{ t('shipments.detail.returnLabel') }}</span>
              <span v-if="s.test" class="tag">{{ t('status.test') }}</span>
            </div>
            <div class="track mono">{{ s.trackingNo }} <CopyButton :text="s.trackingNo" size="xs" /></div>
          </div>
          <StatusPill :status="s.status" />
        </div>
        <div class="hc-meta">
          <span><Icon name="calendar" :size="12" /><DateTime :value="s.createdAt" mode="absolute" /></span>
          <span><Icon name="warehouse" :size="12" />{{ s.hub }}</span>
          <span v-if="s.eta && s.status !== 'delivered' && s.status !== 'voided'"><Icon name="clock" :size="12" />{{ t('shipments.detail.eta', { date: fmt.date(s.eta) }) }}</span>
          <span v-if="s.deliveredAt"><Icon name="check-circle" :size="12" />{{ t('shipments.detail.deliveredAt', { date: fmt.dateTime(s.deliveredAt) }) }}</span>
          <RouterLink v-if="s.orderId" class="link" :to="{ name: 'order-detail', params: { id: s.orderId } }"><Icon name="list" :size="12" />{{ s.orderId }}</RouterLink>
        </div>
        <div class="hc-actions">
          <button v-if="s.status === 'label_created'" class="btn btn-ghost btn-sm danger-text" :disabled="!can('shipments.void') || busy === 'void'" :title="!can('shipments.void') ? t('common.noPermission') : ''" @click="voidIt">
            <span v-if="busy === 'void'" class="spin dark" /><Icon v-else name="x-circle" :size="13" />{{ t('shipments.actions.void') }}
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="s.status === 'voided' || busy === 'reprint'" @click="reprint"><Icon name="printer" :size="13" />{{ t('shipments.actions.reprint') }}</button>
          <button class="btn btn-ghost btn-sm" :disabled="s.status === 'voided'" @click="downloadLabel"><Icon name="download" :size="13" />{{ t('shipments.actions.labelPdf') }}</button>
          <button class="btn btn-ghost btn-sm" @click="share"><Icon name="link" :size="13" />{{ t('shipments.actions.share') }}</button>
          <Dropdown :items="moreItems" :label="t('shipments.actions.more')" size="sm" />
        </div>
        <div v-if="s.status === 'voided' && refundTxn" class="callout" :class="refundTxn.status === 'pending' ? 'warn' : ''">
          <Icon :name="refundTxn.status === 'pending' ? 'clock' : 'check-circle'" :size="15" />
          {{ refundTxn.status === 'pending' ? t('shipments.detail.refundPending', { amount: fmt.money(refundTxn.amount) }) : t('shipments.detail.refundDone', { amount: fmt.money(refundTxn.amount) }) }}
        </div>
      </section>

      <Tabs v-if="hasCustoms" v-model="tab" :tabs="detailTabs" :aria-label="s.id" data-testid="shipment-detail-tabs" />
      <CustomsRecordTab v-if="hasCustoms && tab === 'customs'" kind="shipment" :record="s" />
      <template v-else>
      <!-- route -->
      <section class="card-s">
        <header class="cs-head"><h3>{{ t('shipments.detail.route') }}</h3><span class="muted small">{{ t('shipments.detail.zone', { n: s.zone ?? '-' }) }}</span></header>
        <div class="route" role="list">
          <div v-for="(n, i) in routeNodes" :key="i" class="node" :class="{ done: n.done, current: n.current, first: n.first, last: n.last }" role="listitem">
            <span class="dot"><Icon v-if="n.first" name="warehouse" :size="11" /><Icon v-else-if="n.last" name="pin" :size="11" /></span>
            <span class="loc">{{ n.loc }}</span>
            <span v-if="n.first" class="muted xs">{{ s.hub }}</span>
            <span v-else-if="n.last" class="muted xs">{{ s.to?.zip }}</span>
            <span v-else class="muted xs">{{ t('shipments.detail.facility') }}</span>
          </div>
        </div>
      </section>

      <div class="cols">
        <!-- events -->
        <section class="card-s">
          <header class="cs-head"><h3>{{ t('shipments.detail.events') }}</h3></header>
          <ol class="tl">
            <li v-for="(e, i) in events" :key="i" :class="'c-' + e.code">
              <span class="tdot" />
              <div><div class="tl-text">{{ hasKey('core.events.' + e.code) ? t('core.events.' + e.code) : e.code }}</div><div class="muted xs">{{ e.loc }} · <DateTime :value="e.at" mode="absolute" /></div></div>
            </li>
          </ol>
        </section>

        <!-- price -->
        <section class="card-s">
          <header class="cs-head"><h3>{{ t('shipments.detail.price') }}</h3></header>
          <table class="table-simple">
            <tbody>
              <tr v-for="b in s.breakdown" :key="b.code"><td>{{ t('core.breakdown.' + b.code) }}</td><td class="r"><Money :value="b.amount" /></td></tr>
              <tr class="tot"><td>{{ t('shipments.detail.total') }}</td><td class="r"><Money :value="s.total ?? breakdownTotal" /></td></tr>
              <tr><td class="muted">{{ t('shipments.detail.walletCharge') }}</td><td class="r muted"><Money :value="s.walletCharge ?? 0" /></td></tr>
            </tbody>
          </table>
          <header class="cs-head mt"><h3>{{ t('shipments.detail.package') }}</h3></header>
          <dl class="kv">
            <dt>{{ t('shipments.detail.dims') }}</dt><dd class="mono"><Dims :value="s.package" /></dd>
            <dt>{{ t('shipments.detail.weight') }}</dt><dd><Weight :lb="s.package?.weightLb" /></dd>
            <dt>{{ t('shipments.detail.billable') }}</dt><dd><Weight :lb="s.billableLb" /> <span class="muted xs">({{ t('shipments.detail.dimWeight', { n: s.dimWeightLb ?? '-' }) }})</span></dd>
            <dt>{{ t('shipments.detail.declared') }}</dt><dd><Money :value="s.declaredValue ?? 0" /></dd>
          </dl>
        </section>
      </div>

      <div class="cols">
        <!-- AI -->
        <section class="card-s ai-card">
          <header class="cs-head"><h3><span class="badge-ai"><Icon name="spark" :size="10" />AI</span> {{ t('shipments.detail.ai') }}</h3></header>
          <template v-if="s.aiPick">
            <p class="ai-text">{{ s.aiPick.chosen ? t('shipments.detail.aiChosen') : t('shipments.detail.aiOverridden', { svc: suggestedName }) }}</p>
            <p class="ai-reason">{{ aiReason }}</p>
            <div v-if="s.aiPick.chosen && s.aiPick.savingsVsDefault > 0" class="save">{{ t('shipments.detail.aiSavings', { amount: fmt.money(s.aiPick.savingsVsDefault) }) }}</div>
          </template>
          <p v-else class="muted">-</p>
          <div v-if="s.appliedRules?.length" class="rules"><Icon name="flag" :size="12" />{{ t('shipments.detail.rules', { names: s.appliedRules.map(r => tx(r.name)).join(', ') }) }}</div>
        </section>

        <!-- recipient -->
        <section class="card-s">
          <header class="cs-head"><h3>{{ t('shipments.detail.addresses') }}</h3></header>
          <div class="addrs">
            <div>
              <div class="muted xs up">{{ t('shipments.detail.from') }}</div>
              <div class="strong">{{ s.from?.name }}</div>
              <div class="small">{{ s.from?.line1 }}<template v-if="s.from?.line2">, {{ s.from.line2 }}</template></div>
              <div class="small">{{ s.from?.city }}, {{ s.from?.state }} {{ s.from?.zip }}</div>
            </div>
            <div>
              <div class="muted xs up">{{ t('shipments.detail.to') }}</div>
              <div class="strong">{{ s.to?.name }}</div>
              <div v-if="s.to?.company" class="small">{{ s.to.company }}</div>
              <div class="small">{{ s.to?.line1 }}<template v-if="s.to?.line2">, {{ s.to.line2 }}</template></div>
              <div class="small">{{ s.to?.city }}, {{ s.to?.state }} {{ s.to?.zip }} · {{ s.to?.country }}</div>
            </div>
          </div>
          <div v-if="s.order" class="ord"><ChannelLogo :code="s.order.channel" :size="20" /><span class="mono small">{{ s.order.channelOrderNo }}</span></div>
        </section>
      </div>

      <!-- adjustment -->
      <section v-if="s.adjustment" class="card-s adj">
        <header class="cs-head">
          <h3><Icon name="scale" :size="14" /> {{ t('shipments.detail.adjustment') }}</h3>
          <StatusPill :status="s.adjustment.status" size="sm" />
        </header>
        <div class="adj-grid">
          <div><div class="muted xs">{{ t('shipments.detail.declaredPkg') }}</div><div class="mono"><Dims :value="s.adjustment.declared?.dims" /> · <Weight :lb="s.adjustment.declared?.weightLb" /></div><div class="muted xs">{{ t('shipments.detail.billableN', { n: s.adjustment.declared?.billableLb }) }}</div></div>
          <Icon name="arrow" :size="16" class="muted" />
          <div><div class="muted xs">{{ t('shipments.detail.measuredPkg', { hub: s.adjustment.measuredAtHub }) }}</div><div class="mono"><Dims :value="s.adjustment.measured?.dims" /> · <Weight :lb="s.adjustment.measured?.weightLb" /></div><div class="muted xs">{{ t('shipments.detail.billableN', { n: s.adjustment.measured?.billableLb }) }}</div></div>
          <div class="adj-delta"><div class="muted xs">{{ t('shipments.detail.delta') }}</div><Money :value="s.adjustment.delta" signed class="text-danger" /></div>
        </div>
        <RouterLink class="link small" :to="{ name: 'billing', query: { tab: 'adjustments', id: s.adjustment.id } }">{{ t('shipments.detail.adjustmentLink') }}</RouterLink>
      </section>

      <!-- documents + labels -->
      <section class="card-s">
        <header class="cs-head"><h3>{{ t('shipments.detail.documents') }}</h3></header>
        <div class="docs">
          <div v-if="s.dummyLabel" class="label-cards">
            <div class="lc" :class="{ replaced: s.dummyLabel.status === 'replaced' }">
              <div class="lc-head"><span class="strong">{{ t('shipments.dummy.temp') }}</span><StatusPill :status="s.dummyLabel.status === 'replaced' ? 'replaced' : 'active'" size="sm" /></div>
              <LabelPreview :shipment="s" :opts="{ dummy: true, platformRef: s.dummyLabel.ref, replaced: s.dummyLabel.status === 'replaced' }" :width="170" />
              <div class="mono small">{{ s.dummyLabel.ref }}</div>
              <div class="muted xs">{{ t('shipments.dummy.watermark') }}</div>
              <div class="lc-actions">
                <button class="btn btn-ghost btn-xs" @click="downloadDummy"><Icon name="download" :size="12" />PDF</button>
                <button v-if="s.dummyLabel.status === 'active'" class="btn btn-soft btn-xs" :disabled="busy === 'replace' || s.status === 'voided'" @click="replaceDummy"><Icon name="refresh" :size="12" />{{ t('shipments.dummy.replace') }}</button>
                <span v-else class="muted xs">{{ t('shipments.dummy.replacedAt', { date: fmt.dateTime(s.dummyLabel.replacedAt) }) }}</span>
              </div>
            </div>
            <div class="lc" :class="{ pending: s.dummyLabel.status !== 'replaced' }">
              <div class="lc-head"><span class="strong">{{ t('shipments.dummy.final') }}</span><StatusPill :status="s.dummyLabel.status === 'replaced' ? 'active' : 'pending'" size="sm" /></div>
              <LabelPreview :shipment="s" :width="170" />
              <div class="mono small">{{ s.dummyLabel.status === 'replaced' ? (s.dummyLabel.finalTrackingNo ?? s.trackingNo) : t('shipments.dummy.awaiting') }}</div>
              <div class="muted xs">{{ carrierName(s.carrier) }} · {{ serviceName(s.carrier, s.service) }}</div>
              <div class="lc-actions"><button class="btn btn-ghost btn-xs" :disabled="s.dummyLabel.status !== 'replaced'" @click="downloadLabel"><Icon name="download" :size="12" />PDF</button></div>
            </div>
          </div>
          <div v-else class="doc-row">
            <LabelPreview :shipment="s" :width="120" />
            <div class="doc-text">
              <div class="strong">{{ t('shipments.detail.labelDoc') }}</div>
              <div class="muted xs">{{ t('shipments.detail.labelMeta', { n: s.printCount ?? 0 }) }}</div>
              <div class="doc-actions">
                <button class="btn btn-ghost btn-xs" :disabled="s.status === 'voided'" @click="downloadLabel"><Icon name="download" :size="12" />PDF</button>
                <button class="btn btn-ghost btn-xs" :disabled="s.status === 'voided' || !can('shipments.create') || busy === 'dummy'" @click="createDummy"><Icon name="file" :size="12" />{{ t('shipments.actions.dummy') }}</button>
              </div>
            </div>
          </div>
          <div class="doc-row simple">
            <span class="doc-ic"><Icon name="file" :size="16" /></span>
            <div class="doc-text">
              <div class="strong">{{ t('shipments.detail.invoiceDoc') }}</div>
              <div class="muted xs">{{ intl ? t('shipments.detail.invoiceIntl') : t('shipments.detail.invoiceDomestic') }}</div>
            </div>
            <button class="btn btn-ghost btn-xs" @click="downloadInvoice"><Icon name="download" :size="12" />PDF</button>
          </div>
          <div v-if="s.returnShipment" class="doc-row simple">
            <span class="doc-ic"><Icon name="return" :size="16" /></span>
            <div class="doc-text"><div class="strong">{{ t('shipments.detail.returnOf', { id: s.returnShipment.id }) }}</div><div class="muted xs mono">{{ s.returnShipment.trackingNo }}</div></div>
            <RouterLink class="btn btn-ghost btn-xs" :to="{ name: 'shipment-detail', params: { id: s.returnShipment.id } }">{{ t('common.view') }}</RouterLink>
          </div>
          <div v-if="s.returnOfShipment" class="doc-row simple">
            <span class="doc-ic"><Icon name="return" :size="16" /></span>
            <div class="doc-text"><div class="strong">{{ t('shipments.detail.returnFor', { id: s.returnOfShipment.id }) }}</div></div>
            <RouterLink class="btn btn-ghost btn-xs" :to="{ name: 'shipment-detail', params: { id: s.returnOfShipment.id } }">{{ t('common.view') }}</RouterLink>
          </div>
        </div>
      </section>
      </template>
    </template>

    <Modal v-model:open="retOpen" :title="t('shipments.ret.title')" :subtitle="s ? t('shipments.ret.sub', { city: s.to?.city, hub: s.hub }) : ''" size="lg">
      <div v-if="retLoading" class="stack"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="56" /></div>
      <template v-else-if="retResult">
        <p class="muted small">{{ t('shipments.ret.note') }}</p>
        <RateList v-model="retKey" :result="retResult" sort="cheapest" />
      </template>
      <template #footer>
        <button class="btn btn-ghost" @click="retOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!retKey || retBusy" @click="confirmReturn"><span v-if="retBusy" class="spin" />{{ t('shipments.ret.cta') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.sd { display: flex; flex-direction: column; gap: 14px; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.small { font-size: 12.5px; }
.xs { font-size: 11.5px; }
.strong { font-weight: 600; }
.up { text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
.mt { margin-top: 14px; }
.r { text-align: right; }
.danger-text { color: var(--danger); }
.head-card { display: flex; flex-direction: column; gap: 10px; }
.hc-top { display: flex; align-items: center; gap: 12px; }
.hc-titles { flex: 1; min-width: 0; }
.hc-svc { font-weight: 600; font-size: 16px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.track { font-size: 13px; color: var(--ink-2); display: flex; align-items: center; gap: 4px; word-break: break-all; }
.hc-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2); }
.hc-meta > * { display: inline-flex; align-items: center; gap: 5px; }
.hc-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.l-drawer .cols { grid-template-columns: 1fr; }
.card-s { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 14px 16px; background: var(--surface); }
.l-page .card-s { border-radius: var(--r-lg); box-shadow: var(--shadow-sm); }
.cs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.cs-head h3 { margin: 0; font-size: 14px; font-family: var(--font-display); font-weight: 600; display: flex; align-items: center; gap: 6px; }
.route { display: flex; align-items: flex-start; overflow-x: auto; padding: 4px 2px 2px; }
.node { position: relative; flex: 1; min-width: 110px; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.node::before { content: ''; position: absolute; top: 10px; left: -50%; right: 50%; height: 2px; background: var(--line-2); z-index: 0; }
.node.first::before { display: none; }
.node.done::before { background: var(--accent); }
.dot { position: relative; z-index: 1; width: 22px; height: 22px; border-radius: 999px; background: var(--surface); border: 2px solid var(--line-2); display: grid; place-items: center; color: var(--ink-3); }
.node.done .dot { border-color: var(--accent); background: var(--accent); color: white; }
.node.current .dot { box-shadow: 0 0 0 4px var(--accent-soft); }
.loc { font-size: 12.5px; font-weight: 500; }
.tl { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; }
.tl li { position: relative; display: flex; gap: 12px; padding-bottom: 12px; }
.tl li:not(:last-child)::before { content: ''; position: absolute; left: 4px; top: 14px; bottom: 0; width: 1px; background: var(--line-2); }
.tdot { width: 9px; height: 9px; border-radius: 999px; background: var(--ink-4); margin-top: 5px; flex: none; }
.tl li:first-child .tdot { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tl .c-delivered .tdot { background: var(--success); }
.tl .c-exception .tdot, .tl .c-voided .tdot { background: var(--danger); }
.tl-text { font-size: 13.5px; }
.tot td { font-weight: 700; }
.ai-card { background: color-mix(in oklch, var(--accent-soft) 40%, var(--surface)); }
.ai-text { margin: 0 0 4px; font-weight: 500; font-size: 13.5px; }
.ai-reason { margin: 0; color: var(--ink-2); font-size: 13px; }
.save { margin-top: 8px; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; background: oklch(0.96 0.04 155); color: oklch(0.38 0.1 155); display: inline-block; }
.rules { margin-top: 10px; font-size: 12.5px; color: var(--ink-2); display: flex; gap: 6px; align-items: center; }
.addrs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ord { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.adj { border-color: oklch(0.88 0.06 70); background: oklch(0.985 0.015 80); }
.adj-grid { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 12px; align-items: center; margin-bottom: 10px; }
.adj-delta { text-align: right; font-weight: 700; }
.docs { display: flex; flex-direction: column; gap: 10px; }
.doc-row { display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: var(--r-md); border: 1px solid var(--line-1); }
.doc-row.simple { padding: 10px 12px; }
.doc-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.doc-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.doc-ic { width: 32px; height: 32px; border-radius: 8px; background: var(--bg-3); display: grid; place-items: center; color: var(--ink-2); }
.label-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lc { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.lc.replaced { background: var(--bg-2); }
.lc.pending { border-style: dashed; }
.lc-head { display: flex; justify-content: space-between; width: 100%; align-items: center; gap: 6px; }
.lc-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.spin { width: 13px; height: 13px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; display: inline-block; }
.spin.dark { border-color: var(--line-2); border-top-color: var(--danger); }
@keyframes sp { to { transform: rotate(360deg); } }
@media (max-width: 860px) { .cols, .addrs, .label-cards { grid-template-columns: 1fr; } .adj-grid { grid-template-columns: 1fr; } }
</style>
