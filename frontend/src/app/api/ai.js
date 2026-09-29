/**
 * AI API (spec 6.1, 6.4, 6.5): address validation, carrier/service/hub optimizer, HS code model.
 * Every async function wraps its work in request() (latency + request log). Models run in the
 * browser (ai/addressModel.js, ai/optimizer.js, ai/hsModel.js); versions, training time and metrics
 * live in ai/modelRegistry.js (db 'aiModels'). No metric is hard coded: everything is computed.
 *
 * ADDRESS
 *   validateAddress(address, { history?, carrier?, source = 'panel', orderId?, record = true })
 *     -> addressModel result (score, issues, issueType, suggestion, contributions, ruleWarnings, carrierAdvice, residential)
 *     history defaults to all order ship-to and shipment addresses; recorded in 'addressValidations' (source column).
 *     source: 'shipment' | 'order_import' | 'batch' | 'test_tool' | 'api' | 'panel'
 *   validateAddressSync(address, opts) -> same, no latency, not recorded (use inside loops)
 *   recentValidations({ limit = 50, source? }) -> [{ id, at, source, orderId, address, score, issueType, suggested, modelVersion }]
 *   trainAddressModel(onProgress?) -> { version, previousVersion, label, metrics, previousMetrics, delta, lossCurve,
 *       trainSize, testSize, feedbackUsed, trainedAt }
 *     onProgress(pct, { iter, loss, testLoss, points: [{iter, loss, testLoss}] }) live loss curve
 *   addressMetrics() -> { version, label, lastTrainedAt, threshold, positiveClass, ml: {accuracy, precision, recall, f1,
 *       confusion: {tp, fp, fn, tn}}, rulesOnly: {...same}, trainSize, testSize, datasetSize, featureCount,
 *       feedbackCount, pendingFeedback, training: {iterations, learningRate, l2, split, seed}, dataset: {...}, lossCurve }
 *   featureImportances() -> [{ feature, label:{tr,en}, weight, importance, direction: 'deliverable'|'problem' }]
 *   recordAddressFeedback({ before, after?, accepted, issueType?, carrier?, source?, orderId? }) -> { feedback, pending }
 *
 * OPTIMIZER
 *   scoreQuotes(quotes, opts) -> sync, see ai/optimizer.js (re-exported)
 *   optimizeShipment({ to: {zip, state, residential, line1?}, pkg, declaredValue?, insured?, hub? (fixed), items?,
 *       weight?, addressCheck? }) -> { ranked, best, defaultChoice, savingsVsDefault, reason, reasonCode, weight,
 *       hubRecommendation: {hub, zone, reason}, byHub, candidates, quotes }
 *   simulate({ toZip, toState?, weightLb, lengthIn, widthIn, heightIn, declaredValue?, residential?, weight? })
 *     -> optimizeShipment result + { points: [{ key, hub, carrierCode, carrierName, serviceName, price, etaDays,
 *        reliability, score, best }], reliability (matrix, pass back to scoreQuotes for live slider re-ranking), input }
 *   batchOptimize(orders | orderIds, { onProgress?(pct, {done, total}), weight?, capacity? })
 *     -> { assignments: [{ orderId, hub, quote, score, components, reason, shiftedFrom, alternatives: [{quote, score,
 *          components}], defaultQuote, savings, estimatedPackage, package, destination, recipient }],
 *          excluded, capacity: {NJ01: {limit, todayLoad, remaining, assigned, used}, LA01: ...},
 *          evaluated: {orders, services, hubs, candidates}, byHub, byCarrier,
 *          totals: { ai: {cost, avgEtaDays, count}, default: {cost, avgEtaDays, count, rule}, savings, savingsPct } }
 *   summarizeAssignments(assignments) -> sync totals after a row's quote was changed by the user
 *   carrierReliabilityMatrix() -> { zones, carriers, cells: [{carrier, zone, n, onTime, raw, prior, smoothed}], byCarrier,
 *       lookup, totalSamples, k }
 *   acceptanceStats({ days = 90 }) -> { days, total, accepted, acceptanceRate, totalSavings, avgSavings,
 *       overrides: [{ key, carrier, service, count, share }], suggestedWhenOverridden: [{ key, count }],
 *       reasons: [{ code, count }], weekly: [{ weekStart, total, accepted, rate }] }
 *
 * HS CODES
 *   suggestHs(title, desc?, { source? }) -> { top: [{code, prob, desc:{tr,en}, customsDesc}], confidence, lowConfidence,
 *       topWords: [{word, contribution, code}], tokens, modelVersion }
 *   trainHs(onProgress?) -> { version, previousVersion, label, before, after, delta: {top1, top3}, trainSize, feedbackUsed }
 *   hsMetrics() -> { top1, top3, correctTop1, correctTop3, trainSize, testSize, classes, temperature, version, label,
 *       lastTrainedAt, datasetSize, feedbackCount, corrections, pendingFeedback, lowConfidenceThreshold }
 *   recordHsFeedback({ title, desc?, code, predicted?, action?: 'confirm'|'correct', sku?, source? }) -> { feedback, pending }
 *   bulkSuggestForProducts({ skus?, onlyMissing = true, onProgress? }) -> [{ sku, title, current, suggestion, agrees }]
 *     marks products without a code as hsStatus 'ai_pending' with product.hsSuggestion = {code, prob, top, lowConfidence, at, modelVersion}
 *   approveHsSuggestions([{ sku, code? }]) -> { approved, products: [sku] }  (code defaults to the suggestion)
 *   rejectHsSuggestion(sku) -> { sku }
 *   hsCodeList() -> [{ code, desc, customsDesc }]
 *
 * MODELS
 *   aiModels() -> [{ id, name, version, label, lastTrainedAt, trainSize, testSize, datasetSize, metrics, history }]
 */
import { request, ApiError, sleep } from './client.js'
import { db } from '../store/db.js'
import { session } from '../store/session.js'
import { audit, modelEvent } from '../store/events.js'
import * as Addr from '../ai/addressModel.js'
import * as Opt from '../ai/optimizer.js'
import * as Hs from '../ai/hsModel.js'
import { getModelInfo, listModelInfo, recordTraining, updateModelInfo, bilingual } from '../ai/modelRegistry.js'
import { money, percent } from '@/shared/format.js'

export const scoreQuotes = Opt.scoreQuotes
export const summarizeAssignments = Opt.summarizeAssignments

const nowIso = () => new Date().toISOString()
const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function addressLine(a) {
  if (!a) return '-'
  return [a.line1, a.line2, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------
function defaultHistory() {
  return [...db.all('orders').map(o => o.shipTo), ...db.all('shipments').map(s => s.to)].filter(Boolean)
}

export function validateAddressSync(address, { history, carrier } = {}) {
  return Addr.validateAddress(plain(address) || {}, { history: history ?? defaultHistory(), carrier })
}

export function validateAddress(address, opts = {}) {
  const { source = 'panel', orderId = null, record = true } = opts
  return request('POST /v1/ai/address/validate', () => {
    const addr = plain(address) || {}
    const r = Addr.validateAddress(addr, { history: opts.history ?? defaultHistory(), carrier: opts.carrier })
    if (record) {
      db.insert('addressValidations', {
        id: uid('AV'),
        at: nowIso(),
        source,
        orderId,
        address: { name: addr.name ?? '', line1: addr.line1 ?? '', line2: addr.line2 ?? '', city: addr.city ?? '', state: addr.state ?? '', zip: addr.zip ?? '', country: addr.country ?? 'US' },
        score: r.score,
        issueType: r.issueType,
        suggested: !!r.suggestion,
        modelVersion: r.modelVersion,
      })
      db.trim('addressValidations', 200)
    }
    return r
  }, { minMs: 120, maxMs: 320 })
}

export function recentValidations({ limit = 50, source } = {}) {
  return request('GET /v1/ai/address/validations', () => {
    let list = db.all('addressValidations')
    if (source) list = list.filter(v => v.source === source)
    return list.slice(0, limit)
  }, { minMs: 200, maxMs: 450 })
}

function allAddressFeedback() { return db.all('addressFeedback') }

function addressMetricsNow() {
  const info = getModelInfo('address')
  const m = Addr.getModel()
  const ev = Addr.evaluate()
  const included = new Set(info.feedbackIds || [])
  const fb = allAddressFeedback()
  return {
    version: info.version,
    label: info.label,
    lastTrainedAt: info.lastTrainedAt,
    ...ev,
    datasetSize: m.datasetSize,
    featureCount: Addr.FEATURES.length,
    feedbackCount: fb.length,
    pendingFeedback: fb.filter(f => !included.has(f.id)).length,
    training: Addr.TRAINING,
    dataset: Addr.datasetInfo(),
    lossCurve: m.lossCurve,
  }
}

export function addressMetrics() {
  return request('GET /v1/ai/address/metrics', () => addressMetricsNow(), { minMs: 250, maxMs: 600 })
}

export function featureImportances() {
  return request('GET /v1/ai/address/features', () => Addr.featureImportances(), { minMs: 200, maxMs: 450 })
}

export function trainAddressModel(onProgress) {
  return request('POST /v1/ai/address/train', async () => {
    const prev = getModelInfo('address')
    const previousMetrics = Addr.evaluate()
    const feedback = plain(allAddressFeedback())
    const model = await Addr.trainAsync({ feedback, onProgress, delayMs: 35 })
    const metrics = model.metrics
    const info = recordTraining('address', {
      metrics: { accuracy: metrics.ml.accuracy, precision: metrics.ml.precision, recall: metrics.ml.recall, f1: metrics.ml.f1, rulesOnlyF1: metrics.rulesOnly.f1 },
      trainSize: model.trainSize,
      testSize: model.testSize,
      datasetSize: model.datasetSize,
      feedbackIds: feedback.map(f => f.id),
    })
    const delta = {}
    for (const k of ['accuracy', 'precision', 'recall', 'f1']) delta[k] = Math.round((metrics.ml[k] - previousMetrics.ml[k]) * 10000) / 10000
    modelEvent('address', 'train', bilingual('events.addressTrain', { version: info.label, f1: metrics.ml.f1.toFixed(3) }))
    audit('ai.address.train', info.label, { trainSize: model.trainSize, feedback: feedback.length })
    return {
      version: info.version,
      previousVersion: prev.version,
      label: info.label,
      metrics,
      previousMetrics,
      delta,
      lossCurve: model.lossCurve,
      trainSize: model.trainSize,
      testSize: model.testSize,
      feedbackUsed: model.feedbackUsed,
      trainedAt: info.lastTrainedAt,
    }
  }, { minMs: 150, maxMs: 300 })
}

/**
 * Store a user decision on an address suggestion. Same record shape the orders API writes:
 * { id, at, before, after, accepted, issueType, carrier, source, orderId }.
 */
export function recordAddressFeedback({ before, after = null, accepted, issueType = null, carrier = null, source = 'panel', orderId = null } = {}) {
  return request('POST /v1/ai/address/feedback', () => {
    if (!before || !before.line1) throw new ApiError('INVALID_FEEDBACK', 'before address required', 422)
    const rec = db.insert('addressFeedback', {
      id: uid('AFB'),
      at: nowIso(),
      orderId,
      before: plain(before),
      after: after ? plain(after) : null,
      issueType,
      accepted: !!accepted,
      carrier,
      source,
    })
    modelEvent('address', 'feedback', bilingual('events.addressFeedback', { action: bilingual(accepted ? 'events.applied' : 'events.rejected'), address: addressLine(before) }))
    const included = new Set(getModelInfo('address').feedbackIds || [])
    return { feedback: rec, pending: allAddressFeedback().filter(f => !included.has(f.id)).length }
  }, { minMs: 150, maxMs: 350 })
}

// ---------------------------------------------------------------------------
// Optimizer
// ---------------------------------------------------------------------------
function optimizerContext(overrides = {}) {
  const user = db.doc('user') || {}
  return {
    carriers: Opt.liveCarriers(),
    hubsMeta: db.all('hubs'),
    rateCards: db.doc('rate_cards'),
    carrierAccounts: db.all('carrier_accounts'),
    plan: session.plan || user.company?.plan || 'starter',
    customerId: user.customerId || null,
    defaultHub: user.company?.defaultHub || 'NJ01',
    products: db.all('products'),
    reliability: Opt.liveReliability(),
    weight: user.preferences?.optimizerWeight ?? 0.6,
    ...overrides,
  }
}

function usHubs(ctx) {
  const list = (ctx.hubsMeta || []).filter(h => h.type === 'us_hub' && h.active !== false).map(h => h.code)
  return list.length ? list : ['NJ01', 'LA01']
}

function stateForZip(zip) {
  const z3 = String(zip || '').replace(/\D/g, '').slice(0, 3)
  const table = db.doc('zip3_state') || {}
  return table[z3] || null
}

function runOptimize(input, ctx) {
  const to = { ...(input.to || {}) }
  if (!to.state) to.state = stateForZip(to.zip)
  const poBox = /p\.?\s*o\.?\s*box/i.test(`${to.line1 || ''} ${to.line2 || ''}`)
  let hubs = usHubs(ctx)
  let onlyHub = null
  if (input.hub) hubs = [input.hub]
  else if (input.items?.length) {
    const r = Opt.hubsForItems(input.items, ctx.products, ctx.defaultHub, hubs)
    hubs = r.hubs
    onlyHub = r.only
  }
  return Opt.optimize({
    ...ctx,
    hubs,
    fixedHub: input.hub || null,
    onlyHub,
    to,
    pkg: input.pkg,
    declaredValue: input.declaredValue || 0,
    insured: input.insured,
    poBox,
    addressCheck: input.addressCheck || null,
    weight: input.weight ?? ctx.weight,
  })
}

export function optimizeShipment(input = {}) {
  return request('POST /v1/ai/optimizer/optimize', () => {
    if (!input.to?.zip) throw new ApiError('INVALID_DESTINATION', 'Destination ZIP required', 422)
    return runOptimize(input, optimizerContext())
  }, { minMs: 180, maxMs: 420 })
}

export function simulate(input = {}) {
  return request('POST /v1/ai/optimizer/simulate', () => {
    const zip = String(input.toZip || '').trim()
    if (!/^\d{5}$/.test(zip)) throw new ApiError('INVALID_ZIP', 'ZIP must be 5 digits', 422)
    const toState = input.toState || stateForZip(zip)
    if (!toState) throw new ApiError('UNKNOWN_ZIP', 'Unknown ZIP prefix', 422)
    const ctx = optimizerContext()
    const pkg = { lengthIn: Number(input.lengthIn) || 0, widthIn: Number(input.widthIn) || 0, heightIn: Number(input.heightIn) || 0, weightLb: Number(input.weightLb) || 0 }
    const res = runOptimize({ to: { zip, state: toState, residential: input.residential !== false }, pkg, declaredValue: Number(input.declaredValue) || 0, weight: input.weight }, ctx)
    const bestKey = res.best ? res.best.quote.key + '@' + res.best.quote.hub : null
    const points = res.ranked.map(r => ({
      key: r.quote.key,
      id: r.quote.key + '@' + r.quote.hub,
      hub: r.quote.hub,
      carrierCode: r.quote.carrierCode,
      carrierName: r.quote.carrierName,
      serviceName: r.quote.serviceName,
      source: r.quote.source,
      price: r.quote.total,
      etaDays: r.quote.effectiveEtaDays ?? r.quote.etaDays,
      reliability: r.components.reliabilityRaw,
      score: r.score,
      best: r.quote.key + '@' + r.quote.hub === bestKey,
    }))
    return { ...res, points, reliability: ctx.reliability, input: { ...input, toState, zip } }
  }, { minMs: 150, maxMs: 350 })
}

export function batchOptimize(orders, { onProgress, weight, capacity } = {}) {
  return request('POST /v1/ai/optimizer/batch', async () => {
    const list = (orders || []).map(o => (typeof o === 'string' ? db.get('orders', o) : o)).filter(Boolean).map(plain)
    const ctx = optimizerContext()
    const w = weight ?? ctx.weight
    const evaluated = []
    const chunk = Math.max(1, Math.ceil(list.length / 25))
    for (let i = 0; i < list.length; i++) {
      evaluated.push(Opt.evaluateOrder(list[i], ctx, w))
      if ((i + 1) % chunk === 0 || i === list.length - 1) {
        onProgress?.(Math.round(((i + 1) / list.length) * 100), { done: i + 1, total: list.length })
        await sleep(40)
      }
    }
    const res = Opt.assignBatch(evaluated, ctx, { weight: w, capacity })
    modelEvent('optimizer', 'predict', bilingual('events.batchOptimize', { n: list.length, savings: { tr: money(res.totals.savings, 'tr'), en: money(res.totals.savings, 'en') } }))
    return res
  }, { minMs: 150, maxMs: 300 })
}

export function carrierReliabilityMatrix() {
  return request('GET /v1/ai/optimizer/reliability', () => Opt.liveReliability() || Opt.reliabilityMatrix([], Opt.liveCarriers()), { minMs: 200, maxMs: 500 })
}

function weekStartIso(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x.toISOString()
}

export function acceptanceStats({ days = 90 } = {}) {
  return request('GET /v1/ai/optimizer/acceptance', () => {
    const since = Date.now() - days * 86400000
    const list = db.all('shipments').filter(s => s.aiPick && new Date(s.createdAt).getTime() >= since)
    const accepted = list.filter(s => s.aiPick.chosen)
    const overridden = list.filter(s => !s.aiPick.chosen)
    const count = (arr, keyFn) => {
      const m = new Map()
      for (const x of arr) { const k = keyFn(x); if (k) m.set(k, (m.get(k) || 0) + 1) }
      return [...m.entries()].map(([key, n]) => ({ key, count: n })).sort((a, b) => b.count - a.count)
    }
    const carriers = Opt.liveCarriers()
    const overrides = count(overridden, s => `${s.carrier}-${s.service}`).map(o => {
      const [carrier, service] = o.key.split('-')
      const c = carriers.find(x => x.code === carrier)
      return { ...o, carrier, service, carrierName: c?.name || carrier, serviceName: c?.services?.find(x => x.code === service)?.name || service, share: overridden.length ? Math.round((o.count / overridden.length) * 10000) / 10000 : 0 }
    })
    const weeks = new Map()
    for (const s of list) {
      const k = weekStartIso(s.createdAt)
      const w = weeks.get(k) || { weekStart: k, total: 0, accepted: 0 }
      w.total++
      if (s.aiPick.chosen) w.accepted++
      weeks.set(k, w)
    }
    const weekly = [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map(w => ({ ...w, rate: Math.round((w.accepted / w.total) * 10000) / 10000 }))
    const totalSavings = Math.round(accepted.reduce((s, x) => s + (Number(x.aiPick.savingsVsDefault) || 0), 0) * 100) / 100
    return {
      days,
      total: list.length,
      accepted: accepted.length,
      acceptanceRate: list.length ? Math.round((accepted.length / list.length) * 10000) / 10000 : 0,
      totalSavings,
      avgSavings: accepted.length ? Math.round((totalSavings / accepted.length) * 100) / 100 : 0,
      overrides,
      suggestedWhenOverridden: count(overridden, s => s.aiPick.suggested),
      reasons: count(accepted, s => s.aiPick.reasonCode).map(r => ({ code: r.key, count: r.count })),
      weekly,
    }
  }, { minMs: 250, maxMs: 550 })
}

// ---------------------------------------------------------------------------
// HS codes
// ---------------------------------------------------------------------------
const HS_RE = /^\d{4}\.\d{2}$/

export function normalizeHsCode(code) {
  const raw = String(code || '').trim()
  if (HS_RE.test(raw)) return raw
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 6) return digits.slice(0, 4) + '.' + digits.slice(4)
  return null
}

export function hsCodeList() {
  return Hs.codes()
}

export function suggestHs(title, desc = '', { source = 'panel' } = {}) {
  return request('POST /v1/ai/hs/suggest', () => {
    if (!String(title || '').trim()) throw new ApiError('TITLE_REQUIRED', 'Title required', 422)
    const r = Hs.suggest(title, desc)
    if (source === 'test_tool' && r.top.length) modelEvent('hs', 'predict', { title: String(title).slice(0, 80), code: r.top[0].code, prob: r.top[0].prob })
    return r
  }, { minMs: 150, maxMs: 380 })
}

function hsMetricsNow() {
  const info = getModelInfo('hs')
  const m = Hs.getModel()
  const ev = Hs.evaluate()
  const included = new Set(info.feedbackIds || [])
  const fb = db.all('hsFeedback')
  return {
    ...ev,
    version: info.version,
    label: info.label,
    lastTrainedAt: info.lastTrainedAt,
    datasetSize: m.datasetSize,
    feedbackCount: fb.length,
    corrections: fb.filter(f => f.action === 'correct').length,
    pendingFeedback: fb.filter(f => !included.has(f.id)).length,
    lowConfidenceThreshold: Hs.LOW_CONFIDENCE,
    dataset: Hs.datasetInfo(),
  }
}

export function hsMetrics() {
  return request('GET /v1/ai/hs/metrics', () => hsMetricsNow(), { minMs: 250, maxMs: 550 })
}

export function trainHs(onProgress) {
  return request('POST /v1/ai/hs/train', async () => {
    const prev = getModelInfo('hs')
    const before = { ...Hs.evaluate() }
    const feedback = plain(db.all('hsFeedback'))
    const stages = 8
    for (let i = 1; i < stages; i++) { onProgress?.(Math.round((i / stages) * 90), { stage: i }); await sleep(90) }
    const model = Hs.train({ feedback })
    const after = model.metrics
    onProgress?.(100, { stage: stages })
    const info = recordTraining('hs', {
      metrics: { top1: after.top1, top3: after.top3 },
      trainSize: model.trainSize,
      testSize: model.testSize,
      datasetSize: model.datasetSize,
      feedbackIds: feedback.map(f => f.id),
    })
    modelEvent('hs', 'train', bilingual('events.hsTrain', { version: info.label, top1: { tr: percent(after.top1, 'tr'), en: percent(after.top1, 'en') } }))
    audit('ai.hs.train', info.label, { trainSize: model.trainSize, feedback: feedback.length })
    return {
      version: info.version,
      previousVersion: prev.version,
      label: info.label,
      before,
      after,
      delta: { top1: Math.round((after.top1 - before.top1) * 10000) / 10000, top3: Math.round((after.top3 - before.top3) * 10000) / 10000 },
      trainSize: model.trainSize,
      feedbackUsed: model.feedbackUsed,
    }
  }, { minMs: 150, maxMs: 300 })
}

function findProduct(sku) { return db.find('products', p => p.sku === sku) }
function patchProduct(sku, patch) {
  const p = findProduct(sku)
  if (!p) return null
  Object.assign(p, patch)
  db.touch('products')
  return p
}

export function recordHsFeedback({ title, desc = '', code, predicted = null, action, sku = null, source = 'panel' } = {}) {
  return request('POST /v1/ai/hs/feedback', () => {
    const c = normalizeHsCode(code)
    if (!c) throw new ApiError('INVALID_HS_CODE', 'HS code must have 6 digits', 422)
    if (!String(title || '').trim()) throw new ApiError('TITLE_REQUIRED', 'Title required', 422)
    const act = action || (predicted && predicted !== c ? 'correct' : 'confirm')
    const rec = db.insert('hsFeedback', { id: uid('HSF'), at: nowIso(), title: String(title).trim(), desc, code: c, predicted, action: act, sku, source })
    if (sku) patchProduct(sku, { hsCode: c, hsStatus: 'confirmed', hsSuggestion: null })
    modelEvent('hs', 'feedback', bilingual('events.hsFeedback', { action: bilingual(act === 'correct' ? 'events.corrected' : 'events.confirmed'), title: String(title).slice(0, 60), code: c }))
    const included = new Set(getModelInfo('hs').feedbackIds || [])
    return { feedback: rec, pending: db.all('hsFeedback').filter(f => !included.has(f.id)).length }
  }, { minMs: 150, maxMs: 350 })
}

const productTitle = p => (p.title && typeof p.title === 'object' ? p.title.en || p.title.tr : p.title) || p.sku

export function bulkSuggestForProducts({ skus, onlyMissing = true, onProgress } = {}) {
  return request('POST /v1/ai/hs/bulk-suggest', async () => {
    let list = db.all('products')
    if (skus?.length) list = list.filter(p => skus.includes(p.sku))
    else if (onlyMissing) list = list.filter(p => !p.hsCode)
    const out = []
    const at = nowIso()
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const r = Hs.suggest(productTitle(p), (p.tags || []).join(' '))
      const top = r.top[0]
      const suggestion = top ? { code: top.code, prob: top.prob, top: r.top, lowConfidence: r.lowConfidence, topWords: r.topWords, at, modelVersion: r.modelVersion } : null
      const agrees = !!(p.hsCode && top && p.hsCode === top.code)
      patchProduct(p.sku, p.hsCode ? { hsSuggestion: suggestion } : { hsSuggestion: suggestion, hsStatus: 'ai_pending' })
      out.push({ sku: p.sku, title: p.title, current: p.hsCode || null, suggestion, agrees })
      if ((i + 1) % 3 === 0 || i === list.length - 1) { onProgress?.(Math.round(((i + 1) / list.length) * 100), { done: i + 1, total: list.length }); await sleep(45) }
    }
    if (out.length) modelEvent('hs', 'predict', bilingual('events.hsBulk', { n: out.length }))
    return out
  }, { minMs: 150, maxMs: 300 })
}

export function approveHsSuggestions(items = []) {
  return request('POST /v1/ai/hs/approve', () => {
    const approved = []
    for (const it of items) {
      const p = findProduct(it.sku)
      if (!p) continue
      const code = normalizeHsCode(it.code || p.hsSuggestion?.code)
      if (!code) continue
      const predicted = p.hsSuggestion?.code || null
      db.insert('hsFeedback', { id: uid('HSF'), at: nowIso(), title: productTitle(p), desc: '', code, predicted, action: predicted && predicted !== code ? 'correct' : 'confirm', sku: p.sku, source: 'catalog' })
      patchProduct(p.sku, { hsCode: code, hsStatus: 'confirmed', hsSuggestion: null })
      approved.push(p.sku)
    }
    if (approved.length) {
      modelEvent('hs', 'approve', bilingual('events.hsApprove', { n: approved.length }))
      audit('ai.hs.approve', approved.join(','), { count: approved.length })
    }
    return { approved: approved.length, products: approved }
  }, { minMs: 250, maxMs: 550 })
}

export function rejectHsSuggestion(sku) {
  return request('POST /v1/ai/hs/reject', () => {
    const p = findProduct(sku)
    if (!p) throw new ApiError('NOT_FOUND', 'Product not found', 404)
    patchProduct(sku, { hsSuggestion: null, hsStatus: p.hsCode ? 'confirmed' : 'missing' })
    return { sku }
  }, { minMs: 150, maxMs: 300 })
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export function aiModels() {
  return request('GET /v1/ai/models', () => {
    const list = listModelInfo()
    // cache live metrics of the initial (not yet retrained) models so the hub shows computed numbers
    const addr = list.find(m => m.id === 'address')
    if (addr && !addr.metrics) {
      const ev = Addr.evaluate()
      addr.metrics = { accuracy: ev.ml.accuracy, precision: ev.ml.precision, recall: ev.ml.recall, f1: ev.ml.f1, rulesOnlyF1: ev.rulesOnly.f1 }
      addr.trainSize = ev.trainSize
      addr.testSize = ev.testSize
      addr.datasetSize = Addr.getModel().datasetSize
    }
    const hs = list.find(m => m.id === 'hs')
    if (hs && !hs.metrics) {
      const ev = Hs.evaluate()
      hs.metrics = { top1: ev.top1, top3: ev.top3 }
      hs.trainSize = ev.trainSize
      hs.testSize = ev.testSize
      hs.datasetSize = Hs.getModel().datasetSize
    }
    const opt = list.find(m => m.id === 'optimizer')
    if (opt) {
      const rel = Opt.liveReliability()
      const since = Date.now() - 90 * 86400000
      const picks = db.all('shipments').filter(s => s.aiPick && new Date(s.createdAt).getTime() >= since)
      opt.metrics = { ...(opt.metrics || {}), acceptanceRate: picks.length ? Math.round((picks.filter(s => s.aiPick.chosen).length / picks.length) * 10000) / 10000 : 0, reliabilitySamples: rel?.totalSamples ?? 0 }
      opt.datasetSize = rel?.totalSamples ?? 0
    }
    return list
  }, { minMs: 200, maxMs: 500 })
}

/** Re-export for other API modules that want to cache metrics without a version bump. */
export { updateModelInfo }
