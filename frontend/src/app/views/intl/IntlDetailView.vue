<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import Spinner from '@/app/components/Spinner.vue'
import ProgressBar from '@/app/components/ProgressBar.vue'
import DateTime from '@/app/components/DateTime.vue'
import CarrierLogo from '@/app/components/CarrierLogo.vue'
import CopyButton from '@/app/components/CopyButton.vue'
import Modal from '@/app/components/Modal.vue'
import Flag from '@/app/components/intl/Flag.vue'
import IntlRoute from '@/app/components/intl/IntlRoute.vue'
import StageProgress from '@/app/components/intl/StageProgress.vue'
import CustomsUpload from '@/app/components/intl/CustomsUpload.vue'
import Tabs from '@/app/components/Tabs.vue'
import CustomsRecordTab from '@/app/components/customs/CustomsRecordTab.vue'
import { stageTone, CUSTOMS_TONES, errorText } from '@/app/components/intl/stage.js'
import { toast } from '@/app/components/toast.js'
import { confirm } from '@/app/components/confirm.js'
import { useI18n } from '@/app/i18n/index.js'
import { can } from '@/app/store/session.js'
import { getIntl, advanceStage, downloadCustomsDocument, kgToLb, cmToIn, STAGES } from '@/app/api/intl.js'
import { createDummyLabel } from '@/app/api/shipments.js'

const { t, tx, fmt } = useI18n()
const route = useRoute()
const router = useRouter()

const rec = ref(null)
const loading = ref(true)
const notFound = ref(false)
const advancing = ref(false)
const labelProgress = ref(null)
const uploadOpen = ref(false)
const busyDoc = ref('')
const dummyBusy = ref(false)
const preview = ref({ open: false, svg: '', title: '' })

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    rec.value = await getIntl(route.params.id)
    notFound.value = false
  } catch (e) {
    if (e.code === 'NOT_FOUND') notFound.value = true
    else toast.error(errorText(t, e))
  } finally { loading.value = false }
}
watch(() => route.params.id, id => { if (id) load() }, { immediate: true })

// tabs: overview (existing content) and customs (?tab=customs)
const DETAIL_TABS = ['overview', 'customs']
const tab = ref(DETAIL_TABS.includes(route.query.tab) ? route.query.tab : 'overview')
const detailTabs = computed(() => DETAIL_TABS.map(k => ({ key: k, label: t('customsInfo.tabs.' + k), icon: k === 'customs' ? 'shield' : undefined })))
watch(tab, v => { if ((route.query.tab || 'overview') !== v) router.replace({ query: { ...route.query, tab: v === 'overview' ? undefined : v } }) })
watch(() => route.query.tab, v => { tab.value = DETAIL_TABS.includes(v) ? v : 'overview' })

const blocked = computed(() => rec.value?.customsStatus === 'docs_requested')
const nextLabel = computed(() => (rec.value?.next ? t('intl.stages.' + rec.value.next) : ''))
const directLabels = computed(() => rec.value?.next === 'last_mile_labeled' && rec.value?.lastMile === 'direct')

async function advance() {
  if (!rec.value?.next) return
  if (blocked.value && rec.value.next === 'customs_cleared') { toast.error(t('intl.errors.CUSTOMS_DOCS_REQUIRED')); uploadOpen.value = true; return }
  if (directLabels.value) {
    const n = rec.value.recipients?.length || Math.min(Math.max(1, rec.value.parcelCount), 4)
    const ok = await confirm({ title: t('intl.detail.labelsConfirmTitle'), message: t('intl.detail.labelsConfirmMsg', { n, hub: rec.value.destHub }), confirmLabel: t('intl.detail.labelsConfirmOk', { n }) })
    if (!ok) return
  }
  advancing.value = true
  labelProgress.value = directLabels.value ? { pct: 0, done: 0, total: rec.value.recipients?.length || 0 } : null
  try {
    const res = await advanceStage(rec.value.id, { onProgress: (pct, info) => { labelProgress.value = { pct, done: info.done, total: info.total } } })
    rec.value = await getIntl(rec.value.id)
    if (res.stage === 'last_mile_labeled') {
      toast.success(res.labels.length ? t('intl.detail.labelsCreated', { n: res.labels.length }) : t('intl.detail.storedAtHub', { hub: rec.value.destHub }), res.labels.length ? { action: { label: t('intl.detail.viewShipments'), onClick: () => router.push({ name: 'shipments' }) } } : {})
    } else {
      toast.success(t('intl.detail.advanced', { stage: t('intl.stages.' + res.stage) }))
    }
  } catch (e) {
    toast.error(errorText(t, e))
    if (e.code === 'CUSTOMS_DOCS_REQUIRED') uploadOpen.value = true
    await load(true)
  } finally { advancing.value = false; labelProgress.value = null }
}

async function download(doc) {
  busyDoc.value = doc.key
  try { const name = await downloadCustomsDocument(doc.key); toast.success(t('intl.detail.downloaded', { name })) } catch (e) { toast.error(errorText(t, e)) } finally { busyDoc.value = '' }
}
async function downloadBundle() {
  await download({ key: `${rec.value.id}:bundle` })
}
async function makeDummy() {
  dummyBusy.value = true
  try {
    const r = await createDummyLabel({ intlId: rec.value.id })
    await load(true)
    toast.success(r.existing ? t('intl.detail.dummyExists', { ref: r.dummyLabel.ref }) : t('intl.detail.dummyCreated', { ref: r.dummyLabel.ref }))
  } catch (e) { toast.error(errorText(t, e)) } finally { dummyBusy.value = false }
}
async function previewDummy() {
  const docs = await import('@/app/docs/index.js')
  preview.value = { open: true, svg: docs.dummyLabelSvg(rec.value, { width: 300 }), title: t('intl.detail.dummyTitle') + ' · ' + rec.value.dummyLabel.ref }
}
async function previewFinal(s) {
  const docs = await import('@/app/docs/index.js')
  preview.value = { open: true, svg: docs.labelSvg(s, { width: 300 }), title: t('intl.detail.finalTitle') + ' · ' + s.trackingNo }
}
async function downloadFinal(s) {
  const docs = await import('@/app/docs/index.js')
  docs.downloadLabel(s)
}

const items = computed(() => (rec.value?.parcels || []).flatMap(p => p.items.map(i => ({ ...i, parcel: p.ref }))))
const timeline = computed(() => [...(rec.value?.stageHistory || [])].reverse())
function eventText(e) {
  if (e.kind === 'docs_uploaded') return t('intl.events.docs_uploaded', { n: e.n })
  const p = { point: e.point || rec.value.originPoint, flight: e.flight || rec.value.flight || '-', mawb: e.mawb || rec.value.mawb || '-', port: e.port || String(rec.value.route || '').split('-').pop() || (rec.value.destHub === 'LA01' ? 'LAX' : 'JFK'), hub: e.hub || rec.value.destHub, n: e.n ?? rec.value.lastMileLabelCount ?? 0 }
  if (e.stage === 'origin_received') return rec.value.handover === 'pickup' ? t('intl.events.origin_received_pickup', { partner: rec.value.origin === 'GB' ? 'Evri' : t('intl.new.courier') }) : t('intl.events.origin_received', p)
  if (e.stage === 'last_mile_labeled') return rec.value.lastMile === 'store' ? t('intl.events.last_mile_stored', p) : t('intl.events.last_mile_labeled', p)
  return t('intl.events.' + e.stage, p)
}
const docList = computed(() => rec.value?.documents || [])
const lastMileSum = computed(() => (rec.value?.lastMileShipments || []).reduce((s, x) => s + (x.total || 0), 0))
function ruleText(r) {
  const p = { ...r.params }
  if (p.category) p.category = tx(p.category)
  if (p.amount != null) p.amount = fmt.moneyNative(p.amount, p.currency || 'USD', 0)
  if (p.value != null) p.value = fmt.money(p.value)
  return t('intl.rules.' + r.code, p)
}
</script>

<template>
  <div class="page">
    <template v-if="loading">
      <Skeleton variant="rect" :height="70" />
      <div class="grid-2 mt"><Skeleton variant="rect" :height="260" /><Skeleton variant="rect" :height="260" /></div>
    </template>
    <EmptyState v-else-if="notFound" icon="plane" :title="t('intl.detail.notFound')" :description="t('intl.detail.notFoundDesc', { id: route.params.id })" :action-label="t('intl.detail.backToList')" @action="router.push({ name: 'intl' })" />
    <template v-else-if="rec">
      <PageHeader :title="rec.id" :subtitle="t('intl.detail.subtitle', { origin: tx(rec.originPointInfo?.name) || rec.originPoint, hub: rec.destHub, date: fmt.date(rec.createdAt) })">
        <template #actions>
          <button class="btn btn-ghost" :disabled="busyDoc === rec.id + ':bundle'" @click="downloadBundle"><Spinner v-if="busyDoc === rec.id + ':bundle'" :size="14" /><Icon v-else name="download" :size="14" />{{ t('intl.detail.allDocs') }}</button>
          <div class="adv">
            <span class="demo-badge" :title="t('intl.detail.demoNote')">{{ t('common.demo') }}</span>
            <button v-if="rec.next" data-testid="intl-advance" :data-busy="advancing ? 'true' : 'false'" class="btn btn-primary" :disabled="advancing || !can('shipments.create')" :title="!can('shipments.create') ? t('common.noPermission') : t('intl.detail.demoNote')" @click="advance">
              <Spinner v-if="advancing" :size="14" /><Icon v-else name="play" :size="14" />{{ t('intl.detail.advance', { stage: nextLabel }) }}
            </button>
            <span v-else class="tag tag-success"><Icon name="check" :size="12" />{{ t('intl.stages.completed') }}</span>
          </div>
        </template>
      </PageHeader>

      <div class="panel panel-pad head">
        <div class="hrow">
          <div class="hl" data-testid="intl-stage" :data-stage="rec.stage">
            <StatusPill :status="rec.stage" :label="t('intl.stages.' + rec.stage)" :tone="stageTone(rec.stage, rec.customsStatus)" />
            <StatusPill :status="rec.customsStatus" :label="t('intl.customsStatus.' + rec.customsStatus)" :tone="CUSTOMS_TONES[rec.customsStatus]" size="sm" />
            <span class="muted">{{ t('intl.detail.demoNoteShort') }}</span>
          </div>
          <span class="muted">ETA <DateTime :value="rec.eta" mode="date" /></span>
        </div>
        <IntlRoute :record="{ ...rec, consolidationCode: rec.consolidation?.code }" />
        <StageProgress :stage="rec.stage" :history="rec.stageHistory" :blocked="blocked" />
        <div v-if="labelProgress" class="lp">
          <ProgressBar :value="labelProgress.pct" :label="t('intl.detail.labelsProgress', { done: labelProgress.done, total: labelProgress.total || '-' })" show-value />
        </div>
      </div>

      <div v-if="blocked" class="callout danger req">
        <Icon name="alert" :size="16" />
        <div class="rq">
          <strong>{{ t('intl.detail.docsRequested') }}</strong>
          <span>{{ tx(rec.customsRequest?.note) }}</span>
          <ul><li v-for="(d, i) in rec.customsRequest?.docs || []" :key="i">{{ tx(d) }}</li></ul>
        </div>
        <button class="btn btn-danger" @click="uploadOpen = true"><Icon name="upload" :size="14" />{{ t('intl.detail.uploadDocs') }}</button>
      </div>

      <Tabs v-model="tab" :tabs="detailTabs" :aria-label="rec.id" class="dtabs" data-testid="intl-detail-tabs" />

      <div v-if="tab === 'overview'" class="cols">
        <div class="col">
          <section class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.detail.timeline') }}</span><span class="panel-sub">{{ t('intl.detail.timelineSub') }}</span></div>
            <ol class="tl">
              <li v-for="(e, i) in timeline" :key="i" :class="{ first: i === 0 }">
                <span class="tdot" />
                <div class="tb">
                  <strong>{{ e.kind === 'docs_uploaded' ? t('intl.detail.docsUploadedTitle') : t('intl.stages.' + e.stage) }}</strong>
                  <span class="tt">{{ eventText(e) }}</span>
                </div>
                <DateTime :value="e.at" mode="short" class="tw" />
              </li>
            </ol>
          </section>

          <section class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.detail.parcels', { n: rec.parcelCount }) }}</span>
              <span class="panel-sub num">{{ fmt.number(rec.totalWeightKg, 2) }} kg · {{ fmt.number(kgToLb(rec.totalWeightKg), 1) }} lb · {{ t('intl.parcels.volumetric', { kg: fmt.number(rec.volumetricKg, 1) }) }}</span></div>
            <div class="table-wrap">
              <table class="table-simple">
                <thead><tr><th>{{ t('intl.detail.parcel') }}</th><th>{{ t('intl.detail.dims') }}</th><th class="r">kg</th><th class="r">lb</th></tr></thead>
                <tbody>
                  <tr v-for="p in rec.parcels" :key="p.ref">
                    <td class="mono">{{ p.ref }}</td>
                    <td class="num">{{ p.lengthCm }}x{{ p.widthCm }}x{{ p.heightCm }} cm <span class="muted">({{ fmt.number(cmToIn(p.lengthCm), 1) }}x{{ fmt.number(cmToIn(p.widthCm), 1) }}x{{ fmt.number(cmToIn(p.heightCm), 1) }} in)</span></td>
                    <td class="r num">{{ fmt.number(p.weightKg, 2) }}</td>
                    <td class="r num">{{ fmt.number(kgToLb(p.weightKg), 1) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="table-wrap">
              <table class="table-simple">
                <thead><tr><th>{{ t('intl.detail.item') }}</th><th>HS</th><th class="r">{{ t('intl.parcels.qty') }}</th><th class="r">{{ t('intl.detail.unit', { cur: rec.currency }) }}</th><th class="r">USD</th><th>{{ t('intl.manifest.origin') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(it, i) in items" :key="i">
                    <td>{{ it.title }}<div class="muted mono">{{ it.parcel }}{{ it.sku ? ' · ' + it.sku : '' }}</div></td>
                    <td class="mono">{{ it.hsCode }}</td>
                    <td class="r num">{{ it.qty }}</td>
                    <td class="r num">{{ fmt.money(it.unitValueLocal, rec.currency) }}</td>
                    <td class="r num">{{ fmt.money(it.unitValueUsd * it.qty) }}</td>
                    <td>{{ it.origin }}</td>
                  </tr>
                </tbody>
                <tfoot><tr><td colspan="3"><strong>{{ t('common.total') }}</strong> <span class="muted">{{ t('intl.detail.fxUsed', { rate: fmt.number(rec.fxRate, 4), cur: rec.currency }) }}</span></td><td class="r num"><strong>{{ fmt.money(rec.declaredValueLocal, rec.currency) }}</strong></td><td class="r num"><strong>{{ fmt.money(rec.declaredValueUsd) }}</strong></td><td /></tr></tfoot>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.detail.lastMile') }}</span><span class="panel-sub">{{ t('intl.lastMile.' + rec.lastMile) }}</span></div>
            <div class="panel-pad">
              <template v-if="rec.lastMileShipments?.length">
                <div class="table-wrap">
                  <table class="table-simple">
                    <thead><tr><th>{{ t('intl.detail.shipment') }}</th><th>{{ t('intl.detail.recipient') }}</th><th>{{ t('intl.detail.carrier') }}</th><th>{{ t('intl.detail.tracking') }}</th><th>{{ t('common.status') }}</th></tr></thead>
                    <tbody>
                      <tr v-for="s in rec.lastMileShipments" :key="s.id">
                        <td class="nowrap"><RouterLink :to="{ name: 'shipment-detail', params: { id: s.id } }" class="link mono">{{ s.id }}</RouterLink><div v-if="s.orderId" class="muted mono">{{ s.orderId }}</div></td>
                        <td>{{ s.to?.name }}<div class="muted">{{ s.to?.city }}, {{ s.to?.state }} {{ s.to?.zip }}</div></td>
                        <td><CarrierLogo :code="s.carrier" :size="22" show-name :sub="s.service" /></td>
                        <td class="mono">{{ s.trackingNo }} <CopyButton :text="s.trackingNo" size="xs" /></td>
                        <td><StatusPill :status="s.status" size="sm" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="muted">{{ t('intl.detail.prepaidNote', { amount: fmt.money(lastMileSum) }) }}</p>
              </template>
              <template v-else-if="rec.lastMile === 'direct'">
                <p class="muted">{{ rec.recipients?.length ? t('intl.detail.recipientsWaiting', { n: rec.recipients.length, hub: rec.destHub }) : t('intl.detail.recipientsDemo', { hub: rec.destHub }) }}</p>
                <ul v-if="rec.recipients?.length" class="rl">
                  <li v-for="r in rec.recipients" :key="r.idx"><Icon name="user" :size="13" />{{ r.name }} · {{ r.city }}, {{ r.state }} {{ r.zip }}<span v-if="r.orderId" class="tag">{{ r.orderId }}</span></li>
                </ul>
              </template>
              <p v-else class="muted">{{ rec.stage === 'completed' || STAGES.indexOf(rec.stage) >= 7 ? t('intl.detail.storedDone', { hub: rec.destHub }) : t('intl.detail.storeInfo', { hub: rec.destHub }) }}</p>
            </div>
          </section>
        </div>

        <div class="col side">
          <section class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.detail.summary') }}</h3>
            <dl class="kv">
              <dt>{{ t('intl.list.origin') }}</dt><dd><Flag :code="rec.origin" :size="12" /> {{ rec.origin }} · {{ t('intl.handover.' + rec.handover) }}</dd>
              <dt>{{ t('intl.detail.sender') }}</dt><dd>{{ rec.sender?.company || rec.sender?.name }}<div class="muted">{{ rec.sender?.name }} · {{ rec.sender?.city }} {{ rec.sender?.zip }}</div></dd>
              <dt>{{ t('intl.list.point') }}</dt><dd>{{ tx(rec.originPointInfo?.name) || rec.originPoint }}</dd>
              <dt>{{ t('intl.detail.consolidation') }}</dt><dd>{{ tx(rec.consolidation?.name) || '-' }}</dd>
              <dt>{{ t('intl.detail.flight') }}</dt><dd class="mono">{{ rec.flight || '-' }}</dd>
              <dt>MAWB</dt><dd class="mono">{{ rec.mawb || '-' }} <CopyButton v-if="rec.mawb" :text="rec.mawb" size="xs" /></dd>
              <dt>HAWB</dt><dd class="mono">{{ rec.hawb?.hawb }}</dd>
              <dt>{{ t('intl.detail.manifest') }}</dt><dd><RouterLink v-if="rec.manifestId" :to="{ name: 'customs', query: { tab: 'manifests', q: rec.manifestId } }" class="link mono">{{ rec.manifestId }}</RouterLink><span v-else>-</span></dd>
              <dt>{{ t('intl.list.hub') }}</dt><dd>{{ rec.destHub }} · {{ tx(rec.destHubInfo?.name) }}</dd>
              <dt>{{ t('intl.detail.customs') }}</dt><dd><StatusPill :status="rec.customsStatus" :label="t('intl.customsStatus.' + rec.customsStatus)" :tone="CUSTOMS_TONES[rec.customsStatus]" size="sm" /></dd>
            </dl>
          </section>

          <section class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.detail.labels') }}</span></div>
            <div class="labels">
              <div class="lcard" :class="{ rep: rec.dummyLabel?.status === 'replaced' }">
                <div class="lh"><Icon name="tag" :size="14" /><strong>{{ t('intl.detail.dummyTitle') }}</strong>
                  <StatusPill v-if="rec.dummyLabel" :status="rec.dummyLabel.status === 'replaced' ? 'replaced' : 'active'" :label="rec.dummyLabel.status === 'replaced' ? t('status.replaced') : t('intl.detail.dummyActive')" size="sm" />
                </div>
                <template v-if="rec.dummyLabel">
                  <div class="mono ref">{{ rec.dummyLabel.ref }}</div>
                  <div class="muted">{{ t('intl.detail.dummyWatermark') }}</div>
                  <div v-if="rec.dummyLabel.replacedAt" class="muted">{{ t('intl.detail.replacedAt', { date: fmt.dateTime(rec.dummyLabel.replacedAt) }) }}</div>
                  <div class="la">
                    <button class="btn btn-ghost btn-sm" @click="previewDummy"><Icon name="eye" :size="13" />{{ t('common.view') }}</button>
                    <button class="btn btn-ghost btn-sm" :disabled="busyDoc === rec.id + ':dummy_label'" @click="download({ key: rec.id + ':dummy_label' })"><Icon name="download" :size="13" />PDF</button>
                  </div>
                </template>
                <template v-else>
                  <p class="muted">{{ t('intl.detail.noDummy') }}</p>
                  <button class="btn btn-soft btn-sm" :disabled="dummyBusy || STAGES.indexOf(rec.stage) >= 7" @click="makeDummy"><Spinner v-if="dummyBusy" :size="13" /><Icon v-else name="plus" :size="13" />{{ t('intl.detail.createDummy') }}</button>
                </template>
              </div>
              <div class="lcard">
                <div class="lh"><Icon name="package-check" :size="14" /><strong>{{ t('intl.detail.finalTitle') }}</strong></div>
                <template v-if="rec.lastMileShipments?.length">
                  <div v-for="s in rec.lastMileShipments.slice(0, 3)" :key="s.id" class="fl">
                    <span class="mono">{{ s.trackingNo }}</span>
                    <span class="la">
                      <button class="btn-icon" :aria-label="t('common.view')" @click="previewFinal(s)"><Icon name="eye" :size="13" /></button>
                      <button class="btn-icon" :aria-label="t('common.downloadPdf')" @click="downloadFinal(s)"><Icon name="download" :size="13" /></button>
                    </span>
                  </div>
                  <div v-if="rec.lastMileShipments.length > 3" class="muted">{{ t('intl.detail.moreLabels', { n: rec.lastMileShipments.length - 3 }) }}</div>
                </template>
                <p v-else-if="rec.dummyLabel?.status === 'replaced'" class="muted">{{ t('intl.detail.finalHub', { ref: rec.dummyLabel.finalTrackingNo || '-' }) }}</p>
                <p v-else class="muted">{{ t('intl.detail.finalPending', { hub: rec.destHub }) }}</p>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.detail.documents') }}</span><span class="panel-sub">{{ docList.length }}</span></div>
            <ul class="dl">
              <li v-for="d in docList" :key="d.key">
                <Icon :name="d.type === 'air_manifest' ? 'list' : d.type === 'dummy_label' ? 'tag' : d.type === 'upload' ? 'upload' : 'file'" :size="14" />
                <span class="dn"><strong>{{ t('intl.docTypes.' + d.type) }}</strong><span class="muted mono">{{ d.number }}</span></span>
                <button class="btn-icon" :disabled="busyDoc === d.key || (d.type === 'upload' && !d.hasFile)" :aria-label="t('common.download')" :title="d.type === 'upload' && !d.hasFile ? t('intl.detail.fileNotStored') : t('common.download')" @click="download(d)">
                  <Spinner v-if="busyDoc === d.key" :size="13" /><Icon v-else name="download" :size="14" />
                </button>
              </li>
            </ul>
          </section>

          <section class="panel">
            <div class="panel-head"><span class="panel-title">{{ t('intl.detail.price') }}</span></div>
            <table class="table-simple">
              <tbody>
                <tr v-for="k in ['pickup', 'consolidation', 'airFreight', 'customsFee', 'lastMile']" :key="k">
                  <td>{{ t('intl.detail.priceKeys.' + (k === 'pickup' && rec.handover === 'dropoff' ? 'dropoff' : k)) }}<span v-if="k === 'airFreight'" class="muted num"> · {{ fmt.number(rec.price?.chargeableKg, 1) }} kg x {{ fmt.money(rec.price?.airRatePerKg) }}</span></td>
                  <td class="r num">{{ fmt.money(rec.price?.[k] ?? 0) }}</td>
                </tr>
                <tr class="tot"><td>{{ t('common.total') }}</td><td class="r num">{{ fmt.money(rec.price?.total) }}</td></tr>
              </tbody>
            </table>
          </section>

          <section class="panel panel-pad">
            <h3 class="section-title">{{ t('intl.new.rulesTitle') }}</h3>
            <ul class="rules">
              <li v-for="(r, i) in rec.rules" :key="i" :class="r.severity">{{ ruleText(r) }}</li>
            </ul>
          </section>
        </div>
      </div>
      <CustomsRecordTab v-else-if="tab === 'customs'" kind="intl" :record="rec" />

      <CustomsUpload v-model:open="uploadOpen" :record="rec" @uploaded="r => (rec = r)" />
      <Modal v-model:open="preview.open" :title="preview.title" size="md">
        <div class="lprev" v-html="preview.svg" />
      </Modal>
    </template>
  </div>
</template>

<style scoped>
.nowrap { white-space: nowrap; }
.mt { margin-top: 16px; }
.adv { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.adv .btn { white-space: normal; text-align: left; height: auto; min-height: 36px; }
.head { display: flex; flex-direction: column; gap: 18px; margin-bottom: 16px; }
.hrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.hl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.lp { max-width: 520px; }
.req { align-items: flex-start; margin-bottom: 16px; }
.rq { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.rq ul { margin: 4px 0 0; padding-left: 18px; }
.cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr); gap: 16px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.tl { list-style: none; margin: 0; padding: 12px 20px; }
.tl li { display: grid; grid-template-columns: 14px 1fr auto; gap: 12px; padding: 8px 0; position: relative; }
.tl li:not(:last-child)::after { content: ''; position: absolute; left: 6px; top: 22px; bottom: -8px; width: 2px; background: var(--line-1); }
.tdot { width: 10px; height: 10px; border-radius: 50%; background: var(--line-strong); margin: 4px 2px; }
.tl li.first .tdot { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tb { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
.tt { color: var(--ink-3); font-size: 12.5px; }
.tw { color: var(--ink-3); font-size: 12px; white-space: nowrap; }
.r { text-align: right; }
.rl { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.rl li { display: flex; gap: 6px; align-items: center; }
.labels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px 16px; }
.lcard { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.lcard.rep { background: var(--bg-2); }
.lh { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
.ref { font-weight: 600; }
.la { display: flex; gap: 6px; }
.fl { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.fl .mono { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; }
.dl { list-style: none; margin: 0; padding: 6px 16px 10px; }
.dl li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line-1); }
.dl li:last-child { border-bottom: 0; }
.dn { flex: 1; display: flex; flex-direction: column; font-size: 13px; min-width: 0; }
.tot td { font-weight: 700; border-top: 2px solid var(--line-2); }
.rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.rules li { padding: 7px 10px; border-radius: var(--r-sm); background: var(--bg-2); }
.rules li.warning { background: oklch(0.96 0.06 80); color: oklch(0.42 0.1 70); }
.rules li.error { background: oklch(0.95 0.04 25); color: oklch(0.45 0.16 25); }
.rules li.ok { color: oklch(0.4 0.1 155); }
.lprev { display: grid; place-items: center; }
.lprev :deep(svg) { width: 300px; max-width: 100%; height: auto; border: 1px solid var(--line-2); border-radius: 6px; background: #fff; }
@media (max-width: 1100px) { .cols { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) { .labels { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .req { flex-wrap: wrap; } .req .rq { min-width: calc(100% - 30px); } }
</style>
