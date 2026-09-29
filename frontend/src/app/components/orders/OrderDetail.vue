<script setup>
// Order detail body used by the drawer (Orders list) and the full page (/orders/:id). Spec 5.4.
//   <OrderDetail :order-id="id" :layout="'drawer'|'page'" @changed="reload" @loaded="o => ..." />
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import StatusPill from '../StatusPill.vue'
import ScoreBadge from '../ScoreBadge.vue'
import ChannelLogo from '../ChannelLogo.vue'
import CarrierLogo from '../CarrierLogo.vue'
import Money from '../Money.vue'
import Weight from '../Weight.vue'
import DateTime from '../DateTime.vue'
import Skeleton from '../Skeleton.vue'
import EmptyState from '../EmptyState.vue'
import Modal from '../Modal.vue'
import AddressForm from '../AddressForm.vue'
import PackageForm from '../PackageForm.vue'
import CopyButton from '../CopyButton.vue'
import HsSuggestModal from './HsSuggestModal.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { can } from '../../store/session.js'
import {
  getOrder, applyAddressSuggestion, undoAddressSuggestion, holdOrders, releaseOrders, restoreOrders,
  cancelOrder, updateOrder, revalidateAddresses,
} from '../../api/orders.js'
import { recordHsFeedback } from '../../api/ai.js'
import { makeAddressValidator } from './addressValidator.js'
import { issueText, apiErrorText, serviceName, carrierName } from '../shipments/helpers.js'

const props = defineProps({
  orderId: { type: String, required: true },
  layout: { type: String, default: 'drawer' }, // drawer | page
})
const emit = defineEmits(['changed', 'loaded', 'not-found'])
const router = useRouter()

const order = ref(null)
const loading = ref(true)
const notFound = ref(false)
const busy = ref('')

async function load(quiet = false) {
  if (!quiet) loading.value = true
  notFound.value = false
  try {
    order.value = await getOrder(props.orderId)
    emit('loaded', order.value)
  } catch (e) {
    if (e.code === 'NOT_FOUND') { notFound.value = true; emit('not-found') }
    else toast.error(apiErrorText(e))
  } finally { loading.value = false }
}
watch(() => props.orderId, () => load(), { immediate: true })

async function refresh() { await load(true); emit('changed', order.value) }

const canManage = computed(() => can('orders.manage'))
const canShip = computed(() => can('shipments.create'))
const isMarketplace = computed(() => ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce'].includes(order.value?.channel))
const check = computed(() => order.value?.addressCheck ?? null)
const suggestion = computed(() => {
  const s = check.value?.suggestion
  if (!s?.patch || !Object.keys(s.patch).length) return null
  const merged = { ...order.value.shipTo, ...s.patch }
  const keys = Object.keys(s.patch)
  return { merged, keys, confidence: s.confidence, source: s.source }
})
const shippable = computed(() => ['awaiting_shipment', 'on_hold'].includes(order.value?.status) && !order.value?.shipmentId)
const liveShipment = computed(() => order.value?.shipment && order.value.shipment.status !== 'voided' ? order.value.shipment : null)

// ---- address suggestion + undo
async function applySuggestion() {
  busy.value = 'apply'
  const before = check.value?.score
  try {
    const r = await applyAddressSuggestion(order.value.id)
    await refresh()
    toast.success(t('orders.detail.applied', { before, after: r.order.addressCheck.score }), {
      action: { label: t('common.undo'), onClick: () => undoApply(r.undo) },
      duration: 7000,
    })
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
async function undoApply(undo) {
  try { await undoAddressSuggestion(undo); await refresh(); toast.info(t('orders.detail.undone')) } catch (e) { toast.error(apiErrorText(e)) }
}
async function revalidate() {
  busy.value = 'revalidate'
  try {
    const [r] = await revalidateAddresses([order.value.id])
    await refresh()
    toast.success(t('orders.detail.revalidated', { score: r?.score ?? '-' }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

// ---- hold / release / cancel
async function toggleHold() {
  const hold = order.value.status === 'awaiting_shipment'
  busy.value = 'hold'
  try {
    const r = hold ? await holdOrders([order.value.id]) : await releaseOrders([order.value.id])
    await refresh()
    toast.info(t(hold ? 'orders.toast.held' : 'orders.toast.released', { n: 1 }), {
      action: { label: t('common.undo'), onClick: async () => { await restoreOrders(r.changed); await refresh() } },
    })
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
async function cancel() {
  const ok = await confirm({ title: t('orders.cancel.title', { id: order.value.id }), message: t('orders.cancel.message'), confirmLabel: t('orders.cancel.confirm'), danger: true })
  if (!ok) return
  busy.value = 'cancel'
  try {
    await cancelOrder(order.value.id, t('orders.cancel.reason'))
    await refresh()
    toast.success(t('orders.cancel.done', { id: order.value.id }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
function createShipment() { router.push({ name: 'shipment-new', query: { orderId: order.value.id } }) }

// ---- marketplace modal
const mpOpen = ref(false)
const mpUrl = computed(() => {
  const o = order.value
  if (!o) return ''
  const no = String(o.channelOrderNo ?? '').replace('#', '')
  return {
    shopify: `https://admin.shopify.com/store/anatolia-home/orders/${no}`,
    etsy: `https://www.etsy.com/your/orders/sold?order_id=${no}`,
    amazon: `https://sellercentral.amazon.com/orders-v3/order/${no}`,
    ebay: `https://www.ebay.com/sh/ord/details?orderid=${no}`,
    woocommerce: `https://shop.example.com/wp-admin/post.php?post=${no}&action=edit`,
  }[o.channel] ?? ''
})

// ---- edit address
const addrOpen = ref(false)
const addrDraft = ref({})
const addrForm = ref(null)
const validator = computed(() => makeAddressValidator({ orderId: props.orderId }))
function openAddress() { addrDraft.value = { ...order.value.shipTo, email: order.value.customer?.email, phone: order.value.customer?.phone }; addrOpen.value = true }
async function saveAddress() {
  if (!addrForm.value?.validate()) return
  busy.value = 'address'
  const before = check.value?.score
  try {
    const { email, phone, ...shipTo } = addrDraft.value
    const r = await updateOrder(order.value.id, { shipTo, customer: { ...order.value.customer, email: email ?? '', phone: phone ?? '' } })
    addrOpen.value = false
    await refresh()
    toast.success(t('orders.detail.addressSaved', { before, after: r.addressCheck?.score ?? '-' }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

// ---- edit package
const pkgOpen = ref(false)
const pkgDraft = ref({})
const pkgForm = ref(null)
function openPackage() { pkgDraft.value = { ...(order.value.package ?? { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 1 }) }; pkgOpen.value = true }
async function savePackage() {
  if (pkgForm.value && !pkgForm.value.validate()) return
  busy.value = 'package'
  try {
    const { lengthIn, widthIn, heightIn, weightLb } = pkgDraft.value
    await updateOrder(order.value.id, { package: { lengthIn, widthIn, heightIn, weightLb } })
    pkgOpen.value = false
    await refresh()
    toast.success(t('orders.detail.packageSaved'))
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

// ---- HS suggestion
const hsOpen = ref(false)
const hsItem = ref(null)
const hsSaving = ref(false)
function openHs(i) { hsItem.value = i; hsOpen.value = true }
async function applyHs({ code, predicted }) {
  hsSaving.value = true
  try {
    const i = hsItem.value
    const items = order.value.items.map((it, idx) => (idx === i ? { ...it, hsCode: code } : it))
    await updateOrder(order.value.id, { items })
    await recordHsFeedback({ title: order.value.items[i].title, code, predicted, sku: order.value.items[i].sku, source: 'order' }).catch(() => {})
    hsOpen.value = false
    await refresh()
    toast.success(t('orders.hs.applied', { code }))
  } catch (e) { toast.error(apiErrorText(e)) } finally { hsSaving.value = false }
}

function timelineText(ev) {
  const base = t('core.timeline.' + ev.code)
  const d = ev.detail ?? {}
  if (ev.code === 'address_validated' && d.score != null) return `${base} · ${t('orders.detail.score', { n: d.score })}`
  if (ev.code === 'address_corrected' && d.before != null) return `${base} · ${d.before} → ${d.after}`
  if ((ev.code === 'labeled' || ev.code === 'tracking_synced') && d.trackingNo) return `${base} · ${d.trackingNo}`
  if (ev.code === 'tagged' && d.tag) return `${base} · ${d.removed ? '-' : '+'}${d.tag}`
  if (ev.code === 'held' && d.rule) return `${base} · ${tx(d.rule)}`
  if (ev.code === 'cancelled' && d.reason) return `${base} · ${d.reason}`
  return base
}
const timeline = computed(() => [...(order.value?.timeline ?? [])].reverse())
const itemsTotal = computed(() => (order.value?.items ?? []).reduce((s, i) => s + i.qty * i.unitPrice, 0))

defineExpose({ reload: () => load(true), order })
</script>

<template>
  <div class="od" :class="'l-' + layout">
    <div v-if="loading" class="stack"><Skeleton variant="rect" :height="70" /><Skeleton variant="rect" :height="160" /><Skeleton variant="rect" :height="120" /></div>
    <EmptyState v-else-if="notFound" icon="search" :title="t('orders.detail.notFound')" :description="t('orders.detail.notFoundDesc', { id: orderId })" :action-label="t('orders.detail.backToList')" @action="router.push({ name: 'orders' })" />
    <template v-else-if="order">
      <!-- summary -->
      <section class="summary">
        <div class="sum-main">
          <ChannelLogo :code="order.channel" :size="36" />
          <div class="sum-titles">
            <div class="sum-id mono">{{ order.id }} <CopyButton :text="order.id" size="xs" /></div>
            <div class="muted small">{{ t('orders.channels.' + order.channel) }} · <span class="mono">{{ order.channelOrderNo }}</span> · <DateTime :value="order.createdAt" mode="absolute" /></div>
          </div>
          <StatusPill :status="order.status" />
        </div>
        <div class="sum-kpis">
          <div><span class="muted small">{{ t('orders.detail.total') }}</span><Money :value="order.total ?? itemsTotal" /></div>
          <div><span class="muted small">{{ t('orders.cols.score') }}</span><ScoreBadge :score="check?.score ?? null" size="sm" show-label /></div>
          <div><span class="muted small">{{ t('orders.detail.items') }}</span><span class="mono">{{ order.items.reduce((s, i) => s + i.qty, 0) }}</span></div>
        </div>
        <div class="sum-actions">
          <button v-if="shippable" class="btn btn-primary btn-sm" :disabled="!canShip" :title="!canShip ? t('common.noPermission') : ''" @click="createShipment"><Icon name="printer" :size="13" />{{ t('orders.actions.createShipment') }}</button>
          <RouterLink v-if="liveShipment" class="btn btn-soft btn-sm" :to="{ name: 'shipment-detail', params: { id: liveShipment.id } }"><Icon name="box" :size="13" />{{ liveShipment.id }}</RouterLink>
          <button v-if="['awaiting_shipment', 'on_hold'].includes(order.status)" class="btn btn-ghost btn-sm" :disabled="!canManage || busy === 'hold'" :title="!canManage ? t('common.noPermission') : ''" @click="toggleHold">
            <Icon :name="order.status === 'on_hold' ? 'play' : 'pause'" :size="13" />{{ order.status === 'on_hold' ? t('orders.actions.release') : t('orders.actions.hold') }}
          </button>
          <button v-if="isMarketplace" class="btn btn-ghost btn-sm" @click="mpOpen = true"><Icon name="external" :size="13" />{{ t('orders.actions.openMarketplace') }}</button>
          <button v-if="!['cancelled', 'delivered', 'shipped'].includes(order.status)" class="btn btn-ghost btn-sm danger-text" :disabled="!canManage || busy === 'cancel'" :title="!canManage ? t('common.noPermission') : ''" @click="cancel">
            <Icon name="x-circle" :size="13" />{{ t('orders.actions.cancel') }}
          </button>
        </div>
        <div v-if="order.status === 'on_hold' && order.holdReason" class="callout warn"><Icon name="pause" :size="15" /><span><strong>{{ t('orders.detail.holdReason') }}</strong> {{ tx(order.holdReason) }}</span></div>
        <div v-if="order.storeDisconnected" class="callout neutral"><Icon name="link" :size="15" />{{ t('orders.detail.storeDisconnected') }}</div>
      </section>

      <div class="cols">
        <!-- address -->
        <section class="card-s">
          <header class="cs-head">
            <h3>{{ t('orders.detail.address') }}</h3>
            <div class="cs-tools">
              <button class="btn btn-ghost btn-xs" :disabled="busy === 'revalidate'" @click="revalidate"><Icon name="refresh" :size="12" />{{ t('orders.detail.revalidate') }}</button>
              <button v-if="!['shipped', 'delivered', 'cancelled'].includes(order.status)" class="btn btn-ghost btn-xs" :disabled="!canManage" @click="openAddress"><Icon name="edit" :size="12" />{{ t('common.edit') }}</button>
            </div>
          </header>
          <div class="addr">
            <div class="strong">{{ order.shipTo.name }}</div>
            <div v-if="order.shipTo.company">{{ order.shipTo.company }}</div>
            <div>{{ order.shipTo.line1 }}<template v-if="order.shipTo.line2">, {{ order.shipTo.line2 }}</template></div>
            <div>{{ order.shipTo.city }}, {{ order.shipTo.state }} {{ order.shipTo.zip }} · {{ order.shipTo.country }}</div>
            <div class="muted small">{{ order.shipTo.residential === false ? t('orders.detail.business') : t('orders.detail.residential') }}</div>
          </div>
          <div class="score-row">
            <ScoreBadge :score="check?.score ?? null" show-label />
            <span class="muted small">{{ t('orders.detail.model', { v: check?.modelVersion ?? '-' }) }}<template v-if="check?.checkedAt"> · <DateTime :value="check.checkedAt" /></template></span>
          </div>
          <ul v-if="check?.issues?.length" class="issues">
            <li v-for="(i, k) in check.issues" :key="k" :class="'sev-' + (i.severity ?? 'warning')"><Icon :name="i.severity === 'error' ? 'x-circle' : 'alert'" :size="13" />{{ issueText(i) }}</li>
          </ul>
          <div v-else-if="check" class="ok-line"><Icon name="check-circle" :size="13" />{{ t('orders.detail.noIssues') }}</div>
          <div v-if="suggestion" class="sugg">
            <div class="sugg-head"><span class="badge-ai"><Icon name="spark" :size="10" />AI</span>{{ t('orders.detail.suggestion') }}
              <span v-if="suggestion.confidence" class="muted small mono">{{ t('orders.detail.confidence', { n: Math.round(suggestion.confidence * 100) }) }}</span></div>
            <div class="sugg-addr">
              <span :class="{ hl: suggestion.keys.includes('line1') }">{{ suggestion.merged.line1 }}</span><template v-if="suggestion.merged.line2">, <span :class="{ hl: suggestion.keys.includes('line2') }">{{ suggestion.merged.line2 }}</span></template>,
              <span :class="{ hl: suggestion.keys.includes('city') }">{{ suggestion.merged.city }}</span>,
              <span :class="{ hl: suggestion.keys.includes('state') }">{{ suggestion.merged.state }}</span>
              <span :class="{ hl: suggestion.keys.includes('zip') }">{{ suggestion.merged.zip }}</span>
            </div>
            <button class="btn btn-accent btn-sm" :disabled="!canManage || busy === 'apply' || ['shipped', 'delivered', 'cancelled'].includes(order.status)" @click="applySuggestion">
              <span v-if="busy === 'apply'" class="spin" /><Icon v-else name="wand" :size="13" />{{ t('orders.detail.applySuggestion') }}
            </button>
          </div>
        </section>

        <!-- customer + package -->
        <section class="card-s">
          <header class="cs-head"><h3>{{ t('orders.detail.customer') }}</h3></header>
          <dl class="kv">
            <dt>{{ t('orders.detail.name') }}</dt><dd>{{ order.customer?.name || '-' }}</dd>
            <dt>{{ t('orders.detail.email') }}</dt><dd class="truncate">{{ order.customer?.email || '-' }}</dd>
            <dt>{{ t('orders.detail.phone') }}</dt><dd>{{ order.customer?.phone || '-' }}</dd>
            <dt>{{ t('orders.detail.tags') }}</dt><dd><span v-for="tg in order.tags" :key="tg" class="tag">{{ tg }}</span><span v-if="!order.tags?.length">-</span></dd>
          </dl>
          <header class="cs-head mt">
            <h3>{{ t('orders.detail.package') }}</h3>
            <button v-if="!['shipped', 'delivered', 'cancelled'].includes(order.status)" class="btn btn-ghost btn-xs" :disabled="!canManage" @click="openPackage"><Icon name="edit" :size="12" />{{ t('common.edit') }}</button>
          </header>
          <dl v-if="order.package" class="kv">
            <dt>{{ t('orders.detail.dims') }}</dt><dd class="mono">{{ fmt.dims(order.package) }}</dd>
            <dt>{{ t('orders.detail.weight') }}</dt><dd><Weight :lb="order.package.weightLb" /></dd>
            <dt>{{ t('orders.detail.source') }}</dt><dd>{{ order.packageEstimated ? t('orders.detail.estimated') : t('orders.detail.measured') }}</dd>
          </dl>
          <div v-else class="muted">-</div>
          <template v-if="liveShipment">
            <header class="cs-head mt"><h3>{{ t('orders.detail.shipment') }}</h3></header>
            <RouterLink class="ship-link" :to="{ name: 'shipment-detail', params: { id: liveShipment.id } }">
              <CarrierLogo :code="liveShipment.carrier" :size="26" show-name :sub="serviceName(liveShipment.carrier, liveShipment.service)" />
              <span class="mono small">{{ liveShipment.trackingNo }}</span>
              <StatusPill :status="liveShipment.status" size="sm" />
            </RouterLink>
          </template>
        </section>
      </div>

      <!-- items -->
      <section class="card-s">
        <header class="cs-head"><h3>{{ t('orders.detail.itemsTitle') }}</h3></header>
        <div class="table-wrap">
          <table class="table-simple">
            <thead><tr><th>{{ t('orders.detail.product') }}</th><th>SKU</th><th class="r">{{ t('orders.detail.qty') }}</th><th class="r">{{ t('orders.detail.unitPrice') }}</th><th>{{ t('orders.detail.hs') }}</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in order.items" :key="i">
                <td>{{ it.title }}</td>
                <td class="mono small">{{ it.sku || '-' }}</td>
                <td class="r mono">{{ it.qty }}</td>
                <td class="r"><Money :value="it.unitPrice" /></td>
                <td>
                  <span v-if="it.hsCode" class="mono">{{ it.hsCode }}</span>
                  <button v-else class="btn btn-soft btn-xs" :disabled="!canManage" @click="openHs(i)"><Icon name="spark" :size="11" />{{ t('orders.detail.getHs') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- timeline -->
      <section class="card-s">
        <header class="cs-head"><h3>{{ t('orders.detail.timeline') }}</h3></header>
        <ol class="tl">
          <li v-for="(ev, i) in timeline" :key="i" :class="'c-' + ev.code">
            <span class="dot" />
            <div class="tl-body"><div class="tl-text">{{ timelineText(ev) }}</div><div class="muted xs"><DateTime :value="ev.at" mode="absolute" /></div></div>
          </li>
        </ol>
      </section>
    </template>

    <Modal v-model:open="mpOpen" :title="t('orders.marketplace.title')" size="sm">
      <div class="mp">
        <ChannelLogo v-if="order" :code="order.channel" :size="40" />
        <p>{{ t('orders.marketplace.body') }}</p>
        <div v-if="mpUrl" class="mp-url mono">{{ mpUrl }}</div>
      </div>
      <template #footer>
        <CopyButton v-if="mpUrl" :text="mpUrl" variant="button" :label="t('orders.marketplace.copy')" />
        <button class="btn btn-primary" @click="mpOpen = false">{{ t('common.close') }}</button>
      </template>
    </Modal>

    <Modal v-model:open="addrOpen" :title="t('orders.detail.editAddress')" size="lg">
      <AddressForm ref="addrForm" v-model="addrDraft" :validator="validator" />
      <template #footer>
        <button class="btn btn-ghost" @click="addrOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="busy === 'address'" @click="saveAddress"><span v-if="busy === 'address'" class="spin" />{{ t('common.save') }}</button>
      </template>
    </Modal>

    <Modal v-model:open="pkgOpen" :title="t('orders.detail.editPackage')" size="md">
      <PackageForm ref="pkgForm" v-model="pkgDraft" />
      <template #footer>
        <button class="btn btn-ghost" @click="pkgOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="busy === 'package'" @click="savePackage"><span v-if="busy === 'package'" class="spin" />{{ t('common.save') }}</button>
      </template>
    </Modal>

    <HsSuggestModal v-model:open="hsOpen" :title="hsItem != null && order ? order.items[hsItem]?.title : ''" :busy="hsSaving" @select="applyHs" />
  </div>
</template>

<style scoped>
.od { display: flex; flex-direction: column; gap: 14px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.small { font-size: 12.5px; }
.xs { font-size: 11.5px; }
.strong { font-weight: 600; }
.mt { margin-top: 14px; }
.r { text-align: right; }
.summary { display: flex; flex-direction: column; gap: 12px; }
.sum-main { display: flex; align-items: center; gap: 12px; }
.sum-titles { flex: 1; min-width: 0; }
.sum-id { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 6px; }
.sum-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 10px 12px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); }
.sum-kpis > div { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.sum-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.danger-text { color: var(--danger); }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.l-drawer .cols { grid-template-columns: 1fr; }
.card-s { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 14px 16px; background: var(--surface); }
.l-page .card-s { box-shadow: var(--shadow-sm); border-radius: var(--r-lg); }
.cs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.cs-head h3 { margin: 0; font-size: 14px; font-family: var(--font-display); font-weight: 600; }
.cs-tools { display: flex; gap: 4px; }
.addr { font-size: 13.5px; line-height: 1.55; }
.score-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.issues { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
.issues li { display: flex; gap: 6px; align-items: flex-start; }
.issues :deep(svg) { margin-top: 2px; flex: none; }
.sev-error { color: var(--danger); }
.sev-warning, .sev-info { color: oklch(0.5 0.12 70); }
.ok-line { display: flex; gap: 6px; align-items: center; color: var(--success); font-size: 13px; margin-top: 10px; }
.sugg { margin-top: 12px; padding: 12px; border-radius: var(--r-md); background: var(--accent-soft); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.sugg-head { display: flex; gap: 8px; align-items: center; font-weight: 600; font-size: 13px; color: var(--accent-ink); flex-wrap: wrap; }
.sugg-addr { font-size: 13.5px; }
.hl { background: oklch(0.9 0.12 95); border-radius: 3px; padding: 0 2px; font-weight: 600; }
.ship-link { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line-1); flex-wrap: wrap; color: var(--ink-1); }
.ship-link:hover { background: var(--bg-2); }
.tl { list-style: none; margin: 0; padding: 0; }
.tl li { position: relative; display: flex; gap: 12px; padding: 0 0 12px 0; }
.tl li:not(:last-child)::before { content: ''; position: absolute; left: 4px; top: 14px; bottom: 0; width: 1px; background: var(--line-2); }
.tl .dot { width: 9px; height: 9px; border-radius: 999px; background: var(--ink-4); margin-top: 5px; flex: none; }
.tl li:first-child .dot { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tl .c-cancelled .dot, .tl .c-label_voided .dot { background: var(--danger); }
.tl .c-delivered .dot { background: var(--success); }
.tl-text { font-size: 13.5px; }
.mp { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; }
.mp p { margin: 0; color: var(--ink-2); font-size: 13.5px; }
.mp-url { font-size: 11.5px; color: var(--ink-3); word-break: break-all; background: var(--bg-2); padding: 6px 8px; border-radius: 6px; }
.spin { width: 13px; height: 13px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } .sum-kpis { grid-template-columns: 1fr 1fr; } }
</style>
