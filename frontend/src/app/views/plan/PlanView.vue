<script setup>
// Plan (spec 5.11): 3 tiers, prorated change, feature locks, plan advisor, last recommendation, usage meters.
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Skeleton from '../../components/Skeleton.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import DateTime from '../../components/DateTime.vue'
import ChangePlanModal from './ChangePlanModal.vue'
import PlanAdvisorModal from './PlanAdvisorModal.vue'
import { getPlanOverview, planFeatureMatrix, FEATURE_KEYS, PLAN_IDS } from '../../api/plan.js'
import { advisePlan } from '../auth/planAdvisor.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { session, can } from '../../store/session.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()
const data = ref(null)
const loading = ref(true)
const error = ref('')
const changeOpen = ref(false)
const changeTo = ref(null)
const advisorOpen = ref(false)
const matrix = planFeatureMatrix()

async function load() {
  error.value = ''
  try { data.value = await getPlanOverview() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(() => {
  load()
  const up = route.query.upgrade
  if (PLAN_IDS.includes(up) && up !== session.plan) openChange(up)
  if (route.query.advisor === '1') advisorOpen.value = true
})
watch(() => [session.plan, db.doc('user')?.onboardingAnswers?.completedAt], () => load())

const current = computed(() => session.plan)
const plans = computed(() => data.value?.plans ?? db.doc('rate_cards')?.plans ?? [])
const idx = id => PLAN_IDS.indexOf(id)
function openChange(id) {
  changeTo.value = id
  changeOpen.value = true
  if (route.query.upgrade) router.replace({ query: { ...route.query, upgrade: undefined } })
}
const TAGLINE = { starter: 'starter', professional: 'professional', enterprise: 'enterprise' }

// last recommendation
const rec = computed(() => data.value?.recommendation ?? null)
const recAdvice = computed(() => (rec.value ? advisePlan(rec.value) : null))
const planName = id => tx(plans.value.find(p => p.id === id)?.name) || id

// usage
const u = computed(() => data.value?.usage)
const pct = (v, lim) => (lim ? Math.min(100, Math.round((v / lim) * 100)) : null)
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.plan')" :subtitle="t('plan.subtitle')">
      <template #actions>
        <button class="btn btn-soft" @click="advisorOpen = true"><Icon name="wand" :size="14" /> {{ t('plan.advisor.button') }}</button>
      </template>
    </PageHeader>
    <div v-if="error" class="callout danger mb">{{ error }} <button class="btn-link" @click="load">{{ t('common.retry') }}</button></div>

    <!-- current plan banner -->
    <section class="panel banner">
      <Skeleton v-if="loading && !data" :lines="2" />
      <template v-else-if="data">
        <div>
          <div class="eyebrow">{{ t('plan.currentPlan') }}</div>
          <div class="cur">{{ planName(current) }} <span class="tag tag-accent">{{ t('plan.perMonth', { fee: fmt.money(plans.find(p => p.id === current)?.monthlyFee ?? 0, 'USD', 0) }) }}</span></div>
          <div class="sub">{{ t('plan.since', { date: fmt.date(data.changedAt ?? data.since) }) }} · {{ t('plan.nextBilling', { date: fmt.date(data.cycle.end), days: data.cycle.daysLeft }) }}</div>
        </div>
        <div class="banner-right">
          <div class="mk"><span>{{ t('plan.labelMarkup') }}</span><strong>{{ fmt.percent(plans.find(p => p.id === current)?.markupPct ?? 0, 0) }}</strong></div>
        </div>
      </template>
    </section>

    <!-- plan cards -->
    <div class="plans">
      <article v-for="p in plans" :key="p.id" :data-testid="'plan-card-' + p.id" class="plan panel" :class="{ on: p.id === current, rec: rec && rec.recommendedPlan === p.id }">
        <div v-if="p.id === current" class="ribbon">{{ t('plan.current') }}</div>
        <div v-else-if="rec && rec.recommendedPlan === p.id" class="ribbon ai"><Icon name="spark" :size="11" /> {{ t('plan.recommended') }}</div>
        <h3>{{ tx(p.name) }}</h3>
        <p class="tagline">{{ t('plan.tagline.' + TAGLINE[p.id]) }}</p>
        <div class="price"><strong>{{ fmt.money(p.monthlyFee, 'USD', 0) }}</strong><span>/ {{ t('plan.change.month') }}</span></div>
        <div class="markup">{{ t('plan.markupLong', { pct: fmt.percent(p.markupPct, 0) }) }}</div>
        <ul class="feats">
          <li v-for="(f, i) in p.features" :key="i"><Icon name="check" :size="13" /> {{ tx(f) }}</li>
        </ul>
        <div class="limits">
          <span><Icon name="store" :size="12" /> {{ p.limits.stores ? t('plan.limit.stores', { n: p.limits.stores }) : t('plan.limit.storesUnlimited') }}</span>
          <span><Icon name="users" :size="12" /> {{ p.limits.users ? t('plan.limit.users', { n: p.limits.users }) : t('plan.limit.usersUnlimited') }}</span>
        </div>
        <button v-if="p.id === current" class="btn btn-ghost block" disabled>{{ t('plan.current') }}</button>
        <button v-else class="btn block" :class="idx(p.id) > idx(current) ? 'btn-accent' : 'btn-ghost'" :disabled="!can('settings.manage')" :title="can('settings.manage') ? '' : t('common.noPermission')" @click="openChange(p.id)">
          {{ idx(p.id) > idx(current) ? t('plan.upgradeTo', { plan: tx(p.name) }) : t('plan.downgradeTo', { plan: tx(p.name) }) }}
        </button>
      </article>
    </div>

    <div class="grid-2 mt">
      <!-- last recommendation -->
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title"><Icon name="spark" :size="14" class="ai-ic" /> {{ t('plan.lastRec.title') }}</div>
          <span v-if="rec?.completedAt" class="panel-sub"><DateTime :value="rec.completedAt" /></span>
        </div>
        <div class="panel-pad">
          <Skeleton v-if="loading && !data" :lines="4" />
          <div v-else-if="!rec" class="norec">
            <p>{{ t('plan.lastRec.empty') }}</p>
            <button class="btn btn-soft btn-sm" @click="advisorOpen = true"><Icon name="wand" :size="13" /> {{ t('plan.advisor.button') }}</button>
          </div>
          <div v-else class="recbody">
            <div class="recplan">
              <div><span>{{ t('plan.lastRec.recommended') }}</span><strong>{{ planName(rec.recommendedPlan) }}</strong></div>
              <div v-if="rec.chosenPlan && rec.chosenPlan !== rec.recommendedPlan"><span>{{ t('plan.lastRec.chosen') }}</span><strong>{{ planName(rec.chosenPlan) }}</strong></div>
              <div><span>{{ t('plan.lastRec.hub') }}</span><strong>{{ rec.hub ?? recAdvice?.hub }}</strong></div>
              <div v-if="recAdvice"><span>{{ t('plan.lastRec.confidence') }}</span><strong>{{ fmt.percent(recAdvice.confidence, 0) }}</strong></div>
            </div>
            <ul v-if="recAdvice" class="reasons">
              <li v-for="(r, i) in recAdvice.reasons.plan" :key="i">{{ tx(r) }}</li>
              <li>{{ tx(recAdvice.reasons.hub) }}</li>
            </ul>
            <div v-if="recAdvice?.services.length" class="services">
              <RouterLink v-for="s in recAdvice.services" :key="s.code" :to="s.link" class="svc" :title="tx(s.reason)"><Icon name="arrow" :size="12" /> {{ tx(s.title) }}</RouterLink>
            </div>
            <div class="rec-src">{{ rec.source === 'plan_advisor' ? t('plan.lastRec.fromAdvisor') : t('plan.lastRec.fromOnboarding') }}</div>
            <div class="row-end">
              <button class="btn btn-ghost btn-sm" @click="advisorOpen = true">{{ t('plan.lastRec.rerun') }}</button>
              <button v-if="rec.recommendedPlan && rec.recommendedPlan !== current" class="btn btn-accent btn-sm" :disabled="!can('settings.manage')" @click="openChange(rec.recommendedPlan)">{{ t('plan.lastRec.apply', { plan: planName(rec.recommendedPlan) }) }}</button>
            </div>
          </div>
        </div>
      </section>

      <!-- usage -->
      <section class="panel">
        <div class="panel-head"><div class="panel-title">{{ t('plan.usage.title') }}</div><span class="panel-sub">{{ t('plan.usage.period') }}</span></div>
        <div class="panel-pad usage">
          <Skeleton v-if="loading && !data" :lines="6" />
          <template v-else-if="u">
            <div class="meter">
              <div class="m-row"><span><Icon name="tag" :size="13" /> {{ t('plan.usage.labels') }}</span><strong class="num">{{ fmt.number(u.labels.month) }}</strong></div>
              <div class="m-sub">{{ t('plan.usage.unlimitedLabels') }}</div>
            </div>
            <div class="meter">
              <div class="m-row"><span><Icon name="store" :size="13" /> {{ t('plan.usage.stores') }}</span><strong class="num">{{ fmt.number(u.stores.connected) }} / {{ u.stores.limit ?? '∞' }}</strong></div>
              <ProgressBar v-if="u.stores.limit" :value="pct(u.stores.connected, u.stores.limit)" :tone="u.stores.connected > u.stores.limit ? 'danger' : 'accent'" size="sm" />
              <div v-if="u.stores.limit && u.stores.connected > u.stores.limit" class="m-sub text-danger">{{ t('plan.usage.overLimit') }}</div>
            </div>
            <div class="meter">
              <div class="m-row"><span><Icon name="code" :size="13" /> {{ t('plan.usage.api') }}</span><strong class="num">{{ fmt.number(u.apiCalls.month) }}</strong></div>
              <div class="m-sub">{{ t('plan.usage.apiSplit', { api: fmt.number(u.apiCalls.api), panel: fmt.number(u.apiCalls.panel) }) }} <RouterLink v-if="session.plan !== 'starter'" to="/integrations/api" class="link">{{ t('plan.usage.apiLog') }}</RouterLink></div>
            </div>
            <div class="meter">
              <div class="m-row"><span><Icon name="users" :size="13" /> {{ t('plan.usage.users') }}</span><strong class="num">{{ fmt.number(u.users.active) }} / {{ u.users.limit ?? '∞' }}</strong></div>
              <ProgressBar v-if="u.users.limit" :value="pct(u.users.active, u.users.limit)" :tone="u.users.active > u.users.limit ? 'danger' : 'accent'" size="sm" />
              <div v-if="u.users.invited" class="m-sub">{{ t('plan.usage.invited', { n: u.users.invited }) }}</div>
            </div>
          </template>
        </div>
      </section>
    </div>

    <!-- comparison -->
    <section class="panel mt">
      <div class="panel-head"><div class="panel-title">{{ t('plan.compare') }}</div></div>
      <div class="table-wrap">
        <table class="table-simple cmp">
          <thead><tr><th>{{ t('plan.feature') }}</th><th v-for="p in PLAN_IDS" :key="p" :class="{ curcol: p === current }">{{ planName(p) }}</th></tr></thead>
          <tbody>
            <tr v-for="f in FEATURE_KEYS" :key="f">
              <td>{{ t('plan.features.' + f) }}</td>
              <td v-for="p in PLAN_IDS" :key="p" :class="{ curcol: p === current }">
                <template v-if="typeof matrix[f][p] === 'string'">{{ matrix[f][p] === 'unlimited' ? t('plan.unlimited') : matrix[f][p] }}</template>
                <Icon v-else-if="matrix[f][p]" name="check" :size="15" class="yes" />
                <Icon v-else name="lock" :size="13" class="no" />
              </td>
            </tr>
            <tr>
              <td>{{ t('plan.labelMarkup') }}</td>
              <td v-for="p in PLAN_IDS" :key="p" :class="{ curcol: p === current }" class="num">{{ fmt.percent(plans.find(x => x.id === p)?.markupPct ?? 0, 0) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ChangePlanModal v-model:open="changeOpen" :plan-id="changeTo" @changed="load" />
    <PlanAdvisorModal v-model:open="advisorOpen" @saved="load" @choose="id => id !== current && openChange(id)" />
  </div>
</template>

<style scoped>
.mb { margin-bottom: 12px; }
.mt { margin-top: 16px; }
.banner { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 22px; flex-wrap: wrap; }
.eyebrow { font-size: 12px; color: var(--ink-3); }
.cur { font-family: var(--font-display); font-size: 24px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.sub { font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
.mk { display: flex; flex-direction: column; align-items: flex-end; }
.mk span { font-size: 12px; color: var(--ink-3); }
.mk strong { font-size: 20px; font-family: var(--font-display); }
.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.plan { position: relative; padding: 22px; display: flex; flex-direction: column; gap: 8px; }
.plan.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset, var(--shadow-md); }
.plan.rec:not(.on) { border-color: oklch(0.8 0.1 290); }
.ribbon { position: absolute; top: 14px; right: 14px; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: var(--accent); color: white; display: inline-flex; gap: 4px; align-items: center; }
.ribbon.ai { background: oklch(0.55 0.18 295); }
.plan h3 { margin: 0; font-family: var(--font-display); font-size: 19px; }
.tagline { margin: 0; color: var(--ink-3); font-size: 13px; min-height: 36px; }
.price strong { font-family: var(--font-display); font-size: 32px; letter-spacing: -0.02em; }
.price span { color: var(--ink-3); margin-left: 4px; font-size: 13px; }
.markup { font-size: 12.5px; color: var(--ink-2); }
.feats { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 7px; font-size: 13.5px; flex: 1; }
.feats li { display: flex; gap: 8px; align-items: flex-start; }
.feats :deep(svg) { color: var(--success); margin-top: 3px; flex: 0 0 auto; }
.limits { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--ink-3); margin-bottom: 6px; }
.limits span { display: inline-flex; gap: 4px; align-items: center; }
.block { width: 100%; justify-content: center; }
.ai-ic { color: oklch(0.55 0.18 295); vertical-align: -2px; }
.norec p { color: var(--ink-3); font-size: 13.5px; margin: 0 0 10px; }
.recbody { display: flex; flex-direction: column; gap: 12px; }
.recplan { display: flex; gap: 22px; flex-wrap: wrap; }
.recplan div { display: flex; flex-direction: column; }
.recplan span { font-size: 11.5px; color: var(--ink-3); }
.recplan strong { font-size: 15px; }
.reasons { margin: 0; padding-left: 18px; font-size: 13px; color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
.services { display: flex; flex-wrap: wrap; gap: 6px; }
.svc { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; padding: 4px 10px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line-1); color: var(--ink-1); }
.svc:hover { border-color: var(--accent); color: var(--accent-ink); }
.rec-src { font-size: 12px; color: var(--ink-3); }
.row-end { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.usage { display: flex; flex-direction: column; gap: 16px; }
.meter { display: flex; flex-direction: column; gap: 6px; }
.m-row { display: flex; justify-content: space-between; font-size: 13.5px; }
.m-row span { display: inline-flex; gap: 6px; align-items: center; color: var(--ink-2); }
.m-sub { font-size: 12px; color: var(--ink-3); }
.cmp th:not(:first-child), .cmp td:not(:first-child) { text-align: center; }
.curcol { background: color-mix(in oklch, var(--accent-soft) 45%, transparent); }
.yes { color: var(--success); }
.no { color: var(--ink-4); }
@media (max-width: 1100px) { .plans { grid-template-columns: 1fr; } }
</style>
