/**
 * API console router (spec 7.5). Routes sandbox requests typed in the panel to the REAL fake-API
 * functions (rate engine, shipment creation with wallet charge, tracking, orders, ...) under
 * withSource('api'), so the request log shows them as API traffic.
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * API_BASE_URL = 'https://api.kargopazar.com/v1'
 * API_VERSION  = '2026-10-01'
 * CONSOLE_ENDPOINTS: [{ id, method, path, scope, params: [{ name, example }], body: 'json'|'query'|null,
 *                       sample (object), request: Field[], response: Field[], responseSample (object) }]
 *   Field = { name, key, type, required? }   descriptions: t('apiConsole.fields.<key>')
 *   endpoint descriptions: t('apiConsole.endpoints.<id>.title' | '.desc')
 * getEndpoint(id) -> endpoint
 * buildPath(endpoint, params) -> '/v1/shipments/SHP-20931'
 * curlSample(endpoint, { key? }) / jsSample(endpoint, { key? }) -> string
 * sendConsoleRequest({ endpointId, params, body: string, apiKeyId }) ->
 *   { status, ok, ms, method, path, url, headers: { [name]: value }, body: object, requestId, test }
 *   Never throws: invalid JSON -> 400 INVALID_JSON, no/revoked key -> 401, missing scope -> 403,
 *   ApiError -> its status with { error: { code, message, details } }.
 */
import { withSource, ApiError, request, logRequest } from './client.js'
import { db } from '../store/db.js'
import { touchApiKey, isTestKey } from './apiKeys.js'
import { quoteShipment } from './rates.js'
import { createShipment, getShipment, voidLabel, trackLookup } from './shipments.js'
import { listOrders, createOrder } from './orders.js'
import { validateAddress, suggestHs } from './ai.js'
import { getForecast } from './forecast.js'
import { createEndpoint } from './webhooks.js'
import { nextFormattedId } from './integrations.js'
import { audit } from '../store/events.js'

export const API_BASE_URL = 'https://api.kargopazar.com/v1'
export const API_VERSION = '2026-10-01'

const SAMPLE_TO = { name: 'Jordan Blake', line1: '9500 Wilshire Blvd', line2: '', city: 'Beverly Hills', state: 'CA', zip: '90210', country: 'US', residential: true }
const SAMPLE_PKG = { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 3 }

function lastShipmentId() {
  const s = db.all('shipments').find(x => x.status === 'label_created') ?? db.all('shipments')[0]
  return s?.id ?? 'SHP-20930'
}
function lastTrackingNo() {
  const s = db.all('shipments').find(x => !x.test && x.status === 'in_transit') ?? db.all('shipments')[0]
  return s?.trackingNo ?? '1ZR8W4820310944230'
}

const F = (name, type, required = false) => ({ name, key: name.replace(/[.[\]]+/g, '_').replace(/_$/, ''), type, required })
const ADDRESS_FIELDS = [F('to.name', 'string', true), F('to.line1', 'string', true), F('to.line2', 'string'), F('to.city', 'string', true), F('to.state', 'string', true), F('to.zip', 'string', true), F('to.country', 'string'), F('to.residential', 'boolean')]
const PACKAGE_FIELDS = [F('package.lengthIn', 'number', true), F('package.widthIn', 'number', true), F('package.heightIn', 'number', true), F('package.weightLb', 'number', true)]

export const CONSOLE_ENDPOINTS = [
  {
    id: 'rates', method: 'POST', path: '/v1/rates', scope: 'rates:read', params: [], body: 'json',
    sample: () => ({ hub: 'NJ01', to: { ...SAMPLE_TO }, package: { ...SAMPLE_PKG }, declaredValue: 85 }),
    request: [F('hub', 'string'), ...ADDRESS_FIELDS, ...PACKAGE_FIELDS, F('declaredValue', 'number'), F('insured', 'boolean'), F('signature', 'boolean')],
    response: [F('hub', 'string'), F('zone', 'integer'), F('billableLb', 'number'), F('recommended', 'string'), F('cheapest', 'string'), F('fastest', 'string'), F('rates[]', 'array')],
    responseSample: { object: 'rate_quote', hub: 'NJ01', zone: 8, billableLb: 3, currency: 'USD', recommended: 'USPS-PM', cheapest: 'USPS-GA', fastest: 'UPS-NDAS', rates: [{ id: 'USPS-PM', carrier: 'USPS', service: 'PM', serviceName: 'Priority Mail', total: 14.62, etaDays: 3, etaDate: '2026-10-02', badges: ['ai'] }] },
  },
  {
    id: 'createShipment', method: 'POST', path: '/v1/shipments', scope: 'shipments:write', params: [], body: 'json',
    sample: () => ({ hub: 'NJ01', to: { ...SAMPLE_TO }, package: { ...SAMPLE_PKG }, declaredValue: 85, service: null, reference: 'ERP-55012' }),
    request: [F('orderId', 'string'), F('hub', 'string'), ...ADDRESS_FIELDS, ...PACKAGE_FIELDS, F('declaredValue', 'number'), F('service', 'string'), F('reference', 'string')],
    response: [F('id', 'string'), F('status', 'string'), F('trackingNo', 'string'), F('carrier', 'string'), F('service', 'string'), F('total', 'number'), F('charged', 'number'), F('walletBalance', 'number'), F('test', 'boolean')],
    responseSample: { id: 'SHP-20931', object: 'shipment', status: 'label_created', test: false, trackingNo: '9405511206213541267890', carrier: 'USPS', service: 'PM', total: 14.62, charged: 14.62, walletBalance: 1233.98, labelUrl: 'https://api.kargopazar.com/v1/shipments/SHP-20931/label.pdf' },
  },
  {
    id: 'getShipment', method: 'GET', path: '/v1/shipments/{id}', scope: 'tracking:read', params: [{ name: 'id', example: lastShipmentId }], body: null,
    sample: () => null,
    request: [F('id', 'string', true)],
    response: [F('id', 'string'), F('status', 'string'), F('trackingNo', 'string'), F('events[]', 'array'), F('breakdown[]', 'array')],
    responseSample: { id: 'SHP-20931', object: 'shipment', status: 'in_transit', trackingNo: '9405511206213541267890', carrier: 'USPS', events: [{ at: '2026-09-29T14:05:00Z', code: 'picked_up', loc: 'Carlstadt, NJ' }] },
  },
  {
    id: 'voidShipment', method: 'POST', path: '/v1/shipments/{id}/void', scope: 'shipments:write', params: [{ name: 'id', example: lastShipmentId }], body: 'json',
    sample: () => ({ reason: 'duplicate' }),
    request: [F('id', 'string', true), F('reason', 'string')],
    response: [F('id', 'string'), F('status', 'string'), F('refund', 'object')],
    responseSample: { id: 'SHP-20931', object: 'shipment', status: 'voided', refund: { amount: 14.62, status: 'pending' } },
  },
  {
    id: 'tracking', method: 'GET', path: '/v1/tracking/{trackingNo}', scope: 'tracking:read', params: [{ name: 'trackingNo', example: lastTrackingNo }], body: null,
    sample: () => null,
    request: [F('trackingNo', 'string', true)],
    response: [F('trackingNo', 'string'), F('status', 'string'), F('eta', 'string'), F('events[]', 'array')],
    responseSample: { object: 'tracking', trackingNo: '1ZR8W4820310944230', carrier: 'UPS', status: 'in_transit', step: 2, eta: '2026-10-01', events: [{ at: '2026-09-29T09:12:00Z', code: 'departed', loc: 'Secaucus, NJ' }] },
  },
  {
    id: 'listOrders', method: 'GET', path: '/v1/orders', scope: 'orders:read', params: [], body: 'query',
    sample: () => ({ status: 'awaiting_shipment', limit: 5 }),
    request: [F('status', 'string'), F('channel', 'string'), F('q', 'string'), F('limit', 'integer')],
    response: [F('data[]', 'array'), F('total', 'integer'), F('hasMore', 'boolean')],
    responseSample: { object: 'list', total: 52, hasMore: true, data: [{ id: 'ORD-10482', channel: 'shopify', channelOrderNo: '#5288', status: 'awaiting_shipment', addressScore: 94 }] },
  },
  {
    id: 'createOrder', method: 'POST', path: '/v1/orders', scope: 'orders:write', params: [], body: 'json',
    sample: () => ({ channelOrderNo: 'ERP-55013', customer: { name: 'Jordan Blake', email: 'jordan.blake@example.com' }, shipTo: { ...SAMPLE_TO }, items: [{ sku: 'KP-MUG-001', title: 'Handmade Ceramic Mug', qty: 2, unitPrice: 24 }] }),
    request: [F('channelOrderNo', 'string'), F('customer.name', 'string', true), F('customer.email', 'string'), F('shipTo', 'object', true), F('items[]', 'array', true), F('package', 'object')],
    response: [F('id', 'string'), F('status', 'string'), F('addressScore', 'integer'), F('addressIssues[]', 'array')],
    responseSample: { id: 'ORD-10483', object: 'order', channel: 'api', status: 'awaiting_shipment', addressScore: 96, addressIssues: [] },
  },
  {
    id: 'createManifest', method: 'POST', path: '/v1/manifests', scope: 'shipments:write', params: [], body: 'json',
    sample: () => ({ carrier: 'USPS', hub: 'NJ01' }),
    request: [F('carrier', 'string', true), F('hub', 'string', true), F('shipmentIds[]', 'array')],
    response: [F('id', 'string'), F('formType', 'string'), F('shipmentIds[]', 'array'), F('totals', 'object')],
    responseSample: { id: 'MNF-0412', object: 'manifest', carrier: 'USPS', hub: 'NJ01', formType: 'usps_scan_form', status: 'created', shipmentIds: ['SHP-20929', 'SHP-20930'], totals: { parcels: 2, weightLb: 7.4 } },
  },
  {
    id: 'validateAddress', method: 'POST', path: '/v1/addresses/validate', scope: 'orders:read', params: [], body: 'json',
    sample: () => ({ line1: '350 Fifth Avenue', line2: '', city: 'New York', state: 'NY', zip: '10118', country: 'US' }),
    request: [F('line1', 'string', true), F('line2', 'string'), F('city', 'string', true), F('state', 'string', true), F('zip', 'string', true), F('country', 'string')],
    response: [F('score', 'integer'), F('issues[]', 'array'), F('suggestion', 'object'), F('modelVersion', 'string')],
    responseSample: { object: 'address_check', score: 58, deliverable: false, issues: [{ code: 'missing_unit', field: 'line2' }], suggestion: { line2: 'Apt 4B' }, modelVersion: 'addr-ml v1.3' },
  },
  {
    id: 'hsSuggest', method: 'POST', path: '/v1/hs-codes/suggest', scope: 'orders:read', params: [], body: 'json',
    sample: () => ({ title: 'handwoven wool kilim pillow case 16x16', description: '' }),
    request: [F('title', 'string', true), F('description', 'string')],
    response: [F('suggestions[]', 'array'), F('confidence', 'number'), F('lowConfidence', 'boolean')],
    responseSample: { object: 'hs_suggestion', confidence: 0.98, lowConfidence: false, suggestions: [{ code: '6304.92', probability: 0.98, description: 'Cushion covers, cotton' }] },
  },
  {
    id: 'forecast', method: 'GET', path: '/v1/forecast', scope: 'orders:read', params: [], body: 'query',
    sample: () => ({ series: 'total', weeks: 8 }),
    request: [F('series', 'string'), F('weeks', 'integer')],
    response: [F('series', 'string'), F('modelVersion', 'string'), F('mape', 'number'), F('forecast[]', 'array')],
    responseSample: { object: 'forecast', series: 'total', modelVersion: 'forecast v2.1', mape: 0.046, forecast: [{ weekStart: '2026-10-05', yhat: 142, lo80: 131, hi80: 153 }] },
  },
  {
    id: 'createWebhook', method: 'POST', path: '/v1/webhooks', scope: 'webhooks:manage', params: [], body: 'json',
    sample: () => ({ url: 'https://example.com/webhooks/kargopazar', events: ['shipment.created', 'tracking.updated'], description: 'Console test' }),
    request: [F('url', 'string', true), F('events[]', 'array', true), F('description', 'string')],
    response: [F('id', 'string'), F('url', 'string'), F('events[]', 'array'), F('secret', 'string')],
    responseSample: { id: 'WH-03', object: 'webhook_endpoint', url: 'https://example.com/webhooks/kargopazar', events: ['shipment.created'], status: 'active', secret: 'whsec_5f0c...' },
  },
]

export function getEndpoint(id) { return CONSOLE_ENDPOINTS.find(e => e.id === id) }

export function sampleBody(ep) {
  const s = typeof ep.sample === 'function' ? ep.sample() : ep.sample
  return s == null ? '' : JSON.stringify(s, null, 2)
}

export function defaultParams(ep) {
  const out = {}
  for (const p of ep.params ?? []) out[p.name] = typeof p.example === 'function' ? p.example() : p.example
  return out
}

export function buildPath(ep, params = {}) {
  return ep.path.replace(/\{(\w+)\}/g, (m, k) => encodeURIComponent(params[k] ?? `{${k}}`))
}

function queryString(obj) {
  const q = Object.entries(obj ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return q ? '?' + q : ''
}

export function curlSample(ep, { key = 'kp_live_xxxxxxxxxxxx', params } = {}) {
  const p = params ?? defaultParams(ep)
  const path = buildPath(ep, p).replace(/^\/v1/, '')
  const sample = typeof ep.sample === 'function' ? ep.sample() : ep.sample
  const url = API_BASE_URL + path + (ep.body === 'query' ? queryString(sample) : '')
  const lines = [`curl -X ${ep.method} "${url}" \\`, `  -H "Authorization: Bearer ${key}" \\`, `  -H "KP-Version: ${API_VERSION}"`]
  if (ep.body === 'json' && sample) {
    lines[lines.length - 1] += ' \\'
    lines.push('  -H "Content-Type: application/json" \\')
    lines.push(`  -d '${JSON.stringify(sample)}'`)
  }
  return lines.join('\n')
}

export function jsSample(ep, { key = 'kp_live_xxxxxxxxxxxx', params } = {}) {
  const p = params ?? defaultParams(ep)
  const path = buildPath(ep, p).replace(/^\/v1/, '')
  const sample = typeof ep.sample === 'function' ? ep.sample() : ep.sample
  const url = API_BASE_URL + path + (ep.body === 'query' ? queryString(sample) : '')
  const body = ep.body === 'json' && sample ? `,\n  body: JSON.stringify(${JSON.stringify(sample, null, 2).replace(/\n/g, '\n  ')})` : ''
  return `const res = await fetch('${url}', {\n  method: '${ep.method}',\n  headers: {\n    'Authorization': 'Bearer ${key}',\n    'KP-Version': '${API_VERSION}',${ep.body === 'json' ? "\n    'Content-Type': 'application/json'," : ''}\n  }${body}\n})\nconst data = await res.json()`
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const round2 = n => Math.round(Number(n) * 100) / 100
let rateRemaining = 600

function mapAddress(a = {}) {
  return { name: a.name ?? '', company: a.company ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', state: a.state ?? '', zip: a.zip != null ? String(a.zip) : '', country: a.country ?? 'US', residential: a.residential !== false }
}
function mapPkg(p) {
  if (!p) return p
  return { lengthIn: Number(p.lengthIn), widthIn: Number(p.widthIn), heightIn: Number(p.heightIn), weightLb: Number(p.weightLb) }
}

function shipmentView(s, extra = {}) {
  return {
    id: s.id, object: 'shipment', status: s.status, test: !!s.test, orderId: s.orderId ?? null, reference: s.reference ?? null,
    trackingNo: s.trackingNo, carrier: s.carrier, service: s.service, hub: s.hub, zone: s.zone, billableLb: s.billableLb,
    total: s.total ?? s.price, charged: s.walletCharge ?? 0, currency: 'USD', eta: s.eta ?? null,
    labelUrl: `${API_BASE_URL}/shipments/${s.id}/label.pdf`, createdAt: s.createdAt, ...extra,
  }
}

async function loadManifestsApi() {
  const mods = import.meta.glob('./manifests.js')
  const loader = mods['./manifests.js']
  if (!loader) return null
  try { return await loader() } catch { return null }
}

async function createManifestRoute(body) {
  const carrier = String(body.carrier ?? '').toUpperCase()
  const hub = String(body.hub ?? '').toUpperCase()
  const errors = {}
  if (!carrier) errors.carrier = 'required'
  else if (!db.get('carriers', carrier)) errors.carrier = 'invalid'
  if (!hub) errors.hub = 'required'
  else if (!['NJ01', 'LA01'].includes(hub)) errors.hub = 'invalid'
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid manifest request', 422, errors)
  const mod = await loadManifestsApi()
  if (mod && typeof mod.createManifest === 'function') {
    try {
      const m = await mod.createManifest({ carrier, hub, shipmentIds: body.shipmentIds, type: 'carrier', source: 'api' })
      const rec = m?.manifest ?? m
      if (rec?.id) return { id: rec.id, object: 'manifest', carrier, hub, formType: rec.formType, status: rec.status, shipmentIds: rec.shipmentIds, totals: rec.totals, createdAt: rec.createdAt }
    } catch (e) {
      if (e instanceof ApiError) throw e
    }
  }
  // Built-in fallback: collect unmanifested labels of this carrier/hub
  return request('POST /v1/manifests', async () => {
    let list = db.all('shipments').filter(s => s.carrier === carrier && s.hub === hub && s.status === 'label_created' && !s.manifestId && !s.test)
    if (Array.isArray(body.shipmentIds) && body.shipmentIds.length) list = list.filter(s => body.shipmentIds.includes(s.id))
    if (!list.length) throw new ApiError('NO_SHIPMENTS', 'No open labels for this carrier and hub', 409)
    const rec = await db.transaction(() => {
      const id = nextFormattedId('MNF')
      const r = {
        id, type: 'carrier', hub, carrier, formType: carrier === 'USPS' ? 'usps_scan_form' : 'end_of_day', createdAt: new Date().toISOString(), status: 'created', source: 'api',
        shipmentIds: list.map(s => s.id), totals: { parcels: list.length, weightLb: round2(list.reduce((a, s) => a + (s.package?.weightLb ?? 0), 0)) },
      }
      db.insert('manifests', r)
      for (const s of list) db.update('shipments', s.id, { manifestId: id })
      return r
    })
    audit('manifest.create', rec.id, `${carrier} ${hub} (api)`)
    return { id: rec.id, object: 'manifest', carrier, hub, formType: rec.formType, status: rec.status, shipmentIds: rec.shipmentIds, totals: rec.totals, createdAt: rec.createdAt }
  }, { minMs: 500, maxMs: 900 })
}

async function route(ep, params, body, key) {
  const test = isTestKey(key)
  switch (ep.id) {
    case 'rates': {
      const r = await quoteShipment({ hub: body.hub, to: mapAddress(body.to), pkg: mapPkg(body.package ?? body.pkg), declaredValue: body.declaredValue, insured: body.insured, signature: body.signature })
      return {
        object: 'rate_quote', hub: r.hub, hubAssignedBy: r.hubAssignedBy ?? null, zone: r.zone, billableLb: r.billable?.billableLb ?? r.quotes[0]?.billableLb ?? null, currency: 'USD',
        recommended: r.aiPickKey, cheapest: r.cheapestKey, fastest: r.fastestKey,
        rates: r.quotes.map(q => ({ id: q.key, carrier: q.carrierCode, carrierName: q.carrierName, service: q.serviceCode, serviceName: q.serviceName, source: q.source, price: q.sellPrice, insurance: q.insurance, total: q.total, etaDays: q.etaDays, etaDate: q.etaDate ?? null, badges: q.badges ?? [] })),
      }
    }
    case 'createShipment': {
      const res = await createShipment({
        orderId: body.orderId || undefined, hub: body.hub, to: body.to ? mapAddress(body.to) : undefined, pkg: mapPkg(body.package ?? body.pkg),
        declaredValue: body.declaredValue, insured: body.insured, signature: body.signature, quoteKey: body.service || body.rateId || undefined,
        reference: body.reference, apiKey: key.prefix, test, source: 'api',
      })
      return shipmentView(res.shipment, { walletBalance: res.balance, orderStatus: res.order?.status ?? null })
    }
    case 'getShipment': {
      const s = await getShipment(params.id)
      return shipmentView(s, { events: s.events, breakdown: s.breakdown, to: s.to, package: s.package })
    }
    case 'voidShipment': {
      const r = await voidLabel(params.id, { reason: body.reason ?? null })
      return { id: r.shipment.id, object: 'shipment', status: r.shipment.status, refund: r.refund ? { amount: r.refund.amount, status: r.refund.status } : null, walletBalance: r.balance }
    }
    case 'tracking': {
      const [hit] = await trackLookup(params.trackingNo)
      if (!hit?.found) throw new ApiError('NOT_FOUND', 'Tracking number not found', 404, { trackingNo: params.trackingNo })
      return { object: 'tracking', ...hit.result }
    }
    case 'listOrders': {
      const list = await listOrders({ status: body.status, channel: body.channel, q: body.q })
      const limit = Math.max(1, Math.min(100, Number(body.limit) || 25))
      return {
        object: 'list', total: list.length, hasMore: list.length > limit,
        data: list.slice(0, limit).map(o => ({ id: o.id, channel: o.channel, channelOrderNo: o.channelOrderNo, createdAt: o.createdAt, status: o.status, customer: o.customer?.name, shipTo: { city: o.shipTo?.city, state: o.shipTo?.state, zip: o.shipTo?.zip }, items: (o.items ?? []).length, total: o.total ?? null, addressScore: o.addressCheck?.score ?? null, shipmentId: o.shipmentId ?? null })),
      }
    }
    case 'createOrder': {
      const o = await createOrder({ ...body, channel: 'api', shipTo: body.shipTo ? mapAddress(body.shipTo) : undefined })
      return { id: o.id, object: 'order', channel: o.channel, channelOrderNo: o.channelOrderNo, status: o.status, addressScore: o.addressCheck?.score ?? null, addressIssues: (o.addressCheck?.issues ?? []).map(i => i.code ?? i), package: o.package, createdAt: o.createdAt }
    }
    case 'createManifest': return createManifestRoute(body)
    case 'validateAddress': {
      const r = await validateAddress(mapAddress(body), { source: 'api' })
      return { object: 'address_check', score: r.score, deliverable: r.score >= 70, issueType: r.issueType ?? null, issues: (r.issues ?? []).map(i => ({ code: i.code, field: i.field, severity: i.severity })), suggestion: r.suggestion?.patch ?? null, residential: r.residential?.value ?? null, modelVersion: r.modelVersion }
    }
    case 'hsSuggest': {
      const r = await suggestHs(body.title, body.description ?? '', { source: 'api' })
      return { object: 'hs_suggestion', confidence: r.confidence, lowConfidence: r.lowConfidence, modelVersion: r.modelVersion, suggestions: r.top.map(x => ({ code: x.code, probability: x.prob, description: x.desc?.en ?? x.customsDesc ?? null })) }
    }
    case 'forecast': {
      const f = await getForecast(body.series || 'total')
      const weeks = Math.max(1, Math.min(12, Number(body.weeks) || 8))
      return { object: 'forecast', series: body.series || 'total', modelVersion: f.label ?? f.version, mape: f.metrics?.mape ?? null, summary: f.summary ? { next4: f.summary.next4, last4: f.summary.last4, changePct: f.summary.changePct } : null, forecast: f.forecast.slice(0, weeks).map(w => ({ weekStart: w.weekStart, yhat: w.yhat, lo80: w.lo80, hi80: w.hi80, lo95: w.lo95, hi95: w.hi95 })) }
    }
    case 'createWebhook': {
      const r = await createEndpoint({ url: body.url, events: body.events, description: body.description })
      return { id: r.endpoint.id, object: 'webhook_endpoint', url: r.endpoint.url, events: r.endpoint.events, status: r.endpoint.status, secret: r.secret, createdAt: r.endpoint.createdAt }
    }
    default: throw new ApiError('NOT_FOUND', 'Unknown endpoint', 404)
  }
}

function reqId() { return 'req_' + Math.random().toString(36).slice(2, 12) }

function errorBody(code, message, details) {
  return { error: { code, message, ...(details ? { details } : {}) } }
}

export async function sendConsoleRequest({ endpointId, params = {}, body = '', apiKeyId } = {}) {
  const ep = getEndpoint(endpointId)
  const started = performance.now()
  const requestId = reqId()
  const key = apiKeyId ? db.get('api_keys', apiKeyId) : null
  const test = isTestKey(key)
  const path = ep ? buildPath(ep, params) : '/v1/unknown'
  const finish = (status, payload) => {
    const ms = Math.round(performance.now() - started)
    rateRemaining = Math.max(0, rateRemaining - 1)
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
      'kp-version': API_VERSION,
      'kp-environment': key ? (test ? 'test' : 'live') : '-',
      'x-ratelimit-limit': '600',
      'x-ratelimit-remaining': String(rateRemaining),
      'x-response-time': `${ms}ms`,
    }
    if (status === 401) headers['www-authenticate'] = 'Bearer realm="kargopazar"'
    return { status, ok: status < 400, ms, method: ep?.method ?? 'GET', path, url: API_BASE_URL + path.replace(/^\/v1/, ''), headers, body: payload, requestId, test }
  }
  // Pre-flight errors are still logged as API traffic (they never reach a handler)
  const logOnly = async (status, name) => { logRequest(requestId, name, status, started, { source: 'api' }) }
  if (!ep) return finish(404, errorBody('NOT_FOUND', 'Unknown endpoint'))
  const name = `${ep.method} ${path}`
  let parsed = {}
  if (ep.body) {
    const src = String(body ?? '').trim()
    if (src) {
      try { parsed = JSON.parse(src) } catch (e) {
        await logOnly(400, name)
        return finish(400, errorBody('INVALID_JSON', 'Request body is not valid JSON', { parser: String(e.message || e) }))
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        await logOnly(400, name)
        return finish(400, errorBody('INVALID_BODY', 'Request body must be a JSON object'))
      }
    }
  }
  if (!key) { await logOnly(401, name); return finish(401, errorBody('UNAUTHORIZED', 'Missing API key')) }
  if (key.status === 'revoked') { await logOnly(401, name); return finish(401, errorBody('KEY_REVOKED', 'This API key has been revoked')) }
  if (!(key.scopes ?? []).includes(ep.scope)) { await logOnly(403, name); return finish(403, errorBody('INSUFFICIENT_SCOPE', `This key is missing the ${ep.scope} scope`, { required: ep.scope, granted: key.scopes })) }
  for (const p of ep.params ?? []) {
    if (!String(params[p.name] ?? '').trim()) { await logOnly(400, name); return finish(400, errorBody('VALIDATION', `Path parameter "${p.name}" is required`, { [p.name]: 'required' })) }
  }
  touchApiKey(key.id)
  try {
    const out = await withSource('api', () => route(ep, params, parsed, key))
    const status = ep.method === 'POST' && ['createShipment', 'createOrder', 'createManifest', 'createWebhook'].includes(ep.id) ? 201 : 200
    if (status === 201) {
      // The inner handler logged its own 200; align the request log with the HTTP status the caller got
      const since = Date.now() - (performance.now() - started) - 50
      const entry = db.find('requestLog', r => r.source === 'api' && r.method === 'POST' && r.status === 200 && r.path === ep.path && Date.parse(r.at) >= since)
      if (entry) db.update('requestLog', entry.id, { status: 201 })
    }
    return finish(status, out)
  } catch (e) {
    if (e instanceof ApiError) return finish(e.status || 400, errorBody(e.code, e.message, e.details))
    return finish(500, errorBody('INTERNAL', String(e?.message || e)))
  }
}
