/**
 * Landed cost (duties and taxes) estimation for the panel. Thin db wrapper around the pure engine in
 * shared/landedCost.js (the landing calculator calls the engine directly with seed JSON).
 *
 *   estimateLandedCost({ hsCode, origin = 'TR', dest = 'US', valueUsd, qty = 1, unitValueUsd?, incoterm = 'DDP' }) -> LandedCost
 *     valueUsd = TOTAL customs value of the line in USD (or pass unitValueUsd + qty).
 *     LandedCost = { lines: [{ key: 'duty'|'surcharge'|'tax'|'fee', labelKey, label ({tr,en}|null, fee name), rate, amountDest,
 *       amountUsd, waived }], totalUsd, totalDest, destCurrency, valueUsd, valueDest, hsCode, hsDesc, rateFound, note,
 *       deMinimis: { status: 'suspended'|'applied', amount, currency, thresholdUsd, applies, exceeded },
 *       prohibited: [{ side: 'import'|'export', country, category {tr,en}, prefix }], clearanceDays: { min, max },
 *       incoterm, incoterms: { DDP: { sellerUsd, buyerUsd }, DDU: { sellerUsd, buyerUsd, collectionFeeUsd } },
 *       sellerPaysUsd, buyerPaysUsd }
 *   estimateLandedCostMulti(items[], { dest, origin, incoterm }) -> per item results + aggregated lines and totals
 *     items: [{ hsCode, valueUsd | unitValueUsd + qty, qty, origin?, title?, sku? }]; de minimis and the processing
 *     fee are evaluated once on the shipment total.
 *   landedCostContext() -> { rates, countries, fx, hsCodes } (live db rows, seed fallback)
 *   prepaidDuty(customs, { dest = 'US', origin = 'TR' }) -> { incoterm, amountUsd, estimatedUsd, lines: [{ key, amountUsd }], missing }
 *     duties and taxes the seller prepays on a door-to-door shipment: customs.incoterm 'DDP' (default) -> the
 *     estimate, 'DDU' -> 0 (the buyer pays at the door). Lines without a valid HS code are skipped (missing).
 *     Used by the shipment wizard (payment step) and createShipment (wallet charge).
 * All sync (no latency): they run on every keystroke of the calculators.
 */
import { db } from '../store/db.js'
import { codes as hsCodeRows } from '../ai/hsModel.js'
import seedRates from '../data/seed/hs_duty_rates.json'
import { computeLandedCost, computeLandedCostMulti, normalizeHs } from '@/shared/landedCost.js'

export { LINE_LABEL_KEYS, DDU_COLLECTION_FEE_USD, normalizeHs } from '@/shared/landedCost.js'

const SEED_FX = { USD: 1, TRY: 41.6, EUR: 0.85, GBP: 0.74 }
let hsCache = null

export function landedCostContext() {
  const live = db.ready ? db.all('hs_duty_rates') : []
  const fxDoc = db.ready ? db.doc('fx') : null
  return {
    rates: live && live.length ? live : seedRates,
    countries: db.ready ? db.all('countries') : [],
    fx: fxDoc?.rates && Object.keys(fxDoc.rates).length ? fxDoc.rates : SEED_FX,
    hsCodes: hsCache || (hsCache = hsCodeRows()),
  }
}

export function estimateLandedCost(params) {
  return computeLandedCost(params || {}, landedCostContext())
}

export function estimateLandedCostMulti(items, opts = {}) {
  return computeLandedCostMulti(items || [], landedCostContext(), opts)
}

export function prepaidDuty(customs, { dest = 'US', origin = 'TR' } = {}) {
  const incoterm = customs?.incoterm === 'DDU' ? 'DDU' : 'DDP'
  const all = customs?.items ?? []
  const items = all.filter(i => normalizeHs(i.hsCode))
    .map(i => ({ hsCode: normalizeHs(i.hsCode), title: i.description, qty: Number(i.qty) || 1, unitValueUsd: Number(i.unitValue) || 0, origin: i.origin || origin }))
  const missing = all.filter(i => !normalizeHs(i.hsCode)).map(i => i.hsCode || null)
  if (!items.length) return { incoterm, amountUsd: 0, estimatedUsd: 0, lines: [], missing }
  const r = estimateLandedCostMulti(items, { dest, origin, incoterm })
  return {
    incoterm,
    amountUsd: r.sellerPaysUsd,
    estimatedUsd: r.totalUsd,
    lines: r.lines.filter(l => l.amountUsd > 0).map(l => ({ key: l.key, amountUsd: l.amountUsd })),
    missing: [...missing, ...r.missing],
  }
}
