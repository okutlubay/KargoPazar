/**
 * Landed cost engine (pure). No store access: duty rate rows, countries and FX rates are passed in,
 * so the landing calculator (seed JSON) and the panel (db, via app/api/landedCost.js) share one formula.
 *
 * computeLandedCost(params, ctx) -> LandedCost
 *   params = { hsCode, origin = 'TR', dest = 'US', valueUsd, qty = 1, unitValueUsd?, incoterm = 'DDP' }
 *     valueUsd is the TOTAL customs value of the line in USD. When it is missing, unitValueUsd * qty is used.
 *   ctx = { rates: hs_duty_rates rows, countries: country rows, fx: { USD: 1, TRY: 41.6, ... } (per USD), hsCodes?: hs_codes rows }
 *
 * LandedCost = {
 *   hsCode, hsDesc ({tr,en}|null), customsDesc, origin, dest, destCurrency, qty, valueUsd, valueDest,
 *   rateFound, rate (raw row|null), note ({tr,en}|null),
 *   lines: [{ key: 'duty'|'surcharge'|'tax'|'fee', labelKey, label ({tr,en}|null), rate (fraction|null), amountDest, amountUsd, waived }],
 *   totalUsd, totalDest,
 *   deMinimis: { status: 'suspended'|'applied', amount, currency, thresholdUsd, applies (exemption applies), exceeded },
 *   prohibited: [{ side: 'import'|'export', country, category {tr,en}, prefix }],
 *   clearanceDays: { min, max },
 *   incoterm, incoterms: { DDP: { sellerUsd, buyerUsd }, DDU: { sellerUsd, buyerUsd, collectionFeeUsd } },
 *   sellerPaysUsd, buyerPaysUsd,
 * }
 *
 * computeLandedCostMulti(items, ctx, { dest, origin, incoterm }) -> {
 *   items: [{ ...item, result: LandedCost }], lines (aggregated by key), totalUsd, totalDest, destCurrency, valueUsd,
 *   deMinimis (evaluated on the shipment total), prohibited, clearanceDays, incoterms, missing: [hsCode]
 * }
 * Processing fees (e.g. US MPF) are charged once per entry, so in the multi version they are computed on the
 * shipment total with min/max applied once and spread over lines pro rata.
 */

const r2 = v => Math.round((Number(v) || 0) * 100) / 100

// Typical clearance windows (business days) by destination, demo values.
const CLEARANCE = { US: { min: 1, max: 3 }, GB: { min: 1, max: 2 }, DE: { min: 1, max: 3 }, TR: { min: 2, max: 5 } }
// Carrier fee for collecting duties from the receiver when the shipment is DDU (USD, demo value).
export const DDU_COLLECTION_FEE_USD = 15

export const LINE_LABEL_KEYS = {
  duty: 'customsInfo.lines.duty',
  surcharge: 'customsInfo.lines.surcharge',
  tax: 'customsInfo.lines.tax',
  taxUs: 'customsInfo.lines.taxUs',
  fee: 'customsInfo.lines.fee',
}

export function normalizeHs(code) {
  const raw = String(code || '').trim()
  if (/^\d{4}\.\d{2}$/.test(raw)) return raw
  const d = raw.replace(/\D/g, '')
  return d.length >= 6 ? d.slice(0, 4) + '.' + d.slice(4, 6) : null
}

/** Units of `currency` per 1 USD. */
export function fxPerUsd(currency, fx, countries) {
  if (!currency || currency === 'USD') return 1
  const v = fx?.[currency]
  if (v) return Number(v)
  const c = (countries || []).find(x => x.currency === currency)
  return c?.fxToUsd ? 1 / Number(c.fxToUsd) : 1
}

function prefixHits(code, country, side) {
  const digits = String(code || '').replace(/\D/g, '')
  const out = []
  if (!digits || !country) return out
  for (const rule of country.prohibited || []) {
    const hit = (rule.hsPrefixes || []).find(p => digits.startsWith(p))
    if (hit) out.push({ side, country: country.code, category: rule.category, prefix: hit })
  }
  return out
}

export function deMinimisInfo(country, valueUsd, fx, countries) {
  const dm = country?.deMinimis || null
  if (!dm) return { status: 'applied', amount: null, currency: null, thresholdUsd: null, applies: false, exceeded: false, none: true }
  const suspended = dm.status === 'suspended'
  const thresholdUsd = r2(Number(dm.amount) / fxPerUsd(dm.currency, fx, countries))
  const exceeded = suspended || Number(valueUsd) > thresholdUsd
  return { status: suspended ? 'suspended' : 'applied', amount: dm.amount, currency: dm.currency, thresholdUsd, applies: !suspended && !exceeded, exceeded }
}

function findRate(rates, hsCode, dest) {
  const code = normalizeHs(hsCode)
  return code ? (rates || []).find(r => r.hsCode === code && r.dest === dest) || null : null
}

function feeAmount(fees, valueDest) {
  if (!fees) return 0
  let v = (Number(fees.fixed) || 0) + (Number(fees.pct) || 0) * valueDest
  if (fees.min != null) v = Math.max(v, Number(fees.min))
  if (fees.max != null) v = Math.min(v, Number(fees.max))
  return v
}

function incotermSplit(totalUsd, incoterm) {
  const DDP = { sellerUsd: r2(totalUsd), buyerUsd: 0 }
  const DDU = { sellerUsd: 0, buyerUsd: r2(totalUsd > 0 ? totalUsd + DDU_COLLECTION_FEE_USD : 0), collectionFeeUsd: totalUsd > 0 ? DDU_COLLECTION_FEE_USD : 0 }
  const pick = incoterm === 'DDU' ? DDU : DDP
  return { incoterms: { DDP, DDU }, sellerPaysUsd: pick.sellerUsd, buyerPaysUsd: pick.buyerUsd }
}

/** Core line computation. `opts.deMinimis` forces the de minimis result, `opts.skipFee` leaves the fee line out. */
function linesFor(row, { valueDest, origin, dest, perUsd, dmApplies, skipFee }) {
  const lines = []
  const mk = (key, rate, amountDest, extra = {}) => ({ key, labelKey: LINE_LABEL_KEYS[key === 'tax' && dest === 'US' ? 'taxUs' : key], label: null, rate, amountDest: r2(amountDest), amountUsd: r2(amountDest / perUsd), waived: false, ...extra })
  const base = Number(row.baseRate) || 0
  const dutyDest = dmApplies ? 0 : base * valueDest
  lines.push(mk('duty', base, dutyDest, { waived: dmApplies && base > 0 }))
  const sur = Number(row.originSurcharges?.[origin]) || 0
  if (sur > 0) lines.push(mk('surcharge', sur, dmApplies ? 0 : sur * valueDest, { waived: dmApplies }))
  const tax = Number(row.salesTaxRate) || 0
  // import VAT is levied on customs value + duties
  lines.push(mk('tax', tax, tax * (valueDest + (dmApplies ? 0 : (base + sur) * valueDest))))
  if (!skipFee && row.fees) lines.push(mk('fee', null, feeAmount(row.fees, valueDest), { label: row.fees.label || null }))
  return lines
}

export function computeLandedCost(params, ctx = {}, opts = {}) {
  const origin = params.origin || 'TR'
  const dest = params.dest || 'US'
  const qty = Number(params.qty) || 1
  const valueUsd = r2(params.valueUsd != null ? Number(params.valueUsd) : (Number(params.unitValueUsd) || 0) * qty)
  const incoterm = params.incoterm === 'DDU' ? 'DDU' : 'DDP'
  const countries = ctx.countries || []
  const destC = countries.find(c => c.code === dest) || null
  const origC = countries.find(c => c.code === origin) || null
  const hsCode = normalizeHs(params.hsCode)
  const row = findRate(ctx.rates, hsCode, dest)
  const destCurrency = row?.currency || destC?.currency || 'USD'
  const perUsd = fxPerUsd(destCurrency, ctx.fx, countries)
  const valueDest = valueUsd * perUsd
  const deMinimis = opts.deMinimis || deMinimisInfo(destC, valueUsd, ctx.fx, countries)
  const info = hsCode ? (ctx.hsCodes || []).find(h => h.code === hsCode) || null : null
  const lines = row ? linesFor(row, { valueDest, origin, dest, perUsd, dmApplies: deMinimis.applies, skipFee: opts.skipFee }) : []
  const totalDest = r2(lines.reduce((s, l) => s + l.amountDest, 0))
  const totalUsd = r2(lines.reduce((s, l) => s + l.amountUsd, 0))
  const prohibited = hsCode ? [...prefixHits(hsCode, destC, 'import'), ...prefixHits(hsCode, origC, 'export')] : []
  const base = CLEARANCE[dest] || { min: 2, max: 5 }
  const clearanceDays = { min: base.min + (incoterm === 'DDU' ? 1 : 0), max: base.max + (incoterm === 'DDU' ? 2 : 0) + (prohibited.length ? 3 : 0) }
  return {
    hsCode,
    hsDesc: info?.desc || null,
    customsDesc: info?.customsDesc || null,
    origin,
    dest,
    destCurrency,
    fxPerUsd: perUsd,
    qty,
    valueUsd,
    valueDest: r2(valueDest),
    rateFound: !!row,
    rate: row,
    note: row?.note || null,
    lines,
    totalUsd,
    totalDest,
    deMinimis,
    prohibited,
    clearanceDays,
    incoterm,
    ...incotermSplit(totalUsd, incoterm),
  }
}

export function computeLandedCostMulti(items, ctx = {}, { dest = 'US', origin = 'TR', incoterm = 'DDP' } = {}) {
  const countries = ctx.countries || []
  const norm = (items || []).map(it => {
    const qty = Number(it.qty) || 1
    const valueUsd = r2(it.valueUsd != null ? Number(it.valueUsd) : (Number(it.unitValueUsd) || 0) * qty)
    return { ...it, qty, valueUsd, origin: it.origin || origin, dest: it.dest || dest }
  })
  const valueUsd = r2(norm.reduce((s, i) => s + i.valueUsd, 0))
  const destC = countries.find(c => c.code === dest) || null
  const deMinimis = deMinimisInfo(destC, valueUsd, ctx.fx, countries)
  const results = norm.map(it => ({ ...it, result: computeLandedCost({ ...it, incoterm }, ctx, { deMinimis, skipFee: true }) }))
  const destCurrency = results.find(r => r.result.rateFound)?.result.destCurrency || destC?.currency || 'USD'
  const perUsd = fxPerUsd(destCurrency, ctx.fx, countries)
  // one processing fee per entry: the row of the highest value line decides the fee schedule
  const feeRow = results.filter(r => r.result.rateFound).sort((a, b) => b.valueUsd - a.valueUsd)[0]?.result.rate || null
  const feeDest = feeRow?.fees ? feeAmount(feeRow.fees, valueUsd * perUsd) : 0
  for (const r of results) {
    if (!feeRow?.fees || !r.result.rateFound) continue
    const share = valueUsd ? r.valueUsd / valueUsd : 0
    const amountDest = r2(feeDest * share)
    r.result.lines.push({ key: 'fee', labelKey: LINE_LABEL_KEYS.fee, label: feeRow.fees.label || null, rate: null, amountDest, amountUsd: r2(amountDest / perUsd), waived: false, shared: true })
    r.result.totalDest = r2(r.result.totalDest + amountDest)
    r.result.totalUsd = r2(r.result.totalUsd + amountDest / perUsd)
    Object.assign(r.result, incotermSplit(r.result.totalUsd, incoterm))
  }
  const agg = new Map()
  for (const r of results) {
    for (const l of r.result.lines) {
      const k = l.key
      const prev = agg.get(k)
      if (prev) { prev.amountDest = r2(prev.amountDest + l.amountDest); prev.amountUsd = r2(prev.amountUsd + l.amountUsd); prev.waived = prev.waived && l.waived; if (prev.rate !== l.rate) prev.rate = null }
      else agg.set(k, { ...l })
    }
  }
  const lines = [...agg.values()]
  const totalDest = r2(lines.reduce((s, l) => s + l.amountDest, 0))
  const totalUsd = r2(lines.reduce((s, l) => s + l.amountUsd, 0))
  const prohibited = results.flatMap(r => r.result.prohibited.map(p => ({ ...p, hsCode: r.result.hsCode, title: r.title || null })))
  const clearanceDays = results.reduce((m, r) => ({ min: Math.max(m.min, r.result.clearanceDays.min), max: Math.max(m.max, r.result.clearanceDays.max) }), { min: 0, max: 0 })
  return {
    items: results,
    lines,
    totalUsd,
    totalDest,
    destCurrency,
    fxPerUsd: perUsd,
    valueUsd,
    dest,
    origin,
    deMinimis,
    prohibited,
    clearanceDays,
    incoterm,
    missing: results.filter(r => !r.result.rateFound).map(r => r.result.hsCode || r.hsCode || null),
    ...incotermSplit(totalUsd, incoterm),
  }
}
