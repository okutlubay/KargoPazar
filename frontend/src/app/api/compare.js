/**
 * Quote marketplace API (panel). Builds side-by-side offers from live data; the pure rules
 * (badges, pros/cons, matrix, AI summary) live in ./quotePros.js.
 *
 * compareQuotes(input) -> Promise<CompareResult>                 request 'POST /v1/rates/compare'
 * buildComparison(input) -> CompareResult                         same, synchronous, no AI optimizer pick
 *   input = { origin: 'TR'|'NJ01'|'LA01', dest: { country = 'US', zip?, state?, city?, line1? },
 *             pkg: { lengthCm, widthCm, heightCm, weightKg }, valueUsd = 0, hsCode?: string }
 *   CompareResult = { offers: Offer[] (see quotePros.js), recommendedKey, origin, crossBorder,
 *     billable: { actualLb, dimWeightLb, billableLb }, duty: { totalUsd, averaged, hsCode } | null,
 *     hubSuggestion: 'NJ01'|'LA01'|null, poBox }
 *   TR origin + US destination: end-to-end packages (IST-CP consolidated air cargo x NJ01/LA01 hub x
 *   last mile services) plus DHL Express direct (single leg + duty). TR to other countries: direct only.
 *   NJ01 / LA01 origins: every eligible service of the hub (domestic, or international carriers when
 *   the destination is outside the US, with an estimated duty leg).
 * offersFromRateResult(result, { declaredValue, poBox, crossBorder, dutyUsd }) -> Offer[]   (shipment wizard, batch)
 * offersFromQuotes(quotes, opts) -> Offer[]
 * intlDraftOffers(draft) -> { offers, recommendedKey }   first mile wizard price step: hub x last mile mode
 *   alternatives (key 'NJ01:store'), plus DHL Express direct for reference (selectable: false)
 * stateForZip(zip) -> state code | null
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { buildPricingContext, computeQuotes, rateShopNow } from './rates.js'
import { estimateLandedCost } from './landedCost.js'
import { quoteIntlDraft, draftTotals } from './intl.js'
import { firstMileQuote, zoneFor, round2 } from '@/shared/rateEngine.js'
import { offerFromQuote, featuresOf, etaRange, rankOffers, DIRECT_EXPRESS, FIRST_MILE_DAYS, PACKAGE_RELIABILITY } from './quotePros.js'

export { DIRECT_EXPRESS }

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const LB_PER_KG = 2.20462
const IN_PER_CM = 0.393701
const PO_BOX = /\bp\.?\s*o\.?\s*box\b|\bpost\s+office\s+box\b/i

const LAST_MILE_PER_HUB = 6

export function stateForZip(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 3)
  if (z.length < 3) return null
  return db.doc('zip3_state')?.[z] ?? null
}

function toPkgIn(p = {}) {
  return {
    lengthIn: Math.round((Number(p.lengthCm) || 0) * IN_PER_CM * 10) / 10,
    widthIn: Math.round((Number(p.widthCm) || 0) * IN_PER_CM * 10) / 10,
    heightIn: Math.round((Number(p.heightCm) || 0) * IN_PER_CM * 10) / 10,
    weightLb: Math.round((Number(p.weightKg) || 0) * LB_PER_KG * 100) / 100,
  }
}

function dutyFor({ hsCode, origin, dest, valueUsd }) {
  const value = Number(valueUsd) || 0
  if (!value) return { totalUsd: 0, averaged: false, hsCode: hsCode || null }
  if (hsCode) {
    const r = estimateLandedCost({ hsCode, origin, dest, valueUsd: value })
    if (r?.rateFound) return { totalUsd: round2(r.totalUsd), averaged: false, hsCode: r.hsCode }
  }
  // No (known) HS code: average over the destination's tariff rows, flagged as an average.
  const codes = [...new Set((db.all('hs_duty_rates') || []).filter(x => x.dest === dest).map(x => x.hsCode))]
  if (!codes.length) return null
  const sum = codes.reduce((s, c) => s + (estimateLandedCost({ hsCode: c, origin, dest, valueUsd: value })?.totalUsd || 0), 0)
  return { totalUsd: round2(sum / codes.length), averaged: true, hsCode: null }
}

export function offersFromQuotes(quotes, opts = {}) {
  const carriers = opts.carriers ?? plain(db.all('carriers'))
  return (quotes || []).filter(q => q.rankable !== false).map(q => {
    const extra = opts.dutyUsd != null && opts.crossBorder ? [{ code: 'duty', amount: round2(opts.dutyUsd), estimated: true }] : []
    const o = offerFromQuote(q, { carriers, declaredValue: opts.declaredValue, poBox: opts.poBox, crossBorder: opts.crossBorder, dutyUsd: opts.dutyUsd ?? null, origin: opts.origin ?? q.hub, extraLegs: extra })
    o.etaDate = q.etaDate ?? null
    return o
  })
}

export function offersFromRateResult(result, opts = {}) {
  if (!result?.quotes) return []
  return offersFromQuotes(result.quotes, { poBox: result.poBox, ...opts })
}

function pickLastMile(quotes) {
  const list = quotes.filter(q => q.rankable !== false)
  const byPrice = [...list].sort((a, b) => a.total - b.total)
  const keep = new Set(byPrice.slice(0, LAST_MILE_PER_HUB - 2).map(q => q.key))
  const fastest = [...list].sort((a, b) => (a.etaDays ?? 99) - (b.etaDays ?? 99) || a.total - b.total)[0]
  const reliable = [...list].sort((a, b) => (b.onTimePct ?? 0) - (a.onTimePct ?? 0) || a.total - b.total)[0]
  if (fastest) keep.add(fastest.key)
  if (reliable) keep.add(reliable.key)
  for (const q of list) if (q.source === 'own') keep.add(q.key)
  return list.filter(q => keep.has(q.key))
}

function directExpressOffer({ origin, to, pkgCm, pkgIn, carriers, duty, valueUsd, poBox, volKgOverride = null }) {
  const cfg = DIRECT_EXPRESS[origin] || DIRECT_EXPRESS.default
  const carrier = carriers.find(c => c.code === cfg.carrier)
  if (!carrier || carrier.status === 'inactive') return null
  const service = carrier.services?.find(s => s.code === cfg.service)
  const volKg = volKgOverride ?? ((Number(pkgCm.lengthCm) || 0) * (Number(pkgCm.widthCm) || 0) * (Number(pkgCm.heightCm) || 0)) / 5000
  const actualKg = Number(pkgCm.weightKg) || 0
  const chargeableKg = Math.ceil(Math.max(actualKg, volKg, 0.5) * 2) / 2
  const shipping = round2(cfg.base + cfg.perKg * chargeableKg)
  const zone = to.country === 'US' ? zoneFor('NJ01', to.zip) : 8
  const features = featuresOf(carriers, cfg.carrier, cfg.service)
  const legs = [{ code: 'shipping', amount: shipping }]
  if (duty) legs.push({ code: 'duty', amount: duty.totalUsd, estimated: true })
  const actualLb = pkgIn.weightLb
  const billableLb = Math.round(chargeableKg * LB_PER_KG * 10) / 10
  return {
    key: `${origin}:${cfg.carrier}-${cfg.service}`,
    kind: 'direct',
    carrierCode: cfg.carrier, carrierName: carrier.name, serviceCode: cfg.service, serviceName: service?.name ?? cfg.service,
    origin, originPoint: null, hub: null,
    total: round2(legs.reduce((s, l) => s + l.amount, 0)), legs,
    etaMinDays: cfg.days[0], etaMaxDays: cfg.days[1],
    onTimePct: carrier.onTimeByZone?.[zone] ?? null,
    source: 'platform', features, ddp: !!features.ddpSupported, crossBorder: true,
    dutyUsd: duty?.totalUsd ?? null, declaredValue: valueUsd, poBoxDest: poBox,
    actualLb, billableLb, dimExtraLb: volKg > actualKg + 0.5 ? Math.round((volKg - actualKg) * LB_PER_KG) : 0,
    ownSavingsPct: null, consolidationDelay: null, selectable: true, aiScore: null, connectHint: null, raw: null,
  }
}

function packageOffers({ origin, to, pkgCm, pkgIn, ctx, duty, valueUsd, poBox, direct }) {
  const rateCards = ctx.rateCards
  const fmDays = FIRST_MILE_DAYS[origin] || FIRST_MILE_DAYS.default
  const point = (db.all('hubs') || []).find(h => h.country === origin && h.type === 'origin_point')
  const volumetricKg = round2(((Number(pkgCm.lengthCm) || 0) * (Number(pkgCm.widthCm) || 0) * (Number(pkgCm.heightCm) || 0)) / 6000)
  const out = []
  for (const hub of ['NJ01', 'LA01']) {
    const fm = firstMileQuote({ origin, weightKg: Number(pkgCm.weightKg) || 0, parcels: 1, volumetricKg, destHub: hub, handover: 'dropoff', lastMile: 'store', rateCards, plan: ctx.plan })
    const firstMile = round2(fm.pickup + fm.consolidation + fm.airFreight)
    const lm = computeQuotes({ hub, ignoreHubRule: true, to: { ...to, country: 'US' }, pkg: pkgIn, declaredValue: 0, insured: false }, ctx)
    for (const q of pickLastMile(lm.quotes)) {
      const features = { ...featuresOf(ctx.carriers, q.carrierCode, q.serviceCode), cutoffTime: point?.cutoff ?? '15:00', ddpSupported: true }
      const legs = [
        { code: 'first_mile', amount: firstMile },
        { code: 'customs', amount: fm.customsFee },
      ]
      if (duty) legs.push({ code: 'duty', amount: duty.totalUsd, estimated: true })
      legs.push({ code: 'last_mile', amount: round2(q.total) })
      const total = round2(legs.reduce((s, l) => s + l.amount, 0))
      const [lmMin, lmMax] = etaRange(q.etaDays, q.onTimePct)
      const etaMinDays = fmDays[0] + lmMin, etaMaxDays = fmDays[1] + lmMax
      const consolidationDelay = direct
        ? [Math.max(1, Math.min(etaMinDays - direct.etaMinDays, etaMaxDays - direct.etaMaxDays)), Math.max(etaMinDays - direct.etaMinDays, etaMaxDays - direct.etaMaxDays)]
        : [fmDays[0] - 2, fmDays[1] - 2]
      const ownSavingsPct = q.source === 'own' && q.savingsVsPlatform != null ? Math.round((q.savingsVsPlatform / (total + q.savingsVsPlatform)) * 100) / 100 : null
      out.push({
        key: `${origin}:${hub}:${q.key}`,
        kind: 'package',
        carrierCode: q.carrierCode, carrierName: q.carrierName, serviceCode: q.serviceCode, serviceName: q.serviceName,
        origin, originPoint: point?.code ?? `${origin}-CP`, hub,
        total, legs, etaMinDays, etaMaxDays,
        onTimePct: q.onTimePct != null ? Math.round(q.onTimePct * PACKAGE_RELIABILITY * 1000) / 1000 : null,
        source: q.source, features, ddp: true, crossBorder: true,
        dutyUsd: duty?.totalUsd ?? null, declaredValue: valueUsd, poBoxDest: poBox,
        actualLb: q.actualLb, billableLb: q.billableLb, dimExtraLb: q.dimWeightLb > Math.ceil(q.actualLb) ? q.billableLb - Math.ceil(q.actualLb) : 0,
        ownSavingsPct, consolidationDelay, selectable: true, aiScore: null, connectHint: null, accountLabel: q.accountLabel ?? null,
        chargeableKg: fm.chargeableKg, raw: q,
      })
    }
  }
  return out
}

function validate(input) {
  const errors = {}
  const dest = input?.dest ?? {}
  const country = (dest.country || 'US').toUpperCase()
  if (country === 'US' && !/^\d{5}$/.test(String(dest.zip || ''))) errors.zip = 'zip'
  const p = input?.pkg ?? {}
  if (!(Number(p.weightKg) > 0)) errors.weightKg = 'required'
  for (const k of ['lengthCm', 'widthCm', 'heightCm']) if (!(Number(p[k]) > 0)) errors[k] = 'required'
  if (!input?.origin) errors.origin = 'required'
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid compare request', 422, errors)
}

export function buildComparison(input) {
  validate(input)
  const ctx = buildPricingContext()
  const origin = input.origin
  const destCountry = (input.dest?.country || 'US').toUpperCase()
  const to = {
    name: 'Compare', line1: input.dest?.line1 || '1 Main St', city: input.dest?.city || '', zip: String(input.dest?.zip || ''),
    state: (input.dest?.state || stateForZip(input.dest?.zip) || '').toUpperCase(), country: destCountry, residential: true,
  }
  const poBox = PO_BOX.test(to.line1)
  const pkgCm = input.pkg
  const pkgIn = toPkgIn(pkgCm)
  const valueUsd = Number(input.valueUsd) || 0
  const usHub = origin === 'NJ01' || origin === 'LA01'
  const originCountry = usHub ? 'US' : origin
  const crossBorder = originCountry !== destCountry
  const duty = crossBorder ? dutyFor({ hsCode: input.hsCode, origin: originCountry, dest: destCountry, valueUsd }) : null
  let offers = []
  let recommendedKey = null
  let billable = null
  if (usHub) {
    const r = computeQuotes({ hub: origin, ignoreHubRule: true, to, pkg: pkgIn, declaredValue: valueUsd }, ctx)
    billable = r.billable
    offers = offersFromRateResult(r, { declaredValue: valueUsd, crossBorder, dutyUsd: duty?.totalUsd ?? null, origin, carriers: ctx.carriers })
  } else {
    const direct = directExpressOffer({ origin, to, pkgCm, pkgIn, carriers: ctx.carriers, duty, valueUsd, poBox })
    if (destCountry === 'US') offers = packageOffers({ origin, to, pkgCm, pkgIn, ctx, duty, valueUsd, poBox, direct })
    if (direct) offers.push(direct)
    billable = { actualLb: pkgIn.weightLb, dimWeightLb: null, billableLb: offers[0]?.billableLb ?? pkgIn.weightLb }
  }
  recommendedKey = rankOffers(offers, ctx.weight)
  const zones = destCountry === 'US' && to.zip ? { NJ01: zoneFor('NJ01', to.zip), LA01: zoneFor('LA01', to.zip) } : null
  const hubSuggestion = zones ? (zones.LA01 < zones.NJ01 ? 'LA01' : 'NJ01') : null
  return { offers, recommendedKey, origin, crossBorder, billable, duty, hubSuggestion, poBox, to, weight: ctx.weight }
}

/** POST /v1/rates/compare: all offers side by side; US hub origins use the AI optimizer pick as the recommendation. */
export function compareQuotes(input) {
  return request('POST /v1/rates/compare', async () => {
    const res = buildComparison(input)
    const usHub = input.origin === 'NJ01' || input.origin === 'LA01'
    if (usHub && res.offers.length) {
      try {
        const ctx = buildPricingContext()
        const r = await rateShopNow({ hub: input.origin, ignoreHubRule: true, to: res.to, pkg: toPkgIn(input.pkg), declaredValue: Number(input.valueUsd) || 0 }, ctx)
        for (const o of res.offers) {
          const q = r.quotes.find(x => x.key === o.key)
          if (q?.aiScore) o.aiScore = q.aiScore
        }
        if (r.aiPickKey && res.offers.some(o => o.key === r.aiPickKey)) res.recommendedKey = r.aiPickKey
      } catch { /* keep the rule based ranking */ }
    }
    return res
  }, { minMs: 380, maxMs: 820 })
}

/** First mile wizard alternatives: every US hub x last mile mode the draft can use, plus direct express for reference. */
export function intlDraftOffers(draft) {
  const carriers = plain(db.all('carriers'))
  const tot = draftTotals(draft)
  const hasRecipients = (draft.recipients || []).length > 0
  const modes = hasRecipients || draft.lastMile === 'direct' ? ['store', 'direct'] : ['store']
  const point = draft.originPoint || `${draft.origin}-CP`
  const fmDays = FIRST_MILE_DAYS[draft.origin] || FIRST_MILE_DAYS.default
  const firstZip = draft.recipients?.[0]?.zip
  const offers = []
  for (const hub of ['NJ01', 'LA01']) {
    for (const lastMile of modes) {
      let q
      try { q = quoteIntlDraft({ ...draft, destHub: hub, lastMile }) } catch { q = null }
      if (!q) continue
      const sum = codes => round2(q.items.filter(i => codes.includes(i.code)).reduce((s, i) => s + i.amount, 0))
      const legs = [
        { code: 'first_mile', amount: sum(['pickup', 'dropoff', 'consolidation', 'air_freight']) },
        { code: 'customs', amount: sum(['customs_fee']) },
        { code: 'last_mile', amount: sum(['last_mile_direct', 'last_mile_store']) },
      ]
      const usps = carriers.find(c => c.code === 'USPS')
      const zone = firstZip ? zoneFor(hub, firstZip) : 5
      const lmOnTime = lastMile === 'direct' ? usps?.onTimeByZone?.[zone] ?? 0.93 : 0.99
      const features = lastMile === 'direct'
        ? { ...featuresOf(carriers, 'USPS', 'GA'), cutoffTime: '15:00', ddpSupported: true }
        : { ...featuresOf(carriers, 'USPS', 'GA'), poBoxAllowed: false, saturdayDelivery: false, cutoffTime: '15:00', ddpSupported: true }
      const lmDays = Math.max(1, q.etaDays - fmDays[0] - 1)
      offers.push({
        key: `${hub}:${lastMile}`, kind: 'package',
        carrierCode: lastMile === 'direct' ? 'USPS' : null, carrierName: lastMile === 'direct' ? (usps?.name ?? 'USPS') : '',
        serviceCode: lastMile, serviceName: lastMile, serviceLabel: null,
        origin: draft.origin, originPoint: point, hub, lastMile,
        total: round2(q.total), legs, etaMinDays: fmDays[0] + lmDays, etaMaxDays: fmDays[1] + lmDays + 1,
        onTimePct: Math.round(lmOnTime * PACKAGE_RELIABILITY * 1000) / 1000,
        source: 'platform', features, ddp: true, crossBorder: true, dutyUsd: null, declaredValue: tot.valueUsd, poBoxDest: false,
        actualLb: round2(tot.weightKg * LB_PER_KG), billableLb: round2(q.chargeableKg * LB_PER_KG),
        dimExtraLb: q.chargeableKg > Math.ceil(tot.weightKg * 2) / 2 ? Math.round((q.chargeableKg - tot.weightKg) * LB_PER_KG) : 0,
        ownSavingsPct: null, consolidationDelay: null, selectable: true, aiScore: null, connectHint: null, raw: null,
      })
    }
  }
  const direct = directExpressOffer({
    origin: draft.origin, to: { country: 'US', zip: firstZip || '' }, pkgCm: { weightKg: tot.weightKg }, pkgIn: { weightLb: round2(tot.weightKg * LB_PER_KG) },
    carriers, duty: null, valueUsd: tot.valueUsd, poBox: false, volKgOverride: tot.volumetricKg * 6000 / 5000,
  })
  if (direct) {
    // one shipment per parcel for door to door express
    const n = Math.max(1, tot.parcels)
    if (n > 1) {
      direct.legs = direct.legs.map(l => (l.code === 'shipping' ? { ...l, amount: round2(l.amount + (n - 1) * DIRECT_EXPRESS_PARCEL_FEE) } : l))
      direct.total = round2(direct.legs.reduce((s, l) => s + l.amount, 0))
    }
    direct.selectable = false
    for (const o of offers) o.consolidationDelay = [Math.max(1, o.etaMinDays - direct.etaMinDays), Math.max(1, o.etaMaxDays - direct.etaMaxDays)]
    offers.push(direct)
  }
  const ctx = buildPricingContext()
  const recommendedKey = rankOffers(offers, ctx.weight)
  return { offers, recommendedKey }
}
const DIRECT_EXPRESS_PARCEL_FEE = 12
