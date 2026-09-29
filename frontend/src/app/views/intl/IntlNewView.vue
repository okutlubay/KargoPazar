<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Stepper from '@/app/components/Stepper.vue'
import AddressForm from '@/app/components/AddressForm.vue'
import SegmentedControl from '@/app/components/SegmentedControl.vue'
import AiInsightCard from '@/app/components/AiInsightCard.vue'
import Toggle from '@/app/components/Toggle.vue'
import Spinner from '@/app/components/Spinner.vue'
import Modal from '@/app/components/Modal.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Flag from '@/app/components/intl/Flag.vue'
import ParcelsEditor from '@/app/components/intl/ParcelsEditor.vue'
import RecipientsEditor from '@/app/components/intl/RecipientsEditor.vue'
import IntlRoute from '@/app/components/intl/IntlRoute.vue'
import { errorText } from '@/app/components/intl/stage.js'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { can } from '@/app/store/session.js'
import { getWallet } from '@/app/api/wallet.js'
import {
  originCountries, originPointsFor, pickupPartnerFor, consolidationPointFor, flightFor, draftTotals, quoteIntlDraft,
  suggestHubFor, checkCountryRules, buildIntlRecord, buildHawbLine, customsDataFor, createIntl, listCatalog,
  validateOriginAddress, normalizePostcode, kgToLb,
} from '@/app/api/intl.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const route = useRoute()

const SAMPLE_SENDERS = {
  GB: { name: 'Emily Carter', company: 'Brighton Ceramics Ltd', line1: '14 Kensington Gardens', line2: '', city: 'Brighton', state: 'East Sussex', zip: 'bn1 4al', phone: '+44 1273 555 014' },
  TR: { name: 'Ayşe Demir', company: 'Kapadokya Seramik Atölyesi', line1: 'Cumhuriyet Mah. Atatürk Cad. No:18', line2: '', city: 'Avanos', state: 'Nevşehir', zip: '50500', phone: '+90 384 555 0118' },
  DE: { name: 'Lena Hoffmann', company: 'Schwarzwald Holzkunst GmbH', line1: 'Hauptstraße 42', line2: '', city: 'Freiburg im Breisgau', state: '', zip: '79098', phone: '+49 761 555 0142' },
}

const countries = computed(() => originCountries())
const draft = reactive({
  origin: 'GB', originPoint: '', handover: 'dropoff',
  sender: { country: 'GB' },
  parcels: [{ lengthCm: 40, widthCm: 30, heightCm: 30, weightKg: '', items: [{ sku: '', title: '', qty: 1, unitValueLocal: '', hsCode: '', hsSource: null, origin: 'GB', weightKg: '' }] }],
  destHub: 'NJ01', hubSuggestion: null, lastMile: 'store', recipients: [],
  contentType: 'merchandise', dummyLabel: true,
})
const cfg = computed(() => countries.value.find(c => c.code === draft.origin) || null)
const currency = computed(() => cfg.value?.currency || 'USD')
const symbol = computed(() => cfg.value?.currencySymbol || '$')
const points = computed(() => originPointsFor(draft.origin))
const pickupPartner = computed(() => pickupPartnerFor(draft.origin))
const visiblePoints = computed(() => draft.handover === 'pickup'
  ? (points.value.filter(p => p.type === 'origin_network').length ? points.value.filter(p => p.type === 'origin_network') : points.value.filter(p => p.type === 'origin_point'))
  : points.value.filter(p => p.type === 'origin_point'))
const isNew = c => c.isNewMarket || (c.launchedAt && Date.now() - new Date(c.launchedAt).getTime() < 90 * 864e5)

function selectOrigin(code) {
  if (draft.origin === code) return
  draft.origin = code
  draft.sender = { country: code }
  for (const p of draft.parcels) for (const it of p.items) { if (!it.sku) it.origin = code }
}
watch(visiblePoints, pts => { if (!pts.some(p => p.code === draft.originPoint)) draft.originPoint = pts[0]?.code || '' }, { immediate: true })

function fillSample() {
  const s = SAMPLE_SENDERS[draft.origin]
  if (s) { draft.sender = { ...s, country: draft.origin }; return }
  const ex = cfg.value?.addressFormat?.postalExample || ''
  draft.sender = { name: 'Alex Morgan', company: 'Demo Export Co.', line1: '1 Market Street', city: tx(cfg.value?.name), state: '', zip: ex, country: draft.origin }
}

// ---- steps
const steps = computed(() => [
  { key: 'origin', label: t('intl.new.steps.origin') },
  { key: 'parcels', label: t('intl.new.steps.parcels') },
  { key: 'us', label: t('intl.new.steps.us') },
  { key: 'customs', label: t('intl.new.steps.customs') },
  { key: 'price', label: t('intl.new.steps.price') },
])
const current = ref(0)
const maxReached = ref(0)
const addrForm = ref(null)
const parcelsEd = ref(null)
const recipientsErr = ref('')
const senderErrors = ref({})

function validateStep(i) {
  if (i === 0) {
    const okForm = addrForm.value?.validate?.() !== false
    const v = validateOriginAddress(draft.origin, draft.sender)
    senderErrors.value = v.errors
    if (!okForm || !v.valid) {
      nextTick(() => { const el = document.querySelector('.addr-card [aria-invalid="true"]'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.focus?.() })
      return false
    }
    if (draft.sender.zip) draft.sender.zip = normalizePostcode(draft.origin, draft.sender.zip)
    return !!draft.originPoint
  }
  if (i === 1) return parcelsEd.value?.validate?.() !== false
  if (i === 2) {
    recipientsErr.value = draft.lastMile === 'direct' && !draft.recipients.length ? t('intl.new.recipientsRequired') : ''
    return !recipientsErr.value
  }
  if (i === 3) return !blockingRules.value.length
  return true
}
function next() {
  if (!validateStep(current.value)) { if (current.value === 3) toast.error(t('intl.new.rulesBlock')); return }
  current.value = Math.min(current.value + 1, steps.value.length - 1)
  maxReached.value = Math.max(maxReached.value, current.value)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function back() { current.value = Math.max(0, current.value - 1) }
// Pure: the Stepper calls this while rendering, so it must not run validation (side effects).
function canNavigate(target, cur) {
  return target <= cur || target <= maxReached.value + 1
}
function goTo(target) {
  if (target > current.value) {
    for (let i = current.value; i < target; i++) {
      if (!validateStep(i)) { current.value = i; if (i === 3) toast.error(t('intl.new.rulesBlock')); return }
    }
  }
  current.value = target
}
watch(current, v => { maxReached.value = Math.max(maxReached.value, v) })

// ---- catalog
const products = ref([])
onMounted(async () => {
  const q = typeof route.query.origin === 'string' ? route.query.origin.toUpperCase() : ''
  if (q && countries.value.some(c => c.code === q)) selectOrigin(q)
  try { products.value = await listCatalog() } catch (e) { toast.error(errorText(t, e)) }
  try { wallet.value = await getWallet() } catch { /* shown as unknown */ }
})

// ---- US side
const hubAi = computed(() => suggestHubFor(draft.lastMile === 'direct' ? draft.recipients : []))
const hubApplied = computed(() => draft.destHub === hubAi.value.hub)
function applyHub() { draft.destHub = hubAi.value.hub; draft.hubSuggestion = { hub: hubAi.value.hub, reasonCode: hubAi.value.reasonCode, zones: hubAi.value.zones }; toast.success(t('intl.new.hubApplied', { hub: hubAi.value.hub })) }
let hubTouched = false
watch(() => hubAi.value.hub, h => { if (!hubTouched) { draft.destHub = h; draft.hubSuggestion = { hub: h, reasonCode: hubAi.value.reasonCode, zones: hubAi.value.zones } } }, { immediate: true })
function pickHub(h) { hubTouched = true; draft.destHub = h }
const hubReason = computed(() => [
  { label: t('intl.new.hubZone', { hub: 'NJ01' }), value: fmt.number(hubAi.value.zones.NJ01, 1), weight: Math.max(0.05, 1 - (hubAi.value.zones.NJ01 - 2) / 6) },
  { label: t('intl.new.hubZone', { hub: 'LA01' }), value: fmt.number(hubAi.value.zones.LA01, 1), weight: Math.max(0.05, 1 - (hubAi.value.zones.LA01 - 2) / 6) },
  { label: t('intl.new.hubBasis'), value: t('intl.new.hubBasisValue.' + hubAi.value.reasonCode, { n: hubAi.value.n }) },
])

// ---- totals / rules / price
const totals = computed(() => draftTotals(draft))
const allItems = computed(() => draft.parcels.flatMap(p => p.items))
const rules = computed(() => checkCountryRules({ origin: draft.origin, items: allItems.value, valueUsd: totals.value.valueUsd }))
const blockingRules = computed(() => rules.value.filter(r => r.severity === 'error'))
const quote = computed(() => { try { return quoteIntlDraft(draft) } catch { return null } })
const form = computed(() => (totals.value.valueUsd <= 400 ? 'cn22' : 'cn23'))
const cons = computed(() => consolidationPointFor(draft.origin, draft.originPoint))
const flight = computed(() => flightFor(cons.value?.code, draft.destHub))
const previewRecord = computed(() => {
  if (current.value < 3) return null
  try {
    const r = buildIntlRecord(draft, { id: 'INT-PREVIEW', quote: quote.value || undefined })
    return { ...r, consolidationCode: cons.value?.code, route: flight.value.route, flight: flight.value.flight, dummyLabel: draft.dummyLabel ? { ref: 'KPZ-TMP-PREVIEW', status: 'active', createdAt: new Date().toISOString() } : null }
  } catch { return null }
})
const hawb = computed(() => (previewRecord.value ? buildHawbLine(previewRecord.value) : null))
function ruleText(r) {
  const p = { ...r.params }
  if (p.category) p.category = tx(p.category)
  if (p.amount != null) p.amount = fmt.money(p.amount, p.currency || 'USD', 0)
  if (p.value != null) p.value = fmt.money(p.value)
  return t('intl.rules.' + r.code, p)
}

// ---- document previews
const preview = reactive({ open: false, loading: false, url: '', title: '' })
const dummySvg = ref('')
async function openDocPreview() {
  if (!previewRecord.value) return
  preview.open = true
  preview.loading = true
  preview.title = t('intl.new.docsPreview')
  try {
    const docs = await import('@/app/docs/index.js')
    const data = await customsDataFor(previewRecord.value)
    if (preview.url) URL.revokeObjectURL(preview.url)
    preview.url = docs.customsBundleBlobUrl(data)
  } catch (e) { toast.error(errorText(t, e)); preview.open = false } finally { preview.loading = false }
}
async function loadDummy() {
  if (!previewRecord.value || !draft.dummyLabel) { dummySvg.value = ''; return }
  try {
    const docs = await import('@/app/docs/index.js')
    dummySvg.value = docs.dummyLabelSvg(previewRecord.value, { width: 220 })
  } catch { dummySvg.value = '' }
}
watch([() => current.value, () => draft.dummyLabel], () => { if (current.value === 3) loadDummy() })
onBeforeUnmount(() => { if (preview.url) URL.revokeObjectURL(preview.url) })

// ---- pay
const wallet = ref(null)
const submitting = ref(false)
const afterBalance = computed(() => (wallet.value && quote.value ? wallet.value.balance - quote.value.total : null))
const needsTopup = computed(() => afterBalance.value != null && wallet.value?.autoTopup?.enabled && afterBalance.value < (wallet.value.autoTopup.threshold || 0))
async function submit() {
  for (let i = 0; i < 4; i++) if (!validateStep(i)) { current.value = i; return }
  submitting.value = true
  try {
    const res = await createIntl(JSON.parse(JSON.stringify(draft)))
    toast.success(t('intl.new.created', { id: res.intl.id, amount: fmt.money(res.intl.price.total) }))
    if (res.topup) toast.info(t('intl.new.autoTopup', { amount: fmt.money(res.topup.amount) }))
    router.push({ name: 'intl-detail', params: { id: res.intl.id } })
  } catch (e) {
    toast.error(errorText(t, e))
    if (e.code === 'VALIDATION' && e.details) {
      const k = Object.keys(e.details)[0] || ''
      current.value = k.startsWith('sender') || k === 'origin' ? 0 : k.startsWith('parcels') ? 1 : k.startsWith('recipients') ? 2 : current.value
    }
  } finally { submitting.value = false }
}
const addrFormat = computed(() => (['US', 'GB', 'TR', 'DE'].includes(draft.origin) ? null : cfg.value?.addressFormat || null))
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.intlNew')" :subtitle="t('intl.new.subtitle')">
      <template #actions>
        <button class="btn btn-ghost" @click="router.push({ name: 'intl' })">{{ t('common.cancel') }}</button>
      </template>
    </PageHeader>

    <div class="panel stepper-wrap">
      <Stepper :current="current" @update:current="goTo" :steps="steps" :max-reached="maxReached" :can-navigate="canNavigate" :aria-label="t('nav.intlNew')" />
    </div>

    <div class="layout">
      <div class="main">
        <!-- STEP 1: origin -->
        <section v-show="current === 0" class="stack">
          <div class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.new.originCountry') }}</h3>
            <div class="countries">
              <button v-for="c in countries" :key="c.code" type="button" class="ccard" :class="{ on: draft.origin === c.code }" :aria-pressed="draft.origin === c.code" @click="selectOrigin(c.code)">
                <Flag :code="c.code" :size="22" />
                <span class="cn"><strong>{{ tx(c.name) }}</strong><span class="muted">{{ c.currency }} · {{ c.units === 'metric' ? 'kg / cm' : 'lb / in' }}</span></span>
                <span v-if="isNew(c)" class="tag tag-accent">{{ t('intl.new.newMarket') }}</span>
              </button>
            </div>
          </div>
          <div class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.new.handover') }}</h3>
            <SegmentedControl v-model="draft.handover" :options="[
              { value: 'dropoff', label: t('intl.handover.dropoff'), icon: 'warehouse' },
              { value: 'pickup', label: pickupPartner.kind === 'network' ? t('intl.handover.pickupEvri') : draft.origin === 'TR' ? t('intl.handover.pickupCourierTr') : t('intl.handover.pickupCourier'), icon: 'truck' },
            ]" :aria-label="t('intl.new.handover')" />
            <p class="muted hint">{{ draft.handover === 'pickup' ? t('intl.new.pickupHint.' + (pickupPartner.kind === 'network' ? 'network' : 'courier')) : t('intl.new.dropoffHint') }}</p>
            <div class="points">
              <label v-for="p in visiblePoints" :key="p.code" class="pcard" :class="{ on: draft.originPoint === p.code }">
                <input v-model="draft.originPoint" type="radio" name="op" :value="p.code" />
                <Icon :name="p.type === 'origin_network' ? 'truck' : 'warehouse'" :size="16" />
                <span class="pc">
                  <strong>{{ tx(p.name) }}</strong>
                  <span class="muted">{{ p.address ? p.address.line1 + ', ' + p.address.city + ' ' + (p.address.zip || '') : t('intl.new.networkNote') }}</span>
                  <span v-if="p.cutoff" class="muted">{{ t('intl.new.cutoff', { time: p.cutoff }) }}</span>
                </span>
              </label>
            </div>
          </div>
          <div class="panel panel-pad addr-card">
            <div class="sh">
              <h3 class="section-title">{{ draft.handover === 'pickup' ? t('intl.new.pickupAddress') : t('intl.new.senderAddress') }}</h3>
              <button type="button" class="btn btn-ghost btn-sm" @click="fillSample"><Icon name="wand" :size="13" />{{ t('intl.new.fillSample') }}</button>
            </div>
            <AddressForm ref="addrForm" v-model="draft.sender" :country="draft.origin" :format="addrFormat" :show-residential="false" :show-email="false" />
            <p v-if="draft.origin === 'GB'" class="muted hint">{{ t('intl.new.gbPostcodeHint') }}</p>
            <p v-if="Object.keys(senderErrors).length" class="field-error">{{ t('intl.new.senderInvalid', { fields: Object.keys(senderErrors).join(', ') }) }}</p>
          </div>
        </section>

        <!-- STEP 2: parcels -->
        <section v-show="current === 1" class="stack">
          <div class="callout neutral"><Icon name="info" :size="15" /><span>{{ t('intl.new.fxNote', { cur: currency, rate: fmt.number(totals.fxRate, 4) }) }}</span></div>
          <ParcelsEditor ref="parcelsEd" :parcels="draft.parcels" :origin="draft.origin" :currency="currency" :symbol="symbol" :products="products" />
        </section>

        <!-- STEP 3: US side -->
        <section v-show="current === 2" class="stack">
          <div class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.new.lastMile') }}</h3>
            <div class="lm">
              <label class="pcard" :class="{ on: draft.lastMile === 'store' }">
                <input v-model="draft.lastMile" type="radio" value="store" />
                <Icon name="box" :size="16" />
                <span class="pc"><strong>{{ t('intl.lastMile.store') }}</strong><span class="muted">{{ t('intl.new.storeHint') }}</span></span>
              </label>
              <label class="pcard" :class="{ on: draft.lastMile === 'direct' }">
                <input v-model="draft.lastMile" type="radio" value="direct" />
                <Icon name="truck" :size="16" />
                <span class="pc"><strong>{{ t('intl.lastMile.direct') }}</strong><span class="muted">{{ t('intl.new.directHint') }}</span></span>
              </label>
            </div>
            <RecipientsEditor v-if="draft.lastMile === 'direct'" class="recips" :recipients="draft.recipients" :error="recipientsErr" />
          </div>
          <AiInsightCard :title="t('intl.new.hubAiTitle', { hub: hubAi.hub })" :description="tx(hubAi.reason)" :action-label="t('intl.new.hubApply')" :applied="hubApplied" :reason="hubReason" :meta="t('intl.new.hubAiMeta')" @apply="applyHub" />
          <div class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.new.destHub') }}</h3>
            <div class="hubs">
              <label v-for="h in ['NJ01', 'LA01']" :key="h" class="pcard" :class="{ on: draft.destHub === h }">
                <input type="radio" name="hub" :value="h" :checked="draft.destHub === h" @change="pickHub(h)" />
                <Flag code="US" :size="14" />
                <span class="pc">
                  <strong>{{ h }} · {{ t('intl.hubs.' + h) }}</strong>
                  <span class="muted">{{ t('intl.new.viaAirport', { port: h === 'LA01' ? 'LAX' : 'JFK', flight: flightFor(cons?.code, h).flight }) }}</span>
                </span>
                <span v-if="hubAi.hub === h" class="tag tag-accent">AI</span>
              </label>
            </div>
          </div>
        </section>

        <!-- STEP 4: customs -->
        <section v-show="current === 3" class="stack">
          <div class="panel panel-pad">
            <div class="sh">
              <h3 class="section-title">{{ t('intl.new.autoDocs') }}</h3>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="!previewRecord" @click="openDocPreview"><Icon name="eye" :size="13" />{{ t('intl.new.previewPdf') }}</button>
            </div>
            <ul class="docs">
              <li><Icon name="file" :size="15" /><span><strong>{{ t('intl.docTypes.commercial_invoice') }}</strong><span class="muted">{{ t('intl.new.ciDesc', { n: allItems.length }) }}</span></span><span class="tag tag-success">{{ t('intl.new.auto') }}</span></li>
              <li><Icon name="file" :size="15" /><span><strong>{{ t('intl.docTypes.' + form) }}</strong><span class="muted">{{ t('intl.new.formDesc.' + form, { value: fmt.money(totals.valueUsd) }) }}</span></span><span class="tag tag-success">{{ t('intl.new.auto') }}</span></li>
              <li><Icon name="list" :size="15" /><span><strong>{{ t('intl.new.manifestLine') }}</strong><span class="muted">{{ t('intl.new.manifestDesc', { flight: flight.flight }) }}</span></span><span class="tag tag-accent">HAWB</span></li>
            </ul>
            <div v-if="hawb" class="table-wrap">
              <table class="table-simple hawb">
                <thead><tr><th>HAWB</th><th>{{ t('intl.manifest.shipper') }}</th><th>{{ t('intl.manifest.consignee') }}</th><th>{{ t('intl.manifest.contents') }}</th><th>HS</th><th class="r">{{ t('intl.manifest.value') }}</th><th>{{ t('intl.manifest.origin') }}</th><th class="r">kg</th></tr></thead>
                <tbody><tr>
                  <td class="mono">{{ hawb.hawb }}</td><td>{{ hawb.shipper }}</td><td>{{ hawb.consignee }}</td><td>{{ hawb.contents || '-' }}</td>
                  <td class="mono">{{ hawb.hsCodes.join(', ') || '-' }}</td><td class="r num">{{ fmt.money(hawb.valueUsd) }}</td><td>{{ hawb.origin }}</td><td class="r num">{{ fmt.number(hawb.weightKg, 1) }}</td>
                </tr></tbody>
              </table>
            </div>
            <label class="ct">
              <span class="fl">{{ t('intl.new.contentType') }}</span>
              <select v-model="draft.contentType" class="select">
                <option v-for="c in ['merchandise', 'gift', 'sample', 'documents', 'returned', 'other']" :key="c" :value="c">{{ t('intl.contentTypes.' + c) }}</option>
              </select>
            </label>
          </div>
          <div class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.new.rulesTitle') }}</h3>
            <ul class="rules">
              <li v-for="(r, i) in rules" :key="i" :class="r.severity">
                <Icon :name="r.severity === 'error' ? 'x-circle' : r.severity === 'warning' ? 'alert' : r.severity === 'ok' ? 'check-circle' : 'info'" :size="15" />
                <span>{{ ruleText(r) }}</span>
              </li>
            </ul>
          </div>
          <div class="panel panel-pad">
            <Toggle v-model="draft.dummyLabel" :label="t('intl.new.dummyToggle')" :description="t('intl.new.dummyDesc')" />
            <div v-if="draft.dummyLabel" class="dummy">
              <div v-if="dummySvg" class="svgwrap" v-html="dummySvg" />
              <Skeleton v-else variant="rect" :width="220" :height="330" />
              <p class="muted">{{ t('intl.new.dummyNote', { n: draft.parcels.length }) }}</p>
            </div>
          </div>
        </section>

        <!-- STEP 5: price -->
        <section v-show="current === 4" class="stack">
          <div class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.new.priceTitle') }}</span><span class="panel-sub">{{ t('intl.new.priceSub') }}</span></div>
            <table v-if="quote" class="table-simple price">
              <tbody>
                <tr v-for="it in quote.items" :key="it.code">
                  <td><strong>{{ t('intl.price.' + it.code) }}</strong><div class="muted">{{ t('intl.price.detail.' + it.code, { n: it.detail.n, kg: fmt.number(it.detail.kg || 0, 1), rate: fmt.money(it.detail.rate || 0) }) }}</div></td>
                  <td class="r num">{{ fmt.money(it.amount) }}</td>
                </tr>
                <tr class="tot"><td>{{ t('common.total') }}</td><td class="r num">{{ fmt.money(quote.total) }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="panel panel-pad pay">
            <div class="kv">
              <dt>{{ t('intl.new.balance') }}</dt><dd class="num">{{ wallet ? fmt.money(wallet.balance) : '-' }}</dd>
              <dt>{{ t('intl.new.after') }}</dt><dd class="num" :class="{ 'text-danger': afterBalance != null && afterBalance < 0 }">{{ afterBalance != null ? fmt.money(afterBalance) : '-' }}</dd>
              <dt>{{ t('intl.new.eta') }}</dt><dd>{{ quote ? t('intl.new.etaDays', { n: quote.etaDays }) : '-' }}</dd>
            </div>
            <div v-if="needsTopup" class="callout warn"><Icon name="info" :size="15" />{{ t('intl.new.topupNote', { amount: fmt.money(wallet.autoTopup.amount) }) }}</div>
          </div>
        </section>

        <div class="nav">
          <button v-if="current > 0" class="btn btn-ghost" :disabled="submitting" @click="back"><Icon name="chevron-left" :size="14" />{{ t('common.back') }}</button>
          <span class="grow" />
          <button v-if="current < steps.length - 1" class="btn btn-primary" @click="next">{{ t('common.next') }}<Icon name="chevron-right" :size="14" /></button>
          <button v-else class="btn btn-primary" :disabled="submitting || !can('shipments.create')" :title="!can('shipments.create') ? t('common.noPermission') : ''" @click="submit">
            <Spinner v-if="submitting" :size="14" /><Icon v-else name="wallet" :size="14" />
            {{ quote ? t('intl.new.pay', { amount: fmt.money(quote.total) }) : t('intl.new.payPlain') }}
          </button>
        </div>
      </div>

      <aside class="side">
        <div class="panel panel-pad sticky">
          <h3 class="section-title">{{ t('intl.new.summary') }}</h3>
          <IntlRoute :record="{ origin: draft.origin, originPoint: draft.originPoint, consolidationCode: cons?.code, sender: draft.sender, destHub: draft.destHub, lastMile: draft.lastMile, route: flight.route, flight: flight.flight, stage: 'created', lastMileLabelCount: 0 }" compact />
          <dl class="kv sm">
            <dt>{{ t('intl.list.origin') }}</dt><dd><Flag :code="draft.origin" :size="11" /> {{ tx(cfg?.name) || draft.origin }}</dd>
            <dt>{{ t('intl.list.point') }}</dt><dd>{{ draft.originPoint || '-' }} · {{ t('intl.handover.' + draft.handover) }}</dd>
            <dt>{{ t('intl.list.parcels') }}</dt><dd class="num">{{ totals.parcels }} · {{ fmt.number(totals.weightKg, 2) }} kg ({{ fmt.number(kgToLb(totals.weightKg), 1) }} lb)</dd>
            <dt>{{ t('intl.new.value') }}</dt><dd class="num">{{ fmt.money(totals.valueLocal, currency) }}<br /><span class="muted">= {{ fmt.money(totals.valueUsd) }}</span></dd>
            <dt>{{ t('intl.list.hub') }}</dt><dd>{{ draft.destHub }} · {{ t('intl.lastMile.' + draft.lastMile) }}</dd>
            <dt>{{ t('intl.new.docsShort') }}</dt><dd>{{ t('intl.docTypes.commercial_invoice') }}, {{ t('intl.docTypes.' + form) }}</dd>
            <dt>{{ t('common.total') }}</dt><dd class="num strong">{{ quote ? fmt.money(quote.total) : '-' }}</dd>
          </dl>
        </div>
      </aside>
    </div>

    <Modal v-model:open="preview.open" :title="preview.title" size="xl">
      <div class="pdfbox">
        <div v-if="preview.loading" class="center"><Spinner :size="22" /></div>
        <iframe v-else-if="preview.url" :src="preview.url" :title="preview.title" />
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.stepper-wrap { padding: 16px 20px; margin-bottom: 16px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.hint { margin: 8px 0 0; }
.countries { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.ccard { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: var(--r-md); background: var(--surface); cursor: pointer; text-align: left; font: inherit; }
.ccard:hover { border-color: var(--accent-2); }
.ccard.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.cn { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.points, .hubs, .lm { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin-top: 12px; }
.pcard { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: var(--r-md); cursor: pointer; background: var(--surface); }
.pcard input { margin-top: 3px; accent-color: var(--accent); }
.pcard.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.pc { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.sh { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
.sh .section-title { margin: 0; }
.recips { margin-top: 14px; }
.docs { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.docs li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.docs li > span:nth-child(2) { display: flex; flex-direction: column; flex: 1; }
.hawb { font-size: 12.5px; }
.r { text-align: right; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.ct { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; max-width: 280px; }
.fl { font-size: 12px; color: var(--ink-3); font-weight: 500; }
.rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
.rules li { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--r-sm); background: var(--bg-2); }
.rules li.ok { color: oklch(0.4 0.1 155); }
.rules li.warning { background: oklch(0.96 0.06 80); color: oklch(0.42 0.1 70); }
.rules li.error { background: oklch(0.95 0.04 25); color: oklch(0.45 0.16 25); }
.rules li.info { color: var(--accent-ink); }
.dummy { display: flex; gap: 16px; align-items: flex-start; margin-top: 12px; flex-wrap: wrap; }
.svgwrap { width: 220px; border: 1px solid var(--line-2); border-radius: 6px; overflow: hidden; background: #fff; }
.svgwrap :deep(svg) { width: 100%; height: auto; display: block; }
.price td { padding: 12px 20px; }
.price .tot td { font-weight: 700; font-size: 15px; border-top: 2px solid var(--line-2); }
.pay { display: flex; flex-direction: column; gap: 12px; }
.nav { display: flex; gap: 10px; align-items: center; }
.grow { flex: 1; }
.side .sticky { position: sticky; top: calc(var(--kpz-sticky-top, 64px) + 12px); display: flex; flex-direction: column; gap: 14px; }
.kv.sm { grid-template-columns: 90px 1fr; font-size: 13px; }
.strong { font-weight: 700; }
.pdfbox { height: 70vh; }
.pdfbox iframe { width: 100%; height: 100%; border: 0; border-radius: 8px; background: var(--bg-3); }
.center { display: grid; place-items: center; height: 100%; }
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .side { order: -1; }
  .side .sticky { position: static; }
}
</style>
