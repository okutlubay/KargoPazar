<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Card from '@/app/components/Card.vue'
import Tabs from '@/app/components/Tabs.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import CarrierLogo from '@/app/components/CarrierLogo.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Spinner from '@/app/components/Spinner.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import ProgressBar from '@/app/components/ProgressBar.vue'
import SegmentedControl from '@/app/components/SegmentedControl.vue'
import AdapterDiagram from '@/app/components/admin/AdapterDiagram.vue'
import { US_STATES } from '@/app/components/AddressForm.vue'
import { toast } from '@/app/components/toast.js'
import { confirm } from '@/app/components/confirm.js'
import { useI18n } from '@/app/i18n/index.js'
import { db } from '@/app/store/db.js'
import { can } from '@/app/store/session.js'
import { getCarrier, testCarrierConnection, activateCarrier, setCarrierStatus, ADAPTER_OPS } from '@/app/api/carriers.js'
import { errorText } from '@/app/components/settings/util.js'
import { round2 } from '@/shared/rateEngine.js'

const { t, tx, fmt } = useI18n()
const route = useRoute()
const router = useRouter()
const code = String(route.params.code)
const loading = ref(true)
const notFound = ref(false)
const c = ref(null)
const tab = ref('services')
const svcIdx = ref(0)
const locked = computed(() => !can('admin.platform'))
const ZONES = [2, 3, 4, 5, 6, 7, 8]
const STATES = US_STATES.map(s => (Array.isArray(s) ? s : [s, s]))
const OPS = ['rates', 'label', 'void', 'track', 'manifest', 'address', 'pickup']
const OP_METHOD = { rates: 'getRates', label: 'createLabel', void: 'voidLabel', track: 'track', manifest: 'createManifest', address: 'validateAddress', pickup: 'schedulePickup' }

async function load() {
  try { c.value = await getCarrier(code) } catch (e) { if (e?.code === 'NOT_FOUND') notFound.value = true; else toast.error(errorText(e, 'admin')) } finally { loading.value = false }
}
onMounted(load)

const allCarriers = computed(() => db.all('carriers'))
const tabs = computed(() => [
  { key: 'services', label: t('admin.detail.tabs.services'), count: c.value?.services?.length },
  { key: 'zones', label: t('admin.detail.tabs.zones') },
  { key: 'tiers', label: t('admin.detail.tabs.tiers') },
  { key: 'coverage', label: t('admin.detail.tabs.coverage') },
  { key: 'ops', label: t('admin.detail.tabs.ops') },
  { key: 'adapter', label: t('admin.detail.tabs.adapter') },
])
const svc = computed(() => c.value?.services?.[svcIdx.value] ?? null)
const hasZones = s => s && s.base && ZONES.some(z => s.base[z] != null)
function range(obj) {
  const v = ZONES.map(z => obj?.[z]).filter(x => x != null)
  if (!v.length) return '-'
  const lo = Math.min(...v), hi = Math.max(...v)
  return lo === hi ? String(lo) : `${lo}-${hi}`
}
function sample(s, z, lb) {
  if (!s?.base?.[z]) return null
  const base = s.base[z] + (s.perLb?.[z] ?? 0) * Math.max(0, lb - 1)
  return round2(base * (1 + (c.value.fuelPct ?? 0)))
}
const coverageSet = computed(() => new Set(c.value?.coverage ?? []))
const coversAll = computed(() => !c.value?.coverage?.length && c.value?.type !== 'international')

// test
const testing = ref(false)
const testPct = ref(0)
async function runTest() {
  testing.value = true
  testPct.value = 0
  try {
    const r = await testCarrierConnection(code, { onProgress: p => { testPct.value = p } })
    await load()
    tab.value = 'adapter'
    r.passed ? toast.success(t('admin.wizard.testPassed')) : toast.error(t('admin.wizard.testFailed'))
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { testing.value = false }
}
const statusBusy = ref(false)
async function toggleStatus() {
  const c0 = c.value
  if (c0.status === 'active') {
    const ok = await confirm({ title: t('admin.detail.deactivateTitle', { name: c0.name }), message: t('admin.detail.deactivateDesc'), confirmLabel: t('admin.detail.deactivate'), danger: true })
    if (!ok) return
  }
  statusBusy.value = true
  try {
    if (c0.status === 'testing') await activateCarrier(code)
    else await setCarrierStatus(code, c0.status === 'active' ? 'inactive' : 'active')
    await load()
    toast.success(c.value.status === 'active' ? t('admin.detail.activated', { name: c0.name }) : t('admin.detail.deactivated', { name: c0.name }), c.value.status !== 'active' ? { action: { label: t('common.undo'), onClick: async () => { await setCarrierStatus(code, 'active'); await load() } } } : undefined)
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { statusBusy.value = false }
}
const onTime = z => c.value?.onTimeByZone?.[z]
</script>

<template>
  <div class="page">
    <div v-if="loading" class="stack-lg"><Skeleton variant="rect" :height="60" /><Skeleton :lines="8" /></div>
    <EmptyState v-else-if="notFound" icon="truck" :title="t('admin.detail.notFound')" :description="code" :action-label="t('admin.detail.backToList')" @action="router.push({ name: 'admin-carriers' })" />
    <template v-else-if="c">
      <PageHeader :title="c.name" :subtitle="t('admin.detail.subtitle', { type: t('admin.types.' + c.type), tpl: c.adapterTemplate, v: c.adapterVersion })">
        <template #title-extra><StatusPill :status="c.status" /></template>
        <template #actions>
          <button class="btn btn-ghost" :disabled="testing || locked" :title="locked ? t('common.noPermission') : undefined" @click="runTest"><Spinner v-if="testing" :size="14" /><Icon v-else name="flask" :size="14" />{{ t('admin.detail.runTest') }}</button>
          <button :class="['btn', c.status === 'active' ? 'btn-ghost' : 'btn-primary']" :disabled="statusBusy || locked" :title="locked ? t('common.noPermission') : undefined" @click="toggleStatus">
            <Spinner v-if="statusBusy" :size="14" />{{ c.status === 'active' ? t('admin.detail.deactivate') : t('admin.detail.activate') }}
          </button>
        </template>
      </PageHeader>
      <ProgressBar v-if="testing" :value="testPct" size="sm" class="mb" />
      <div v-if="c.status === 'testing'" class="callout warn mb"><Icon name="info" :size="14" />{{ t('admin.detail.testingHint') }}</div>

      <div class="head-row">
        <CarrierLogo :code="c.code" :name="c.name" :color="c.color" :ink="c.ink" :size="44" show-name :sub="c.code" />
        <dl class="facts">
          <div><dt>{{ t('admin.carriers.since') }}</dt><dd><DateTime v-if="c.connectedSince" :value="c.connectedSince" mode="date" /><span v-else>-</span></dd></div>
          <div><dt>{{ t('admin.detail.fuel') }}</dt><dd>{{ fmt.percent(c.fuelPct ?? 0) }}</dd></div>
          <div><dt>{{ t('admin.detail.poBox') }}</dt><dd>{{ c.poBoxAllowed ? t('common.yes') : t('common.no') }}</dd></div>
          <div><dt>{{ t('admin.detail.origin') }}</dt><dd>{{ c.originHubs?.join(', ') || 'NJ01, LA01' }}</dd></div>
        </dl>
      </div>

      <div class="grid-kpi mb">
        <KpiCard :label="t('admin.carriers.services')" :value="String(c.services?.length ?? 0)" icon="layers" />
        <KpiCard :label="t('admin.carriers.shipments30')" :value="fmt.number(c.stats?.shipments30d ?? 0)" icon="box" />
        <KpiCard :label="t('admin.detail.shipments90')" :value="fmt.number(c.stats?.shipments90d ?? 0)" icon="chart" />
        <KpiCard :label="t('admin.carriers.health')" :value="c.apiHealth?.avgMs ? t('common.ms', { n: c.apiHealth.avgMs }) : '-'" icon="bolt" />
      </div>

      <Tabs v-model="tab" :tabs="tabs" />
      <div class="tabbody">
        <!-- services -->
        <Card v-if="tab === 'services'" padding="none">
          <div class="table-wrap">
            <table class="table-simple">
              <thead><tr><th>{{ t('admin.detail.service') }}</th><th>{{ t('admin.wizard.svcCode') }}</th><th>{{ t('admin.wizard.svcLevel') }}</th><th>{{ t('admin.detail.transit') }}</th><th>{{ t('admin.detail.basePrice') }}</th><th>{{ t('admin.wizard.svcRes') }}</th><th>{{ t('admin.detail.restrictions') }}</th></tr></thead>
              <tbody>
                <tr v-for="s in c.services" :key="s.code">
                  <td><strong>{{ s.name }}</strong></td>
                  <td class="mono small">{{ s.code }}</td>
                  <td>{{ t('admin.levels.' + (s.level || 'standard')) }}</td>
                  <td>{{ hasZones(s) ? t('admin.detail.daysRange', { r: range(s.transitDays) }) : s.transitDays ? t('admin.detail.daysRange', { r: s.transitDays.default ?? range(s.transitDays) }) : '-' }}</td>
                  <td class="num">{{ hasZones(s) ? `${fmt.money(Math.min(...ZONES.map(z => s.base[z]).filter(Boolean)))} - ${fmt.money(Math.max(...ZONES.map(z => s.base[z]).filter(Boolean)))}` : '-' }}</td>
                  <td class="num">{{ fmt.money(s.resFee ?? 0) }}</td>
                  <td>
                    <span v-if="s.residentialOnly" class="tag">{{ t('admin.detail.residentialOnly') }}</span>
                    <span v-else-if="s.commercialOnly" class="tag">{{ t('admin.detail.commercialOnly') }}</span>
                    <span v-else>-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <!-- zones -->
        <Card v-else-if="tab === 'zones'" :title="t('admin.detail.zonesTitle')" :subtitle="t('admin.detail.zonesDesc')" padding="none">
          <template #actions>
            <SegmentedControl v-if="c.services.length > 1" v-model="svcIdx" :options="c.services.map((s, i) => ({ value: i, label: s.name.replace(c.name + ' ', '') }))" size="sm" :aria-label="t('admin.detail.service')" />
          </template>
          <div v-if="!hasZones(svc)" class="pad"><div class="callout neutral">{{ t('admin.detail.noZones') }}</div></div>
          <div v-else class="table-wrap">
            <table class="table-simple grid">
              <thead><tr><th /><th v-for="z in ZONES" :key="z" class="c">{{ t('admin.zone', { z }) }}</th></tr></thead>
              <tbody>
                <tr><th class="rowh">{{ t('admin.wizard.zoneRow.base') }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ fmt.money(svc.base[z]) }}</td></tr>
                <tr><th class="rowh">{{ t('admin.wizard.zoneRow.perLb') }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ fmt.money(svc.perLb?.[z] ?? 0) }}</td></tr>
                <tr><th class="rowh">{{ t('admin.wizard.zoneRow.transitDays') }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ svc.transitDays?.[z] ?? '-' }}</td></tr>
                <tr><th class="rowh">{{ t('admin.detail.onTime') }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ onTime(z) != null ? fmt.percent(onTime(z), 1) : '-' }}</td></tr>
                <tr class="ex"><th class="rowh">{{ t('admin.detail.example', { lb: 1 }) }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ fmt.money(sample(svc, z, 1)) }}</td></tr>
                <tr class="ex"><th class="rowh">{{ t('admin.detail.example', { lb: 5 }) }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ fmt.money(sample(svc, z, 5)) }}</td></tr>
                <tr class="ex"><th class="rowh">{{ t('admin.detail.example', { lb: 10 }) }}</th><td v-for="z in ZONES" :key="z" class="c num">{{ fmt.money(sample(svc, z, 10)) }}</td></tr>
              </tbody>
            </table>
          </div>
          <template #footer><span class="small">{{ t('admin.detail.zonesFoot', { fuel: fmt.percent(c.fuelPct ?? 0) }) }}</span></template>
        </Card>

        <!-- tiers -->
        <div v-else-if="tab === 'tiers'" class="grid-2">
          <Card :title="t('admin.detail.tiersTitle')" :subtitle="t('admin.detail.tiersDesc')" padding="none">
            <table class="table-simple">
              <thead><tr><th>{{ t('admin.rates.weekly') }}</th><th class="r">{{ t('admin.rates.extraDiscount') }}</th><th /></tr></thead>
              <tbody>
                <tr v-for="(tr, i) in (c.agreement?.tiers ?? c.volumeTiers ?? [])" :key="i">
                  <td>{{ t('admin.rates.tierFrom', { n: tr.weeklyVolume }) }}</td>
                  <td class="r num">{{ fmt.percent(tr.discountPct, 1) }}</td>
                  <td class="r"><span v-if="(c.agreement?.activeTierDiscountPct ?? 0) === tr.discountPct" class="tag tag-accent">{{ t('admin.rates.activeTier') }}</span></td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card :title="t('admin.detail.agreementTitle')">
            <dl v-if="c.agreement" class="kv">
              <dt>{{ t('admin.rates.signed') }}</dt><dd><DateTime :value="c.agreement.signedAt" mode="date" /></dd>
              <dt>{{ t('admin.rates.validUntil') }}</dt><dd><DateTime :value="c.agreement.validUntil" mode="date" /></dd>
              <dt>{{ t('admin.rates.baseDiscount') }}</dt><dd>{{ fmt.percent(c.agreement.baseDiscountPct, 0) }}</dd>
              <dt>{{ t('admin.rates.fuelRule') }}</dt><dd>{{ tx(c.agreement.fuelRule) }}</dd>
            </dl>
            <div v-else class="callout neutral">{{ t('admin.detail.noAgreement') }}</div>
            <template #footer><RouterLink :to="{ name: 'admin-rate-cards' }" class="link small">{{ t('admin.detail.manageAgreements') }}</RouterLink></template>
          </Card>
        </div>

        <!-- coverage -->
        <Card v-else-if="tab === 'coverage'" :title="t('admin.detail.coverageTitle')" :subtitle="c.type === 'international' ? t('admin.carriers.coverageIntl') : coversAll ? t('admin.carriers.coverageAll') : t('admin.carriers.coverageStates', { n: coverageSet.size })">
          <div class="states">
            <span v-for="[s, name] in STATES" :key="s" :class="['st', { on: coversAll || coverageSet.has(s), off: c.type === 'international' }]" :title="name">{{ s }}</span>
          </div>
          <div class="legend">
            <span><i class="lg on" />{{ t('admin.detail.covered') }}</span>
            <span><i class="lg" />{{ t('admin.detail.notCovered') }}</span>
          </div>
        </Card>

        <!-- ops -->
        <Card v-else-if="tab === 'ops'" :title="t('admin.carriers.opsTitle')" :subtitle="t('admin.detail.opsDesc')" padding="none">
          <table class="table-simple">
            <thead><tr><th>{{ t('admin.detail.operation') }}</th><th>{{ t('admin.detail.method') }}</th><th class="c">{{ t('admin.detail.supported') }}</th></tr></thead>
            <tbody>
              <tr v-for="o in OPS" :key="o">
                <td>{{ t('admin.ops.' + o) }}</td>
                <td class="mono small">{{ OP_METHOD[o] }}()<span v-if="!ADAPTER_OPS.includes(OP_METHOD[o])" class="ext"> {{ t('admin.detail.extension') }}</span></td>
                <td class="c"><StatusPill :status="(c.supportedOps ?? []).includes(o) ? 'active' : 'inactive'" :label="(c.supportedOps ?? []).includes(o) ? t('common.yes') : t('common.no')" size="sm" /></td>
              </tr>
            </tbody>
          </table>
        </Card>

        <!-- adapter -->
        <div v-else class="stack-lg">
          <Card :title="t('admin.adapter.title')" :subtitle="t('admin.adapter.desc')">
            <AdapterDiagram :carriers="allCarriers" :highlight="c.code" />
          </Card>
          <Card :title="t('admin.detail.lastTest')" padding="none">
            <template #actions><button class="btn btn-ghost btn-sm" :disabled="testing || locked" @click="runTest"><Spinner v-if="testing" :size="12" />{{ t('admin.detail.runTest') }}</button></template>
            <div v-if="!c.lastTest" class="pad"><div class="callout neutral">{{ t('admin.detail.noTest') }}</div></div>
            <table v-else class="table-simple">
              <thead><tr><th>{{ t('admin.detail.scenario') }}</th><th>{{ t('admin.detail.detailCol') }}</th><th class="r">{{ t('admin.detail.duration') }}</th><th class="c">{{ t('common.status') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in c.lastTest.results" :key="r.id">
                  <td>{{ t('core.carrierTests.' + r.id) }}</td>
                  <td class="small">{{ tx(r.detail) }}</td>
                  <td class="r num">{{ t('common.ms', { n: r.ms }) }}</td>
                  <td class="c"><StatusPill :status="r.status" size="sm" /></td>
                </tr>
              </tbody>
            </table>
            <template v-if="c.lastTest" #footer><span class="small">{{ t('admin.detail.testRan') }} <DateTime :value="c.lastTest.ranAt" /> · {{ t('admin.detail.runs', { n: c.lastTest.runs }) }}</span></template>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mb { margin-bottom: 16px; }
.pad { padding: 18px 20px; }
.head-row { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; margin-bottom: 16px; padding: 14px 18px; background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-lg); }
.facts { display: flex; gap: 28px; flex-wrap: wrap; margin: 0; }
.facts dt { font-size: 12px; color: var(--ink-3); }
.facts dd { margin: 2px 0 0; font-weight: 500; }
.tabbody { margin-top: 16px; }
.small { font-size: 12.5px; color: var(--ink-3); }
.grid th.c, .grid td.c, .c { text-align: center; }
.r { text-align: right; }
.rowh { font-weight: 500; color: var(--ink-2); font-size: 12.5px; white-space: nowrap; }
.ex td { color: var(--accent-ink); }
.states { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 5px; }
.st { height: 32px; display: grid; place-items: center; border-radius: 7px; border: 1px solid var(--line-1); background: var(--bg-2); font-family: var(--font-mono); font-size: 12px; color: var(--ink-4); }
.st.on { background: var(--accent); border-color: var(--accent); color: white; }
.st.off { opacity: .5; }
.legend { display: flex; gap: 16px; margin-top: 12px; font-size: 12px; color: var(--ink-3); }
.lg { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--bg-2); border: 1px solid var(--line-2); margin-right: 6px; vertical-align: -2px; }
.lg.on { background: var(--accent); border-color: var(--accent); }
.ext { font-family: var(--font-sans, inherit); color: var(--ink-4); font-size: 11px; }
</style>
