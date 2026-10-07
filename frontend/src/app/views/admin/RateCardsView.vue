<script setup>
// Rate cards (spec 10.2): carrier agreements, platform tariff (markup per plan), customer specific
// cards, approved dynamic overrides (read only) and the step by step price simulator.
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Card from '@/app/components/Card.vue'
import Tabs from '@/app/components/Tabs.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Spinner from '@/app/components/Spinner.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import FormField from '@/app/components/FormField.vue'
import CarrierLogo from '@/app/components/CarrierLogo.vue'
import Dropdown from '@/app/components/Dropdown.vue'
import CustomerCardEditor from '@/app/components/admin/CustomerCardEditor.vue'
import PriceSimulator from '@/app/components/admin/PriceSimulator.vue'
import { toast } from '@/app/components/toast.js'
import { confirm } from '@/app/components/confirm.js'
import { useI18n } from '@/app/i18n/index.js'
import { db } from '@/app/store/db.js'
import { can } from '@/app/store/session.js'
import { rateShop } from '@/shared/rateEngine.js'
import {
  getRateCards, updatePlatformTariff, setAgreementTier, setCustomerCardStatus, removeCustomerCard, restoreCustomerCard,
} from '@/app/api/admin.js'
import { errorText, fieldText } from '@/app/components/settings/util.js'

const { t, tx, fmt } = useI18n()
const route = useRoute()
const router = useRouter()
const TABS = ['agreements', 'platform', 'customers', 'dynamic', 'simulator']
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'agreements')
watch(tab, v => router.replace({ query: { ...route.query, tab: v } }))

const loading = ref(true)
const failed = ref(false)
const data = ref(null)
const locked = computed(() => !can('admin.platform'))

async function load() {
  failed.value = false
  try {
    data.value = await getRateCards()
    resetForm()
  } catch (e) { if (!data.value) failed.value = true; toast.error(errorText(e, 'admin')) } finally { loading.value = false }
}
onMounted(load)

const tabs = computed(() => [
  { key: 'agreements', label: t('admin.rates.tabs.agreements'), count: data.value?.carrierAgreements.length },
  { key: 'platform', label: t('admin.rates.tabs.platform') },
  { key: 'customers', label: t('admin.rates.tabs.customers'), count: data.value?.customerCards.length },
  { key: 'dynamic', label: t('admin.rates.tabs.dynamic'), count: data.value?.dynamicOverrides.length },
  { key: 'simulator', label: t('admin.rates.tabs.simulator') },
])

// ----- agreements -------------------------------------------------------------------------
const tierBusy = ref('')
async function changeTier(a, pct) {
  if (Number(pct) === a.activeTierDiscountPct) return
  tierBusy.value = a.carrier
  const before = a.activeTierDiscountPct ?? 0
  try {
    await setAgreementTier(a.carrier, Number(pct))
    await load()
    toast.success(t('admin.rates.tierChanged', { carrier: a.carrierName, pct: fmt.percent(Number(pct), 0) }), {
      action: { label: t('common.undo'), onClick: async () => { await setAgreementTier(a.carrier, before); await load() } },
    })
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { tierBusy.value = '' }
}
function tierProgress(a) {
  if (!a.nextTier) return 100
  const from = a.reachedTier?.weeklyVolume ?? 0
  return Math.max(0, Math.min(100, ((a.weeklyVolume - from) / (a.nextTier.weeklyVolume - from)) * 100))
}

// ----- platform tariff ---------------------------------------------------------------------
const PLANS = ['starter', 'professional', 'enterprise']
const form = reactive({ starter: 28, professional: 20, enterprise: 14, minLabelFee: 0.35, per100: 1.1, freeUpTo: 100 })
const formErr = ref({})
const saving = ref(false)
function resetForm() {
  const p = data.value?.platform
  if (!p) return
  Object.assign(form, {
    starter: Math.round(p.markup.starter * 1000) / 10, professional: Math.round(p.markup.professional * 1000) / 10, enterprise: Math.round(p.markup.enterprise * 1000) / 10,
    minLabelFee: p.minLabelFee, per100: p.insurance.per100, freeUpTo: p.insurance.freeUpTo,
  })
  formErr.value = {}
}
const dirty = computed(() => {
  const p = data.value?.platform
  if (!p) return false
  return PLANS.some(k => Math.abs(form[k] / 100 - p.markup[k]) > 1e-6) || Number(form.minLabelFee) !== p.minLabelFee || Number(form.per100) !== p.insurance.per100 || Number(form.freeUpTo) !== p.insurance.freeUpTo
})
function payload(src = form) {
  return { markup: Object.fromEntries(PLANS.map(k => [k, Number(src[k]) / 100])), minLabelFee: Number(src.minLabelFee), insurance: { per100: Number(src.per100), freeUpTo: Number(src.freeUpTo) } }
}
async function savePlatform() {
  formErr.value = {}
  const prev = data.value.platform
  saving.value = true
  try {
    await updatePlatformTariff(payload())
    await load()
    toast.success(t('admin.rates.platformSaved'), {
      action: { label: t('common.undo'), onClick: async () => { await updatePlatformTariff({ markup: prev.markup, minLabelFee: prev.minLabelFee, insurance: prev.insurance }); await load(); toast.info(t('admin.rates.platformRestored')) } },
    })
  } catch (e) {
    formErr.value = Object.fromEntries(Object.entries(e?.details ?? {}).map(([k, v]) => [k, fieldText(v, 'admin')]))
    toast.error(errorText(e, 'admin'))
  } finally { saving.value = false }
}
// live preview: reference shipment of the landing calculator (NJ01 -> Austin TX 78701, 2 lb, 10x8x4)
const REF = { hub: 'NJ01', toZip: '78701', toState: 'TX', pkg: { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: 2 }, residential: true }
const preview = computed(() => {
  if (!data.value) return []
  const rc = JSON.parse(JSON.stringify(db.doc('rate_cards')))
  const draft = { ...rc, platform: { ...rc.platform, ...payload(), insurance: { ...rc.platform?.insurance, ...payload().insurance } } }
  const carriers = db.all('carriers')
  const services = ['UPS-GROUND', 'USPS-GA', 'FDX-HOME']
  return services.map(key => {
    const row = { key, name: '', current: {}, next: {} }
    for (const plan of PLANS) {
      const q1 = rateShop({ ...REF, carriers, plan, rateCards: { ...rc, dynamicOverrides: [] } }).find(q => `${q.carrierCode}-${q.serviceCode}` === key && q.source === 'platform')
      const q2 = rateShop({ ...REF, carriers, plan, rateCards: { ...draft, dynamicOverrides: [] } }).find(q => `${q.carrierCode}-${q.serviceCode}` === key && q.source === 'platform')
      if (q1) { row.name = q1.serviceName; row.carrier = q1.carrierCode; row.cost = q1.cost }
      row.current[plan] = q1?.sellPrice ?? null
      row.next[plan] = q2?.sellPrice ?? null
    }
    return row
  }).filter(r => r.name)
})

// ----- customer cards ---------------------------------------------------------------------
const editorOpen = ref(false)
const editing = ref(null)
const cardBusy = ref('')
const markups = computed(() => data.value?.platform?.markup ?? {})
function newCard() { editing.value = null; editorOpen.value = true }
function editCard(c) { editing.value = c; editorOpen.value = true }
async function onSaved() { await load() }
async function setStatus(c, s) {
  cardBusy.value = c.id
  try {
    await setCustomerCardStatus(c.id, s)
    await load()
    toast.success(t('admin.rates.statusChanged', { name: c.name, status: t('status.' + s) }))
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { cardBusy.value = '' }
}
async function removeCard(c) {
  const ok = await confirm({ title: t('admin.rates.deleteTitle', { name: c.name }), message: t('admin.rates.deleteDesc'), confirmLabel: t('common.delete'), danger: true })
  if (!ok) return
  cardBusy.value = c.id
  try {
    const r = await removeCustomerCard(c.id)
    await load()
    toast.success(t('admin.rates.deleted', { name: c.name }), { action: { label: t('common.undo'), onClick: async () => { await restoreCustomerCard(r.removed, r.index); await load() } } })
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { cardBusy.value = '' }
}
function cardMenu(c) {
  return [
    { key: 'edit', label: t('common.edit'), icon: 'edit', disabled: locked.value, onClick: () => editCard(c) },
    ...(c.status !== 'approved' ? [{ key: 'approve', label: t('admin.rates.approve'), icon: 'check', disabled: locked.value, onClick: () => setStatus(c, 'approved') }] : []),
    ...(c.status === 'approved' ? [{ key: 'suspend', label: t('admin.rates.suspend'), icon: 'pause', disabled: locked.value, onClick: () => setStatus(c, 'pending_review') }] : []),
    { key: 'sim', label: t('admin.rates.simulate'), icon: 'play', onClick: () => { tab.value = 'simulator' } },
    { divider: true, key: 'd' },
    { key: 'delete', label: t('common.delete'), icon: 'trash', danger: true, disabled: locked.value, onClick: () => removeCard(c) },
  ]
}
function serviceName(carrier, service) {
  const c = db.get('carriers', carrier)
  return c?.services?.find(s => s.code === service)?.name ?? `${carrier} ${service}`
}
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.adminRateCards')" :subtitle="t('admin.rates.subtitle')">
      <template #actions>
        <button v-if="tab === 'customers'" class="btn btn-primary" :disabled="locked || loading" :title="locked ? t('common.noPermission') : undefined" @click="newCard"><Icon name="plus" :size="14" />{{ t('admin.rates.newCard') }}</button>
      </template>
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" />

    <div class="body">
      <template v-if="loading"><Skeleton variant="rect" :height="160" class="mb" /><Skeleton :lines="8" /></template>
      <EmptyState v-else-if="failed" icon="dollar" :title="t('common.errorGeneric')" :action-label="t('common.retry')" @action="load" />

      <template v-else-if="data">
        <!-- agreements -->
        <div v-if="tab === 'agreements'" class="stack-lg">
          <p class="lead">{{ t('admin.rates.agreementsDesc') }}</p>
          <div class="ag-grid">
            <Card v-for="a in data.carrierAgreements" :key="a.carrier" :data-testid="'rate-agreement-' + a.carrier" padding="md">
              <template #header>
                <div class="ag-head">
                  <CarrierLogo :code="a.carrier" :name="a.carrierName" :color="a.color" :ink="a.ink" show-name :size="30" :sub="t('admin.rates.signedOn', { date: fmt.date(a.signedAt) })" />
                  <StatusPill :status="a.status || 'active'" size="sm" />
                </div>
              </template>
              <dl class="kv sm">
                <dt>{{ t('admin.rates.baseDiscount') }}</dt><dd>{{ fmt.percent(a.baseDiscountPct, 0) }}</dd>
                <dt>{{ t('admin.rates.validUntil') }}</dt><dd><DateTime :value="a.validUntil" mode="date" /></dd>
                <dt>{{ t('admin.rates.fuelRule') }}</dt><dd>{{ tx(a.fuelRule) }}</dd>
                <dt>{{ t('admin.rates.weekly') }}</dt><dd>{{ t('admin.rates.weeklyNow', { n: fmt.number(a.weeklyVolume, 1) }) }}</dd>
              </dl>
              <div class="tiers">
                <div class="tiers-h">{{ t('admin.rates.tiersTitle') }}</div>
                <div class="tier-row" v-for="tr in a.tiers" :key="tr.weeklyVolume">
                  <span>{{ t('admin.rates.tierFrom', { n: tr.weeklyVolume }) }}</span>
                  <span class="num">{{ t('admin.rates.extra', { pct: fmt.percent(tr.discountPct, 0) }) }}</span>
                  <span class="tflags">
                    <span v-if="a.reachedTier && a.reachedTier.weeklyVolume === tr.weeklyVolume" class="tag">{{ t('admin.rates.reached') }}</span>
                    <span v-if="(a.activeTierDiscountPct ?? 0) === tr.discountPct" class="tag tag-accent">{{ t('admin.rates.activeTier') }}</span>
                  </span>
                </div>
                <div v-if="a.nextTier" class="next">
                  <div class="bar"><i :style="{ width: tierProgress(a) + '%' }" /></div>
                  <span>{{ t('admin.rates.toNext', { n: fmt.number(Math.max(0, a.nextTier.weeklyVolume - a.weeklyVolume), 1), pct: fmt.percent(a.nextTier.discountPct, 0) }) }}</span>
                </div>
              </div>
              <template #footer>
                <div class="ag-foot">
                  <label :for="'tier-' + a.carrier">{{ t('admin.rates.applyTier') }}</label>
                  <select :id="'tier-' + a.carrier" class="select sm" :value="a.activeTierDiscountPct ?? 0" :disabled="locked || tierBusy === a.carrier" @change="e => changeTier(a, e.target.value)">
                    <option v-for="tr in a.tiers" :key="tr.weeklyVolume" :value="tr.discountPct">{{ t('admin.rates.tierOption', { n: tr.weeklyVolume, pct: fmt.percent(tr.discountPct, 0) }) }}</option>
                  </select>
                  <Spinner v-if="tierBusy === a.carrier" :size="14" />
                </div>
              </template>
            </Card>
          </div>
          <div class="callout neutral"><Icon name="info" :size="14" />{{ t('admin.rates.tierNote') }}</div>
        </div>

        <!-- platform -->
        <div v-else-if="tab === 'platform'" class="grid-2 top">
          <Card :title="t('admin.rates.platformTitle')" :subtitle="t('admin.rates.platformDesc')">
            <form id="platform-form" class="stack-lg" novalidate @submit.prevent="savePlatform">
              <div>
                <div class="lbl">{{ t('admin.rates.markupTitle') }}</div>
                <div class="plans">
                  <FormField v-for="p in PLANS" :key="p" :label="t('plans.' + p)" :error="formErr['markup.' + p]" :value="form[p]" v-slot="{ id }">
                    <div class="suffix"><input :id="id" v-model.number="form[p]" type="number" step="0.5" min="0" max="100" class="input num" :disabled="locked" :aria-invalid="!!formErr['markup.' + p]" /><span>%</span></div>
                  </FormField>
                </div>
              </div>
              <div class="form-grid">
                <FormField :label="t('admin.rates.minFee')" :hint="t('admin.rates.minFeeHint')" :error="formErr.minLabelFee" :value="form.minLabelFee" v-slot="{ id }">
                  <div class="suffix"><span class="mono">USD</span><input :id="id" v-model.number="form.minLabelFee" type="number" step="0.05" min="0" class="input num" :disabled="locked" /></div>
                </FormField>
                <FormField :label="t('admin.rates.insPer100')" :error="formErr['insurance.per100']" :value="form.per100" v-slot="{ id }">
                  <div class="suffix"><span class="mono">USD</span><input :id="id" v-model.number="form.per100" type="number" step="0.05" min="0" class="input num" :disabled="locked" /></div>
                </FormField>
                <FormField :label="t('admin.rates.insFree')" :error="formErr['insurance.freeUpTo']" :value="form.freeUpTo" v-slot="{ id }">
                  <div class="suffix"><span class="mono">USD</span><input :id="id" v-model.number="form.freeUpTo" type="number" step="10" min="0" class="input num" :disabled="locked" /></div>
                </FormField>
              </div>
              <p class="hint">{{ t('admin.rates.insuranceRule', { free: fmt.money(Number(form.freeUpTo) || 0), per: fmt.money(Number(form.per100) || 0) }) }}</p>
            </form>
            <template #footer>
              <div class="foot-row">
                <span class="hint">{{ t('admin.rates.landingNote') }}</span>
                <span class="grow" />
                <button class="btn btn-ghost" :disabled="!dirty || saving" @click="resetForm">{{ t('common.cancel') }}</button>
                <button type="submit" form="platform-form" class="btn btn-primary" :disabled="!dirty || saving || locked" :title="locked ? t('common.noPermission') : undefined"><Spinner v-if="saving" :size="14" />{{ t('common.save') }}</button>
              </div>
            </template>
          </Card>
          <Card :title="t('admin.rates.previewTitle')" :subtitle="t('admin.rates.previewDesc')" padding="none">
            <div class="table-wrap">
              <table class="table-simple">
                <thead><tr><th>{{ t('admin.rates.service') }}</th><th v-for="p in PLANS" :key="p" class="r">{{ t('plans.' + p) }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in preview" :key="r.key">
                    <td><CarrierLogo :code="r.carrier" :name="r.name" show-name :size="20" :sub="r.cost != null ? t('admin.rates.costLine', { cost: fmt.money(r.cost) }) : ''" /></td>
                    <td v-for="p in PLANS" :key="p" class="r num">
                      <span :class="{ changed: r.next[p] !== r.current[p] }">{{ r.next[p] != null ? fmt.money(r.next[p]) : '-' }}</span>
                      <div v-if="r.next[p] !== r.current[p]" class="was">{{ fmt.money(r.current[p]) }}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <template #footer><span class="hint">{{ dirty ? t('admin.rates.previewDirty') : t('admin.rates.previewClean') }}</span></template>
          </Card>
        </div>

        <!-- customer cards -->
        <div v-else-if="tab === 'customers'" class="stack-lg">
          <p class="lead">{{ t('admin.rates.customersDesc') }}</p>
          <EmptyState v-if="!data.customerCards.length" icon="dollar" :title="t('admin.rates.noCards')" :description="t('admin.rates.noCardsDesc')" :action-label="locked ? '' : t('admin.rates.newCard')" @action="newCard" />
          <Card v-for="c in data.customerCards" v-else :key="c.id" padding="none">
            <template #header>
              <div class="cc-head">
                <div>
                  <div class="cc-name">{{ c.name }} <span class="mono muted small">{{ c.id }}</span></div>
                  <div class="muted small">{{ c.customerName }} · <DateTime :value="c.validFrom" mode="date" /> - <DateTime :value="c.validUntil" mode="date" /></div>
                </div>
                <div class="cc-right">
                  <StatusPill :status="c.status" size="sm" />
                  <span v-if="c.status === 'approved'" :class="['tag', c.active ? 'tag-success' : '']">{{ c.active ? t('admin.rates.inEffect') : t('admin.rates.notInEffect') }}</span>
                  <Spinner v-if="cardBusy === c.id" :size="14" />
                  <Dropdown :items="cardMenu(c)" :aria-label="t('common.actions')" />
                </div>
              </div>
            </template>
            <table class="table-simple">
              <thead><tr><th>{{ t('admin.rates.service') }}</th><th>{{ t('admin.rates.mode') }}</th><th class="r">{{ t('admin.rates.value') }}</th><th class="r">{{ t('admin.rates.vsPlan') }}</th></tr></thead>
              <tbody>
                <tr v-for="l in c.lines" :key="l.carrier + l.service">
                  <td><CarrierLogo :code="l.carrier" :name="serviceName(l.carrier, l.service)" show-name :size="20" /></td>
                  <td>{{ l.fixedPrice != null ? t('admin.rates.modeFixed') : t('admin.rates.modeMarkup') }}</td>
                  <td class="r num">{{ l.fixedPrice != null ? fmt.money(l.fixedPrice) : fmt.percent(l.markupPct, 1) }}</td>
                  <td class="r num">
                    <template v-if="l.fixedPrice == null && markups[data.customers.find(x => x.id === c.customerId)?.plan] != null">
                      {{ t('admin.rates.pointsDiff', { d: fmt.number((l.markupPct - markups[data.customers.find(x => x.id === c.customerId).plan]) * 100, 1) }) }}
                    </template>
                    <template v-else>-</template>
                  </td>
                </tr>
              </tbody>
            </table>
            <template #footer>
              <span class="muted small">{{ tx(c.note) || '-' }}<template v-if="c.approvedBy"> · {{ t('admin.rates.approvedBy', { name: c.approvedBy }) }}</template></span>
            </template>
          </Card>
        </div>

        <!-- dynamic overrides -->
        <div v-else-if="tab === 'dynamic'" class="stack-lg">
          <div class="dyn-head">
            <p class="lead">{{ t('admin.rates.dynamicDesc') }}</p>
            <RouterLink :to="{ name: 'ai-pricing' }" class="btn btn-soft"><Icon name="brain" :size="14" />{{ t('admin.rates.manageInAi') }}</RouterLink>
          </div>
          <Card padding="none">
            <EmptyState v-if="!data.dynamicOverrides.length" icon="spark" :title="t('admin.rates.noDynamic')" :description="t('admin.rates.noDynamicDesc')" :action-label="t('admin.rates.manageInAi')" @action="router.push({ name: 'ai-pricing' })" />
            <div v-else class="table-wrap">
              <table class="table-simple">
                <thead><tr><th>{{ t('admin.rates.lane') }}</th><th>{{ t('admin.rates.service') }}</th><th class="r">{{ t('admin.rates.recommended') }}</th><th class="r">{{ t('admin.rates.approvedPrice') }}</th><th>{{ t('admin.rates.validUntil') }}</th><th>{{ t('admin.rates.approvedByCol') }}</th></tr></thead>
                <tbody>
                  <tr v-for="o in data.dynamicOverrides" :key="o.id">
                    <td class="mono small">{{ o.lane }}</td>
                    <td><CarrierLogo :code="o.carrier" :name="o.carrierName" show-name :sub="o.serviceName" :size="20" /></td>
                    <td class="r num">{{ o.recommendedPrice != null ? fmt.money(o.recommendedPrice) : '-' }}</td>
                    <td class="r num"><strong>{{ fmt.money(o.price) }}</strong></td>
                    <td><DateTime :value="o.validUntil" /></td>
                    <td>{{ o.approvedBy || '-' }}<span v-if="o.auto" class="tag">{{ t('admin.rates.auto') }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <!-- simulator -->
        <PriceSimulator v-else :customers="data.customers" />
      </template>
    </div>

    <CustomerCardEditor v-model:open="editorOpen" :card="editing" :customers="data?.customers ?? []" :markups="markups" @saved="onSaved" />
  </div>
</template>

<style scoped>
.body { margin-top: 16px; }
.mb { margin-bottom: 16px; }
.lead { margin: 0; color: var(--ink-2); font-size: 13.5px; max-width: 820px; }
.ag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.ag-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; }
.kv.sm { font-size: 13px; }
.tiers { margin-top: 12px; border-top: 1px dashed var(--line-2); padding-top: 10px; }
.tiers-h { font-size: 12px; color: var(--ink-3); margin-bottom: 6px; }
.tier-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; font-size: 13px; padding: 3px 0; }
.tflags { grid-column: 1 / -1; display: flex; gap: 6px; }
.tflags:empty { display: none; }
.next { margin-top: 8px; font-size: 12px; color: var(--ink-3); display: flex; flex-direction: column; gap: 4px; }
.bar { height: 6px; border-radius: 99px; background: var(--bg-3); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
.ag-foot { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); width: 100%; flex-wrap: wrap; }
.ag-foot .select { flex: 1; min-width: 160px; }
.select.sm { height: 32px; font-size: 13px; }
.top { align-items: start; }
.top > * { min-width: 0; }
.lbl { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--ink-2); }
.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.suffix { display: flex; align-items: center; gap: 6px; }
.suffix span { color: var(--ink-3); font-size: 13px; }
.suffix .input { width: 100%; }
.hint { color: var(--ink-3); font-size: 12.5px; margin: 0; }
.foot-row { display: flex; align-items: center; gap: 8px; width: 100%; flex-wrap: wrap; }
.grow { flex: 1; }
.r { text-align: right; }
.changed { color: var(--accent-ink); font-weight: 600; }
.was { font-size: 11px; color: var(--ink-4); text-decoration: line-through; }
.cc-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; width: 100%; flex-wrap: wrap; }
.cc-name { font-weight: 600; }
.cc-right { display: flex; align-items: center; gap: 8px; }
.muted { color: var(--ink-3); }
.small { font-size: 12px; }
.dyn-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
@media (max-width: 860px) { .plans { grid-template-columns: 1fr; } }
</style>
