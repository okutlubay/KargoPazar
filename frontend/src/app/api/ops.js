/**
 * Operations hub API (spec 5.9) and batch job records (spec 5.7).
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * US_HUB_CODES = ['NJ01', 'LA01'], OPS_CHECKS = ['labelReadable', 'packagingOk', 'noProhibited']
 * listOpsHubs() -> [{ code, name, address, cutoff, capacityDaily, todayLoad, carrierPickups, pending, receivedToday }]
 * intakeQueue(hub) -> Shipment[]           label_created, not yet received at the hub, oldest first
 * nextSampleScan(hub) -> trackingNo|null    (sync) next parcel waiting for intake (demo "sample scan" button)
 * lookupParcel(hub, code) -> { shipment, declared: {weightLb, lengthIn, widthIn, heightIn, billableLb}, alreadyReceived }
 *   code = tracking number or shipment id. errors: SCAN_EMPTY, PARCEL_NOT_FOUND, WRONG_HUB {hub},
 *   PARCEL_VOIDED, ALREADY_HANDED_OVER
 * readScale(shipmentId) -> { weightLb, lengthIn, widthIn, heightIn, differs }
 *   deterministic: seed shipments carry `scaleReading`; others derive it from a hash of the id
 * previewAdjustment(shipmentId, measured) -> { declaredBillableLb, measuredBillableLb, deltaLb, originalPrice,
 *   newPrice, delta, charge: boolean, walletCharge: boolean }  (sync, used for the live "Fark" card)
 * acceptParcel(shipmentId, { measured, checks }) -> { shipment, adjustment|null, transaction|null, topup|null,
 *   diff: { lb, amount } | null, balance }
 *   adds 'hub_received' event; when the measured billable weight is higher an adjustment record is
 *   created, the difference is charged to the wallet and the customer is notified.
 *   errors: CHECKS_REQUIRED, INVALID_MEASUREMENT (details), ALREADY_RECEIVED, INSUFFICIENT_FUNDS
 * handoverGroups(hub) -> { pending: [{ carrier, carrierName, pickupTime, count, weightLb, shipments, manifestIds, unmanifested }],
 *   handedToday: [{ carrier, carrierName, count, handedOverAt, manifestIds }] }
 * markHandedOver(hub, carrier) -> { manifests: Manifest[], shipmentIds, created: Manifest|null }
 *   unmanifested received parcels get a new carrier manifest first; manifests become handed_over and every
 *   shipment gets a 'picked_up' event (status in_transit, order shipped).
 * dailySummary(hub) -> { accepted, pending, adjustments: {count, amount}, handedOver, awaitingHandover,
 *   pickups: [{ carrier, time, state: 'done'|'next'|'upcoming'|'late', count }], cutoff, capacity, load }
 * recentIntake(hub, { limit }) -> [{ shipmentId, trackingNo, carrier, at, adjustmentId, delta }]
 *
 * Batch jobs (collection 'batches'):
 *   listBatches() -> Batch[] newest first
 *   getBatch(id) -> Batch & { shipments }
 *   newBatchId() -> 'BAT-0025' (sync) reserves an id before the run so shipments can carry batchId
 *   recordBatch({ id?, orderIds, shipmentIds, failed, hubs, totalCost, defaultCost, savings, savingsPct, avgEtaDays, weight })
 *     -> Batch (id BAT-0025 ...)
 *   attachBatchManifests(id, manifestIds) -> Batch
 *   updateBatch(id, { orderIds, shipmentIds, failed, hubs, totalCost, defaultCost, savings, savingsPct, avgEtaDays })
 *     -> Batch   (after "retry failed" on the processing step)
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { chargeWallet } from './wallet.js'
import { buildPricingContext } from './rates.js'
import { nextFormattedId } from './integrations.js'
import { buildCarrierManifest, handOverManifestRecords, localYmd } from './manifests.js'
import { quoteService, billableWeight, round2 } from '@/shared/rateEngine.js'
import { moneyText } from '@/shared/currency.js'

export const US_HUB_CODES = ['NJ01', 'LA01']
export const OPS_CHECKS = ['labelReadable', 'packagingOk', 'noProhibited']

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()
const isToday = iso => iso && localYmd(iso) === localYmd(new Date().toISOString())
const hasEvent = (s, code) => (s.events ?? []).some(e => e.code === code)
const received = s => !!s.hubReceivedAt || hasEvent(s, 'hub_received')

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function hubRec(code) { return db.all('hubs').find(h => h.code === code) }
function carrierName(code) { return db.get('carriers', code)?.name ?? code }

// ---------------------------------------------------------------------------
// Hubs & intake
// ---------------------------------------------------------------------------

function pendingAt(hub) {
  return db.all('shipments')
    .filter(s => !s.test && s.hub === hub && s.status === 'label_created' && !received(s))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function listOpsHubs() {
  return request('GET /v1/ops/hubs', () => US_HUB_CODES.map(code => {
    const h = hubRec(code)
    const ships = db.all('shipments').filter(s => s.hub === code && !s.test)
    return {
      ...plain(h),
      pending: pendingAt(code).length,
      receivedToday: ships.filter(s => isToday(s.hubReceivedAt ?? s.events?.find(e => e.code === 'hub_received')?.at)).length,
    }
  }), { minMs: 250, maxMs: 500 })
}

export function intakeQueue(hub) {
  return request(`GET /v1/ops/${hub}/intake`, () => plain(pendingAt(hub)), { minMs: 250, maxMs: 500 })
}

export function nextSampleScan(hub, skip = []) {
  const s = pendingAt(hub).find(x => !skip.includes(x.id))
  return s ? s.trackingNo : null
}

function declaredOf(s) {
  const p = s.package ?? {}
  return { weightLb: p.weightLb, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, billableLb: s.billableLb ?? billableWeight(p).billableLb }
}

export function lookupParcel(hub, code) {
  return request(`GET /v1/ops/${hub}/scan/${encodeURIComponent(String(code ?? '').trim())}`, () => {
    const c = String(code ?? '').trim().toUpperCase().replace(/\s+/g, '')
    if (!c) throw new ApiError('SCAN_EMPTY', 'Scan a barcode first', 422)
    const s = db.all('shipments').find(x => !x.test && (String(x.trackingNo).toUpperCase() === c || x.id === c))
    if (!s) throw new ApiError('PARCEL_NOT_FOUND', 'No label with this barcode', 404, { code: c })
    if (s.hub !== hub) throw new ApiError('WRONG_HUB', 'Parcel belongs to another hub', 409, { hub: s.hub, shipmentId: s.id })
    if (s.status === 'voided') throw new ApiError('PARCEL_VOIDED', 'Label was voided', 409, { shipmentId: s.id })
    if (s.status !== 'label_created' || hasEvent(s, 'picked_up')) throw new ApiError('ALREADY_HANDED_OVER', 'Parcel already left the hub', 409, { shipmentId: s.id, status: s.status })
    return { shipment: plain(s), declared: declaredOf(s), alreadyReceived: received(s) }
  }, { minMs: 250, maxMs: 450 })
}

export function readScale(shipmentId) {
  return request(`GET /v1/ops/scale/${shipmentId}`, () => {
    const s = db.get('shipments', shipmentId)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    if (s.scaleReading) return plain(s.scaleReading)
    // Deterministic reading for labels created in the demo: ~1 in 5 parcels weighs clearly more.
    const p = s.package ?? {}
    const h = hashStr(s.id)
    const differs = h % 5 === 0
    const jitter = ((h >> 3) % 7 - 3) / 10
    const weightLb = differs ? round2(Math.max((p.weightLb || 1) + 2 + ((h >> 5) % 3), 0.1)) : round2(Math.max((p.weightLb || 1) + jitter * 0.3, 0.1))
    return { weightLb: Math.round(weightLb * 10) / 10, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, differs }
  }, { minMs: 700, maxMs: 1100 })
}

function priceFor(s, pkg, ctx) {
  const account = String(s.account ?? '').startsWith('own:') ? ctx.carrierAccounts.find(a => `own:${a.id}` === s.account) : null
  const q = quoteService({
    carriers: ctx.carriers, carrier: s.carrier, service: s.service, hub: s.hub, toZip: s.to?.zip, toState: s.to?.state,
    zone: s.zone ?? undefined, pkg, residential: s.to?.residential !== false, declaredValue: s.declaredValue || 0,
    insured: (s.insurance || 0) > 0, plan: ctx.plan, rateCards: ctx.rateCards, customerId: ctx.customerId,
    carrierAccount: account ?? null, now: ctx.now,
  })
  return q ? q.sellPrice : null
}

function computeDiff(s, measured, ctx = buildPricingContext()) {
  const declared = declaredOf(s)
  const mPkg = { lengthIn: +measured.lengthIn, widthIn: +measured.widthIn, heightIn: +measured.heightIn, weightLb: +measured.weightLb }
  const measuredBillableLb = billableWeight(mPkg).billableLb
  const declaredBillableLb = declared.billableLb
  const deltaLb = measuredBillableLb - declaredBillableLb
  const own = String(s.account ?? '').startsWith('own:')
  let delta = 0
  if (deltaLb > 0) {
    const before = priceFor(s, { lengthIn: declared.lengthIn, widthIn: declared.widthIn, heightIn: declared.heightIn, weightLb: declared.weightLb }, ctx)
    const after = priceFor(s, mPkg, ctx)
    if (before != null && after != null) delta = round2(Math.max(0, after - before))
  }
  const originalPrice = round2(s.price ?? 0)
  return {
    declaredBillableLb, measuredBillableLb, deltaLb, originalPrice,
    newPrice: round2(originalPrice + delta), delta,
    charge: deltaLb > 0 && delta > 0, walletCharge: deltaLb > 0 && delta > 0 && !own, ownAccount: own,
  }
}

export function previewAdjustment(shipmentId, measured) {
  const s = db.get('shipments', shipmentId)
  if (!s || !measured) return null
  const ok = ['weightLb', 'lengthIn', 'widthIn', 'heightIn'].every(k => Number(measured[k]) > 0)
  if (!ok) return null
  return computeDiff(s, measured)
}

function validateMeasured(m = {}) {
  const errors = {}
  for (const k of ['weightLb', 'lengthIn', 'widthIn', 'heightIn']) {
    const v = Number(m[k])
    if (!(v > 0)) errors[k] = 'required'
    else if (k === 'weightLb' && v > 150) errors[k] = 'max'
    else if (k !== 'weightLb' && v > 108) errors[k] = 'max'
  }
  return errors
}

export function acceptParcel(shipmentId, { measured, checks = {} } = {}) {
  return request(`POST /v1/ops/parcels/${shipmentId}/accept`, async () => {
    const s = db.get('shipments', shipmentId)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    if (received(s)) throw new ApiError('ALREADY_RECEIVED', 'Parcel already accepted', 409)
    if (s.status !== 'label_created') throw new ApiError('ALREADY_HANDED_OVER', 'Parcel already left the hub', 409)
    const missing = OPS_CHECKS.filter(k => !checks[k])
    if (missing.length) throw new ApiError('CHECKS_REQUIRED', 'Complete the intake checks', 422, Object.fromEntries(missing.map(k => [k, 'required'])))
    const errors = validateMeasured(measured)
    if (Object.keys(errors).length) throw new ApiError('INVALID_MEASUREMENT', 'Invalid measurement', 422, errors)
    const diff = computeDiff(s, measured)
    const at = nowIso()
    const loc = [s.from?.city, s.from?.state].filter(Boolean).join(', ')
    const mPkg = { lengthIn: +measured.lengthIn, widthIn: +measured.widthIn, heightIn: +measured.heightIn, weightLb: +measured.weightLb }

    const res = await db.transaction(() => {
      let adjustment = null
      let wallet = { transaction: null, topup: null }
      if (diff.charge) {
        const id = db.nextId('ADJ')
        const n = Number(id.split('-').pop())
        const deadline = new Date(Date.now() + 30 * 864e5).toISOString()
        adjustment = db.insert('adjustments', {
          id,
          shipmentId: s.id,
          orderId: s.orderId ?? null,
          carrier: s.carrier,
          service: s.service,
          measuredAt: at,
          measuredAtHub: s.hub,
          declared: { weightLb: s.package?.weightLb, dims: { lengthIn: s.package?.lengthIn, widthIn: s.package?.widthIn, heightIn: s.package?.heightIn }, billableLb: diff.declaredBillableLb },
          measured: { weightLb: mPkg.weightLb, dims: { lengthIn: mPkg.lengthIn, widthIn: mPkg.widthIn, heightIn: mPkg.heightIn }, billableLb: diff.measuredBillableLb },
          originalPrice: diff.originalPrice,
          newPrice: diff.newPrice,
          delta: diff.delta,
          status: 'charged',
          disputeDeadline: deadline,
          photoPlaceholder: `scale-${(n % 4) + 1}`,
          billedTo: diff.walletCharge ? 'wallet' : 'carrier_account',
          createdBy: db.doc('user')?.name ?? null,
        })
        if (diff.walletCharge) {
          wallet = chargeWallet({
            amount: diff.delta,
            type: 'adjustment',
            description: { tr: `Ağırlık düzeltmesi · ${s.id} (+${diff.deltaLb} lb)`, en: `Weight adjustment · ${s.id} (+${diff.deltaLb} lb)` },
            shipmentId: s.id,
            meta: { adjustmentId: id },
          })
          db.update('adjustments', id, { walletTxnId: wallet.transaction?.id ?? null })
        }
      }
      db.update('shipments', s.id, {
        hubReceivedAt: at,
        measured: { ...mPkg, billableLb: diff.measuredBillableLb, at, hub: s.hub },
        intakeChecks: { ...checks },
        reweighAdjustmentId: adjustment?.id ?? s.reweighAdjustmentId ?? null,
        events: [...(s.events ?? []), { at, code: 'hub_received', loc }],
      })
      return { adjustment: plain(adjustment), transaction: wallet.transaction, topup: wallet.topup }
    })

    if (res.adjustment) {
      const amt = moneyText(res.adjustment.delta)
      notify({
        type: 'warning',
        title: { tr: `Ağırlık düzeltmesi: ${s.id} (+${amt.tr})`, en: `Weight adjustment: ${s.id} (+${amt.en})` },
        body: {
          tr: `${s.hub} ölçümü: ${diff.measuredBillableLb} lb (beyan ${diff.declaredBillableLb} lb). ${diff.walletCharge ? 'Fark cüzdanınızdan tahsil edildi.' : 'Fark taşıyıcı hesabınıza yansıtılır.'} İtiraz için 30 gününüz var.`,
          en: `${s.hub} measurement: ${diff.measuredBillableLb} lb (declared ${diff.declaredBillableLb} lb). ${diff.walletCharge ? 'The difference was charged to your wallet.' : 'The difference is billed to your carrier account.'} You have 30 days to dispute.`,
        },
        link: '/billing?tab=adjustments',
      })
      if (res.topup) {
        notify({
          type: 'info',
          title: { tr: `Otomatik yükleme: ${moneyText(res.topup.amount).tr} kayıtlı karttan çekildi`, en: `Auto top-up: ${moneyText(res.topup.amount).en} charged to your saved card` },
          link: '/billing',
        })
      }
      audit('ops.adjustment', res.adjustment.id, `${s.id} +${diff.deltaLb} lb +${moneyText(res.adjustment.delta).en}`)
    }
    audit('ops.accept', s.id, `${s.hub} ${mPkg.weightLb} lb`)
    return {
      shipment: plain(db.get('shipments', s.id)),
      ...res,
      diff: res.adjustment ? { lb: diff.deltaLb, amount: res.adjustment.delta, walletCharge: diff.walletCharge } : null,
      balance: db.doc('wallet').balance,
    }
  }, { minMs: 500, maxMs: 900 })
}

export function recentIntake(hub, { limit = 8 } = {}) {
  return request(`GET /v1/ops/${hub}/intake/recent`, () => db.all('shipments')
    .filter(s => s.hub === hub && s.hubReceivedAt)
    .sort((a, b) => b.hubReceivedAt.localeCompare(a.hubReceivedAt))
    .slice(0, limit)
    .map(s => {
      const adj = s.reweighAdjustmentId ? db.get('adjustments', s.reweighAdjustmentId) : null
      return { shipmentId: s.id, trackingNo: s.trackingNo, carrier: s.carrier, service: s.service, at: s.hubReceivedAt, weightLb: s.measured?.weightLb ?? s.package?.weightLb, adjustmentId: adj?.id ?? null, delta: adj?.delta ?? null, status: s.status }
    }), { minMs: 200, maxMs: 400 })
}

// ---------------------------------------------------------------------------
// Carrier handover
// ---------------------------------------------------------------------------

function awaitingHandover(hub) {
  return db.all('shipments').filter(s => !s.test && s.hub === hub && s.status === 'label_created' && received(s) && !hasEvent(s, 'picked_up'))
}

function groupsFor(hub) {
  const h = hubRec(hub)
  const groups = {}
  for (const s of awaitingHandover(hub)) (groups[s.carrier] ??= []).push(s)
  const pending = Object.entries(groups).map(([carrier, ships]) => ({
    carrier,
    carrierName: carrierName(carrier),
    pickupTime: h?.carrierPickups?.find(p => p.carrier === carrier)?.time ?? null,
    count: ships.length,
    weightLb: round2(ships.reduce((sum, s) => sum + (Number(s.measured?.weightLb ?? s.package?.weightLb) || 0), 0)),
    manifestIds: [...new Set(ships.map(s => s.manifestId).filter(Boolean))],
    unmanifested: ships.filter(s => !s.manifestId).length,
    shipments: plain(ships.sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
  })).sort((a, b) => String(a.pickupTime).localeCompare(String(b.pickupTime)))
  const today = db.all('manifests').filter(m => m.type === 'carrier' && m.hub === hub && m.status === 'handed_over' && isToday(m.handedOverAt))
  const handed = {}
  for (const m of today) {
    const g = (handed[m.carrier] ??= { carrier: m.carrier, carrierName: carrierName(m.carrier), count: 0, handedOverAt: m.handedOverAt, manifestIds: [] })
    g.count += m.totals?.parcels ?? (m.shipmentIds ?? []).length
    g.manifestIds.push(m.id)
    if (m.handedOverAt > g.handedOverAt) g.handedOverAt = m.handedOverAt
  }
  return { pending, handedToday: Object.values(handed) }
}

export function handoverGroups(hub) {
  return request(`GET /v1/ops/${hub}/handover`, () => groupsFor(hub), { minMs: 250, maxMs: 500 })
}

export function markHandedOver(hub, carrier) {
  return request(`POST /v1/ops/${hub}/handover/${carrier}`, async () => {
    const ships = awaitingHandover(hub).filter(s => s.carrier === carrier)
    if (!ships.length) throw new ApiError('NOTHING_TO_HAND_OVER', 'No parcels waiting for this carrier', 409)
    const out = await db.transaction(() => {
      const unmanifested = ships.filter(s => !s.manifestId).map(s => s.id)
      const created = unmanifested.length ? buildCarrierManifest({ hub, carrier, shipmentIds: unmanifested }) : null
      const manifestIds = [...new Set(ships.map(s => db.get('shipments', s.id).manifestId).filter(Boolean))]
      // Parcels on those manifests that were never received stay behind: move them to a fresh manifest.
      for (const mid of manifestIds) {
        const m = db.get('manifests', mid)
        const left = (m.shipmentIds ?? []).filter(id => !ships.some(s => s.id === id))
        if (left.length) {
          const keep = (m.shipmentIds ?? []).filter(id => ships.some(s => s.id === id))
          const kept = keep.map(id => db.get('shipments', id))
          db.update('manifests', mid, { shipmentIds: keep, totals: { parcels: kept.length, weightLb: round2(kept.reduce((a, x) => a + (Number(x.package?.weightLb) || 0), 0)) } })
          for (const id of left) db.update('shipments', id, { manifestId: null })
        }
      }
      const shipmentIds = handOverManifestRecords(manifestIds)
      return { created: plain(created), manifestIds, shipmentIds }
    })
    const manifests = out.manifestIds.map(id => plain(db.get('manifests', id)))
    notify({
      type: 'success',
      title: { tr: `${hub}: ${out.shipmentIds.length} paket ${carrierName(carrier)}'a teslim edildi`, en: `${hub}: ${out.shipmentIds.length} parcels handed to ${carrierName(carrier)}` },
      body: { tr: `Manifest ${out.manifestIds.join(', ')} · "Taşıyıcı teslim aldı" olayı eklendi.`, en: `Manifest ${out.manifestIds.join(', ')} · "Picked up" scan added.` },
      link: out.manifestIds.length === 1 ? `/manifests/${out.manifestIds[0]}` : '/manifests',
    })
    audit('ops.handover', out.manifestIds.join(', '), `${hub} ${carrier} ${out.shipmentIds.length}`)
    return { manifests, shipmentIds: out.shipmentIds, created: out.created }
  }, { minMs: 600, maxMs: 1000 })
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

export function dailySummary(hub) {
  return request(`GET /v1/ops/${hub}/summary`, () => {
    const h = hubRec(hub)
    const ships = db.all('shipments').filter(s => s.hub === hub && !s.test)
    const accepted = ships.filter(s => isToday(s.hubReceivedAt)).length
    const pending = pendingAt(hub).length
    const adj = db.all('adjustments').filter(a => a.measuredAtHub === hub && isToday(a.measuredAt))
    const groups = groupsFor(hub)
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    const pickups = (h?.carrierPickups ?? []).map(p => {
      const [hh, mm] = String(p.time).split(':').map(Number)
      const done = groups.handedToday.find(g => g.carrier === p.carrier)
      const waiting = groups.pending.find(g => g.carrier === p.carrier)
      let state = 'upcoming'
      if (done && !waiting) state = 'done'
      else if (hh * 60 + mm < minutes) state = waiting ? 'late' : 'done'
      return { carrier: p.carrier, carrierName: carrierName(p.carrier), time: p.time, state, count: waiting?.count ?? 0, handed: done?.count ?? 0 }
    }).sort((a, b) => a.time.localeCompare(b.time))
    const next = pickups.find(p => p.state === 'upcoming')
    if (next) next.state = 'next'
    return {
      hub,
      accepted,
      pending,
      adjustments: { count: adj.length, amount: round2(adj.reduce((s, a) => s + (a.delta || 0), 0)) },
      handedOver: groups.handedToday.reduce((s, g) => s + g.count, 0),
      awaitingHandover: groups.pending.reduce((s, g) => s + g.count, 0),
      pickups,
      cutoff: h?.cutoff ?? '16:00',
      capacity: h?.capacityDaily ?? null,
      load: h?.todayLoad ?? null,
    }
  }, { minMs: 250, maxMs: 500 })
}

// ---------------------------------------------------------------------------
// Batch jobs
// ---------------------------------------------------------------------------

export function listBatches() {
  return request('GET /v1/batches', () => [...db.all('batches')].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')), { minMs: 250, maxMs: 500 })
}

export function getBatch(id) {
  return request(`GET /v1/batches/${id}`, () => {
    const b = db.get('batches', id)
    if (!b) throw new ApiError('NOT_FOUND', 'Batch not found', 404)
    const byId = new Map(db.all('shipments').map(s => [s.id, s]))
    return { ...plain(b), shipments: (b.shipmentIds ?? []).map(sid => plain(byId.get(sid))).filter(Boolean) }
  }, { minMs: 200, maxMs: 450 })
}

/** Reserve the next batch id (sync) so shipments created by a batch run can carry it as batchId. */
export function newBatchId() {
  return nextFormattedId('BAT')
}

export function recordBatch(data = {}) {
  return request('POST /v1/batches', () => {
    const id = data.id && !db.get('batches', data.id) ? data.id : nextFormattedId('BAT')
    const rec = {
      id,
      at: nowIso(),
      createdBy: db.doc('user')?.name ?? null,
      orderCount: data.orderIds?.length ?? data.orderCount ?? 0,
      labelCount: data.shipmentIds?.length ?? 0,
      failed: data.failed ?? 0,
      orderIds: data.orderIds ?? [],
      shipmentIds: data.shipmentIds ?? [],
      hubs: data.hubs ?? {},
      totalCost: round2(data.totalCost ?? 0),
      defaultCost: round2(data.defaultCost ?? 0),
      savings: round2(data.savings ?? 0),
      savingsPct: data.savingsPct ?? 0,
      avgEtaDays: data.avgEtaDays ?? null,
      weight: data.weight ?? null,
      manifestIds: [],
    }
    db.insert('batches', rec)
    notify({
      type: 'success',
      title: { tr: `Toplu işlem ${id}: ${rec.labelCount} etiket oluşturuldu`, en: `Batch ${id}: ${rec.labelCount} labels created` },
      body: { tr: `AI optimizasyonu ile tahmini tasarruf ${moneyText(rec.savings).tr}.`, en: `Estimated AI optimization savings ${moneyText(rec.savings).en}.` },
      link: '/batch?tab=history',
    })
    audit('batch.run', id, `${rec.labelCount} labels, ${rec.failed} failed`)
    return rec
  }, { minMs: 200, maxMs: 400 })
}

export function attachBatchManifests(id, manifestIds = []) {
  return request(`PATCH /v1/batches/${id}`, () => {
    const b = db.get('batches', id)
    if (!b) throw new ApiError('NOT_FOUND', 'Batch not found', 404)
    return db.update('batches', id, { manifestIds: [...new Set([...(b.manifestIds ?? []), ...manifestIds])] })
  }, { minMs: 150, maxMs: 300 })
}

export function updateBatch(id, data = {}) {
  return request(`PATCH /v1/batches/${id}`, () => {
    const b = db.get('batches', id)
    if (!b) throw new ApiError('NOT_FOUND', 'Batch not found', 404)
    const patch = {}
    if (data.orderIds) { patch.orderIds = [...new Set([...(b.orderIds ?? []), ...data.orderIds])]; patch.orderCount = patch.orderIds.length }
    if (data.shipmentIds) { patch.shipmentIds = [...new Set([...(b.shipmentIds ?? []), ...data.shipmentIds])]; patch.labelCount = patch.shipmentIds.length }
    for (const k of ['failed', 'hubs', 'avgEtaDays', 'savingsPct']) if (data[k] !== undefined) patch[k] = data[k]
    for (const k of ['totalCost', 'defaultCost', 'savings']) if (data[k] !== undefined) patch[k] = round2(data[k])
    return db.update('batches', id, patch)
  }, { minMs: 150, maxMs: 300 })
}
