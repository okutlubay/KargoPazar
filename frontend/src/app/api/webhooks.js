/**
 * Webhook endpoints and deliveries (spec 7.5). Data lives in the `webhooks` document:
 * { endpoints: [...], deliveries: [...] }. shipments.js also appends deliveries (shipment.created,
 * tracking.updated) for active subscribers.
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * WEBHOOK_EVENTS = ['shipment.created', 'shipment.delivered', 'tracking.updated', 'adjustment.created', 'order.imported']
 * validateEndpointInput({ url, events }) -> { valid, errors: { url?: 'required'|'https_url', events?: 'required' } }  (sync)
 * listEndpoints() -> Endpoint[] (+ stats: { total, failed, successRate })
 *   Endpoint = { id, url, description?, events[], status: 'active'|'inactive', secretMasked, createdAt, lastDeliveryAt }
 * createEndpoint({ url, events, description? }) -> { endpoint, secret }   secret 'whsec_...' returned once
 * updateEndpoint(id, { url?, events?, description?, status? }) -> Endpoint
 * deleteEndpoint(id) -> { endpoint, deliveries }    (keep the return value for restoreEndpoint)
 * restoreEndpoint(snapshot) -> Endpoint             undo for deleteEndpoint
 * sendTestEvent(id, event?) -> Delivery             signed test payload; hosts ending in .invalid or
 *                                                   'localhost' fail with 500 (demo failure scenario)
 * listDeliveries({ endpointId?, result?: 'delivered'|'failed', event?, limit? }) -> Delivery[] newest first
 *   Delivery = { id, endpointId, event, at, status, attempts, durationMs, result, payload, test?, resentAt?, resendOf?, response? }
 * resendDelivery(id) -> { delivery, original }       failed deliveries only (NOT_RETRYABLE otherwise)
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit } from '../store/events.js'
import { nextFormattedId } from './integrations.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()

export const WEBHOOK_EVENTS = ['shipment.created', 'shipment.delivered', 'tracking.updated', 'adjustment.created', 'order.imported']

function doc() {
  const d = db.doc('webhooks')
  if (!d.endpoints) db.patchDoc('webhooks', { endpoints: [], deliveries: [] })
  return db.doc('webhooks')
}

export function validateEndpointInput({ url, events } = {}) {
  const errors = {}
  const u = String(url ?? '').trim()
  if (!u) errors.url = 'required'
  else if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?(\/[^\s]*)?$/i.test(u)) errors.url = 'https_url'
  if (!Array.isArray(events) || !events.filter(e => WEBHOOK_EVENTS.includes(e)).length) errors.events = 'required'
  return { valid: Object.keys(errors).length === 0, errors }
}

function statsFor(id, deliveries) {
  const list = deliveries.filter(d => d.endpointId === id)
  const failed = list.filter(d => d.result === 'failed' && !d.resentAt).length
  const ok = list.filter(d => d.result === 'delivered').length
  return { total: list.length, failed, successRate: list.length ? ok / list.length : null }
}

export function listEndpoints() {
  return request('GET /v1/webhooks', () => {
    const d = doc()
    return d.endpoints.map(e => ({ ...plain(e), stats: statsFor(e.id, d.deliveries ?? []) }))
  }, { minMs: 250, maxMs: 500 })
}

function randHex(n) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

export function createEndpoint({ url, events, description = '' } = {}) {
  return request('POST /v1/webhooks', () => {
    const v = validateEndpointInput({ url, events })
    if (!v.valid) throw new ApiError('VALIDATION', 'Invalid webhook endpoint', 422, v.errors)
    const d = doc()
    const u = String(url).trim()
    if (d.endpoints.some(e => e.url === u)) throw new ApiError('ENDPOINT_EXISTS', 'Endpoint already exists', 409, { url: 'exists' })
    const secret = 'whsec_' + randHex(32)
    const endpoint = {
      id: nextFormattedId('WH'),
      url: u,
      description: String(description ?? '').trim(),
      events: WEBHOOK_EVENTS.filter(e => events.includes(e)),
      status: 'active',
      secretMasked: 'whsec_••••' + secret.slice(-4),
      createdAt: nowIso(),
      lastDeliveryAt: null,
    }
    db.patchDoc('webhooks', x => ({ endpoints: [...x.endpoints, endpoint] }))
    audit('webhook.create', endpoint.id, u)
    return { endpoint: plain(endpoint), secret }
  }, { minMs: 450, maxMs: 800 })
}

export function updateEndpoint(id, patch = {}) {
  return request(`PATCH /v1/webhooks/${id}`, () => {
    const d = doc()
    const cur = d.endpoints.find(e => e.id === id)
    if (!cur) throw new ApiError('NOT_FOUND', 'Endpoint not found', 404)
    const next = { ...plain(cur) }
    if (patch.url != null || patch.events != null) {
      const v = validateEndpointInput({ url: patch.url ?? cur.url, events: patch.events ?? cur.events })
      if (!v.valid) throw new ApiError('VALIDATION', 'Invalid webhook endpoint', 422, v.errors)
      if (patch.url != null) {
        const u = String(patch.url).trim()
        if (d.endpoints.some(e => e.id !== id && e.url === u)) throw new ApiError('ENDPOINT_EXISTS', 'Endpoint already exists', 409, { url: 'exists' })
        next.url = u
      }
      if (patch.events != null) next.events = WEBHOOK_EVENTS.filter(e => patch.events.includes(e))
    }
    if (patch.description != null) next.description = String(patch.description).trim()
    if (patch.status != null) {
      if (!['active', 'inactive'].includes(patch.status)) throw new ApiError('VALIDATION', 'Invalid status', 422, { status: 'invalid' })
      next.status = patch.status
    }
    db.patchDoc('webhooks', x => ({ endpoints: x.endpoints.map(e => (e.id === id ? next : e)) }))
    audit('webhook.update', id, Object.keys(patch).join(', '))
    return { ...next, stats: statsFor(id, doc().deliveries ?? []) }
  }, { minMs: 300, maxMs: 600 })
}

export function deleteEndpoint(id) {
  return request(`DELETE /v1/webhooks/${id}`, () => {
    const d = doc()
    const endpoint = d.endpoints.find(e => e.id === id)
    if (!endpoint) throw new ApiError('NOT_FOUND', 'Endpoint not found', 404)
    const index = d.endpoints.indexOf(endpoint)
    const deliveries = (d.deliveries ?? []).filter(x => x.endpointId === id)
    db.patchDoc('webhooks', x => ({ endpoints: x.endpoints.filter(e => e.id !== id), deliveries: (x.deliveries ?? []).filter(v => v.endpointId !== id) }))
    audit('webhook.delete', id, endpoint.url)
    return { endpoint: plain(endpoint), deliveries: plain(deliveries), index }
  }, { minMs: 350, maxMs: 700 })
}

export function restoreEndpoint(snapshot) {
  return request('POST /v1/webhooks/restore', () => {
    if (!snapshot?.endpoint) throw new ApiError('VALIDATION', 'Nothing to restore', 422)
    const d = doc()
    if (d.endpoints.some(e => e.id === snapshot.endpoint.id)) return plain(snapshot.endpoint)
    db.patchDoc('webhooks', x => {
      const eps = [...x.endpoints]
      eps.splice(Math.min(snapshot.index ?? eps.length, eps.length), 0, snapshot.endpoint)
      const all = [...snapshot.deliveries, ...(x.deliveries ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))
      return { endpoints: eps, deliveries: all }
    })
    audit('webhook.restore', snapshot.endpoint.id, snapshot.endpoint.url)
    return plain(snapshot.endpoint)
  }, { minMs: 250, maxMs: 450 })
}

function failsFor(url) {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h.endsWith('.invalid') || h.endsWith('.local')
  } catch { return true }
}

function sampleData(event) {
  const s = db.all('shipments').find(x => !x.test && x.status !== 'voided') ?? {}
  const o = db.all('orders')[0] ?? {}
  switch (event) {
    case 'order.imported': return { orderId: o.id ?? 'ORD-10482', channel: o.channel ?? 'shopify', channelOrderNo: o.channelOrderNo ?? '#5301', items: (o.items ?? []).length }
    case 'adjustment.created': return { adjustmentId: 'ADJ-1018', shipmentId: s.id ?? 'SHP-20930', delta: 4.2, currency: 'USD', reason: 'reweigh' }
    case 'shipment.delivered': return { shipmentId: s.id, trackingNo: s.trackingNo, carrier: s.carrier, status: 'delivered' }
    case 'tracking.updated': return { shipmentId: s.id, trackingNo: s.trackingNo, carrier: s.carrier, status: 'in_transit', location: 'Secaucus, NJ' }
    default: return { shipmentId: s.id, trackingNo: s.trackingNo, carrier: s.carrier, status: 'label_created' }
  }
}

function makeDelivery(ep, event, payload, extra = {}) {
  const fail = failsFor(ep.url)
  return {
    id: nextFormattedId('DLV'),
    endpointId: ep.id,
    event,
    at: nowIso(),
    status: fail ? 500 : 200,
    attempts: extra.attempts ?? 1,
    durationMs: fail ? 4800 + Math.round(Math.random() * 190) : 70 + Math.round(Math.random() * 260),
    result: fail ? 'failed' : 'delivered',
    payload,
    response: fail ? { error: 'connection_refused' } : { received: true },
    ...extra,
  }
}

function pushDelivery(del, epId) {
  db.patchDoc('webhooks', x => ({
    deliveries: [del, ...(x.deliveries ?? [])].slice(0, 300),
    endpoints: x.endpoints.map(e => (e.id === epId ? { ...e, lastDeliveryAt: del.at } : e)),
  }))
}

export function sendTestEvent(id, event) {
  return request(`POST /v1/webhooks/${id}/test`, () => {
    const ep = doc().endpoints.find(e => e.id === id)
    if (!ep) throw new ApiError('NOT_FOUND', 'Endpoint not found', 404)
    const ev = event && WEBHOOK_EVENTS.includes(event) ? event : ep.events[0] ?? 'shipment.created'
    const payload = { id: 'evt_test_' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0'), type: ev, test: true, createdAt: nowIso(), data: sampleData(ev) }
    const del = makeDelivery(ep, ev, payload, { test: true })
    pushDelivery(del, id)
    audit('webhook.test', id, `${ev} ${del.status}`)
    return plain(del)
  }, { minMs: 600, maxMs: 1100 })
}

export function listDeliveries(p = {}) {
  return request('GET /v1/webhooks/deliveries', () => {
    let list = doc().deliveries ?? []
    if (p.endpointId) list = list.filter(d => d.endpointId === p.endpointId)
    if (p.result) list = list.filter(d => d.result === p.result)
    if (p.event) list = list.filter(d => d.event === p.event)
    list = [...list].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return p.limit ? list.slice(0, p.limit) : list
  }, { minMs: 250, maxMs: 500 })
}

export function resendDelivery(id) {
  return request(`POST /v1/webhooks/deliveries/${id}/resend`, () => {
    const d = doc()
    const orig = (d.deliveries ?? []).find(x => x.id === id)
    if (!orig) throw new ApiError('NOT_FOUND', 'Delivery not found', 404)
    if (orig.result !== 'failed' || orig.resentAt) throw new ApiError('NOT_RETRYABLE', 'Only failed deliveries can be resent', 409)
    const ep = d.endpoints.find(e => e.id === orig.endpointId)
    if (!ep) throw new ApiError('NOT_FOUND', 'Endpoint not found', 404)
    const del = makeDelivery(ep, orig.event, plain(orig.payload), { attempts: (orig.attempts ?? 1) + 1, resendOf: id })
    const at = del.at
    db.patchDoc('webhooks', x => ({
      deliveries: [del, ...(x.deliveries ?? []).map(v => (v.id === id ? { ...v, resentAt: at } : v))].slice(0, 300),
      endpoints: x.endpoints.map(e => (e.id === ep.id ? { ...e, lastDeliveryAt: at } : e)),
    }))
    audit('webhook.resend', id, `${orig.event} ${del.status}`)
    return { delivery: plain(del), original: plain({ ...orig, resentAt: at }) }
  }, { minMs: 600, maxMs: 1100 })
}
