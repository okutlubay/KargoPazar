<script setup>
// "Gümrük" / "Customs" tab of the shipment detail (last mile) and the first mile detail:
// declaration summary, documents (view / download via docs/*.js), customs status timeline,
// estimated vs final duties. Stock flow last mile shipments link to the first mile customs record.
//   <CustomsRecordTab kind="intl" :record="rec" />   <CustomsRecordTab kind="shipment" :record="shipment" />
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Money from '../Money.vue'
import StatusPill from '../StatusPill.vue'
import DateTime from '../DateTime.vue'
import Spinner from '../Spinner.vue'
import CustomsInfoPanel from './CustomsInfoPanel.vue'
import { useI18n } from '../../i18n/index.js'
import { toast } from '../toast.js'
import { intlCustomsRecord, shipmentCustomsRecord } from '../../api/customsRecords.js'
import { downloadCustomsDocument, customsDataFor } from '../../api/intl.js'

const props = defineProps({
  kind: { type: String, required: true }, // 'intl' | 'shipment'
  record: { type: Object, required: true },
})
const { t, fmt } = useI18n()
const busy = ref('')

const rec = computed(() => (props.kind === 'intl' ? intlCustomsRecord(props.record) : shipmentCustomsRecord(props.record)))
const main = computed(() => (rec.value?.kind === 'stock' ? null : rec.value))
const fm = computed(() => (rec.value?.kind === 'stock' ? rec.value.firstMile : null))
const STATUS_TONE = { not_declared: 'neutral', declared: 'info', under_review: 'warning', docs_requested: 'danger', assessed: 'info', released: 'success' }
const cur = computed(() => main.value?.estimate?.destCurrency || 'USD')
const showDisplay = computed(() => fmt.currency !== cur.value)

// documents
const docRows = computed(() => {
  if (!main.value) return []
  if (props.kind === 'intl') {
    return (props.record.documents || [])
      .filter(d => ['commercial_invoice', 'cn22', 'cn23', 'air_manifest', 'upload'].includes(d.type))
      .map(d => ({ key: d.key, type: d.type, number: d.number, viewable: ['commercial_invoice', 'cn22', 'cn23'].includes(d.type), hasFile: d.type !== 'upload' || d.hasFile }))
  }
  const num = String(props.record.id).replace(/\D/g, '')
  return [
    { key: 'commercial_invoice', type: 'commercial_invoice', number: 'CI-' + num, viewable: true, hasFile: true },
    { key: main.value.form, type: main.value.form, number: main.value.form.toUpperCase() + '-' + num, viewable: true, hasFile: true },
    { key: 'label', type: 'label', number: props.record.trackingNo, viewable: true, hasFile: props.record.status !== 'voided' },
  ]
})

async function docsModule() { return import('../../docs/index.js') }
async function shipmentData() {
  const d = await docsModule()
  const s = props.record
  const items = main.value.items.map(i => ({ description: i.title, sku: i.sku, hsCode: i.hsCode, origin: i.origin, qty: i.qty, unitValue: i.qty ? i.valueUsd / i.qty : i.valueUsd, totalValue: i.valueUsd }))
  return d.buildCustomsData(s, { order: s.order ?? null, items, contentType: s.customs?.contentType })
}
async function blobFor(row) {
  const d = await docsModule()
  if (row.type === 'label') return d.labelBlobUrl(props.record)
  const data = props.kind === 'intl' ? await customsDataFor(props.record) : await shipmentData()
  if (row.type === 'commercial_invoice') return d.commercialInvoiceBlobUrl(data)
  if (row.type === 'cn22') return d.cn22BlobUrl(data)
  return d.cn23BlobUrl(data)
}
async function view(row) {
  busy.value = row.key + ':view'
  try {
    const url = await blobFor(row)
    window.open(url, '_blank', 'noopener')
  } catch (e) { if (import.meta.env.DEV) console.warn(e); toast.error(t('common.errorGeneric')) } finally { busy.value = '' }
}
async function download(row) {
  busy.value = row.key
  try {
    if (props.kind === 'intl') { await downloadCustomsDocument(row.key); return }
    const d = await docsModule()
    if (row.type === 'label') { d.downloadLabel(props.record); return }
    const data = await shipmentData()
    if (row.type === 'commercial_invoice') d.downloadCommercialInvoice(data)
    else if (row.type === 'cn22') d.downloadCn22(data)
    else d.downloadCn23(data)
  } catch (e) { if (import.meta.env.DEV) console.warn(e); toast.error(t('common.errorGeneric')) } finally { busy.value = '' }
}
const panelItems = computed(() => (main.value?.items || []).map(i => ({ ...i })))
</script>

<template>
  <div class="crt" data-testid="customs-tab">
    <!-- stock flow: duties were paid on the first mile -->
    <template v-if="rec?.kind === 'stock'">
      <section class="panel panel-pad fm-link" data-testid="customs-firstmile-link">
        <div class="fm-h"><Icon name="plane" :size="16" /><strong>{{ t('customsInfo.record.stockTitle') }}</strong></div>
        <p class="muted">{{ t('customsInfo.record.stockDesc') }}</p>
        <div v-if="fm" class="fm-sum">
          <span class="mono">{{ fm.id }}</span>
          <StatusPill :status="fm.status" :label="t('customsInfo.status.' + fm.status)" :tone="STATUS_TONE[fm.status]" size="sm" />
          <span class="muted">{{ t('customsInfo.record.entry') }} <span class="mono">{{ fm.entryNo }}</span></span>
          <span v-if="fm.final">{{ t('customsInfo.record.final') }}: <Money :value="fm.final.totalUsd" /></span>
          <span v-else>{{ t('customsInfo.record.estimated') }}: <Money :value="fm.estimate.totalUsd" /></span>
        </div>
        <RouterLink v-if="rec.firstMileRef" class="btn btn-soft btn-sm" :to="{ name: 'intl-detail', params: { id: rec.firstMileRef }, query: { tab: 'customs' } }" data-testid="customs-firstmile-open">
          <Icon name="shield" :size="13" />{{ t('customsInfo.record.openFirstMile', { id: rec.firstMileRef }) }}
        </RouterLink>
        <p v-else class="muted">{{ t('customsInfo.record.noFirstMile') }}</p>
      </section>
    </template>

    <p v-else-if="!main" class="muted panel panel-pad">{{ t('customsInfo.record.domestic') }}</p>

    <template v-else>
      <div class="grid">
        <!-- declaration summary -->
        <section class="panel panel-pad">
          <div class="sh"><h3 class="section-title">{{ t('customsInfo.record.summary') }}</h3>
            <StatusPill :status="main.status" :label="t('customsInfo.status.' + main.status)" :tone="STATUS_TONE[main.status]" size="sm" data-testid="customs-status" />
          </div>
          <dl class="kv">
            <dt>{{ t('customsInfo.record.entry') }}</dt><dd class="mono">{{ main.declaredAt ? main.entryNo : '-' }}</dd>
            <dt>{{ t('customsInfo.record.route') }}</dt><dd>{{ main.origin }} → {{ main.dest }}</dd>
            <dt>Incoterm</dt><dd>{{ main.incoterm }} <span class="muted small">{{ t('customsInfo.incoterm.' + main.incoterm + '.name') }}</span></dd>
            <dt>{{ t('customsInfo.record.form') }}</dt><dd>{{ main.form.toUpperCase() }}</dd>
            <dt>{{ t('customsInfo.panel.customsValue') }}</dt><dd><Money :value="main.valueUsd" currency="USD" :convert="false" /> <span v-if="fmt.currency !== 'USD'" class="muted">(<Money :value="main.valueUsd" />)</span></dd>
            <dt>{{ t('customsInfo.record.lines') }}</dt><dd>{{ main.items.length }}</dd>
            <dt>{{ t('customsInfo.record.declaredAt') }}</dt><dd><DateTime v-if="main.declaredAt" :value="main.declaredAt" mode="short" /><span v-else>-</span></dd>
            <template v-if="main.mawb"><dt>MAWB</dt><dd class="mono">{{ main.mawb }}</dd></template>
          </dl>
          <p v-if="main.itemsEstimated" class="muted small">{{ t('customsInfo.record.itemsEstimated') }}</p>
        </section>

        <!-- status timeline -->
        <section class="panel panel-pad">
          <h3 class="section-title">{{ t('customsInfo.record.timeline') }}</h3>
          <ol class="steps" data-testid="customs-timeline">
            <li v-for="s in main.steps" :key="s.key" :class="s.state">
              <span class="sd"><Icon v-if="s.state === 'done'" name="check" :size="11" /><Icon v-else-if="s.state === 'blocked'" name="alert" :size="11" /></span>
              <div class="sb">
                <strong>{{ t('customsInfo.steps.' + s.key) }}</strong>
                <span class="muted small">{{ s.state === 'blocked' ? t('customsInfo.steps.blocked') : t('customsInfo.steps.' + s.key + 'Desc') }}</span>
              </div>
              <DateTime v-if="s.at" :value="s.at" mode="short" class="sw" />
              <span v-else class="sw muted small">{{ s.state === 'current' ? t('customsInfo.steps.inProgress') : '-' }}</span>
            </li>
          </ol>
        </section>
      </div>

      <div class="grid">
        <!-- estimated vs final -->
        <section class="panel panel-pad">
          <h3 class="section-title">{{ t('customsInfo.record.duties') }}</h3>
          <table class="table-simple" data-testid="customs-duties">
            <tbody>
              <tr><td>{{ t('customsInfo.record.estimated') }}</td><td class="r"><Money :value="main.estimate.totalDest" :currency="cur" :convert="false" /></td><td class="r muted"><Money v-if="showDisplay" :value="main.estimate.totalUsd" /></td></tr>
              <tr class="tot"><td>{{ t('customsInfo.record.final') }}</td>
                <template v-if="main.final"><td class="r"><Money :value="main.final.totalDest" :currency="cur" :convert="false" /></td><td class="r muted"><Money v-if="showDisplay" :value="main.final.totalUsd" /></td></template>
                <td v-else colspan="2" class="r muted">{{ t('customsInfo.record.finalPending') }}</td>
              </tr>
              <tr v-if="main.final"><td class="muted">{{ t('customsInfo.record.diff') }}</td><td class="r"><Money :value="main.final.diffUsd" signed colored /></td><td /></tr>
            </tbody>
          </table>
          <p class="muted small">{{ main.incoterm === 'DDP' ? t('customsInfo.record.paidBySeller') : t('customsInfo.record.paidByBuyer') }}</p>
        </section>

        <!-- documents -->
        <section class="panel panel-pad">
          <h3 class="section-title">{{ t('customsInfo.record.documents') }}</h3>
          <ul class="docs" data-testid="customs-docs">
            <li v-for="d in docRows" :key="d.key">
              <Icon :name="d.type === 'air_manifest' ? 'list' : d.type === 'label' ? 'tag' : d.type === 'upload' ? 'upload' : 'file'" :size="14" />
              <span class="dn"><strong>{{ t('customsInfo.record.docTypes.' + d.type) }}</strong><span class="muted mono small">{{ d.number }}</span></span>
              <span class="da">
                <button v-if="d.viewable" class="btn-icon" :disabled="!d.hasFile || busy === d.key + ':view'" :aria-label="t('common.view')" :title="t('common.view')" @click="view(d)"><Spinner v-if="busy === d.key + ':view'" :size="13" /><Icon v-else name="eye" :size="14" /></button>
                <button class="btn-icon" :disabled="!d.hasFile || busy === d.key" :aria-label="t('common.download')" :title="t('common.download')" @click="download(d)"><Spinner v-if="busy === d.key" :size="13" /><Icon v-else name="download" :size="14" /></button>
              </span>
            </li>
            <li v-if="!docRows.length" class="muted">{{ t('customsInfo.record.noDocs') }}</li>
          </ul>
        </section>
      </div>

      <CustomsInfoPanel :items="panelItems" :dest="main.dest" :origin="main.origin" :incoterm="main.incoterm" :show-incoterm="false" :default-open="false" />
    </template>
  </div>
</template>

<style scoped>
.crt { display: flex; flex-direction: column; gap: 14px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 960px) { .grid { grid-template-columns: 1fr; } }
.sh { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.section-title { margin: 0 0 8px; }
.sh .section-title { margin: 0; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
.kv dt { color: var(--ink-3); }
.kv dd { margin: 0; }
.small { font-size: 12px; }
.r { text-align: right; }
.tot td { font-weight: 700; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.steps li { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: start; padding: 8px 0; position: relative; }
.steps li:not(:last-child)::after { content: ''; position: absolute; left: 10px; top: 28px; bottom: -6px; width: 2px; background: var(--line-2); }
.steps li.done:not(:last-child)::after { background: var(--accent); }
.sd { width: 22px; height: 22px; border-radius: 999px; display: grid; place-items: center; border: 2px solid var(--line-2); background: var(--surface); color: white; }
.done .sd { background: var(--accent); border-color: var(--accent); }
.current .sd { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.blocked .sd { background: var(--danger); border-color: var(--danger); }
.sb { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.pending .sb strong { color: var(--ink-3); }
.sw { font-size: 12px; white-space: nowrap; }
.docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.docs li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.dn { display: flex; flex-direction: column; min-width: 0; }
.da { display: flex; gap: 4px; }
.fm-link { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.fm-h { display: flex; gap: 8px; align-items: center; }
.fm-sum { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 13px; }
</style>
