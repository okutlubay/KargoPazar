<script setup>
// Carrier, service and hub optimizer (spec 6.4): revised scope box, simulator (scatter, ranked
// table, live score breakdown while the cost/speed slider moves), reliability heatmap from real
// shipments, AI pick performance summary, batch optimization entry point.
import { ref, computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Card from '../../components/Card.vue'
import KpiCard from '../../components/KpiCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import Spinner from '../../components/Spinner.vue'
import Slider from '../../components/Slider.vue'
import Toggle from '../../components/Toggle.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import FormField from '../../components/FormField.vue'
import ScatterChart from '../../components/charts/ScatterChart.vue'
import HeatmapGrid from '../../components/charts/HeatmapGrid.vue'
import BarChart from '../../components/charts/BarChart.vue'
import Donut from '../../components/charts/Donut.vue'
import ContributionBars from '../../components/ai/ContributionBars.vue'
import ModelActivityLog from '../../components/ai/ModelActivityLog.vue'
import { toast } from '../../components/toast.js'
import { useI18n } from '../../i18n/index.js'
import { simulate, scoreQuotes, carrierReliabilityMatrix, acceptanceStats } from '../../api/ai.js'
import { listCarriers } from '../../api/carriers.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()

// ------------------------------------------------------------------ simulator
const form = reactive({ toZip: '90210', weightLb: 3, lengthIn: 12, widthIn: 10, heightIn: 6, declaredValue: 85, residential: true })
const errors = reactive({})
const speed = ref(40) // 0 = all cost, 100 = all speed; cost weight w = 1 - speed / 100
const w = computed(() => Math.round((1 - speed.value / 100) * 100) / 100)
const running = ref(false)
const sim = ref(null) // API result (quotes + reliability)
const scored = ref(null) // local re-score for the current slider
const selectedId = ref(null)
const change = ref(null)
const showAllRows = ref(false)

const PRESETS = [
  { key: 'la', label: 'Beverly Hills, CA', zip: '90210' },
  { key: 'ny', label: 'Brooklyn, NY', zip: '11201' },
  { key: 'tx', label: 'Austin, TX', zip: '78701' },
  { key: 'il', label: 'Chicago, IL', zip: '60614' },
  { key: 'fl', label: 'Miami, FL', zip: '33131' },
  { key: 'wa', label: 'Seattle, WA', zip: '98101' },
]

function validate() {
  for (const k of Object.keys(errors)) delete errors[k]
  if (!/^\d{5}$/.test(String(form.toZip).trim())) errors.toZip = t('aiOptimizer.sim.errors.zip')
  const wt = Number(form.weightLb)
  if (!(wt >= 0.1 && wt <= 150)) errors.weightLb = t('aiOptimizer.sim.errors.weight')
  if (['lengthIn', 'widthIn', 'heightIn'].some(k => !(Number(form[k]) >= 1 && Number(form[k]) <= 108))) errors.dims = t('aiOptimizer.sim.errors.dims')
  return !Object.keys(errors).length
}

const idOf = r => r.quote.key + '@' + r.quote.hub
const nameOf = r => r.quote.serviceName || `${r.quote.carrierName} ${r.quote.serviceCode || ''}`

async function runSim() {
  if (!validate()) return
  running.value = true
  try {
    const res = await simulate({ ...form, toZip: String(form.toZip).trim(), weight: w.value })
    sim.value = res
    scored.value = res
    selectedId.value = res.best ? idOf(res.best) : null
    change.value = null
    showAllRows.value = false
  } catch (e) {
    if (e?.code === 'INVALID_ZIP') errors.toZip = t('aiOptimizer.sim.errors.zip')
    else if (e?.code === 'UNKNOWN_ZIP') errors.toZip = t('aiOptimizer.sim.errors.unknownZip')
    else toast.error(t('aiOptimizer.sim.errors.failed'))
  } finally { running.value = false }
}
function usePreset(p) { form.toZip = p.zip; runSim() }

// live re-score while the slider moves (no API round trip)
function rescore() {
  if (!sim.value?.quotes) return
  const prevBest = scored.value?.best
  const prevSelectedWasBest = prevBest && selectedId.value === idOf(prevBest)
  const res = scoreQuotes(sim.value.quotes, { weight: w.value, reliability: sim.value.reliability })
  scored.value = res
  if (res.best && prevBest && idOf(res.best) !== idOf(prevBest)) change.value = { from: nameOf(prevBest) + ' · ' + prevBest.quote.hub, to: nameOf(res.best) + ' · ' + res.best.quote.hub }
  if (prevSelectedWasBest && res.best) selectedId.value = idOf(res.best)
}

const ranked = computed(() => scored.value?.ranked || [])
const best = computed(() => scored.value?.best || null)
const selected = computed(() => ranked.value.find(r => idOf(r) === selectedId.value) || best.value)
const hubCount = computed(() => new Set(ranked.value.map(r => r.quote.hub)).size)
const points = computed(() => ranked.value.map(r => ({
  key: idOf(r),
  x: r.quote.total,
  y: r.quote.effectiveEtaDays ?? r.quote.etaDays,
  r: r.components.reliabilityRaw,
  label: nameOf(r),
  sublabel: `${r.quote.hub} · ${t('aiOptimizer.sim.cols.score')} ${fmt.number(r.score, 3)}`,
  highlighted: idOf(r) === selectedId.value,
  color: best.value && idOf(r) === idOf(best.value) ? 'var(--accent)' : undefined,
})))
const breakdown = computed(() => {
  const s = selected.value
  if (!s) return []
  const c = s.components
  return [
    { key: 'cost', label: t('aiOptimizer.sim.comp.cost'), value: c.weights.cost * c.cost, hint: `${fmt.number(c.cost, 3)} x ${fmt.number(c.weights.cost, 2)}` },
    { key: 'speed', label: t('aiOptimizer.sim.comp.speed'), value: c.weights.speed * c.speed, hint: `${fmt.number(c.speed, 3)} x ${fmt.number(c.weights.speed, 2)}` },
    { key: 'reliability', label: t('aiOptimizer.sim.comp.reliability'), value: c.weights.reliability * c.reliability, hint: `${fmt.percent(c.reliabilityRaw, 1)}` },
    { key: 'risk', label: t('aiOptimizer.sim.comp.risk'), value: -c.risk },
  ]
})
const shownRows = computed(() => showAllRows.value ? ranked.value : ranked.value.slice(0, 10))
const defaultChoice = computed(() => scored.value?.defaultChoice || null)
const savings = computed(() => scored.value?.savingsVsDefault ?? null)

// ------------------------------------------------------------------ reliability + performance
const relLoading = ref(true)
const rel = ref(null)
const carriers = ref([])
const perfLoading = ref(true)
const perf = ref(null)
async function loadRel() {
  try {
    const [m, cs] = await Promise.all([carrierReliabilityMatrix(), listCarriers().catch(() => [])])
    rel.value = m
    carriers.value = cs
  } catch { toast.error(t('aiOptimizer.loadFailed')) } finally { relLoading.value = false }
}
async function loadPerf() {
  try { perf.value = await acceptanceStats({ days: 90 }) } catch { toast.error(t('aiOptimizer.loadFailed')) } finally { perfLoading.value = false }
}
const carrierName = code => carriers.value.find(c => c.code === code)?.name || code
const heatRows = computed(() => (rel.value?.carriers || []).map(c => ({ key: c, label: carrierName(c) })))
const heatCols = computed(() => (rel.value?.zones || []).map(z => ({ key: String(z), label: String(z) })))
const cellOf = (c, z) => rel.value?.cells.find(x => x.carrier === c && x.zone === z)
const heatValues = computed(() => (rel.value?.carriers || []).map(c => rel.value.zones.map(z => cellOf(c, z)?.smoothed ?? null)))
const heatMeta = computed(() => (rel.value?.carriers || []).map(c => rel.value.zones.map(z => cellOf(c, z))))
const heatDomain = computed(() => {
  const vals = heatValues.value.flat().filter(v => v != null)
  if (!vals.length) return [0.8, 1]
  return [Math.min(0.85, Math.floor(Math.min(...vals) * 100) / 100), 1]
})

const weeklyCats = computed(() => (perf.value?.weekly || []).map(x => fmt.date(x.weekStart)))
const weeklySeries = computed(() => [{ key: 'rate', label: t('aiOptimizer.perf.acceptance'), values: (perf.value?.weekly || []).map(x => x.rate) }])
const overrideData = computed(() => (perf.value?.overrides || []).slice(0, 6).map(o => ({ key: o.key, label: o.serviceName || `${o.carrierName} ${o.service}`, value: o.count })))
const reasonItems = computed(() => (perf.value?.reasons || []).map(r => ({ key: r.code, label: t(`aiOptimizer.reasonCodes.${r.code}`) !== `aiOptimizer.reasonCodes.${r.code}` ? t(`aiOptimizer.reasonCodes.${r.code}`) : r.code, value: r.count })))

onMounted(() => { runSim(); loadRel(); loadPerf() })

function goBatch() { router.push({ name: 'batch', query: { tab: 'run' } }) }
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.aiOptimizer')" :subtitle="t('aiOptimizer.subtitle')" badge="AI">
      <template #actions>
        <button class="btn btn-accent btn-sm" :title="t('aiOptimizer.runBatchHint')" @click="goBatch"><Icon name="layers" :size="14" />{{ t('aiOptimizer.runBatch') }}</button>
      </template>
    </PageHeader>

    <div class="callout neutral scope">
      <Icon name="info" :size="16" />
      <div>
        <b>{{ t('aiOptimizer.scope.title') }}:</b> {{ t('aiOptimizer.scope.text') }}
        <div class="formula">{{ t('aiOptimizer.scope.formula') }}</div>
      </div>
    </div>

    <!-- simulator -->
    <Card :title="t('aiOptimizer.sim.title')" :subtitle="t('aiOptimizer.sim.subtitle')" icon="route" class="blk">
      <div class="sim">
        <form class="sim-form" novalidate @submit.prevent="runSim">
          <FormField :label="t('aiOptimizer.sim.zip')" :error="errors.toZip" required v-slot="{ id, invalid }">
            <input :id="id" v-model="form.toZip" class="input num" inputmode="numeric" maxlength="5" :aria-invalid="invalid" />
          </FormField>
          <div v-if="sim?.input?.toState" class="field-hint st">{{ t('aiOptimizer.sim.stateAuto', { s: sim.input.toState }) }}</div>
          <div class="presets">
            <span>{{ t('aiOptimizer.sim.presets') }}</span>
            <button v-for="p in PRESETS" :key="p.key" type="button" :class="['btn', 'btn-ghost', 'btn-xs', { on: form.toZip === p.zip }]" @click="usePreset(p)">{{ p.label }}</button>
          </div>
          <FormField :label="t('aiOptimizer.sim.weight')" :error="errors.weightLb" required v-slot="{ id, invalid }">
            <input :id="id" v-model.number="form.weightLb" type="number" step="0.1" min="0.1" class="input num" :aria-invalid="invalid" />
          </FormField>
          <FormField :label="t('aiOptimizer.sim.dims')" :error="errors.dims" required v-slot="{ id }">
            <div class="dims">
              <input :id="id" v-model.number="form.lengthIn" type="number" min="1" class="input num" :aria-label="t('aiOptimizer.sim.length')" :placeholder="t('aiOptimizer.sim.length')" />
              <span>x</span>
              <input v-model.number="form.widthIn" type="number" min="1" class="input num" :aria-label="t('aiOptimizer.sim.width')" :placeholder="t('aiOptimizer.sim.width')" />
              <span>x</span>
              <input v-model.number="form.heightIn" type="number" min="1" class="input num" :aria-label="t('aiOptimizer.sim.height')" :placeholder="t('aiOptimizer.sim.height')" />
            </div>
          </FormField>
          <FormField :label="t('aiOptimizer.sim.value')" v-slot="{ id }">
            <input :id="id" v-model.number="form.declaredValue" type="number" min="0" class="input num" />
          </FormField>
          <Toggle v-model="form.residential" :label="t('aiOptimizer.sim.residential')" size="sm" />
          <div class="slider">
            <Slider v-model="speed" :min="0" :max="100" :step="5" :label="t('aiOptimizer.sim.slider')" :left-label="t('aiOptimizer.sim.cost')" :right-label="t('aiOptimizer.sim.speed')"
              :format="() => t('aiOptimizer.sim.sliderValue', { w: fmt.number(w, 2) })" @update:model-value="rescore" />
          </div>
          <button type="submit" class="btn btn-primary btn-sm run" :disabled="running"><Spinner v-if="running" :size="14" /><Icon v-else name="play" :size="13" />{{ running ? t('aiOptimizer.sim.running') : t('aiOptimizer.sim.run') }}</button>
        </form>

        <div class="sim-out">
          <Skeleton v-if="running && !sim" variant="rect" :height="320" />
          <EmptyState v-else-if="!sim" icon="route" :title="t('aiOptimizer.sim.empty')" :description="t('aiOptimizer.sim.emptyDesc')" compact />
          <EmptyState v-else-if="!ranked.length" icon="route" :title="t('aiOptimizer.sim.noCandidates')" compact />
          <template v-else>
            <div class="out-head">
              <div class="rec">
                <span class="tag tag-accent">{{ t('aiOptimizer.sim.best') }}</span>
                <CarrierLogo :code="best.quote.carrierCode" :size="26" />
                <div>
                  <div class="rec-n">{{ nameOf(best) }} <span class="hubtag">{{ best.quote.hub }}</span></div>
                  <div class="rec-s">{{ fmt.money(best.quote.total) }} · {{ t('aiOptimizer.sim.days', { n: best.quote.effectiveEtaDays ?? best.quote.etaDays }) }} · {{ fmt.percent(best.components.reliabilityRaw, 0) }}</div>
                </div>
              </div>
              <div class="rec-why"><Icon name="spark" :size="13" />{{ tx(scored.reason) }}</div>
              <div class="rec-save">
                <template v-if="savings != null && savings > 0.004">{{ t('aiOptimizer.sim.savings') }}: <b class="num up">{{ fmt.money(savings) }}</b></template>
                <template v-else>{{ t('aiOptimizer.sim.savingsNone') }}</template>
                <span v-if="defaultChoice" class="muted"> · {{ t('aiOptimizer.sim.defaultRule', { hub: defaultChoice.hub, p: fmt.money(defaultChoice.total) }) }}</span>
              </div>
              <transition name="fade"><div v-if="change" :key="change.to" class="changed"><Icon name="refresh" :size="13" />{{ t('aiOptimizer.sim.changed', change) }}</div></transition>
            </div>
            <div class="out-grid">
              <div>
                <div class="sub-h">{{ t('aiOptimizer.sim.scatter') }} <span class="muted">· {{ t('aiOptimizer.sim.candidates', { n: ranked.length, h: hubCount }) }}</span></div>
                <div class="hint">{{ t('aiOptimizer.sim.scatterHint') }}</div>
                <ScatterChart :points="points" :height="290" :x-label="t('aiOptimizer.sim.xLabel')" :y-label="t('aiOptimizer.sim.yLabel')" :r-label="t('aiOptimizer.sim.rLabel')"
                  :x-format="v => fmt.money(v)" :y-format="v => fmt.number(v, 0)" :r-format="v => fmt.percent(v, 0)" :r-domain="[0.8, 1]" y-invert
                  @select="p => (selectedId = p.key)" />
              </div>
              <div>
                <div class="sub-h">{{ t('aiOptimizer.sim.breakdown') }}</div>
                <div v-if="selected" class="hint">{{ t('aiOptimizer.sim.breakdownFor', { name: nameOf(selected), hub: selected.quote.hub }) }}</div>
                <ContributionBars :items="breakdown" :format="v => (v > 0 ? '+' : '') + fmt.number(v, 3)" :max="1" />
                <div v-if="selected" class="total"><span>{{ t('aiOptimizer.sim.total') }}</span><b class="num">{{ fmt.number(selected.score, 3) }}</b></div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-if="ranked.length" class="ranked">
        <div class="sub-h">{{ t('aiOptimizer.sim.ranked') }}</div>
        <div class="table-wrap">
          <table class="table-simple rt">
            <thead><tr>
              <th>{{ t('aiOptimizer.sim.cols.rank') }}</th><th>{{ t('aiOptimizer.sim.cols.service') }}</th><th>{{ t('aiOptimizer.sim.cols.hub') }}</th>
              <th class="r">{{ t('aiOptimizer.sim.cols.price') }}</th><th class="r">{{ t('aiOptimizer.sim.cols.eta') }}</th><th class="r hide-sm">{{ t('aiOptimizer.sim.cols.rel') }}</th><th class="r">{{ t('aiOptimizer.sim.cols.score') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in shownRows" :key="idOf(r)" :class="{ sel: idOf(r) === selectedId, best: best && idOf(r) === idOf(best) }" tabindex="0" @click="selectedId = idOf(r)" @keydown.enter="selectedId = idOf(r)">
                <td class="num">{{ i + 1 }}</td>
                <td>
                  <div class="svc">
                    <CarrierLogo :code="r.quote.carrierCode" :size="22" />
                    <span>{{ nameOf(r) }}</span>
                    <span v-if="r.quote.source && r.quote.source !== 'platform'" class="tag src">{{ t(`aiOptimizer.sim.source.${r.quote.source}`) }}</span>
                  </div>
                </td>
                <td><span class="hubtag">{{ r.quote.hub }}</span></td>
                <td class="r num">{{ fmt.money(r.quote.total) }}</td>
                <td class="r num" :title="r.quote.cutoffDelay ? t('aiOptimizer.sim.cutoff') : ''">{{ r.quote.effectiveEtaDays ?? r.quote.etaDays }}<span v-if="r.quote.cutoffDelay" class="muted">*</span></td>
                <td class="r num hide-sm">{{ fmt.percent(r.components.reliabilityRaw, 1) }}</td>
                <td class="r"><div class="scorecell"><i :style="{ width: Math.max(0, Math.min(1, r.score)) * 100 + '%' }" /><span class="num">{{ fmt.number(r.score, 3) }}</span></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <button v-if="ranked.length > 10" class="btn btn-link more" @click="showAllRows = !showAllRows">{{ showAllRows ? t('aiOptimizer.sim.showLess') : t('aiOptimizer.sim.showMore', { n: ranked.length }) }}</button>
      </div>
    </Card>

    <div class="two blk">
      <Card :title="t('aiOptimizer.heat.title')" :subtitle="t('aiOptimizer.heat.subtitle', { k: rel?.k ?? 9 })" icon="target">
        <Skeleton v-if="relLoading" variant="rect" :height="260" />
        <template v-else-if="rel">
          <HeatmapGrid :rows="heatRows" :cols="heatCols" :values="heatValues" :meta="heatMeta" :domain="heatDomain" :corner-label="t('aiOptimizer.heat.carrier')" :col-label="t('aiOptimizer.heat.zone')"
            :format="v => fmt.percent(v, 0)">
            <template #tooltip="{ title, text, meta }">
              <div class="htip">
                <div class="htip-t">{{ title }}</div>
                <div><b>{{ text }}</b></div>
                <div v-if="meta && meta.n">{{ t('aiOptimizer.heat.tipRaw', { r: fmt.percent(meta.raw, 1), o: meta.onTime, n: meta.n }) }}</div>
                <div v-else>{{ t('aiOptimizer.heat.tipNoData') }}</div>
                <div v-if="meta" class="muted">{{ t('charts.samples', { n: meta.n }) }} · {{ t('aiOptimizer.heat.tipPrior', { p: fmt.percent(meta.prior, 0) }) }}</div>
              </div>
            </template>
          </HeatmapGrid>
          <div class="overall">
            <span class="muted">{{ t('aiOptimizer.heat.overall') }}:</span>
            <span v-for="c in rel.carriers" :key="c" class="tag">{{ carrierName(c) }} {{ fmt.percent(rel.byCarrier[c]?.smoothed, 0) }}</span>
          </div>
          <div class="muted small">{{ t('aiOptimizer.heat.samples', { n: fmt.number(rel.totalSamples) }) }}</div>
        </template>
      </Card>

      <Card :title="t('aiOptimizer.perf.title')" :subtitle="t('aiOptimizer.perf.subtitle', { d: 90 })" icon="chart">
        <div class="pk">
          <KpiCard :label="t('aiOptimizer.perf.acceptance')" :value="perf ? fmt.percent(perf.acceptanceRate, 1) : ''" :hint="perf ? t('aiOptimizer.perf.acceptanceHint', { a: perf.accepted, n: perf.total }) : ''" :loading="perfLoading" tone="accent" />
          <KpiCard :label="t('aiOptimizer.perf.savings')" :value="perf ? fmt.money(perf.totalSavings) : ''" :hint="perf ? t('aiOptimizer.perf.avg') + ': ' + fmt.money(perf.avgSavings) : ''" :loading="perfLoading" tone="success" />
        </div>
        <Skeleton v-if="perfLoading" variant="rect" :height="200" />
        <template v-else-if="perf">
          <div class="sub-h">{{ t('aiOptimizer.perf.weekly') }}</div>
          <BarChart :categories="weeklyCats" :series="weeklySeries" :height="150" :legend="false" :value-format="v => fmt.percent(v, 0)" :max-bar-width="18" />
          <div class="perf-2">
            <div>
              <div class="sub-h">{{ t('aiOptimizer.perf.overrides') }}</div>
              <Donut v-if="overrideData.length" :data="overrideData" :size="140" legend-position="bottom" show-values />
              <div v-else class="muted small">{{ t('aiOptimizer.perf.overridesEmpty') }}</div>
            </div>
            <div>
              <div class="sub-h">{{ t('aiOptimizer.perf.reasons') }}</div>
              <ContributionBars :items="reasonItems" mode="positive" :format="v => fmt.number(v)" />
            </div>
          </div>
        </template>
      </Card>
    </div>

    <Card :title="t('aiOptimizer.activity')" icon="clock" class="blk">
      <ModelActivityLog module="optimizer" :limit="8" />
    </Card>
  </div>
</template>

<style scoped>
.blk { margin-bottom: 16px; }
.scope { margin-bottom: 16px; align-items: flex-start; }
.formula { margin-top: 4px; font-family: var(--font-mono); font-size: 12px; color: var(--ink-2); }
.sim { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 20px; }
@media (max-width: 1000px) { .sim { grid-template-columns: 1fr; } }
.sim-form { display: flex; flex-direction: column; gap: 10px; }
.st { margin-top: -6px; }
.presets { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; color: var(--ink-3); }
.presets .on { border-color: var(--accent); color: var(--accent-ink); }
.dims { display: flex; align-items: center; gap: 6px; }
.dims .input { min-width: 0; }
.dims span { color: var(--ink-3); }
.slider { padding: 6px 0; }
.run { align-self: flex-start; }
.sim-out { min-width: 0; }
.out-head { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: var(--accent-soft); border-radius: var(--r-md); margin-bottom: 14px; }
.rec { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rec-n { font-weight: 600; font-size: 15px; font-family: var(--font-display); }
.rec-s { font-size: 12.5px; color: var(--ink-2); }
.rec-why { font-size: 13px; color: var(--accent-ink); display: flex; align-items: center; gap: 6px; }
.rec-save { font-size: 12.5px; color: var(--ink-2); }
.changed { font-size: 12.5px; display: inline-flex; gap: 6px; align-items: center; color: oklch(0.45 0.1 65); background: oklch(0.97 0.05 80); padding: 4px 8px; border-radius: 6px; align-self: flex-start; }
.fade-enter-active { transition: opacity .3s; } .fade-enter-from { opacity: 0; }
.out-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 18px; }
@media (max-width: 1200px) { .out-grid { grid-template-columns: 1fr; } }
.sub-h { font-weight: 600; font-size: 13.5px; margin-bottom: 2px; }
.hint { font-size: 12px; color: var(--ink-3); margin-bottom: 8px; }
.total { display: flex; justify-content: space-between; border-top: 1px solid var(--line-1); margin-top: 10px; padding-top: 8px; font-size: 13px; }
.ranked { margin-top: 18px; }
.rt td, .rt th { padding: 7px 10px; }
.rt tbody tr { cursor: pointer; }
.rt tr.sel td { background: var(--accent-soft); }
.rt tr.best td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
.svc { display: flex; align-items: center; gap: 8px; }
.src { height: 18px; font-size: 10.5px; }
.hubtag { font-family: var(--font-mono); font-size: 11px; background: var(--bg-3); padding: 1px 5px; border-radius: 4px; color: var(--ink-2); }
.scorecell { position: relative; display: inline-flex; align-items: center; justify-content: flex-end; min-width: 90px; height: 20px; }
.scorecell i { position: absolute; left: 0; top: 7px; height: 6px; background: var(--accent-soft); border-radius: 3px; }
.scorecell span { position: relative; }
.more { margin-top: 6px; }
.r { text-align: right; }
.up { color: oklch(0.5 0.12 155); }
.muted { color: var(--ink-3); }
.small { font-size: 12px; }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1100px) { .two { grid-template-columns: 1fr; } }
.htip { font-size: 12.5px; display: flex; flex-direction: column; gap: 2px; }
.htip-t { font-weight: 600; }
.overall { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 12px 0 6px; font-size: 12.5px; }
.pk { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.perf-2 { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 14px; }
@media (max-width: 600px) { .perf-2, .pk { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .hide-sm { display: none; } }
</style>
