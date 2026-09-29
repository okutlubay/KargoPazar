/**
 * KargoPazar rate engine (spec 3.5). PURE and deterministic: the same input
 * always gives the same output. Used by the landing calculator, the demo app
 * (shipment wizard, batch optimizer, API console, pricing model) and by the
 * Node seed generator, so it must not import Vue or alias paths.
 *
 * ---------------------------------------------------------------------------
 * Exported API
 * ---------------------------------------------------------------------------
 * round2(n) -> number                         money rounding (2 decimals)
 * toDate(value, refDate?) -> Date|null        accepts Date, ISO string, epoch ms or a
 *                                             relative seed object {daysAgo, hour, minute}
 * zoneFor(hub, toZip, zoneTable?) -> 2..8     zoneTable[hub][first ZIP digit] + overrides (AK/HI = 8)
 * zoneGroup(zone) -> 'near'|'mid'|'far'       2-4 / 5-6 / 7-8
 * laneKey(hub, carrierCode, serviceCode, zoneOrGroup) -> "NJ01|UPS-GROUND|near"
 * billableWeight({lengthIn, widthIn, heightIn, weightLb}) -> {actualLb, dimWeightLb, billableLb}
 *     dimWeightLb = ceil(L*W*H/139), billableLb = max(ceil(actualLb), dimWeightLb, 1)
 * insuranceFor(declaredValue, insuranceCfg?) -> number
 *     declaredValue > 100 ? ceil((declaredValue-100)/100) * 1.10 : 0
 * platformConfig(rateCards?) -> merged platform tariff (PLATFORM_RATES + rateCards.platform)
 * findCustomerLine({rateCards, customerId, carrierCode, serviceCode, now, refDate}) -> {card, line}|null
 * findDynamicOverride({dynamicOverrides, lane, now, refDate}) -> override|null
 *
 * quoteService(opts) -> Quote|null
 *   opts: {
 *     carrier: code|object, service: code|object, carriers?: Carrier[] (needed when codes are passed),
 *     hub: 'NJ01'|'LA01', toZip, toState?, zone? (skip zone lookup),
 *     pkg: {lengthIn, widthIn, heightIn, weightLb},
 *     residential = true, declaredValue = 0, insured? (default declaredValue > freeUpTo),
 *     plan = 'starter', rateCards?, customerId?,
 *     carrierAccount?: {id, carrier, status:'connected', negotiatedDiscountPct} -> own account price,
 *     dynamicOverrides? (default rateCards.dynamicOverrides), now? (Date, default new Date()),
 *     refDate? (base for relative seed dates, default now), volumeDiscountPct? (extra tier discount)
 *   }
 *   Formula:
 *     base      = service.base[zone] + service.perLb[zone] * max(0, billableLb - 1)
 *                 (times 1 - tier discount when a carrier agreement has activeTierDiscountPct / volumeDiscountPct)
 *     fuel      = base * carrier.fuelPct
 *     residential = residential ? service.resFee : 0
 *     cost      = base + fuel + residential                (platform cost)
 *     sellPrice = max(cost * (1 + markup[plan]), cost + minLabelFee)      source 'platform'
 *       customer card line (approved, in validity) replaces markup     source 'custom'
 *       approved + valid dynamic override on the lane:
 *         sellPrice = override.refCost ? cost * price / refCost : price  source 'dynamic'
 *       own carrier account: carrierCharge = cost * (1 - negotiatedDiscountPct),
 *         sellPrice = carrierCharge + ownAccountFee ($0.05)           source 'own'
 *     insurance = insured ? insuranceFor(declaredValue) : 0
 *     total     = sellPrice + insurance
 *   Quote: { key, carrierCode, carrierName, serviceCode, serviceName, level, hub, zone, zoneGroup, lane,
 *     actualLb, dimWeightLb, billableLb, base, fuel, residential, cost, markupPct, sellPrice,
 *     insurance, total, walletCharge, carrierCharge, platformFee, etaDays, onTimePct,
 *     source: 'platform'|'own'|'custom'|'dynamic', accountId?, accountLabel?, cardId?, overrideId?,
 *     ruleNotes: [{code, ...}] }
 *
 * eligibleServices({carriers, hub, toState, residential, poBox, includeInternational}) -> [{carrier, service}]
 *   active carriers only; international carriers excluded unless includeInternational;
 *   regional carriers only inside `coverage` states and from their `originHubs`;
 *   PO Box destinations drop carriers with poBoxAllowed=false;
 *   residentialOnly / commercialOnly services filtered by `residential`.
 *   Carriers added later (wizard) with status 'active' work automatically.
 *
 * rateShop(opts) -> Quote[] sorted by total (then etaDays)
 *   opts = quoteService opts without carrier/service + {carriers, carrierAccounts?, poBox?, includeInternational?}
 *   Every connected own account adds a second row (source 'own') for that carrier's services.
 *
 * cheapest(quotes), fastest(quotes) -> Quote|null
 *
 * firstMileQuote({origin:'GB'|'TR'|'DE'|..., weightKg, parcels = 1, volumetricKg?, destHub = 'NJ01',
 *   handover: 'dropoff'|'pickup' = 'dropoff', lastMile: 'direct'|'store' = 'direct',
 *   toZip?, toState?, pkg?, carriers?, rateCards?, plan?, now?, refDate?})
 *   -> { origin, destHub, parcels, chargeableKg, airRatePerKg, pickup, consolidation, airFreight,
 *        customsFee, lastMile, total, items: [{code, amount}], etaDays, lastMileQuote|null }
 *   Itemized sell prices (spec 9.2 step 5); also used by the landing calculator
 *   ("first mile + last mile parcel price", parcels = 1).
 *
 * All money values are rounded to 2 decimals.
 */

import {
  CARRIERS,
  ZONE_TABLE,
  ZONE_OVERRIDES,
  PLATFORM_RATES,
  FIRST_MILE_TARIFF,
  findCarrier,
  findService,
} from './carriers.js'

export const DIM_DIVISOR = 139
const LB_PER_KG = 2.20462

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function isRelative(v) {
  return v && typeof v === 'object' && !(v instanceof Date) && 'daysAgo' in v
}

export function toDate(value, refDate) {
  if (value == null || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') return new Date(value)
  if (isRelative(value)) {
    const base = refDate ? new Date(toDate(refDate).getTime()) : new Date()
    base.setDate(base.getDate() - num(value.daysAgo))
    base.setHours(num(value.hour), num(value.minute), 0, 0)
    return base
  }
  return null
}

export function zoneFor(hub, toZip, zoneTable = ZONE_TABLE) {
  const digits = String(toZip || '').replace(/\D/g, '')
  if (!digits) return 5
  const table = zoneTable[hub] || ZONE_TABLE[hub]
  if (!table) return 5
  const zip3 = digits.length >= 3 ? parseInt(digits.slice(0, 3), 10) : null
  if (zip3 != null) {
    for (const o of ZONE_OVERRIDES) {
      if ((!o.hub || o.hub === hub) && zip3 >= o.from && zip3 <= o.to) return o.zone
    }
  }
  const z = table[parseInt(digits[0], 10)]
  return z == null ? 5 : z
}

export function zoneGroup(zone) {
  if (typeof zone === 'string') return zone
  if (zone <= 4) return 'near'
  if (zone <= 6) return 'mid'
  return 'far'
}

export function laneKey(hub, carrierCode, serviceCode, zoneOrGroup) {
  return `${hub}|${carrierCode}-${serviceCode}|${zoneGroup(zoneOrGroup)}`
}

export function billableWeight(pkg = {}) {
  const L = num(pkg.lengthIn)
  const W = num(pkg.widthIn)
  const H = num(pkg.heightIn)
  const actualLb = num(pkg.weightLb)
  const dimWeightLb = L > 0 && W > 0 && H > 0 ? Math.ceil(round4((L * W * H) / DIM_DIVISOR)) : 0
  const ceilActual = Math.ceil(round4(actualLb))
  const billableLb = Math.max(ceilActual, dimWeightLb, 1)
  return { actualLb, dimWeightLb, billableLb }
}

export function platformConfig(rateCards) {
  const p = (rateCards && rateCards.platform) || {}
  return {
    ...PLATFORM_RATES,
    ...p,
    markup: { ...PLATFORM_RATES.markup, ...(p.markup || {}) },
    insurance: { ...PLATFORM_RATES.insurance, ...(p.insurance || {}) },
    marginRange: { ...PLATFORM_RATES.marginRange, ...(p.marginRange || {}) },
  }
}

export function insuranceFor(declaredValue, insuranceCfg = PLATFORM_RATES.insurance) {
  const v = num(declaredValue)
  const free = num(insuranceCfg.freeUpTo ?? 100)
  const per = num(insuranceCfg.per100 ?? 1.1)
  if (v <= free) return 0
  return round2(Math.ceil(round4((v - free) / 100)) * per)
}

function inValidity(obj, now, refDate) {
  const from = toDate(obj.validFrom, refDate)
  const until = toDate(obj.validUntil, refDate)
  if (from && now < from) return false
  if (until && now > until) return false
  return true
}

export function findCustomerLine({ rateCards, customerId, carrierCode, serviceCode, now, refDate }) {
  if (!rateCards || !customerId) return null
  const t = now ? toDate(now) : new Date()
  const cards = rateCards.customerCards || []
  for (const card of cards) {
    if (card.customerId !== customerId) continue
    if (card.status && card.status !== 'approved') continue
    if (!inValidity(card, t, refDate)) continue
    const line = (card.lines || []).find((l) => l.carrier === carrierCode && (l.service === serviceCode || l.service === '*'))
    if (line) return { card, line }
  }
  return null
}

export function findDynamicOverride({ dynamicOverrides, lane, now, refDate }) {
  if (!dynamicOverrides || !dynamicOverrides.length) return null
  const t = now ? toDate(now) : new Date()
  for (const o of dynamicOverrides) {
    if (o.lane !== lane) continue
    if (o.status && o.status !== 'approved') continue
    if (!inValidity(o, t, refDate)) continue
    return o
  }
  return null
}

function agreementDiscount(rateCards, carrierCode) {
  const list = (rateCards && rateCards.carrierAgreements) || []
  const a = list.find((x) => x.carrier === carrierCode)
  return a ? num(a.activeTierDiscountPct) : 0
}

export function quoteService(opts) {
  const {
    carriers = CARRIERS,
    hub,
    toZip,
    pkg = {},
    residential = true,
    declaredValue = 0,
    plan = 'starter',
    rateCards = null,
    customerId = null,
    carrierAccount = null,
    refDate = null,
  } = opts
  const c = typeof opts.carrier === 'string' ? findCarrier(carriers, opts.carrier) : opts.carrier
  const s = typeof opts.service === 'string' ? findService(c, opts.service) : opts.service
  if (!c || !s) return null
  const zone = opts.zone != null ? opts.zone : zoneFor(hub, toZip)
  if (s.base == null || s.base[zone] == null) return null
  const now = opts.now ? toDate(opts.now, refDate) : new Date()
  const cfg = platformConfig(rateCards)
  const { actualLb, dimWeightLb, billableLb } = billableWeight(pkg)
  const ruleNotes = []

  const tierDisc = num(opts.volumeDiscountPct) || agreementDiscount(rateCards, c.code)
  let baseRaw = num(s.base[zone]) + num(s.perLb && s.perLb[zone]) * Math.max(0, billableLb - 1)
  if (tierDisc) {
    baseRaw *= 1 - tierDisc
    ruleNotes.push({ code: 'volume_tier', discountPct: tierDisc })
  }
  const base = round2(baseRaw)
  const fuel = round2(base * num(c.fuelPct))
  const resFee = residential ? round2(num(s.resFee)) : 0
  const cost = round2(base + fuel + resFee)

  let source = 'platform'
  let markupPct = num(cfg.markup[plan] ?? cfg.markup.starter)
  let sellPrice
  let cardId
  let overrideId
  const lane = laneKey(hub, c.code, s.code, zone)

  const custom = findCustomerLine({ rateCards, customerId, carrierCode: c.code, serviceCode: s.code, now, refDate })
  if (custom && custom.line.fixedPrice != null) {
    sellPrice = round2(custom.line.fixedPrice)
    markupPct = cost ? round4(sellPrice / cost - 1) : 0
    source = 'custom'
    cardId = custom.card.id
    ruleNotes.push({ code: 'custom_card', cardId, name: custom.card.name, fixedPrice: sellPrice })
  } else {
    if (custom) {
      markupPct = num(custom.line.markupPct)
      source = 'custom'
      cardId = custom.card.id
      ruleNotes.push({ code: 'custom_card', cardId, name: custom.card.name, markupPct })
    }
    sellPrice = round2(Math.max(cost * (1 + markupPct), cost + num(cfg.minLabelFee)))
  }

  const overrides = opts.dynamicOverrides !== undefined ? opts.dynamicOverrides : rateCards && rateCards.dynamicOverrides
  const ov = findDynamicOverride({ dynamicOverrides: overrides, lane, now, refDate })
  if (ov && !carrierAccount) {
    const before = sellPrice
    sellPrice = ov.refCost ? round2((cost * num(ov.price)) / num(ov.refCost)) : round2(ov.price)
    markupPct = cost ? round4(sellPrice / cost - 1) : 0
    source = 'dynamic'
    overrideId = ov.id || ov.lane
    ruleNotes.push({ code: 'dynamic_price', lane, overrideId, delta: round2(sellPrice - before) })
  }

  let carrierCharge = 0
  let platformFee = 0
  let accountId
  let accountLabel
  if (carrierAccount) {
    const disc = num(carrierAccount.negotiatedDiscountPct)
    carrierCharge = round2(cost * (1 - disc))
    platformFee = round2(num(cfg.ownAccountFee ?? 0.05))
    sellPrice = round2(carrierCharge + platformFee)
    markupPct = null
    source = 'own'
    cardId = undefined
    accountId = carrierAccount.id
    accountLabel = carrierAccount.accountMasked || null
    ruleNotes.push({ code: 'own_account', accountId, discountPct: disc, platformFee })
  }

  const insured = opts.insured != null ? !!opts.insured : num(declaredValue) > num(cfg.insurance.freeUpTo)
  const insurance = insured ? insuranceFor(declaredValue, cfg.insurance) : 0
  const total = round2(sellPrice + insurance)
  const walletCharge = source === 'own' ? round2(platformFee + insurance) : total

  const q = {
    key: `${c.code}-${s.code}${source === 'own' ? ':own' : ''}`,
    carrierCode: c.code,
    carrierName: c.name,
    serviceCode: s.code,
    serviceName: s.name,
    level: s.level || 'standard',
    hub,
    zone,
    zoneGroup: zoneGroup(zone),
    lane,
    actualLb,
    dimWeightLb,
    billableLb,
    base,
    fuel,
    residential: resFee,
    cost,
    markupPct,
    sellPrice,
    insurance,
    total,
    walletCharge,
    carrierCharge,
    platformFee,
    etaDays: num(s.transitDays && s.transitDays[zone]) || null,
    onTimePct: c.onTimeByZone ? c.onTimeByZone[zone] ?? null : null,
    source,
    ruleNotes,
  }
  if (accountId) {
    q.accountId = accountId
    q.accountLabel = accountLabel
  }
  if (cardId) q.cardId = cardId
  if (overrideId) q.overrideId = overrideId
  return q
}

const US_HUB_CODES = new Set(['NJ01', 'LA01'])

export function eligibleServices({ carriers = CARRIERS, hub, toState, residential = true, poBox = false, includeInternational = false } = {}) {
  const out = []
  for (const c of carriers) {
    if (c.status !== 'active') continue
    if (c.type === 'international' && !includeInternational) continue
    // Evri is only the UK collection leg of first-mile shipments, never a US hub export service.
    if (c.code === 'EVRI' && US_HUB_CODES.has(hub)) continue
    if (Array.isArray(c.coverage) && c.coverage.length && !c.coverage.includes(toState)) continue
    if (Array.isArray(c.originHubs) && c.originHubs.length && hub && !c.originHubs.includes(hub)) continue
    if (poBox && !c.poBoxAllowed) continue
    for (const s of c.services || []) {
      if (s.active === false) continue
      if (s.residentialOnly && !residential) continue
      if (s.commercialOnly && residential) continue
      out.push({ carrier: c, service: s })
    }
  }
  return out
}

export function rateShop(opts = {}) {
  const carriers = opts.carriers || CARRIERS
  const accounts = (opts.carrierAccounts || []).filter((a) => a && a.status === 'connected')
  const list = eligibleServices({
    carriers,
    hub: opts.hub,
    toState: opts.toState,
    residential: opts.residential !== false,
    poBox: !!opts.poBox,
    includeInternational: !!opts.includeInternational,
  })
  const quotes = []
  for (const { carrier, service } of list) {
    const q = quoteService({ ...opts, carriers, carrier, service, carrierAccount: null })
    if (q) quotes.push(q)
    for (const acc of accounts) {
      if (acc.carrier !== carrier.code) continue
      const own = quoteService({ ...opts, carriers, carrier, service, carrierAccount: acc })
      if (own) quotes.push(own)
    }
  }
  quotes.sort((a, b) => a.total - b.total || a.etaDays - b.etaDays || a.key.localeCompare(b.key))
  return quotes
}

export function cheapest(quotes) {
  if (!quotes || !quotes.length) return null
  return quotes.reduce((m, q) => (q.total < m.total || (q.total === m.total && q.etaDays < m.etaDays) ? q : m))
}

export function fastest(quotes) {
  if (!quotes || !quotes.length) return null
  return quotes.reduce((m, q) => (q.etaDays < m.etaDays || (q.etaDays === m.etaDays && q.total < m.total) ? q : m))
}

const FIRST_MILE_DAYS = { GB: 5, TR: 6, DE: 5, default: 7 }

export function firstMileQuote(opts = {}) {
  const {
    origin = 'GB',
    weightKg = 1,
    parcels = 1,
    volumetricKg = 0,
    destHub = 'NJ01',
    handover = 'dropoff',
    lastMile = 'direct',
    rateCards = null,
  } = opts
  const fm = (rateCards && rateCards.firstMile) || {}
  const tariff = {
    ...FIRST_MILE_TARIFF,
    ...fm,
    customs: { ...FIRST_MILE_TARIFF.customs, ...(fm.customs || {}) },
    lastMile: { ...FIRST_MILE_TARIFF.lastMile, ...(fm.lastMile || {}) },
  }
  const o = tariff[origin] || tariff.default
  const n = Math.max(1, Math.round(num(parcels)))
  const pickup = round2((handover === 'pickup' ? num(o.pickupPerParcel) : num(o.dropoffPerParcel)) * n)
  const consolidation = round2(num(o.consolidationPerParcel) * n)
  const rawKg = Math.max(num(weightKg), num(volumetricKg), num(o.minAirKg || 0))
  const chargeableKg = Math.ceil(round4(rawKg * 2)) / 2
  const airRatePerKg = num((o.airPerKg && (o.airPerKg[destHub] ?? o.airPerKg.NJ01)) || 0)
  const airFreight = round2(chargeableKg * airRatePerKg)
  const cu = tariff.customs
  const customsFee = round2(n === 1 ? num(cu.singleParcelFee) : num(cu.perShipment) + num(cu.perParcel) * n)

  let lastMileAmt = 0
  let lastMileQuote = null
  let lastMileDays = 0
  if (lastMile === 'store') {
    lastMileAmt = round2(num(tariff.lastMile.store.perParcel) * n)
  } else {
    const d = tariff.lastMile.direct
    const perParcelLb = (num(weightKg) / n) * LB_PER_KG
    if (opts.toZip) {
      lastMileQuote = quoteService({
        carriers: opts.carriers || CARRIERS,
        carrier: d.carrier,
        service: d.service,
        hub: destHub,
        toZip: opts.toZip,
        toState: opts.toState,
        pkg: opts.pkg || { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: perParcelLb },
        residential: true,
        declaredValue: 0,
        insured: false,
        plan: opts.plan || 'starter',
        rateCards,
        now: opts.now,
        refDate: opts.refDate,
        dynamicOverrides: null,
      })
    }
    if (lastMileQuote) {
      lastMileAmt = round2(lastMileQuote.sellPrice * n)
      lastMileDays = lastMileQuote.etaDays || 0
    } else {
      lastMileAmt = round2(num(d.fallbackPerParcel) * n)
      lastMileDays = 4
    }
  }
  const total = round2(pickup + consolidation + airFreight + customsFee + lastMileAmt)
  return {
    origin,
    destHub,
    parcels: n,
    chargeableKg,
    airRatePerKg,
    pickup,
    consolidation,
    airFreight,
    customsFee,
    lastMile: lastMileAmt,
    total,
    items: [
      { code: 'pickup', amount: pickup },
      { code: 'consolidation', amount: consolidation },
      { code: 'air_freight', amount: airFreight },
      { code: 'customs', amount: customsFee },
      { code: 'last_mile', amount: lastMileAmt },
    ],
    etaDays: (FIRST_MILE_DAYS[origin] || FIRST_MILE_DAYS.default) + lastMileDays,
    lastMileQuote,
  }
}
