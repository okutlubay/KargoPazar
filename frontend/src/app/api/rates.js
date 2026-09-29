/**
 * Rate shopping API (spec 3.5, 5.5 step 4, 7.4, 8.7, 10.2).
 * Wraps the pure engine in src/shared/rateEngine.js with live db data: carriers (incl.
 * carriers activated later in Admin), rate cards (plan markup, customer cards, dynamic
 * overrides), connected own carrier accounts, shipping rules and the AI optimizer.
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * buildPricingContext() -> PricingContext
 *   { carriers, rateCards, carrierAccounts (connected only), allAccounts, plan, customerId,
 *     rules (active, by priority), hubs, defaultHub, weight (optimizer cost/speed 0..1), now }
 *
 * quoteShipment(input) -> Promise<RateResult>          request 'POST /v1/rates' (300-900 ms)
 * rateShopNow(input, ctx?) -> Promise<RateResult>      same result, no latency / no request log
 *                                                      (batch jobs, simulators, API console)
 * computeQuotes(input, ctx?) -> RateResult             synchronous, without the AI pick
 *                                                      (aiPickKey falls back to cheapest)
 * quoteOrder(orderId, extra?) -> Promise<RateResult>   quoteShipment() built from an order
 * inputFromOrder(order, extra?) -> input
 * findQuote(result, key) -> Quote|null
 * estimateEtaDate(etaDays, hubCode, now?) -> ISO string (hub cut-off 16:00, business days)
 *
 * input = {
 *   hub?: 'NJ01'|'LA01'            (default: company default hub; a matching assign_hub rule wins
 *                                   unless ignoreHubRule: true)
 *   to: { name?, line1, line2?, city, state, zip, country = 'US', residential = true },
 *   pkg: { lengthIn, widthIn, heightIn, weightLb },
 *   declaredValue?: number, insured?: boolean (default value > $100; forced on by rules),
 *   signature?: boolean (forced on by rules),
 *   orderContext?: { order?, orderId?, channel?, items?: [{sku, qty, unitPrice, weightLb}] },
 *   weight?: 0..1 (cost vs speed; default user preference), addressCheck?: {score, issues},
 *   ignoreHubRule?: boolean, includeInternational?: boolean
 * }
 *
 * RateResult = {
 *   hub, requestedHub, hubAssignedBy: {tr,en}|null,
 *   hubSuggestion: { hub, zones: {NJ01, LA01}, reasonCode: 'closer_zone'|'default' },
 *   zone, zoneGroup, billable: { actualLb, dimWeightLb, billableLb },
 *   insurance: { insured, amount, locked, lockedBy: {tr,en}|null, defaultOn },
 *   signature: { required, fee, lockedBy: {tr,en}|null },
 *   rules: { matched: [{ id, name, actions }], names: [{tr,en}], effects, notes: [{code, ruleName, ...}] },
 *   hold: { ruleId, ruleName } | null, tags: [string],
 *   quotes: Quote[] sorted by total. Each Quote (see rateEngine.js) plus:
 *     badges: ['ai'|'cheapest'|'fastest'|'dynamic'|'own'|'custom'|'rule'],
 *     etaDate (ISO), signatureFee, rankable (false when own account mode is 'always'),
 *     own rows: savingsVsPlatform (platform total - own total, > 0 = cheaper), platformKey
 *     platform rows: ownKey (when an own row exists), connectHint: { carrier, carrierName } | null
 *     aiScore: { score, components } | null
 *   cheapestKey, fastestKey, aiPickKey, forcedKey,
 *   ai: { source: 'optimizer'|'fallback'|'rule', reasonCode, reason?: {tr,en} (optimizer text), ranked: [{ key, score, components }] },
 *     reasonCode: optimizer codes cheapest|fastest|own|risk|reliability|balanced, fallback/rule codes
 *     lowest_cost|rule_forced|rule_strategy  (labels: t('core.aiReasons.<code>'))
 *   defaultQuote: { key, total, hub } | null      (company default hub + UPS Ground platform)
 *   aiSavingsVsDefault: number                     (default total - AI pick total, >= 0)
 *   hints: [{ carrier, carrierName, accountId }]   carriers where an own account can be connected
 *   shipDate: ISO, empty: boolean                  (true when no service is eligible)
 * }
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { evaluate, buildRuleContext, applyEffectsToQuotes } from '../store/rules.js'
import { rateShop, quoteService, zoneFor, zoneGroup, billableWeight, insuranceFor, platformConfig, round2 } from '@/shared/rateEngine.js'

export const SIGNATURE_FEE = 3.1
const DEFAULT_COMPARE = { carrier: 'UPS', service: 'GROUND' }

const aiLoaders = import.meta.glob('../ai/optimizer.js')
let optimizerPromise = null
function loadOptimizer() {
  if (!optimizerPromise) {
    const loader = aiLoaders['../ai/optimizer.js']
    optimizerPromise = loader ? loader().catch(() => null) : Promise.resolve(null)
  }
  return optimizerPromise
}

function plain(v) { return v == null ? v : JSON.parse(JSON.stringify(toRaw(v))) }

export function buildPricingContext() {
  const user = db.doc('user') ?? {}
  const allAccounts = plain(db.all('carrier_accounts'))
  return {
    carriers: plain(db.all('carriers')),
    rateCards: plain(db.doc('rate_cards')),
    carrierAccounts: allAccounts.filter(a => a.status === 'connected'),
    allAccounts,
    plan: user.company?.plan ?? 'enterprise',
    customerId: user.customerId ?? null,
    rules: plain(db.all('rules')).filter(r => r.active !== false).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
    hubs: plain(db.all('hubs')),
    defaultHub: user.company?.defaultHub ?? 'NJ01',
    weight: user.preferences?.optimizerWeight ?? 0.6,
    now: new Date(),
  }
}

function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6 }

function shipDateFor(hubCode, now = new Date(), hubs = null) {
  const hub = (hubs ?? db.all('hubs')).find(h => h.code === hubCode)
  const [ch, cm] = String(hub?.cutoff ?? '16:00').split(':').map(Number)
  const d = new Date(now)
  const afterCutoff = d.getHours() * 60 + d.getMinutes() >= ch * 60 + (cm || 0)
  if (afterCutoff || isWeekend(d)) {
    do { d.setDate(d.getDate() + 1) } while (isWeekend(d))
  }
  d.setHours(ch, cm || 0, 0, 0)
  return d
}

export function estimateEtaDate(etaDays, hubCode, now = new Date(), hubs = null) {
  const d = shipDateFor(hubCode, now, hubs)
  let n = Math.max(1, Math.round(Number(etaDays) || 1))
  while (n > 0) { d.setDate(d.getDate() + 1); if (!isWeekend(d)) n-- }
  d.setHours(20, 0, 0, 0)
  return d.toISOString()
}

const PO_BOX = /\bp\.?\s*o\.?\s*box\b|\bpost\s+office\s+box\b/i

export function inputFromOrder(order, extra = {}) {
  const items = order.items ?? []
  const declaredValue = items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.qty) || 1), 0) || order.total || 0
  return {
    to: order.shipTo,
    pkg: order.package ?? estimatePkg(items),
    declaredValue: round2(declaredValue),
    orderContext: { order },
    addressCheck: order.addressCheck ?? null,
    ...extra,
  }
}

function estimatePkg(items) {
  const w = items.reduce((s, i) => s + (Number(i.weightLb) || 0.5) * (Number(i.qty) || 1), 0)
  return w <= 2 ? { lengthIn: 8, widthIn: 6, heightIn: 4, weightLb: round2(w + 0.3) } : w <= 6 ? { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: round2(w + 0.6) } : { lengthIn: 18, widthIn: 14, heightIn: 8, weightLb: round2(w + 1.1) }
}

/** Synchronous rate shop with rules, badges and hints. AI pick = cheapest (see rateShopNow). */
export function computeQuotes(input, ctx = buildPricingContext()) {
  const to = input.to ?? {}
  const pkg = input.pkg ?? {}
  const oc = input.orderContext ?? {}
  const order = oc.order ?? (oc.orderId ? db.get('orders', oc.orderId) : null)
  const declaredValue = Number(input.declaredValue ?? 0) || 0
  const country = (to.country || 'US').toUpperCase()
  const residential = to.residential !== false

  // Rules
  const ruleCtx = buildRuleContext({ order, to, pkg, declaredValue, channel: oc.channel ?? order?.channel, items: oc.items ?? order?.items })
  const { matched, effects } = evaluate(ruleCtx, { rules: ctx.rules })

  const requestedHub = input.hub ?? ctx.defaultHub
  const hub = !input.ignoreHubRule && effects.hub ? effects.hub.hub : requestedHub
  const cfg = platformConfig(ctx.rateCards)
  const defaultOn = declaredValue > Number(cfg.insurance.freeUpTo ?? 100)
  const insured = effects.insurance ? true : input.insured != null ? !!input.insured : defaultOn
  const sigRequired = !!effects.signature || !!input.signature
  const poBox = PO_BOX.test(`${to.line1 ?? ''} ${to.line2 ?? ''}`)
  const includeInternational = country !== 'US' || !!input.includeInternational

  let quotes = rateShop({
    carriers: ctx.carriers,
    carrierAccounts: ctx.carrierAccounts,
    hub,
    toZip: to.zip,
    toState: (to.state || '').toUpperCase(),
    pkg,
    residential,
    declaredValue,
    insured,
    plan: ctx.plan,
    rateCards: ctx.rateCards,
    customerId: ctx.customerId,
    poBox,
    includeInternational,
    now: ctx.now,
  })
  if (country !== 'US') quotes = quotes.filter(q => ctx.carriers.find(c => c.code === q.carrierCode)?.type === 'international')
  else if (!input.includeInternational) quotes = quotes.filter(q => ctx.carriers.find(c => c.code === q.carrierCode)?.type !== 'international')

  const totalBefore = quotes.length
  const applied = applyEffectsToQuotes(quotes, effects)
  quotes = applied.quotes

  // Signature fee, ETA dates, own account comparison
  const accountByCarrier = Object.fromEntries(ctx.carrierAccounts.map(a => [a.carrier, a]))
  quotes = quotes.map(q => {
    const out = { ...q, badges: [], signatureFee: 0, rankable: true, connectHint: null, aiScore: null }
    if (sigRequired) {
      out.signatureFee = SIGNATURE_FEE
      out.total = round2(out.total + SIGNATURE_FEE)
      out.walletCharge = round2(out.walletCharge + SIGNATURE_FEE)
    }
    out.etaDate = q.etaDays ? estimateEtaDate(q.etaDays, hub, ctx.now, ctx.hubs) : null
    if (q.source === 'dynamic') out.badges.push('dynamic')
    if (q.source === 'custom') out.badges.push('custom')
    if (q.source === 'own') out.badges.push('own')
    return out
  })
  for (const q of quotes) {
    if (q.source === 'own') {
      const platform = quotes.find(p => p.source !== 'own' && p.carrierCode === q.carrierCode && p.serviceCode === q.serviceCode)
      if (platform) {
        q.platformKey = platform.key
        q.savingsVsPlatform = round2(platform.total - q.total)
        platform.ownKey = q.key
        if (accountByCarrier[q.carrierCode]?.mode === 'always') platform.rankable = false
      }
    }
  }

  // "Connect your FedEx account" hints: carriers with a connectable, unconnected account slot.
  const hints = []
  for (const acc of ctx.allAccounts) {
    if (acc.status === 'connected') continue
    const first = quotes.find(q => q.carrierCode === acc.carrier && q.source !== 'own')
    if (!first) continue
    const carrier = ctx.carriers.find(c => c.code === acc.carrier)
    const hint = { carrier: acc.carrier, carrierName: carrier?.name ?? acc.carrier, accountId: acc.id }
    // attach to the last row of that carrier so the screen can render one link per carrier
    const rows = quotes.filter(q => q.carrierCode === acc.carrier && q.source !== 'own')
    rows[rows.length - 1].connectHint = hint
    hints.push(hint)
  }

  const rankable = quotes.filter(q => q.rankable)
  const cheapestQ = pickBest(rankable, (a, b) => a.total - b.total || (a.etaDays ?? 99) - (b.etaDays ?? 99))
  const fastestQ = pickBest(rankable, (a, b) => (a.etaDays ?? 99) - (b.etaDays ?? 99) || a.total - b.total)
  if (cheapestQ) cheapestQ.badges.push('cheapest')
  if (fastestQ) fastestQ.badges.push('fastest')
  if (applied.forcedKey) quotes.find(q => q.key === applied.forcedKey)?.badges.push('rule')

  // Default comparison: company default hub, UPS Ground, platform tariff.
  let defaultQuote = null
  const dq = quoteService({
    carriers: ctx.carriers, carrier: DEFAULT_COMPARE.carrier, service: DEFAULT_COMPARE.service,
    hub: ctx.defaultHub, toZip: to.zip, toState: to.state, pkg, residential, declaredValue, insured,
    plan: ctx.plan, rateCards: ctx.rateCards, customerId: ctx.customerId, now: ctx.now,
  })
  if (dq && country === 'US') defaultQuote = { key: dq.key, total: round2(dq.total + (sigRequired ? SIGNATURE_FEE : 0)), hub: ctx.defaultHub }

  const zones = { NJ01: zoneFor('NJ01', to.zip), LA01: zoneFor('LA01', to.zip) }
  const suggested = zones.LA01 < zones.NJ01 ? 'LA01' : zones.NJ01 < zones.LA01 ? 'NJ01' : ctx.defaultHub
  const zone = zoneFor(hub, to.zip)
  const insuranceAmount = insured ? insuranceFor(declaredValue, cfg.insurance) : 0

  const result = {
    hub,
    requestedHub,
    hubAssignedBy: !input.ignoreHubRule && effects.hub ? effects.hub.ruleName : null,
    hubSuggestion: { hub: suggested, zones, reasonCode: suggested === ctx.defaultHub && zones.LA01 === zones.NJ01 ? 'default' : 'closer_zone' },
    zone,
    zoneGroup: zoneGroup(zone),
    billable: billableWeight(pkg),
    insurance: { insured, amount: insuranceAmount, locked: !!effects.insurance, lockedBy: effects.insurance?.ruleName ?? null, defaultOn },
    signature: { required: sigRequired, fee: sigRequired ? SIGNATURE_FEE : 0, lockedBy: effects.signature?.ruleName ?? null },
    rules: {
      matched: matched.map(m => ({ id: m.rule.id, name: m.rule.name, actions: m.actions })),
      names: effects.ruleNames,
      effects,
      notes: applied.notes,
    },
    hold: effects.hold,
    tags: effects.tags.map(x => x.tag),
    poBox,
    quotes,
    excludedCount: totalBefore - quotes.length,
    cheapestKey: cheapestQ?.key ?? null,
    fastestKey: fastestQ?.key ?? null,
    forcedKey: applied.forcedKey,
    aiPickKey: null,
    ai: { source: 'fallback', reasonCode: 'lowest_cost', ranked: [] },
    defaultQuote,
    aiSavingsVsDefault: 0,
    hints,
    shipDate: shipDateFor(hub, ctx.now, ctx.hubs).toISOString(),
    empty: quotes.length === 0,
  }
  setAiPick(result, pickFallback(result, effects))
  return result
}

function pickBest(list, cmp) {
  if (!list.length) return null
  return [...list].sort(cmp)[0]
}

function pickFallback(result, effects) {
  if (result.forcedKey) { result.ai.source = 'rule'; result.ai.reasonCode = 'rule_forced'; return result.forcedKey }
  if (effects?.strategy?.value === 'fastest') { result.ai.source = 'rule'; result.ai.reasonCode = 'rule_strategy'; return result.fastestKey }
  if (effects?.strategy?.value === 'cheapest') { result.ai.source = 'rule'; result.ai.reasonCode = 'rule_strategy'; return result.cheapestKey }
  return result.cheapestKey
}

function setAiPick(result, key) {
  for (const q of result.quotes) q.badges = q.badges.filter(b => b !== 'ai')
  result.aiPickKey = key
  const q = result.quotes.find(x => x.key === key)
  if (q) {
    q.badges.unshift('ai')
    result.aiSavingsVsDefault = result.defaultQuote ? Math.max(0, round2(result.defaultQuote.total - q.total)) : 0
  }
}

/** Full rate shop including the AI optimizer pick, without request latency. */
export async function rateShopNow(input, ctx = buildPricingContext()) {
  const result = computeQuotes(input, ctx)
  if (result.empty || result.ai.source === 'rule') return result
  const opt = await loadOptimizer()
  const rankable = result.quotes.filter(q => q.rankable)
  if (opt && typeof opt.scoreQuotes === 'function' && rankable.length) {
    try {
      const scored = await opt.scoreQuotes(rankable, {
        weight: input.weight ?? ctx.weight,
        addressCheck: input.addressCheck ?? input.orderContext?.order?.addressCheck ?? null,
        hub: result.hub,
        zone: result.zone,
      })
      const ranked = (scored?.ranked ?? []).map(r => ({ key: r.quote?.key, score: r.score, components: r.components ?? null })).filter(r => r.key)
      for (const r of ranked) {
        const q = result.quotes.find(x => x.key === r.key)
        if (q) q.aiScore = { score: r.score, components: r.components }
      }
      const bestKey = scored?.best?.quote?.key ?? scored?.best?.key ?? ranked[0]?.key
      if (bestKey && result.quotes.some(q => q.key === bestKey)) {
        result.ai = { source: 'optimizer', reasonCode: scored?.reasonCode ?? reasonFor(result, bestKey), reason: scored?.reason ?? null, ranked, savingsVsDefault: scored?.savingsVsDefault ?? null }
        setAiPick(result, bestKey)
        return result
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[rates] optimizer failed, using cheapest', e)
    }
  }
  return result
}

function reasonFor(result, key) {
  const q = result.quotes.find(x => x.key === key)
  if (!q) return 'lowest_cost'
  if (q.source === 'own') return 'own_account'
  if (key === result.cheapestKey) return 'lowest_cost'
  if (key === result.fastestKey) return 'speed'
  return 'balanced'
}

export function findQuote(result, key) {
  return result?.quotes?.find(q => q.key === key) ?? null
}

/** POST /v1/rates: rate shop with AI pick (panel, API console). */
export function quoteShipment(input) {
  return request('POST /v1/rates', () => {
    validateInput(input)
    return rateShopNow(input)
  }, { minMs: 350, maxMs: 750 })
}

export function quoteOrder(orderId, extra = {}) {
  return request(`POST /v1/orders/${orderId}/rates`, () => {
    const order = db.get('orders', orderId)
    if (!order) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    return rateShopNow(inputFromOrder(plain(order), extra))
  }, { minMs: 350, maxMs: 750 })
}

function validateInput(input) {
  const errors = {}
  const to = input?.to ?? {}
  if (!to.zip) errors.zip = 'required'
  if ((to.country || 'US') === 'US' && !to.state) errors.state = 'required'
  const pkg = input?.pkg ?? {}
  if (!(Number(pkg.weightLb) > 0)) errors.weightLb = 'required'
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid rate request', 422, errors)
}
