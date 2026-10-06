/**
 * Plan API (spec 5.11): three plan tiers, prorated plan changes, usage meters, advisor result.
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * PLAN_IDS = ['starter', 'professional', 'enterprise']
 * FEATURE_KEYS = ['manualLabels', 'stores', 'emailSupport', 'api', 'webhooks', 'batch', 'unlimitedStores',
 *                 'team', 'customRates', 'rules', 'intl', 'customs', 'dedicatedSupport']   (comparison table rows)
 * planFeatureMatrix() -> { [featureKey]: { starter, professional, enterprise } }  (sync; true | false | string)
 * getPlanOverview() -> { current, since, plans: Plan[], cycle: { start, end, daysLeft, days }, usage, recommendation }
 *   Plan = rate_cards.plans[i] = { id, name{tr,en}, monthlyFee, markupPct, limits{stores, users, apiAccess}, features[{tr,en}] }
 *   usage = { labels: {month, total}, stores: {connected, limit}, apiCalls: {month, api, panel, logged}, users: {active, limit} }
 *   recommendation = user.onboardingAnswers | null
 * quotePlanChange(planId) -> { from, to, direction: 'upgrade'|'downgrade'|'same', monthlyFrom, monthlyTo,
 *   prorated (>0 charge, <0 credit), daysLeft, days, markupFrom, markupTo, gained: [feature], lost: [feature],
 *   storesOver, usersOver, nextBillingAt }                                              (sync)
 * changePlan(planId) -> { plan, previous, transaction|null, balance, quote }
 *   upgrade: prorated difference charged from the wallet (type plan_fee); downgrade: prorated credit.
 *   errors: SAME_PLAN, NOT_FOUND, INSUFFICIENT_FUNDS
 * saveAdvisorResult({ answers, recommendation, chosenPlan }) -> onboardingAnswers  (source 'plan_advisor')
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { PLAN_FEATURES } from '../store/session.js'
import { audit, notify } from '../store/events.js'
import { chargeWallet, creditWallet } from './wallet.js'
import { round2 } from '@/shared/rateEngine.js'
import { moneyText } from '@/shared/currency.js'

export const PLAN_IDS = ['starter', 'professional', 'enterprise']
export const FEATURE_KEYS = ['manualLabels', 'stores', 'emailSupport', 'api', 'webhooks', 'batch', 'team', 'customRates', 'rules', 'intl', 'customs', 'dedicatedSupport']
export const GATED_FEATURES = ['api', 'webhooks', 'batch', 'unlimitedStores', 'team', 'customRates', 'rules', 'intl', 'customs']

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()

function plans() { return db.doc('rate_cards')?.plans ?? [] }
function planOf(id) { return plans().find(p => p.id === id) }
function currentPlan() { return db.doc('user')?.company?.plan ?? 'enterprise' }

export function planFeatureMatrix() {
  const has = (plan, f) => (PLAN_FEATURES[plan] ?? []).includes(f)
  const m = {}
  for (const f of FEATURE_KEYS) {
    m[f] = {}
    for (const p of PLAN_IDS) {
      if (f === 'manualLabels' || f === 'emailSupport') m[f][p] = true
      else if (f === 'stores') m[f][p] = has(p, 'unlimitedStores') ? 'unlimited' : String(planOf(p)?.limits?.stores ?? 2)
      else if (f === 'dedicatedSupport') m[f][p] = p === 'enterprise'
      else m[f][p] = has(p, f)
    }
  }
  return m
}

/** Monthly billing cycle anchored on the plan start day. */
function cycle(now = new Date()) {
  const since = new Date(db.doc('user')?.company?.planSince ?? now)
  const day = since.getDate()
  const start = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28), 0, 0, 0, 0)
  if (start > now) start.setMonth(start.getMonth() - 1)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  const days = Math.round((end - start) / 864e5)
  const daysLeft = Math.max(1, Math.ceil((end - now) / 864e5))
  return { start: start.toISOString(), end: end.toISOString(), days, daysLeft }
}

function monthStartIso() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

function usage() {
  const since = monthStartIso()
  const ships = db.all('shipments').filter(s => !s.test)
  const log = db.all('requestLog')
  const monthLog = log.filter(r => r.at >= since)
  const current = currentPlan()
  const p = planOf(current)
  const team = db.all('team')
  return {
    labels: { month: ships.filter(s => s.createdAt >= since && s.status !== 'voided').length, total: ships.length },
    stores: { connected: db.all('stores').filter(s => s.status === 'connected').length, limit: (PLAN_FEATURES[current] ?? []).includes('unlimitedStores') ? null : (p?.limits?.stores ?? 2) },
    apiCalls: { month: monthLog.length, api: monthLog.filter(r => r.source === 'api').length, panel: monthLog.filter(r => r.source !== 'api').length, logged: log.length },
    users: { active: team.filter(u => u.status === 'active').length || 1, invited: team.filter(u => u.status === 'invited').length, limit: p?.limits?.users ?? null },
  }
}

export function getPlanOverview() {
  return request('GET /v1/plan', () => {
    const user = db.doc('user')
    return {
      current: currentPlan(),
      since: user?.company?.planSince ?? null,
      changedAt: user?.company?.planChangedAt ?? null,
      plans: plain(plans()),
      cycle: cycle(),
      usage: usage(),
      recommendation: plain(user?.onboardingAnswers ?? null),
    }
  }, { minMs: 300, maxMs: 650 })
}

export function quotePlanChange(planId) {
  const from = currentPlan()
  const a = planOf(from)
  const b = planOf(planId)
  if (!b) return null
  const c = cycle()
  const diff = (b.monthlyFee ?? 0) - (a?.monthlyFee ?? 0)
  const prorated = round2(diff * (c.daysLeft / c.days))
  const fa = new Set(PLAN_FEATURES[from] ?? [])
  const fb = new Set(PLAN_FEATURES[planId] ?? [])
  const u = usage()
  const storeLimit = fb.has('unlimitedStores') ? null : (b.limits?.stores ?? 2)
  const idx = PLAN_IDS.indexOf(planId) - PLAN_IDS.indexOf(from)
  return {
    from,
    to: planId,
    direction: idx > 0 ? 'upgrade' : idx < 0 ? 'downgrade' : 'same',
    monthlyFrom: a?.monthlyFee ?? 0,
    monthlyTo: b.monthlyFee ?? 0,
    prorated,
    daysLeft: c.daysLeft,
    days: c.days,
    markupFrom: a?.markupPct ?? null,
    markupTo: b.markupPct ?? null,
    gained: GATED_FEATURES.filter(f => fb.has(f) && !fa.has(f)),
    lost: GATED_FEATURES.filter(f => fa.has(f) && !fb.has(f)),
    storesOver: storeLimit != null && u.stores.connected > storeLimit ? u.stores.connected - storeLimit : 0,
    usersOver: b.limits?.users != null && u.users.active > b.limits.users ? u.users.active - b.limits.users : 0,
    nextBillingAt: c.end,
  }
}

export function changePlan(planId) {
  return request('POST /v1/plan/change', async () => {
    const q = quotePlanChange(planId)
    if (!q) throw new ApiError('NOT_FOUND', 'Plan not found', 404)
    if (q.direction === 'same') throw new ApiError('SAME_PLAN', 'Already on this plan', 409)
    const from = planOf(q.from)
    const to = planOf(planId)
    const res = await db.transaction(() => {
      let transaction = null
      if (q.prorated > 0) {
        transaction = chargeWallet({
          amount: q.prorated,
          type: 'plan_fee',
          description: { tr: `Plan değişikliği · ${from?.name?.tr ?? q.from} > ${to.name.tr} (${q.daysLeft}/${q.days} gün kıst)`, en: `Plan change · ${from?.name?.en ?? q.from} > ${to.name.en} (${q.daysLeft}/${q.days} days prorated)` },
          meta: { planFrom: q.from, planTo: planId },
        }).transaction
      } else if (q.prorated < 0) {
        transaction = creditWallet({
          amount: -q.prorated,
          type: 'plan_fee',
          description: { tr: `Plan değişikliği iadesi · ${from?.name?.tr ?? q.from} > ${to.name.tr} (${q.daysLeft}/${q.days} gün kıst)`, en: `Plan change credit · ${from?.name?.en ?? q.from} > ${to.name.en} (${q.daysLeft}/${q.days} days prorated)` },
          meta: { planFrom: q.from, planTo: planId },
        })
      }
      const user = db.doc('user')
      db.patchDoc('user', { company: { ...plain(user.company), plan: planId, planChangedAt: nowIso(), previousPlan: q.from } })
      return { transaction }
    })
    notify({
      type: 'success',
      title: { tr: `Planınız ${to.name.tr} olarak değiştirildi`, en: `Your plan was changed to ${to.name.en}` },
      body: q.prorated > 0
        ? { tr: `Kıst fark ücreti ${moneyText(q.prorated).tr} cüzdandan düşüldü.`, en: `Prorated difference of ${moneyText(q.prorated).en} charged to the wallet.` }
        : q.prorated < 0
          ? { tr: `Kalan günler için ${moneyText(-q.prorated).tr} cüzdanınıza iade edildi.`, en: `${moneyText(-q.prorated).en} credited to your wallet for the remaining days.` }
          : null,
      link: '/plan',
    })
    audit('plan.change', planId, `${q.from} > ${planId} ${q.prorated}`)
    return { plan: planId, previous: q.from, transaction: res.transaction, balance: db.doc('wallet').balance, quote: q }
  }, { minMs: 700, maxMs: 1100 })
}

export function saveAdvisorResult({ answers, recommendation, chosenPlan = null } = {}) {
  return request('POST /v1/plan/recommendation', () => {
    const prev = db.doc('user')?.onboardingAnswers ?? {}
    const rec = plain(recommendation) ?? {}
    const saved = {
      ...plain(answers),
      recommendedPlan: rec.plan ?? null,
      chosenPlan: chosenPlan ?? rec.plan ?? null,
      scores: rec.scores ?? null,
      hub: rec.hub ?? null,
      services: (rec.services ?? []).map(s => s.code),
      stores: prev.stores ?? [],
      topupAmount: prev.topupAmount ?? null,
      completedAt: nowIso(),
      signup: prev.signup ?? null,
      source: 'plan_advisor',
    }
    db.patchDoc('user', { onboardingAnswers: saved })
    audit('plan.recommendation', saved.recommendedPlan)
    return saved
  }, { minMs: 250, maxMs: 450 })
}
