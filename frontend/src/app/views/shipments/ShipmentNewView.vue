<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Stepper from '../../components/Stepper.vue'
import AddressForm from '../../components/AddressForm.vue'
import PackageForm, { billableWeightLb, dimWeightLb } from '../../components/PackageForm.vue'
import Toggle from '../../components/Toggle.vue'
import Slider from '../../components/Slider.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import ScoreBadge from '../../components/ScoreBadge.vue'
import Money from '../../components/Money.vue'
import Weight from '../../components/Weight.vue'
import CopyButton from '../../components/CopyButton.vue'
import TopUpModal from '../../components/billing/TopUpModal.vue'
import QuoteComparison from '../../components/compare/QuoteComparison.vue'
import { offersFromRateResult } from '../../api/compare.js'
import CustomsStep from '../../components/shipments/CustomsStep.vue'
import LabelPreview from '../../components/shipments/LabelPreview.vue'
import WhyPopover from '../../components/shipments/WhyPopover.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { session, can } from '../../store/session.js'
import { db } from '../../store/db.js'
import { zoneFor } from '@/shared/rateEngine.js'
import { getOrder } from '../../api/orders.js'
import { quoteShipment, rateShopNow, computeQuotes, findQuote } from '../../api/rates.js'
import { createShipment, saveDraft, getDraft, deleteDraft } from '../../api/shipments.js'
import { getWallet } from '../../api/wallet.js'
import { saveOptimizerWeight } from '../../components/shipments/prefsApi.js'
import { makeAddressValidator } from '../../components/orders/addressValidator.js'
import { apiErrorText, fieldErrorText, serviceName, hasKey } from '../../components/shipments/helpers.js'
import Dims from '../../components/Dims.vue'

const route = useRoute()
const router = useRouter()

// ------------------------------------------------------------------ state
const blankTo = () => ({ name: '', company: '', line1: '', line2: '', city: '', state: '', zip: '', country: 'US', phone: '', email: '', residential: true })
const data = ref({
  orderId: null,
  hub: session.user?.company?.defaultHub ?? 'NJ01',
  to: blankTo(),
  pkg: { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 2, preset: 'medium' },
  declaredValue: '',
  insured: null,
  signature: false,
  reference: '',
  quoteKey: null,
  customs: { contentType: 'merchandise', items: [] },
})
const order = ref(null)
const loading = ref(true)
const draftId = ref(null)
const draftSavedAt = ref(null)
const done = ref(null) // createShipment result
const units = computed(() => session.user?.preferences?.units ?? 'metric')

const international = computed(() => (data.value.to.country || 'US').toUpperCase() !== 'US')
const STEP_KEYS = computed(() => ['sender', 'recipient', 'package', 'rates', ...(international.value ? ['customs'] : []), 'payment'])
const steps = computed(() => STEP_KEYS.value.map(k => ({ key: k, label: t('shipments.steps.' + k) })))
const stepIndex = ref(0)
const maxReached = ref(0)
const stepKey = computed(() => STEP_KEYS.value[stepIndex.value])

// ------------------------------------------------------------------ hubs (step 1)
const hubs = computed(() => db.all('hubs').filter(h => h.type === 'us_hub' && h.active !== false))
const zones = computed(() => {
  const zip = String(data.value.to.zip || '')
  if (international.value || !/^\d{5}/.test(zip)) return null
  return Object.fromEntries(hubs.value.map(h => [h.code, zoneFor(h.code, zip)]))
})
const hubSuggestion = computed(() => {
  if (!zones.value) return null
  const [a, b] = hubs.value.map(h => h.code)
  const za = zones.value[a], zb = zones.value[b]
  const hub = za < zb ? a : zb < za ? b : (session.user?.company?.defaultHub ?? 'NJ01')
  return { hub, zones: zones.value, tie: za === zb }
})
const hubWhy = computed(() => {
  const s = hubSuggestion.value
  if (!s) return []
  const items = hubs.value.map(h => ({ label: `${h.code} → ${data.value.to.city || data.value.to.zip}`, value: t('shipments.hub.zone', { n: s.zones[h.code] }), weight: (9 - s.zones[h.code]) / 7 }))
  return [
    ...items,
    s.tie ? t('shipments.hub.whyTie', { hub: s.hub }) : t('shipments.hub.whyCloser', { hub: s.hub, zone: s.zones[s.hub] }),
  ]
})
function cutoffPassed(h) {
  const [hh, mm] = String(h.cutoff ?? '16:00').split(':').map(Number)
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() >= hh * 60 + (mm || 0) || [0, 6].includes(now.getDay())
}

// ------------------------------------------------------------------ recipient (step 2)
const addrForm = ref(null)
const addrResult = ref(null)
const validator = computed(() => makeAddressValidator({ orderId: data.value.orderId }))
const countries = computed(() => db.all('countries').filter(c => c.active !== false).map(c => ({ code: c.code, name: tx(c.name) })))
const countryFormat = computed(() => db.get('countries', data.value.to.country)?.addressFormat ?? null)
function onCountryChange() { data.value.quoteKey = null; rateResult.value = null }

// ------------------------------------------------------------------ package (step 3)
const pkgForm = ref(null)
const declaredError = ref('')
const declared = computed(() => Number(data.value.declaredValue) || 0)
const preview = computed(() => {
  // synchronous rules / insurance preview (no latency) once the destination is known
  const to = data.value.to
  if (!to.zip || (!international.value && !to.state)) return null
  try {
    return computeQuotes(rateInput(), undefined)
  } catch { return null }
})
const insuranceLocked = computed(() => !!preview.value?.insurance?.locked)
const insuredEffective = computed(() => insuranceLocked.value ? true : data.value.insured ?? declared.value > 100)
const signatureLocked = computed(() => !!preview.value?.signature?.lockedBy)
const signatureEffective = computed(() => signatureLocked.value || !!data.value.signature)

// ------------------------------------------------------------------ rates (step 4)
const prefWeight = session.user?.preferences?.optimizerWeight ?? 0.6
const speedPct = ref(Math.round((1 - prefWeight) * 100))
const weight = computed(() => Math.round((1 - speedPct.value / 100) * 100) / 100)
const sortMode = ref('ai')
const rateResult = ref(null)
const ratesLoading = ref(false)
const ratesError = ref('')
function rateInput() {
  const d = data.value
  return {
    hub: d.hub,
    to: { ...d.to },
    pkg: { lengthIn: +d.pkg.lengthIn, widthIn: +d.pkg.widthIn, heightIn: +d.pkg.heightIn, weightLb: +d.pkg.weightLb },
    declaredValue: declared.value,
    insured: d.insured == null ? undefined : d.insured,
    signature: !!d.signature,
    orderContext: order.value ? { order: order.value } : { items: d.customs.items.map(i => ({ qty: +i.qty, unitPrice: +i.unitValue })) },
    addressCheck: addrResult.value?.raw ?? order.value?.addressCheck ?? null,
    weight: weight.value,
  }
}
async function loadRates() {
  ratesLoading.value = true
  ratesError.value = ''
  try {
    const r = await quoteShipment(rateInput())
    applyRates(r)
  } catch (e) {
    ratesError.value = e.code === 'VALIDATION' ? Object.entries(e.details ?? {}).map(([f, c]) => `${f}: ${fieldErrorText(c)}`).join(' · ') : apiErrorText(e)
  } finally { ratesLoading.value = false }
}
// Export from a US hub: Evri is the UK first-mile collection leg (spec 3.5), not an export service.
const FIRST_MILE_ONLY = ['EVRI']
function sanitizeIntl(r) {
  if (!international.value || !r?.quotes?.some(q => FIRST_MILE_ONLY.includes(q.carrierCode))) return r
  const quotes = r.quotes.filter(q => !FIRST_MILE_ONLY.includes(q.carrierCode)).map(q => ({ ...q, badges: [...(q.badges ?? [])] }))
  const has = k => quotes.some(q => q.key === k)
  const pick = (cmp, badge) => {
    const best = [...quotes].sort(cmp)[0]
    if (!best) return null
    for (const q of quotes) q.badges = q.badges.filter(b => b !== badge)
    best.badges.unshift(badge)
    return best.key
  }
  const out = { ...r, quotes, empty: !quotes.length }
  if (!has(r.cheapestKey)) out.cheapestKey = pick((a, b) => a.total - b.total, 'cheapest')
  if (!has(r.fastestKey)) out.fastestKey = pick((a, b) => (a.etaDays ?? 99) - (b.etaDays ?? 99) || a.total - b.total, 'fastest')
  if (!has(r.aiPickKey)) { out.aiPickKey = pick((a, b) => (b.aiScore?.score ?? 0) - (a.aiScore?.score ?? 0), 'ai'); out.aiSavingsVsDefault = 0 }
  return out
}
function applyRates(raw) {
  const r = sanitizeIntl(raw)
  const prevAi = rateResult.value?.aiPickKey
  rateResult.value = r
  if (r.hub !== data.value.hub && r.hubAssignedBy) data.value.hub = r.hub
  const keep = data.value.quoteKey && findQuote(r, data.value.quoteKey)
  // follow the AI pick while the user has not chosen another service
  if (!keep || data.value.quoteKey === prevAi) data.value.quoteKey = r.aiPickKey ?? r.cheapestKey ?? r.quotes[0]?.key ?? null
}
let slideTimer = null
watch(speedPct, () => {
  if (stepKey.value !== 'rates' || !rateResult.value) return
  clearTimeout(slideTimer)
  slideTimer = setTimeout(async () => {
    try { applyRates(await rateShopNow(rateInput())) } catch {}
  }, 90)
})
async function persistWeight() {
  try { await saveOptimizerWeight(weight.value); toast.info(t('shipments.rates.prefSaved'), { duration: 2000 }) } catch (e) { toast.error(apiErrorText(e)) }
}
const selectedQuote = computed(() => (rateResult.value ? findQuote(rateResult.value, data.value.quoteKey) : null))
const ruleNotes = computed(() => (rateResult.value?.rules?.notes ?? []).map(n => {
  const k = 'core.ruleNotes.' + n.code
  return hasKey(k) ? t(k, { rule: tx(n.ruleName), carrier: n.carrier ?? '', service: n.service ?? '', value: n.value ?? '' }) : tx(n.ruleName)
}))

// ------------------------------------------------------------------ customs (step 5)
const customsRef = ref(null)
const customsTotal = computed(() => data.value.customs.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitValue) || 0), 0))
watch(international, v => {
  if (v && !data.value.customs.items.length) {
    const src = order.value?.items ?? []
    data.value.customs.items = src.length
      ? src.map(i => ({ description: i.title, qty: i.qty, unitValue: i.unitPrice, hsCode: i.hsCode ?? '', origin: 'TR', weightLb: i.weightLb ?? '' }))
      : [{ description: '', qty: 1, unitValue: declared.value || '', hsCode: '', origin: 'TR', weightLb: '' }]
  }
})

// ------------------------------------------------------------------ payment (step 6)
const wallet = ref(null)
const topupOpen = ref(false)
const paying = ref(false)
async function loadWallet() { try { wallet.value = await getWallet() } catch (e) { toast.error(apiErrorText(e)) } }
const charge = computed(() => selectedQuote.value?.walletCharge ?? selectedQuote.value?.total ?? 0)
const after = computed(() => (wallet.value ? wallet.value.balance - charge.value : null))
const auto = computed(() => wallet.value?.autoTopup ?? null)
const autoCard = computed(() => (wallet.value?.cards ?? []).find(c => c.id === auto.value?.cardId) ?? (wallet.value?.cards ?? []).find(c => c.isDefault))
const autoWillTrigger = computed(() => !!(auto.value?.enabled && autoCard.value && after.value != null && after.value < (auto.value.threshold ?? 0)))
const autoAmount = computed(() => {
  if (!autoWillTrigger.value) return 0
  const need = Math.max(0, (auto.value.threshold ?? 0) - after.value)
  const n = Math.max(1, Math.ceil(need / auto.value.amount))
  return n * auto.value.amount
})
const insufficient = computed(() => after.value != null && after.value < 0 && !autoWillTrigger.value)
const topupPreset = computed(() => Math.max(25, Math.ceil((charge.value - (wallet.value?.balance ?? 0)) / 25) * 25))
const breakdown = computed(() => {
  const q = selectedQuote.value
  if (!q) return []
  const out = [{ k: 'base', v: q.base }, { k: 'fuel', v: q.fuel }]
  if (q.residential) out.push({ k: 'residential', v: q.residential })
  if (q.source === 'own') { out.push({ k: 'carrier_charge', v: q.carrierCharge }); out.push({ k: 'own_account_fee', v: q.platformFee ?? 0.05 }) }
  else out.push({ k: q.source === 'dynamic' ? 'dynamic' : 'markup', v: Math.round((q.sellPrice - q.cost) * 100) / 100 })
  if (q.signatureFee) out.push({ k: 'signature', v: q.signatureFee })
  if (q.insurance) out.push({ k: 'insurance', v: q.insurance })
  return out.filter(x => x.v != null && (x.k !== 'base' || q.source !== 'own'))
})

// ------------------------------------------------------------------ navigation
function canNavigate(i) { return i <= maxReached.value && i !== stepIndex.value && !done.value }
async function goTo(i) {
  stepIndex.value = Math.max(0, Math.min(i, STEP_KEYS.value.length - 1))
  maxReached.value = Math.max(maxReached.value, stepIndex.value)
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  onEnter(stepKey.value)
}
function onEnter(k) {
  if (k === 'rates') loadRates()
  if (k === 'payment') { loadWallet(); if (!rateResult.value) loadRates() }
}
async function next() {
  const k = stepKey.value
  if (k === 'recipient') {
    if (!addrForm.value?.validate()) { addrForm.value?.focus?.(); return }
    const score = addrResult.value?.score
    if (score != null && score < 70) {
      const ok = await confirm({ title: t('shipments.recipient.lowTitle', { n: score }), message: t('shipments.recipient.lowMsg'), confirmLabel: t('shipments.recipient.continueAnyway') })
      if (!ok) return
    }
  }
  if (k === 'package') {
    if (pkgForm.value && !pkgForm.value.validate()) return
    if (data.value.declaredValue !== '' && !(Number(data.value.declaredValue) >= 0)) { declaredError.value = t('common.validation.number'); return }
  }
  if (k === 'rates') {
    if (!selectedQuote.value) { toast.warning(t('shipments.rates.pick')); return }
  }
  if (k === 'customs' && !customsRef.value?.validate()) return
  // invalidate quotes when inputs before the rate step change
  goTo(stepIndex.value + 1)
}
function back() { if (stepIndex.value > 0) goTo(stepIndex.value - 1) }

// Changing inputs of earlier steps resets the quote list.
watch(() => [data.value.hub, data.value.to.zip, data.value.to.state, data.value.to.country, data.value.to.residential, data.value.pkg.lengthIn, data.value.pkg.widthIn, data.value.pkg.heightIn, data.value.pkg.weightLb, data.value.declaredValue, data.value.insured, data.value.signature].join('|'), () => {
  if (stepKey.value !== 'rates' && stepKey.value !== 'payment') rateResult.value = null
})

// ------------------------------------------------------------------ pay
async function pay(extra = {}) {
  if (!selectedQuote.value) { goTo(STEP_KEYS.value.indexOf('rates')); return }
  if (insufficient.value && !extra.force) { topupOpen.value = true; return }
  paying.value = true
  try {
    const d = data.value
    const r = await createShipment({
      orderId: d.orderId, hub: d.hub, to: { ...d.to }, pkg: rateInput().pkg, declaredValue: declared.value || (international.value ? Math.round(customsTotal.value * 100) / 100 : 0),
      insured: d.insured == null ? undefined : d.insured, signature: !!d.signature, quoteKey: d.quoteKey, weight: weight.value,
      reference: d.reference || undefined, draftId: draftId.value, items: order.value?.items ?? undefined,
      customs: international.value ? { ...d.customs, total: customsTotal.value, form: customsTotal.value <= 400 ? 'cn22' : 'cn23' } : undefined,
      ...extra,
    })
    clearTimeout(draftTimer)
    draftId.value = null
    done.value = r
    toast.success(t('shipments.success.toast', { id: r.shipment.id, amount: fmt.money(r.shipment.walletCharge) }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e) {
    if (e.code === 'INSUFFICIENT_FUNDS') { await loadWallet(); topupOpen.value = true }
    else if (e.code === 'ORDER_ON_HOLD' || e.code === 'RULE_HOLD') {
      const ok = await confirm({ title: t('shipments.pay.heldTitle'), message: e.code === 'RULE_HOLD' ? t('shipments.pay.ruleHoldMsg', { rule: tx(e.details?.rule) }) : t('shipments.pay.heldMsg'), confirmLabel: t('shipments.pay.heldConfirm') })
      if (ok) { paying.value = false; return pay({ ...extra, allowHeld: true }) }
    } else if (e.code === 'QUOTE_UNAVAILABLE') {
      toast.warning(apiErrorText(e))
      goTo(STEP_KEYS.value.indexOf('rates'))
    } else if (e.code === 'ORDER_ALREADY_LABELED') {
      toast.error(apiErrorText(e))
      if (e.details?.shipmentId) router.push({ name: 'shipment-detail', params: { id: e.details.shipmentId } })
    } else toast.error(apiErrorText(e))
  } finally { paying.value = false }
}
async function onTopupDone() { await loadWallet(); toast.success(t('shipments.pay.toppedUp')) }

// ------------------------------------------------------------------ drafts
let draftTimer = null
const draftable = computed(() => !done.value && !loading.value && (data.value.orderId || data.value.to.line1 || data.value.to.name))
watch(() => [JSON.stringify(data.value), stepIndex.value], () => {
  if (!draftable.value) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(saveDraftNow, 900)
})
async function saveDraftNow() {
  if (!draftable.value) return
  try {
    const q = selectedQuote.value
    const d = await saveDraft({
      id: draftId.value, orderId: data.value.orderId, step: stepIndex.value,
      data: { ...data.value, quote: q ? { carrierCode: q.carrierCode, serviceCode: q.serviceCode, total: q.total } : null, speedPct: speedPct.value },
    })
    draftId.value = d.id
    draftSavedAt.value = d.updatedAt
  } catch {}
}
async function discardDraft() {
  const ok = await confirm({ title: t('shipments.draft.discardTitle'), message: t('shipments.draft.discardMsg'), confirmLabel: t('shipments.draft.discard'), danger: true })
  if (!ok) return
  clearTimeout(draftTimer)
  if (draftId.value) { try { await deleteDraft(draftId.value) } catch {} }
  draftId.value = null
  toast.info(t('shipments.draft.discarded'))
  router.push({ name: 'shipments', query: { tab: 'drafts' } })
}
async function saveAndExit() {
  await saveDraftNow()
  toast.success(t('shipments.draft.saved'))
  router.push({ name: 'shipments', query: { tab: 'drafts' } })
}
onBeforeRouteLeave(() => { if (draftable.value) { clearTimeout(draftTimer); saveDraftNow() } })
onBeforeUnmount(() => { clearTimeout(draftTimer); clearTimeout(slideTimer) })

// ------------------------------------------------------------------ init
async function init() {
  loading.value = true
  done.value = null
  try {
    if (typeof route.query.draft === 'string') {
      const d = await getDraft(route.query.draft)
      draftId.value = d.id
      const { quote, speedPct: sp, ...rest } = d.data ?? {}
      data.value = { ...data.value, ...rest, to: { ...blankTo(), ...(rest.to ?? {}) }, customs: rest.customs ?? { contentType: 'merchandise', items: [] } }
      if (sp != null) speedPct.value = sp
      if (data.value.orderId) { try { order.value = await getOrder(data.value.orderId) } catch { order.value = null } }
      stepIndex.value = Math.min(d.step ?? 0, STEP_KEYS.value.length - 1)
      maxReached.value = stepIndex.value
      draftSavedAt.value = d.updatedAt
      toast.info(t('shipments.draft.resumed', { id: d.id }))
    } else if (typeof route.query.orderId === 'string') {
      const o = await getOrder(route.query.orderId)
      order.value = o
      const items = o.items ?? []
      data.value = {
        ...data.value,
        orderId: o.id,
        to: { ...blankTo(), ...o.shipTo, email: o.customer?.email ?? '', phone: o.customer?.phone ?? '' },
        pkg: o.package ? { ...o.package, preset: 'custom' } : data.value.pkg,
        declaredValue: Math.round(items.reduce((s, i) => s + i.unitPrice * i.qty, 0) * 100) / 100 || '',
        reference: o.channelOrderNo ?? '',
      }
      addrResult.value = o.addressCheck ? { score: o.addressCheck.score, raw: o.addressCheck } : null
      // go straight to the sender step with everything prefilled
      maxReached.value = 2
    }
  } catch (e) {
    toast.error(apiErrorText(e))
  } finally {
    loading.value = false
    onEnter(stepKey.value)
  }
}
onMounted(init)
watch(() => [route.query.orderId, route.query.draft], (n, o) => { if (String(n) !== String(o) && route.name === 'shipment-new') { resetAll(); init() } })

function resetAll() {
  data.value = { orderId: null, hub: session.user?.company?.defaultHub ?? 'NJ01', to: blankTo(), pkg: { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 2, preset: 'medium' }, declaredValue: '', insured: null, signature: false, reference: '', quoteKey: null, customs: { contentType: 'merchandise', items: [] } }
  order.value = null; rateResult.value = null; addrResult.value = null; draftId.value = null; draftSavedAt.value = null; done.value = null
  stepIndex.value = 0; maxReached.value = 0
}
function newShipment() {
  resetAll()
  if (route.query.orderId || route.query.draft) router.replace({ name: 'shipment-new' })
  window.scrollTo({ top: 0 })
}

const orderBlocked = computed(() => order.value && (order.value.status === 'cancelled' || (order.value.shipmentId && order.value.shipment?.status !== 'voided')))

// ------------------------------------------------------------------ success helpers
async function downloadPdf() {
  const d = await import('../../docs/index.js')
  d.downloadLabel(done.value.shipment)
}
function printLabel() { window.print() }
function copyTrack() { return `${location.origin}${location.pathname}#/track/${done.value.shipment.trackingNo}` }

const summaryRows = computed(() => {
  const d = data.value
  const h = hubs.value.find(x => x.code === d.hub)
  return {
    hub: h ? `${h.code} · ${h.address?.city}, ${h.address?.state}` : d.hub,
    to: d.to.name ? `${d.to.name}` : '-',
    toCity: d.to.city ? `${d.to.city}, ${d.to.state || d.to.country} ${d.to.zip}` : '',
    billable: billableWeightLb(d.pkg, 139),
    dim: dimWeightLb(d.pkg, 139),
  }
})
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.shipmentNew')" :subtitle="order ? t('shipments.new.fromOrder', { id: order.id, channel: t('orders.channels.' + order.channel) }) : t('shipments.new.subtitle')">
      <template #actions>
        <span v-if="draftSavedAt && !done" class="draft-note muted"><Icon name="check" :size="12" />{{ t('shipments.draft.autosaved', { time: fmt.dateTime(draftSavedAt) }) }}</span>
        <template v-if="!done">
          <button v-if="draftId" class="btn btn-ghost" @click="discardDraft"><Icon name="trash" :size="14" />{{ t('shipments.draft.discard') }}</button>
          <button class="btn btn-ghost" :disabled="!draftable" @click="saveAndExit"><Icon name="file" :size="14" />{{ t('shipments.draft.saveExit') }}</button>
        </template>
      </template>
    </PageHeader>

    <div v-if="!can('shipments.create')" class="callout danger mb"><Icon name="lock" :size="15" />{{ t('common.noPermission') }}</div>

    <!-- ================= success ================= -->
    <section v-if="done" data-testid="shipment-success" class="success panel">
      <div class="succ-main">
        <div class="succ-head">
          <span class="succ-ic"><Icon name="check" :size="22" /></span>
          <div>
            <h2 class="succ-title">{{ t('shipments.success.title') }}</h2>
            <p class="muted">{{ t('shipments.success.sub', { id: done.shipment.id, carrier: serviceName(done.shipment.carrier, done.shipment.service) }) }}</p>
          </div>
        </div>
        <div class="track-box">
          <div class="muted small">{{ t('shipments.success.tracking') }}</div>
          <div class="track-row"><span class="mono track-no">{{ done.shipment.trackingNo }}</span><CopyButton :text="done.shipment.trackingNo" variant="button" /></div>
        </div>
        <div class="succ-actions">
          <button class="btn btn-primary" @click="downloadPdf"><Icon name="download" :size="14" />{{ t('common.downloadPdf') }}</button>
          <button class="btn btn-ghost" @click="printLabel"><Icon name="printer" :size="14" />{{ t('common.print') }}</button>
          <CopyButton :text="copyTrack()" variant="button" :label="t('shipments.success.shareTracking')" />
          <RouterLink class="btn btn-ghost" :to="{ name: 'shipment-detail', params: { id: done.shipment.id } }"><Icon name="eye" :size="14" />{{ t('shipments.success.viewShipment') }}</RouterLink>
        </div>
        <ul class="chain">
          <li v-if="done.order"><Icon name="check-circle" :size="14" />{{ t('shipments.success.chain.order', { id: done.order.id }) }}</li>
          <li><Icon name="check-circle" :size="14" />{{ t('shipments.success.chain.shipment', { id: done.shipment.id }) }}</li>
          <li v-if="done.transaction"><Icon name="check-circle" :size="14" />{{ t('shipments.success.chain.wallet', { amount: fmt.money(done.shipment.walletCharge), balance: fmt.money(done.balance) }) }}</li>
          <li v-if="done.topup"><Icon name="wallet" :size="14" />{{ t('shipments.success.chain.topup', { amount: fmt.money(done.topup.amount) }) }}</li>
          <li v-if="done.order && !['manual', 'api'].includes(done.order.channel)"><Icon name="sync" :size="14" />{{ t('shipments.success.chain.writeBack', { channel: t('orders.channels.' + done.order.channel) }) }}</li>
          <li><Icon name="bell" :size="14" />{{ t('shipments.success.chain.notify') }}</li>
        </ul>
        <div class="succ-foot">
          <button class="btn btn-accent" @click="newShipment"><Icon name="plus" :size="14" />{{ t('shipments.success.new') }}</button>
          <RouterLink class="btn btn-ghost" :to="{ name: 'orders' }"><Icon name="list" :size="14" />{{ t('shipments.success.backOrders') }}</RouterLink>
        </div>
      </div>
      <div class="succ-label">
        <LabelPreview :shipment="done.shipment" :width="300" printable />
        <div class="muted xs center">{{ t('shipments.success.labelNote') }}</div>
      </div>
    </section>

    <!-- ================= wizard ================= -->
    <div v-else class="layout">
      <div class="main">
        <Stepper v-model:current="stepIndex" :steps="steps" :max-reached="maxReached" :can-navigate="canNavigate" @navigate="goTo" />

        <div v-if="order && orderBlocked" class="callout danger mt">
          <Icon name="alert" :size="15" />
          <span>{{ order.status === 'cancelled' ? t('shipments.new.orderCancelled', { id: order.id }) : t('shipments.new.orderLabeled', { id: order.id }) }}
            <RouterLink v-if="order.shipmentId" class="link" :to="{ name: 'shipment-detail', params: { id: order.shipmentId } }">{{ order.shipmentId }}</RouterLink></span>
        </div>
        <div v-else-if="order?.status === 'on_hold'" class="callout warn mt"><Icon name="pause" :size="15" />{{ t('shipments.new.orderHeld', { reason: tx(order.holdReason) }) }}</div>

        <section class="panel step-card">
          <div v-if="loading" class="pad"><Skeleton :lines="6" /></div>
          <template v-else>
            <header class="step-head">
              <h2>{{ t('shipments.titles.' + stepKey) }}</h2>
              <p class="muted">{{ t('shipments.subs.' + stepKey) }}</p>
            </header>
            <div class="pad">
              <!-- 1. sender -->
              <template v-if="stepKey === 'sender'">
                <div class="hubs" role="radiogroup" :aria-label="t('shipments.steps.sender')">
                  <label v-for="h in hubs" :key="h.code" :data-testid="'shipment-hub-' + h.code" class="hub" :class="{ on: data.hub === h.code }">
                    <input v-model="data.hub" type="radio" name="hub" :value="h.code" />
                    <div class="hub-top">
                      <span class="hub-code mono">{{ h.code }}</span>
                      <span v-if="hubSuggestion?.hub === h.code" class="badge-ai"><Icon name="spark" :size="10" />{{ t('common.aiPick') }}</span>
                      <span v-if="(session.user?.company?.defaultHub ?? 'NJ01') === h.code" class="tag">{{ t('shipments.hub.default') }}</span>
                    </div>
                    <div class="hub-name">{{ tx(h.name) }}</div>
                    <div class="muted small">{{ h.address.line1 }}, {{ h.address.city }}, {{ h.address.state }} {{ h.address.zip }}</div>
                    <div class="hub-cut"><Icon name="clock" :size="12" />{{ cutoffPassed(h) ? t('shipments.hub.cutoffPassed', { time: h.cutoff }) : t('shipments.hub.cutoff', { time: h.cutoff }) }}</div>
                    <div class="hub-load">
                      <div class="spread small"><span>{{ t('shipments.hub.load') }}</span><span class="mono">{{ h.todayLoad }} / {{ h.capacityDaily }}</span></div>
                      <ProgressBar :value="Math.round((h.todayLoad / h.capacityDaily) * 100)" size="sm" :tone="h.todayLoad / h.capacityDaily > 0.85 ? 'warning' : 'accent'" />
                    </div>
                    <div v-if="zones" class="hub-zone muted small">{{ t('shipments.hub.zoneTo', { n: zones[h.code], city: data.to.city || data.to.zip }) }}</div>
                  </label>
                </div>
                <div v-if="hubSuggestion" class="ai-line">
                  <span class="badge-ai"><Icon name="spark" :size="10" />AI</span>
                  <span>{{ t('shipments.hub.suggest', { hub: hubSuggestion.hub }) }}</span>
                  <WhyPopover :title="t('shipments.hub.whyTitle')" :items="hubWhy" />
                  <button v-if="data.hub !== hubSuggestion.hub" class="btn btn-soft btn-xs" @click="data.hub = hubSuggestion.hub">{{ t('common.apply') }}</button>
                </div>
                <div v-else class="muted small">{{ t('shipments.hub.noDest') }}</div>
              </template>

              <!-- 2. recipient -->
              <template v-else-if="stepKey === 'recipient'">
                <AddressForm ref="addrForm" v-model="data.to" :validator="validator" :countries="countries" :format="countryFormat" :required-fields="['name']" @validated="r => (addrResult = r)" @country-change="onCountryChange" />
              </template>

              <!-- 3. package -->
              <template v-else-if="stepKey === 'package'">
                <PackageForm ref="pkgForm" v-model="data.pkg" :units="units" />
                <div class="form-grid mt">
                  <div>
                    <label class="field-label" for="sn-dv">{{ t('shipments.pkg.declared') }}</label>
                    <input id="sn-dv" v-model="data.declaredValue" type="number" min="0" step="0.01" class="input" :class="{ invalid: declaredError }" @input="declaredError = ''" />
                    <div v-if="declaredError" class="field-error">{{ declaredError }}</div>
                    <div v-else class="field-hint">{{ t('shipments.pkg.declaredHint') }}</div>
                  </div>
                  <div>
                    <label class="field-label" for="sn-ref">{{ t('shipments.pkg.reference') }}</label>
                    <input id="sn-ref" v-model="data.reference" class="input" :placeholder="t('shipments.pkg.referencePh')" />
                  </div>
                </div>
                <div class="toggles mt">
                  <div class="tg-row">
                    <Toggle :model-value="insuredEffective" :disabled="insuranceLocked" :label="t('shipments.pkg.insurance')" :description="insuranceLocked ? t('shipments.pkg.insuranceLocked', { rule: tx(preview?.insurance?.lockedBy) }) : t('shipments.pkg.insuranceHint', { amount: fmt.money(preview?.insurance?.amount ?? 0) })" @update:model-value="v => (data.insured = v)" />
                    <Icon v-if="insuranceLocked" name="lock" :size="14" class="muted" />
                  </div>
                  <div class="tg-row">
                    <Toggle :model-value="signatureEffective" :disabled="signatureLocked" :label="t('shipments.pkg.signature')" :description="signatureLocked ? t('shipments.pkg.signatureLocked', { rule: tx(preview?.signature?.lockedBy) }) : t('shipments.pkg.signatureHint', { amount: fmt.money(3.1) })" @update:model-value="v => (data.signature = v)" />
                    <Icon v-if="signatureLocked" name="lock" :size="14" class="muted" />
                  </div>
                </div>
                <div v-if="preview?.rules?.matched?.length" class="callout mt"><Icon name="flag" :size="15" />{{ t('shipments.pkg.rulesMatched', { names: preview.rules.matched.map(m => tx(m.name)).join(', ') }) }}</div>
              </template>

              <!-- 4. rates -->
              <template v-else-if="stepKey === 'rates'">
                <div class="rate-tools">
                  <div class="slider-wrap">
                    <Slider v-model="speedPct" :min="0" :max="100" :step="5" :label="t('shipments.rates.slider')" :left-label="t('shipments.rates.cost')" :right-label="t('shipments.rates.speed')"
                      :format="v => t('shipments.rates.sliderValue', { cost: 100 - v, speed: v })" @change="persistWeight" />
                  </div>
                  <SegmentedControl v-model="sortMode" size="sm" :options="[{ value: 'ai', label: t('shipments.rates.sort.ai'), icon: 'spark' }, { value: 'cheapest', label: t('shipments.rates.sort.cheapest') }, { value: 'fastest', label: t('shipments.rates.sort.fastest') }]" :aria-label="t('shipments.rates.sortLabel')" />
                </div>
                <div v-if="rateResult?.hubAssignedBy" class="callout mt"><Icon name="warehouse" :size="15" />{{ t('core.ruleNotes.hubAssigned', { rule: tx(rateResult.hubAssignedBy) }) }} ({{ rateResult.hub }})</div>
                <div v-if="ruleNotes.length" class="callout neutral mt"><Icon name="flag" :size="15" /><span>{{ ruleNotes.join(' · ') }}</span></div>
                <div v-if="ratesError" class="callout danger mt" role="alert"><Icon name="alert" :size="15" />{{ ratesError }} <button class="btn-link" @click="loadRates">{{ t('common.retry') }}</button></div>
                <div v-else-if="ratesLoading && !rateResult" class="stack mt"><Skeleton v-for="i in 5" :key="i" variant="rect" :height="62" /></div>
                <EmptyState v-else-if="rateResult?.empty" icon="truck" :title="t('shipments.rates.emptyTitle')" :description="t('shipments.rates.emptyDesc')" :action-label="t('shipments.rates.editAddress')" @action="goTo(1)" />
                <div v-else-if="rateResult" class="mt">
                  <div v-if="rateResult.ai?.source" class="ai-line">
                    <span class="badge-ai"><Icon name="spark" :size="10" />AI</span>
                    <span>{{ rateResult.aiSavingsVsDefault > 0 ? t('shipments.rates.aiSummary', { amount: fmt.money(rateResult.aiSavingsVsDefault) }) : t('shipments.rates.aiSummaryNo') }}</span>
                    <span class="muted small">{{ t('shipments.rates.zone', { zone: rateResult.zone, hub: rateResult.hub, n: rateResult.quotes.length }) }}</span>
                  </div>
                  <QuoteComparison v-model="data.quoteKey" :offers="offersFromRateResult(rateResult, { declaredValue: declared, crossBorder: international })" :recommended-key="rateResult.aiPickKey"
                    :sort="sortMode" hide-sort :loading="ratesLoading" :views="['card', 'table']"
                    :ai-reason="rateResult.ai?.reason ? tx(rateResult.ai.reason) : hasKey('core.aiReasons.' + rateResult.ai?.reasonCode) ? t('core.aiReasons.' + rateResult.ai.reasonCode) : ''" />
                </div>
              </template>

              <!-- 5. customs -->
              <template v-else-if="stepKey === 'customs'">
                <CustomsStep ref="customsRef" v-model="data.customs" :destination="countries.find(c => c.code === data.to.country)?.name ?? data.to.country" :dest-code="data.to.country" />
              </template>

              <!-- 6. payment -->
              <template v-else-if="stepKey === 'payment'">
                <div v-if="!selectedQuote" class="stack"><Skeleton v-for="i in 3" :key="i" variant="rect" :height="50" /></div>
                <template v-else>
                  <div class="pay-grid">
                    <div class="pay-card">
                      <div class="muted small">{{ t('shipments.pay.service') }}</div>
                      <CarrierLogo :code="selectedQuote.carrierCode" :size="30" show-name :sub="selectedQuote.serviceName" />
                      <div class="muted small mt-s">{{ t('shipments.rates.eta', { n: selectedQuote.etaDays }) }} · {{ fmt.date(selectedQuote.etaDate) }}</div>
                    </div>
                    <div class="pay-card">
                      <div class="muted small">{{ t('shipments.pay.balance') }}</div>
                      <div class="big mono"><Money v-if="wallet" :value="wallet.balance" /><Skeleton v-else :width="100" :height="24" variant="rect" /></div>
                      <div class="spread small mt-s"><span class="muted">{{ t('shipments.pay.after') }}</span><span class="mono" :class="{ 'text-danger': insufficient }"><Money v-if="after != null" :value="autoWillTrigger ? after + autoAmount : after" /></span></div>
                    </div>
                  </div>
                  <div v-if="autoWillTrigger" class="callout mt"><Icon name="wallet" :size="15" />{{ t('shipments.pay.auto', { amount: fmt.money(autoAmount), card: autoCard ? `${autoCard.brand?.toUpperCase?.() ?? ''} •••• ${autoCard.last4}` : '' }) }}</div>
                  <div v-else-if="insufficient" class="callout danger mt">
                    <Icon name="alert" :size="15" />
                    <span>{{ t('shipments.pay.insufficient', { need: fmt.money(charge - wallet.balance) }) }} <button class="btn-link" @click="topupOpen = true">{{ t('shipments.pay.topup') }}</button></span>
                  </div>
                  <table class="table-simple mt">
                    <tbody>
                      <tr v-for="b in breakdown" :key="b.k"><td>{{ t('core.breakdown.' + b.k) }}</td><td class="r"><Money :value="b.v" /></td></tr>
                      <tr class="tot"><td>{{ t('shipments.pay.total') }}</td><td class="r"><Money :value="selectedQuote.total" /></td></tr>
                      <tr v-if="selectedQuote.source === 'own'" class="muted"><td>{{ t('shipments.pay.walletCharge') }}</td><td class="r"><Money :value="charge" /></td></tr>
                    </tbody>
                  </table>
                  <div v-if="international" class="callout neutral mt"><Icon name="shield" :size="15" />{{ t('shipments.pay.customsNote', { form: customsTotal <= 400 ? 'CN22' : 'CN23', total: fmt.money(customsTotal) }) }}</div>
                </template>
              </template>
            </div>

            <footer class="foot">
              <button v-if="stepIndex > 0" class="btn btn-ghost" @click="back"><Icon name="chevron-left" :size="13" />{{ t('common.back') }}</button>
              <span v-else />
              <button v-if="stepKey !== 'payment'" data-testid="shipment-next" class="btn btn-primary" :disabled="(stepKey === 'rates' && (ratesLoading && !rateResult)) || orderBlocked" @click="next">{{ t('common.continue') }}<Icon name="arrow" :size="13" /></button>
              <button v-else data-testid="shipment-pay" class="btn btn-primary btn-lg" :disabled="paying || !selectedQuote || orderBlocked || !can('shipments.create')" @click="pay()">
                <span v-if="paying" class="spin" /><Icon v-else name="printer" :size="14" />{{ t('shipments.pay.cta', { amount: fmt.money(charge) }) }}
              </button>
            </footer>
          </template>
        </section>
      </div>

      <!-- live summary -->
      <aside class="side">
        <div class="panel summary">
          <div class="sum-head">{{ t('shipments.summary.title') }}</div>
          <div v-if="order" class="sum-row">
            <ChannelLogo :code="order.channel" :size="22" />
            <div><div class="mono strong">{{ order.id }}</div><div class="muted xs">{{ order.channelOrderNo }}</div></div>
          </div>
          <dl class="sum-kv">
            <dt>{{ t('shipments.summary.from') }}</dt><dd>{{ summaryRows.hub }}</dd>
            <dt>{{ t('shipments.summary.to') }}</dt><dd>{{ summaryRows.to }}<div v-if="summaryRows.toCity" class="muted xs">{{ summaryRows.toCity }}</div></dd>
            <dt>{{ t('shipments.summary.score') }}</dt><dd><ScoreBadge :score="addrResult?.score ?? null" size="sm" /></dd>
            <dt>{{ t('shipments.summary.package') }}</dt>
            <dd class="mono"><Dims :value="data.pkg" :units="units" /><div class="xs"><Weight :lb="+data.pkg.weightLb || 0" /> · {{ t('shipments.summary.billable', { n: summaryRows.billable }) }}</div></dd>
            <dt>{{ t('shipments.summary.service') }}</dt>
            <dd>
              <template v-if="selectedQuote">
                <div class="strong">{{ selectedQuote.serviceName }}</div>
                <div class="xs muted">{{ selectedQuote.source === 'own' ? t('core.badges.own') : selectedQuote.carrierName }} · {{ t('shipments.rates.eta', { n: selectedQuote.etaDays }) }}</div>
                <span v-if="selectedQuote.key === rateResult?.aiPickKey" class="badge-ai mt-s"><Icon name="spark" :size="9" />{{ t('common.aiPick') }}</span>
              </template>
              <span v-else>-</span>
            </dd>
            <template v-if="insuredEffective && preview?.insurance?.amount"><dt>{{ t('shipments.pkg.insurance') }}</dt><dd><Money :value="preview.insurance.amount" /></dd></template>
          </dl>
          <div class="sum-total">
            <span>{{ t('shipments.summary.total') }}</span>
            <strong><Money v-if="selectedQuote" :value="selectedQuote.total" /><span v-else>-</span></strong>
          </div>
          <div v-if="selectedQuote && rateResult?.defaultQuote && selectedQuote.total < rateResult.defaultQuote.total" class="sum-save">
            {{ t('shipments.summary.savings', { amount: fmt.money(rateResult.defaultQuote.total - selectedQuote.total) }) }}
          </div>
        </div>
      </aside>
    </div>

    <TopUpModal v-model:open="topupOpen" :preset-amount="topupPreset" :reason="t('shipments.pay.topupReason', { amount: fmt.money(charge) })" @done="onTopupDone" />
  </div>
</template>

<style scoped>
.mb { margin-bottom: 12px; }
.mt { margin-top: 14px; }
.mt-s { margin-top: 6px; }
.small { font-size: 12.5px; }
.xs { font-size: 11.5px; }
.strong { font-weight: 600; }
.center { text-align: center; }
.r { text-align: right; }
.draft-note { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; align-self: center; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.step-card { overflow: visible; }
.step-head { padding: 18px 22px 0; }
.step-head h2 { margin: 0; font-family: var(--font-display); font-size: 18px; font-weight: 600; }
.step-head p { margin: 4px 0 0; font-size: 13.5px; }
.pad { padding: 16px 22px 20px; }
.foot { display: flex; justify-content: space-between; gap: 10px; padding: 12px 22px; border-top: 1px solid var(--line-1); background: var(--bg); border-radius: 0 0 var(--r-lg) var(--r-lg); }
.stack { display: flex; flex-direction: column; gap: 8px; }
.hubs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.hub { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border: 1px solid var(--line-2); border-radius: var(--r-lg); cursor: pointer; background: var(--surface); transition: border-color .15s, box-shadow .15s; }
.hub input { position: absolute; opacity: 0; pointer-events: none; }
.hub:hover { border-color: var(--line-strong); }
.hub.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.hub:focus-within { box-shadow: 0 0 0 3px var(--accent-soft); }
.hub-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hub-code { font-weight: 700; font-size: 16px; }
.hub-name { font-weight: 600; font-size: 13.5px; }
.hub-cut { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-2); }
.hub-load { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.ai-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; font-size: 13.5px; padding: 10px 12px; border-radius: var(--r-md); background: var(--accent-soft); color: var(--accent-ink); }
.ai-line + .rl, .mt > .ai-line { margin-top: 0; margin-bottom: 10px; }
.toggles { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: var(--r-md); border: 1px solid var(--line-1); background: var(--bg); }
.tg-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.rate-tools { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; justify-content: space-between; }
.slider-wrap { flex: 1; min-width: 260px; max-width: 460px; }
.pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pay-card { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.big { font-size: 22px; font-weight: 600; }
.tot td { font-weight: 700; font-size: 15px; }
.side { position: sticky; top: calc(var(--kpz-sticky-top, 56px) + 16px); }
.summary { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.sum-head { font-family: var(--font-display); font-weight: 600; font-size: 15px; }
.sum-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; background: var(--bg-2); }
.sum-kv { display: grid; grid-template-columns: 90px 1fr; gap: 8px 10px; margin: 0; font-size: 13px; }
.sum-kv dt { color: var(--ink-3); }
.sum-kv dd { margin: 0; min-width: 0; }
.sum-total { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid var(--line-1); padding-top: 12px; font-size: 14px; }
.sum-total strong { font-size: 20px; }
.sum-save { font-size: 12.5px; padding: 8px 10px; border-radius: 8px; background: oklch(0.96 0.04 155); color: oklch(0.38 0.1 155); }
.success { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; padding: 24px; }
.succ-main { display: flex; flex-direction: column; gap: 16px; }
.succ-head { display: flex; gap: 14px; align-items: center; }
.succ-head p { margin: 2px 0 0; }
.succ-ic { width: 48px; height: 48px; border-radius: 999px; background: oklch(0.95 0.05 155); color: var(--success); display: grid; place-items: center; flex: none; }
.succ-title { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 600; }
.track-box { padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); }
.track-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.track-no { font-size: 18px; font-weight: 600; letter-spacing: .02em; word-break: break-all; }
.succ-actions, .succ-foot { display: flex; gap: 8px; flex-wrap: wrap; }
.chain { list-style: none; margin: 0; padding: 12px 14px; border-radius: var(--r-md); border: 1px solid var(--line-1); display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.chain li { display: flex; gap: 8px; align-items: center; }
.chain :deep(svg) { color: var(--success); flex: none; }
.succ-label { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.spin { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .side { position: static; order: -1; }
  .success { grid-template-columns: 1fr; }
}
@media (max-width: 860px) {
  .hubs, .pay-grid { grid-template-columns: 1fr; }
  .pad, .step-head { padding-left: 14px; padding-right: 14px; }
  .foot { padding: 12px 14px; }
}
</style>
