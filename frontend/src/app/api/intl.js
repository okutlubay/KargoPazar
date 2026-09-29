/**
 * International first mile API (spec 9.1, 9.2, 9.3).
 *
 * ---------------------------------------------------------------------------
 * API summary (async functions go through request(); errors are ApiError)
 * ---------------------------------------------------------------------------
 * STAGES: created, origin_received, consolidation, in_flight, us_customs, customs_cleared,
 *         at_us_hub, last_mile_labeled, out_for_delivery, completed
 * stageIndex(stage), nextStage(stage) -> stage|null                                 (sync, pure)
 * DHL_EVENT_MAP, mapCarrierEvent(code) -> { code, stage } | null                     (sync, pure)
 *
 * Countries / points (sync, read the live `countries` + `hubs` collections, so markets added in
 * Admin > Countries appear without code changes):
 *   originCountries() -> Country[] (active, role origin|both)
 *   countryConfig(code) -> Country|null
 *   originPointsFor(code) -> Hub[] (virtual consolidation point for wizard-added countries)
 *   consolidationPointFor(origin, originPointCode) -> Hub
 *   flightFor(consolidationCode, destHub) -> { flight, route, airline, mawbPrefix, from, to }
 *   fxRate(currency), toUsdDemo(amount, currency), fromUsdDemo(usd, currency)
 *   normalizePostcode(country, value), validatePostcodeFor(country, value) -> { value, valid }
 *   validateOriginAddress(country, address) -> { valid, errors: { field: 'required'|'zip' } }
 *   checkCountryRules({ origin, items, valueUsd }) -> [{ code, severity, params }]
 *   suggestHubFor(recipients) -> { hub, zones: {NJ01, LA01}, share, reasonCode, reason: {tr,en} }
 *   quoteIntlDraft(draft) -> itemized price (see priceFor)
 *   buildIntlRecord(draft, { id, now }) -> intl_shipments record (pure, used by tests too)
 *   applyStage(record, stage, ctx) -> { patch, event }   pure stage transition (tests use it on clones)
 *   buildHawbLine(record) -> manifest HAWB line
 *   requestCollection(address), airLegLabel(record) -> carrier adapter simulations (pure)
 *   parseRecipientsCsv(text) -> { recipients, errors: [{ row, field, code }] }, recipientsCsvTemplate()
 *
 * listIntl({ origin?, stage?, q?, from?, to? }) -> Intl[] newest first     GET /v1/intl/shipments
 * intlCounts() -> { all, active, customs, completed, byStage }           (sync)
 * getIntl(id) -> Intl & { stageIndex, next, originPointInfo, consolidation, destHubInfo, manifest,
 *                         lastMileShipments, documents, rules }
 * createIntl(draft) -> { intl, transaction, topup, balance }             POST /v1/intl/shipments
 *   draft = { origin, originPoint, handover: 'dropoff'|'pickup', sender, destHub, lastMile: 'store'|'direct',
 *             recipients: [{ name, line1, line2?, city, state, zip, orderId? }], contentType,
 *             parcels: [{ lengthCm, widthCm, heightCm, weightKg, items: [{ sku?, title, qty, unitValueLocal, hsCode, origin?, weightKg? }] }],
 *             dummyLabel: boolean }
 *   Wallet is charged for the itemized total (auto top-up / INSUFFICIENT_FUNDS as for labels).
 * advanceStage(id, { onProgress }) -> { intl, stage, labels: Shipment[] }   demo "advance to next stage"
 *   in_flight: MAWB + flight + air customs manifest; us_customs: manifest submitted; customs_cleared:
 *   blocked with CUSTOMS_DOCS_REQUIRED while additional documents are requested; last_mile_labeled:
 *   real last mile labels via shipments.createShipment (prepaid, the wallet charge is offset) and the
 *   temporary label is marked replaced; out_for_delivery: first carrier scans on the last mile labels.
 * uploadCustomsDocs(id, files: [{ docIndex, name, size, type, dataUrl? }]) -> Intl
 * listCustomsDocuments({ type?, origin?, q? }) -> [{ key, intlId, type, number, at, origin, valueUsd, status, name? }]
 * downloadCustomsDocument(key) -> filename          (generates the PDF with src/app/docs)
 * listAirManifests() -> Manifest[] (type air_customs), downloadAirManifest(id) -> filename
 * customsQueue() -> Intl[] in flight / at US customs / docs requested
 * listCatalog() -> Product[] (missing HS first)
 * listRecipientOrders() -> awaiting shipment orders (for "pick from orders")
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { firstMileQuote, quoteService, zoneFor, round2 } from '@/shared/rateEngine.js'
import { validatePostcode, COUNTRY_PRESETS } from '@/shared/countries.js'
import { CARRIERS } from '@/shared/carriers.js'
import { chargeWallet, creditWallet } from './wallet.js'
import { createShipment, createDummyLabel, markDummyReplaced, generateTrackingNo, advanceTracking } from './shipments.js'
import { mulberry32, hashSeed } from '../ai/prng.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()
export const LB_PER_KG = 2.20462
export const IN_PER_CM = 0.393701
const docsModule = () => import('../docs/index.js')
// Optional sibling engines (written by other areas); guarded so this module works without them.
const optional = import.meta.glob(['./customs.js', './manifests.js'])

async function loadOptional(name) {
  const loader = optional[`./${name}.js`]
  if (!loader) return null
  try { return await loader() } catch { return null }
}

// ---------------------------------------------------------------------------
// Stages and carrier events
// ---------------------------------------------------------------------------

export const STAGES = [
  'created', 'origin_received', 'consolidation', 'in_flight', 'us_customs',
  'customs_cleared', 'at_us_hub', 'last_mile_labeled', 'out_for_delivery', 'completed',
]
export const CUSTOMS_STAGES = ['in_flight', 'us_customs', 'customs_cleared']
export const stageIndex = s => STAGES.indexOf(s)
export function nextStage(stage) {
  const i = stageIndex(stage)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

/** DHL Express checkpoint codes -> KargoPazar stages (WC was the v0.9.1 gap, fixed in v0.9.2). */
export const DHL_EVENT_MAP = {
  PU: 'origin_received', PL: 'consolidation', DF: 'in_flight', AF: 'in_flight', AR: 'us_customs',
  CR: 'us_customs', CC: 'customs_cleared', RD: 'at_us_hub', WC: 'out_for_delivery', OK: 'completed',
}
export function mapCarrierEvent(code) {
  const c = String(code || '').trim().toUpperCase()
  return DHL_EVENT_MAP[c] ? { code: c, stage: DHL_EVENT_MAP[c] } : null
}

// ---------------------------------------------------------------------------
// Countries, points, flights, FX
// ---------------------------------------------------------------------------

export function originCountries() {
  return db.all('countries').filter(c => c.active !== false && (c.role === 'origin' || c.role === 'both'))
}

export function countryConfig(code) {
  return db.all('countries').find(c => c.code === code) || COUNTRY_PRESETS.find(c => c.code === code) || null
}

function hubByCode(code) { return db.all('hubs').find(h => h.code === code) || null }

function virtualPoint(country) {
  const code = `${country.code}-CP`
  const n = country.name || {}
  return {
    code, type: 'origin_point', country: country.code, virtual: true,
    name: { tr: `${n.tr || country.code} Konsolidasyon Noktası`, en: `${n.en || country.code} Consolidation Point` },
    address: null, airports: [`${country.code}X`], flights: [], active: true,
  }
}

export function originPointsFor(code) {
  const c = countryConfig(code)
  if (!c) return []
  const byCountry = db.all('hubs').filter(h => h.country === code && (h.type === 'origin_point' || h.type === 'origin_network') && h.active !== false)
  const listed = (c.originPoints || []).map(hubByCode).filter(Boolean)
  const pts = [...new Map([...listed, ...byCountry].map(h => [h.code, h])).values()]
  return pts.length ? pts : [virtualPoint(c)]
}

/** The physical consolidation point (collection networks feed one). */
export function consolidationPointFor(origin, originPoint) {
  const pts = originPointsFor(origin)
  const chosen = pts.find(p => p.code === originPoint)
  if (chosen && chosen.type === 'origin_point') return chosen
  return pts.find(p => p.type === 'origin_point') || chosen || pts[0] || null
}

/** Collection partner for pickups (UK: Evri network, TR: courier, others: local courier). */
export function pickupPartnerFor(origin) {
  const net = originPointsFor(origin).find(p => p.type === 'origin_network')
  if (net) return { code: net.partnerCarrier || 'EVRI', kind: 'network', point: net.code }
  return { code: 'COURIER', kind: 'courier', point: null }
}

const AIRLINE_PREFIX = { BA: '125', TK: '235', LH: '020', AC: '014', AF: '057', KL: '074', QF: '081', D0: '615' }
const DEST_AIRPORT = { NJ01: 'JFK', LA01: 'LAX' }
const EXTRA_FLIGHTS = { 'FRA-LAX': 'LH 456 FRA-LAX', 'LHR-LAX': 'BA 283 LHR-LAX', 'IST-LAX': 'TK 009 IST-LAX' }

export function flightFor(consolidationCode, destHub = 'NJ01') {
  const hub = hubByCode(consolidationCode)
  const to = DEST_AIRPORT[destHub] || 'JFK'
  const from = hub?.airports?.[0] || String(consolidationCode || 'XXX').slice(0, 3)
  const flights = hub?.flights || []
  let flight = flights.find(f => f.endsWith(`${from}-${to}`)) || EXTRA_FLIGHTS[`${from}-${to}`]
  if (!flight) {
    const airline = flights[0]?.split(' ')[0] || 'D0'
    flight = `${airline} ${to === 'LAX' ? 921 : 920} ${from}-${to}`
  }
  const airline = flight.split(' ')[0]
  return { flight, route: `${from}-${to}`, airline, mawbPrefix: AIRLINE_PREFIX[airline] || '615', from, to }
}

export function newMawb(prefix, seed) {
  const rng = mulberry32(hashSeed(`mawb|${seed}`))
  let d = ''
  for (let i = 0; i < 8; i++) d += Math.floor(rng() * 10)
  return `${prefix}-${d}`
}

export function fxRate(currency) {
  if (!currency || currency === 'USD') return 1
  const c = db.all('countries').find(x => x.currency === currency) || COUNTRY_PRESETS.find(x => x.currency === currency)
  return c?.fxToUsd ?? 1
}
/** Demo FX conversion, rounded to 2 decimals (TR-04 regression). */
export function toUsdDemo(amount, currency) { return round2((Number(amount) || 0) * fxRate(currency)) }
export function fromUsdDemo(usd, currency) { return round2((Number(usd) || 0) / (fxRate(currency) || 1)) }

// ---------------------------------------------------------------------------
// Address and postcode (origin formats)
// ---------------------------------------------------------------------------

export function normalizePostcode(country, value) {
  let v = String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  const compact = v.replace(/\s/g, '')
  if (country === 'GB' && compact.length >= 5 && compact.length <= 7) v = compact.slice(0, -3) + ' ' + compact.slice(-3)
  else if (country === 'CA' && compact.length === 6) v = compact.slice(0, 3) + ' ' + compact.slice(3)
  else if (country === 'NL' && compact.length === 6) v = compact.slice(0, 4) + ' ' + compact.slice(4)
  return v
}

export function validatePostcodeFor(country, value) {
  const cfg = countryConfig(country)
  const normalized = normalizePostcode(country, value)
  return { value: normalized, valid: !!normalized && validatePostcode(cfg, normalized) }
}

/** TR AddressForm stores ilce in `city` and il in `state`; the country format calls ilce `district`. */
export function originAddressValue(address, key) {
  const a = address || {}
  if (key === 'district') return a.district || a.city || ''
  return a[key] ?? ''
}

export function validateOriginAddress(country, address) {
  const cfg = countryConfig(country)
  const errors = {}
  const fields = cfg?.addressFormat?.fields || [{ key: 'name', required: true }, { key: 'line1', required: true }, { key: 'city', required: true }, { key: 'zip', required: true }]
  for (const f of fields) {
    if (f.required && !String(originAddressValue(address, f.key)).trim()) errors[f.key] = 'required'
  }
  if (!errors.zip && address?.zip && !validatePostcodeFor(country, address.zip).valid) errors.zip = 'zip'
  return { valid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Country rules (de minimis, prohibited HS prefixes, missing data)
// ---------------------------------------------------------------------------

export function checkCountryRules({ origin, items = [], valueUsd = 0 } = {}) {
  const out = []
  const us = countryConfig('US')
  const org = countryConfig(origin)
  const dm = us?.deMinimis || { amount: 800, currency: 'USD' }
  if (valueUsd > dm.amount) out.push({ code: 'de_minimis_exceeded', severity: 'warning', params: { amount: dm.amount, currency: dm.currency, value: round2(valueUsd) } })
  else out.push({ code: 'de_minimis_ok', severity: 'ok', params: { amount: dm.amount, currency: dm.currency, value: round2(valueUsd) } })
  const lists = [['US', us?.prohibited || []], [origin, org?.prohibited || []]]
  for (const it of items) {
    const digits = String(it.hsCode || '').replace(/\D/g, '')
    if (!digits) { out.push({ code: 'missing_hs', severity: 'error', params: { title: it.title || '-' } }); continue }
    for (const [cc, list] of lists) {
      const hit = list.find(p => (p.hsPrefixes || []).some(pre => digits.startsWith(String(pre).replace(/\D/g, ''))))
      if (hit) out.push({ code: 'prohibited', severity: 'error', params: { title: it.title || '-', hs: it.hsCode, country: cc, category: hit.category } })
    }
  }
  const noValue = items.filter(i => !(Number(i.unitValueLocal ?? i.unitValueUsd) > 0))
  if (noValue.length) out.push({ code: 'missing_value', severity: 'error', params: { n: noValue.length } })
  const form = valueUsd <= 400 ? 'cn22' : 'cn23'
  out.push({ code: form === 'cn22' ? 'form_cn22' : 'form_cn23', severity: 'info', params: { value: round2(valueUsd) } })
  return out
}

// ---------------------------------------------------------------------------
// Hub suggestion (AI: last mile destination states)
// ---------------------------------------------------------------------------

export function suggestHubFor(recipients = []) {
  const valid = recipients.filter(r => /^\d{5}/.test(String(r.zip || '')))
  let zones = { NJ01: 0, LA01: 0 }
  let share = { east: 0, west: 0 }
  let reasonCode = 'recipients'
  let sample = valid
  if (!valid.length) {
    // store at hub: use where recent demand came from (last 90 days of shipments)
    reasonCode = 'demand'
    const cutoff = Date.now() - 90 * 864e5
    sample = db.all('shipments').filter(s => s.to?.zip && new Date(s.createdAt).getTime() >= cutoff).map(s => s.to).slice(0, 400)
  }
  if (!sample.length) return { hub: db.doc('user')?.company?.defaultHub || 'NJ01', zones, share, reasonCode: 'default', n: 0, reason: { tr: 'Varsayılan merkez', en: 'Default hub' } }
  for (const r of sample) {
    const zn = zoneFor('NJ01', String(r.zip).slice(0, 5))
    const zl = zoneFor('LA01', String(r.zip).slice(0, 5))
    zones.NJ01 += zn
    zones.LA01 += zl
    if (zl < zn) share.west++
    else share.east++
  }
  const n = sample.length
  zones = { NJ01: round2(zones.NJ01 / n), LA01: round2(zones.LA01 / n) }
  const hub = zones.LA01 < zones.NJ01 ? 'LA01' : 'NJ01'
  const pct = Math.round(((hub === 'NJ01' ? share.east : share.west) / n) * 100)
  const fmtZ = (v, l) => (l === 'tr' ? String(v.toFixed(1)).replace('.', ',') : v.toFixed(1))
  const other = hub === 'NJ01' ? 'LA01' : 'NJ01'
  const reason = reasonCode === 'recipients'
    ? {
        tr: `Alıcıların %${pct}'i ${hub} tarafına daha yakın. Ortalama zone ${hub}: ${fmtZ(zones[hub], 'tr')}, ${other}: ${fmtZ(zones[other], 'tr')}.`,
        en: `${pct}% of recipients are closer to ${hub}. Average zone ${hub}: ${fmtZ(zones[hub], 'en')}, ${other}: ${fmtZ(zones[other], 'en')}.`,
      }
    : {
        tr: `Son 90 günün talebinin %${pct}'i ${hub} bölgesinden. Ortalama zone ${hub}: ${fmtZ(zones[hub], 'tr')}, ${other}: ${fmtZ(zones[other], 'tr')}.`,
        en: `${pct}% of the last 90 days of demand is on the ${hub} side. Average zone ${hub}: ${fmtZ(zones[hub], 'en')}, ${other}: ${fmtZ(zones[other], 'en')}.`,
      }
  return { hub, zones, share, reasonCode, n, pct, reason }
}

// ---------------------------------------------------------------------------
// Draft math and pricing
// ---------------------------------------------------------------------------

export const kgToLb = kg => Math.round((Number(kg) || 0) * LB_PER_KG * 100) / 100
export const cmToIn = cm => Math.round((Number(cm) || 0) * IN_PER_CM * 10) / 10
export const volumetricKgOf = p => round2(((Number(p.lengthCm) || 0) * (Number(p.widthCm) || 0) * (Number(p.heightCm) || 0)) / 6000)

export function draftTotals(draft) {
  const parcels = draft.parcels || []
  const currency = countryConfig(draft.origin)?.currency || 'USD'
  let weightKg = 0, volKg = 0, valueLocal = 0, itemCount = 0
  for (const p of parcels) {
    weightKg += Number(p.weightKg) || 0
    volKg += volumetricKgOf(p)
    for (const it of p.items || []) {
      valueLocal += (Number(it.qty) || 0) * (Number(it.unitValueLocal) || 0)
      itemCount += Number(it.qty) || 0
    }
  }
  weightKg = Math.round(weightKg * 100) / 100
  valueLocal = round2(valueLocal)
  return { parcels: parcels.length, weightKg, volumetricKg: round2(volKg), valueLocal, currency, valueUsd: toUsdDemo(valueLocal, currency), itemCount, fxRate: fxRate(currency) }
}

/**
 * Itemized first mile price (spec 9.2 step 5).
 * -> { items: [{ code, amount, detail }], total, chargeableKg, airRatePerKg, etaDays, lastMileLabels, perLabel }
 */
export function quoteIntlDraft(draft) {
  const tot = draftTotals(draft)
  const rateCards = db.doc('rate_cards')
  const plan = db.doc('user')?.company?.plan || 'starter'
  const lastMile = draft.lastMile === 'direct' ? 'direct' : 'store'
  const base = firstMileQuote({
    origin: draft.origin, weightKg: tot.weightKg, parcels: Math.max(1, tot.parcels), volumetricKg: tot.volumetricKg,
    destHub: draft.destHub || 'NJ01', handover: draft.handover, lastMile: 'store', rateCards, plan,
  })
  let lastMileAmt = base.lastMile
  let labels = lastMile === 'store' ? 0 : Math.max(1, (draft.recipients || []).length)
  let perLabel = []
  let lastMileDays = 1
  if (lastMile === 'direct') {
    const recips = (draft.recipients || []).length ? draft.recipients : [null]
    const perKg = tot.weightKg / recips.length
    lastMileAmt = 0
    for (const r of recips) {
      const q = firstMileQuote({
        origin: draft.origin, weightKg: perKg, parcels: 1, destHub: draft.destHub || 'NJ01', handover: draft.handover,
        lastMile: 'direct', toZip: r?.zip, toState: r?.state, rateCards, plan,
      })
      lastMileAmt += q.lastMile
      perLabel.push({ zip: r?.zip || null, amount: q.lastMile })
      lastMileDays = Math.max(lastMileDays, q.lastMileQuote?.etaDays || 4)
    }
    lastMileAmt = round2(lastMileAmt)
  }
  const items = [
    { code: draft.handover === 'pickup' ? 'pickup' : 'dropoff', amount: base.pickup, detail: { n: base.parcels } },
    { code: 'consolidation', amount: base.consolidation, detail: { n: base.parcels } },
    { code: 'air_freight', amount: base.airFreight, detail: { kg: base.chargeableKg, rate: base.airRatePerKg } },
    { code: 'customs_fee', amount: base.customsFee, detail: { n: base.parcels } },
    { code: lastMile === 'direct' ? 'last_mile_direct' : 'last_mile_store', amount: lastMileAmt, detail: { n: lastMile === 'direct' ? labels : base.parcels } },
  ]
  const total = round2(items.reduce((s, i) => s + i.amount, 0))
  const firstMileDays = { GB: 5, TR: 6, DE: 5 }[draft.origin] || 7
  return {
    items, total, chargeableKg: base.chargeableKg, airRatePerKg: base.airRatePerKg, totals: tot,
    etaDays: firstMileDays + (lastMile === 'direct' ? lastMileDays : 1), lastMileLabels: labels, perLabel,
    pickup: base.pickup, consolidation: base.consolidation, airFreight: base.airFreight, customsFee: base.customsFee, lastMile: lastMileAmt,
  }
}

// ---------------------------------------------------------------------------
// Record builder (pure)
// ---------------------------------------------------------------------------

function addDays(iso, days) { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString() }

export function buildIntlRecord(draft, { id, now = nowIso(), quote = null } = {}) {
  const cfg = countryConfig(draft.origin)
  const currency = cfg?.currency || 'USD'
  const rate = fxRate(currency)
  const q = quote || quoteIntlDraft(draft)
  const parcels = (draft.parcels || []).map((p, i) => ({
    ref: `${id}-P${i + 1}`,
    lengthCm: +p.lengthCm, widthCm: +p.widthCm, heightCm: +p.heightCm, weightKg: +p.weightKg,
    items: (p.items || []).map(it => ({
      sku: it.sku || null,
      title: String(it.title || '').trim(),
      qty: Number(it.qty) || 1,
      unitValueLocal: round2(it.unitValueLocal),
      currency,
      unitValueUsd: toUsdDemo(it.unitValueLocal, currency),
      hsCode: it.hsCode,
      hsSource: it.hsSource || null,
      origin: it.origin || draft.origin,
      weightKg: it.weightKg != null && it.weightKg !== '' ? +it.weightKg : null,
    })),
  }))
  const tot = draftTotals(draft)
  const sender = { ...(draft.sender || {}), country: draft.origin }
  if (draft.origin === 'TR' && !sender.district) sender.district = sender.city || ''
  if (sender.zip) sender.zip = normalizePostcode(draft.origin, sender.zip)
  const form = tot.valueUsd <= 400 ? 'cn22' : 'cn23'
  const recipients = draft.lastMile === 'direct' ? (draft.recipients || []).map((r, i) => ({ idx: i + 1, name: r.name, company: r.company || '', line1: r.line1, line2: r.line2 || '', city: r.city, state: String(r.state || '').toUpperCase(), zip: String(r.zip || '').trim(), country: 'US', residential: r.residential !== false, orderId: r.orderId || null, score: r.score ?? null, shipmentId: null })) : []
  return {
    id,
    origin: draft.origin,
    originPoint: draft.originPoint,
    handover: draft.handover === 'pickup' ? 'pickup' : 'dropoff',
    sender,
    destHub: draft.destHub || 'NJ01',
    hubSuggestion: draft.hubSuggestion || null,
    lastMile: draft.lastMile === 'direct' ? 'direct' : 'store',
    recipients,
    parcels,
    parcelCount: parcels.length,
    totalWeightKg: tot.weightKg,
    volumetricKg: tot.volumetricKg,
    declaredValueLocal: tot.valueLocal,
    currency,
    declaredValueUsd: tot.valueUsd,
    fxRate: rate,
    contentType: draft.contentType || 'merchandise',
    stage: 'created',
    stageHistory: [{ stage: 'created', at: now }],
    createdAt: now,
    eta: addDays(now, q.etaDays),
    mawb: null,
    flight: null,
    route: null,
    manifestId: null,
    customsStatus: 'pending',
    customsDocs: ['commercial_invoice', form],
    dummyLabel: null,
    lastMileLabelCount: 0,
    lastMileShipmentIds: [],
    price: {
      pickup: q.pickup, consolidation: q.consolidation, airFreight: q.airFreight, customsFee: q.customsFee,
      lastMile: q.lastMile, total: q.total, chargeableKg: q.chargeableKg, airRatePerKg: q.airRatePerKg, items: q.items,
    },
    completedAt: null,
    createdBy: db.doc('user')?.name ?? null,
  }
}

// ---------------------------------------------------------------------------
// Stage transitions (pure)
// ---------------------------------------------------------------------------

function pointName(code) {
  const h = hubByCode(code)
  return h?.name || code
}

/**
 * Pure transition: returns the patch for `record` entering `stage` plus the timeline event.
 * ctx: { now, flight?: flightFor(...), mawb?, labels?: [{ id, trackingNo }], sandbox? }
 */
export function applyStage(record, stage, ctx = {}) {
  const now = ctx.now || nowIso()
  if (stageIndex(stage) < 0) throw new ApiError('INVALID_STAGE', 'Unknown stage', 422)
  const cons = consolidationPointFor(record.origin, record.originPoint)
  const patch = { stage }
  const event = { stage, at: now }
  switch (stage) {
    case 'origin_received':
      event.loc = record.handover === 'pickup' ? (record.origin === 'GB' ? 'EVRI' : 'COURIER') : record.originPoint
      event.point = record.originPoint
      break
    case 'consolidation':
      event.point = cons?.code || record.originPoint
      break
    case 'in_flight': {
      const fl = ctx.flight || flightFor(cons?.code, record.destHub)
      patch.flight = fl.flight
      patch.route = fl.route
      patch.mawb = ctx.mawb || record.mawb || newMawb(fl.mawbPrefix, record.id)
      event.flight = fl.flight
      event.mawb = patch.mawb
      break
    }
    case 'us_customs':
      patch.customsStatus = record.customsStatus === 'docs_requested' ? 'docs_requested' : 'submitted'
      event.port = (record.route || '').split('-')[1] || (record.destHub === 'LA01' ? 'LAX' : 'JFK')
      break
    case 'customs_cleared':
      if (record.customsStatus === 'docs_requested') throw new ApiError('CUSTOMS_DOCS_REQUIRED', 'Additional documents requested', 409)
      patch.customsStatus = 'cleared'
      break
    case 'at_us_hub':
      event.hub = record.destHub
      break
    case 'last_mile_labeled': {
      const labels = ctx.labels || []
      patch.lastMileLabelCount = labels.length
      patch.lastMileShipmentIds = labels.map(l => l.id).filter(Boolean)
      if (record.dummyLabel) {
        patch.dummyLabel = { ...record.dummyLabel, status: 'replaced', replacedAt: now, finalShipmentId: labels[0]?.id ?? null, finalTrackingNo: labels[0]?.trackingNo ?? null }
      }
      event.n = labels.length
      event.mode = record.lastMile
      break
    }
    case 'out_for_delivery':
      event.n = record.lastMileLabelCount || 0
      break
    case 'completed':
      patch.completedAt = now
      break
    default:
      break
  }
  patch.stageHistory = [...(record.stageHistory || []), event]
  return { patch, event }
}

// ---------------------------------------------------------------------------
// Manifest line, carrier adapter simulations (pure)
// ---------------------------------------------------------------------------

export function hawbFor(id) {
  const rng = mulberry32(hashSeed(`hawb|${id}`))
  let d = ''
  for (let i = 0; i < 7; i++) d += Math.floor(rng() * 10)
  return `KPH${d}`
}

export function buildHawbLine(r) {
  const items = (r.parcels || []).flatMap(p => p.items || [])
  const company = db.doc('user')?.company?.legalName || db.doc('user')?.company?.name || 'KargoPazar'
  const titles = [...new Set(items.map(i => i.title))]
  return {
    hawb: hawbFor(r.id),
    intlShipmentId: r.id,
    shipper: r.sender?.company || r.sender?.name || '-',
    consignee: `${company} c/o ${r.destHub}`,
    contents: titles.slice(0, 3).join(', '),
    hsCodes: [...new Set(items.map(i => i.hsCode).filter(Boolean))],
    valueUsd: round2(r.declaredValueUsd ?? items.reduce((s, i) => s + (i.unitValueUsd || 0) * i.qty, 0)),
    origin: r.origin,
    weightKg: r.totalWeightKg,
    parcels: r.parcelCount || (r.parcels || []).length,
  }
}

export function requestCollection(address, { seed = Date.now() } = {}) {
  const v = validateOriginAddress(address?.country || 'GB', address)
  if (!v.valid) throw new ApiError('VALIDATION', 'Invalid collection address', 422, v.errors)
  const rng = mulberry32(hashSeed(`evri|${seed}|${address.zip}`))
  let d = ''
  for (let i = 0; i < 8; i++) d += Math.floor(rng() * 10)
  const day = new Date(); day.setDate(day.getDate() + 1)
  return { ref: `EVR-${d}`, carrier: 'EVRI', window: { date: day.toISOString().slice(0, 10), from: '09:00', to: '13:00' }, postcode: normalizePostcode(address.country || 'GB', address.zip) }
}

export function airLegLabel(record, { seed = Date.now() } = {}) {
  const trackingNo = generateTrackingNo('DHLX', 'EXPRESS_WW', { seed: `${record.id}|${seed}` })
  return { trackingNo, carrier: 'DHLX', service: 'EXPRESS_WW', mawb: record.mawb || null }
}

// ---------------------------------------------------------------------------
// Recipients CSV
// ---------------------------------------------------------------------------

const CSV_ALIASES = {
  name: ['name', 'recipient', 'ad', 'ad soyad', 'alici', 'alıcı', 'full name'],
  company: ['company', 'sirket', 'şirket'],
  line1: ['line1', 'address', 'address1', 'address line 1', 'adres', 'adres1', 'street'],
  line2: ['line2', 'address2', 'address line 2', 'adres2', 'apt', 'suite'],
  city: ['city', 'sehir', 'şehir'],
  state: ['state', 'eyalet'],
  zip: ['zip', 'zipcode', 'zip code', 'postal code', 'postcode'],
  phone: ['phone', 'telefon'],
  orderId: ['order', 'orderid', 'order id', 'siparis', 'sipariş'],
}

export function recipientsCsvTemplate() {
  return 'name,company,line1,line2,city,state,zip,phone\r\n' +
    'Olivia Bennett,,1200 Pine St,Apt 4B,Seattle,WA,98101,+1 206 555 0110\r\n' +
    'Mateo Alvarez,,405 Congress Ave,,Austin,TX,78701,+1 512 555 0142\r\n' +
    'Harper Chen,Chen Studio,88 Court St,Suite 3,Brooklyn,NY,11201,\r\n'
}

function splitCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text ?? '').replace(/^﻿/, '')
  const first = s.split('\n')[0] || ''
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ','
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '))

export function validateRecipient(r) {
  const e = {}
  if (!String(r.name || '').trim()) e.name = 'required'
  if (!String(r.line1 || '').trim()) e.line1 = 'required'
  if (!String(r.city || '').trim()) e.city = 'required'
  if (!String(r.state || '').trim()) e.state = 'required'
  else if (!US_STATES.has(String(r.state).trim().toUpperCase())) e.state = 'state'
  if (!String(r.zip || '').trim()) e.zip = 'required'
  else if (!/^\d{5}(-\d{4})?$/.test(String(r.zip).trim())) e.zip = 'zip'
  return e
}

export function parseRecipientsCsv(text) {
  const rows = splitCsv(text)
  if (!rows.length) return { recipients: [], errors: [{ row: 0, field: 'file', code: 'empty' }], headers: [] }
  const headers = rows[0].map(h => h.trim().toLowerCase())
  const map = {}
  for (const [field, names] of Object.entries(CSV_ALIASES)) {
    const idx = headers.findIndex(h => names.includes(h))
    if (idx >= 0) map[field] = idx
  }
  const errors = []
  for (const f of ['name', 'line1', 'city', 'state', 'zip']) if (map[f] == null) errors.push({ row: 1, field: f, code: 'missing_column' })
  if (errors.length) return { recipients: [], errors, headers }
  const recipients = []
  rows.slice(1).forEach((cells, i) => {
    const r = {}
    for (const [f, idx] of Object.entries(map)) r[f] = String(cells[idx] ?? '').trim()
    r.state = r.state.toUpperCase()
    const e = validateRecipient(r)
    for (const [field, code] of Object.entries(e)) errors.push({ row: i + 2, field, code })
    if (!Object.keys(e).length) recipients.push({ ...r, residential: !r.company, source: 'csv' })
  })
  return { recipients, errors, headers, rowCount: rows.length - 1 }
}

// ---------------------------------------------------------------------------
// Draft validation
// ---------------------------------------------------------------------------

export function validateDraft(draft) {
  const e = {}
  const cfg = countryConfig(draft.origin)
  if (!cfg || !originCountries().some(c => c.code === draft.origin)) e.origin = 'required'
  if (!draft.originPoint) e.originPoint = 'required'
  const addr = validateOriginAddress(draft.origin, draft.sender)
  for (const [k, v] of Object.entries(addr.errors)) e[`sender.${k}`] = v
  if (!(draft.parcels || []).length) e.parcels = 'required'
  ;(draft.parcels || []).forEach((p, i) => {
    for (const k of ['lengthCm', 'widthCm', 'heightCm', 'weightKg']) if (!(Number(p[k]) > 0)) e[`parcels.${i}.${k}`] = 'number'
    if (!(p.items || []).length) e[`parcels.${i}.items`] = 'required'
    ;(p.items || []).forEach((it, j) => {
      if (!String(it.title || '').trim()) e[`parcels.${i}.items.${j}.title`] = 'required'
      if (!(Number(it.qty) >= 1)) e[`parcels.${i}.items.${j}.qty`] = 'number'
      if (!(Number(it.unitValueLocal) > 0)) e[`parcels.${i}.items.${j}.unitValueLocal`] = 'number'
      if (!/^\d{4}\.\d{2}$/.test(String(it.hsCode || ''))) e[`parcels.${i}.items.${j}.hsCode`] = it.hsCode ? 'hs' : 'required'
    })
  })
  if (!['NJ01', 'LA01'].includes(draft.destHub)) e.destHub = 'required'
  if (draft.lastMile === 'direct') {
    if (!(draft.recipients || []).length) e.recipients = 'required'
    ;(draft.recipients || []).forEach((r, i) => { for (const [k, v] of Object.entries(validateRecipient(r))) e[`recipients.${i}.${k}`] = v })
  }
  return e
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function matchesQuery(r, q) {
  if (!q) return true
  const s = q.toLowerCase()
  return [r.id, r.mawb, r.flight, r.sender?.name, r.sender?.company, r.dummyLabel?.ref, r.manifestId]
    .some(v => String(v || '').toLowerCase().includes(s))
}

export function filterIntl(list, p = {}) {
  const origins = [].concat(p.origin || []).filter(Boolean)
  const stages = [].concat(p.stage || []).filter(Boolean)
  const from = p.from ? new Date(p.from).getTime() : null
  const to = p.to ? new Date(p.to).getTime() : null
  return list.filter(r => {
    if (origins.length && !origins.includes(r.origin)) return false
    if (stages.length && !stages.includes(r.stage)) return false
    const t = new Date(r.createdAt).getTime()
    if (from != null && t < from) return false
    if (to != null && t > to) return false
    return matchesQuery(r, p.q)
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function listIntl(params = {}) {
  return request('GET /v1/intl/shipments', () => filterIntl(db.all('intl_shipments'), params), { minMs: 300, maxMs: 650 })
}

export function intlCounts() {
  const c = { all: 0, active: 0, customs: 0, completed: 0, docsRequested: 0, byStage: {}, byOrigin: {} }
  for (const r of db.all('intl_shipments')) {
    c.all++
    c.byStage[r.stage] = (c.byStage[r.stage] || 0) + 1
    c.byOrigin[r.origin] = (c.byOrigin[r.origin] || 0) + 1
    if (r.stage === 'completed') c.completed++
    else c.active++
    if (CUSTOMS_STAGES.includes(r.stage)) c.customs++
    if (r.customsStatus === 'docs_requested') c.docsRequested++
  }
  return c
}

function documentsFor(r) {
  const out = []
  const num = String(r.id).replace(/^INT-/, '')
  for (const type of r.customsDocs || []) {
    const prefix = { commercial_invoice: 'CI', cn22: 'CN22', cn23: 'CN23' }[type] || type.toUpperCase()
    out.push({ key: `${r.id}:${type}`, intlId: r.id, type, number: `${prefix}-${num}`, at: r.createdAt, origin: r.origin, valueUsd: r.declaredValueUsd, status: 'generated' })
  }
  if (r.dummyLabel) out.push({ key: `${r.id}:dummy_label`, intlId: r.id, type: 'dummy_label', number: r.dummyLabel.ref, at: r.dummyLabel.createdAt || r.createdAt, origin: r.origin, valueUsd: r.declaredValueUsd, status: r.dummyLabel.status === 'replaced' ? 'replaced' : 'active' })
  if (r.manifestId) {
    const m = db.get('manifests', r.manifestId)
    out.push({ key: `${r.id}:air_manifest`, intlId: r.id, type: 'air_manifest', number: r.manifestId, at: m?.createdAt || r.createdAt, origin: r.origin, valueUsd: r.declaredValueUsd, status: m?.status || 'created', manifestId: r.manifestId })
  }
  ;(r.customsRequest?.uploads || []).forEach((u, i) => {
    out.push({ key: `${r.id}:upload:${i}`, intlId: r.id, type: 'upload', number: u.name, name: u.name, at: u.at, origin: r.origin, valueUsd: r.declaredValueUsd, status: 'uploaded', hasFile: !!u.dataUrl, size: u.size })
  })
  return out
}

export function getIntlSync(id) {
  const r = db.get('intl_shipments', id)
  if (!r) return null
  const rec = plain(r)
  const items = (rec.parcels || []).flatMap(p => p.items || [])
  return {
    ...rec,
    stageIndex: stageIndex(rec.stage),
    next: nextStage(rec.stage),
    originPointInfo: plain(hubByCode(rec.originPoint)) || plain(originPointsFor(rec.origin).find(p => p.code === rec.originPoint)) || null,
    consolidation: plain(consolidationPointFor(rec.origin, rec.originPoint)),
    destHubInfo: plain(hubByCode(rec.destHub)),
    manifest: rec.manifestId ? plain(db.get('manifests', rec.manifestId)) : null,
    lastMileShipments: plain(db.all('shipments').filter(s => (rec.lastMileShipmentIds || []).includes(s.id) || s.intlId === rec.id)),
    documents: documentsFor(rec),
    rules: checkCountryRules({ origin: rec.origin, items, valueUsd: rec.declaredValueUsd }),
    hawb: buildHawbLine(rec),
  }
}

export function getIntl(id) {
  return request(`GET /v1/intl/shipments/${id}`, () => {
    const r = getIntlSync(id)
    if (!r) throw new ApiError('NOT_FOUND', 'International shipment not found', 404)
    return r
  }, { minMs: 250, maxMs: 550 })
}

export function listCatalog() {
  return request('GET /v1/products', () => {
    const rank = p => (!p.hsCode ? 0 : p.hsStatus === 'ai_pending' || p.hsSuggestion ? 1 : 2)
    return [...db.all('products')].sort((a, b) => rank(a) - rank(b) || String(a.sku).localeCompare(String(b.sku)))
  }, { minMs: 250, maxMs: 500 })
}

export function listRecipientOrders() {
  return request('GET /v1/orders?status=awaiting_shipment', () =>
    db.all('orders').filter(o => o.status === 'awaiting_shipment' && !o.intlId && o.shipTo?.country !== 'GB'), { minMs: 250, maxMs: 500 })
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createIntl(draft) {
  return request('POST /v1/intl/shipments', async () => {
    const d = plain(draft)
    if (d.sender?.zip) d.sender.zip = normalizePostcode(d.origin, d.sender.zip)
    const errors = validateDraft(d)
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid international shipment', 422, errors)
    const quote = quoteIntlDraft(d)
    const res = await db.transaction(() => {
      const id = db.nextId('INT')
      const rec = buildIntlRecord(d, { id, quote })
      const tot = rec.totalWeightKg
      db.insert('intl_shipments', rec)
      const w = chargeWallet({
        amount: quote.total, type: 'label',
        description: { tr: `İlk mil gönderisi · ${id} (${rec.origin} - ${rec.destHub}, ${rec.parcelCount} koli, ${tot} kg)`, en: `First mile shipment · ${id} (${rec.origin} - ${rec.destHub}, ${rec.parcelCount} parcels, ${tot} kg)` },
        meta: { intlId: id },
      })
      db.update('intl_shipments', id, { walletTxnId: w.transaction?.id ?? null })
      // Orders picked as recipients are reserved for this shipment
      for (const r of rec.recipients) if (r.orderId && db.get('orders', r.orderId)) db.update('orders', r.orderId, { intlId: id })
      return { intl: plain(db.get('intl_shipments', id)), transaction: w.transaction, topup: w.topup }
    })
    let intl = res.intl
    if (d.dummyLabel) {
      await createDummyLabel({ intlId: intl.id })
      intl = plain(db.get('intl_shipments', intl.id))
    }
    notify({
      type: 'success',
      title: { tr: `İlk mil gönderisi oluşturuldu: ${intl.id}`, en: `First mile shipment created: ${intl.id}` },
      body: { tr: `${intl.origin} menşeli, ${intl.parcelCount} koli, ${intl.destHub} varış. $${quote.total.toFixed(2)} cüzdandan düşüldü.`, en: `From ${intl.origin}, ${intl.parcelCount} parcels, arriving at ${intl.destHub}. $${quote.total.toFixed(2)} charged to the wallet.` },
      link: `/intl/${intl.id}`,
    })
    audit('intl.create', intl.id, `${intl.origin} ${intl.destHub} $${quote.total.toFixed(2)}`)
    return { intl, transaction: res.transaction, topup: res.topup, balance: db.doc('wallet').balance }
  }, { minMs: 700, maxMs: 1200 })
}

// ---------------------------------------------------------------------------
// Advance stage (demo) with side effects
// ---------------------------------------------------------------------------

const DEMO_RECIPIENTS = [
  { name: 'Olivia Bennett', line1: '1200 Pine St', line2: 'Apt 4B', city: 'Seattle', state: 'WA', zip: '98101' },
  { name: 'Mateo Alvarez', line1: '405 Congress Ave', line2: '', city: 'Austin', state: 'TX', zip: '78701' },
  { name: 'Harper Chen', line1: '88 Court St', line2: 'Suite 3', city: 'Brooklyn', state: 'NY', zip: '11201' },
  { name: 'Ethan Whitaker', line1: '233 S Wacker Dr', line2: '', city: 'Chicago', state: 'IL', zip: '60606' },
  { name: 'Nora Okafor', line1: '1 Faneuil Hall Sq', line2: '', city: 'Boston', state: 'MA', zip: '02109' },
  { name: 'Julian Kowalski', line1: '1600 Broadway', line2: 'Unit 12', city: 'Denver', state: 'CO', zip: '80202' },
]

function packageFor(rec, i, n) {
  const parcels = rec.parcels?.length ? rec.parcels : [{ lengthCm: 30, widthCm: 25, heightCm: 15, weightKg: rec.totalWeightKg || 2 }]
  const p = parcels[i % parcels.length]
  const share = Math.max(1, Math.ceil(n / parcels.length))
  return {
    lengthIn: Math.max(1, Math.round(cmToIn(p.lengthCm))),
    widthIn: Math.max(1, Math.round(cmToIn(p.widthCm))),
    heightIn: Math.max(1, Math.round(cmToIn(p.heightCm))),
    weightLb: Math.max(0.5, Math.round((kgToLb(p.weightKg) / share) * 10) / 10),
  }
}

async function createLastMileLabels(rec, onProgress) {
  let recipients = rec.recipients || []
  if (rec.lastMile === 'direct' && !recipients.length) {
    const n = Math.min(Math.max(1, rec.parcelCount || 1), 4)
    recipients = DEMO_RECIPIENTS.slice(0, n).map((r, i) => ({ ...r, idx: i + 1, country: 'US', residential: true, shipmentId: null, demo: true }))
  }
  const todo = recipients.filter(r => !r.shipmentId)
  const labels = recipients.filter(r => r.shipmentId).map(r => ({ id: r.shipmentId, trackingNo: r.trackingNo }))
  const perValue = recipients.length ? round2((rec.declaredValueUsd || 0) / recipients.length) : 0
  let done = 0
  for (const r of todo) {
    const pkg = packageFor(rec, r.idx - 1, recipients.length)
    const order = r.orderId ? db.get('orders', r.orderId) : null
    const useOrder = order && order.status === 'awaiting_shipment' && !order.shipmentId
    let res
    try {
      res = await createShipment({
        orderId: useOrder ? order.id : undefined,
        to: useOrder ? undefined : { name: r.name, company: r.company || '', line1: r.line1, line2: r.line2 || '', city: r.city, state: r.state, zip: r.zip, country: 'US', residential: r.residential !== false },
        pkg, hub: rec.destHub, ignoreHubRule: true, declaredValue: Math.min(perValue, 100), insured: false,
        reference: rec.id, source: 'intl', allowHeld: true,
      })
    } catch (e) {
      rec.recipients = recipients
      db.update('intl_shipments', rec.id, { recipients })
      throw new ApiError('LAST_MILE_FAILED', 'Last mile label failed', e.status || 409, { created: labels.length, total: recipients.length, cause: e.code || 'ERROR', causeDetails: e.details || null })
    }
    const s = res.shipment
    db.update('shipments', s.id, { intlId: rec.id })
    // The last mile was prepaid with the first mile shipment: offset the label charge.
    if (s.walletCharge > 0) {
      creditWallet({
        amount: s.walletCharge, type: 'refund', shipmentId: s.id,
        description: { tr: `Son mil ön ödemeli · ${rec.id} kapsamında (${s.id})`, en: `Last mile prepaid · covered by ${rec.id} (${s.id})` },
        meta: { intlId: rec.id },
      })
    }
    r.shipmentId = s.id
    r.trackingNo = s.trackingNo
    labels.push({ id: s.id, trackingNo: s.trackingNo })
    done++
    onProgress?.(Math.round((done / todo.length) * 100), { done, total: todo.length, shipmentId: s.id })
  }
  db.update('intl_shipments', rec.id, { recipients })
  return labels
}

function upsertAirManifest(rec, patch) {
  const line = buildHawbLine({ ...rec, ...patch })
  const hub = rec.destHub
  const existing = db.all('manifests').find(m => m.type === 'air_customs' && m.mawb === patch.mawb)
  if (existing) {
    const hawbs = [...(existing.hawbs || []).filter(h => h.intlShipmentId !== rec.id), line]
    db.update('manifests', existing.id, { hawbs, totals: manifestTotals(hawbs) })
    return existing.id
  }
  const id = db.nextId('MNF')
  const hawbs = [line]
  db.insert('manifests', {
    id, type: 'air_customs', hub, origin: rec.origin, mawb: patch.mawb, flight: patch.flight, route: patch.route,
    createdAt: nowIso(), status: 'created', hawbs, totals: manifestTotals(hawbs), shipmentIds: [], intlShipmentIds: [rec.id],
    createdBy: db.doc('user')?.name ?? null,
  })
  return id
}

function manifestTotals(hawbs) {
  return {
    parcels: hawbs.reduce((s, h) => s + (h.parcels || 0), 0),
    weightKg: Math.round(hawbs.reduce((s, h) => s + (h.weightKg || 0), 0) * 10) / 10,
    valueUsd: round2(hawbs.reduce((s, h) => s + (h.valueUsd || 0), 0)),
  }
}

function syncManifestStatus(manifestId) {
  const m = manifestId ? db.get('manifests', manifestId) : null
  if (!m) return
  const ids = (m.hawbs || []).map(h => h.intlShipmentId)
  const recs = ids.map(i => db.get('intl_shipments', i)).filter(Boolean)
  const minIdx = Math.min(...recs.map(r => stageIndex(r.stage)))
  let status = m.status
  if (minIdx >= stageIndex('customs_cleared')) status = 'customs_cleared'
  else if (recs.some(r => stageIndex(r.stage) >= stageIndex('us_customs'))) status = 'customs_submitted'
  if (status !== m.status) db.update('manifests', m.id, { status, [`${status}At`]: nowIso() })
}

export function advanceStage(id, { onProgress } = {}) {
  return request(`POST /v1/intl/shipments/${id}/advance`, async () => {
    const r = db.get('intl_shipments', id)
    if (!r) throw new ApiError('NOT_FOUND', 'International shipment not found', 404)
    const next = nextStage(r.stage)
    if (!next) throw new ApiError('ALREADY_COMPLETED', 'Shipment already completed', 409)
    const rec = plain(r)
    const ctx = { now: nowIso() }
    let labels = []
    if (next === 'last_mile_labeled' && rec.lastMile === 'direct') {
      const ids = await createLastMileLabels(rec, onProgress)
      labels = ids
      ctx.labels = ids
    } else if (next === 'last_mile_labeled') {
      ctx.labels = []
    }
    const fresh = plain(db.get('intl_shipments', id))
    const { patch, event } = applyStage(fresh, next, ctx)
    const dummyPatch = patch.dummyLabel
    delete patch.dummyLabel
    db.update('intl_shipments', id, patch)

    if (next === 'in_flight') {
      const manifestId = upsertAirManifest(fresh, patch)
      db.update('intl_shipments', id, { manifestId })
    }
    if (next === 'us_customs' || next === 'customs_cleared') syncManifestStatus(db.get('intl_shipments', id).manifestId)
    if (next === 'last_mile_labeled' && fresh.dummyLabel) {
      await markDummyReplaced({ intlId: id }, { finalShipmentId: dummyPatch?.finalShipmentId || null, finalTrackingNo: dummyPatch?.finalTrackingNo || `HUB-${rec.destHub}-${id.replace(/\D/g, '')}` })
    }
    if (next === 'out_for_delivery') {
      const ships = (fresh.lastMileShipmentIds || [])
      await Promise.all(ships.map(async sid => {
        try { await advanceTracking(sid); await advanceTracking(sid) } catch { /* final or voided labels are skipped */ }
      }))
    }
    if (next === 'completed') {
      // Completing the first mile means every last mile label reached its recipient: scan to delivered.
      const ships = (fresh.lastMileShipmentIds || [])
      await Promise.all(ships.map(async sid => {
        for (let i = 0; i < 12; i++) {
          const s = db.get('shipments', sid)
          if (!s || ['delivered', 'voided', 'returned'].includes(s.status)) break
          try { await advanceTracking(sid) } catch { break }
        }
      }))
    }

    const titles = {
      origin_received: ['Menşe noktasında kabul edildi', 'Received at origin point'],
      consolidation: ['Konsolidasyona alındı', 'Moved to consolidation'],
      in_flight: [`Hava kargoda: ${patch.flight || ''}`, `In flight: ${patch.flight || ''}`],
      us_customs: ['ABD gümrüğüne sunuldu', 'Submitted to US customs'],
      customs_cleared: ['Gümrükten çekildi', 'Cleared US customs'],
      at_us_hub: [`${rec.destHub} merkezine ulaştı`, `Arrived at ${rec.destHub}`],
      last_mile_labeled: [`Son mil etiketleri basıldı (${labels.length})`, `Last mile labels printed (${labels.length})`],
      out_for_delivery: ['Son mil teslimatında', 'Out for last mile delivery'],
      completed: ['Tamamlandı', 'Completed'],
    }[next]
    if (['in_flight', 'us_customs', 'customs_cleared', 'last_mile_labeled', 'completed'].includes(next)) {
      notify({ type: next === 'completed' ? 'success' : 'info', title: { tr: `${id}: ${titles[0]}`, en: `${id}: ${titles[1]}` }, link: `/intl/${id}` })
    }
    audit('intl.advance', id, next)
    return { intl: getIntlSync(id), stage: next, event, labels: plain(labels.map(l => db.get('shipments', l.id)).filter(Boolean)) }
  }, { minMs: 450, maxMs: 850 })
}

// ---------------------------------------------------------------------------
// Customs (9.3)
// ---------------------------------------------------------------------------

export function uploadCustomsDocs(id, files = []) {
  return request(`POST /v1/intl/shipments/${id}/customs-documents`, () => {
    const r = db.get('intl_shipments', id)
    if (!r) throw new ApiError('NOT_FOUND', 'International shipment not found', 404)
    if (r.customsStatus !== 'docs_requested') throw new ApiError('NO_DOCS_REQUESTED', 'No documents requested', 409)
    const needed = (r.customsRequest?.docs || []).length
    const byIdx = new Set(files.map(f => f.docIndex))
    const missing = []
    for (let i = 0; i < needed; i++) if (!byIdx.has(i)) missing.push(i)
    if (missing.length) throw new ApiError('VALIDATION', 'Missing documents', 422, Object.fromEntries(missing.map(i => [`doc.${i}`, 'required'])))
    const at = nowIso()
    const uploads = files.map(f => ({ docIndex: f.docIndex, name: f.name, size: f.size, type: f.type || '', at, dataUrl: f.dataUrl && f.dataUrl.length < 450000 ? f.dataUrl : null }))
    db.update('intl_shipments', id, {
      customsStatus: 'submitted',
      customsRequest: { ...r.customsRequest, uploads: [...(r.customsRequest?.uploads || []), ...uploads], resolvedAt: at },
      stageHistory: [...(r.stageHistory || []), { stage: r.stage, at, kind: 'docs_uploaded', n: uploads.length }],
    })
    notify({ type: 'success', title: { tr: `${id}: ek gümrük belgeleri yüklendi`, en: `${id}: additional customs documents uploaded` }, body: { tr: `${uploads.length} belge CBP'ye iletildi, gönderi gümrük incelemesinde.`, en: `${uploads.length} documents sent to CBP, the shipment is under customs review.` }, link: `/intl/${id}` })
    audit('customs.upload', id, uploads.map(u => u.name).join(', '))
    return getIntlSync(id)
  }, { minMs: 700, maxMs: 1200 })
}

export function listCustomsDocuments(p = {}) {
  return request('GET /v1/customs/documents', () => {
    let list = db.all('intl_shipments').flatMap(r => documentsFor(plain(r)))
    const types = [].concat(p.type || []).filter(Boolean)
    const origins = [].concat(p.origin || []).filter(Boolean)
    if (types.length) list = list.filter(d => types.includes(d.type))
    if (origins.length) list = list.filter(d => origins.includes(d.origin))
    if (p.q) { const s = p.q.toLowerCase(); list = list.filter(d => [d.number, d.intlId, d.name].some(v => String(v || '').toLowerCase().includes(s))) }
    return list.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, { minMs: 300, maxMs: 600 })
}

async function customsEngineItems(rec) {
  const mod = await loadOptional('customs')
  const fn = mod?.normalizeDescription || mod?.normalizeCustomsDescription
  if (typeof fn !== 'function') return null
  try {
    const items = []
    for (const p of rec.parcels || []) for (const it of p.items || []) {
      const d = fn(it.title, it.hsCode)
      items.push({ ...it, customsDescription: typeof d === 'string' ? d : (d?.description || it.title) })
    }
    return items
  } catch { return null }
}

export async function customsDataFor(rec) {
  const docs = await docsModule()
  const normalized = await customsEngineItems(rec)
  const src = normalized ? { ...rec, parcels: [{ items: normalized }], parcelCount: rec.parcelCount } : rec
  const us = countryConfig('US')
  return docs.buildCustomsData(src, { deMinimis: { threshold: us?.deMinimis?.amount ?? 800, currency: 'USD', exceeded: (rec.declaredValueUsd || 0) > (us?.deMinimis?.amount ?? 800) } })
}

export function downloadCustomsDocument(key) {
  return request(`GET /v1/customs/documents/${key}`, async () => {
    const [intlId, type, idx] = String(key).split(':')
    const r = db.get('intl_shipments', intlId)
    if (!r) throw new ApiError('NOT_FOUND', 'Document not found', 404)
    const rec = plain(r)
    const docs = await docsModule()
    if (type === 'dummy_label') return docs.downloadDummyLabel(rec)
    if (type === 'air_manifest') {
      const m = db.get('manifests', rec.manifestId)
      if (!m) throw new ApiError('NOT_FOUND', 'Manifest not found', 404)
      return docs.downloadManifest(plain(m))
    }
    if (type === 'upload') {
      const u = rec.customsRequest?.uploads?.[Number(idx)]
      if (!u?.dataUrl) throw new ApiError('FILE_NOT_STORED', 'File content not stored', 404)
      const a = document.createElement('a')
      a.href = u.dataUrl
      a.download = u.name
      document.body.appendChild(a); a.click(); a.remove()
      return u.name
    }
    const data = await customsDataFor(rec)
    if (type === 'commercial_invoice') return docs.downloadCommercialInvoice(data)
    if (type === 'cn22') return docs.downloadCn22(data)
    if (type === 'cn23') return docs.downloadCn23(data)
    if (type === 'bundle') return docs.downloadCustomsBundle(data)
    throw new ApiError('NOT_FOUND', 'Unknown document type', 404)
  }, { minMs: 250, maxMs: 500 })
}

export function listAirManifests() {
  return request('GET /v1/manifests?type=air_customs', async () => {
    const mod = await loadOptional('manifests')
    if (typeof mod?.listManifests === 'function') {
      try {
        const list = await mod.listManifests({ type: 'air_customs' })
        if (Array.isArray(list)) return list.filter(m => m.type === 'air_customs')
      } catch { /* fall back to the collection */ }
    }
    return db.all('manifests').filter(m => m.type === 'air_customs').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }, { minMs: 300, maxMs: 600 })
}

export function downloadAirManifest(id) {
  return request(`GET /v1/manifests/${id}/pdf`, async () => {
    const m = db.get('manifests', id)
    if (!m) throw new ApiError('NOT_FOUND', 'Manifest not found', 404)
    const docs = await docsModule()
    return docs.downloadManifest(plain(m))
  }, { minMs: 200, maxMs: 400 })
}

export function customsQueue() {
  return request('GET /v1/customs/queue', () =>
    db.all('intl_shipments')
      .filter(r => CUSTOMS_STAGES.includes(r.stage) || r.customsStatus === 'docs_requested')
      .map(r => ({ ...plain(r), hawb: hawbFor(r.id) }))
      .sort((a, b) => (a.customsStatus === 'docs_requested' ? -1 : 0) - (b.customsStatus === 'docs_requested' ? -1 : 0) || stageIndex(b.stage) - stageIndex(a.stage)),
  { minMs: 300, maxMs: 600 })
}

/** Sync helper for previews in the create wizard (no request log). */
export function carriersFor(origin) {
  const cfg = countryConfig(origin)
  const all = db.all('carriers').length ? db.all('carriers') : CARRIERS
  return (cfg?.carriers || []).map(k => {
    const [c, s] = k.split('-')
    const carrier = all.find(x => x.code === c)
    return carrier ? { carrier: c, service: s, name: carrier.name, serviceName: carrier.services?.find(x => x.code === s)?.name || s } : null
  }).filter(Boolean)
}

/** Sandbox quote for the integration tests (rate engine, no db writes). */
export function sandboxQuote(carrier, service, { hub = 'NJ01', toZip = '10001', weightLb = 3 } = {}) {
  const carriers = db.all('carriers').length ? plain(db.all('carriers')) : CARRIERS
  return quoteService({ carriers, carrier, service, hub, toZip, pkg: { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb }, rateCards: plain(db.doc('rate_cards')), plan: db.doc('user')?.company?.plan || 'starter', dynamicOverrides: null })
}
