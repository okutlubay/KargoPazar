/**
 * Manifests API (spec 5.8): carrier handover manifests (USPS SCAN Form, FedEx / UPS / DHL eCommerce /
 * OnTrac / LSO end of day) and air cargo customs manifests for first mile shipments (MAWB + HAWB).
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * MANIFEST_FLOW = { carrier: ['created', 'handed_over'], air_customs: ['created', 'customs_submitted', 'customs_cleared'] }
 * listManifests({ type?, hub?, carrier?, status?, q?, from?, to? }) -> Manifest[] newest first (+ parcels, weightLb, label)
 * getManifest(id) -> Manifest & { shipments: Shipment[] (carrier), intl: IntlShipment[] (air), timeline: [{status, at}] }
 * manifestCandidates({ type: 'carrier', hub, carrier, date: 'YYYY-MM-DD' })
 *   -> { items: Shipment[], otherDates: [{ date, count }] }   unmanifested label_created labels of that day
 * manifestCandidates({ type: 'air_customs', hub, origin })
 *   -> { items: IntlShipment[], flights: string[] }           first mile shipments waiting at the origin point
 * airOrigins(hub?) -> [{ country, point, flights }]           (sync) origin points with flights to the hub
 * createManifest({ type:'carrier', hub, carrier, date?, shipmentIds })
 * createManifest({ type:'air_customs', hub, origin, flight, intlIds }) -> Manifest
 *   errors: VALIDATION (details), NOTHING_TO_MANIFEST, ALREADY_MANIFESTED
 * createManifestsForShipments(shipmentIds) -> Manifest[]      one carrier manifest per hub + carrier (after a batch)
 * updateManifestStatus(id, status) -> Manifest                air: created -> customs_submitted -> customs_cleared
 *   carrier handover is done from the Operations hub (api/ops.js markHandedOver), errors: INVALID_TRANSITION
 * cancelManifest(id) -> { removed }                          only status 'created'; labels become unmanifested again
 *
 * Internal (used by api/ops.js inside db.transaction): buildCarrierManifest(), handOverManifestRecords()
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { round2 } from '@/shared/rateEngine.js'

export const MANIFEST_FLOW = {
  carrier: ['created', 'handed_over'],
  air_customs: ['created', 'customs_submitted', 'customs_cleared'],
}
export const AIR_READY_STAGES = ['origin_received', 'consolidation']
const AIRPORT_HUB = { JFK: 'NJ01', EWR: 'NJ01', LAX: 'LA01' }
const AIRLINE_PREFIX = { TK: '235', BA: '125', LH: '020', AA: '001', DL: '006' }

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()

export function localYmd(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** IATA air waybill: 3 digit airline prefix + 7 digit serial + check digit (serial mod 7). */
export function generateMawb(flight, seed) {
  const airline = String(flight || '').split(' ')[0]
  const prefix = AIRLINE_PREFIX[airline] ?? '235'
  const serial = String(1000000 + (hashStr(String(seed)) % 8999999)).slice(0, 7)
  return `${prefix}-${serial}${Number(serial) % 7}`
}

function hawbFor(intlId) {
  return 'KPH' + String(1000000 + (hashStr('hawb' + intlId) % 8999999))
}

function formTypeFor(carrier) { return carrier === 'USPS' ? 'usps_scan_form' : 'end_of_day' }

function totalsForShipments(ships) {
  return {
    parcels: ships.length,
    weightLb: round2(ships.reduce((s, x) => s + (Number(x.package?.weightLb) || 0), 0)),
  }
}

function decorate(m) {
  const out = plain(m)
  if (m.type === 'air_customs') {
    out.parcels = m.totals?.parcels ?? (m.hawbs ?? []).reduce((s, h) => s + (h.parcels || 0), 0)
    out.weightKg = m.totals?.weightKg ?? 0
    out.weightLb = round2((out.weightKg || 0) * 2.20462)
    out.valueUsd = m.totals?.valueUsd ?? 0
  } else {
    out.parcels = m.totals?.parcels ?? (m.shipmentIds ?? []).length
    out.weightLb = m.totals?.weightLb ?? 0
  }
  return out
}

function timelineOf(m) {
  const flow = MANIFEST_FLOW[m.type === 'air_customs' ? 'air_customs' : 'carrier']
  const at = {
    created: m.createdAt,
    handed_over: m.handedOverAt ?? null,
    customs_submitted: m.submittedAt ?? (m.status !== 'created' && m.type === 'air_customs' ? m.createdAt : null),
    customs_cleared: m.clearedAt ?? (m.status === 'customs_cleared' ? (m.submittedAt ?? m.createdAt) : null),
  }
  const idx = flow.indexOf(m.status)
  return flow.map((status, i) => ({ status, at: i <= idx ? at[status] : null, done: i <= idx }))
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listManifests(p = {}) {
  return request('GET /v1/manifests', () => {
    let list = db.all('manifests')
    const inList = (v, x) => (Array.isArray(v) ? !v.length || v.includes(x) : !v || v === x)
    if (p.type && p.type !== 'all') list = list.filter(m => m.type === p.type)
    if (p.hub) list = list.filter(m => inList(p.hub, m.hub))
    if (p.carrier) list = list.filter(m => inList(p.carrier, m.carrier))
    if (p.status) list = list.filter(m => inList(p.status, m.status))
    if (p.from) list = list.filter(m => m.createdAt >= p.from)
    if (p.to) list = list.filter(m => m.createdAt <= p.to)
    if (p.q) {
      const q = String(p.q).trim().toLowerCase()
      list = list.filter(m => [m.id, m.mawb, m.flight, m.carrier, ...(m.shipmentIds ?? []), ...(m.hawbs ?? []).map(h => h.hawb)]
        .some(v => String(v ?? '').toLowerCase().includes(q)))
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(decorate)
  }, { minMs: 300, maxMs: 650 })
}

export function getManifest(id) {
  return request(`GET /v1/manifests/${id}`, () => {
    const m = db.get('manifests', id)
    if (!m) throw new ApiError('NOT_FOUND', 'Manifest not found', 404)
    const out = decorate(m)
    if (m.type === 'air_customs') {
      const ids = new Set((m.hawbs ?? []).map(h => h.intlShipmentId))
      out.intl = plain(db.all('intl_shipments').filter(s => ids.has(s.id)))
      out.shipments = []
    } else {
      const byId = new Map(db.all('shipments').map(s => [s.id, s]))
      out.shipments = (m.shipmentIds ?? []).map(sid => plain(byId.get(sid))).filter(Boolean)
      out.intl = []
    }
    out.timeline = timelineOf(m)
    return out
  }, { minMs: 250, maxMs: 550 })
}

export function airOrigins(hub = null) {
  return db.all('hubs')
    .filter(h => h.type === 'origin_point' && h.active !== false)
    .map(h => ({
      country: h.country,
      point: h.code,
      name: h.name,
      flights: (h.flights ?? []).filter(f => !hub || AIRPORT_HUB[String(f).split('-').pop()] === hub),
    }))
    .filter(o => !hub || o.flights.length)
}

function carrierCandidates({ hub, carrier, date }) {
  const base = db.all('shipments').filter(s => !s.test && s.hub === hub && s.carrier === carrier && !s.manifestId && s.status === 'label_created')
  const items = base.filter(s => !date || localYmd(s.createdAt) === date)
  const counts = {}
  for (const s of base) { const d = localYmd(s.createdAt); if (d !== date) counts[d] = (counts[d] ?? 0) + 1 }
  const otherDates = Object.entries(counts).map(([d, count]) => ({ date: d, count })).sort((a, b) => b.date.localeCompare(a.date))
  return { items: [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), otherDates }
}

function airCandidates({ hub, origin }) {
  const items = db.all('intl_shipments').filter(s => !s.manifestId && AIR_READY_STAGES.includes(s.stage) && (!hub || s.destHub === hub) && (!origin || s.origin === origin))
  const flights = airOrigins(hub).filter(o => !origin || o.country === origin).flatMap(o => o.flights)
  return { items: [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), flights }
}

export function manifestCandidates(p = {}) {
  return request('GET /v1/manifests/candidates', () => {
    if (p.type === 'air_customs') return plain(airCandidates(p))
    return plain(carrierCandidates(p))
  }, { minMs: 250, maxMs: 500 })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Build + insert a carrier manifest record (no latency; call inside db.transaction). */
export function buildCarrierManifest({ hub, carrier, shipmentIds, date = null }) {
  const ships = shipmentIds.map(id => db.get('shipments', id)).filter(Boolean)
  const id = db.nextId('MNF')
  const at = nowIso()
  const rec = {
    id,
    type: 'carrier',
    hub,
    carrier,
    formType: formTypeFor(carrier),
    createdAt: at,
    date: date ?? localYmd(at),
    status: 'created',
    handedOverAt: null,
    shipmentIds: ships.map(s => s.id),
    totals: totalsForShipments(ships),
    createdBy: db.doc('user')?.name ?? null,
  }
  db.insert('manifests', rec)
  for (const s of ships) db.update('shipments', s.id, { manifestId: id })
  return rec
}

function buildAirManifest({ hub, origin, flight, intlIds }) {
  const list = intlIds.map(id => db.get('intl_shipments', id)).filter(Boolean)
  const id = db.nextId('MNF')
  const at = nowIso()
  const company = db.doc('user')?.company?.name ?? 'Anatolia Home & Craft'
  const mawb = generateMawb(flight, id + at)
  const hawbs = list.map(s => {
    const items = (s.parcels ?? []).flatMap(p => p.items ?? [])
    const titles = [...new Set(items.map(i => i.title))]
    return {
      hawb: hawbFor(s.id),
      intlShipmentId: s.id,
      shipper: s.sender?.company || s.sender?.name || '-',
      consignee: `${company} c/o ${s.destHub}`,
      contents: titles.slice(0, 4).join(', ') || '-',
      hsCodes: [...new Set(items.map(i => i.hsCode).filter(Boolean))],
      valueUsd: round2(s.declaredValueUsd ?? items.reduce((sum, i) => sum + (i.unitValueUsd || 0) * (i.qty || 1), 0)),
      origin: s.origin,
      weightKg: round2(s.totalWeightKg ?? 0),
      parcels: s.parcelCount ?? (s.parcels ?? []).length,
      missingHs: items.filter(i => !i.hsCode).length,
    }
  })
  const rec = {
    id,
    type: 'air_customs',
    hub,
    origin,
    mawb,
    flight,
    route: String(flight).split(' ').pop(),
    createdAt: at,
    status: 'created',
    hawbs,
    totals: {
      parcels: hawbs.reduce((s, h) => s + (h.parcels || 0), 0),
      weightKg: round2(hawbs.reduce((s, h) => s + (h.weightKg || 0), 0)),
      valueUsd: round2(hawbs.reduce((s, h) => s + (h.valueUsd || 0), 0)),
    },
    createdBy: db.doc('user')?.name ?? null,
  }
  db.insert('manifests', rec)
  for (const s of list) {
    const h = hawbs.find(x => x.intlShipmentId === s.id)
    db.update('intl_shipments', s.id, { manifestId: id, mawb, flight, route: rec.route, hawb: h?.hawb ?? null })
  }
  return rec
}

function notifyCreated(rec) {
  notify({
    type: 'success',
    title: { tr: `Manifest ${rec.id} oluşturuldu`, en: `Manifest ${rec.id} created` },
    body: rec.type === 'air_customs'
      ? { tr: `Hava kargo · MAWB ${rec.mawb} · ${rec.flight} · ${rec.hawbs.length} HAWB`, en: `Air cargo · MAWB ${rec.mawb} · ${rec.flight} · ${rec.hawbs.length} HAWB` }
      : { tr: `${rec.hub} · ${rec.carrier} · ${rec.totals.parcels} paket`, en: `${rec.hub} · ${rec.carrier} · ${rec.totals.parcels} parcels` },
    link: `/manifests/${rec.id}`,
  })
}

export function createManifest(input = {}) {
  return request('POST /v1/manifests', async () => {
    const errors = {}
    if (!input.hub) errors.hub = 'required'
    if (input.type === 'air_customs') {
      if (!input.origin) errors.origin = 'required'
      if (!input.flight) errors.flight = 'required'
      if (!(input.intlIds ?? []).length) errors.items = 'required'
    } else {
      if (!input.carrier) errors.carrier = 'required'
      if (!(input.shipmentIds ?? []).length) errors.items = 'required'
    }
    if (Object.keys(errors).length) {
      if (errors.items && Object.keys(errors).length === 1) throw new ApiError('NOTHING_TO_MANIFEST', 'Nothing to manifest', 422, errors)
      throw new ApiError('VALIDATION', 'Invalid manifest', 422, errors)
    }
    let rec
    if (input.type === 'air_customs') {
      for (const id of input.intlIds) {
        const s = db.get('intl_shipments', id)
        if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404, { id })
        if (s.manifestId) throw new ApiError('ALREADY_MANIFESTED', 'Already on a manifest', 409, { id, manifestId: s.manifestId })
      }
      rec = await db.transaction(() => buildAirManifest(input))
    } else {
      for (const id of input.shipmentIds) {
        const s = db.get('shipments', id)
        if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404, { id })
        if (s.manifestId) throw new ApiError('ALREADY_MANIFESTED', 'Already on a manifest', 409, { id, manifestId: s.manifestId })
        if (s.status === 'voided') throw new ApiError('VALIDATION', 'Voided label', 422, { id })
      }
      rec = await db.transaction(() => buildCarrierManifest(input))
    }
    notifyCreated(rec)
    audit('manifest.create', rec.id, rec.type === 'air_customs' ? `${rec.mawb} ${rec.flight}` : `${rec.hub} ${rec.carrier} ${rec.totals.parcels}`)
    return decorate(rec)
  }, { minMs: 500, maxMs: 900 })
}

export function createManifestsForShipments(shipmentIds = []) {
  return request('POST /v1/manifests/bulk', async () => {
    const ships = shipmentIds.map(id => db.get('shipments', id)).filter(s => s && !s.manifestId && s.status === 'label_created' && !s.test)
    if (!ships.length) throw new ApiError('NOTHING_TO_MANIFEST', 'Nothing to manifest', 422)
    const groups = {}
    for (const s of ships) (groups[`${s.hub}|${s.carrier}`] ??= []).push(s.id)
    const created = await db.transaction(() => Object.entries(groups).map(([k, ids]) => {
      const [hub, carrier] = k.split('|')
      return buildCarrierManifest({ hub, carrier, shipmentIds: ids })
    }))
    notify({
      type: 'success',
      title: { tr: `${created.length} manifest oluşturuldu`, en: `${created.length} manifests created` },
      body: { tr: created.map(m => `${m.id} (${m.hub} · ${m.carrier}, ${m.totals.parcels})`).join(', '), en: created.map(m => `${m.id} (${m.hub} · ${m.carrier}, ${m.totals.parcels})`).join(', ') },
      link: '/manifests',
    })
    audit('manifest.create_bulk', created.map(m => m.id).join(', '))
    return created.map(decorate)
  }, { minMs: 500, maxMs: 900 })
}

export function updateManifestStatus(id, status) {
  return request(`POST /v1/manifests/${id}/status`, () => {
    const m = db.get('manifests', id)
    if (!m) throw new ApiError('NOT_FOUND', 'Manifest not found', 404)
    if (m.type !== 'air_customs') throw new ApiError('INVALID_TRANSITION', 'Carrier handover is recorded at the operations hub', 409)
    const flow = MANIFEST_FLOW.air_customs
    if (flow.indexOf(status) !== flow.indexOf(m.status) + 1) throw new ApiError('INVALID_TRANSITION', 'Invalid status change', 409, { from: m.status, to: status })
    const at = nowIso()
    const patch = { status }
    if (status === 'customs_submitted') patch.submittedAt = at
    if (status === 'customs_cleared') patch.clearedAt = at
    const r = db.update('manifests', id, patch)
    notify({
      type: status === 'customs_cleared' ? 'success' : 'info',
      title: status === 'customs_cleared'
        ? { tr: `${id} gümrükten çekildi (MAWB ${m.mawb})`, en: `${id} cleared customs (MAWB ${m.mawb})` }
        : { tr: `${id} ABD gümrüğüne sunuldu (MAWB ${m.mawb})`, en: `${id} submitted to US customs (MAWB ${m.mawb})` },
      link: `/manifests/${id}`,
    })
    audit('manifest.status', id, status)
    return decorate(r)
  }, { minMs: 400, maxMs: 800 })
}

export function cancelManifest(id) {
  return request(`DELETE /v1/manifests/${id}`, async () => {
    const m = db.get('manifests', id)
    if (!m) throw new ApiError('NOT_FOUND', 'Manifest not found', 404)
    if (m.status !== 'created') throw new ApiError('INVALID_TRANSITION', 'Only new manifests can be cancelled', 409)
    await db.transaction(() => {
      if (m.type === 'air_customs') {
        for (const h of m.hawbs ?? []) if (db.get('intl_shipments', h.intlShipmentId)) db.update('intl_shipments', h.intlShipmentId, { manifestId: null, mawb: null, flight: null, hawb: null })
      } else {
        for (const sid of m.shipmentIds ?? []) if (db.get('shipments', sid)) db.update('shipments', sid, { manifestId: null })
      }
      db.remove('manifests', id)
    })
    audit('manifest.cancel', id)
    return { removed: decorate(m) }
  }, { minMs: 350, maxMs: 650 })
}

/**
 * Carrier pickup: every shipment on the manifests gets a "picked_up" event and moves to in_transit,
 * linked orders become "shipped", manifests become handed_over. Call inside db.transaction.
 */
export function handOverManifestRecords(manifestIds, { loc = null } = {}) {
  const at = nowIso()
  const touched = []
  for (const mid of manifestIds) {
    const m = db.get('manifests', mid)
    if (!m || m.type === 'air_customs' || m.status === 'handed_over') continue
    for (const sid of m.shipmentIds ?? []) {
      const s = db.get('shipments', sid)
      if (!s || s.status !== 'label_created') continue
      const hubLoc = loc ?? [s.from?.city, s.from?.state].filter(Boolean).join(', ')
      db.update('shipments', sid, { status: 'in_transit', pickedUpAt: at, events: [...(s.events ?? []), { at, code: 'picked_up', loc: hubLoc }] })
      touched.push(sid)
      const o = s.orderId ? db.get('orders', s.orderId) : null
      if (o && o.shipmentId === sid && o.status === 'labeled') {
        db.update('orders', o.id, { status: 'shipped', events: [...(o.events ?? []), { at, code: 'shipped', detail: { manifestId: mid } }] })
      }
    }
    db.update('manifests', mid, { status: 'handed_over', handedOverAt: at })
  }
  return touched
}
