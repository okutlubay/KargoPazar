<script setup>
// Customs Information Center (Customs menu, first tab): duty calculator (product title or HS code,
// country and value -> landed cost; titles run the HS model), country rules summary, recent
// customs declarations and duties paid this month.   /customs/info?hs=6912.00&title=...
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Money from '@/app/components/Money.vue'
import Spinner from '@/app/components/Spinner.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Flag from '@/app/components/intl/Flag.vue'
import CustomsNavTabs from '@/app/components/customs/CustomsNavTabs.vue'
import CustomsInfoPanel from '@/app/components/customs/CustomsInfoPanel.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { db } from '@/app/store/db.js'
import { suggestHs, hsCodeList, normalizeHsCode } from '@/app/api/ai.js'
import { estimateLandedCost } from '@/app/api/landedCost.js'
import { listRecentDeclarations, customsMonthStats } from '@/app/api/customsRecords.js'
import { apiErrorText } from '@/app/components/shipments/helpers.js'

const { t, tx, fmt } = useI18n()
const route = useRoute()
const router = useRouter()

const DESTS = ['US', 'GB', 'DE', 'TR']
const countries = computed(() => db.all('countries'))
const cName = code => { const c = countries.value.find(x => x.code === code); return c ? tx(c.name) : code }
const originOptions = computed(() => [...new Set(['TR', ...countries.value.map(c => c.code)])])
const codes = hsCodeList()

// ---- calculator
const form = ref({
  title: typeof route.query.title === 'string' ? route.query.title : '',
  hs: typeof route.query.hs === 'string' ? (normalizeHsCode(route.query.hs) || route.query.hs) : '',
  origin: 'TR',
  dest: typeof route.query.dest === 'string' && DESTS.includes(route.query.dest) ? route.query.dest : 'US',
  value: 120,
  qty: 1,
})
const incoterm = ref('DDP')
const sugg = ref(null)
const suggesting = ref(false)
const hsError = ref('')
const hsCode = computed(() => normalizeHsCode(form.value.hs))
const items = computed(() => (hsCode.value && Number(form.value.value) > 0
  ? [{ hsCode: hsCode.value, title: form.value.title || (codes.find(c => c.code === hsCode.value) ? tx(codes.find(c => c.code === hsCode.value).desc) : ''), valueUsd: Number(form.value.value), qty: Number(form.value.qty) || 1, origin: form.value.origin }]
  : []))
const quick = computed(() => (items.value.length ? estimateLandedCost({ ...items.value[0], dest: form.value.dest, incoterm: incoterm.value }) : null))

async function findHs() {
  const title = String(form.value.title || '').trim()
  if (!title) { hsError.value = t('customsInfo.center.needTitle'); return }
  hsError.value = ''
  suggesting.value = true
  try {
    const r = await suggestHs(title, '', { source: 'customs_info' })
    sugg.value = r
    if (r.top?.length) form.value.hs = r.top[0].code
  } catch (e) { toast.error(apiErrorText(e)) } finally { suggesting.value = false }
}
watch(() => form.value.hs, v => {
  hsError.value = v && !normalizeHsCode(v) ? t('customsInfo.center.hsFormat') : ''
  const n = normalizeHsCode(v)
  if (n && route.query.hs !== n) router.replace({ query: { ...route.query, hs: n } })
})
watch(() => route.query.hs, v => { if (typeof v === 'string' && normalizeHsCode(v) && normalizeHsCode(v) !== hsCode.value) form.value.hs = normalizeHsCode(v) })

// ---- country rules
const CLEAR = { US: '1-3', GB: '1-2', DE: '1-3', TR: '2-5' }
const rules = computed(() => countries.value.filter(c => c.active !== false).map(c => ({
  code: c.code, name: c.name, currency: c.currency, vatRate: c.vatRate ?? 0, deMinimis: c.deMinimis || null,
  prohibited: c.prohibited || [], clearance: CLEAR[c.code] || '2-5', role: c.role,
})))

// ---- stats + recent declarations
const stats = ref(null)
const recent = ref([])
const loading = ref(true)
const STATUS_TONE = { not_declared: 'neutral', declared: 'info', under_review: 'warning', docs_requested: 'danger', assessed: 'info', released: 'success' }
onMounted(async () => {
  try {
    const [s, r] = await Promise.all([customsMonthStats(), listRecentDeclarations({ limit: 8 })])
    stats.value = s
    recent.value = r
  } catch (e) { toast.error(apiErrorText(e)) } finally { loading.value = false }
})
function openRec(r) { router.push({ name: r.routeName, params: r.routeParams, query: { tab: 'customs' } }) }
</script>

<template>
  <div class="page" data-testid="customs-info-center">
    <PageHeader :title="t('customsInfo.center.title')" :subtitle="t('customsInfo.center.subtitle')" />
    <CustomsNavTabs />

    <div class="kpis">
      <KpiCard :label="t('customsInfo.center.kpi.duties')" :value="stats ? fmt.money(stats.dutiesUsd) : ''" :loading="!stats" icon="dollar" tone="accent" data-testid="customs-month-duties" />
      <KpiCard :label="t('customsInfo.center.kpi.released')" :value="stats ? stats.count : null" :loading="!stats" icon="check-circle" />
      <KpiCard :label="t('customsInfo.center.kpi.declarations')" :value="stats ? stats.declarations : null" :loading="!stats" icon="file" />
      <KpiCard :label="t('customsInfo.center.kpi.rate')" :value="stats ? fmt.percent(stats.avgRate, 1) : ''" :loading="!stats" icon="chart" />
    </div>

    <div class="layout">
      <!-- calculator -->
      <section class="panel panel-pad calc" data-testid="customs-calc">
        <h3 class="section-title"><Icon name="dollar" :size="15" />{{ t('customsInfo.center.calcTitle') }}</h3>
        <p class="muted small">{{ t('customsInfo.center.calcSub') }}</p>
        <div class="fgrid">
          <div class="f wide">
            <label class="field-label" for="ci-title">{{ t('customsInfo.center.productTitle') }}</label>
            <div class="row">
              <input id="ci-title" v-model="form.title" class="input" :placeholder="t('customsInfo.center.titlePh')" data-testid="info-calc-title" @keydown.enter.prevent="findHs" />
              <button type="button" class="btn btn-soft" :disabled="suggesting" data-testid="info-calc-suggest" @click="findHs"><Spinner v-if="suggesting" :size="13" /><Icon v-else name="spark" :size="13" />{{ t('customsInfo.center.findHs') }}</button>
            </div>
          </div>
          <div class="f">
            <label class="field-label" for="ci-hs">{{ t('customsInfo.center.hsCode') }}</label>
            <input id="ci-hs" v-model="form.hs" class="input mono" list="ci-hs-list" placeholder="6912.00" :class="{ invalid: hsError }" data-testid="info-calc-hs" />
            <datalist id="ci-hs-list"><option v-for="c in codes" :key="c.code" :value="c.code">{{ tx(c.desc) }}</option></datalist>
            <div v-if="hsError" class="field-error">{{ hsError }}</div>
          </div>
          <div class="f">
            <label class="field-label" for="ci-origin">{{ t('customsInfo.center.origin') }}</label>
            <select id="ci-origin" v-model="form.origin" class="input select" data-testid="info-calc-origin">
              <option v-for="o in originOptions" :key="o" :value="o">{{ cName(o) }}</option>
            </select>
          </div>
          <div class="f">
            <label class="field-label" for="ci-dest">{{ t('customsInfo.center.dest') }}</label>
            <select id="ci-dest" v-model="form.dest" class="input select" data-testid="info-calc-dest">
              <option v-for="d in DESTS" :key="d" :value="d">{{ cName(d) }}</option>
            </select>
          </div>
          <div class="f">
            <label class="field-label" for="ci-value">{{ t('customsInfo.center.value') }}</label>
            <input id="ci-value" v-model.number="form.value" type="number" min="0" step="0.01" class="input" data-testid="info-calc-value" />
          </div>
          <div class="f">
            <label class="field-label" for="ci-qty">{{ t('customsInfo.center.qty') }}</label>
            <input id="ci-qty" v-model.number="form.qty" type="number" min="1" class="input" data-testid="info-calc-qty" />
          </div>
        </div>
        <div v-if="sugg?.top?.length" class="sugg">
          <span class="badge-ai"><Icon name="spark" :size="10" />AI</span>
          <span class="muted small">{{ t('customsInfo.center.suggested') }}</span>
          <button v-for="s in sugg.top" :key="s.code" type="button" :class="['chip', { on: hsCode === s.code }]" @click="form.hs = s.code">
            <span class="mono">{{ s.code }}</span> {{ tx(s.desc) }} <span class="muted">{{ fmt.percent(s.prob, 0) }}</span>
          </button>
          <span v-if="sugg.lowConfidence" class="tag tag-warning">{{ t('customsInfo.center.lowConfidence') }}</span>
        </div>

        <div v-if="quick" class="result" data-testid="info-calc-result">
          <div class="res-big">
            <span class="muted">{{ t('customsInfo.center.result', { dest: cName(form.dest) }) }}</span>
            <strong class="num"><Money :value="quick.totalDest" :currency="quick.destCurrency" :convert="false" /></strong>
            <span v-if="fmt.currency !== quick.destCurrency" class="muted">≈ <Money :value="quick.totalUsd" /></span>
            <span class="muted small">{{ t('customsInfo.center.landed', { amount: fmt.moneyNative(quick.valueUsd + quick.totalUsd, 'USD') }) }}</span>
          </div>
          <CustomsInfoPanel :items="items" :dest="form.dest" :origin="form.origin" v-model:incoterm="incoterm" :collapsible="false" />
        </div>
        <div v-else class="empty-res muted"><Icon name="info" :size="15" />{{ t('customsInfo.center.empty') }}</div>
      </section>

      <div class="side">
        <!-- recent declarations -->
        <section class="panel">
          <div class="panel-head"><span class="panel-title">{{ t('customsInfo.center.recent') }}</span><span class="panel-sub">{{ t('customsInfo.center.recentSub') }}</span></div>
          <div v-if="loading" class="panel-pad"><Skeleton variant="rect" :height="160" /></div>
          <ul v-else class="recent" data-testid="customs-recent">
            <li v-for="r in recent" :key="r.ref">
              <button type="button" class="rr" @click="openRec(r)">
                <span class="rr-h"><span class="mono strong">{{ r.ref }}</span><StatusPill :status="r.status" :label="t('customsInfo.status.' + r.status)" :tone="STATUS_TONE[r.status]" size="sm" /></span>
                <span class="rr-m muted small"><Flag :code="r.origin" :size="11" /> {{ r.origin }} → {{ r.dest }} · {{ r.kind === 'intl' ? t('customsInfo.center.kindIntl') : t('customsInfo.center.kindDirect') }} · <DateTime :value="r.declaredAt" mode="short" /></span>
                <span class="rr-v small">{{ r.final ? t('customsInfo.record.final') : t('customsInfo.record.estimated') }}: <Money :value="r.final ? r.final.totalUsd : r.estimate.totalUsd" /></span>
              </button>
            </li>
            <li v-if="!recent.length" class="muted panel-pad">{{ t('customsInfo.center.noRecent') }}</li>
          </ul>
        </section>
      </div>
    </div>

    <!-- country rules -->
    <section class="panel">
      <div class="panel-head"><span class="panel-title">{{ t('customsInfo.center.rules') }}</span><span class="panel-sub">{{ t('customsInfo.center.rulesSub') }}</span></div>
      <div class="table-wrap">
        <table class="table-simple" data-testid="customs-country-rules">
          <thead><tr><th>{{ t('customsInfo.center.country') }}</th><th>{{ t('customsInfo.center.deMinimis') }}</th><th class="r">{{ t('customsInfo.center.vat') }}</th><th>{{ t('customsInfo.center.prohibited') }}</th><th>{{ t('customsInfo.center.clearance') }}</th></tr></thead>
          <tbody>
            <tr v-for="c in rules" :key="c.code">
              <td class="nowrap"><Flag :code="c.code" :size="13" /> <strong>{{ tx(c.name) }}</strong> <span class="muted mono">{{ c.currency }}</span></td>
              <td>
                <template v-if="c.deMinimis">
                  <span v-if="c.deMinimis.status === 'suspended'" class="tag tag-warning">{{ t('customsInfo.center.dmSuspended') }}</span>
                  <span v-else class="tag tag-success">{{ t('customsInfo.center.dmApplied', { amount: fmt.moneyNative(c.deMinimis.amount, c.deMinimis.currency, 0) }) }}</span>
                </template>
                <span v-else class="muted">-</span>
              </td>
              <td class="r num">{{ fmt.percent(c.vatRate, 0) }}</td>
              <td class="small">{{ c.prohibited.length ? c.prohibited.map(p => tx(p.category)).join(', ') : '-' }}</td>
              <td class="nowrap">{{ t('customsInfo.center.days', { range: c.clearance }) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small disc"><Icon name="info" :size="12" />{{ t('customsInfo.disclaimer') }} <RouterLink :to="{ name: 'settings', params: { section: 'duties' } }" class="link">{{ t('customsInfo.center.editRates') }}</RouterLink></p>
    </section>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 960px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; align-items: start; }
@media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
.section-title { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.small { font-size: 12px; }
.strong { font-weight: 600; }
.r { text-align: right; }
.nowrap { white-space: nowrap; }
.fgrid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
.f { display: flex; flex-direction: column; min-width: 0; }
.f.wide { grid-column: 1 / -1; }
.row { display: flex; gap: 8px; }
.row .input { flex: 1; min-width: 0; }
@media (max-width: 760px) { .fgrid { grid-template-columns: 1fr 1fr; } }
.sugg { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
.chip { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-1); cursor: pointer; }
.chip.on { border-color: var(--accent); background: var(--accent-soft); }
.result { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; }
.res-big { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 12px 14px; border-radius: var(--r-md); background: var(--accent-soft); }
.res-big strong { font-size: 22px; }
.empty-res { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding: 14px; border: 1px dashed var(--line-2); border-radius: var(--r-md); }
.recent { list-style: none; margin: 0; padding: 0; }
.recent li + li { border-top: 1px solid var(--line-1); }
.rr { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; background: none; border: 0; padding: 10px 14px; cursor: pointer; font: inherit; color: inherit; }
.rr:hover { background: var(--bg-2); }
.rr-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.disc { display: flex; gap: 6px; align-items: center; padding: 0 14px 12px; flex-wrap: wrap; }
</style>
