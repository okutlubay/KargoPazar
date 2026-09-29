/**
 * Dynamic pricing model (spec 6.3). PURE JavaScript: depends only on the shared
 * rate engine, so it runs in the browser and under Node.
 *
 * Lane = origin hub x carrier-service x zone group (near 2-4, mid 5-6, far 7-8).
 * Lane definitions (reference zone / ZIP, market reference price) come from the
 * pricing_recs seed; everything else is computed live.
 *
 * Inputs per lane
 *   forecastVolume  next 4 weeks: carrier forecast (forecastModel byCarrier.X, weeks 1-4)
 *                   x lane share of that carrier in the last 8 weeks of shipments
 *   baselineVolume  4 week baseline: carrier mean weekly volume over the last 13 weeks x 4
 *                   x lane share of that carrier over the whole shipment window (120 days)
 *   tier            carriers.volumeTiers: highest tier whose weeklyVolume <= forecast
 *                   weekly carrier volume (mean of weeks 1-4)
 *   cost            rate engine cost of the reference package today; expectedCost = same
 *                   quote with the forecast tier discount
 *   currentPrice    rate engine sell price today (plan / customer card, no dynamic override)
 *   marketRef       seed "market average" per lane
 *   margins         rate_cards.platform.marginRange {min, max}, marketCapMultiplier
 *
 * Formula (verbatim from the spec)
 *   demandFactor = clamp(forecastVolume / baselineVolume, 0.7, 1.5)
 *   targetMargin = lerp(maxMargin, minMargin, (demandFactor - 0.7) / 0.8)
 *   price        = expectedCost * (1 + targetMargin)
 *   price        = min(price, marketRef * marketCapMultiplier)
 *   price        = max(price, expectedCost * (1 + minMargin))
 *   range        = [price * 0.96, price * 1.04]
 *
 * Waterfall (sums exactly to the recommended price)
 *   current -> tier (currentPrice * expectedCost / cost - currentPrice)
 *           -> demand (expectedCost * (1 + targetMargin) - previous)
 *           -> market cap (<= 0) -> floor (>= 0) -> recommended
 *
 * Expected impact and sensitivity
 *   volume(p) = forecastVolume * exp(-ELASTICITY * (p - currentPrice) / marketRef)
 *   profit(p) = volume(p) * (p - expectedCost)            (4 week gross profit)
 *   sensitivity: 25 points from 0.85 x to 1.20 x the current price.
 *
 * Exported API
 *   ELASTICITY, groupOfZone(zone)
 *   laneShares(shipments, defs, { now, recentDays = 56 }) -> { recent: {carrier: {lane: share}}, all: {...} }
 *   tierDiscount(tiers, weeklyVolume) -> { discountPct, threshold, next }
 *   computeLane(def, ctx) -> LaneRec
 *   computeAll({ defs, carriers, rateCards, forecastByCarrier, historyByCarrier, shipments,
 *                plan, customerId, refPackage, settings, now }) -> LaneRec[] sorted by forecastVolume desc
 *   LaneRec = { id, lane, hub, carrier, service, serviceName, zoneGroup, refZone, refZip,
 *     forecastVolume, baselineVolume, weeklyCarrierForecast, demandFactor, targetMargin,
 *     tier: {discountPct, threshold, next}, cost, expectedCost, currentPrice, marketRef, marketCap,
 *     recommendedPrice, range: [lo, hi], changePct, expectedProfit, currentProfit, impact,
 *     waterfall: [{ key, value, delta, start, end }], sensitivity: [{ price, volume, profit }],
 *     optimalPrice, rank }
 */
import { quoteService, round2, zoneGroup } from '../../shared/rateEngine.js'

export const ELASTICITY = 4
const DAY = 86400000

export function groupOfZone(zone) {
  return zoneGroup(Number(zone))
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}
function r1(v) {
  return Math.round(v * 10) / 10
}
function r4(v) {
  return Math.round(v * 10000) / 10000
}

/** Lane share within each carrier (Laplace smoothed over the defined lanes). */
export function laneShares(shipments, defs, { now = new Date(), recentDays = 56 } = {}) {
  const cutoff = new Date(now).getTime() - recentDays * DAY
  const lanesByCarrier = {}
  for (const d of defs) (lanesByCarrier[d.carrier] ||= []).push(d.lane)
  const count = (list) => {
    const byCarrier = {}
    const byLane = {}
    for (const s of list) {
      if (!s || s.status === 'voided' || !s.carrier) continue
      byCarrier[s.carrier] = (byCarrier[s.carrier] || 0) + 1
      const lane = `${s.hub}|${s.carrier}-${s.service}|${groupOfZone(s.zone)}`
      byLane[lane] = (byLane[lane] || 0) + 1
    }
    const out = {}
    for (const [c, lanes] of Object.entries(lanesByCarrier)) {
      const alpha = 0.25
      const denom = (byCarrier[c] || 0) + alpha * lanes.length
      out[c] = {}
      for (const l of lanes) out[c][l] = denom ? ((byLane[l] || 0) + alpha) / denom : 0
    }
    return out
  }
  const recent = shipments.filter((s) => new Date(s.createdAt).getTime() >= cutoff)
  return { recent: count(recent), all: count(shipments) }
}

export function tierDiscount(tiers = [], weeklyVolume = 0) {
  const sorted = [...tiers].sort((a, b) => a.weeklyVolume - b.weeklyVolume)
  let cur = { weeklyVolume: 0, discountPct: 0 }
  for (const t of sorted) if (weeklyVolume >= t.weeklyVolume) cur = t
  const next = sorted.find((t) => t.weeklyVolume > weeklyVolume) || null
  return { discountPct: cur.discountPct || 0, threshold: cur.weeklyVolume || 0, next: next ? { weeklyVolume: next.weeklyVolume, discountPct: next.discountPct } : null }
}

function volumeAt(p, lane) {
  return lane.forecastVolume * Math.exp((-ELASTICITY * (p - lane.currentPrice)) / (lane.marketRef || lane.currentPrice || 1))
}
function profitAt(p, lane) {
  return volumeAt(p, lane) * (p - lane.expectedCost)
}

/**
 * ctx: { carriers, rateCards, plan, customerId, refPackage, settings: {minMargin, maxMargin, marketCapMultiplier},
 *        forecastVolume, baselineVolume, weeklyCarrierForecast, now }
 */
export function computeLane(def, ctx) {
  const carrier = ctx.carriers.find((c) => c.code === def.carrier)
  const service = carrier && (carrier.services || []).find((s) => s.code === def.service)
  if (!carrier || !service) return null
  const common = {
    carriers: ctx.carriers,
    carrier: carrier.code,
    service: service.code,
    hub: def.hub,
    zone: def.refZone,
    toZip: def.refZip,
    pkg: ctx.refPackage,
    residential: !service.commercialOnly,
    declaredValue: 0,
    insured: false,
    plan: ctx.plan,
    rateCards: ctx.rateCards,
    customerId: ctx.customerId,
    dynamicOverrides: null,
    now: ctx.now,
  }
  const q = quoteService(common)
  if (!q) return null
  const tiers = carrier.volumeTiers || ((ctx.rateCards?.carrierAgreements || []).find((a) => a.carrier === carrier.code) || {}).tiers || []
  const tier = tierDiscount(tiers, ctx.weeklyCarrierForecast)
  const qx = tier.discountPct ? quoteService({ ...common, volumeDiscountPct: tier.discountPct }) : q
  const cost = q.cost
  const expectedCost = qx.cost
  const currentPrice = q.sellPrice
  const { minMargin, maxMargin, marketCapMultiplier } = ctx.settings
  const marketRef = Number(def.marketRef) || currentPrice

  const fv = Math.max(0, ctx.forecastVolume)
  const bv = Math.max(1, ctx.baselineVolume)
  const demandFactor = clamp(fv / bv, 0.7, 1.5)
  const targetMargin = maxMargin + (minMargin - maxMargin) * ((demandFactor - 0.7) / 0.8)
  const pDemand = expectedCost * (1 + targetMargin)
  const marketCap = marketRef * marketCapMultiplier
  const pCapped = Math.min(pDemand, marketCap)
  const floor = expectedCost * (1 + minMargin)
  const price = round2(Math.max(pCapped, floor))

  const pTier = cost ? currentPrice * (expectedCost / cost) : currentPrice
  const steps = [
    { key: 'current', value: currentPrice },
    { key: 'tier', delta: pTier - currentPrice },
    { key: 'demand', delta: pDemand - pTier },
    { key: 'market', delta: pCapped - pDemand },
    { key: 'floor', delta: Math.max(pCapped, floor) - pCapped },
    { key: 'recommended', value: price },
  ]
  let run = 0
  const waterfall = steps.map((s) => {
    if (s.value != null) {
      run = s.value
      return { key: s.key, value: round2(s.value), delta: null, start: 0, end: round2(s.value) }
    }
    const start = run
    run += s.delta
    return { key: s.key, value: null, delta: round2(s.delta), start: round2(start), end: round2(run) }
  })
  // absorb rounding so the last bar equals the recommended price
  const drift = round2(price - waterfall[4].end)
  if (drift) {
    waterfall[4].delta = round2(waterfall[4].delta + drift)
    waterfall[4].end = price
  }

  const lane = {
    id: def.lane,
    lane: def.lane,
    hub: def.hub,
    carrier: carrier.code,
    carrierName: carrier.name,
    service: service.code,
    serviceName: service.name,
    zoneGroup: def.zoneGroup,
    refZone: def.refZone,
    refZip: def.refZip,
    forecastVolume: r1(fv),
    baselineVolume: r1(ctx.baselineVolume),
    weeklyCarrierForecast: r1(ctx.weeklyCarrierForecast),
    demandFactor: r4(demandFactor),
    targetMargin: r4(targetMargin),
    tier,
    cost,
    expectedCost,
    currentPrice,
    marketRef,
    marketCap: round2(marketCap),
    floorPrice: round2(floor),
    recommendedPrice: price,
    range: [round2(price * 0.96), round2(price * 1.04)],
    changePct: currentPrice ? r4(price / currentPrice - 1) : 0,
    capped: pDemand > marketCap,
    floored: floor > pCapped,
    waterfall,
  }
  lane.expectedProfit = round2(profitAt(price, lane))
  lane.currentProfit = round2(profitAt(currentPrice, lane))
  lane.impact = round2(lane.expectedProfit - lane.currentProfit)
  lane.expectedVolumeAtPrice = r1(volumeAt(price, lane))
  const sens = []
  let best = null
  for (let i = 0; i < 25; i++) {
    const p = round2(currentPrice * (0.85 + (0.35 * i) / 24))
    const pt = { price: p, volume: r1(volumeAt(p, lane)), profit: round2(profitAt(p, lane)) }
    sens.push(pt)
    if (!best || pt.profit > best.profit) best = pt
  }
  lane.sensitivity = sens
  lane.optimalPrice = best ? best.price : price
  return lane
}

export function computeAll({ defs, carriers, rateCards, forecastByCarrier, historyByCarrier, shipments, plan, customerId, refPackage, settings, now = new Date() }) {
  const shares = laneShares(shipments, defs, { now })
  const out = []
  for (const def of defs) {
    const fc = forecastByCarrier[def.carrier] || []
    const hist = historyByCarrier[def.carrier] || []
    const next4 = fc.slice(0, 4).reduce((s, p) => s + p.yhat, 0)
    const last13 = hist.slice(-13)
    const baseWeekly = last13.length ? last13.reduce((s, p) => s + p.y, 0) / last13.length : 0
    const shareRecent = (shares.recent[def.carrier] || {})[def.lane] || 0
    const shareAll = (shares.all[def.carrier] || {})[def.lane] || 0
    const lane = computeLane(def, {
      carriers,
      rateCards,
      plan,
      customerId,
      refPackage,
      settings,
      now,
      forecastVolume: next4 * shareRecent,
      baselineVolume: baseWeekly * 4 * shareAll,
      weeklyCarrierForecast: fc.length ? next4 / Math.min(4, fc.length) : 0,
    })
    if (lane) {
      lane.shareRecent = r4(shareRecent)
      lane.shareAll = r4(shareAll)
      out.push(lane)
    }
  }
  out.sort((a, b) => b.forecastVolume - a.forecastVolume || a.lane.localeCompare(b.lane))
  out.forEach((l, i) => (l.rank = i + 1))
  return out
}
