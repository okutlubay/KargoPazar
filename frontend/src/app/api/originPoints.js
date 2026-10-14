/**
 * Türkiye origin points of the account (collection `origin_points`). Parcels are picked up at the
 * point (or dropped off at İstanbul), transferred to the gateway IST-CP and flown to a US hub;
 * see originPointFor() in ./rates.js for pricing.
 *
 * listOriginPoints(country = 'TR') -> OriginPoint[] (active, stored order)
 * addOriginPoint({ name, city, district?, line1, zip?, cutoff? }) -> OriginPoint   errors: VALIDATION (422, details)
 * removeOriginPoint(id) -> { ok }   only custom points; errors: NOT_FOUND, FORBIDDEN (preset points)
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit } from '../store/events.js'

const GATEWAY = 'IST-CP'
const GATEWAY_CITY = 'İstanbul'

export function listOriginPoints(country = 'TR') {
  return db.all('origin_points').filter(p => p.country === country && p.active !== false)
}

export function addOriginPoint(input) {
  return request('POST /v1/origin-points', () => {
    const name = String(input?.name ?? '').trim()
    const city = String(input?.city ?? '').trim()
    const line1 = String(input?.line1 ?? '').trim()
    const cutoff = String(input?.cutoff ?? '').trim() || '12:00'
    const errors = {}
    if (!name) errors.name = 'required'
    if (!city) errors.city = 'required'
    if (!line1) errors.line1 = 'required'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) errors.cutoff = 'time'
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid origin point', 422, errors)
    // Same city as the gateway: same day transfer; elsewhere one day domestic transfer.
    const sameCity = city.toLocaleLowerCase('tr') === GATEWAY_CITY.toLocaleLowerCase('tr')
    const point = {
      id: db.nextId('OPT'),
      country: 'TR',
      city,
      name: { tr: name, en: name },
      address: { line1, line2: '', district: String(input?.district ?? '').trim(), city, state: city, zip: String(input?.zip ?? '').trim(), country: 'TR' },
      gateway: GATEWAY,
      handover: 'pickup',
      transferDays: sameCity ? 0 : 1,
      cutoff,
      custom: true,
      active: true,
      createdAt: new Date().toISOString(),
    }
    db.insert('origin_points', point, { prepend: false })
    audit('origin_point.create', point.id, name)
    return point
  }, { minMs: 150, maxMs: 300 })
}

export function removeOriginPoint(id) {
  return request(`DELETE /v1/origin-points/${id}`, () => {
    const p = db.get('origin_points', id)
    if (!p) throw new ApiError('NOT_FOUND', 'Origin point not found', 404)
    if (!p.custom) throw new ApiError('FORBIDDEN', 'Preset origin points cannot be removed', 403)
    db.remove('origin_points', id)
    audit('origin_point.remove', id, p.name?.tr ?? id)
    return { ok: true }
  }, { minMs: 120, maxMs: 250 })
}
