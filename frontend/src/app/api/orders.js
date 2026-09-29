/**
 * Orders API (spec 3.6, 5.4).
 *
 * ---------------------------------------------------------------------------
 * API summary (every async function goes through request(); errors are ApiError with
 * `code`, localized via t('core.errors.<code>'), field errors in `details`)
 * ---------------------------------------------------------------------------
 * listOrders(params?) -> Order[]                       GET /v1/orders, newest first
 *   params: { status?, channel? (string|array), q?, scoreBand?: 'lt70'|'70to84'|'gte85',
 *             state?, tag?, from?, to? (ISO) }
 * orderCounts() -> { all, awaiting_shipment, on_hold, labeled, shipped, cancelled, delivered }  (sync, reactive-friendly)
 * getOrder(id) -> Order & { shipment: Shipment|null, timeline: [{ at, code, detail? }] }
 *   timeline codes: created, imported, synced, address_validated, address_corrected, held, released,
 *   tagged, labeled, label_voided, shipped, delivered, tracking_synced, cancelled, updated
 * createOrder(input) -> Order                          POST /v1/orders
 *   input: { customer: {name, email?, phone?}, shipTo: {name, company?, line1, line2?, city, state, zip,
 *            country='US', residential=true}, items: [{sku?, title, qty, unitPrice, weightLb?, hsCode?}],
 *            package?: {lengthIn, widthIn, heightIn, weightLb} | null, tags?: [], channel?: 'manual'|'api',
 *            channelOrderNo? }
 *   Runs the address model, estimates a package from items when missing, applies hold/tag rules.
 * updateOrder(id, patch) -> Order                      (shipTo changes re-run the address model)
 * holdOrders(ids, reason?) -> { changed: [{ id, prevStatus, prevHoldReason }] }   (awaiting_shipment only)
 * releaseOrders(ids) -> { changed: [...] }                                         (on_hold only)
 * restoreOrders(changed) -> Order[]                    undo for hold/release/tag
 * cancelOrder(id, reason?) -> Order                    ORDER_HAS_LABEL when a live label exists
 * tagOrders(ids, tag, { remove? }) -> { changed: [{ id, prevTags }] }
 * applyAddressSuggestion(id) -> { order, undo }        undo = snapshot for undoAddressSuggestion(undo)
 * undoAddressSuggestion(undo) -> Order
 * validateAddress(address, { orderId? }) -> AddressCheck   POST /v1/addresses/validate (fast, for live forms)
 * revalidateAddresses(ids, { onProgress? }) -> [{ id, prevScore, score, issueType }]
 * estimatePackageFromItems(items) -> { lengthIn, widthIn, heightIn, weightLb, presetId, estimated: true }  (sync)
 * estimatePackages(ids) -> [{ id, package }]           sets package on orders that have none
 *
 * CSV import / export
 * ORDER_CSV_FIELDS: [{ id, required }]  labels: t('core.csv.fields.<id>')
 * ordersCsvTemplate() -> string (orders_template.csv content)
 * parseOrdersCsv(text) -> { headers, rows: string[][], preview: string[][] (first 5), mapping: {fieldId: colIndex|null} }
 * validateCsvRows(parsed, mapping) -> { orders: OrderInput[], errors: [{ row, field, code }], rowCount }
 *   rows with the same order number are grouped into one order with several items
 *   error codes: required, zip, state, number, qty, email
 * importOrders(orderInputs, { onProgress? }) -> Order[]     POST /v1/orders/import (channel 'manual')
 * exportOrdersCsv(idsOrOrders?) -> string                   CSV of the given (or all) orders
 *
 * AddressCheck = { score 0..100, issues: [{code, field, severity}], issueType|null,
 *   suggestion: { patch: {...}, source, confidence } | null, contributions?, checkedAt, modelVersion }
 */
import { toRaw } from 'vue'
import { request, ApiError, runSteps } from './client.js'
import { db } from '../store/db.js'
import { audit, notify, modelEvent } from '../store/events.js'
import { evaluate, buildRuleContext } from '../store/rules.js'
import { round2 } from '@/shared/rateEngine.js'

const addrLoaders = import.meta.glob('../ai/addressModel.js')
let addrPromise = null
function loadAddressModel() {
  if (!addrPromise) {
    const l = addrLoaders['../ai/addressModel.js']
    addrPromise = l ? l().catch(() => null) : Promise.resolve(null)
  }
  return addrPromise
}

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '))
const ZIP_RE = /^\d{5}(-\d{4})?$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pushEvent(order, code, detail) {
  const events = Array.isArray(order.events) ? [...order.events] : []
  events.push({ at: nowIso(), code, ...(detail ? { detail } : {}) })
  return events
}

// ---------------------------------------------------------------------------
// Address model bridge
// ---------------------------------------------------------------------------

/** Rule based fallback used while ai/addressModel.js is unavailable. */
function fallbackCheck(addr) {
  const issues = []
  let suggestion = null
  const zip = String(addr.zip ?? '').trim()
  const state = String(addr.state ?? '').toUpperCase()
  const country = (addr.country || 'US').toUpperCase()
  if (!addr.line1) issues.push({ code: 'incomplete_street', field: 'line1', severity: 'error' })
  if (!addr.city) issues.push({ code: 'missing_city', field: 'city', severity: 'error' })
  if (country === 'US') {
    if (!ZIP_RE.test(zip)) issues.push({ code: 'invalid_zip', field: 'zip', severity: 'error' })
    else {
      const z3 = db.doc('zip3_state')?.[zip.slice(0, 3)]
      if (z3 && state && z3 !== state) { issues.push({ code: 'state_mismatch', field: 'state', severity: 'error' }); suggestion = { patch: { state: z3 }, source: 'zip3_state', confidence: 0.85 } }
      const cities = db.all('zip_city')
      const hit = cities.find(c => c.zip === zip.slice(0, 5))
      if (hit && addr.city && hit.city.toLowerCase() !== String(addr.city).toLowerCase()) {
        issues.push({ code: 'zip_city_mismatch', field: 'zip', severity: 'error' })
        const alt = cities.find(c => c.city.toLowerCase() === String(addr.city).toLowerCase() && c.state === state && c.primary) ?? cities.find(c => c.city.toLowerCase() === String(addr.city).toLowerCase() && c.state === state)
        if (!suggestion && alt) suggestion = { patch: { zip: alt.zip }, source: 'zip_city', confidence: 0.8 }
      }
      const aptZips = db.doc('streets')?.apartmentZips ?? []
      if (aptZips.includes(zip.slice(0, 5)) && !addr.line2 && !/\b(apt|unit|suite|ste|#)\b/i.test(addr.line1 ?? '')) issues.push({ code: 'missing_unit', field: 'line2', severity: 'warning' })
    }
    if (!US_STATES.has(state)) issues.push({ code: 'state_mismatch', field: 'state', severity: 'error' })
    if (/\bp\.?\s*o\.?\s*box\b/i.test(`${addr.line1} ${addr.line2}`)) issues.push({ code: 'po_box_restricted', field: 'line1', severity: 'warning' })
  }
  const errors = issues.filter(i => i.severity === 'error').length
  const warns = issues.length - errors
  const score = Math.max(5, Math.min(98, 96 - errors * 38 - warns * 18))
  return { score, issues, issueType: issues[0]?.code ?? null, suggestion, contributions: null, modelVersion: 'addr-rules v1.0' }
}

async function runAddressModel(address, { orderId } = {}) {
  const addr = plain(address) ?? {}
  const mod = await loadAddressModel()
  let r = null
  if (mod && typeof mod.validateAddress === 'function') {
    try {
      const history = plain(db.all('orders')).filter(o => o.id !== orderId)
      r = await mod.validateAddress(addr, { history })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[orders] address model failed, using rules', e)
    }
  }
  if (!r) r = fallbackCheck(addr)
  return {
    score: Math.round(Number(r.score) || 0),
    issues: r.issues ?? [],
    issueType: r.issueType ?? r.issues?.[0]?.code ?? null,
    suggestion: r.suggestion ?? null,
    contributions: r.contributions ?? null,
    checkedAt: nowIso(),
    modelVersion: r.modelVersion ?? mod?.MODEL_VERSION ?? 'addr-ml v1.3',
  }
}

export function validateAddress(address, { orderId } = {}) {
  return request('POST /v1/addresses/validate', async () => {
    const res = await runAddressModel(address, { orderId })
    return res
  }, { minMs: 120, maxMs: 260 })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function bandOf(score) { return score < 70 ? 'lt70' : score < 85 ? '70to84' : 'gte85' }

function filterOrders(list, p = {}) {
  let out = list
  if (p.status && p.status !== 'all') out = out.filter(o => o.status === p.status)
  if (p.channel && (!Array.isArray(p.channel) || p.channel.length)) {
    const ch = Array.isArray(p.channel) ? p.channel : [p.channel]
    out = out.filter(o => ch.includes(o.channel))
  }
  if (p.scoreBand) out = out.filter(o => bandOf(o.addressCheck?.score ?? 100) === p.scoreBand)
  if (p.state) out = out.filter(o => o.shipTo?.state === p.state)
  if (p.tag) out = out.filter(o => (o.tags ?? []).includes(p.tag))
  if (p.from) out = out.filter(o => o.createdAt >= p.from)
  if (p.to) out = out.filter(o => o.createdAt <= p.to)
  if (p.q) {
    const q = String(p.q).trim().toLowerCase()
    out = out.filter(o => [o.id, o.channelOrderNo, o.customer?.name, o.customer?.email, ...(o.items ?? []).map(i => i.sku)]
      .some(v => String(v ?? '').toLowerCase().includes(q)))
  }
  return [...out].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export function listOrders(params = {}) {
  return request('GET /v1/orders', () => filterOrders(db.all('orders'), params), { minMs: 300, maxMs: 650 })
}

export function orderCounts() {
  const c = { all: 0, awaiting_shipment: 0, on_hold: 0, labeled: 0, shipped: 0, cancelled: 0, delivered: 0 }
  for (const o of db.all('orders')) { c.all++; c[o.status] = (c[o.status] ?? 0) + 1 }
  return c
}

function buildTimeline(order, shipment) {
  const items = []
  const has = code => (order.events ?? []).some(e => e.code === code)
  if (!has('created') && !has('imported') && !has('synced')) items.push({ at: order.createdAt, code: 'created' })
  if (order.addressCheck?.checkedAt && !has('address_validated')) items.push({ at: order.addressCheck.checkedAt, code: 'address_validated', detail: { score: order.addressCheck.score } })
  if (shipment && !has('labeled')) items.push({ at: shipment.createdAt, code: 'labeled', detail: { shipmentId: shipment.id, trackingNo: shipment.trackingNo } })
  if (shipment) {
    const picked = shipment.events?.find(e => e.code === 'picked_up' || e.code === 'in_transit' || e.code === 'departed')
    if (picked) items.push({ at: picked.at, code: 'shipped' })
    const del = shipment.events?.find(e => e.code === 'delivered')
    if (del) items.push({ at: del.at, code: 'delivered' })
  }
  if (order.trackingSyncedAt && !has('tracking_synced')) items.push({ at: order.trackingSyncedAt, code: 'tracking_synced', detail: { channel: order.channel, trackingNo: shipment?.trackingNo } })
  for (const e of order.events ?? []) items.push(e)
  return items.filter(x => x.at).sort((a, b) => a.at.localeCompare(b.at))
}

export function getOrder(id) {
  return request(`GET /v1/orders/${id}`, () => {
    const order = db.get('orders', id)
    if (!order) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    const shipment = order.shipmentId ? db.get('shipments', order.shipmentId) ?? null : null
    return { ...plain(order), shipment: plain(shipment), timeline: buildTimeline(order, shipment) }
  }, { minMs: 250, maxMs: 550 })
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

function validateOrderInput(input) {
  const e = {}
  const c = input.customer ?? {}
  const a = input.shipTo ?? {}
  if (!c.name && !a.name) e['customer.name'] = 'required'
  if (c.email && !EMAIL_RE.test(c.email)) e['customer.email'] = 'email'
  if (!a.line1) e['shipTo.line1'] = 'required'
  if (!a.city) e['shipTo.city'] = 'required'
  const country = (a.country || 'US').toUpperCase()
  if (country === 'US') {
    if (!a.state) e['shipTo.state'] = 'required'
    else if (!US_STATES.has(String(a.state).toUpperCase())) e['shipTo.state'] = 'state'
    if (!a.zip) e['shipTo.zip'] = 'required'
    else if (!ZIP_RE.test(String(a.zip).trim())) e['shipTo.zip'] = 'zip'
  } else if (!a.zip) e['shipTo.zip'] = 'required'
  const items = input.items ?? []
  if (!items.length) e.items = 'required'
  items.forEach((it, i) => {
    if (!it.title && !it.sku) e[`items.${i}.title`] = 'required'
    if (!(Number(it.qty) > 0)) e[`items.${i}.qty`] = 'qty'
    if (it.unitPrice === '' || it.unitPrice == null || !Number.isFinite(Number(it.unitPrice))) e[`items.${i}.unitPrice`] = 'number'
  })
  const p = input.package
  if (p) for (const k of ['lengthIn', 'widthIn', 'heightIn', 'weightLb']) if (!(Number(p[k]) > 0)) e[`package.${k}`] = 'number'
  if (Object.keys(e).length) throw new ApiError('VALIDATION', 'Invalid order', 422, e)
}

function normalizeItems(items) {
  const products = db.all('products')
  return items.map(it => {
    const p = it.sku ? products.find(x => x.sku === it.sku) : null
    return {
      sku: it.sku || null,
      title: it.title || (p ? p.title?.en ?? p.title : it.sku),
      qty: Number(it.qty) || 1,
      unitPrice: round2(Number(it.unitPrice) || 0),
      weightLb: Number(it.weightLb) || p?.weightLb || 0.5,
      hsCode: it.hsCode || p?.hsCode || null,
    }
  })
}

export function estimatePackageFromItems(items = []) {
  const products = db.all('products')
  const presets = [...(db.all('box_presets') ?? [])].filter(b => b.type === 'box' || b.type === 'poly')
  let weight = 0
  let volume = 0
  let maxDim = 0
  for (const it of items) {
    const qty = Number(it.qty) || 1
    const p = it.sku ? products.find(x => x.sku === it.sku) : null
    weight += (Number(it.weightLb) || p?.weightLb || 0.5) * qty
    const d = p?.dims ?? { lengthIn: 5, widthIn: 4, heightIn: 3 }
    volume += d.lengthIn * d.widthIn * d.heightIn * qty
    maxDim = Math.max(maxDim, d.lengthIn, d.widthIn, d.heightIn)
  }
  const boxes = presets.filter(b => b.type === 'box').sort((a, b) => a.lengthIn * a.widthIn * a.heightIn - b.lengthIn * b.widthIn * b.heightIn)
  const box = boxes.find(b => b.lengthIn * b.widthIn * b.heightIn >= volume * 1.25 && Math.max(b.lengthIn, b.widthIn, b.heightIn) >= maxDim) ?? boxes[boxes.length - 1]
  const dims = box ?? { id: null, lengthIn: 12, widthIn: 10, heightIn: 6, tareLb: 0.6 }
  return {
    lengthIn: dims.lengthIn,
    widthIn: dims.widthIn,
    heightIn: dims.heightIn,
    weightLb: round2(weight + (dims.tareLb ?? 0.5)),
    presetId: dims.id ?? null,
    estimated: true,
  }
}

function nextManualNo() {
  const n = db.all('orders').filter(o => o.channel === 'manual').length + 1041
  return `MAN-${n}`
}

/** Build and insert an order record (no latency; used by create, import and store sync). */
export async function insertOrderRecord(input, { channel = 'manual', eventCode = 'created', createdAt = null } = {}) {
  const items = normalizeItems(input.items ?? [])
  const shipTo = {
    name: input.shipTo?.name || input.customer?.name || '',
    company: input.shipTo?.company || '',
    line1: String(input.shipTo?.line1 ?? '').trim(),
    line2: String(input.shipTo?.line2 ?? '').trim(),
    city: String(input.shipTo?.city ?? '').trim(),
    state: String(input.shipTo?.state ?? '').trim().toUpperCase(),
    zip: String(input.shipTo?.zip ?? '').trim(),
    country: (input.shipTo?.country || 'US').toUpperCase(),
    residential: input.shipTo?.residential !== false && !input.shipTo?.company,
  }
  const id = db.nextId('ORD')
  const addressCheck = await runAddressModel(shipTo, { orderId: id })
  const pkg = input.package ? { lengthIn: +input.package.lengthIn, widthIn: +input.package.widthIn, heightIn: +input.package.heightIn, weightLb: +input.package.weightLb } : estimatePackageFromItems(items)
  const total = round2(items.reduce((s, i) => s + i.unitPrice * i.qty, 0))
  const at = createdAt ?? nowIso()
  const order = {
    id,
    channel: input.channel ?? channel,
    channelOrderNo: input.channelOrderNo || (channel === 'manual' ? nextManualNo() : id),
    createdAt: at,
    customer: { name: input.customer?.name || shipTo.name, email: input.customer?.email || '', phone: input.customer?.phone || '' },
    shipTo,
    items,
    package: pkg,
    packageEstimated: !input.package,
    total,
    currency: 'USD',
    status: 'awaiting_shipment',
    addressCheck,
    shipmentId: null,
    tags: [...new Set(input.tags ?? [])],
    events: [{ at, code: eventCode }, { at: addressCheck.checkedAt, code: 'address_validated', detail: { score: addressCheck.score } }],
  }
  const { effects, matched } = evaluate(buildRuleContext({ order }))
  for (const t of effects.tags) if (!order.tags.includes(t.tag)) order.tags.push(t.tag)
  if (effects.hold) {
    order.status = 'on_hold'
    order.holdReason = { tr: `Kural: ${effects.hold.ruleName?.tr ?? ''}`, en: `Rule: ${effects.hold.ruleName?.en ?? ''}` }
    order.events.push({ at, code: 'held', detail: { rule: effects.hold.ruleName } })
  }
  if (matched.length) order.appliedRules = matched.map(m => m.rule.id)
  db.insert('orders', order)
  return order
}

export function createOrder(input) {
  return request('POST /v1/orders', async () => {
    validateOrderInput(input)
    const order = await db.transaction(() => insertOrderRecord(input, { channel: input.channel ?? 'manual' }))
    audit('order.create', order.id, order.channelOrderNo)
    if (order.addressCheck.score < 70) {
      notify({ type: 'warning', title: { tr: `${order.id}: adres sorunlu görünüyor (skor ${order.addressCheck.score})`, en: `${order.id}: address looks problematic (score ${order.addressCheck.score})` }, link: `/orders/${order.id}` })
    }
    return order
  }, { minMs: 450, maxMs: 850 })
}

const EDITABLE = ['customer', 'shipTo', 'items', 'package', 'tags', 'notes']

export function updateOrder(id, patch) {
  return request(`PATCH /v1/orders/${id}`, async () => {
    const order = db.get('orders', id)
    if (!order) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    if (['shipped', 'delivered', 'cancelled'].includes(order.status) && (patch.shipTo || patch.items || patch.package)) throw new ApiError('ORDER_LOCKED', 'Order can no longer be edited', 409)
    const clean = {}
    for (const k of EDITABLE) if (k in patch) clean[k] = plain(patch[k])
    if (clean.items) clean.items = normalizeItems(clean.items)
    const merged = { ...plain(order), ...clean }
    validateOrderInput({ ...merged, package: clean.package ?? null })
    if (clean.items) clean.total = round2(clean.items.reduce((s, i) => s + i.unitPrice * i.qty, 0))
    if (clean.package) clean.packageEstimated = false
    if (clean.shipTo) {
      clean.shipTo = { ...order.shipTo, ...clean.shipTo, state: String(clean.shipTo.state ?? order.shipTo.state).toUpperCase() }
      clean.addressCheck = await runAddressModel(clean.shipTo, { orderId: id })
    }
    clean.events = pushEvent(order, 'updated', { fields: Object.keys(clean).filter(k => EDITABLE.includes(k)) })
    const r = db.update('orders', id, clean)
    audit('order.update', id, Object.keys(clean).join(', '))
    return r
  }, { minMs: 350, maxMs: 700 })
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

const asIds = ids => (Array.isArray(ids) ? ids : [ids])

export function holdOrders(ids, reason = null) {
  return request('POST /v1/orders/hold', async () => {
    const changed = []
    await db.transaction(() => {
      for (const id of asIds(ids)) {
        const o = db.get('orders', id)
        if (!o || o.status !== 'awaiting_shipment') continue
        changed.push({ id, prevStatus: o.status, prevHoldReason: o.holdReason ?? null, prevTags: [...(o.tags ?? [])] })
        db.update('orders', id, { status: 'on_hold', holdReason: reason ?? { tr: 'Elle beklemeye alındı', en: 'Put on hold manually' }, events: pushEvent(o, 'held') })
      }
    })
    if (!changed.length) throw new ApiError('NOTHING_TO_HOLD', 'No awaiting orders in selection', 409)
    audit('order.hold', changed.map(c => c.id).join(', '))
    return { changed }
  }, { minMs: 250, maxMs: 500 })
}

export function releaseOrders(ids) {
  return request('POST /v1/orders/release', async () => {
    const changed = []
    await db.transaction(() => {
      for (const id of asIds(ids)) {
        const o = db.get('orders', id)
        if (!o || o.status !== 'on_hold') continue
        changed.push({ id, prevStatus: o.status, prevHoldReason: o.holdReason ?? null, prevTags: [...(o.tags ?? [])] })
        db.update('orders', id, { status: 'awaiting_shipment', holdReason: null, tags: (o.tags ?? []).filter(t => t !== 'address-hold'), events: pushEvent(o, 'released') })
      }
    })
    if (!changed.length) throw new ApiError('NOTHING_TO_RELEASE', 'No held orders in selection', 409)
    audit('order.release', changed.map(c => c.id).join(', '))
    return { changed }
  }, { minMs: 250, maxMs: 500 })
}

/** Undo for hold / release / tag: restores status, hold reason and tags. */
export function restoreOrders(changed) {
  return request('POST /v1/orders/restore', async () => {
    const out = []
    await db.transaction(() => {
      for (const c of changed) {
        const o = db.get('orders', c.id)
        if (!o) continue
        const patch = {}
        if (c.prevStatus) { patch.status = c.prevStatus; patch.holdReason = c.prevHoldReason ?? null }
        if (c.prevTags) patch.tags = c.prevTags
        patch.events = (o.events ?? []).slice(0, -1)
        out.push(db.update('orders', c.id, patch))
      }
    })
    audit('order.undo', changed.map(c => c.id).join(', '))
    return out
  }, { minMs: 150, maxMs: 300 })
}

export function cancelOrder(id, reason = null) {
  return request(`POST /v1/orders/${id}/cancel`, () => {
    const o = db.get('orders', id)
    if (!o) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    if (o.status === 'cancelled') throw new ApiError('ALREADY_CANCELLED', 'Order already cancelled', 409)
    const sh = o.shipmentId ? db.get('shipments', o.shipmentId) : null
    if (['labeled', 'shipped', 'delivered'].includes(o.status) && sh && sh.status !== 'voided') throw new ApiError('ORDER_HAS_LABEL', 'Void the label first', 409)
    const r = db.update('orders', id, { status: 'cancelled', cancelledAt: nowIso(), cancelReason: reason, events: pushEvent(o, 'cancelled', reason ? { reason } : null) })
    audit('order.cancel', id, reason)
    return r
  }, { minMs: 300, maxMs: 600 })
}

export function tagOrders(ids, tag, { remove = false } = {}) {
  return request(remove ? 'DELETE /v1/orders/tags' : 'POST /v1/orders/tags', async () => {
    const tg = String(tag ?? '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!tg) throw new ApiError('VALIDATION', 'Tag required', 422, { tag: 'required' })
    const changed = []
    await db.transaction(() => {
      for (const id of asIds(ids)) {
        const o = db.get('orders', id)
        if (!o) continue
        const tags = o.tags ?? []
        const next = remove ? tags.filter(t => t !== tg) : tags.includes(tg) ? tags : [...tags, tg]
        if (next.length === tags.length && next.every((t, i) => t === tags[i])) continue
        changed.push({ id, prevTags: [...tags] })
        db.update('orders', id, { tags: next, events: pushEvent(o, 'tagged', { tag: tg, removed: remove }) })
      }
    })
    audit(remove ? 'order.untag' : 'order.tag', changed.map(c => c.id).join(', '), tg)
    return { changed, tag: tg }
  }, { minMs: 200, maxMs: 450 })
}

// ---------------------------------------------------------------------------
// Address suggestions
// ---------------------------------------------------------------------------

export function applyAddressSuggestion(id) {
  return request(`POST /v1/orders/${id}/address/apply-suggestion`, async () => {
    const o = db.get('orders', id)
    if (!o) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    const sug = o.addressCheck?.suggestion
    if (!sug || !sug.patch || !Object.keys(sug.patch).length) throw new ApiError('NO_SUGGESTION', 'No address suggestion', 409)
    const undo = { id, shipTo: plain(o.shipTo), addressCheck: plain(o.addressCheck), status: o.status, holdReason: plain(o.holdReason ?? null), tags: [...(o.tags ?? [])], events: plain(o.events ?? []) }
    const shipTo = { ...plain(o.shipTo), ...sug.patch }
    const check = await runAddressModel(shipTo, { orderId: id })
    const patch = { shipTo, addressCheck: check, events: pushEvent(o, 'address_corrected', { patch: sug.patch, before: o.addressCheck.score, after: check.score }) }
    const addrHold = o.status === 'on_hold' && ((o.tags ?? []).includes('address-hold') || /adres|address/i.test(JSON.stringify(o.holdReason ?? '')))
    if (addrHold && check.score >= 70) {
      patch.status = 'awaiting_shipment'
      patch.holdReason = null
      patch.tags = (o.tags ?? []).filter(t => t !== 'address-hold')
      patch.events = [...patch.events, { at: nowIso(), code: 'released', detail: { auto: true } }]
    }
    await db.transaction(() => {
      db.update('orders', id, patch)
      db.insert('addressFeedback', { id: 'AFB-' + Date.now().toString(36), at: nowIso(), orderId: id, before: undo.shipTo, after: shipTo, issueType: o.addressCheck.issueType, accepted: true, source: sug.source ?? null })
    })
    modelEvent('address', 'feedback', { orderId: id, issueType: o.addressCheck.issueType, before: undo.addressCheck.score, after: check.score })
    audit('order.address_correct', id, JSON.stringify(sug.patch))
    return { order: plain(db.get('orders', id)), undo }
  }, { minMs: 350, maxMs: 700 })
}

export function undoAddressSuggestion(undo) {
  return request(`POST /v1/orders/${undo.id}/address/undo`, async () => {
    if (!db.get('orders', undo.id)) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    await db.transaction(() => {
      db.update('orders', undo.id, { shipTo: undo.shipTo, addressCheck: undo.addressCheck, status: undo.status, holdReason: undo.holdReason, tags: undo.tags, events: undo.events })
      const fb = db.all('addressFeedback').find(f => f.orderId === undo.id && f.accepted)
      if (fb) db.remove('addressFeedback', fb.id)
    })
    audit('order.address_undo', undo.id)
    return db.get('orders', undo.id)
  }, { minMs: 150, maxMs: 300 })
}

export function revalidateAddresses(ids, { onProgress } = {}) {
  return request('POST /v1/addresses/validate-batch', async () => {
    const list = asIds(ids).map(id => db.get('orders', id)).filter(Boolean)
    const results = await runSteps(list.map(o => async () => {
      const check = await runAddressModel(o.shipTo, { orderId: o.id })
      const prevScore = o.addressCheck?.score ?? null
      db.update('orders', o.id, { addressCheck: check, events: pushEvent(o, 'address_validated', { score: check.score }) })
      return { id: o.id, prevScore, score: check.score, issueType: check.issueType }
    }), onProgress, { stepMs: [40, 90] })
    modelEvent('address', 'predict', { count: results.length, problems: results.filter(r => r.score < 70).length })
    audit('order.revalidate', results.map(r => r.id).join(', '))
    return results
  }, { minMs: 200, maxMs: 400 })
}

export function estimatePackages(ids) {
  return request('POST /v1/orders/estimate-packages', async () => {
    const out = []
    await db.transaction(() => {
      for (const id of asIds(ids)) {
        const o = db.get('orders', id)
        if (!o || o.package) continue
        const pkg = estimatePackageFromItems(o.items ?? [])
        db.update('orders', id, { package: { lengthIn: pkg.lengthIn, widthIn: pkg.widthIn, heightIn: pkg.heightIn, weightLb: pkg.weightLb }, packageEstimated: true, events: pushEvent(o, 'updated', { fields: ['package'], estimated: true }) })
        out.push({ id, package: pkg })
      }
    })
    return out
  }, { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const ORDER_CSV_FIELDS = [
  { id: 'orderNo', required: false }, { id: 'customerName', required: true }, { id: 'email', required: false },
  { id: 'phone', required: false }, { id: 'company', required: false }, { id: 'line1', required: true },
  { id: 'line2', required: false }, { id: 'city', required: true }, { id: 'state', required: true },
  { id: 'zip', required: true }, { id: 'country', required: false }, { id: 'sku', required: false },
  { id: 'title', required: true }, { id: 'qty', required: true }, { id: 'unitPrice', required: true },
  { id: 'weightLb', required: false }, { id: 'lengthIn', required: false }, { id: 'widthIn', required: false },
  { id: 'heightIn', required: false }, { id: 'packageWeightLb', required: false }, { id: 'tags', required: false },
]

const SYNONYMS = {
  orderNo: ['order', 'order no', 'order number', 'order_no', 'order id', 'siparis no', 'sipariş no', 'reference', 'ref'],
  customerName: ['name', 'customer', 'customer name', 'recipient', 'ship to name', 'alici', 'alıcı', 'musteri', 'müşteri', 'full name'],
  email: ['email', 'e-mail', 'customer email', 'eposta', 'e-posta'],
  phone: ['phone', 'telephone', 'tel', 'telefon', 'phone number'],
  company: ['company', 'firma', 'sirket', 'şirket', 'business'],
  line1: ['address', 'address1', 'address 1', 'address line 1', 'street', 'line1', 'adres', 'ship address'],
  line2: ['address2', 'address 2', 'address line 2', 'apt', 'suite', 'unit', 'line2', 'adres 2'],
  city: ['city', 'town', 'sehir', 'şehir'],
  state: ['state', 'province', 'region', 'eyalet', 'state code'],
  zip: ['zip', 'zipcode', 'zip code', 'postal', 'postal code', 'postcode', 'posta kodu'],
  country: ['country', 'ulke', 'ülke', 'country code'],
  sku: ['sku', 'item sku', 'product sku', 'stok kodu'],
  title: ['title', 'item', 'product', 'item name', 'product name', 'description', 'urun', 'ürün'],
  qty: ['qty', 'quantity', 'adet', 'miktar', 'count'],
  unitPrice: ['price', 'unit price', 'unitprice', 'item price', 'fiyat', 'birim fiyat', 'amount'],
  weightLb: ['weight', 'item weight', 'weight lb', 'weightlb', 'agirlik', 'ağırlık'],
  lengthIn: ['length', 'length in', 'uzunluk', 'l'],
  widthIn: ['width', 'width in', 'genislik', 'genişlik', 'w'],
  heightIn: ['height', 'height in', 'yukseklik', 'yükseklik', 'h'],
  packageWeightLb: ['package weight', 'parcel weight', 'paket agirligi', 'paket ağırlığı', 'total weight'],
  tags: ['tags', 'tag', 'etiketler', 'labels'],
}

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows) { return rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n' }

export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  const s = String(text ?? '').replace(/^﻿/, '')
  const delim = (s.split('\n')[0].match(/;/g) ?? []).length > (s.split('\n')[0].match(/,/g) ?? []).length ? ';' : ','
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch
    } else if (ch === '"') q = true
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
  return rows.map(r => r.map(c => c.trim()))
}

function autoMap(headers) {
  const mapping = {}
  const used = new Set()
  const normH = headers.map(h => h.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim())
  for (const f of ORDER_CSV_FIELDS) {
    const syn = [f.id.toLowerCase(), ...(SYNONYMS[f.id] ?? [])]
    let idx = normH.findIndex((h, i) => !used.has(i) && syn.includes(h))
    if (idx < 0) idx = normH.findIndex((h, i) => !used.has(i) && syn.some(s => s.length > 3 && h.includes(s)))
    mapping[f.id] = idx >= 0 ? idx : null
    if (idx >= 0) used.add(idx)
  }
  return mapping
}

export function parseOrdersCsv(text) {
  const all = parseCsv(text)
  if (all.length < 2) throw new ApiError('CSV_EMPTY', 'CSV has no data rows', 422)
  const [headers, ...rows] = all
  return { headers, rows, preview: rows.slice(0, 5), mapping: autoMap(headers) }
}

export function validateCsvRows(parsed, mapping = parsed.mapping) {
  const errors = []
  const groups = new Map()
  const get = (r, f) => (mapping[f] != null ? String(r[mapping[f]] ?? '').trim() : '')
  for (const f of ORDER_CSV_FIELDS) if (f.required && mapping[f.id] == null) errors.push({ row: 0, field: f.id, code: 'unmapped' })
  parsed.rows.forEach((r, i) => {
    const rowNo = i + 2 // header is row 1
    const rowErr = []
    for (const f of ORDER_CSV_FIELDS) if (f.required && mapping[f.id] != null && !get(r, f.id)) rowErr.push({ row: rowNo, field: f.id, code: 'required' })
    const country = (get(r, 'country') || 'US').toUpperCase()
    const zip = get(r, 'zip')
    if (zip && country === 'US' && !ZIP_RE.test(zip.padStart(5, '0'))) rowErr.push({ row: rowNo, field: 'zip', code: 'zip' })
    const st = get(r, 'state').toUpperCase()
    if (st && country === 'US' && !US_STATES.has(st)) rowErr.push({ row: rowNo, field: 'state', code: 'state' })
    const qty = get(r, 'qty')
    if (qty && !(Number(qty) > 0)) rowErr.push({ row: rowNo, field: 'qty', code: 'qty' })
    const price = get(r, 'unitPrice').replace(/[$,]/g, '')
    if (price && !Number.isFinite(Number(price))) rowErr.push({ row: rowNo, field: 'unitPrice', code: 'number' })
    const email = get(r, 'email')
    if (email && !EMAIL_RE.test(email)) rowErr.push({ row: rowNo, field: 'email', code: 'email' })
    for (const k of ['weightLb', 'lengthIn', 'widthIn', 'heightIn', 'packageWeightLb']) { const v = get(r, k); if (v && !(Number(v) > 0)) rowErr.push({ row: rowNo, field: k, code: 'number' }) }
    if (rowErr.length) { errors.push(...rowErr); return }
    const key = get(r, 'orderNo') || `row-${rowNo}`
    if (!groups.has(key)) {
      const L = Number(get(r, 'lengthIn')), W = Number(get(r, 'widthIn')), H = Number(get(r, 'heightIn')), PW = Number(get(r, 'packageWeightLb'))
      groups.set(key, {
        channelOrderNo: get(r, 'orderNo') || null,
        customer: { name: get(r, 'customerName'), email, phone: get(r, 'phone') },
        shipTo: { name: get(r, 'customerName'), company: get(r, 'company'), line1: get(r, 'line1'), line2: get(r, 'line2'), city: get(r, 'city'), state: st, zip: country === 'US' ? zip.padStart(5, '0') : zip, country, residential: !get(r, 'company') },
        items: [],
        package: L > 0 && W > 0 && H > 0 && PW > 0 ? { lengthIn: L, widthIn: W, heightIn: H, weightLb: PW } : null,
        tags: get(r, 'tags') ? get(r, 'tags').split(/[|;,]/).map(t => t.trim()).filter(Boolean) : [],
        sourceRows: [],
      })
    }
    const g = groups.get(key)
    g.sourceRows.push(rowNo)
    g.items.push({ sku: get(r, 'sku') || null, title: get(r, 'title'), qty: Number(qty) || 1, unitPrice: Number(price) || 0, weightLb: Number(get(r, 'weightLb')) || null })
  })
  return { orders: [...groups.values()], errors, rowCount: parsed.rows.length }
}

export function ordersCsvTemplate() {
  return toCsv([
    ['order_no', 'customer_name', 'email', 'phone', 'company', 'address1', 'address2', 'city', 'state', 'zip', 'country', 'sku', 'title', 'qty', 'unit_price', 'weight_lb', 'length_in', 'width_in', 'height_in', 'package_weight_lb', 'tags'],
    ['WEB-2001', 'Jordan Blake', 'jordan.blake@example.com', '+1 (512) 555-0101', '', '600 Congress Ave', 'Apt 5C', 'Austin', 'TX', '78701', 'US', 'CER-MUG-12', 'Handmade Ceramic Mug 12oz', '2', '28.00', '0.9', '12', '10', '6', '2.6', 'gift'],
    ['WEB-2001', 'Jordan Blake', 'jordan.blake@example.com', '+1 (512) 555-0101', '', '600 Congress Ave', 'Apt 5C', 'Austin', 'TX', '78701', 'US', 'SOP-OLV-3', 'Olive Oil Soap Set of 3', '1', '18.00', '0.8', '', '', '', '', ''],
    ['WEB-2002', 'Priya Raman', 'priya.raman@example.com', '', 'Raman Studio', '1450 Market St', 'Suite 210', 'San Francisco', 'CA', '94103', 'US', '', 'Linen Tea Towel', '3', '14.50', '0.3', '', '', '', '', 'wholesale'],
  ])
}

export function importOrders(inputs, { onProgress } = {}) {
  return request('POST /v1/orders/import', async () => {
    if (!inputs?.length) throw new ApiError('CSV_EMPTY', 'Nothing to import', 422)
    const created = []
    await runSteps(inputs.map(inp => async () => {
      validateOrderInput(inp)
      const o = await insertOrderRecord({ ...inp, channel: 'manual' }, { channel: 'manual', eventCode: 'imported' })
      created.push(o)
    }), onProgress, { stepMs: [30, 70] })
    const problems = created.filter(o => o.addressCheck.score < 70).length
    audit('order.import', `${created.length}`, created.map(o => o.id).join(', '))
    modelEvent('address', 'predict', { count: created.length, problems, source: 'csv_import' })
    notify({
      type: problems ? 'warning' : 'success',
      title: { tr: `CSV ile ${created.length} sipariş içe aktarıldı`, en: `${created.length} orders imported from CSV` },
      body: problems ? { tr: `${problems} siparişte adres sorunu var.`, en: `${problems} orders have address issues.` } : null,
      link: '/orders',
    })
    return created
  }, { minMs: 300, maxMs: 600 })
}

export function exportOrdersCsv(idsOrOrders = null) {
  let list = db.all('orders')
  if (Array.isArray(idsOrOrders)) list = idsOrOrders.map(x => (typeof x === 'string' ? db.get('orders', x) : x)).filter(Boolean)
  const rows = [['order_id', 'channel', 'channel_order_no', 'created_at', 'status', 'customer_name', 'email', 'phone', 'company', 'address1', 'address2', 'city', 'state', 'zip', 'country', 'items', 'total_usd', 'address_score', 'shipment_id', 'tags']]
  for (const o of list) {
    rows.push([o.id, o.channel, o.channelOrderNo, o.createdAt, o.status, o.customer?.name, o.customer?.email, o.customer?.phone, o.shipTo?.company, o.shipTo?.line1, o.shipTo?.line2, o.shipTo?.city, o.shipTo?.state, o.shipTo?.zip, o.shipTo?.country,
      (o.items ?? []).map(i => `${i.qty}x ${i.sku ?? i.title}`).join(' | '), o.total, o.addressCheck?.score ?? '', o.shipmentId ?? '', (o.tags ?? []).join('|')])
  }
  return toCsv(rows)
}
