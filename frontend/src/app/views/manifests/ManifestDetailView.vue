<script setup>
// Manifest detail (spec 5.8): shipments or HAWB lines, totals, barcoded PDF, status actions.
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusPill from '../../components/StatusPill.vue'
import DateTime from '../../components/DateTime.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import CopyButton from '../../components/CopyButton.vue'
import Skeleton from '../../components/Skeleton.vue'
import Spinner from '../../components/Spinner.vue'
import EmptyState from '../../components/EmptyState.vue'
import Money from '../../components/Money.vue'
import Modal from '../../components/Modal.vue'
import { getManifest, updateManifestStatus, cancelManifest, MANIFEST_FLOW } from '../../api/manifests.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { manifestStatusLabel, manifestStatusTone, manifestKindLabel } from './manifestLabels.js'
import { can } from '../../store/session.js'
import { confirm } from '../../components/confirm.js'
import { toast } from '../../components/toast.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'
import Weight from '../../components/Weight.vue'

const route = useRoute()
const router = useRouter()
const m = ref(null)
const loading = ref(true)
const notFound = ref(false)
const error = ref('')
const busy = ref('')

async function load() {
  error.value = ''
  notFound.value = false
  try { m.value = await getManifest(route.params.id) } catch (e) {
    if (e.code === 'NOT_FOUND') notFound.value = true
    else error.value = errorText(e, ['manifests.errors'])
  } finally { loading.value = false }
}
watch(() => route.params.id, id => { if (id) { loading.value = true; m.value = null; load() } }, { immediate: true })
const sig = computed(() => { const x = db.get('manifests', route.params.id); return x ? x.status + (x.shipmentIds ?? []).length : '' })
watch(sig, (v, o) => { if (o && v !== o) load() })

const isAir = computed(() => m.value?.type === 'air_customs')
const hub = computed(() => db.all('hubs').find(h => h.code === m.value?.hub))
const pickup = computed(() => hub.value?.carrierPickups?.find(p => p.carrier === m.value?.carrier)?.time ?? null)
const svcName = s => db.get('carriers', s.carrier)?.services?.find(x => x.code === s.service)?.name ?? s.service
const countryName = code => { const c = db.get('countries', code); return c ? tx(c.name) : code }
const totals = computed(() => {
  if (!m.value) return {}
  if (isAir.value) return { parcels: m.value.parcels, weight: `${fmt.number(m.value.weightKg, 1)} kg (${fmt.weight(m.value.weightLb)})`, value: m.value.valueUsd }
  const billable = (m.value.shipments ?? []).reduce((s, x) => s + (x.billableLb || 0), 0)
  return { parcels: m.value.parcels, weight: fmt.weightDual(m.value.weightLb), billable }
})
const nextAirStatus = computed(() => {
  if (!isAir.value) return null
  const flow = MANIFEST_FLOW.air_customs
  return flow[flow.indexOf(m.value.status) + 1] ?? null
})
const missingHs = computed(() => (m.value?.hawbs ?? []).filter(h => h.missingHs || !(h.hsCodes ?? []).length))

async function pdf(kind = 'download') {
  busy.value = kind
  try {
    const d = await import('../../docs/index.js')
    if (kind === 'download') { d.downloadManifest(m.value, { shipments: m.value.shipments }); toast.success(t('manifests.pdfDone', { id: m.value.id })) }
    else if (kind === 'print') d.printDoc(d.manifestDoc(m.value, { shipments: m.value.shipments }))
    else {
      previewUrl.value = d.manifestBlobUrl(m.value, { shipments: m.value.shipments })
      previewOpen.value = true
    }
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = '' }
}
const previewOpen = ref(false)
const previewUrl = ref('')
watch(previewOpen, v => { if (!v && previewUrl.value) { URL.revokeObjectURL(previewUrl.value); previewUrl.value = '' } })
onBeforeUnmount(() => { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value) })

async function advance() {
  const to = nextAirStatus.value
  const ok = await confirm({
    title: t('manifests.detail.advanceTitle.' + to, { id: m.value.id }),
    message: t('manifests.detail.advanceDesc.' + to, { mawb: m.value.mawb }),
    confirmLabel: t('manifests.detail.advance.' + to),
  })
  if (!ok) return
  busy.value = 'status'
  try {
    await updateManifestStatus(m.value.id, to)
    toast.success(t('manifests.detail.advanced', { id: m.value.id, status: manifestStatusLabel(to) }))
    await load()
  } catch (e) { toast.error(errorText(e, ['manifests.errors'])) } finally { busy.value = '' }
}

async function cancel() {
  const ok = await confirm({ title: t('manifests.detail.cancelTitle', { id: m.value.id }), message: t('manifests.detail.cancelDesc'), confirmLabel: t('manifests.detail.cancel'), danger: true })
  if (!ok) return
  busy.value = 'cancel'
  try {
    await cancelManifest(m.value.id)
    toast.success(t('manifests.detail.cancelled', { id: m.value.id }))
    router.push('/manifests')
  } catch (e) { toast.error(errorText(e, ['manifests.errors'])) } finally { busy.value = '' }
}
</script>

<template>
  <div class="page">
    <template v-if="loading">
      <Skeleton variant="rect" :height="60" />
      <div class="grid-4 mt"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="80" /></div>
      <Skeleton variant="rect" :height="300" class="mt" />
    </template>
    <EmptyState v-else-if="notFound" icon="file" :title="t('manifests.detail.notFound')" :description="t('manifests.detail.notFoundDesc', { id: route.params.id })" :action-label="t('manifests.detail.back')" @action="router.push('/manifests')" />
    <div v-else-if="error" class="callout danger">{{ error }} <button class="btn-link" @click="load">{{ t('common.retry') }}</button></div>
    <template v-else-if="m">
      <PageHeader :title="t('manifests.detail.title', { id: m.id })" :subtitle="manifestKindLabel(m) + ' · ' + m.hub + (m.carrier ? ' · ' + (db.get('carriers', m.carrier)?.name ?? m.carrier) : ' · ' + m.flight)">
        <template #actions>
          <button class="btn btn-ghost" :disabled="!!busy" @click="pdf('preview')"><Spinner v-if="busy === 'preview'" :size="14" /><Icon v-else name="eye" :size="14" /> {{ t('manifests.detail.preview') }}</button>
          <button class="btn btn-ghost" :disabled="!!busy" @click="pdf('print')"><Icon name="printer" :size="14" /> {{ t('common.print') }}</button>
          <button class="btn btn-primary" :disabled="!!busy" @click="pdf('download')"><Spinner v-if="busy === 'download'" :size="14" /><Icon v-else name="download" :size="14" /> {{ t('common.downloadPdf') }}</button>
        </template>
      </PageHeader>

      <!-- status flow -->
      <section class="panel flow">
        <ol class="steps">
          <li v-for="(st, i) in m.timeline" :key="st.status" :class="{ done: st.done, current: st.status === m.status }">
            <span class="bullet"><Icon v-if="st.done" name="check" :size="12" /><template v-else>{{ i + 1 }}</template></span>
            <div>
              <div class="st-label">{{ manifestStatusLabel(st.status) }}</div>
              <div class="st-at"><DateTime v-if="st.at" :value="st.at" mode="short" /><template v-else>-</template></div>
            </div>
          </li>
        </ol>
        <div class="flow-actions">
          <StatusPill :status="m.status" :label="manifestStatusLabel(m.status)" :tone="manifestStatusTone(m.status)" />
          <template v-if="!isAir && m.status === 'created'">
            <RouterLink :to="{ path: '/ops', query: { hub: m.hub, tab: 'handover' } }" class="btn btn-accent btn-sm"><Icon name="truck" :size="13" /> {{ t('manifests.detail.toHandover') }}</RouterLink>
          </template>
          <button v-if="nextAirStatus" class="btn btn-accent btn-sm" :disabled="!!busy || !can('shipments.create')" @click="advance">
            <Spinner v-if="busy === 'status'" :size="12" /> {{ t('manifests.detail.advance.' + nextAirStatus) }}
          </button>
          <button v-if="m.status === 'created'" class="btn btn-ghost btn-sm danger-text" :disabled="!!busy || !can('shipments.create')" @click="cancel">{{ t('manifests.detail.cancel') }}</button>
        </div>
      </section>

      <!-- summary -->
      <div class="grid-4 mt">
        <div class="panel panel-pad kpi"><span>{{ t('manifests.col.parcels') }}</span><strong class="num">{{ fmt.number(totals.parcels) }}</strong></div>
        <div class="panel panel-pad kpi"><span>{{ t('manifests.col.weight') }}</span><strong class="num">{{ totals.weight }}</strong></div>
        <div v-if="isAir" class="panel panel-pad kpi"><span>{{ t('manifests.detail.value') }}</span><strong><Money :value="totals.value" /></strong></div>
        <div v-else class="panel panel-pad kpi"><span>{{ t('manifests.detail.billable') }}</span><strong class="num">{{ fmt.number(totals.billable) }} lb</strong></div>
        <div class="panel panel-pad kpi">
          <span>{{ isAir ? t('manifests.detail.flight') : t('manifests.detail.pickup') }}</span>
          <strong v-if="isAir" class="mono">{{ m.flight }}</strong>
          <strong v-else class="num">{{ m.handedOverAt ? fmt.dateTime(m.handedOverAt) : (pickup ?? '-') }}</strong>
        </div>
      </div>

      <!-- air: MAWB -->
      <section v-if="isAir" class="panel mt">
        <div class="panel-head"><div class="panel-title">{{ t('manifests.detail.airInfo') }}</div></div>
        <div class="panel-pad air">
          <div class="mawb">
            <span class="lbl">MAWB</span>
            <strong class="mono big">{{ m.mawb }}</strong>
            <CopyButton :text="m.mawb" size="xs" />
          </div>
          <dl class="kv">
            <dt>{{ t('manifests.detail.flight') }}</dt><dd class="mono">{{ m.flight }}</dd>
            <dt>{{ t('manifests.detail.route') }}</dt><dd class="mono">{{ m.route }}</dd>
            <dt>{{ t('manifests.detail.origin') }}</dt><dd>{{ countryName(m.origin) }}</dd>
            <dt>{{ t('manifests.detail.destHub') }}</dt><dd>{{ m.hub }} · {{ tx(hub?.name) }}</dd>
            <dt>{{ t('manifests.col.created') }}</dt><dd><DateTime :value="m.createdAt" mode="absolute" /></dd>
          </dl>
        </div>
        <div v-if="missingHs.length" class="callout warn mx"><Icon name="alert" /> {{ t('manifests.detail.missingHs', { n: missingHs.length }) }} <RouterLink to="/customs" class="link">{{ t('manifests.create.fixHs') }}</RouterLink></div>
        <div class="table-wrap">
          <table class="table-simple">
            <thead><tr><th>#</th><th>HAWB</th><th>{{ t('manifests.detail.shipper') }}</th><th>{{ t('manifests.detail.consignee') }}</th><th>{{ t('manifests.detail.contents') }}</th><th>{{ t('manifests.detail.hs') }}</th><th>{{ t('manifests.detail.originShort') }}</th><th class="r">{{ t('manifests.col.parcels') }}</th><th class="r">kg</th><th class="r">{{ t('manifests.detail.value') }}</th></tr></thead>
            <tbody>
              <tr v-for="(h, i) in m.hawbs" :key="h.hawb">
                <td class="muted">{{ i + 1 }}</td>
                <td><div class="mono strong">{{ h.hawb }}</div><RouterLink v-if="h.intlShipmentId" :to="`/intl/${h.intlShipmentId}`" class="link mono small">{{ h.intlShipmentId }}</RouterLink></td>
                <td>{{ h.shipper }}</td>
                <td class="small">{{ h.consignee }}</td>
                <td class="small contents">{{ h.contents }}</td>
                <td class="mono small">{{ (h.hsCodes ?? []).join(', ') || '-' }}</td>
                <td>{{ h.origin }}</td>
                <td class="r num">{{ fmt.number(h.parcels) }}</td>
                <td class="r num">{{ fmt.number(h.weightKg, 1) }}</td>
                <td class="r"><Money :value="h.valueUsd" /></td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td colspan="7">{{ t('common.total') }}</td><td class="r num">{{ fmt.number(m.totals?.parcels) }}</td><td class="r num">{{ fmt.number(m.totals?.weightKg, 1) }}</td><td class="r"><Money :value="m.totals?.valueUsd" /></td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- carrier: shipments -->
      <section v-else class="panel mt">
        <div class="panel-head">
          <div class="panel-title">{{ t('manifests.detail.shipments') }}</div>
          <CarrierLogo :code="m.carrier" :size="24" show-name :sub="m.formType === 'usps_scan_form' ? 'SCAN Form' : t('manifests.kinds.eod')" />
        </div>
        <EmptyState v-if="!m.shipments.length" compact icon="box" :title="t('manifests.detail.noShipments')" />
        <div v-else class="table-wrap">
          <table class="table-simple">
            <thead><tr><th>#</th><th>{{ t('manifests.detail.shipment') }}</th><th>{{ t('manifests.detail.tracking') }}</th><th>{{ t('manifests.detail.service') }}</th><th>{{ t('manifests.detail.recipient') }}</th><th class="r">{{ t('manifests.col.weight') }}</th><th class="r">{{ t('manifests.detail.billable') }}</th><th>{{ t('common.status') }}</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in m.shipments" :key="s.id">
                <td class="muted">{{ i + 1 }}</td>
                <td><RouterLink :to="`/shipments/${s.id}`" class="link mono">{{ s.id }}</RouterLink></td>
                <td class="mono small">{{ s.trackingNo }}</td>
                <td class="small">{{ svcName(s) }}</td>
                <td class="small">{{ s.to?.name }}<div class="muted">{{ s.to?.city }}, {{ s.to?.state }} {{ s.to?.zip }}</div></td>
                <td class="r num"><Weight :lb="s.package?.weightLb" :mono="false" /></td>
                <td class="r num">{{ s.billableLb }} lb</td>
                <td><StatusPill :status="s.status" size="sm" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <Modal v-model:open="previewOpen" :title="t('manifests.detail.previewTitle', { id: m?.id ?? '' })" size="xl">
      <iframe v-if="previewUrl" :src="previewUrl" class="pdf" :title="t('manifests.detail.previewTitle', { id: m?.id ?? '' })" />
    </Modal>
  </div>
</template>

<style scoped>
.mt { margin-top: 16px; }
.flow { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 20px; flex-wrap: wrap; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 28px; flex-wrap: wrap; }
.steps li { display: flex; gap: 10px; align-items: center; color: var(--ink-3); position: relative; }
.bullet { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 600; background: var(--bg-3); color: var(--ink-3); }
.done .bullet { background: var(--success); color: white; }
.current .bullet { box-shadow: 0 0 0 4px oklch(0.95 0.05 155); }
.st-label { font-size: 13px; font-weight: 600; color: var(--ink-1); }
.steps li:not(.done) .st-label { color: var(--ink-3); font-weight: 500; }
.st-at { font-size: 12px; }
.flow-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.danger-text { color: var(--danger); }
.kpi { display: flex; flex-direction: column; gap: 4px; }
.kpi span { font-size: 12.5px; color: var(--ink-3); }
.kpi strong { font-size: 18px; font-family: var(--font-display); }
.air { display: grid; grid-template-columns: 260px 1fr; gap: 20px; align-items: start; }
.mawb { display: flex; flex-direction: column; gap: 4px; padding: 14px; border: 1px dashed var(--line-2); border-radius: var(--r-md); background: var(--bg-2); }
.mawb .lbl { font-size: 11px; letter-spacing: .08em; color: var(--ink-3); }
.big { font-size: 20px; }
.mono { font-family: var(--font-mono); }
.strong { font-weight: 600; }
.small { font-size: 12.5px; }
.muted { color: var(--ink-3); font-size: 12px; }
.contents { max-width: 280px; }
.r { text-align: right; }
.mx { margin: 0 20px 12px; }
tfoot td { padding: 10px 12px; font-weight: 600; border-top: 1px solid var(--line-2); }
.pdf { width: 100%; height: 70vh; border: 1px solid var(--line-1); border-radius: var(--r-md); }
@media (max-width: 860px) { .air { grid-template-columns: 1fr; } }
</style>
