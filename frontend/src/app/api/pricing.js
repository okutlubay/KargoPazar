/**
 * Dynamic pricing API (spec 6.3, 10.2 dynamicOverrides). Wraps ai/pricingModel.js.
 *
 * State
 *   db doc 'pricing_recs': { generatedAt, modelVersion, forecastVersion, refPackage, lanes: [LaneState] }
 *     LaneState = seed lane definition + live model fields (see pricingModel LaneRec) +
 *       { status: 'proposed'|'approved'|'rejected'|'expired'|'none', editedPrice?, editedAt?, editedBy?,
 *         approvedAt?, approvedBy?, approvedPrice?, validUntil?, overrideId?, auto?,
 *         rejectedReason? ({tr,en} or string), rejectedAt?, rejectedBy? }
 *     First read recomputes the seed recommendations with the live model (statuses kept).
 *   db doc 'rate_cards'.platform: marginRange {min,max}, marketCapMultiplier, autoApprove,
 *     autoApproveBelowPct, dynamicValidityDays
 *   db doc 'rate_cards'.dynamicOverrides: entries consumed by shared/rateEngine.js findDynamicOverride:
 *     { id: 'DPO-n', lane: 'NJ01|UPS-GROUND|near', price, refCost, refPackage, validFrom, validUntil,
 *       status: 'approved'|'expired'|'revoked'|'superseded', hub, carrier, service, zoneGroup,
 *       recommendedPrice, approvedAt, approvedBy, auto, modelVersion, forecastVersion }
 *     The engine prices a quote on that lane at cost * price / refCost (the reference package gets
 *     exactly `price`), and marks it source 'dynamic'.
 *
 * Exported API (all async unless noted; lane ids are lane keys "HUB|CARRIER-SERVICE|group")
 *   listRecommendations({ all = false } = {}) -> { lanes: LaneView[] (top 20 by forecast volume, or all),
 *       totalLanes, counts: {proposed, approved, rejected, expired, none}, settings, meta }
 *     LaneView = LaneRec + LaneState + { activePrice|null, finalPrice, priceHistory: [{weekStart, price, n}],
 *       overrides: [override entries for the lane, newest first] }
 *     meta = { modelVersion, forecastVersion, currentForecastVersion, forecastTrainedAt, stale, generatedAt }
 *   getRecommendation(id) -> LaneView
 *   recompute(onProgress?) -> { changed, reproposed, autoApproved, forecastVersion, generatedAt }
 *   approve(ids: string|string[]) -> { approved: n, lanes: LaneView[], overrides }
 *   reject(id, reason) -> LaneView                          (reason >= 3 chars, else REASON_REQUIRED)
 *   revoke(id) -> LaneView                                  (approved -> proposed, override 'revoked')
 *   editPrice(id, price) -> { lane: LaneView, warnings: [{ code, params }] }
 *       codes: OUT_OF_RANGE, BELOW_FLOOR, BELOW_COST, ABOVE_MARKET_CAP (text: t(`aiModel.pricing.warnings.${code}`, params))
 *       editing an approved lane updates its active override in place.
 *   checkPrice(id, price) -> [{ code, params }]            (sync, no write: live warning while typing)
 *   getSettings() -> { minMargin, maxMargin, marketCapMultiplier, autoApprove, autoApproveBelowPct, validityDays }
 *   saveSettings(patch) -> { settings, recompute }          (validates, then recomputes)
 *   pendingCount() -> number                                (sync, reactive: lanes with status 'proposed')
 *   activeOverrides() -> override[]                         (sync: approved and still valid)
 * Errors: ApiError codes FORBIDDEN (403), NOT_FOUND (404), REASON_REQUIRED, INVALID_PRICE,
 *   INVALID_SETTINGS (details.field), NOTHING_SELECTED (422). Message = t('aiModel.errors.<code>').
 */
import { db } from '../store/db.js'
import { can, session } from '../store/session.js'
import { notify, audit, modelEvent } from '../store/events.js'
import { request, runSteps, ApiError } from './client.js'
import { t, fmt } from '../i18n/index.js'
import { computeAll } from '../ai/pricingModel.js'
import { computeForecast, forecastMeta, both } from './forecast.js'
import { round2 } from '../../shared/rateEngine.js'
import { moneyText } from '../../shared/currency.js'

const DOC = 'pricing_recs'
const TOP_N = 20
const DAY = 86400000
const CARRIER_CODES = ['UPS', 'USPS', 'FDX', 'DHLE', 'ONT', 'LSO']
const RECOMMENDATION_CHANGE = 0.01 // a new recommendation re-opens rejected / expired lanes

function err(code, status = 422, details) {
  return new ApiError(code, t(`aiModel.errors.${code}`), status, details)
}
function requireManage() {
  if (!can('ai.manage')) throw err('FORBIDDEN', 403)
}

function rateCards() {
  return db.doc('rate_cards')
}

export function getSettingsSync() {
  const p = rateCards().platform || {}
  return {
    minMargin: p.marginRange?.min ?? 0.12,
    maxMargin: p.marginRange?.max ?? 0.28,
    marketCapMultiplier: p.marketCapMultiplier ?? 1.05,
    autoApprove: !!p.autoApprove,
    autoApproveBelowPct: p.autoApproveBelowPct ?? 0.03,
    validityDays: p.dynamicValidityDays ?? 7,
  }
}

function userCtx() {
  const u = db.doc('user')
  return { plan: u?.company?.plan ?? 'enterprise', customerId: u?.customerId ?? null, actor: session.user?.name ?? u?.name ?? 'system' }
}

function runModel() {
  const doc = db.doc(DOC)
  const forecastByCarrier = {}
  const historyByCarrier = {}
  for (const c of CARRIER_CODES) {
    const r = computeForecast(`byCarrier.${c}`)
    if (!r) continue
    forecastByCarrier[c] = r.forecast
    historyByCarrier[c] = r.history
  }
  const { plan, customerId } = userCtx()
  const lanes = computeAll({
    defs: doc.lanes,
    carriers: db.all('carriers'),
    rateCards: rateCards(),
    forecastByCarrier,
    historyByCarrier,
    shipments: db.all('shipments'),
    plan,
    customerId,
    refPackage: doc.refPackage,
    settings: getSettingsSync(),
    now: new Date(),
  })
  return JSON.parse(JSON.stringify(lanes))
}

const STATE_FIELDS = ['status', 'editedPrice', 'editedAt', 'editedBy', 'approvedAt', 'approvedBy', 'approvedPrice', 'validUntil', 'overrideId', 'auto', 'rejectedReason', 'rejectedAt', 'rejectedBy', 'marketRef', 'refZone', 'refZip', 'zoneGroup', 'hub', 'carrier', 'service', 'lane']

function pickState(l) {
  const o = {}
  for (const k of STATE_FIELDS) if (l[k] !== undefined) o[k] = l[k]
  return o
}

/** Merge a fresh model run into the stored lanes. mode 'init' keeps statuses exactly. */
function merge(prevLanes, fresh, mode) {
  const prevById = new Map(prevLanes.map((l) => [l.lane, l]))
  let changed = 0
  let reproposed = 0
  const lanes = fresh.map((f) => {
    const p = prevById.get(f.lane) || {}
    const st = pickState(p)
    const out = { ...f, ...st, status: st.status || 'none' }
    const oldRec = p.recommendedPrice
    const moved = oldRec ? Math.abs(f.recommendedPrice / oldRec - 1) >= RECOMMENDATION_CHANGE : true
    if (oldRec && f.recommendedPrice !== oldRec) changed++
    if (mode !== 'init' && moved) {
      if (out.status === 'rejected' || out.status === 'expired') {
        out.status = 'proposed'
        delete out.rejectedReason
        delete out.rejectedAt
        delete out.rejectedBy
        reproposed++
      }
      if (out.status === 'proposed') delete out.editedPrice
    }
    return out
  })
  return { lanes, changed, reproposed }
}

let initialized = false
function ensureLive() {
  const doc = db.doc(DOC)
  if (doc.liveComputed) {
    initialized = true
    return
  }
  const fresh = runModel()
  const { lanes } = merge(doc.lanes, fresh, 'init')
  const fv = forecastMeta().version
  db.patchDoc(DOC, {
    lanes,
    liveComputed: true,
    ...(fv !== doc.forecastVersion ? { generatedAt: new Date().toISOString() } : {}),
    forecastVersion: fv,
    modelVersion: doc.modelVersion || 'price-ai v1.2',
  })
  initialized = true
}

/** Approved lanes past validUntil -> 'expired' (lane and override). */
function sweepExpired() {
  const now = Date.now()
  const doc = db.doc(DOC)
  let dirty = false
  for (const l of doc.lanes) {
    if (l.status === 'approved' && l.validUntil && new Date(l.validUntil).getTime() < now) {
      l.status = 'expired'
      dirty = true
    }
  }
  const rc = rateCards()
  let ovDirty = false
  for (const o of rc.dynamicOverrides || []) {
    if (o.status === 'approved' && o.validUntil && new Date(o.validUntil).getTime() < now) {
      o.status = 'expired'
      ovDirty = true
    }
  }
  if (dirty) db.touch(DOC)
  if (ovDirty) db.touch('rate_cards')
}

function priceHistory(lane) {
  const now = Date.now()
  const weeks = []
  for (let w = 11; w >= 0; w--) weeks.push({ start: now - (w + 1) * 7 * DAY, end: now - w * 7 * DAY })
  const ships = db.all('shipments').filter((s) => s.status !== 'voided' && s.hub === lane.hub && s.carrier === lane.carrier && s.service === lane.service && zoneGroupOf(s.zone) === lane.zoneGroup && s.cost > 0 && s.account === 'platform')
  const out = []
  for (const w of weeks) {
    const inW = ships.filter((s) => {
      const tm = new Date(s.createdAt).getTime()
      return tm >= w.start && tm < w.end
    })
    if (!inW.length) continue
    const ratio = inW.reduce((a, s) => a + s.price / s.cost, 0) / inW.length
    out.push({ weekStart: new Date(w.start).toISOString(), price: round2(lane.cost * ratio), n: inW.length })
  }
  return out
}

function zoneGroupOf(z) {
  return z <= 4 ? 'near' : z <= 6 ? 'mid' : 'far'
}

function view(l) {
  const overrides = (rateCards().dynamicOverrides || []).filter((o) => o.lane === l.lane).slice().sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')))
  const active = l.status === 'approved' ? overrides.find((o) => o.id === l.overrideId && o.status === 'approved') : null
  return {
    ...l,
    activePrice: active ? active.price : null,
    finalPrice: l.editedPrice ?? l.recommendedPrice,
    priceHistory: priceHistory(l),
    overrides,
  }
}

function counts(lanes) {
  const c = { proposed: 0, approved: 0, rejected: 0, expired: 0, none: 0 }
  for (const l of lanes) c[l.status] = (c[l.status] || 0) + 1
  return c
}

function metaInfo() {
  const doc = db.doc(DOC)
  const fm = forecastMeta()
  return {
    modelVersion: doc.modelVersion,
    forecastVersion: doc.forecastVersion,
    currentForecastVersion: fm.version,
    forecastTrainedAt: fm.trainedAt,
    stale: doc.forecastVersion !== fm.version,
    generatedAt: doc.generatedAt,
    refPackage: doc.refPackage,
  }
}

function findLane(id) {
  const l = db.doc(DOC).lanes.find((x) => x.lane === id || x.id === id)
  if (!l) throw err('NOT_FOUND', 404)
  return l
}

function prepare() {
  if (!initialized || !db.doc(DOC).liveComputed) ensureLive()
  sweepExpired()
}

export function listRecommendations({ all = false } = {}) {
  return request('GET /v1/ai/pricing/recommendations', () => {
    prepare()
    const lanes = db.doc(DOC).lanes.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    const shown = all ? lanes : lanes.slice(0, TOP_N)
    return { lanes: shown.map(view), totalLanes: lanes.length, counts: counts(shown), settings: getSettingsSync(), meta: metaInfo() }
  })
}

export function getRecommendation(id) {
  return request(`GET /v1/ai/pricing/recommendations/${id}`, () => {
    prepare()
    return view(findLane(id))
  }, { minMs: 200, maxMs: 450 })
}

/** Write (or replace) the rate engine override for a lane. Mutates the lane. */
function applyApproval(l, { auto = false, actor }) {
  const cfg = getSettingsSync()
  const rc = rateCards()
  const list = rc.dynamicOverrides || (rc.dynamicOverrides = [])
  for (const o of list) if (o.lane === l.lane && o.status === 'approved') o.status = 'superseded'
  const now = new Date()
  const price = round2(l.editedPrice ?? l.recommendedPrice)
  const doc = db.doc(DOC)
  const ov = {
    id: db.nextId('DPO'),
    lane: l.lane,
    hub: l.hub,
    carrier: l.carrier,
    service: l.service,
    zoneGroup: l.zoneGroup,
    price,
    refCost: l.cost,
    refPackage: doc.refPackage,
    recommendedPrice: l.recommendedPrice,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + cfg.validityDays * DAY).toISOString(),
    status: 'approved',
    approvedAt: now.toISOString(),
    approvedBy: actor,
    auto,
    modelVersion: doc.modelVersion,
    forecastVersion: doc.forecastVersion,
  }
  list.unshift(ov)
  Object.assign(l, { status: 'approved', approvedAt: ov.approvedAt, approvedBy: actor, approvedPrice: price, validUntil: ov.validUntil, overrideId: ov.id, auto })
  delete l.rejectedReason
  delete l.rejectedAt
  delete l.rejectedBy
  return ov
}

function autoApprove(actor) {
  const cfg = getSettingsSync()
  if (!cfg.autoApprove) return []
  const lanes = db.doc(DOC).lanes
  const out = []
  for (const l of lanes) {
    if (l.status !== 'proposed' || (l.rank ?? 99) > TOP_N) continue
    if (Math.abs(l.changePct) < cfg.autoApproveBelowPct) out.push(applyApproval(l, { auto: true, actor }))
  }
  return out
}

const RECOMPUTE_STEPS = ['forecast', 'shares', 'tiers', 'price', 'merge']

function doRecompute() {
  const doc = db.doc(DOC)
  const fresh = runModel()
  const { lanes, changed, reproposed } = merge(doc.lanes, fresh, 'recompute')
  const fm = forecastMeta()
  let auto = []
  const generatedAt = new Date().toISOString()
  // transaction() is async; the writes below are synchronous so a plain sequence is atomic enough
  db.patchDoc(DOC, { lanes, forecastVersion: fm.version, generatedAt, liveComputed: true })
  auto = autoApprove(t('aiModel.pricing.autoApprovedBy'))
  if (auto.length) {
    db.touch(DOC)
    db.touch('rate_cards')
  }
  return { changed, reproposed, autoApproved: auto.length, forecastVersion: fm.version, generatedAt }
}

export function recompute(onProgress) {
  return request('POST /v1/ai/pricing/recompute', async () => {
    requireManage()
    prepare()
    let res
    await runSteps(
      RECOMPUTE_STEPS.map((k) => async () => {
        if (k === 'merge') res = doRecompute()
      }),
      (pct, i) => onProgress?.(pct, { key: RECOMPUTE_STEPS[i], label: both(`pricing.steps.${RECOMPUTE_STEPS[i]}`) }),
      { stepMs: [150, 280] },
    )
    modelEvent('pricing', 'predict', {
      tr: `Dinamik fiyat önerileri talep tahmini ${res.forecastVersion} ile yeniden hesaplandı: ${res.changed} hat değişti${res.autoApproved ? `, ${res.autoApproved} otomatik onay` : ''}`,
      en: `Dynamic price recommendations recomputed with demand forecast ${res.forecastVersion}: ${res.changed} lanes changed${res.autoApproved ? `, ${res.autoApproved} auto approved` : ''}`,
    })
    audit('ai.pricing.recompute', res.forecastVersion, { tr: `${res.changed} hat güncellendi`, en: `${res.changed} lanes updated` })
    return res
  }, { minMs: 300, maxMs: 500 })
}

export function approve(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  return request('POST /v1/ai/pricing/approve', async () => {
    requireManage()
    prepare()
    if (!list.length) throw err('NOTHING_SELECTED')
    const lanes = list.map(findLane)
    const { actor } = userCtx()
    const overrides = []
    await db.transaction(async () => {
      for (const l of lanes) overrides.push(applyApproval(l, { actor }))
      db.touch(DOC)
      db.touch('rate_cards')
    })
    for (const l of lanes) {
      audit('ai.pricing.approve', l.lane, {
        tr: `${l.lane} dinamik fiyat ${fmtMoney(l.approvedPrice, 'tr')} onaylandı (7 gün)`,
        en: `${l.lane} dynamic price ${fmtMoney(l.approvedPrice)} approved (7 days)`,
      })
    }
    modelEvent('pricing', 'approve', {
      tr: `${lanes.length} hat için dinamik fiyat onaylandı: ${lanes.map((l) => l.lane).join(', ')}`,
      en: `Dynamic price approved for ${lanes.length} lanes: ${lanes.map((l) => l.lane).join(', ')}`,
    })
    notify({ type: 'success', title: both('pricing.approveNotifyTitle', { n: lanes.length }), body: both('pricing.approveNotifyBody'), link: '/ai/pricing' })
    return { approved: lanes.length, lanes: lanes.map(view), overrides }
  })
}

function fmtMoney(v, lang = 'en') {
  return moneyText(Number(v))[lang]
}

export function reject(id, reason) {
  return request(`POST /v1/ai/pricing/recommendations/${id}/reject`, () => {
    requireManage()
    prepare()
    const text = typeof reason === 'string' ? reason.trim() : reason && typeof reason === 'object' ? reason : ''
    if (!text || (typeof text === 'string' && text.length < 3)) throw err('REASON_REQUIRED', 422, { field: 'reason' })
    const l = findLane(id)
    const { actor } = userCtx()
    if (l.status === 'approved') revokeOverride(l)
    Object.assign(l, { status: 'rejected', rejectedReason: text, rejectedAt: new Date().toISOString(), rejectedBy: actor })
    delete l.editedPrice
    db.touch(DOC)
    const rs = typeof text === 'string' ? text : text.tr
    audit('ai.pricing.reject', l.lane, { tr: `Öneri reddedildi: ${rs}`, en: `Recommendation rejected: ${typeof text === 'string' ? text : text.en}` })
    modelEvent('pricing', 'feedback', { tr: `${l.lane} önerisi reddedildi: ${rs}`, en: `${l.lane} recommendation rejected: ${typeof text === 'string' ? text : text.en}` })
    return view(l)
  })
}

function revokeOverride(l) {
  const rc = rateCards()
  for (const o of rc.dynamicOverrides || []) if (o.lane === l.lane && o.status === 'approved') o.status = 'revoked'
  db.touch('rate_cards')
  for (const k of ['approvedAt', 'approvedBy', 'approvedPrice', 'validUntil', 'overrideId', 'auto']) delete l[k]
}

export function revoke(id) {
  return request(`POST /v1/ai/pricing/recommendations/${id}/revoke`, () => {
    requireManage()
    prepare()
    const l = findLane(id)
    if (l.status === 'approved') revokeOverride(l)
    l.status = 'proposed'
    db.touch(DOC)
    audit('ai.pricing.revoke', l.lane, { tr: 'Dinamik fiyat onayı geri alındı', en: 'Dynamic price approval revoked' })
    return view(l)
  })
}

export function checkPrice(id, price) {
  const l = db.doc(DOC).lanes.find((x) => x.lane === id)
  const p = Number(price)
  if (!l || !Number.isFinite(p) || p <= 0) return []
  const w = []
  const cfg = getSettingsSync()
  const range = l.range || [l.recommendedPrice * 0.96, l.recommendedPrice * 1.04]
  const floor = round2((l.expectedCost ?? l.cost) * (1 + cfg.minMargin))
  const cap = round2((l.marketRef || 0) * cfg.marketCapMultiplier)
  if (p < range[0] || p > range[1]) w.push({ code: 'OUT_OF_RANGE', params: { lo: fmt.money(range[0]), hi: fmt.money(range[1]) } })
  if (p <= (l.expectedCost ?? l.cost)) w.push({ code: 'BELOW_COST', params: {} })
  else if (p < floor) w.push({ code: 'BELOW_FLOOR', params: { floor: fmt.money(floor) } })
  if (cap && p > cap) w.push({ code: 'ABOVE_MARKET_CAP', params: { cap: fmt.money(cap) } })
  return w
}

export function editPrice(id, price) {
  return request(`PATCH /v1/ai/pricing/recommendations/${id}`, () => {
    requireManage()
    prepare()
    const p = round2(Number(price))
    if (!Number.isFinite(p) || p <= 0 || p > 10000) throw err('INVALID_PRICE', 422, { field: 'price' })
    const l = findLane(id)
    const warnings = checkPrice(id, p)
    const { actor } = userCtx()
    Object.assign(l, { editedPrice: p, editedAt: new Date().toISOString(), editedBy: actor })
    if (l.status === 'approved') {
      const ov = (rateCards().dynamicOverrides || []).find((o) => o.id === l.overrideId)
      if (ov) {
        ov.price = p
        ov.editedAt = l.editedAt
        db.touch('rate_cards')
      }
      l.approvedPrice = p
    } else {
      l.status = 'proposed'
      delete l.rejectedReason
    }
    db.touch(DOC)
    audit('ai.pricing.edit', l.lane, { tr: `Elle fiyat ${fmtMoney(p, 'tr')} (öneri ${fmtMoney(l.recommendedPrice, 'tr')})`, en: `Manual price ${fmtMoney(p)} (recommended ${fmtMoney(l.recommendedPrice)})` })
    modelEvent('pricing', 'feedback', { tr: `${l.lane} için elle fiyat: ${fmtMoney(p, 'tr')}`, en: `Manual price for ${l.lane}: ${fmtMoney(p)}` })
    return { lane: view(l), warnings }
  }, { minMs: 250, maxMs: 500 })
}

export function getSettings() {
  return request('GET /v1/ai/pricing/settings', () => getSettingsSync(), { minMs: 200, maxMs: 400 })
}

export function saveSettings(patch = {}) {
  return request('PUT /v1/ai/pricing/settings', () => {
    requireManage()
    const cur = getSettingsSync()
    const next = { ...cur, ...patch }
    const bad = (field) => err('INVALID_SETTINGS', 422, { field })
    const n = (v) => Number(v)
    if (!(n(next.minMargin) >= 0 && n(next.minMargin) <= 0.5)) throw bad('minMargin')
    if (!(n(next.maxMargin) > n(next.minMargin) && n(next.maxMargin) <= 1)) throw bad('maxMargin')
    if (!(n(next.marketCapMultiplier) >= 1 && n(next.marketCapMultiplier) <= 1.5)) throw bad('marketCapMultiplier')
    if (!(n(next.autoApproveBelowPct) >= 0 && n(next.autoApproveBelowPct) <= 0.2)) throw bad('autoApproveBelowPct')
    const rc = rateCards()
    rc.platform = {
      ...(rc.platform || {}),
      marginRange: { min: n(next.minMargin), max: n(next.maxMargin) },
      marketCapMultiplier: n(next.marketCapMultiplier),
      autoApprove: !!next.autoApprove,
      autoApproveBelowPct: n(next.autoApproveBelowPct),
    }
    db.touch('rate_cards')
    audit('ai.pricing.settings', 'pricing', {
      tr: `Marj %${Math.round(next.minMargin * 100)}-%${Math.round(next.maxMargin * 100)}, piyasa sınırı x${n(next.marketCapMultiplier).toFixed(2)}, otomatik onay ${next.autoApprove ? 'açık' : 'kapalı'}`,
      en: `Margin ${Math.round(next.minMargin * 100)}%-${Math.round(next.maxMargin * 100)}%, market cap x${n(next.marketCapMultiplier).toFixed(2)}, auto approve ${next.autoApprove ? 'on' : 'off'}`,
    })
    prepare()
    const res = doRecompute()
    return { settings: getSettingsSync(), recompute: res }
  })
}

/** Sync + reactive (reads the live db doc): lanes waiting for approval. */
export function pendingCount() {
  const lanes = db.doc(DOC)?.lanes || []
  return lanes.filter((l) => l.status === 'proposed').length
}

/** Sync: overrides the rate engine will currently apply. */
export function activeOverrides() {
  const now = Date.now()
  return (rateCards().dynamicOverrides || []).filter((o) => o.status === 'approved' && (!o.validUntil || new Date(o.validUntil).getTime() >= now))
}
