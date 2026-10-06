/**
 * Customs records (declaration summary, status timeline, estimated vs final duties) derived
 * deterministically from existing data: intl_shipments stage history (first mile) and shipment
 * events (direct TR -> US last mile, international shipments created in the panel).
 *
 *   intlCustomsRecord(rec) -> CustomsRecord        (sync, rec = getIntl() result or raw intl record)
 *   shipmentCustomsRecord(s) -> CustomsRecord | { kind: 'stock', firstMileRef, firstMile: CustomsRecord|null } | null
 *   CustomsRecord = { kind: 'intl'|'direct', id, entryNo, origin, dest, incoterm, form, valueUsd,
 *     items: [{ title, sku, hsCode, qty, valueUsd, origin }], estimate (estimateLandedCostMulti result),
 *     final: { totalUsd, totalDest, destCurrency, diffUsd } | null, status, steps: [{ key, at, state }],
 *     releasedAt, declaredAt }
 *     steps keys: declared, review, assessed, released; state: done|current|pending|blocked
 *   listRecentDeclarations({ limit }) -> [CustomsRecord + { ref, routeName, routeParams }] (async)
 *   customsMonthStats() -> { dutiesUsd, count, declarations, avgRate } (async, current calendar month)
 */
import { db } from '../store/db.js'
import { request } from './client.js'
import { estimateLandedCostMulti } from './landedCost.js'

const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const HOUR = 3600e3

function hash01(str) {
  let h = 2166136261
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}
const plusHours = (iso, h) => (iso ? new Date(new Date(iso).getTime() + h * HOUR).toISOString() : null)
const entryNoFor = id => 'KPZ-' + String(Math.floor(hash01(id + ':entry') * 9e6) + 1e6) + '-' + String(id).replace(/\D/g, '').slice(-4).padStart(4, '0')

/** Final assessed duties: the estimate adjusted by a small deterministic factor (valuation, rounding, fees). */
function finalOf(estimate, id) {
  const f = 0.97 + hash01(id) * 0.06
  const totalUsd = r2(estimate.totalUsd * f)
  return { totalUsd, totalDest: r2(estimate.totalDest * f), destCurrency: estimate.destCurrency, diffUsd: r2(totalUsd - estimate.totalUsd) }
}

function buildSteps(times, { blockedAt = null } = {}) {
  const keys = ['declared', 'review', 'assessed', 'released']
  let currentSet = false
  return keys.map(k => {
    const at = times[k] || null
    if (at) return { key: k, at, state: 'done' }
    if (!currentSet) {
      currentSet = true
      return { key: k, at: null, state: blockedAt === k ? 'blocked' : 'current' }
    }
    return { key: k, at: null, state: 'pending' }
  })
}

function statusOf(steps, blocked) {
  if (blocked) return 'docs_requested'
  const done = steps.filter(s => s.state === 'done').map(s => s.key)
  if (done.includes('released')) return 'released'
  if (done.includes('assessed')) return 'assessed'
  if (done.includes('review')) return 'under_review'
  if (done.includes('declared')) return 'declared'
  return 'not_declared'
}

// ---------------------------------------------------------------------------
// First mile (intl_shipments)
// ---------------------------------------------------------------------------
function intlItems(rec) {
  const map = new Map()
  for (const p of rec.parcels || []) {
    for (const it of p.items || []) {
      const k = (it.sku || it.title) + '|' + (it.hsCode || '')
      const prev = map.get(k)
      const v = (Number(it.unitValueUsd) || 0) * (Number(it.qty) || 0)
      if (prev) { prev.qty += Number(it.qty) || 0; prev.valueUsd = r2(prev.valueUsd + v) }
      else map.set(k, { title: it.title, sku: it.sku || '', hsCode: it.hsCode || '', qty: Number(it.qty) || 0, valueUsd: r2(v), origin: it.origin || rec.origin })
    }
  }
  return [...map.values()]
}

export function intlCustomsRecord(rec) {
  if (!rec) return null
  const items = intlItems(rec)
  const valueUsd = r2(items.reduce((s, i) => s + i.valueUsd, 0))
  const incoterm = rec.incoterm === 'DDU' ? 'DDU' : 'DDP'
  const estimate = estimateLandedCostMulti(items, { dest: 'US', origin: rec.origin, incoterm })
  const at = st => (rec.stageHistory || []).find(h => h.stage === st && !h.kind)?.at || null
  const blocked = rec.customsStatus === 'docs_requested'
  const review = at('us_customs')
  const cleared = at('customs_cleared')
  const docsUp = (rec.stageHistory || []).find(h => h.kind === 'docs_uploaded')?.at || null
  const times = {
    declared: at('in_flight'),
    review,
    assessed: cleared ? (docsUp && docsUp < cleared ? plusHours(docsUp, 1) : new Date((new Date(review || cleared).getTime() + new Date(cleared).getTime()) / 2).toISOString()) : null,
    released: cleared,
  }
  const steps = buildSteps(times, { blockedAt: blocked ? 'assessed' : null })
  const status = statusOf(steps, blocked)
  return {
    kind: 'intl',
    id: rec.id,
    entryNo: entryNoFor(rec.id),
    origin: rec.origin,
    dest: 'US',
    incoterm,
    form: valueUsd <= 400 ? 'cn22' : 'cn23',
    valueUsd,
    items,
    estimate,
    final: times.assessed ? finalOf(estimate, rec.id) : null,
    status,
    steps,
    declaredAt: times.declared,
    releasedAt: times.released,
    mawb: rec.mawb || null,
    customsStatus: rec.customsStatus || null,
    createdAt: rec.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Last mile shipments
// ---------------------------------------------------------------------------
function shipmentItems(s) {
  const origin = s.origin || s.from?.country || 'US'
  if (s.customs?.items?.length) {
    return s.customs.items.map(i => ({ title: i.description, sku: i.sku || '', hsCode: i.hsCode || '', qty: Number(i.qty) || 1, valueUsd: r2((Number(i.qty) || 1) * (Number(i.unitValue) || 0)), origin: i.origin || origin }))
  }
  const order = s.order || (s.orderId ? db.get('orders', s.orderId) : null)
  const lines = order?.items || []
  if (lines.length) {
    return lines.map(i => {
      const p = i.sku ? db.find('products', x => x.sku === i.sku) : null
      return { title: i.title, sku: i.sku || '', hsCode: i.hsCode || p?.hsCode || '', qty: Number(i.qty) || 1, valueUsd: r2((Number(i.qty) || 1) * (Number(i.unitPrice) || 0)), origin: p?.origin || origin }
    })
  }
  // no item data: the declared value on one line, HS from the catalog product closest in value
  const value = Number(s.declaredValue) || 0
  const products = db.all('products').filter(p => p.hsCode && (p.origin || 'TR') === origin)
  const p = products.length ? products.reduce((m, x) => (Math.abs((x.value || 0) - value) < Math.abs((m.value || 0) - value) ? x : m)) : null
  const title = p ? (typeof p.title === 'object' ? p.title.en : p.title) : 'Merchandise'
  return [{ title, sku: p?.sku || '', hsCode: p?.hsCode || '', qty: 1, valueUsd: r2(value), origin, estimated: true }]
}

export function shipmentCustomsRecord(s) {
  if (!s) return null
  if (s.flow === 'stock') {
    const fm = s.firstMileRef ? db.get('intl_shipments', s.firstMileRef) : null
    return { kind: 'stock', firstMileRef: s.firstMileRef || null, firstMile: fm ? intlCustomsRecord(JSON.parse(JSON.stringify(fm))) : null }
  }
  const origin = s.origin || s.from?.country || 'US'
  const dest = s.to?.country || 'US'
  const international = origin !== dest || !!s.customs
  if (!international) return null
  const items = shipmentItems(s)
  const valueUsd = r2(items.reduce((a, i) => a + i.valueUsd, 0))
  const incoterm = (s.customs?.incoterm || s.incoterm) === 'DDU' ? 'DDU' : 'DDP'
  const estimate = estimateLandedCostMulti(items, { dest, origin, incoterm })
  const events = [...(s.events || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const label = events.find(e => e.code === 'label_created')?.at || s.createdAt
  const suffix = ', ' + origin
  // arrival in the destination: first scan outside the origin country (US origin: domestic city
  // names carry no country suffix, so the carrier 'arrived' scan is used)
  const arrIdx = origin === 'US'
    ? events.findIndex(e => e.code === 'arrived')
    : events.findIndex(e => e.loc && !String(e.loc).endsWith(suffix) && e.code !== 'label_created')
  const review = arrIdx >= 0 ? events[arrIdx].at : null
  const nextEv = arrIdx >= 0 ? events[arrIdx + 1] : null
  const assessed = review && (nextEv || ['delivered', 'out_for_delivery'].includes(s.status)) ? plusHours(review, 3) : null
  const released = assessed ? (nextEv ? (plusHours(review, 6) < nextEv.at ? plusHours(review, 6) : nextEv.at) : plusHours(review, 6)) : null
  const voided = s.status === 'voided'
  const times = voided ? {} : { declared: label, review, assessed, released }
  const steps = buildSteps(times)
  return {
    kind: 'direct',
    id: s.id,
    entryNo: entryNoFor(s.id),
    origin,
    dest,
    incoterm,
    form: valueUsd <= 400 ? 'cn22' : 'cn23',
    valueUsd,
    items,
    itemsEstimated: items.some(i => i.estimated),
    estimate,
    final: assessed ? finalOf(estimate, s.id) : null,
    status: voided ? 'not_declared' : statusOf(steps, false),
    steps,
    declaredAt: times.declared || null,
    releasedAt: times.released || null,
    trackingNo: s.trackingNo,
    createdAt: s.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Info Center lists
// ---------------------------------------------------------------------------
function allRecords() {
  const out = []
  for (const r of db.all('intl_shipments')) {
    const rec = intlCustomsRecord(JSON.parse(JSON.stringify(r)))
    if (rec) out.push({ ...rec, ref: r.id, routeName: 'intl-detail', routeParams: { id: r.id } })
  }
  for (const s of db.all('shipments')) {
    if (s.flow === 'stock') continue
    if ((s.origin || s.from?.country || 'US') === (s.to?.country || 'US') && !s.customs) continue
    const rec = shipmentCustomsRecord(JSON.parse(JSON.stringify(s)))
    if (rec && rec.kind === 'direct') out.push({ ...rec, ref: s.id, routeName: 'shipment-detail', routeParams: { id: s.id } })
  }
  return out
}

export function listRecentDeclarations({ limit = 8 } = {}) {
  return request('GET /v1/customs/declarations', () => allRecords()
    .filter(r => r.declaredAt)
    .sort((a, b) => String(b.declaredAt).localeCompare(String(a.declaredAt)))
    .slice(0, limit), { minMs: 250, maxMs: 550 })
}

export function customsMonthStats() {
  return request('GET /v1/customs/stats/month', () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const recs = allRecords()
    const released = recs.filter(r => r.releasedAt && r.releasedAt >= start && r.final)
    const declared = recs.filter(r => r.declaredAt && r.declaredAt >= start)
    const dutiesUsd = r2(released.reduce((s, r) => s + r.final.totalUsd, 0))
    const valueUsd = r2(released.reduce((s, r) => s + r.valueUsd, 0))
    return {
      dutiesUsd,
      count: released.length,
      declarations: declared.length,
      valueUsd,
      avgRate: valueUsd ? Math.round((dutiesUsd / valueUsd) * 1000) / 1000 : 0,
      pending: recs.filter(r => ['declared', 'under_review', 'docs_requested'].includes(r.status)).length,
    }
  }, { minMs: 250, maxMs: 550 })
}
