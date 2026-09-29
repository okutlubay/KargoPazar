/**
 * Platform administration API (spec 10.2 rate cards, 10.3 customers, 10.4 system, 10.5 R&D).
 * Carrier admin (list, detail, wizard) lives in api/carriers.js; countries in api/countries.js.
 *
 * Rate cards (db doc 'rate_cards'; the rate engine and the landing calculator read it directly)
 *   getRateCards() -> { platform, plans, carrierAgreements: [agreement & { carrierName, color, ink,
 *       weeklyVolume, currentTier, nextTier }], customerCards: [card & { customerName, active }],
 *       dynamicOverrides: [active override & { carrierName, serviceName }], customers }
 *   updatePlatformTariff({ markup: {starter, professional, enterprise}, minLabelFee, insurance: {per100, freeUpTo} })
 *       -> platform   VALIDATION { 'markup.starter': 'range', ... }   (also updates plans[].markupPct)
 *   setAgreementTier(carrier, discountPct) -> agreement   (activeTierDiscountPct, must be one of the tiers)
 *   saveCustomerCard(card) -> card     card = { id?, customerId, name, lines: [{ carrier, service, markupPct?|fixedPrice? }],
 *       validFrom, validUntil, status: 'approved'|'pending_review'|'draft', note? }
 *   removeCustomerCard(id) -> { removed, index }     restoreCustomerCard(card, index) -> card
 *   setCustomerCardStatus(id, status) -> card
 *   simulatePrice(input) -> SimResult
 *     input = { customerId, hub, toZip, residential, declaredValue, insured?, pkg, serviceKey? ('UPS-GROUND') }
 *     SimResult = { customer: {id, name, plan}, zone, toState, billable, quotes: Quote[], selected: Quote,
 *       steps: [{ code, amount?, params }], tariff: 'platform'|'custom'|'dynamic' }
 *
 * Customers
 *   listCustomers() -> [customer & { shipments30d, series: [{ x: ISO day, y }] }]
 *     (demo company series is computed from the live shipments collection)
 *
 * System status
 *   getSystemStatus() -> system doc & { panel: { p95Ms, avgMs, requests, errorRate, bySource, lastAt },
 *       adapters (live carrier list), connectors (live stores), currentVersion }
 *
 * R&D roadmap
 *   listRoadmap() -> roadmap items sorted by `no`
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit } from '../store/events.js'
import { session } from '../store/session.js'
import { rateShop, quoteService, zoneFor, billableWeight, platformConfig, insuranceFor, toDate, round2 } from '@/shared/rateEngine.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const DAY = 864e5
const PLAN_IDS = ['starter', 'professional', 'enterprise']

function weeklyVolume(carrier) {
  const since = new Date(Date.now() - 28 * DAY).toISOString()
  const n = db.all('shipments').filter(s => s.carrier === carrier && !s.test && s.status !== 'voided' && s.createdAt >= since).length
  return Math.round((n / 4) * 10) / 10
}

function customerName(id) {
  if (!id) return null
  return db.get('customers', id)?.name ?? id
}

function cardActive(card, now = new Date()) {
  const from = toDate(card.validFrom)
  const until = toDate(card.validUntil)
  return card.status === 'approved' && (!from || from <= now) && (!until || until >= now)
}

export function getRateCards() {
  return request('GET /v1/admin/rate-cards', () => {
    const rc = db.doc('rate_cards')
    const carriers = db.all('carriers')
    const now = new Date()
    const agreements = (rc.carrierAgreements ?? []).map(a => {
      const c = carriers.find(x => x.code === a.carrier)
      const vol = weeklyVolume(a.carrier)
      const tiers = [...(a.tiers ?? [])].sort((x, y) => x.weeklyVolume - y.weeklyVolume)
      const reached = tiers.filter(t => t.weeklyVolume <= vol).pop() ?? tiers[0] ?? null
      const next = tiers.find(t => t.weeklyVolume > vol) ?? null
      return { ...plain(a), tiers, carrierName: c?.name ?? a.carrier, color: c?.color, ink: c?.ink, weeklyVolume: vol, reachedTier: plain(reached), nextTier: plain(next) }
    })
    const cards = (rc.customerCards ?? []).map(card => ({ ...plain(card), customerName: customerName(card.customerId), active: cardActive(card, now) }))
    const overrides = (rc.dynamicOverrides ?? []).filter(o => o.status === 'approved' && (!o.validUntil || toDate(o.validUntil) >= now)).map(o => {
      const c = carriers.find(x => x.code === o.carrier)
      return { ...plain(o), carrierName: c?.name ?? o.carrier, serviceName: c?.services?.find(s => s.code === o.service)?.name ?? o.service }
    })
    return {
      platform: plain(platformConfig(rc)),
      plans: plain(rc.plans ?? []),
      carrierAgreements: agreements,
      customerCards: cards,
      dynamicOverrides: overrides,
      customers: db.all('customers').map(c => ({ id: c.id, name: c.name, plan: c.id === db.doc('user').customerId ? session.plan : c.plan })),
    }
  }, { minMs: 300, maxMs: 600 })
}

export function updatePlatformTariff(input) {
  return request('PUT /v1/admin/rate-cards/platform', () => {
    const errors = {}
    const markup = {}
    for (const p of PLAN_IDS) {
      const v = Number(input.markup?.[p])
      if (!Number.isFinite(v) || v < 0 || v > 1) errors[`markup.${p}`] = 'range'
      else markup[p] = Math.round(v * 10000) / 10000
    }
    const minLabelFee = Number(input.minLabelFee)
    if (!Number.isFinite(minLabelFee) || minLabelFee < 0 || minLabelFee > 10) errors.minLabelFee = 'range'
    const per100 = Number(input.insurance?.per100)
    const freeUpTo = Number(input.insurance?.freeUpTo)
    if (!Number.isFinite(per100) || per100 < 0 || per100 > 20) errors['insurance.per100'] = 'range'
    if (!Number.isFinite(freeUpTo) || freeUpTo < 0 || freeUpTo > 5000) errors['insurance.freeUpTo'] = 'range'
    if (!errors['markup.starter'] && !errors['markup.enterprise'] && markup.starter < markup.enterprise) errors['markup.starter'] = 'order'
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid tariff', 422, errors)
    const rc = db.doc('rate_cards')
    const before = plain(rc.platform)
    const platform = { ...rc.platform, markup, minLabelFee: round2(minLabelFee), insurance: { ...(rc.platform?.insurance ?? {}), per100: round2(per100), freeUpTo: round2(freeUpTo) } }
    const plans = (rc.plans ?? []).map(p => ({ ...p, markupPct: markup[p.id] ?? p.markupPct }))
    db.patchDoc('rate_cards', { platform, plans })
    const diff = PLAN_IDS.filter(p => before?.markup?.[p] !== markup[p]).map(p => `${p} ${Math.round((before?.markup?.[p] ?? 0) * 1000) / 10}% > ${Math.round(markup[p] * 1000) / 10}%`).join(', ')
    audit('rate_card.platform_update', 'platform', { tr: `Platform tarifesi güncellendi${diff ? ': ' + diff : ''}`, en: `Platform tariff updated${diff ? ': ' + diff : ''}` })
    return plain(platformConfig(db.doc('rate_cards')))
  })
}

export function setAgreementTier(carrier, discountPct) {
  return request(`PATCH /v1/admin/carrier-agreements/${carrier}`, () => {
    const rc = db.doc('rate_cards')
    const a = (rc.carrierAgreements ?? []).find(x => x.carrier === carrier)
    if (!a) throw new ApiError('NOT_FOUND', 'Agreement not found', 404)
    const v = Number(discountPct)
    if (!(a.tiers ?? []).some(t => Math.abs(t.discountPct - v) < 1e-9)) throw new ApiError('VALIDATION', 'Unknown tier', 422, { tier: 'invalid' })
    const before = a.activeTierDiscountPct ?? 0
    a.activeTierDiscountPct = v
    db.touch('rate_cards')
    audit('rate_card.tier', carrier, { tr: `${carrier} hacim kademesi: %${before * 100} > %${Math.round(v * 1000) / 10}`, en: `${carrier} volume tier: ${before * 100}% > ${Math.round(v * 1000) / 10}%` })
    return plain(a)
  }, { minMs: 300, maxMs: 600 })
}

function validateCard(card) {
  const errors = {}
  if (!db.get('customers', card.customerId)) errors.customerId = 'required'
  if (String(card.name ?? '').trim().length < 3) errors.name = 'required'
  const from = toDate(card.validFrom)
  const until = toDate(card.validUntil)
  if (!from || Number.isNaN(from.getTime())) errors.validFrom = 'required'
  if (!until || Number.isNaN(until.getTime())) errors.validUntil = 'required'
  else if (from && until <= from) errors.validUntil = 'after_start'
  if (!['approved', 'pending_review', 'draft'].includes(card.status)) errors.status = 'required'
  const lines = card.lines ?? []
  if (!lines.length) errors.lines = 'required'
  const seen = new Set()
  lines.forEach((l, i) => {
    const c = db.get('carriers', l.carrier)
    if (!c || !(c.services ?? []).some(s => s.code === l.service || l.service === '*')) errors[`lines.${i}.service`] = 'required'
    const key = `${l.carrier}-${l.service}`
    if (seen.has(key)) errors[`lines.${i}.service`] = 'duplicate'
    seen.add(key)
    if (l.fixedPrice != null && l.fixedPrice !== '') {
      if (!(Number(l.fixedPrice) > 0)) errors[`lines.${i}.value`] = 'positive'
    } else if (!(Number(l.markupPct) >= 0 && Number(l.markupPct) <= 1)) errors[`lines.${i}.value`] = 'range'
  })
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid rate card', 422, errors)
}

export function saveCustomerCard(input) {
  return request(input.id ? `PUT /v1/admin/rate-cards/customers/${input.id}` : 'POST /v1/admin/rate-cards/customers', () => {
    validateCard(input)
    const rc = db.doc('rate_cards')
    const cards = rc.customerCards ?? (rc.customerCards = [])
    const lines = input.lines.map(l => (l.fixedPrice != null && l.fixedPrice !== ''
      ? { carrier: l.carrier, service: l.service, fixedPrice: round2(Number(l.fixedPrice)) }
      : { carrier: l.carrier, service: l.service, markupPct: Math.round(Number(l.markupPct) * 10000) / 10000 }))
    const base = {
      customerId: input.customerId, name: String(input.name).trim(), lines,
      validFrom: toDate(input.validFrom).toISOString(), validUntil: toDate(input.validUntil).toISOString(),
      status: input.status, note: input.note ?? null,
    }
    const now = new Date().toISOString()
    let card
    const existing = input.id ? cards.find(c => c.id === input.id) : null
    if (existing) {
      Object.assign(existing, base, { updatedAt: now, ...(input.status === 'approved' && existing.status !== 'approved' ? { approvedBy: session.user?.name ?? null, approvedAt: now } : {}) })
      card = existing
      audit('rate_card.update', card.id, { tr: `Özel tarife güncellendi: ${card.name}`, en: `Custom rate card updated: ${card.name}` })
    } else {
      const counters = db.doc('counters')
      let n = (counters.RC ?? cards.length) + 1
      while (cards.some(c => c.id === `RC-C-${String(n).padStart(3, '0')}`)) n++
      counters.RC = n
      db.touch('counters')
      card = { id: `RC-C-${String(n).padStart(3, '0')}`, ...base, createdAt: now, approvedBy: input.status === 'approved' ? session.user?.name ?? null : null, approvedAt: input.status === 'approved' ? now : null }
      cards.push(card)
      audit('rate_card.create', card.id, { tr: `Özel tarife oluşturuldu: ${card.name}`, en: `Custom rate card created: ${card.name}` })
    }
    db.touch('rate_cards')
    return { ...plain(card), customerName: customerName(card.customerId), active: cardActive(card) }
  })
}

export function setCustomerCardStatus(id, status) {
  return request(`PATCH /v1/admin/rate-cards/customers/${id}`, () => {
    const card = (db.doc('rate_cards').customerCards ?? []).find(c => c.id === id)
    if (!card) throw new ApiError('NOT_FOUND', 'Rate card not found', 404)
    if (!['approved', 'pending_review', 'draft'].includes(status)) throw new ApiError('VALIDATION', 'Invalid status', 422)
    card.status = status
    if (status === 'approved') { card.approvedBy = session.user?.name ?? null; card.approvedAt = new Date().toISOString() }
    db.touch('rate_cards')
    audit('rate_card.status', id, { tr: `Özel tarife durumu: ${status}`, en: `Custom rate card status: ${status}` })
    return { ...plain(card), customerName: customerName(card.customerId), active: cardActive(card) }
  }, { minMs: 300, maxMs: 600 })
}

export function removeCustomerCard(id) {
  return request(`DELETE /v1/admin/rate-cards/customers/${id}`, () => {
    const rc = db.doc('rate_cards')
    const i = (rc.customerCards ?? []).findIndex(c => c.id === id)
    if (i < 0) throw new ApiError('NOT_FOUND', 'Rate card not found', 404)
    const [removed] = rc.customerCards.splice(i, 1)
    db.touch('rate_cards')
    audit('rate_card.delete', id, { tr: `Özel tarife silindi: ${removed.name}`, en: `Custom rate card deleted: ${removed.name}` })
    return { removed: plain(removed), index: i }
  })
}

export function restoreCustomerCard(card, index = null) {
  return request('POST /v1/admin/rate-cards/customers', () => {
    const rc = db.doc('rate_cards')
    const cards = rc.customerCards ?? (rc.customerCards = [])
    if (!cards.some(c => c.id === card.id)) {
      const rec = plain(card)
      delete rec.customerName; delete rec.active
      if (index != null && index >= 0 && index <= cards.length) cards.splice(index, 0, rec)
      else cards.push(rec)
      db.touch('rate_cards')
    }
    audit('rate_card.restore', card.id, { tr: `Özel tarife geri alındı: ${card.name}`, en: `Custom rate card restored: ${card.name}` })
    return plain(cards.find(c => c.id === card.id))
  }, { minMs: 150, maxMs: 300 })
}

function stateForZip(zip) {
  const z3 = String(zip ?? '').replace(/\D/g, '').slice(0, 3)
  const exact = db.all('zip_city').find(z => z.zip === String(zip).slice(0, 5))
  if (exact) return exact.state
  return db.doc('zip3_state')?.[z3] ?? null
}

export function simulatePrice(input) {
  return request('POST /v1/admin/rate-cards/simulate', () => {
    const errors = {}
    const customer = db.get('customers', input.customerId)
    if (!customer) errors.customerId = 'required'
    if (!/^\d{5}$/.test(String(input.toZip ?? ''))) errors.toZip = 'zip'
    const pkg = input.pkg ?? {}
    for (const k of ['lengthIn', 'widthIn', 'heightIn', 'weightLb']) if (!(Number(pkg[k]) > 0)) errors[`pkg.${k}`] = 'positive'
    if (!['NJ01', 'LA01'].includes(input.hub)) errors.hub = 'required'
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid input', 422, errors)

    const isDemo = customer.id === db.doc('user').customerId
    const plan = isDemo ? session.plan : customer.plan
    const rateCards = plain(db.doc('rate_cards'))
    const carriers = plain(db.all('carriers'))
    const toState = stateForZip(input.toZip)
    const residential = input.residential !== false
    const declaredValue = Number(input.declaredValue) || 0
    const common = {
      carriers, hub: input.hub, toZip: input.toZip, toState, pkg: { lengthIn: Number(pkg.lengthIn), widthIn: Number(pkg.widthIn), heightIn: Number(pkg.heightIn), weightLb: Number(pkg.weightLb) },
      residential, declaredValue, insured: input.insured, plan, rateCards, customerId: customer.id,
    }
    const quotes = rateShop(common)
    if (!quotes.length) throw new ApiError('NO_SERVICES', 'No eligible services', 422)
    const selected = quotes.find(q => `${q.carrierCode}-${q.serviceCode}` === input.serviceKey) ?? quotes[0]
    const carrier = carriers.find(c => c.code === selected.carrierCode)
    const service = carrier.services.find(s => s.code === selected.serviceCode)
    const cfg = platformConfig(rateCards)
    const zone = zoneFor(input.hub, input.toZip)
    const bw = billableWeight(common.pkg)
    const tier = selected.ruleNotes.find(n => n.code === 'volume_tier')
    const rawBase = round2(Number(service.base[zone]) + Number(service.perLb?.[zone] ?? 0) * Math.max(0, bw.billableLb - 1))
    const custom = selected.ruleNotes.find(n => n.code === 'custom_card')
    const dyn = selected.ruleNotes.find(n => n.code === 'dynamic_price')
    const preDynamic = dyn ? round2(selected.sellPrice - dyn.delta) : selected.sellPrice
    const planMarkup = Number(cfg.markup[plan] ?? cfg.markup.starter)
    const markupApplied = custom ? (custom.fixedPrice != null ? null : custom.markupPct) : planMarkup
    const markedUp = markupApplied != null ? round2(selected.cost * (1 + markupApplied)) : null
    const minFloor = round2(selected.cost + Number(cfg.minLabelFee))
    const steps = [
      { code: 'zone', params: { hub: input.hub, zip: input.toZip, state: toState ?? '-', zone } },
      { code: 'billable', params: { actual: bw.actualLb, dim: bw.dimWeightLb, billable: bw.billableLb } },
      { code: 'base', amount: rawBase, params: { base: service.base[zone], perLb: service.perLb?.[zone] ?? 0, extra: Math.max(0, bw.billableLb - 1) } },
    ]
    if (tier) steps.push({ code: 'tier', amount: round2(selected.base - rawBase), params: { pct: tier.discountPct } })
    steps.push({ code: 'fuel', amount: selected.fuel, params: { pct: carrier.fuelPct } })
    if (selected.residential) steps.push({ code: 'residential', amount: selected.residential, params: {} })
    steps.push({ code: 'cost', amount: selected.cost, params: {} })
    if (custom) {
      if (custom.fixedPrice != null) steps.push({ code: 'custom_fixed', amount: custom.fixedPrice, params: { card: custom.name } })
      else steps.push({ code: 'custom_markup', amount: markedUp, params: { card: custom.name, pct: custom.markupPct, planPct: planMarkup, plan } })
    } else steps.push({ code: 'plan_markup', amount: markedUp, params: { plan, pct: planMarkup } })
    if (markedUp != null && minFloor > markedUp) steps.push({ code: 'min_fee', amount: minFloor, params: { fee: cfg.minLabelFee } })
    if (dyn) steps.push({ code: 'dynamic', amount: selected.sellPrice, params: { before: preDynamic, lane: dyn.lane, id: dyn.overrideId } })
    steps.push({ code: 'sell', amount: selected.sellPrice, params: {} })
    steps.push({ code: 'insurance', amount: selected.insurance, params: { value: declaredValue, free: cfg.insurance.freeUpTo, per100: cfg.insurance.per100, expected: insuranceFor(declaredValue, cfg.insurance) } })
    steps.push({ code: 'total', amount: selected.total, params: {} })
    return {
      customer: { id: customer.id, name: customer.name, plan },
      zone, toState, billable: bw, quotes, selected, steps,
      tariff: dyn ? 'dynamic' : custom ? 'custom' : 'platform',
    }
  }, { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
function dayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString() }

export function listCustomers() {
  return request('GET /v1/admin/customers', () => {
    const me = db.doc('user')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const days = Array.from({ length: 30 }, (_, i) => new Date(today.getTime() - (29 - i) * DAY).toISOString())
    const liveCounts = new Map(days.map(d => [d, 0]))
    for (const s of db.all('shipments')) {
      if (s.test || s.status === 'voided' || !s.createdAt) continue
      const k = dayKey(s.createdAt)
      if (liveCounts.has(k)) liveCounts.set(k, liveCounts.get(k) + 1)
    }
    const stores = db.all('stores').filter(s => s.status === 'connected').map(s => s.channel)
    return db.all('customers').map(c => {
      const isDemo = c.id === me.customerId
      const values = isDemo ? days.map(d => liveCounts.get(d)) : (c.last30d ?? [])
      const series = days.map((d, i) => ({ x: d, y: values[i] ?? 0 }))
      return {
        ...plain(c),
        plan: isDemo ? session.plan : c.plan,
        channels: isDemo ? stores : c.channels,
        hub: isDemo ? me.company?.defaultHub ?? c.hub : c.hub,
        name: isDemo ? me.company?.name ?? c.name : c.name,
        shipments30d: values.reduce((a, b) => a + (b || 0), 0),
        series,
        isDemo,
      }
    })
  }, { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// System status
// ---------------------------------------------------------------------------
function percentile(arr, p) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))
  return s[i]
}

export function panelMetrics() {
  const log = db.all('requestLog')
  const ms = log.map(r => r.ms).filter(v => Number.isFinite(v))
  const errors = log.filter(r => r.status >= 400).length
  const bySource = {}
  for (const r of log) bySource[r.source ?? 'panel'] = (bySource[r.source ?? 'panel'] ?? 0) + 1
  return {
    p95Ms: percentile(ms, 0.95),
    p50Ms: percentile(ms, 0.5),
    avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    requests: log.length,
    errorRate: log.length ? errors / log.length : 0,
    errors,
    bySource,
    lastAt: log[0]?.at ?? null,
    recent: log.slice(0, 30).map(r => ({ ms: r.ms, status: r.status, path: r.path, method: r.method, at: r.at })).reverse(),
  }
}

export function getSystemStatus() {
  return request('GET /v1/admin/system', () => {
    const sys = plain(db.doc('system'))
    const carriers = db.all('carriers')
    const svcAdapters = sys.services.find(s => s.id === 'carriers')?.adapters ?? []
    const adapters = carriers.map(c => {
      const seeded = svcAdapters.find(a => a.carrier === c.code)
      return { carrier: c.code, name: c.name, color: c.color, ink: c.ink, status: c.status === 'active' ? (seeded?.status ?? 'up') : c.status === 'testing' ? 'degraded' : 'down', avgMs: seeded?.avgMs ?? c.apiHealth?.avgMs ?? null, carrierStatus: c.status }
    })
    const stores = db.all('stores')
    const connectors = stores.map(s => ({ id: s.id, channel: s.channel, name: s.name, status: s.status === 'connected' ? 'up' : 'none' }))
    const panel = panelMetrics()
    const current = (sys.deploys ?? []).find(d => d.current) ?? (sys.deploys ?? []).slice(-1)[0] ?? null
    return { ...sys, adapters, connectors, panel, currentVersion: current?.version ?? null, checkedAt: new Date().toISOString() }
  }, { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// R&D roadmap
// ---------------------------------------------------------------------------
export function listRoadmap() {
  return request('GET /v1/admin/roadmap', () => [...db.all('roadmap')].sort((a, b) => a.no - b.no), { minMs: 250, maxMs: 500 })
}
