/**
 * Carrier, service and hub optimizer (spec 6.4). Pure functions: data (carriers,
 * shipments, rate cards, accounts, hubs) is passed in by api/ai.js.
 *
 * scoreQuotes(quotes, { weight = 0.6, addressCheck?, reliability?, carriers?, defaultHub = 'NJ01' }) -> {
 *   ranked: [{ quote, score, components: { cost, speed, reliability, reliabilityRaw, risk, weights: {cost, speed, reliability} } }],
 *   best, defaultChoice, savingsVsDefault, reason: {tr,en}, reasonCode, weight
 * }
 *   S = w*costScore + (1-w)*speedScore*0.6 + reliabilityScore*0.3 - riskPenalty
 *   costScore  = (maxTotal - total) / (maxTotal - minTotal)       (1 when all equal)
 *   speedScore = (maxEta - eta) / (maxEta - minEta)               eta = etaDays + hub cutoff delay
 *   reliabilityScore = clamp((onTime - 0.80) / 0.20, 0, 1)        onTime from reliabilityMatrix (Bayes smoothed)
 *   riskPenalty: PO Box on a carrier that cannot deliver there = 1;
 *                address score < 85: (85 - score)/85 * (carrier.addressCorrectionFee / max fee) * 0.5
 *   `best` = ranked[0]; `defaultChoice` = UPS Ground platform rate at the company default hub (the
 *   baseline rule); savingsVsDefault = defaultChoice.total - best.total (null when no baseline).
 *
 * reliabilityMatrix(shipments, carriers) -> { zones, carriers, cells: [{carrier, zone, n, onTime, raw, prior, smoothed}],
 *   byCarrier: {code: {n, onTime, raw, smoothed}}, lookup: {"UPS|5": smoothed}, totalSamples }
 *   on time = delivered within the service transit days, counted in business days from the carrier
 *   pickup event (weekends skipped; USPS delivers on Saturday so only Sundays are skipped).
 *   Deliveries that had an exception, returns and open exceptions count as late. Bayes smoothing
 *   (onTime + 9 * prior) / (n + 9), prior = carrier's published on-time rate for the zone.
 *
 * candidateQuotes(ctx) -> Quote[] over every candidate hub (quote.effectiveEtaDays, quote.cutoffDelay added)
 * optimize(ctx) -> scoreQuotes result + { hubs, hubRecommendation, quotes, candidates }
 * batchOptimize(orders, ctx, { weight, onProgress, capacity }) -> see README in api/ai.js
 * summarizeAssignments(assignments) -> totals for (edited) batch assignments
 */
import { rateShop, round2, zoneFor } from '../../shared/rateEngine.js'
import { CARRIERS } from '../../shared/carriers.js'
import { money } from '../../shared/format.js'
import { bilingual } from './modelRegistry.js'
import { db } from '../store/db.js'

export const BAYES_K = 9
export const DEFAULT_RULE = { carrier: 'UPS', service: 'GROUND' }
const MS_DAY = 86400000

// ---------------------------------------------------------------------------
// Reliability from real shipments
// ---------------------------------------------------------------------------
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

/** Business days between pickup and delivery: `skip` weekdays (0 = Sunday, 6 = Saturday) are not counted. */
function transitDays(from, to, skip = []) {
  const total = Math.round((dayStart(to) - dayStart(from)) / MS_DAY)
  let days = 0
  const d = dayStart(from)
  for (let i = 0; i < total; i++) {
    d.setDate(d.getDate() + 1)
    if (!skip.includes(d.getDay())) days++
  }
  return days
}

export function reliabilityMatrix(shipments = [], carriers = CARRIERS) {
  const zones = [2, 3, 4, 5, 6, 7, 8]
  const agg = new Map()
  for (const s of shipments) {
    if (!s || !s.events || !s.zone) continue
    const c = carriers.find(x => x.code === s.carrier)
    if (!c || c.type === 'international') continue
    const svc = c.services?.find(x => x.code === s.service)
    const promised = svc?.transitDays?.[s.zone]
    if (!promised) continue
    const pickup = s.events.find(e => e.code === 'picked_up')
    const delivered = [...s.events].reverse().find(e => e.code === 'delivered')
    const hadException = s.events.some(e => e.code === 'exception' || e.code === 'returned')
    let outcome = null
    if (s.status === 'delivered' && delivered && pickup) {
      const days = transitDays(new Date(pickup.at), new Date(delivered.at), c.code === 'USPS' ? [0] : [0, 6])
      outcome = !hadException && days <= promised
        } else if (s.status === 'returned' || s.status === 'exception') {
      outcome = false
    }
    if (outcome === null) continue
    const k = c.code + '|' + s.zone
    const a = agg.get(k) || { n: 0, onTime: 0 }
    a.n++
    if (outcome) a.onTime++
    agg.set(k, a)
  }
  const cells = []
  const lookup = {}
  const byCarrier = {}
  let totalSamples = 0
  const domestic = carriers.filter(c => c.type !== 'international' && c.status !== 'inactive')
  for (const c of domestic) {
    let cn = 0
    let co = 0
    let priorSum = 0
    for (const z of zones) {
      const a = agg.get(c.code + '|' + z) || { n: 0, onTime: 0 }
      const prior = c.onTimeByZone?.[z] ?? 0.93
      const smoothed = (a.onTime + BAYES_K * prior) / (a.n + BAYES_K)
      const cell = { carrier: c.code, zone: z, n: a.n, onTime: a.onTime, raw: a.n ? round4(a.onTime / a.n) : null, prior, smoothed: round4(smoothed) }
      cells.push(cell)
      lookup[c.code + '|' + z] = cell.smoothed
      cn += a.n
      co += a.onTime
      priorSum += prior
    }
    const prior = priorSum / zones.length
    byCarrier[c.code] = { n: cn, onTime: co, raw: cn ? round4(co / cn) : null, smoothed: round4((co + BAYES_K * prior) / (cn + BAYES_K)) }
    totalSamples += cn
  }
  return { zones, carriers: domestic.map(c => c.code), cells, byCarrier, lookup, totalSamples, k: BAYES_K }
}

/** Carriers from the live db (admin may add carriers), falling back to the shared defaults. */
export function liveCarriers() {
  try {
    const list = db.all('carriers')
    return list && list.length ? list : CARRIERS
  } catch { return CARRIERS }
}

function liveDefaultHub() {
  try { return db.doc('user')?.company?.defaultHub || 'NJ01' } catch { return 'NJ01' }
}

let relCache = { key: null, value: null }
/** Reliability matrix from the live shipments collection, cached until shipments change. */
export function liveReliability() {
  try {
    const sh = db.all('shipments')
    const carriers = liveCarriers()
    let done = 0
    for (const s of sh) if (s.status === 'delivered' || s.status === 'returned' || s.status === 'exception') done++
    const key = sh.length + ':' + done + ':' + carriers.length
    if (relCache.key !== key) relCache = { key, value: reliabilityMatrix(sh, carriers) }
    return relCache.value
  } catch { return null }
}

const round4 = v => Math.round(v * 10000) / 10000
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function relOf(q, reliability) {
  if (reliability?.lookup) {
    const v = reliability.lookup[q.carrierCode + '|' + q.zone]
    if (v != null) return v
  }
  return q.onTimePct ?? 0.93
}

export function scoreQuotes(quotes, opts = {}) {
  const { weight = 0.6, addressCheck = null, poBox } = opts
  const defaultHub = opts.defaultHub || liveDefaultHub()
  const carriers = opts.carriers || liveCarriers()
  const reliability = opts.reliability || liveReliability()
  const w = clamp(Number(weight), 0, 1)
  const list = (quotes || []).filter(Boolean)
  if (!list.length) return { ranked: [], best: null, defaultChoice: null, savingsVsDefault: null, reason: null, reasonCode: null, weight: w }
  const eta = q => q.effectiveEtaDays ?? q.etaDays ?? 5
  const totals = list.map(q => q.total)
  const etas = list.map(eta)
  const minC = Math.min(...totals)
  const maxC = Math.max(...totals)
  const minE = Math.min(...etas)
  const maxE = Math.max(...etas)
  const maxFee = Math.max(1, ...carriers.map(c => c.addressCorrectionFee || 0))
  const addrScore = addressCheck?.score
  const isPoBox = poBox ?? (addressCheck ? /box/i.test(addressCheck.issueType || '') || (addressCheck.issues || []).some(i => i.code === 'po_box' || i.code === 'po_box_restricted') : false)
  const weights = { cost: round4(w), speed: round4((1 - w) * 0.6), reliability: 0.3 }
  const ranked = list.map(q => {
    const c = carriers.find(x => x.code === q.carrierCode)
    const cost = maxC > minC ? (maxC - q.total) / (maxC - minC) : 1
    const speed = maxE > minE ? (maxE - eta(q)) / (maxE - minE) : 1
    const relRaw = relOf(q, reliability)
    const rel = clamp((relRaw - 0.8) / 0.2, 0, 1)
    let risk = 0
    if (isPoBox && c && c.poBoxAllowed === false) risk = 1
    else if (addrScore != null && addrScore < 85) risk = ((85 - addrScore) / 85) * ((c?.addressCorrectionFee || 0) / maxFee) * 0.5
    const score = weights.cost * cost + weights.speed * speed + weights.reliability * rel - risk
    return {
      quote: q,
      score: round4(score),
      components: { cost: round4(cost), speed: round4(speed), reliability: round4(rel), reliabilityRaw: round4(relRaw), risk: round4(risk), weights },
    }
  })
  ranked.sort((a, b) => b.score - a.score || a.quote.total - b.quote.total || eta(a.quote) - eta(b.quote))
  const best = ranked[0]
  const defaultChoice =
    list.find(q => q.carrierCode === DEFAULT_RULE.carrier && q.serviceCode === DEFAULT_RULE.service && q.source !== 'own' && q.hub === defaultHub) ||
    null
  const savingsVsDefault = defaultChoice ? round2(defaultChoice.total - best.quote.total) : null
  const { code, params } = reasonFor(best, ranked, { minC, minE })
  return { ranked, best, defaultChoice, savingsVsDefault, reason: bilingual('optimizer.reasons.' + code, params), reasonCode: code, weight: w }
}

function reasonFor(best, ranked, { minC, minE }) {
  const q = best.quote
  const days = q.effectiveEtaDays ?? q.etaDays
  const dayText = { tr: `${days} gün`, en: days === 1 ? '1 day' : `${days} days` }
  const params = { price: { tr: money(q.total, 'tr'), en: money(q.total, 'en') }, days, dayText, rel: Math.round(best.components.reliabilityRaw * 100) }
  if (ranked.some(r => r.components.risk > 0.05) && best.components.risk < 0.02) return { code: 'risk', params }
  if (q.source === 'own' && q.total === minC) return { code: 'own', params }
  if (q.total === minC) return { code: 'cheapest', params }
  if (days === minE) return { code: 'fastest', params }
  const maxRel = Math.max(...ranked.map(r => r.components.reliabilityRaw))
  if (best.components.reliabilityRaw === maxRel && best.components.cost < 0.7) return { code: 'reliability', params }
  return { code: 'balanced', params }
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------
function hourInZone(now, tz) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now)
    return parseInt(h, 10)
  } catch { return now.getHours() }
}

/** +1 day when the hub's cutoff time already passed today (hub local time). */
export function cutoffDelay(hubMeta, now = new Date()) {
  if (!hubMeta?.cutoff) return 0
  const cutH = parseInt(String(hubMeta.cutoff).split(':')[0], 10)
  return hourInZone(now, hubMeta.timezone) >= cutH ? 1 : 0
}

/**
 * ctx: { carriers, hubs: ['NJ01','LA01'], hubsMeta: [...hubs seed], to: {zip, state, residential}, pkg,
 *        declaredValue, insured?, plan, rateCards, customerId, carrierAccounts, poBox, now }
 */
export function candidateQuotes(ctx) {
  const now = ctx.now || new Date()
  const out = []
  for (const hub of ctx.hubs || ['NJ01', 'LA01']) {
    const meta = (ctx.hubsMeta || []).find(h => h.code === hub)
    const delay = ctx.ignoreCutoff ? 0 : cutoffDelay(meta, now)
    const quotes = rateShop({
      carriers: ctx.carriers || liveCarriers(),
      hub,
      toZip: ctx.to?.zip,
      toState: ctx.to?.state,
      residential: ctx.to?.residential !== false,
      poBox: !!ctx.poBox,
      pkg: ctx.pkg,
      declaredValue: ctx.declaredValue || 0,
      insured: ctx.insured,
      plan: ctx.plan || 'starter',
      rateCards: ctx.rateCards || null,
      customerId: ctx.customerId || null,
      carrierAccounts: ctx.carrierAccounts || [],
      now,
    })
    for (const q of quotes) out.push({ ...q, cutoffDelay: delay, effectiveEtaDays: (q.etaDays || 0) + delay })
  }
  return out
}

function hubReason(hubs, bestHub, fixedHub, onlyHub, zone) {
  if (fixedHub) return bilingual('optimizer.hub.fixed', { hub: fixedHub })
  if (onlyHub) return bilingual('optimizer.hub.only', { hub: onlyHub })
  if (hubs.length > 1) return bilingual('optimizer.hub.closer', { hub: bestHub, zone })
  return bilingual('optimizer.hub.default', { hub: bestHub })
}

/** Candidate hubs for an order's items (products.inventoryHubs). */
export function hubsForItems(items, products, defaultHub = 'NJ01', allHubs = ['NJ01', 'LA01']) {
  let set = null
  for (const it of items || []) {
    const p = (products || []).find(x => x.sku === it.sku)
    const hubs = p?.inventoryHubs?.length ? p.inventoryHubs : allHubs
    set = set ? set.filter(h => hubs.includes(h)) : [...hubs]
  }
  if (!set || !set.length) return { hubs: [defaultHub], only: null }
  return { hubs: set, only: set.length === 1 ? set[0] : null }
}

export function optimize(ctx) {
  const quotes = candidateQuotes(ctx)
  const result = scoreQuotes(quotes, {
    weight: ctx.weight,
    addressCheck: ctx.addressCheck,
    reliability: ctx.reliability,
    carriers: ctx.carriers,
    defaultHub: ctx.defaultHub,
    poBox: ctx.poBox,
  })
  const bestHub = result.best?.quote.hub || ctx.defaultHub
  const zone = result.best?.quote.zone ?? zoneFor(bestHub, ctx.to?.zip)
  const byHub = {}
  for (const r of result.ranked) {
    const h = r.quote.hub
    if (!byHub[h]) byHub[h] = { hub: h, best: r, count: 0, zone: r.quote.zone, cutoffDelay: r.quote.cutoffDelay }
    byHub[h].count++
  }
  return {
    ...result,
    quotes,
    candidates: quotes.length,
    hubs: ctx.hubs,
    byHub,
    hubRecommendation: result.best
      ? { hub: bestHub, zone, reason: hubReason(ctx.hubs || [], bestHub, ctx.fixedHub, ctx.onlyHub, zone) }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Batch mode with hub capacity (greedy)
// ---------------------------------------------------------------------------
export function estimatePackage(items) {
  const w = (items || []).reduce((s, it) => s + (Number(it.weightLb) || 0) * (Number(it.qty) || 1), 0)
  const weightLb = Math.round((w + 0.4) * 10) / 10
  if (weightLb <= 1.5) return { lengthIn: 8, widthIn: 6, heightIn: 4, weightLb }
  if (weightLb <= 6) return { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb }
  return { lengthIn: 18, widthIn: 14, heightIn: 8, weightLb }
}

function hubList(ctx) {
  const all = (ctx.hubsMeta || []).filter(h => h.type === 'us_hub' && h.active !== false).map(h => h.code)
  return all.length ? all : ['NJ01', 'LA01']
}

/**
 * Evaluate one order for batch mode: candidates on every hub that stocks the items, scored.
 * Returns { orderId, excluded? , scored, bestByHub, hubOrder, regret, baseline, estimated, pkg, only, candidates }
 */
export function evaluateOrder(o, ctx, weight = 0.6) {
  const defaultHub = ctx.defaultHub || 'NJ01'
  const to = o.shipTo || {}
  if ((to.country || 'US') !== 'US') return { orderId: o.id, excluded: { orderId: o.id, reason: 'not_us', label: bilingual('optimizer.excluded.not_us') } }
  const estimated = !o.package
  const pkg = o.package || estimatePackage(o.items)
  const { hubs, only } = hubsForItems(o.items, ctx.products, defaultHub, hubList(ctx))
  const addressCheck = ctx.addressChecks?.[o.id] || o.addressCheck || null
  const poBox = /p\.?\s*o\.?\s*box/i.test((to.line1 || '') + ' ' + (to.line2 || ''))
  const declaredValue = (o.items || []).reduce((sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0)
  const quotes = candidateQuotes({ ...ctx, hubs: [...new Set([...hubs, defaultHub])], to, pkg, declaredValue, poBox })
  const scored = scoreQuotes(quotes.filter(q => hubs.includes(q.hub)), { weight, addressCheck, reliability: ctx.reliability, carriers: ctx.carriers, defaultHub, poBox })
  const baseline = quotes.find(q => q.hub === defaultHub && q.carrierCode === DEFAULT_RULE.carrier && q.serviceCode === DEFAULT_RULE.service && q.source !== 'own')
    || quotes.filter(q => q.hub === defaultHub && q.source !== 'own').sort((a, b) => a.total - b.total)[0] || null
  if (!scored.best) return { orderId: o.id, candidates: quotes.length, excluded: { orderId: o.id, reason: 'no_quote', label: bilingual('optimizer.excluded.no_quote') } }
  const bestByHub = {}
  for (const r of scored.ranked) if (!bestByHub[r.quote.hub]) bestByHub[r.quote.hub] = r
  const hubOrder = Object.values(bestByHub).sort((a, b) => b.score - a.score)
  const regret = hubOrder.length > 1 ? hubOrder[0].score - hubOrder[1].score : Infinity
  return { orderId: o.id, order: o, scored, bestByHub, hubOrder, regret, baseline, estimated, pkg, only, candidates: quotes.length, serviceKeys: quotes.map(q => q.key) }
}

/**
 * Greedy hub capacity assignment over evaluated orders (NJ01 400, LA01 250 per day minus today's load).
 * Orders that lose the most by moving hub are placed first; when a hub is full the order moves to
 * its next best hub (shiftedFrom is set).
 */
export function assignBatch(evaluatedList, ctx, opts = {}) {
  const weight = opts.weight ?? 0.6
  const hubsMeta = ctx.hubsMeta || []
  const hubs = hubList(ctx)
  const capacity = {}
  for (const h of hubs) {
    const meta = hubsMeta.find(x => x.code === h)
    const limit = meta?.capacityDaily ?? (h === 'LA01' ? 250 : 400)
    const todayLoad = meta?.todayLoad ?? 0
    const remaining = opts.capacity?.[h] ?? Math.max(0, limit - todayLoad)
    capacity[h] = { limit, todayLoad, remaining, assigned: 0 }
  }
  const excluded = evaluatedList.filter(e => e.excluded).map(e => e.excluded)
  const evaluated = evaluatedList.filter(e => !e.excluded).map((e, index) => ({ ...e, index }))
  const serviceKeys = new Set()
  let candidates = 0
  for (const e of evaluatedList) { candidates += e.candidates || 0; (e.serviceKeys || []).forEach(k => serviceKeys.add(k)) }
  const assignOrder = [...evaluated].sort((a, b) => b.regret - a.regret || a.index - b.index)
  const assignments = []
  for (const e of assignOrder) {
    let chosen = null
    let shiftedFrom = null
    for (const r of e.hubOrder) {
      const cap = capacity[r.quote.hub]
      if (!cap || cap.remaining - cap.assigned > 0) { chosen = r; break }
      if (!shiftedFrom) shiftedFrom = r.quote.hub
    }
    if (!chosen) { chosen = e.hubOrder[0]; shiftedFrom = null }
    if (capacity[chosen.quote.hub]) capacity[chosen.quote.hub].assigned++
    const hub = chosen.quote.hub
    const alternatives = e.scored.ranked.filter(r => r.quote.hub === hub).map(r => ({ quote: r.quote, score: r.score, components: r.components }))
    const o = e.order
    assignments.push({
      orderId: o.id,
      index: e.index,
      channel: o.channel,
      recipient: o.shipTo?.name,
      destination: { city: o.shipTo?.city, state: o.shipTo?.state, zip: o.shipTo?.zip },
      hub,
      quote: chosen.quote,
      score: chosen.score,
      components: chosen.components,
      reason: shiftedFrom ? bilingual('optimizer.capacityShift', { from: shiftedFrom, to: hub }) : e.scored.reason,
      reasonCode: shiftedFrom ? 'capacity_shift' : e.scored.reasonCode,
      shiftedFrom,
      alternatives,
      aiQuoteKey: chosen.quote.key,
      defaultQuote: e.baseline,
      savings: e.baseline ? round2(e.baseline.total - chosen.quote.total) : 0,
      estimatedPackage: e.estimated,
      package: e.pkg,
      onlyHub: e.only,
    })
  }
  assignments.sort((a, b) => a.index - b.index)
  assignments.forEach(a => delete a.index)
  for (const h of Object.keys(capacity)) capacity[h].used = capacity[h].todayLoad + capacity[h].assigned
  return {
    assignments,
    excluded,
    capacity,
    weight,
    evaluated: { orders: evaluatedList.length, services: serviceKeys.size, hubs: hubs.length, candidates },
    ...summarizeAssignments(assignments),
  }
}

/** Synchronous batch optimization (evaluateOrder for each order + assignBatch). */
export function batchOptimize(orders, ctx, opts = {}) {
  const weight = opts.weight ?? 0.6
  return assignBatch(orders.map(o => evaluateOrder(o, ctx, weight)), ctx, opts)
}

/** Totals for assignments; call again after the user changes a row's quote. */
export function summarizeAssignments(assignments) {
  const byHub = {}
  const byCarrier = {}
  let aiCost = 0
  let defCost = 0
  let aiEta = 0
  let defEta = 0
  let defN = 0
  for (const a of assignments) {
    const q = a.quote
    aiCost += q.total
    aiEta += q.effectiveEtaDays ?? q.etaDays
    byHub[a.hub] = byHub[a.hub] || { hub: a.hub, count: 0, cost: 0 }
    byHub[a.hub].count++
    byHub[a.hub].cost = round2(byHub[a.hub].cost + q.total)
    const ck = q.carrierCode
    byCarrier[ck] = byCarrier[ck] || { carrier: ck, carrierName: q.carrierName, count: 0, cost: 0, services: {} }
    byCarrier[ck].count++
    byCarrier[ck].cost = round2(byCarrier[ck].cost + q.total)
    byCarrier[ck].services[q.serviceName] = (byCarrier[ck].services[q.serviceName] || 0) + 1
    if (a.defaultQuote) {
      defCost += a.defaultQuote.total
      defEta += a.defaultQuote.effectiveEtaDays ?? a.defaultQuote.etaDays
      defN++
    } else {
      defCost += q.total
      defEta += q.effectiveEtaDays ?? q.etaDays
      defN++
    }
  }
  const n = assignments.length || 1
  const savings = round2(defCost - aiCost)
  return {
    byHub,
    byCarrier,
    totals: {
      ai: { cost: round2(aiCost), avgEtaDays: Math.round((aiEta / n) * 100) / 100, count: assignments.length },
      default: { cost: round2(defCost), avgEtaDays: Math.round((defEta / (defN || 1)) * 100) / 100, count: defN, rule: DEFAULT_RULE },
      savings,
      savingsPct: defCost ? Math.round((savings / defCost) * 10000) / 10000 : 0,
    },
  }
}
