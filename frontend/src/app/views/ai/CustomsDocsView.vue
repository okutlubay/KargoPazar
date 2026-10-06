<script setup>
// Customs document automation (spec 6.6): pick an international first mile shipment, the system
// prepares CN22/CN23 (by value), commercial invoice, normalized customs descriptions, HS codes,
// origin, totals and country rule checks (prohibited HS prefixes, de minimis). PDF preview in an
// iframe, merged PDF download, attach to the shipment, live automation statistics.
import { ref, computed, onMounted, onBeforeUnmount, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import Spinner from '../../components/Spinner.vue'
import Modal from '../../components/Modal.vue'
import Tabs from '../../components/Tabs.vue'
import StatusPill from '../../components/StatusPill.vue'
import FormField from '../../components/FormField.vue'
import Donut from '../../components/charts/Donut.vue'
import HsCodePicker from '../../components/ai/HsCodePicker.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { useI18n } from '../../i18n/index.js'
import { listCustomsShipments, prepareCustomsDocs, attachCustomsDocs, listCustomsDocuments, automationStats, CN22_LIMIT_USD } from '../../api/customs.js'

const { t, tx, fmt, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const errText = e => {
  const k = `aiCustoms.errors.${e?.code}`
  const s = e?.code ? t(k) : k
  return s !== k ? s : t('common.errorGeneric')
}

// ------------------------------------------------------------------ list
const listLoading = ref(true)
const shipments = ref([])
const q = ref('')
async function loadList(silent = false) {
  if (!silent) listLoading.value = true
  try { shipments.value = await listCustomsShipments() } catch { toast.error(t('aiCustoms.loadFailed')) } finally { listLoading.value = false }
}
const filteredList = computed(() => {
  const s = q.value.trim().toLowerCase()
  return shipments.value.filter(x => !s || [x.id, x.sender?.company, x.sender?.name, x.origin].some(v => String(v || '').toLowerCase().includes(s)))
})

// ------------------------------------------------------------------ draft
const selectedId = ref(null)
const draft = ref(null)
const draftLoading = ref(false)
const edits = ref({})
const docs = ref([])
async function select(id, { keepEdits = false } = {}) {
  if (!id) return
  if (selectedId.value !== id) edits.value = {}
  else if (!keepEdits) edits.value = {}
  selectedId.value = id
  if (route.query.intl !== id) router.replace({ query: { ...route.query, intl: id } })
  draftLoading.value = true
  try {
    const [d, list] = await Promise.all([prepareCustomsDocs(id, { edits: edits.value }), listCustomsDocuments({ intlId: id })])
    if (selectedId.value !== id) return
    draft.value = d
    docs.value = list
  } catch (e) { toast.error(errText(e)); draft.value = null } finally { draftLoading.value = false }
}
const current = computed(() => shipments.value.find(s => s.id === selectedId.value) || null)
const blocking = computed(() => (draft.value?.checks || []).filter(c => c.severity === 'danger'))
const intl = computed(() => draft.value?.shipment || null)

function checkParams(c) {
  const p = { ...c.params }
  for (const [k, v] of Object.entries(p)) if (v && typeof v === 'object' && ('tr' in v || 'en' in v)) p[k] = tx(v)
  if (p.value != null) p.value = fmt.money(p.value)
  if (p.declared != null) p.declared = fmt.money(p.declared)
  if (p.limit != null) p.limit = fmt.moneyNative(p.limit, 'USD', 0)
  if (p.threshold != null) p.threshold = fmt.moneyNative(p.threshold, c.params.currency || 'USD', 0)
  if (p.prob != null) p.prob = fmt.percent(p.prob, 0)
  if (p.net != null) p.net = fmt.number(p.net, 2)
  if (p.gross != null) p.gross = fmt.number(p.gross, 2)
  return p
}
const sevIcon = s => ({ success: 'check-circle', info: 'info', warning: 'alert', danger: 'x-circle' }[s] || 'info')
const sortedChecks = computed(() => {
  const order = { danger: 0, warning: 1, info: 2, success: 3 }
  return (draft.value?.checks || []).slice().sort((a, b) => order[a.severity] - order[b.severity])
})

// ------------------------------------------------------------------ edit item
const ed = reactive({ open: false, item: null, description: '', hsCode: '', origin: '', err: {} })
function openEdit(it) {
  Object.assign(ed, { open: true, item: it, description: it.description, hsCode: it.hsCode || '', origin: it.origin || '', err: {} })
}
async function saveEdit() {
  ed.err = {}
  if (String(ed.description).trim().length < 3) ed.err.description = t('aiCustoms.edit.descErr')
  if (!/^[A-Za-z]{2}$/.test(String(ed.origin).trim())) ed.err.origin = t('aiCustoms.edit.originErr')
  if (Object.keys(ed.err).length) return
  const it = ed.item
  const e = {}
  if (ed.description.trim() !== it.autoDescription) e.description = ed.description.trim()
  if (ed.hsCode && ed.hsCode !== it.hsCode) e.hsCode = ed.hsCode
  else if (edits.value[it.key]?.hsCode && ed.hsCode === it.hsCode) e.hsCode = ed.hsCode
  if (ed.origin.toUpperCase() !== (it.origin || '')) e.origin = ed.origin.toUpperCase()
  else if (edits.value[it.key]?.origin) e.origin = ed.origin.toUpperCase()
  edits.value = { ...edits.value, [it.key]: e }
  ed.open = false
  await select(selectedId.value, { keepEdits: true })
  toast.success(t('aiCustoms.edit.applied'))
}
async function resetEdit() {
  const next = { ...edits.value }
  delete next[ed.item.key]
  edits.value = next
  ed.open = false
  await select(selectedId.value, { keepEdits: true })
}

// ------------------------------------------------------------------ preview
const tab = ref('merged')
const tabs = computed(() => [
  { key: 'merged', label: t('aiCustoms.docs.merged') },
  { key: 'invoice', label: t('aiCustoms.docs.invoice') },
  { key: 'form', label: draft.value ? t(`aiCustoms.form.${draft.value.form}`) : 'CN' },
])
const pdfUrl = ref('')
const rendering = ref(false)
let D = null
async function docsLib() { if (!D) D = await import('../../docs/index.js'); return D }
function customsData(lib) { return lib.buildCustomsData(draft.value.shipment, draft.value.buildOpts) }
async function renderPreview() {
  if (!draft.value) return
  rendering.value = true
  try {
    const lib = await docsLib()
    const data = customsData(lib)
    const url = tab.value === 'merged'
      ? lib.customsBundleBlobUrl(data, { include: ['commercial_invoice', 'auto'] })
      : tab.value === 'invoice' ? lib.commercialInvoiceBlobUrl(data) : draft.value.form === 'cn22' ? lib.cn22BlobUrl(data) : lib.cn23BlobUrl(data)
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
    pdfUrl.value = url
  } catch (e) {
    console.error(e)
    toast.error(t('aiCustoms.docs.failed'))
  } finally { rendering.value = false }
}
watch([draft, tab, locale], () => renderPreview())
onBeforeUnmount(() => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value) })

async function downloadAll() {
  try {
    const lib = await docsLib()
    const f = lib.downloadCustomsBundle(customsData(lib), { include: ['commercial_invoice', 'auto'] })
    toast.success(t('aiCustoms.docs.downloaded', { f }))
  } catch { toast.error(t('aiCustoms.docs.failed')) }
}
async function downloadOne() {
  try {
    const lib = await docsLib()
    const data = customsData(lib)
    const f = tab.value === 'merged' ? lib.downloadCustomsBundle(data, { include: ['commercial_invoice', 'auto'] })
      : tab.value === 'invoice' ? lib.downloadCommercialInvoice(data) : draft.value.form === 'cn22' ? lib.downloadCn22(data) : lib.downloadCn23(data)
    toast.success(t('aiCustoms.docs.downloaded', { f }))
  } catch { toast.error(t('aiCustoms.docs.failed')) }
}

const attaching = ref(false)
async function attach() {
  if (blocking.value.length) { toast.error(t('aiCustoms.docs.blocked')); return }
  const meta = intl.value?.customsDocsMeta
  if (meta) {
    const ok = await confirm({ title: t('aiCustoms.docs.attachConfirmTitle'), message: t('aiCustoms.docs.attachConfirmMsg', { id: selectedId.value, d: fmt.dateTime(meta.attachedAt) }), confirmLabel: t('aiCustoms.docs.reattach') })
    if (!ok) return
  }
  attaching.value = true
  try {
    const res = await attachCustomsDocs(selectedId.value, { edits: edits.value })
    toast.success(t('aiCustoms.docs.attached', { n: res.documents.length, id: selectedId.value }))
    await Promise.all([loadList(true), loadStats(), select(selectedId.value, { keepEdits: true })])
  } catch (e) { toast.error(errText(e)) } finally { attaching.value = false }
}

// ------------------------------------------------------------------ stats
const stats = ref(null)
async function loadStats() {
  try { stats.value = await automationStats() } catch { toast.error(t('aiCustoms.loadFailed')) }
}
const hsDonut = computed(() => stats.value ? ['item', 'catalog', 'model', 'user', 'none'].map((k, i) => ({ key: k, label: t(`aiCustoms.items.hsSource.${k}`), value: stats.value.hsBySource[k] || 0, color: ['var(--accent)', 'var(--success)', 'oklch(0.62 0.14 300)', 'var(--warning)', 'var(--ink-4)'][i] })).filter(x => x.value) : [])

onMounted(async () => {
  loadStats()
  await loadList()
  const want = typeof route.query.intl === 'string' ? route.query.intl : null
  const first = shipments.value.find(s => s.id === want) || shipments.value.find(s => !s.docsAttached) || shipments.value[0]
  if (first) select(first.id)
})
watch(() => route.query.intl, v => { if (typeof v === 'string' && v !== selectedId.value && shipments.value.some(s => s.id === v)) select(v) })
function openIntl() { router.push({ name: 'intl-detail', params: { id: selectedId.value } }) }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.aiCustomsDocs')" :subtitle="t('aiCustoms.subtitle')" badge="AI" />

    <div class="grid-kpi blk">
      <KpiCard :label="t('aiCustoms.stats.autoRate')" :value="stats ? fmt.percent(stats.autoRate, 1) : ''" :hint="stats ? t('aiCustoms.stats.autoHint', { a: fmt.number(stats.autoFields), n: fmt.number(stats.fields) }) : ''" :loading="!stats" tone="accent" icon="wand" />
      <KpiCard :label="t('aiCustoms.stats.correctionRate')" :value="stats ? fmt.percent(stats.correctionRate, 1) : ''" :hint="stats ? t('aiCustoms.stats.correctionHint', { c: stats.correctedFields, s: stats.sets }) : ''" :loading="!stats" icon="edit" invert />
      <KpiCard :label="t('aiCustoms.stats.normalized')" :value="stats ? fmt.percent(stats.descNormalizedRate, 0) : ''" :hint="stats ? t('aiCustoms.stats.normalizedHint', { n: stats.descNormalized, i: stats.items }) : ''" :loading="!stats" icon="file" />
      <KpiCard :label="t('aiCustoms.stats.forms')" :value="stats ? `${stats.cn22} / ${stats.cn23}` : ''" :hint="stats ? t('aiCustoms.stats.formsHint', { d: stats.deMinimisExceeded }) : ''" :loading="!stats" icon="globe" />
    </div>

    <div class="layout blk">
      <!-- shipment picker -->
      <aside class="panel picker">
        <div class="pk-h">
          <div class="panel-title">{{ t('aiCustoms.pick.title') }}</div>
          <div class="pk-s"><Icon name="search" :size="14" class="si" /><input v-model="q" class="input" :placeholder="t('aiCustoms.pick.search')" :aria-label="t('aiCustoms.pick.search')" /></div>
        </div>
        <div v-if="listLoading" class="pk-list"><Skeleton v-for="i in 6" :key="i" variant="rect" :height="56" /></div>
        <EmptyState v-else-if="!shipments.length" compact icon="plane" :title="t('aiCustoms.pick.empty')" :description="t('aiCustoms.pick.emptyDesc')" :action-label="t('aiCustoms.pick.newIntl')" @action="router.push({ name: 'intl-new' })" />
        <EmptyState v-else-if="!filteredList.length" compact icon="search" :title="t('aiCustoms.pick.filtered')" :action-label="t('common.clearFilters')" action-variant="ghost" @action="q = ''" />
        <ul v-else class="pk-list" role="listbox" :aria-label="t('aiCustoms.pick.title')">
          <li v-for="s in filteredList" :key="s.id">
            <button type="button" role="option" :aria-selected="s.id === selectedId" :class="['pk-item', { on: s.id === selectedId }]" @click="select(s.id)">
              <div class="pi-top">
                <span class="flag">{{ s.origin }}</span>
                <b class="mono">{{ s.id }}</b>
                <span :class="['tag', s.form === 'cn22' ? '' : 'tag-accent', 'formtag']">{{ s.form.toUpperCase() }}</span>
              </div>
              <div class="pi-s">{{ s.sender?.company || s.sender?.name }}</div>
              <div class="pi-b">
                <span class="num">{{ fmt.money(s.declaredValueUsd) }}</span>
                <span :class="['att', { ok: s.docsAttached }]"><Icon :name="s.docsAttached ? 'check-circle' : 'clock'" :size="12" />{{ s.docsAttached ? t('aiCustoms.pick.attached') : t('aiCustoms.pick.notAttached') }}</span>
              </div>
            </button>
          </li>
        </ul>
      </aside>

      <!-- draft -->
      <section class="detail">
        <div v-if="!selectedId && !listLoading" class="panel panel-pad"><EmptyState icon="file" :title="t('aiCustoms.none.title')" :description="t('aiCustoms.none.desc')" /></div>
        <template v-else-if="draft || draftLoading">
          <div :class="['panel', 'head', { busy: draftLoading }]">
            <template v-if="draft">
              <div class="h-top">
                <div>
                  <div class="h-id"><span class="flag">{{ intl.origin }}</span><b class="mono">{{ intl.id }}</b>
                    <span :class="['tag', 'formbig', draft.form === 'cn22' ? '' : 'tag-accent']">{{ t(`aiCustoms.form.${draft.form}`) }}</span>
                    <Spinner v-if="draftLoading" :size="14" />
                  </div>
                  <div class="h-reason">{{ t(draft.form === 'cn22' ? 'aiCustoms.form.reason22' : 'aiCustoms.form.reason23', { v: fmt.moneyNative(draft.totals.value, 'USD'), l: fmt.moneyNative(CN22_LIMIT_USD, 'USD', 0) }) }}</div>
                </div>
                <button class="btn btn-ghost btn-sm" @click="openIntl"><Icon name="external" :size="13" />{{ t('aiCustoms.head.openIntl') }}</button>
              </div>
              <dl class="h-kv">
                <div><dt>{{ t('aiCustoms.head.sender') }}</dt><dd>{{ intl.sender?.company || intl.sender?.name }}<span class="muted"> · {{ intl.sender?.city }}</span></dd></div>
                <div><dt>{{ t('aiCustoms.head.route') }}</dt><dd>{{ intl.origin }} → US · {{ intl.destHub }}</dd></div>
                <div><dt>{{ t('aiCustoms.head.stage') }}</dt><dd>{{ t(`intl.stages.${intl.stage}`) }}</dd></div>
                <div><dt>{{ t('aiCustoms.head.value') }}</dt><dd class="num">{{ fmt.money(draft.totals.value) }}</dd></div>
                <div><dt>{{ t('aiCustoms.head.declared') }}</dt><dd class="num">{{ fmt.money(draft.totals.declared) }}<span v-if="intl.currency && intl.currency !== 'USD'" class="muted"> ({{ fmt.money(intl.declaredValueLocal, intl.currency) }})</span></dd></div>
              </dl>
            </template>
            <Skeleton v-else variant="lines" :lines="3" />
          </div>

          <Card :title="t('aiCustoms.items.title')" :subtitle="t('aiCustoms.items.subtitle')" icon="list" padding="none" class="blk">
            <Skeleton v-if="!draft" variant="lines" :lines="5" class="pad" />
            <div v-else class="table-wrap">
              <table class="table-simple it">
                <thead><tr>
                  <th>{{ t('aiCustoms.items.cols.description') }}</th><th>{{ t('aiCustoms.items.cols.hs') }}</th><th>{{ t('aiCustoms.items.cols.origin') }}</th>
                  <th class="r">{{ t('aiCustoms.items.cols.qty') }}</th><th class="r hide-md">{{ t('aiCustoms.items.cols.unit') }}</th><th class="r">{{ t('aiCustoms.items.cols.total') }}</th><th class="r hide-md">{{ t('aiCustoms.items.cols.weight') }}</th><th />
                </tr></thead>
                <tbody>
                  <tr v-for="it in draft.items" :key="it.key" tabindex="0" @click="openEdit(it)" @keydown.enter="openEdit(it)">
                    <td class="dcell">
                      <div class="d-new">{{ it.description }}
                        <span :class="['tag', 'src', it.descriptionSource === 'user' ? 'tag-warning' : it.descriptionSource === 'template' ? 'tag-success' : '']">{{ t(`aiCustoms.items.descSource.${it.descriptionSource}`) }}</span>
                        <span v-if="it.needsReview" class="tag tag-warning src">{{ t('aiCustoms.items.review') }}</span>
                      </div>
                      <div class="d-old">{{ t('aiCustoms.items.original', { t: it.title }) }}<span v-if="it.sku" class="mono"> · {{ it.sku }}</span></div>
                      <div v-if="it.normalization.length" class="steps">
                        <span v-for="(s, i) in it.normalization" :key="i" class="step" :title="t(`aiCustoms.items.stepCodes.${s.code}`)">
                          {{ t(`aiCustoms.items.stepCodes.${s.code}`) }}<template v-if="s.from || s.to">: <s v-if="s.from">{{ s.from }}</s><template v-if="s.to"> → {{ s.to }}</template></template>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="num code">{{ it.hsCode || '-' }}</div>
                      <div class="sub">{{ t(`aiCustoms.items.hsSource.${it.hsSource}`) }}<template v-if="it.hsSource === 'model' && it.hsConfidence != null"> · {{ fmt.percent(it.hsConfidence, 0) }}</template></div>
                    </td>
                    <td><div>{{ it.origin || '-' }}</div><div class="sub">{{ t(`aiCustoms.items.originSource.${it.originSource}`) }}</div></td>
                    <td class="r num">{{ it.qty }}</td>
                    <td class="r num hide-md">{{ fmt.money(it.unitValue) }}</td>
                    <td class="r num"><b>{{ fmt.money(it.totalValue) }}</b></td>
                    <td class="r num hide-md">{{ fmt.number(it.weightKg, 2) }} kg</td>
                    <td class="r"><button class="btn btn-ghost btn-xs" :aria-label="t('aiCustoms.items.edit')" @click.stop="openEdit(it)"><Icon name="edit" :size="12" /><span v-if="it.edited.length" class="ed">{{ t('aiCustoms.items.edited') }}</span></button></td>
                  </tr>
                </tbody>
              </table>
              <dl class="totals">
                <div><dt>{{ t('aiCustoms.items.totalValue') }}</dt><dd class="num">{{ fmt.money(draft.totals.value) }}</dd></div>
                <div><dt>{{ t('aiCustoms.items.qty') }}</dt><dd class="num">{{ draft.totals.qty }}</dd></div>
                <div><dt>{{ t('aiCustoms.items.parcels') }}</dt><dd class="num">{{ draft.totals.parcels }}</dd></div>
                <div><dt>{{ t('aiCustoms.items.net') }}</dt><dd class="num">{{ fmt.number(draft.totals.weightKg, 2) }} kg</dd></div>
                <div><dt>{{ t('aiCustoms.items.gross') }}</dt><dd class="num">{{ fmt.number(draft.totals.grossKg, 2) }} kg</dd></div>
              </dl>
            </div>
          </Card>

          <div class="two blk">
            <Card :title="t('aiCustoms.checks.title')" :subtitle="t('aiCustoms.checks.subtitle')" icon="shield">
              <Skeleton v-if="!draft" variant="lines" :lines="5" />
              <template v-else>
                <div :class="['sumline', blocking.length ? 'bad' : 'good']"><Icon :name="blocking.length ? 'x-circle' : 'check-circle'" :size="14" />{{ blocking.length ? t('aiCustoms.checks.blocking', { n: blocking.length }) : t('aiCustoms.checks.allOk') }}</div>
                <ul class="checks">
                  <li v-for="(c, i) in sortedChecks" :key="i" :class="c.severity"><Icon :name="sevIcon(c.severity)" :size="14" /><span>{{ t(`aiCustoms.checks.codes.${c.code}`, checkParams(c)) }}</span></li>
                </ul>
                <div class="sub-h">{{ t('aiCustoms.checks.reference') }}</div>
                <div class="table-wrap">
                  <table class="table-simple ref">
                    <thead><tr><th>{{ t('aiCustoms.checks.refCols.country') }}</th><th>{{ t('aiCustoms.checks.refCols.threshold') }}</th><th class="r">{{ t('aiCustoms.checks.refCols.usd') }}</th><th class="r hide-md">{{ t('aiCustoms.checks.refCols.vat') }}</th><th>{{ t('aiCustoms.checks.refCols.status') }}</th></tr></thead>
                    <tbody>
                      <tr v-for="r in draft.reference" :key="r.code" :class="{ applies: r.applies }">
                        <td><span class="flag">{{ r.code }}</span> {{ tx(r.name) }} <span class="muted small">· {{ t(`aiCustoms.checks.roles.${r.role}`) }}</span><span v-if="r.isNewMarket" class="tag small-tag">{{ t('aiCustoms.checks.newMarket') }}</span></td>
                        <td class="num">{{ fmt.money(r.threshold, r.currency, 0) }}</td>
                        <td class="r num">{{ fmt.moneyNative(r.thresholdUsd, 'USD', 0) }}</td>
                        <td class="r num hide-md">{{ fmt.percent(r.vatRate, 0) }}</td>
                        <td>
                          <span :class="['tag', r.exceeded ? 'tag-warning' : 'tag-success']">{{ r.exceeded ? t('aiCustoms.checks.over') : t('aiCustoms.checks.under') }}</span>
                          <span v-if="r.applies" class="tag tag-accent">{{ t('aiCustoms.checks.applies') }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </Card>

            <Card :title="t('aiCustoms.docs.history')" icon="file">
              <Skeleton v-if="!draft" variant="lines" :lines="4" />
              <template v-else>
                <div v-if="intl.customsDocsMeta" class="callout neutral att-m"><Icon name="check-circle" :size="14" />{{ t('aiCustoms.docs.attachedAt', { d: fmt.dateTime(intl.customsDocsMeta.attachedAt), by: intl.customsDocsMeta.by }) }}</div>
                <ul v-if="docs.length" class="dh">
                  <li v-for="d in docs" :key="d.id">
                    <Icon name="file" :size="14" />
                    <div class="dh-b">
                      <div><b>{{ t(`aiCustoms.docs.types.${d.type}`) }}</b> <span class="mono muted">{{ d.docNo }}</span></div>
                      <div class="muted small">{{ fmt.dateTime(d.at) }} · {{ d.source === 'seed' ? t('aiCustoms.docs.sourceSeed') : t('aiCustoms.docs.sourceAuto') }}<template v-if="d.autoRate != null"> · {{ fmt.percent(d.autoRate, 0) }}</template></div>
                    </div>
                    <span class="num">{{ fmt.money(d.valueUsd) }}</span>
                  </li>
                </ul>
                <div v-else class="muted small">{{ t('aiCustoms.docs.historyEmpty') }}</div>
                <div class="sub-h hs-h">{{ t('aiCustoms.stats.hsSources') }}</div>
                <Donut v-if="hsDonut.length" :data="hsDonut" :size="130" legend-position="right" show-values />
              </template>
            </Card>
          </div>

          <Card :title="t('aiCustoms.docs.title')" icon="eye" class="blk">
            <template #actions>
              <button class="btn btn-ghost btn-sm" :disabled="!draft" @click="downloadOne"><Icon name="download" :size="13" />{{ t('aiCustoms.docs.downloadOne') }}</button>
              <button class="btn btn-soft btn-sm" :disabled="!draft" @click="downloadAll"><Icon name="download" :size="13" />{{ t('aiCustoms.docs.downloadAll') }}</button>
              <button class="btn btn-accent btn-sm" :disabled="!draft || attaching || blocking.length > 0" :title="blocking.length ? t('aiCustoms.docs.blocked') : ''" @click="attach">
                <Spinner v-if="attaching" :size="13" /><Icon v-else name="link" :size="13" />{{ intl?.customsDocsMeta ? t('aiCustoms.docs.reattach') : t('aiCustoms.docs.attach') }}
              </button>
            </template>
            <Tabs v-model="tab" :tabs="tabs" variant="pill" :aria-label="t('aiCustoms.docs.title')" />
            <div class="pdf">
              <iframe v-if="pdfUrl" :key="pdfUrl" :src="pdfUrl" :title="t('aiCustoms.docs.title')" />
              <div v-if="rendering || !pdfUrl" class="pdf-load"><Spinner :size="18" /> {{ t('aiCustoms.docs.rendering') }}</div>
            </div>
            <div class="muted small note"><Icon name="info" :size="12" /> {{ t('aiCustoms.docs.zipNote') }}</div>
          </Card>
        </template>
      </section>
    </div>

    <Card :title="t('aiCustoms.activity')" icon="clock" class="blk">
      <ModelActivityLog module="customs" :limit="8" />
    </Card>

    <Modal v-model:open="ed.open" :title="t('aiCustoms.edit.title')" :subtitle="ed.item ? ed.item.title : ''" size="lg">
      <div v-if="ed.item" class="edf">
        <FormField :label="t('aiCustoms.edit.description')" :hint="t('aiCustoms.edit.descHint')" :error="ed.err.description" required v-slot="{ id, invalid }">
          <textarea :id="id" v-model="ed.description" class="input ta" rows="2" :aria-invalid="invalid" />
        </FormField>
        <div class="auto">{{ t('aiCustoms.edit.auto', { t: ed.item.autoDescription }) }} <button type="button" class="btn btn-link" @click="ed.description = ed.item.autoDescription">{{ t('aiCustoms.edit.useAuto') }}</button></div>
        <FormField :label="t('aiCustoms.edit.origin')" :error="ed.err.origin" required v-slot="{ id, invalid }">
          <input :id="id" v-model="ed.origin" class="input orig" maxlength="2" :aria-invalid="invalid" />
        </FormField>
        <div class="lbl">{{ t('aiCustoms.edit.hs') }}: <b class="mono">{{ ed.hsCode || '-' }}</b></div>
        <HsCodePicker v-model="ed.hsCode" :highlight="(ed.item.hsTop || []).map(x => x.code)" />
      </div>
      <template #footer>
        <button v-if="ed.item && edits[ed.item.key]" class="btn btn-ghost btn-sm reset" @click="resetEdit">{{ t('aiCustoms.edit.reset') }}</button>
        <button class="btn btn-ghost btn-sm" @click="ed.open = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary btn-sm" @click="saveEdit">{{ t('aiCustoms.edit.save') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.blk { margin-bottom: 16px; }
.layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
.picker { padding: 12px; position: sticky; top: calc(var(--kpz-sticky-top, 0px) + 12px); }
@media (max-width: 1000px) { .picker { position: static; } }
.pk-h { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.pk-s { position: relative; }
.si { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--ink-3); }
.pk-s .input { padding-left: 32px; width: 100%; }
.pk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 640px; overflow-y: auto; }
@media (max-width: 1000px) { .pk-list { max-height: 280px; } }
.pk-item { width: 100%; text-align: left; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 9px 11px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.pk-item:hover { border-color: var(--line-strong); }
.pk-item.on { border-color: var(--accent); background: var(--accent-soft); }
.pi-top { display: flex; align-items: center; gap: 8px; }
.formtag { margin-left: auto; height: 18px; font-size: 10.5px; }
.pi-s { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pi-b { display: flex; justify-content: space-between; font-size: 12px; }
.att { display: inline-flex; gap: 4px; align-items: center; color: var(--ink-3); }
.att.ok { color: oklch(0.45 0.1 155); }
.flag { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 18px; padding: 0 4px; border-radius: 4px; background: var(--ink-1); color: var(--surface); font-family: var(--font-mono); font-size: 10.5px; font-weight: 600; letter-spacing: .03em; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.detail { min-width: 0; display: flex; flex-direction: column; }
.head { padding: 14px 16px; margin-bottom: 16px; transition: opacity .15s; }
.head.busy { opacity: .7; }
.h-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.h-id { display: flex; align-items: center; gap: 8px; font-size: 16px; }
.formbig { font-weight: 600; }
.h-reason { font-size: 12.5px; color: var(--ink-3); margin-top: 4px; }
.h-kv { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 14px 0 0; }
@media (max-width: 1200px) { .h-kv { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 600px) { .h-kv { grid-template-columns: 1fr 1fr; } }
.h-kv dt { font-size: 11.5px; color: var(--ink-3); }
.h-kv dd { margin: 2px 0 0; font-size: 13.5px; font-weight: 500; }
.pad { padding: 16px; }
.it td, .it th { padding: 9px 12px; vertical-align: top; }
.it tbody tr { cursor: pointer; }
.it td.num, .it td.r { white-space: nowrap; }
.ref td:not(:first-child) { white-space: nowrap; }
.it tbody tr:hover td { background: var(--bg-2); }
.dcell { min-width: 260px; }
.d-new { font-weight: 500; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.src { height: 18px; font-size: 10.5px; }
.d-old { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.steps { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.step { font-size: 11px; background: var(--bg-3); border-radius: 4px; padding: 1px 6px; color: var(--ink-2); }
.step s { color: var(--ink-3); }
.code { font-family: var(--font-mono); font-weight: 600; }
.sub { font-size: 11.5px; color: var(--ink-3); }
.ed { font-size: 10.5px; color: oklch(0.5 0.12 70); margin-left: 2px; }
.totals { display: flex; flex-wrap: wrap; gap: 8px 28px; padding: 12px 16px; margin: 0; border-top: 1px solid var(--line-1); background: var(--bg-2); }
.totals dt { font-size: 11.5px; color: var(--ink-3); }
.totals dd { margin: 0; font-weight: 600; }
.r { text-align: right; }
.muted { color: var(--ink-3); }
.small { font-size: 12px; }
.two { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1250px) { .two { grid-template-columns: 1fr; } }
.sumline { display: flex; gap: 6px; align-items: center; font-weight: 500; font-size: 13px; margin-bottom: 8px; }
.sumline.good { color: oklch(0.45 0.1 155); }
.sumline.bad { color: var(--danger); }
.checks { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.checks li { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; padding: 7px 10px; border-radius: 8px; background: var(--bg-2); line-height: 1.4; }
.checks li svg { flex: none; margin-top: 2px; }
.checks li.success svg { color: var(--success); }
.checks li.info svg { color: var(--accent); }
.checks li.warning { background: oklch(0.97 0.05 80); }
.checks li.warning svg { color: oklch(0.6 0.14 70); }
.checks li.danger { background: oklch(0.96 0.03 25); }
.checks li.danger svg { color: var(--danger); }
.sub-h { font-weight: 600; font-size: 13px; margin: 4px 0 6px; }
.hs-h { margin-top: 14px; }
.ref td, .ref th { padding: 7px 10px; font-size: 12.5px; }
.ref tr.applies td { background: var(--accent-soft); }
.ref .tag { margin-right: 4px; }
.small-tag { height: 18px; font-size: 10.5px; margin-left: 6px; }
.att-m { margin: 0 0 10px; align-items: center; }
.dh { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dh li { display: flex; gap: 10px; align-items: center; font-size: 13px; padding: 7px 10px; border: 1px solid var(--line-1); border-radius: 8px; }
.dh-b { flex: 1; min-width: 0; }
.pdf { position: relative; margin-top: 12px; height: 640px; border: 1px solid var(--line-1); border-radius: var(--r-md); overflow: hidden; background: var(--bg-3); }
@media (max-width: 700px) { .pdf { height: 440px; } }
.pdf iframe { width: 100%; height: 100%; border: 0; display: block; }
.pdf-load { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--ink-3); font-size: 13px; background: color-mix(in oklch, var(--bg-3) 85%, transparent); }
.note { margin-top: 8px; display: flex; gap: 6px; align-items: center; }
.edf { display: flex; flex-direction: column; gap: 10px; }
.ta { height: auto; padding: 8px 12px; resize: vertical; }
.auto { font-size: 12.5px; color: var(--ink-3); margin-top: -4px; }
.orig { max-width: 90px; text-transform: uppercase; }
.lbl { font-size: 13px; color: var(--ink-2); }
.reset { margin-right: auto; }
@media (max-width: 1100px) { .hide-md { display: none; } }
</style>
