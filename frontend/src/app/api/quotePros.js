/**
 * Quote marketplace engine (PURE: no Vue, no db, no alias imports). Shared by the panel
 * (QuoteComparison, compare page, batch alternatives, overview) and the landing calculator.
 *
 * ---------------------------------------------------------------------------
 * Offer (normalized quote shown side by side)
 * ---------------------------------------------------------------------------
 *   { key, kind: 'service'|'package'|'direct', carrierCode, carrierName, serviceCode, serviceName,
 *     origin, originPoint?, hub?, total (USD), legs: [{ code, amount, estimated? }],
 *       leg codes: shipping | first_mile | customs | duty | last_mile | insurance | signature
 *     etaMinDays, etaMaxDays, onTimePct (0..1), source: 'platform'|'own'|'custom'|'dynamic'|'package',
 *     features: { signatureIncluded, saturdayDelivery, poBoxAllowed, trackingGranularity,
 *                 insuranceIncludedUpTo, claimsWindowDays, cutoffTime, ddpSupported, returnLabelSupported },
 *     ddp, crossBorder, dutyUsd|null, declaredValue, poBoxDest, actualLb, billableLb, dimExtraLb,
 *     ownSavingsPct|null (own account vs platform price, > 0 = cheaper), consolidationDelay: [min,max]|null,
 *     selectable (default true), aiScore|null, connectHint|null, raw }
 *
 * offerFromQuote(quote, opts) -> Offer           rate engine quote -> offer
 * featuresOf(carriers, carrierCode, serviceCode) -> features
 * annotateOffers(offers, { recommendedKey }) -> { offers: AnnotatedOffer[], cheapestKey, fastestKey, reliableKey, recommendedKey }
 *   AnnotatedOffer = Offer + { badges: ['ai'|'cheapest'|'fastest'|'reliable'|'own'|'dynamic'|'custom'],
 *     deltaCheapest: { amount, pct }, deltaFastestDays, pros: Item[], cons: Item[] }
 *   Item = { sign: '+'|'-', code, params, weight }   text: i18n key `compare.pros.<code>` / `compare.cons.<code>`
 * rankOffers(offers, weight = 0.6) -> best key (sets aiScore on offers without one)
 * sortOffers(offers, mode 'recommended'|'cheapest'|'fastest'|'reliable', recommendedKey?)
 * filterOffers(offers, { maxPrice, maxDays, carriers: [], ownOnly, signatureOnly, ddpOnly })
 * compareMatrix(offers) -> rows [{ key, group, kind: 'money'|'days'|'pct'|'bool'|'tracking'|'time'|'number',
 *     cells: [{ key, value, best, worst }] }]  (best = green, worst = red; only when values differ)
 * aiSummary(offers, recommendedKey) -> [{ code, key (offer), params }]  2-3 sentences, i18n `compare.summary.<code>`
 * quoteChoiceFor(offers, chosenKey, { recommendedKey }) -> { kind, alternatives, savingUsd }
 * seedQuoteChoice(id, total) -> deterministic quoteChoice for seed shipments without one
 * deliveryWindow(offer, now?) -> { from, to } ISO dates (business days)
 * formatParams(params, lang) -> params with numbers formatted for the locale ('tr' | 'en')
 */

/** Door to door express from an origin country (USD sell price, chargeable kg = max(actual, L*W*H/5000)). */
export const DIRECT_EXPRESS = {
  TR: { carrier: 'DHLX', service: 'EXPRESS_WW', base: 24.5, perKg: 8.9, days: [3, 5] },
  default: { carrier: 'DHLX', service: 'EXPRESS_WW', base: 29, perKg: 10.4, days: [3, 6] },
}
/** First mile (drop-off, consolidation, air freight, US customs) transit window by origin. */
export const FIRST_MILE_DAYS = { TR: [5, 7], GB: [4, 6], DE: [4, 6], default: [6, 8] }
/** Consolidation + flight on-time factor applied to the last mile carrier's rate. */
export const PACKAGE_RELIABILITY = 0.97

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const LB_PER_KG = 2.20462

export const TRACKING_RANK = { basic: 1, detailed: 2, realtime: 3 }
export const DEFAULT_FEATURES = {
  signatureIncluded: false, saturdayDelivery: false, poBoxAllowed: false, trackingGranularity: 'detailed',
  insuranceIncludedUpTo: 0, claimsWindowDays: 30, cutoffTime: '16:00', ddpSupported: false, returnLabelSupported: false,
}

export function featuresOf(carriers, carrierCode, serviceCode) {
  const c = (carriers || []).find(x => x.code === carrierCode)
  const s = c?.services?.find(x => x.code === serviceCode)
  const out = { ...DEFAULT_FEATURES }
  if (!s) return out
  for (const k of Object.keys(DEFAULT_FEATURES)) if (s[k] != null) out[k] = s[k]
  return out
}

/** Range in days for one transit estimate: carriers below 95% on time get a one day buffer. */
export function etaRange(etaDays, onTimePct) {
  const d = Math.max(1, Math.round(num(etaDays) || 1))
  return [d, onTimePct != null && onTimePct < 0.95 ? d + 1 : d]
}

export function offerFromQuote(q, opts = {}) {
  const { carriers = [], declaredValue = 0, poBox = false, crossBorder = false, dutyUsd = null, origin = q.hub, extraLegs = [] } = opts
  const features = featuresOf(carriers, q.carrierCode, q.serviceCode)
  const [etaMinDays, etaMaxDays] = etaRange(q.etaDays, q.onTimePct)
  const shipping = r2(num(q.sellPrice ?? q.total))
  const legs = [{ code: 'shipping', amount: shipping }]
  if (num(q.insurance) > 0) legs.push({ code: 'insurance', amount: r2(q.insurance) })
  if (num(q.signatureFee) > 0) legs.push({ code: 'signature', amount: r2(q.signatureFee) })
  for (const l of extraLegs) legs.push(l)
  const total = r2(legs.reduce((s, l) => s + num(l.amount), 0))
  const actualLb = num(q.actualLb)
  const billableLb = num(q.billableLb)
  const dimExtraLb = billableLb && q.dimWeightLb > Math.ceil(actualLb) ? billableLb - Math.ceil(actualLb) : 0
  const platformTotal = q.source === 'own' && q.savingsVsPlatform != null ? num(q.total) + num(q.savingsVsPlatform) : null
  return {
    key: q.key,
    kind: crossBorder ? 'direct' : 'service',
    carrierCode: q.carrierCode, carrierName: q.carrierName, serviceCode: q.serviceCode, serviceName: q.serviceName,
    origin, hub: q.hub ?? null, total, legs,
    etaMinDays, etaMaxDays, onTimePct: q.onTimePct ?? null,
    source: q.source || 'platform', features, ddp: !!(crossBorder && features.ddpSupported), crossBorder: !!crossBorder,
    dutyUsd, declaredValue: num(declaredValue), poBoxDest: !!poBox,
    actualLb, billableLb, dimExtraLb,
    ownSavingsPct: platformTotal ? r2(num(q.savingsVsPlatform) / platformTotal * 100) / 100 : null,
    consolidationDelay: null, selectable: true, aiScore: q.aiScore ?? null, connectHint: q.connectHint ?? null,
    accountLabel: q.accountLabel ?? null, raw: q,
  }
}

// ---------------------------------------------------------------------------
// Annotation: badges, deltas, pros / cons
// ---------------------------------------------------------------------------

const etaKey = o => (o.etaMaxDays ?? 99) + (o.etaMinDays ?? 99) / 100
function pick(list, cmp) { return list.length ? [...list].sort(cmp)[0] : null }

export function annotateOffers(input, { recommendedKey = null } = {}) {
  const offers = (input || []).filter(Boolean)
  const cheapest = pick(offers, (a, b) => a.total - b.total || etaKey(a) - etaKey(b))
  const fastest = pick(offers, (a, b) => etaKey(a) - etaKey(b) || a.total - b.total)
  const reliable = pick(offers.filter(o => o.onTimePct != null), (a, b) => b.onTimePct - a.onTimePct || a.total - b.total)
  const direct = pick(offers.filter(o => o.kind === 'direct'), (a, b) => a.total - b.total)
  const recKey = offers.some(o => o.key === recommendedKey) ? recommendedKey : cheapest?.key ?? null
  const stats = {
    cheapestKey: cheapest?.key ?? null, fastestKey: fastest?.key ?? null, reliableKey: reliable?.key ?? null, recommendedKey: recKey,
    minTotal: cheapest?.total ?? 0, fastestMax: fastest?.etaMaxDays ?? 0, cheapest, fastest, reliable, direct, count: offers.length,
    avgTotal: offers.length ? offers.reduce((s, o) => s + o.total, 0) / offers.length : 0,
  }
  const out = offers.map(o => {
    const badges = []
    if (o.key === recKey) badges.push('ai')
    if (o.key === stats.cheapestKey) badges.push('cheapest')
    if (o.key === stats.fastestKey) badges.push('fastest')
    if (o.key === stats.reliableKey && offers.length > 1) badges.push('reliable')
    if (o.source === 'own') badges.push('own')
    if (o.source === 'dynamic') badges.push('dynamic')
    if (o.source === 'custom') badges.push('custom')
    const amount = r2(o.total - stats.minTotal)
    const deltaCheapest = { amount, pct: stats.minTotal > 0 ? amount / stats.minTotal : 0 }
    const deltaFastestDays = Math.max(0, (o.etaMaxDays ?? 0) - stats.fastestMax)
    const base = { ...o, badges, deltaCheapest, deltaFastestDays }
    const { pros, cons } = prosAndCons(base, stats)
    return { ...base, pros, cons }
  })
  return { offers: out, ...stats }
}

function timeVal(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Rule engine. Every rule reads offer data only; weights decide which 3-5 items are shown. */
export function prosAndCons(o, s) {
  const P = [], C = []
  const f = o.features || DEFAULT_FEATURES
  const plus = (code, weight, params = {}) => P.push({ sign: '+', code, params, weight })
  const minus = (code, weight, params = {}) => C.push({ sign: '-', code, params, weight })
  const isCheapest = o.key === s.cheapestKey
  const isFastest = o.key === s.fastestKey
  const single = s.count <= 1

  // pros
  if (isCheapest && !single) plus('cheapest', 100)
  if (isFastest && !single) plus('fastest', 95)
  if (o.source === 'own' && o.ownSavingsPct != null && o.ownSavingsPct >= 0.01) plus('ownSaving', 93, { pct: Math.round(o.ownSavingsPct * 100) })
  if (o.crossBorder && o.ddp) plus('ddp', 88)
  if (o.poBoxDest && f.poBoxAllowed) plus('poBoxOk', 86)
  if (!isCheapest && !isFastest && s.cheapest && o.deltaCheapest.pct <= 0.15 && (s.cheapest.etaMaxDays - o.etaMaxDays) >= 1) {
    plus('valueSpeed', 84, { pct: Math.max(1, Math.round(o.deltaCheapest.pct * 100)), days: s.cheapest.etaMaxDays - o.etaMaxDays })
  }
  if (o.kind === 'package' && s.direct && s.direct.total > o.total) plus('cheaperThanExpress', 76, { pct: Math.round((1 - o.total / s.direct.total) * 100) })
  if (o.key === s.reliableKey && !single && o.onTimePct != null) plus('mostReliable', 72, { pct: Math.round(o.onTimePct * 1000) / 10 })
  else if (o.onTimePct != null && o.onTimePct >= 0.96) plus('highOnTime', 52, { pct: Math.round(o.onTimePct * 1000) / 10 })
  if (f.signatureIncluded) plus('signature', 62)
  if (o.source === 'dynamic') plus('dynamicPrice', 56)
  if (o.source === 'custom') plus('customRate', 54)
  if (num(f.insuranceIncludedUpTo) > 0 && (o.declaredValue <= 0 || o.declaredValue <= num(f.insuranceIncludedUpTo))) plus('insuranceIncluded', 50)
  if (TRACKING_RANK[f.trackingGranularity] === 3) plus('realtimeTracking', 48)
  if (f.saturdayDelivery) plus('saturday', 45)
  if (timeVal(f.cutoffTime) >= timeVal('17:30')) plus('lateCutoff', 40, { time: f.cutoffTime })
  if (num(f.claimsWindowDays) >= 60) plus('longClaims', 30, { days: f.claimsWindowDays })
  if (f.returnLabelSupported) plus('returnLabel', 20)

  // cons
  if (o.poBoxDest && !f.poBoxAllowed) minus('noPoBox', 99)
  if (o.crossBorder && !o.ddp) minus('dutyAtDoor', 90)
  if (o.onTimePct != null && o.onTimePct < 0.93) minus('lowOnTime', Math.round(60 + (0.95 - o.onTimePct) * 400), { pct: Math.round(o.onTimePct * 1000) / 10 })
  if (o.consolidationDelay) minus('consolidationDelay', 80, { min: o.consolidationDelay[0], max: o.consolidationDelay[1] })
  if (o.dimExtraLb >= 1) minus('dimWeight', 76, { kg: Math.round((o.dimExtraLb / LB_PER_KG) * 10) / 10, lb: o.dimExtraLb })
  if (o.source === 'own' && o.ownSavingsPct != null && o.ownSavingsPct < 0) minus('ownPricier', 70, { pct: Math.round(-o.ownSavingsPct * 100) })
  if (!isCheapest && o.deltaCheapest.pct >= 0.25) minus('pricier', 66, { pct: Math.round(o.deltaCheapest.pct * 100) })
  if (num(f.insuranceIncludedUpTo) <= 0) minus('noInsurance', o.declaredValue > 100 ? 68 : 54)
  if (!isFastest && o.deltaFastestDays >= 2) minus('slower', 60, { days: o.deltaFastestDays })
  if (TRACKING_RANK[f.trackingGranularity] === 1) minus('basicTracking', 46)
  if (timeVal(f.cutoffTime) < timeVal('16:00')) minus('earlyCutoff', 40, { time: f.cutoffTime })
  if (num(f.claimsWindowDays) <= 30) minus('shortClaims', 34, { days: f.claimsWindowDays })
  if (!o.poBoxDest && !f.poBoxAllowed) minus('noPoBox', 28)
  if (!f.returnLabelSupported) minus('noReturnLabel', 26)

  P.sort((a, b) => b.weight - a.weight)
  C.sort((a, b) => b.weight - a.weight)
  let pros = P.slice(0, 3)
  let cons = C.slice(0, 2)
  // at least 3 items in total, at most 5
  const restP = P.slice(3), restC = C.slice(2)
  while (pros.length + cons.length < 3 && (restP.length || restC.length)) {
    const next = (restP[0]?.weight ?? -1) >= (restC[0]?.weight ?? -1) ? restP.shift() : restC.shift()
    if (next.sign === '+') pros.push(next); else cons.push(next)
  }
  return { pros, cons }
}

// ---------------------------------------------------------------------------
// Sort / filter
// ---------------------------------------------------------------------------

export function sortOffers(list, mode = 'recommended', recommendedKey = null) {
  const arr = [...(list || [])]
  const byPrice = (a, b) => a.total - b.total || etaKey(a) - etaKey(b)
  const bySpeed = (a, b) => etaKey(a) - etaKey(b) || a.total - b.total
  const byRel = (a, b) => (b.onTimePct ?? 0) - (a.onTimePct ?? 0) || a.total - b.total
  if (mode === 'cheapest') return arr.sort(byPrice)
  if (mode === 'fastest') return arr.sort(bySpeed)
  if (mode === 'reliable') return arr.sort(byRel)
  return arr.sort((a, b) => {
    const ra = a.key === recommendedKey ? 0 : 1, rb = b.key === recommendedKey ? 0 : 1
    if (ra !== rb) return ra - rb
    const sa = a.aiScore?.score, sb = b.aiScore?.score
    if (sa != null && sb != null && sa !== sb) return sb - sa
    return byPrice(a, b)
  })
}

/**
 * Cost / speed / reliability score (same weighting as the optimizer and the landing ranking:
 * cost w, speed (1-w)*0.6, reliability 0.3). Sets offer.aiScore when missing, returns the best key.
 */
export function rankOffers(list, weight = 0.6) {
  const offers = (list || []).filter(o => o && o.selectable !== false)
  if (!offers.length) return null
  const totals = offers.map(o => o.total), etas = offers.map(o => o.etaMaxDays ?? 5)
  const minC = Math.min(...totals), maxC = Math.max(...totals), minE = Math.min(...etas), maxE = Math.max(...etas)
  const w = { cost: weight, speed: (1 - weight) * 0.6, reliability: 0.3 }
  let best = null
  for (const o of offers) {
    const cost = maxC > minC ? (maxC - o.total) / (maxC - minC) : 1
    const speed = maxE > minE ? (maxE - (o.etaMaxDays ?? 5)) / (maxE - minE) : 1
    const reliability = Math.min(1, Math.max(0, ((o.onTimePct ?? 0.9) - 0.8) / 0.2))
    const score = Math.round((w.cost * cost + w.speed * speed + w.reliability * reliability) * 1000) / 1000
    if (!o.aiScore) o.aiScore = { score, components: { cost, speed, reliability, weights: w } }
    if (!best || score > best.score || (score === best.score && o.total < best.o.total)) best = { o, score }
  }
  return best?.o.key ?? null
}

export function filterOffers(list, f = {}) {
  return (list || []).filter(o => {
    if (f.maxPrice != null && f.maxPrice !== '' && o.total > Number(f.maxPrice)) return false
    if (f.maxDays != null && f.maxDays !== '' && o.etaMaxDays > Number(f.maxDays)) return false
    if (f.carriers?.length && !f.carriers.includes(o.carrierCode)) return false
    if (f.ownOnly && o.source !== 'own') return false
    if (f.signatureOnly && !o.features?.signatureIncluded) return false
    if (f.ddpOnly && !o.ddp) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Side by side matrix
// ---------------------------------------------------------------------------

const LEG_ORDER = ['shipping', 'first_mile', 'customs', 'duty', 'last_mile', 'insurance', 'signature']

export function compareMatrix(offers) {
  const list = offers || []
  const rows = []
  const add = (key, group, kind, valueOf, better) => {
    const cells = list.map(o => ({ key: o.key, value: valueOf(o) }))
    const vals = cells.map(c => c.value).filter(v => v != null)
    if (better && vals.length > 1) {
      const score = v => (typeof v === 'boolean' ? (v ? 1 : 0) : kind === 'tracking' ? TRACKING_RANK[v] ?? 0 : kind === 'time' ? timeVal(v) : kind === 'days' ? v[1] * 100 + v[0] : num(v))
      const scores = cells.map(c => (c.value == null ? null : score(c.value)))
      const valid = scores.filter(x => x != null)
      const hi = Math.max(...valid), lo = Math.min(...valid)
      if (hi !== lo) {
        cells.forEach((c, i) => {
          if (scores[i] == null) return
          const bestV = better === 'high' ? hi : lo
          const worstV = better === 'high' ? lo : hi
          c.best = scores[i] === bestV
          c.worst = scores[i] === worstV
        })
      }
    }
    rows.push({ key, group, kind, cells })
  }
  add('total', 'price', 'money', o => o.total, 'low')
  const legCodes = LEG_ORDER.filter(code => list.some(o => o.legs?.some(l => l.code === code)))
  for (const code of legCodes) add('leg_' + code, 'price', 'money', o => { const l = o.legs?.find(x => x.code === code); return l ? l.amount : null }, 'low')
  add('transit', 'speed', 'days', o => [o.etaMinDays, o.etaMaxDays], 'low')
  add('reliability', 'speed', 'pct', o => o.onTimePct, 'high')
  add('tracking', 'service', 'tracking', o => o.features?.trackingGranularity ?? null, 'high')
  add('insurance', 'service', 'money', o => num(o.features?.insuranceIncludedUpTo), 'high')
  add('signature', 'service', 'bool', o => !!o.features?.signatureIncluded, 'high')
  add('saturday', 'service', 'bool', o => !!o.features?.saturdayDelivery, 'high')
  add('poBox', 'service', 'bool', o => !!o.features?.poBoxAllowed, 'high')
  add('cutoff', 'service', 'time', o => o.features?.cutoffTime ?? null, 'high')
  add('claims', 'service', 'number', o => num(o.features?.claimsWindowDays), 'high')
  add('returnLabel', 'service', 'bool', o => !!o.features?.returnLabelSupported, 'high')
  add('ddp', 'customs', 'bool', o => !!o.ddp, list.some(o => o.crossBorder) ? 'high' : null)
  add('customsCost', 'customs', 'money', o => {
    if (!o.crossBorder) return null
    return r2((o.legs || []).filter(l => l.code === 'customs' || l.code === 'duty').reduce((s, l) => s + num(l.amount), 0))
  }, 'low')
  return rows
}

// ---------------------------------------------------------------------------
// AI summary (rule based sentences)
// ---------------------------------------------------------------------------

export function offerName(o) {
  if (!o) return ''
  if (o.kind === 'package') return `${o.originPoint || o.origin} > ${o.hub} > ${o.serviceName}`
  return o.source === 'own' ? `${o.serviceName} (${o.carrierName} *)` : o.serviceName
}

export function aiSummary(offers, recommendedKey = null) {
  const list = (offers || []).filter(Boolean)
  if (!list.length) return []
  const a = list[0].badges ? { offers: list } : annotateOffers(list, { recommendedKey })
  const ann = a.offers
  const cheapest = pick(ann, (x, y) => x.total - y.total || etaKey(x) - etaKey(y))
  const fastest = pick(ann, (x, y) => etaKey(x) - etaKey(y) || x.total - y.total)
  const reliable = pick(ann.filter(o => o.onTimePct != null), (x, y) => y.onTimePct - x.onTimePct || x.total - y.total)
  const rec = ann.find(o => o.key === recommendedKey) || null
  const out = []
  if (ann.length === 1) return [{ code: 'single', key: cheapest.key, params: { name: offerName(cheapest) } }]
  if (cheapest.key === fastest.key) {
    out.push({ code: 'dominant', key: cheapest.key, params: { name: offerName(cheapest) } })
  } else {
    const others = ann.filter(o => o.key !== cheapest.key)
    const avg = others.reduce((s, o) => s + o.total, 0) / others.length
    out.push({ code: 'pickCheapest', key: cheapest.key, params: { name: offerName(cheapest), pct: Math.max(1, Math.round((1 - cheapest.total / avg) * 100)) } })
    const days = Math.max(1, cheapest.etaMaxDays - fastest.etaMaxDays)
    const pct = Math.round((fastest.total / cheapest.total - 1) * 100)
    out.push({ code: 'pickFastest', key: fastest.key, params: { name: offerName(fastest), days, pct } })
  }
  const crossDdp = ann.some(o => o.crossBorder && o.ddp) && ann.some(o => o.crossBorder && !o.ddp)
  if (crossDdp) {
    const d = pick(ann.filter(o => o.ddp), (x, y) => x.total - y.total)
    out.push({ code: 'pickDdp', key: d.key, params: { name: offerName(d) } })
  } else if (rec && rec.key !== cheapest.key && rec.key !== fastest.key) {
    out.push({ code: 'pickRecommended', key: rec.key, params: { name: offerName(rec) } })
  } else if (reliable && reliable.key !== cheapest.key && reliable.key !== fastest.key) {
    out.push({ code: 'pickReliable', key: reliable.key, params: { name: offerName(reliable), pct: Math.round(reliable.onTimePct * 1000) / 10 } })
  } else if (ann.some(o => o.kind === 'package') && ann.some(o => o.kind === 'direct')) {
    out.push({ code: 'packageVsDirect', params: {} })
  }
  if (out.length < 2) {
    // runner up: the next best offer that is not already named, with what it trades off
    const named = new Set(out.map(x => x.key))
    const next = pick(ann.filter(o => !named.has(o.key)), (x, y) => x.total - y.total || etaKey(x) - etaKey(y))
    if (next) {
      const top = next.pros[0]
      out.push({ code: top ? 'runnerUp' : 'runnerUpPlain', key: next.key, params: { name: offerName(next), pct: Math.max(0, Math.round((next.total / cheapest.total - 1) * 100)), pro: top ? top.code : '' }, pro: top || null })
    }
  }
  return out.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Choice bookkeeping (overview marketplace summary)
// ---------------------------------------------------------------------------

export function quoteChoiceFor(offers, chosenKey, { recommendedKey = null } = {}) {
  const list = (offers || []).filter(Boolean)
  const chosen = list.find(o => o.key === chosenKey)
  if (!chosen) return null
  const cheapest = pick(list, (a, b) => a.total - b.total || etaKey(a) - etaKey(b))
  const fastest = pick(list, (a, b) => etaKey(a) - etaKey(b) || a.total - b.total)
  const kind = chosenKey === recommendedKey ? 'recommended' : chosenKey === cheapest?.key ? 'cheapest' : chosenKey === fastest?.key ? 'fastest' : 'other'
  const others = list.filter(o => o.key !== chosenKey)
  const avg = others.length ? others.reduce((s, o) => s + o.total, 0) / others.length : chosen.total
  return { kind, alternatives: others.length, savingUsd: r2(avg - chosen.total) }
}

function hash(str) {
  let h = 2166136261
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Deterministic choice for seed shipments created before the comparison existed. */
export function seedQuoteChoice(id, total = 10) {
  const h = hash(id)
  const k = h % 100
  const kind = k < 42 ? 'recommended' : k < 70 ? 'cheapest' : k < 85 ? 'fastest' : 'other'
  const alternatives = 4 + ((h >>> 8) % 7)
  const jitter = ((h >>> 4) % 12) / 100
  const t = num(total) || 10
  const pct = kind === 'recommended' ? 0.1 + jitter : kind === 'cheapest' ? 0.16 + jitter : kind === 'fastest' ? -(0.06 + jitter) : 0.03 + jitter / 2
  return { kind, alternatives, savingUsd: r2(t * pct) }
}

// ---------------------------------------------------------------------------
// Dates and formatting
// ---------------------------------------------------------------------------

export function addBusinessDays(date, n) {
  const d = new Date(date)
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const w = d.getDay()
    if (w !== 0 && w !== 6) left--
  }
  return d
}

export function deliveryWindow(o, now = new Date()) {
  if (!o) return null
  return { from: addBusinessDays(now, o.etaMinDays ?? 1).toISOString(), to: addBusinessDays(now, o.etaMaxDays ?? o.etaMinDays ?? 1).toISOString() }
}

export function formatParams(params = {}, lang = 'tr') {
  const loc = lang === 'tr' ? 'tr-TR' : 'en-US'
  const out = {}
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'number' ? new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(v) : v
  }
  return out
}
