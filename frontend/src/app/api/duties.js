/**
 * Duty rate table (Settings > Customs rates). Demo rates per HS code and destination
 * (hs_duty_rates): base duty, origin based additional duty, sales tax / VAT and processing fees.
 *
 *   listDutyRates({ dest?, q? }) -> [DutyRate] sorted by HS code
 *   saveDutyRate(id, { baseRate, originSurcharges, salesTaxRate, fees: { fixed, pct, min, max } }) -> DutyRate
 *   DutyRate = { id, hsCode, dest, baseRate, originSurcharges: { TR? }, salesTaxRate, fees, currency, note, updatedAt, hsDesc }
 * Rates are fractions (0.098 = 9.8%), fee amounts are in the destination currency.
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit } from '../store/events.js'
import { describe as hsDescribe } from '../ai/hsModel.js'
import { resolveDates } from '../store/db.js'
import seedRates from '../data/seed/hs_duty_rates.json'

const plain = v => JSON.parse(JSON.stringify(v))

function ensureRates() {
  // older server states may not have the collection yet: start from the bundled seed
  if (!db.all('hs_duty_rates').length) db.set('hs_duty_rates', resolveDates(plain(seedRates)))
  return db.all('hs_duty_rates')
}

export function listDutyRates({ dest, q } = {}) {
  return request('GET /v1/customs/duty-rates', () => {
    const s = String(q || '').trim().toLowerCase()
    return ensureRates()
      .filter(r => !dest || r.dest === dest)
      .map(r => ({ ...plain(r), hsDesc: hsDescribe(r.hsCode)?.desc || null }))
      .filter(r => !s || r.hsCode.includes(s) || [r.hsDesc?.tr, r.hsDesc?.en].some(x => String(x || '').toLowerCase().includes(s)))
      .sort((a, b) => a.hsCode.localeCompare(b.hsCode) || a.dest.localeCompare(b.dest))
  }, { minMs: 250, maxMs: 500 })
}

const rate = v => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 1e6) / 1e6 : null
}
const amount = v => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function saveDutyRate(id, patch = {}) {
  return request(`PATCH /v1/customs/duty-rates/${id}`, () => {
    ensureRates()
    const cur = db.get('hs_duty_rates', id)
    if (!cur) throw new ApiError('NOT_FOUND', 'Duty rate not found', 404)
    const errors = {}
    const next = {}
    if (patch.baseRate !== undefined) { const v = rate(patch.baseRate); if (v == null) errors.baseRate = 'range'; else next.baseRate = v }
    if (patch.salesTaxRate !== undefined) { const v = rate(patch.salesTaxRate); if (v == null) errors.salesTaxRate = 'range'; else next.salesTaxRate = v }
    if (patch.originSurcharges !== undefined) {
      const out = {}
      for (const [k, v] of Object.entries(patch.originSurcharges || {})) {
        if (v === '' || v == null) continue
        const r = rate(v)
        if (r == null) errors['originSurcharges.' + k] = 'range'
        else if (r > 0) out[k] = r
      }
      next.originSurcharges = out
    }
    if (patch.fees !== undefined) {
      const f = { ...(cur.fees || {}) }
      for (const k of ['fixed', 'min', 'max']) {
        if (patch.fees[k] === undefined) continue
        const v = amount(patch.fees[k]); if (v == null) errors['fees.' + k] = 'range'; else f[k] = v
      }
      if (patch.fees.pct !== undefined) { const v = rate(patch.fees.pct); if (v == null) errors['fees.pct'] = 'range'; else f.pct = v }
      if (f.min != null && f.max != null && f.min > f.max) errors['fees.max'] = 'minMax'
      next.fees = f
    }
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid duty rate', 422, errors)
    next.updatedAt = new Date().toISOString()
    const rec = db.update('hs_duty_rates', id, next)
    audit('customs.duty_rate.update', id, { tr: `${cur.hsCode} / ${cur.dest} gümrük oranı güncellendi`, en: `${cur.hsCode} / ${cur.dest} customs rate updated` })
    return { ...plain(rec), hsDesc: hsDescribe(rec.hsCode)?.desc || null }
  }, { minMs: 350, maxMs: 700 })
}
