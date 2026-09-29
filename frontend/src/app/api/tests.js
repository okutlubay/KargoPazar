/**
 * Integration test runner (spec 9.4). Every scenario really calls the engines it covers
 * (rate engine, address model, postcode validation, stage machine, docs generators, carrier
 * adapter simulations) on sandbox copies and asserts the output, so a broken engine fails its test.
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * getTestData() -> { suites, runs, version }                          GET /v1/tests
 * runTests({ suiteIds?, scenarioIds?, onEvent? }) -> Run               POST /v1/tests/runs
 *   onEvent(e): { type: 'start', total } | { type: 'scenario', scenarioId, suiteId }
 *               | { type: 'log', scenarioId, line } | { type: 'result', result, done, total }
 *   line = { at, kind: 'req'|'ok'|'fail'|'info'|'head', key?, params?, method?, path?, status?, ms? }
 *   Run = { id: 'RUN-003', startedAt, finishedAt, env: 'sandbox', version, suiteIds, scope: 'all'|'suite'|'single',
 *           triggeredBy, results: [{ scenarioId, suiteId, result, durationMs, error?: {tr,en}, log }],
 *           passed, failed, skipped, passRate }
 * downloadRunReport(runId, { suiteId? }) -> filename (src/app/docs/testReport.js)
 * runScenario(scenario, emit) -> { result, error?, durationMs }       (single scenario, no persistence)
 * SCENARIO_ENGINES: engine keys implemented
 */
import { toRaw } from 'vue'
import { request, ApiError, sleep, rand } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { nextFormattedId, CHANNEL_META } from './integrations.js'
import { validateAddressSync, suggestHs } from './ai.js'
import { generateTrackingNo } from './shipments.js'
import {
  airLegLabel, applyStage, buildHawbLine, buildIntlRecord, flightFor, mapCarrierEvent, newMawb, nextStage,
  requestCollection, sandboxQuote, stageIndex, toUsdDemo, validateOriginAddress, validatePostcodeFor, STAGES,
} from './intl.js'
import { round2 } from '@/shared/rateEngine.js'
import trBundle from '../i18n/tr.js'
import enBundle from '../i18n/en.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()
const docsModule = () => import('../docs/index.js')

function lookup(bundle, key) {
  let cur = bundle
  for (const p of key.split('.')) { if (cur == null) return undefined; cur = cur[p] }
  return typeof cur === 'string' ? cur : undefined
}
function fill(str, params) { return String(str ?? '').replace(/\{(\w+)\}/g, (m, p) => (params?.[p] ?? m)) }
/** Bilingual message for persisted results ({tr,en}), from the tests i18n module. */
export function both(key, params) {
  return { tr: fill(lookup(trBundle, `tests.${key}`) ?? key, params), en: fill(lookup(enBundle, `tests.${key}`) ?? key, params) }
}

class AssertionFailed extends Error {
  constructor(key, params) { super(key); this.key = key; this.params = params }
}

function currentVersion() {
  const deploys = db.doc('system')?.deploys || []
  return (deploys.find(d => d.current) || deploys[deploys.length - 1])?.version || 'v1.0.0'
}

// ---------------------------------------------------------------------------
// Scenario context
// ---------------------------------------------------------------------------

function makeCtx(emit) {
  const x = {
    log(kind, key, params) { emit({ at: nowIso(), kind, key, params }) },
    ok(key, params) { x.log('ok', key, params) },
    info(key, params) { x.log('info', key, params) },
    /** Simulated adapter call: waits, logs "-> METHOD path status (ms)" and returns fn(). */
    async call(method, path, fn, { status = 200, ms = [40, 160] } = {}) {
      const t0 = performance.now()
      await sleep(rand(ms[0], ms[1]))
      let out
      let st = status
      try { out = await fn() } catch (e) { st = e instanceof ApiError ? (e.status || 422) : 500; emit({ at: nowIso(), kind: 'req', method, path, status: st, ms: Math.round(performance.now() - t0) }); throw e }
      emit({ at: nowIso(), kind: 'req', method, path, status: st, ms: Math.round(performance.now() - t0) })
      return out
    },
    expect(cond, key, params) { if (!cond) throw new AssertionFailed(key, params) },
    eq(actual, expected, what) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AssertionFailed('assert.expectedGot', { what, expected: JSON.stringify(expected), got: JSON.stringify(actual) })
    },
  }
  return x
}

function sampleIntl(origin, { minValue = 0, maxValue = Infinity } = {}) {
  const list = db.all('intl_shipments').filter(r => r.origin === origin && (r.parcels || []).length)
  const r = list.find(x => x.declaredValueUsd > minValue && x.declaredValueUsd <= maxValue) || list[0]
  if (!r) throw new AssertionFailed('assert.noSample', { origin })
  return plain(r)
}

function draftFrom(rec) {
  return {
    origin: rec.origin, originPoint: rec.originPoint, handover: rec.handover, sender: rec.sender, destHub: rec.destHub,
    lastMile: 'direct', contentType: rec.contentType,
    recipients: [
      { name: 'Test Recipient A', line1: '405 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' },
      { name: 'Test Recipient B', line1: '88 Court St', city: 'Brooklyn', state: 'NY', zip: '11201' },
    ],
    parcels: (rec.parcels || []).map(p => ({ ...p, items: (p.items || []).map(i => ({ ...i })) })),
  }
}

const TRACKING_FORMATS = {
  FDX: /^\d{12}$/, UPS: /^1Z[A-Z0-9]{16}$/, USPS: /^\d{22}$/, DHLE: /^GM\d{18}$/,
  ONT: /^D\d{14}$/, LSO: /^L\d{10}$/, DHLX: /^\d{10}$/, EVRI: /^H\d{15}$/,
}
const LANE_FOR = { ONT: { hub: 'LA01', toZip: '90012' }, LSO: { hub: 'LA01', toZip: '75201' } }

/** Carrier void adapter simulation: same refund policy as the live void (USPS refunds are pending). */
function sandboxVoid(shipment) {
  if (shipment.status !== 'label_created') throw new ApiError('VOID_NOT_ALLOWED', 'Only unused labels can be voided', 409)
  const pending = shipment.carrier === 'USPS'
  return {
    shipment: { ...shipment, status: 'voided', voidedAt: nowIso() },
    refund: { amount: round2(shipment.walletCharge), status: pending ? 'pending' : 'completed' },
  }
}

const ORDER_NO = {
  shopify: n => `#${1000 + n}`,
  etsy: n => String(3100000000 + n * 7919),
  amazon: n => `112-${String(4000000 + n * 37).padStart(7, '0')}-${String(9000000 + n * 91).padStart(7, '0')}`,
  ebay: n => `12-${String(10000 + n * 13)}-${String(50000 + n * 29)}`,
  woocommerce: n => `#${5000 + n}`,
}
const PUSH_PATH = {
  shopify: no => `/shopify/orders/${no.replace('#', '')}/fulfillments`,
  etsy: no => `/etsy/receipts/${no}/tracking`,
  amazon: no => `/amazon/orders/${no}/shipment`,
  ebay: no => `/ebay/order/${no}/shipping_fulfillment`,
  woocommerce: no => `/wc/v3/orders/${no.replace('#', '')}/notes`,
}
const PUSH_BODY = {
  shopify: t => ({ fulfillment: { tracking_number: t, tracking_company: 'USPS', notify_customer: true } }),
  etsy: t => ({ tracking_code: t, carrier_name: 'usps' }),
  amazon: t => ({ carrierCode: 'USPS', trackingNumber: t, shipDate: nowIso() }),
  ebay: t => ({ shipmentTrackingNumber: t, shippingCarrierCode: 'USPS' }),
  woocommerce: t => ({ note: `USPS ${t}`, meta: { tracking_number: t, tracking_provider: 'usps' } }),
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

const IMPL = {
  async carrier_adapter(sc, x) {
    const { carrier, op } = sc.input || {}
    if (carrier === 'EVRI' && op === 'pickup') {
      const rec = sampleIntl('GB')
      const address = { ...rec.sender, zip: String(rec.sender.zip).toLowerCase() }
      x.info('log.collectionAddress', { postcode: address.zip })
      const res = await x.call('POST', '/carriers/evri/collections', () => requestCollection(address, { seed: sc.id }), { status: 201 })
      x.expect(/^EVR-\d{8}$/.test(res.ref), 'assert.format', { what: 'collection ref', value: res.ref })
      x.ok('log.collectionRef', { ref: res.ref, date: res.window.date })
      return
    }
    if (op === 'label') {
      const rec = sampleIntl(sc.suiteId === 'SUITE-TR' ? 'TR' : 'GB')
      rec.mawb = rec.mawb || newMawb(flightFor(rec.origin === 'TR' ? 'IST-CP' : 'LHR-CP', rec.destHub).mawbPrefix, sc.id)
      const res = await x.call('POST', `/carriers/${String(carrier).toLowerCase()}/labels`, () => airLegLabel(rec, { seed: sc.id }), { status: 201 })
      x.expect(TRACKING_FORMATS.DHLX.test(res.trackingNo), 'assert.format', { what: 'DHL Express tracking', value: res.trackingNo })
      x.ok('log.trackingIssued', { tracking: res.trackingNo, mawb: rec.mawb })
      const docs = await docsModule()
      const hub = db.all('hubs').find(h => h.code === rec.destHub)
      const doc = docs.labelDoc({ id: rec.id, carrier: 'DHLX', service: 'EXPRESS_WW', trackingNo: res.trackingNo, from: rec.sender, to: { name: 'KargoPazar', ...(hub?.address || {}) }, package: { weightLb: round2(rec.totalWeightKg * 2.20462) }, reference: rec.id, createdAt: nowIso() })
      const pages = doc.getNumberOfPages()
      x.expect(pages >= 1, 'assert.pdfEmpty', {})
      x.ok('log.pdfRendered', { pages })
      return
    }
    throw new AssertionFailed('assert.unknownOp', { op })
  },

  async postcode(sc, x) {
    const { country, value, expect } = sc.input
    x.info('log.input', { value })
    const res = await x.call('POST', `/addresses/postcode/${country.toLowerCase()}/validate`, () => validatePostcodeFor(country, value))
    x.eq(res.value, expect, 'postcode')
    x.expect(res.valid, 'assert.invalidPostcode', { value: res.value })
    x.ok('log.postcodeOk', { value: res.value })
  },

  async address_format(sc, x) {
    const country = sc.input?.country || 'TR'
    const base = sampleIntl(country).sender
    const missing = { ...base, district: '', city: '' }
    const bad = await x.call('POST', `/addresses/${country.toLowerCase()}/validate`, () => validateOriginAddress(country, missing), { status: 422 })
    x.expect(!bad.valid && bad.errors.district === 'required', 'assert.shouldFail', { what: 'district' })
    x.ok('log.missingRejected', { field: 'district' })
    const good = await x.call('POST', `/addresses/${country.toLowerCase()}/validate`, () => validateOriginAddress(country, base))
    x.expect(good.valid, 'assert.shouldPass', { errors: Object.keys(good.errors).join(', ') })
    x.ok('log.addressAccepted', { city: base.district || base.city, province: base.state })
  },

  async fx(sc, x) {
    const { amount, currency, expect } = sc.input
    const usd = await x.call('POST', '/fx/convert', () => toUsdDemo(amount, currency))
    x.eq(usd, expect, 'USD')
    x.expect(Math.abs(usd * 100 - Math.round(usd * 100)) < 1e-9, 'assert.decimals', { value: usd })
    x.ok('log.fxOk', { amount, currency, usd: usd.toFixed(2) })
  },

  async intl_stage(sc, x) {
    const { from, to } = sc.input
    const origin = sc.suiteId === 'SUITE-TR' ? 'TR' : 'GB'
    const sample = sampleIntl(origin)
    let rec = buildIntlRecord(draftFrom(sample), { id: `SBX-${sc.id}`, now: nowIso() })
    rec.dummyLabel = { ref: 'KPZ-TMP-000000', status: 'active', createdAt: nowIso() }
    // fast-forward the sandbox to the starting stage
    while (stageIndex(rec.stage) < stageIndex(from)) rec = { ...rec, ...applyStage(rec, nextStage(rec.stage), sandboxCtx(rec, nextStage(rec.stage))).patch }
    x.info('log.sandbox', { id: rec.id, atStage: from })
    while (rec.stage !== to) {
      const next = nextStage(rec.stage)
      if (!next) throw new AssertionFailed('assert.stageStuck', { stage: rec.stage })
      const prev = rec.stage
      const { patch } = await x.call('POST', `/intl/shipments/${rec.id}/events`, () => applyStage(rec, next, sandboxCtx(rec, next)), { ms: [15, 45] })
      rec = { ...rec, ...patch }
      x.ok('log.stageMoved', { fromStage: prev, toStage: next })
    }
    x.eq(rec.stage, to, 'stage')
    x.eq(rec.stageHistory.length, stageIndex(to) + 1, 'events')
    if (to === 'completed') {
      x.expect(rec.lastMileLabelCount > 0, 'assert.noLabels', {})
      x.expect(rec.lastMileShipmentIds.every(id => /^SBX-/.test(id)), 'assert.noLabels', {})
      x.eq(rec.dummyLabel.status, 'replaced', 'dummy label')
      x.ok('log.lastMileOk', { n: rec.lastMileLabelCount, mawb: rec.mawb })
    }
  },

  async event_map(sc, x) {
    const codes = sc.input?.codes || []
    const res = await x.call('POST', '/carriers/dhlx/tracking/map', () => codes.map(c => ({ code: c, mapped: mapCarrierEvent(c) })))
    for (const r of res) {
      x.expect(r.mapped, 'assert.unmapped', { code: r.code })
      x.ok('log.eventMapped', { code: r.code, toStage: r.mapped.stage })
    }
    x.eq(res.length, codes.length, 'codes')
  },

  async docs(sc, x) {
    const docs = await docsModule()
    const origin = sc.suiteId === 'SUITE-TR' ? 'TR' : 'GB'
    const which = sc.input?.doc
    const rec = which === 'cn23' ? sampleIntl(origin, { minValue: 400 }) : sampleIntl(origin)
    // Same as the create flow: items without an HS code get the catalog code or the HS model's top suggestion.
    const missing = (rec.parcels || []).flatMap(p => p.items || []).filter(i => !i.hsCode)
    for (const it of missing) {
      const product = db.all('products').find(p => p.sku && p.sku === it.sku)
      let code = product?.hsCode || null
      if (!code) {
        const r = await x.call('POST', '/ai/hs/suggest', () => suggestHs(it.title, '', { source: 'test_tool' }))
        code = r.top?.[0]?.code || null
      }
      it.hsCode = code
    }
    if (missing.length) x.info('log.hsFilled', { n: missing.length })
    const data = await x.call('POST', `/customs/${rec.id}/data`, () => docs.buildCustomsData(rec))
    const sum = round2(data.items.reduce((s, i) => s + i.totalValue, 0))
    x.eq(data.totalValue, sum, 'total')
    x.ok('log.itemsCollected', { n: data.items.length, total: data.totalValue.toFixed(2) })
    if (which === 'commercial_invoice') {
      x.expect(data.items.every(i => /^\d{4}\.\d{2}$/.test(i.hsCode)), 'assert.missingHs', {})
      const doc = await x.call('POST', `/customs/${rec.id}/commercial-invoice`, () => docs.commercialInvoiceDoc(data), { status: 201 })
      x.expect(doc.getNumberOfPages() >= 1, 'assert.pdfEmpty', {})
      x.ok('log.pdfRendered', { pages: doc.getNumberOfPages() })
      return
    }
    x.eq(docs.customsFormFor(data.totalValue), 'cn23', 'form')
    x.ok('log.formSelected', { form: 'CN23', value: data.totalValue.toFixed(2) })
    if (origin === 'TR') {
      x.expect(data.originCountry === 'TR' && data.items.every(i => i.origin && i.hsCode), 'assert.originHs', {})
      x.ok('log.originHsOk', { n: data.items.length })
    }
    const doc = await x.call('POST', `/customs/${rec.id}/cn23`, () => docs.cn23Doc(data), { status: 201 })
    x.expect(doc.getNumberOfPages() >= 1, 'assert.pdfEmpty', {})
    x.ok('log.pdfRendered', { pages: doc.getNumberOfPages() })
  },

  async manifest(sc, x) {
    const origin = sc.suiteId === 'SUITE-TR' ? 'TR' : 'GB'
    if (sc.input?.route) {
      const [fromAirport] = sc.input.route.split('-')
      const point = db.all('hubs').find(h => h.type === 'origin_point' && (h.airports || []).includes(fromAirport))
      const fl = flightFor(point?.code, sc.input.route.endsWith('LAX') ? 'LA01' : 'NJ01')
      x.eq(fl.route, sc.input.route, 'route')
      const mawb = newMawb(fl.mawbPrefix, sc.id)
      x.expect(mawb.startsWith('235-'), 'assert.mawbPrefix', { mawb })
      x.ok('log.mawbOk', { mawb, flight: fl.flight })
      const manifests = await x.call('GET', `/manifests?type=air_customs&route=${sc.input.route}`, () => db.all('manifests').filter(m => m.type === 'air_customs' && m.route === sc.input.route))
      x.expect(manifests.length > 0, 'assert.noManifest', { route: sc.input.route })
      for (const m of manifests) {
        x.expect(String(m.mawb).startsWith('235-'), 'assert.mawbPrefix', { mawb: m.mawb })
        const unlinked = (m.hawbs || []).filter(h => !db.get('intl_shipments', h.intlShipmentId))
        x.expect(!unlinked.length, 'assert.hawbUnlinked', { id: m.id, n: unlinked.length })
      }
      x.ok('log.hawbsLinked', { n: manifests.reduce((s, m) => s + (m.hawbs || []).length, 0), m: manifests.length })
      return
    }
    const rec = sampleIntl(origin)
    const line = await x.call('POST', `/customs/manifests/lines`, () => buildHawbLine(rec), { status: 201 })
    for (const f of ['hawb', 'consignee', 'contents', 'origin']) x.expect(String(line[f] || '').trim(), 'assert.fieldMissing', { field: f })
    x.expect(line.hsCodes.length > 0, 'assert.fieldMissing', { field: 'hsCodes' })
    x.expect(line.valueUsd > 0, 'assert.fieldMissing', { field: 'valueUsd' })
    x.ok('log.hawbLine', { hawb: line.hawb, hs: line.hsCodes.length, value: line.valueUsd.toFixed(2) })
    const docs = await docsModule()
    const doc = docs.manifestDoc({ id: 'MNF-TEST', type: 'air_customs', hub: rec.destHub, origin, mawb: newMawb('235', sc.id), flight: 'TK 001 IST-JFK', route: 'IST-JFK', createdAt: nowIso(), status: 'created', hawbs: [line], totals: { parcels: line.parcels, weightKg: line.weightKg, valueUsd: line.valueUsd } })
    x.expect(doc.getNumberOfPages() >= 1, 'assert.pdfEmpty', {})
    x.ok('log.pdfRendered', { pages: doc.getNumberOfPages() })
  },

  async rate_label(sc, x) {
    const { carrier, service } = sc.input
    const lane = LANE_FOR[carrier] || { hub: 'NJ01', toZip: '10001' }
    const q = await x.call('POST', '/v1/rates', () => sandboxQuote(carrier, service, lane))
    x.expect(q && q.total > 0, 'assert.noQuote', { carrier, service })
    x.ok('log.quoted', { service: q.serviceName, zone: q.zone, total: q.total.toFixed(2) })
    const trackingNo = await x.call('POST', `/carriers/${carrier.toLowerCase()}/labels`, () => generateTrackingNo(carrier, service, { seed: sc.id }), { status: 201 })
    x.expect(TRACKING_FORMATS[carrier]?.test(trackingNo), 'assert.format', { what: `${carrier} tracking`, value: trackingNo })
    x.ok('log.trackingIssued', { tracking: trackingNo, mawb: '-' })
    const docs = await docsModule()
    const hub = db.all('hubs').find(h => h.code === lane.hub)
    const doc = docs.labelDoc({ id: 'SBX', carrier, service, trackingNo, from: { name: 'KargoPazar', ...(hub?.address || {}) }, to: { name: 'Test Recipient', line1: '1 Test St', city: 'New York', state: 'NY', zip: lane.toZip, country: 'US' }, package: { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 3 }, zone: q.zone, createdAt: nowIso() })
    x.expect(doc.getNumberOfPages() >= 1, 'assert.pdfEmpty', {})
    x.ok('log.pdfRendered', { pages: doc.getNumberOfPages() })
  },

  async void(sc, x) {
    const { carrier } = sc.input
    const svc = (db.get('carriers', carrier)?.services || [])[0]?.code
    const lane = LANE_FOR[carrier] || { hub: 'NJ01', toZip: '10001' }
    const q = sandboxQuote(carrier, svc, lane)
    x.expect(q, 'assert.noQuote', { carrier, service: svc })
    const shipment = { id: `SBX-${sc.id}`, carrier, service: svc, status: 'label_created', walletCharge: q.walletCharge, trackingNo: generateTrackingNo(carrier, svc, { seed: sc.id }) }
    x.info('log.labelCreated', { tracking: shipment.trackingNo, amount: shipment.walletCharge.toFixed(2) })
    const res = await x.call('POST', `/carriers/${carrier.toLowerCase()}/labels/${shipment.trackingNo}/void`, () => sandboxVoid(shipment))
    x.eq(res.shipment.status, 'voided', 'status')
    x.eq(res.refund.amount, round2(q.walletCharge), 'refund')
    x.eq(res.refund.status, carrier === 'USPS' ? 'pending' : 'completed', 'refund status')
    x.ok('log.voided', { amount: res.refund.amount.toFixed(2), refundStatus: res.refund.status })
    let second = null
    try { sandboxVoid(res.shipment) } catch (e) { second = e.code }
    x.eq(second, 'VOID_NOT_ALLOWED', 'second void')
    x.ok('log.doubleVoidBlocked', {})
  },

  async sync(sc, x) {
    const { channel, op } = sc.input
    const meta = CHANNEL_META[channel]
    x.expect(meta, 'assert.unknownChannel', { channel })
    const n = Number(String(sc.id).replace(/\D/g, '')) || 1
    const no = ORDER_NO[channel](n)
    if (op === 'order_pull') {
      const payload = await x.call('GET', `/${channel}/orders?status=unfulfilled&limit=50`, () => ({
        orders: [{ number: no, customer: { name: 'Test Customer' }, shipTo: { name: 'Test Customer', line1: '1200 Pine St', line2: 'Apt 4B', city: 'Seattle', state: 'WA', zip: '98101', country: 'US' }, items: [{ sku: 'CER-MUG-12', qty: 1, price: 28 }] }],
      }))
      const o = payload.orders[0]
      const check = await x.call('POST', '/v1/ai/address/validate', () => validateAddressSync(o.shipTo), { ms: [10, 40] })
      x.expect(typeof check.score === 'number' && check.score >= 0 && check.score <= 100, 'assert.noScore', {})
      x.ok('log.orderMapped', { no, channel: meta.name, score: check.score })
      return
    }
    const tracking = generateTrackingNo('USPS', 'GA', { seed: sc.id })
    const body = PUSH_BODY[channel](tracking)
    const res = await x.call('POST', PUSH_PATH[channel](no), () => ({ ok: true, body }), { status: 201 })
    x.expect(JSON.stringify(res.body).includes(tracking) && tracking.length === 22, 'assert.trackingMissing', {})
    x.ok('log.trackingPushed', { tracking, no, channel: meta.name })
  },
}

function sandboxCtx(rec, next) {
  if (next !== 'last_mile_labeled') return { now: nowIso() }
  const labels = (rec.recipients || []).map((r, i) => ({ id: `SBX-${rec.id}-L${i + 1}`, trackingNo: generateTrackingNo('USPS', 'GA', { seed: `${rec.id}-${i}` }) }))
  return { now: nowIso(), labels }
}

export const SCENARIO_ENGINES = Object.keys(IMPL)

/** Runs one scenario and returns { result, error?, durationMs, log }. */
export async function runScenario(sc, emit = () => {}) {
  const log = []
  const push = line => { log.push(line); emit(line) }
  const x = makeCtx(push)
  const t0 = performance.now()
  const target = rand(200, 600)
  push({ at: nowIso(), kind: 'head', key: 'log.start', params: { id: sc.id } })
  let result = 'passed'
  let error = null
  try {
    const impl = IMPL[sc.engine]
    if (!impl) { result = 'skipped'; error = both('assert.noEngine', { engine: sc.engine }) }
    else await impl(sc, x)
  } catch (e) {
    result = 'failed'
    error = e instanceof AssertionFailed ? both(e.key, e.params) : both('assert.exception', { message: e?.code || e?.message || String(e) })
  }
  const spent = performance.now() - t0
  if (spent < target) await sleep(target - spent)
  const durationMs = Math.round(performance.now() - t0)
  push({ at: nowIso(), kind: result === 'passed' ? 'ok' : result === 'failed' ? 'fail' : 'info', key: `log.result.${result}`, params: { id: sc.id, ms: durationMs, error } })
  return { result, error, durationMs, log }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTestData() {
  return request('GET /v1/tests', () => {
    const d = db.doc('test_suites')
    return { suites: d.suites || [], runs: [...(d.runs || [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))), version: currentVersion() }
  }, { minMs: 250, maxMs: 500 })
}

export function runTests({ suiteIds = null, scenarioIds = null, onEvent } = {}) {
  return request('POST /v1/tests/runs', async () => {
    const d = db.doc('test_suites')
    const suites = plain(d.suites || [])
    const chosenSuites = suiteIds?.length ? suites.filter(s => suiteIds.includes(s.id)) : suites
    let queue = chosenSuites.flatMap(s => s.scenarios.map(sc => ({ ...sc, suiteId: s.id })))
    if (scenarioIds?.length) queue = suites.flatMap(s => s.scenarios.map(sc => ({ ...sc, suiteId: s.id }))).filter(sc => scenarioIds.includes(sc.id))
    if (!queue.length) throw new ApiError('NO_SCENARIOS', 'Nothing to run', 422)
    const startedAt = nowIso()
    onEvent?.({ type: 'start', total: queue.length, startedAt })
    const results = []
    for (const sc of queue) {
      onEvent?.({ type: 'scenario', scenarioId: sc.id, suiteId: sc.suiteId })
      const r = await runScenario(sc, line => onEvent?.({ type: 'log', scenarioId: sc.id, line }))
      const res = { scenarioId: sc.id, suiteId: sc.suiteId, result: r.result, durationMs: r.durationMs, ...(r.error ? { error: r.error } : {}), log: r.log }
      results.push(res)
      onEvent?.({ type: 'result', result: res, done: results.length, total: queue.length })
    }
    const passed = results.filter(r => r.result === 'passed').length
    const failed = results.filter(r => r.result === 'failed').length
    const skipped = results.filter(r => r.result === 'skipped').length
    const scope = scenarioIds?.length === 1 ? 'single' : suiteIds?.length === 1 && !scenarioIds ? 'suite' : scenarioIds?.length ? 'selection' : 'all'
    const run = {
      id: nextFormattedId('RUN'),
      startedAt, finishedAt: nowIso(), env: 'sandbox', version: currentVersion(), scope,
      suiteIds: [...new Set(queue.map(q => q.suiteId))], triggeredBy: db.doc('user')?.name || 'Demo',
      results, passed, failed, skipped,
      passRate: passed + failed ? Math.round((passed / (passed + failed)) * 1000) / 1000 : 0,
    }
    const byId = new Map(results.map(r => [r.scenarioId, r]))
    db.patchDoc('test_suites', doc => ({
      runs: [...(doc.runs || []), run].slice(-40),
      suites: (doc.suites || []).map(s => ({ ...s, scenarios: s.scenarios.map(sc => byId.has(sc.id) ? { ...sc, lastResult: byId.get(sc.id).result, lastDurationMs: byId.get(sc.id).durationMs, lastRunId: run.id } : sc) })),
    }))
    audit('tests.run', run.id, `${passed}/${results.length}`)
    if (failed) notify({ type: 'warning', title: { tr: `Entegrasyon testi ${run.id}: ${failed} senaryo kaldı`, en: `Integration test ${run.id}: ${failed} scenarios failed` }, link: '/intl/tests' })
    else if (scope !== 'single') notify({ type: 'success', title: { tr: `Entegrasyon testi ${run.id}: ${passed}/${results.length} geçti`, en: `Integration test ${run.id}: ${passed}/${results.length} passed` }, link: '/intl/tests' })
    return run
  }, { minMs: 120, maxMs: 260 })
}

export function downloadRunReport(runId, { suiteId = null } = {}) {
  return request(`GET /v1/tests/runs/${runId}/report`, async () => {
    const d = db.doc('test_suites')
    const run = (d.runs || []).find(r => r.id === runId)
    if (!run) throw new ApiError('NOT_FOUND', 'Run not found', 404)
    const docs = await docsModule()
    const history = [...(d.runs || [])].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    return docs.downloadTestReport(plain(run), { suites: plain(d.suites), suiteId: suiteId || undefined, history: plain(history), preparedBy: run.triggeredBy })
  }, { minMs: 300, maxMs: 600 })
}

export { STAGES }
