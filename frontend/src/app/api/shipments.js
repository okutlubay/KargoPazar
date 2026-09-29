/**
 * Shipments API (spec 3.1 consistency chain, 3.7, 5.5, 5.6, 5.13, 7.5 test mode).
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * createShipment(draft) -> { shipment, order|null, transaction|null, topup|null, balance, test, rules: [{id,name}] }
 *   POST /v1/shipments. draft = {
 *     orderId?, hub?, to, pkg, declaredValue?, insured?, signature?, reference?, items?, customs?,
 *     quoteKey? ('UPS-GROUND' | 'UPS-GROUND:own'; default = AI pick), weight? (optimizer 0..1),
 *     ignoreHubRule?, allowHeld? (label an on_hold order), draftId? (removed on success),
 *     test? | apiKey? ('kp_test_...' => test mode: no wallet charge, order untouched, shipment.test = true),
 *     source? ('panel'|'api'|'batch'), batchId?
 *   }
 *   Consistency chain (one db.transaction; all or nothing):
 *     (1) order -> status 'labeled', shipmentId, timeline event
 *     (2) shipment row, carrier-format tracking number, 'label_created' event
 *     (3) wallet charge + transaction; auto top-up (saved card, 'topup' txn, notification) when the
 *         balance would fall below the threshold; INSUFFICIENT_FUNDS when it cannot be covered
 *     (4) Overview KPIs derive from the shipments collection (hub todayLoad + rule trigger counters bumped)
 *     (5) marketplace orders: tracking write-back sync log 2 s later when the store setting is on
 *     (6) notification (+ webhook delivery for shipment.created subscribers, audit, model event)
 *   errors: VALIDATION (details), NOT_FOUND, ORDER_ALREADY_LABELED, ORDER_ON_HOLD, ORDER_CANCELLED,
 *           QUOTE_UNAVAILABLE, RULE_HOLD, INSUFFICIENT_FUNDS (details {balance, required})
 *
 * voidLabel(id, { reason? }) -> { shipment, order|null, refund: { amount, status: 'completed'|'pending', transaction } | null }
 *   label_created only (VOID_NOT_ALLOWED). USPS refunds start 'pending' and complete after 10 s.
 * reprintLabel(id) -> Shipment                          (printCount, lastPrintedAt)
 * quoteReturn(id) -> RateResult                         (rate shop for the reverse direction)
 * createReturnLabel(id, { quoteKey? }) -> { shipment, transaction, topup }   (isReturn, returnOf)
 * createDummyLabel({ shipmentId } | { intlId }) -> { dummyLabel, target, existing }
 *   dummyLabel = { ref: 'KPZ-TMP-000123', createdAt, status: 'active'|'replaced', watermark, replacedAt?, finalTrackingNo? }
 * markDummyReplaced({ shipmentId } | { intlId }, { finalShipmentId?, finalTrackingNo? }) -> { dummyLabel }
 *
 * listShipments(params?) -> Shipment[] newest first
 *   params: { status?, carrier?, service?, hub?, account?: 'platform'|'own', aiPick?: 'yes'|'no',
 *             hasAdjustment?: boolean, from?, to?, q?, includeTest? (default true) }
 * shipmentCounts() -> { all, label_created, in_transit, out_for_delivery, delivered, exception, voided, returned, drafts }  (sync)
 * getShipment(id) -> Shipment & { order, adjustment, returnShipment, returnOf, breakdown: [{code, amount}], route: [string] }
 *   breakdown codes: base, fuel, residential, markup, dynamic, signature, insurance, own_account_fee, carrier_charge
 * trackLookup(query) -> [{ query, found, result: PublicTracking|null }]     (public, no session; comma/space separated)
 *   PublicTracking = { trackingNo, carrier, carrierName, service, serviceName, status, step 0..4, eta, deliveredAt,
 *                      origin: {city,state}, destination: {city,state}, events: [{at, code, loc}], orderRef }
 * trackingProgressStep(status, events) -> 0..4   (Label, At hub, In transit, Out for delivery, Delivered)
 * advanceTracking(id) -> Shipment                 demo helper: appends the next realistic scan event
 *
 * Drafts (collection 'drafts'):
 *   listDrafts() -> Draft[], getDraft(id), saveDraft({ id?, orderId?, step?, data, summary? }) -> Draft,
 *   deleteDraft(id) -> { removed }
 *   Draft = { id: 'DRF-...', createdAt, updatedAt, orderId, step, data, summary: { toName, city, state, carrier, service, total } }
 *
 * generateTrackingNo(carrierCode, serviceCode, { own, seed }) -> string (carrier formats: FedEx 12 digits,
 *   UPS 1Z+16, USPS 22 digits, DHL eCommerce GM+18, OnTrac D+14, LSO L+10)
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify, modelEvent } from '../store/events.js'
import { recordTriggers } from '../store/rules.js'
import { rateShopNow, buildPricingContext, findQuote } from './rates.js'
import { chargeWallet, creditWallet, settlePending } from './wallet.js'
import { scheduleTrackingWriteBack, nextFormattedId } from './integrations.js'
import { mulberry32, hashSeed } from '../ai/prng.js'
import { round2 } from '@/shared/rateEngine.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()
export const DUMMY_WATERMARK = 'TEMPORARY LABEL · NOT FOR CARRIER USE'

const REGION_OF = {
  Northeast: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC'],
  Southeast: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN', 'KY', 'AR', 'LA'],
  Midwest: ['OH', 'IN', 'IL', 'MI', 'WI', 'MN', 'IA', 'MO', 'KS', 'NE', 'SD', 'ND'],
  Southwest: ['TX', 'OK', 'NM', 'AZ'],
  West: ['CA', 'NV', 'UT', 'CO', 'WY', 'ID', 'MT', 'OR', 'WA', 'AK', 'HI'],
}
const ROUTES = {
  NJ01: { Northeast: ['Edison, NJ'], Southeast: ['Edison, NJ', 'Richmond, VA', 'Atlanta, GA'], Midwest: ['Harrisburg, PA', 'Columbus, OH', 'Chicago, IL'], Southwest: ['Harrisburg, PA', 'Memphis, TN', 'Dallas, TX'], West: ['Harrisburg, PA', 'Kansas City, MO', 'Denver, CO', 'Salt Lake City, UT'] },
  LA01: { West: ['Ontario, CA'], Southwest: ['Ontario, CA', 'Phoenix, AZ', 'Dallas, TX'], Midwest: ['Ontario, CA', 'Denver, CO', 'Kansas City, MO', 'Chicago, IL'], Southeast: ['Ontario, CA', 'Dallas, TX', 'Atlanta, GA'], Northeast: ['Ontario, CA', 'Kansas City, MO', 'Columbus, OH', 'Edison, NJ'] },
}
function regionOf(state) {
  for (const [r, list] of Object.entries(REGION_OF)) if (list.includes(state)) return r
  return 'Northeast'
}

const EVENT_STATUS = { label_created: 'label_created', hub_received: 'in_transit', picked_up: 'in_transit', departed: 'in_transit', in_transit: 'in_transit', arrived: 'in_transit', out_for_delivery: 'out_for_delivery', delivered: 'delivered', exception: 'exception', returned: 'returned', voided: 'voided' }

// ---------------------------------------------------------------------------
// Tracking numbers
// ---------------------------------------------------------------------------

function digitsFrom(rng, n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(rng() * 10); return s }

export function generateTrackingNo(carrier, service, { own = false, accountNumber = '', seed = Date.now() } = {}) {
  const rng = mulberry32(hashSeed(`${carrier}|${service}|${seed}|${Math.random()}`))
  switch (carrier) {
    case 'FDX': return '7' + digitsFrom(rng, 11)
    case 'UPS': {
      const sc = { GROUND: '03', '3DS': '12', '2DA': '02', NDAS: '13' }[service] || '03'
      const acct = own ? (String(accountNumber).replace(/[^A-Z0-9]/gi, '').toUpperCase() + 'X00000').slice(0, 6) : 'A7K294'
      return '1Z' + acct + sc + digitsFrom(rng, 8)
    }
    case 'USPS': return ({ GA: '9400', PM: '9405', PME: '9470' }[service] || '9400') + digitsFrom(rng, 18)
    case 'DHLE': return 'GM' + digitsFrom(rng, 18)
    case 'ONT': return 'D' + digitsFrom(rng, 14)
    case 'LSO': return 'L' + digitsFrom(rng, 10)
    case 'DHLX': return digitsFrom(rng, 10)
    case 'EVRI': return 'H' + digitsFrom(rng, 15)
    default: return String(carrier).slice(0, 3).toUpperCase() + digitsFrom(rng, 12)
  }
}

function uniqueTrackingNo(carrier, service, opts) {
  const existing = new Set(db.all('shipments').map(s => s.trackingNo))
  for (let i = 0; i < 20; i++) {
    const t = generateTrackingNo(carrier, service, { ...opts, seed: `${opts.seed}-${i}` })
    if (!existing.has(t)) return t
  }
  return generateTrackingNo(carrier, service, { ...opts, seed: Date.now() })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hubAddress(code) {
  const hub = db.all('hubs').find(h => h.code === code)
  const user = db.doc('user')
  return {
    name: user?.company?.senderAddress?.name ?? user?.company?.name ?? 'KargoPazar',
    company: user?.company?.name ?? '',
    ...(hub?.address ?? {}),
  }
}

function locOf(addr) { return addr?.city ? `${addr.city}, ${addr.state}` : '' }

function aiReason(code, q, savings) {
  const pct = q?.onTimePct != null ? Math.round(q.onTimePct * 100) : null
  const map = {
    lowest_cost: { tr: `Bu hat için en düşük maliyetli uygun servis${pct ? `, zamanında teslim oranı %${pct}` : ''}`, en: `Lowest cost eligible service on this lane${pct ? `, ${pct}% on-time` : ''}` },
    speed: { tr: `Teslim hedefi için en uygun fiyatlı hızlı servis (${q?.etaDays ?? '-'} gün)`, en: `Best priced fast service for the delivery target (${q?.etaDays ?? '-'} days)` },
    balanced: { tr: 'Maliyet, hız ve güvenilirlik dengesinde en yüksek skor', en: 'Highest score on the cost, speed and reliability balance' },
    own_account: { tr: `Kendi ${q?.carrierName ?? ''} hesabınızın anlaşmalı tarifesi platform tarifesinden daha uygun`, en: `Your own ${q?.carrierName ?? ''} account rate beats the platform rate` },
    rule_forced: { tr: 'Gönderi kuralı bu servisi zorunlu kılıyor', en: 'A shipping rule requires this service' },
    rule_strategy: { tr: 'Gönderi kuralının seçim stratejisine göre belirlendi', en: 'Chosen by the shipping rule selection strategy' },
  }
  const r = map[code] ?? map.balanced
  if (savings > 0) return { tr: `${r.tr}. Varsayılana göre $${savings.toFixed(2)} tasarruf.`, en: `${r.en}. Saves $${savings.toFixed(2)} vs default.` }
  return r
}

function svcLabel(q) {
  return String(q.serviceName ?? '').startsWith(q.carrierName) ? q.serviceName : `${q.carrierName} ${q.serviceName}`
}

function labelDescription(q, { isReturn = false } = {}) {
  const base = svcLabel(q)
  if (q.source === 'own') return { tr: `${isReturn ? 'İade etiketi' : 'Etiket'} · ${base} (kendi hesap, platform ücreti)`, en: `${isReturn ? 'Return label' : 'Label'} · ${base} (own account, platform fee)` }
  return { tr: `${isReturn ? 'İade etiketi' : 'Etiket'} · ${base}`, en: `${isReturn ? 'Return label' : 'Label'} · ${base}` }
}

function emitWebhook(event, data) {
  const wh = db.doc('webhooks')
  if (!wh?.endpoints) return
  const subs = wh.endpoints.filter(e => e.status === 'active' && (e.events ?? []).includes(event))
  if (!subs.length) return
  const at = nowIso()
  const deliveries = subs.map(ep => ({
    id: nextFormattedId('DLV'), endpointId: ep.id, event, at, status: 200, attempts: 1,
    durationMs: 60 + Math.round(Math.random() * 300), result: 'delivered',
    payload: { id: 'evt_' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0'), type: event, data },
  }))
  db.patchDoc('webhooks', d => ({
    deliveries: [...deliveries, ...(d.deliveries ?? [])].slice(0, 300),
    endpoints: d.endpoints.map(e => (subs.some(s => s.id === e.id) ? { ...e, lastDeliveryAt: at } : e)),
  }))
}

function validateDraft(d) {
  const e = {}
  const to = d.to ?? {}
  if (!to.name) e['to.name'] = 'required'
  if (!to.line1) e['to.line1'] = 'required'
  if (!to.city) e['to.city'] = 'required'
  if ((to.country || 'US') === 'US') {
    if (!to.state) e['to.state'] = 'required'
    if (!/^\d{5}(-\d{4})?$/.test(String(to.zip ?? '').trim())) e['to.zip'] = to.zip ? 'zip' : 'required'
  } else if (!to.zip) e['to.zip'] = 'required'
  const p = d.pkg ?? {}
  for (const k of ['lengthIn', 'widthIn', 'heightIn', 'weightLb']) if (!(Number(p[k]) > 0)) e[`pkg.${k}`] = 'number'
  if (d.declaredValue != null && !(Number(d.declaredValue) >= 0)) e.declaredValue = 'number'
  if (Object.keys(e).length) throw new ApiError('VALIDATION', 'Invalid shipment', 422, e)
}

function orderEvent(o, code, detail) {
  return [...(o.events ?? []), { at: nowIso(), code, ...(detail ? { detail } : {}) }]
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createShipment(draft) {
  const isTest = !!draft.test || String(draft.apiKey ?? '').startsWith('kp_test_')
  return request('POST /v1/shipments', async () => {
    settlePending()
    const order = draft.orderId ? db.get('orders', draft.orderId) : null
    if (draft.orderId && !order) throw new ApiError('NOT_FOUND', 'Order not found', 404)
    if (order && !isTest) {
      if (order.status === 'cancelled') throw new ApiError('ORDER_CANCELLED', 'Order is cancelled', 409)
      if (order.shipmentId && db.get('shipments', order.shipmentId)?.status !== 'voided') throw new ApiError('ORDER_ALREADY_LABELED', 'Order already has a label', 409, { shipmentId: order.shipmentId })
      if (order.status === 'on_hold' && !draft.allowHeld) throw new ApiError('ORDER_ON_HOLD', 'Order is on hold', 409)
    }
    const d = {
      ...plain(draft),
      to: plain(draft.to ?? order?.shipTo),
      pkg: plain(draft.pkg ?? order?.package),
    }
    validateDraft(d)
    const declaredValue = d.declaredValue ?? (order ? (order.items ?? []).reduce((s, i) => s + i.unitPrice * i.qty, 0) : 0)

    const ctx = buildPricingContext()
    const rates = await rateShopNow({
      hub: d.hub, to: d.to, pkg: d.pkg, declaredValue, insured: d.insured, signature: d.signature,
      orderContext: { order: order ? plain(order) : null, items: d.items }, weight: d.weight,
      addressCheck: order?.addressCheck ?? null, ignoreHubRule: d.ignoreHubRule,
    }, ctx)
    if (rates.hold && !draft.allowHeld) throw new ApiError('RULE_HOLD', 'A shipping rule holds this shipment', 409, { rule: rates.hold.ruleName })
    const key = d.quoteKey ?? rates.aiPickKey
    const q = findQuote(rates, key)
    if (!q) throw new ApiError('QUOTE_UNAVAILABLE', 'Selected service is not available', 409, { quoteKey: key })
    const ai = findQuote(rates, rates.aiPickKey)
    const aiChosen = key === rates.aiPickKey
    const savingsVsDefault = rates.defaultQuote ? Math.max(0, round2(rates.defaultQuote.total - q.total)) : 0
    const account = q.source === 'own' ? ctx.carrierAccounts.find(a => a.id === q.accountId) : null
    const channel = order?.channel ?? (draft.source === 'api' ? 'api' : 'manual')

    const res = await db.transaction(() => {
      const id = db.nextId('SHP')
      const at = nowIso()
      const from = hubAddress(q.hub)
      const trackingNo = uniqueTrackingNo(q.carrierCode, q.serviceCode, { own: !!account, accountNumber: account?.accountNumber, seed: id })
      const shipment = {
        id,
        orderId: order?.id ?? null,
        channel,
        reference: d.reference ?? order?.channelOrderNo ?? null,
        createdAt: at,
        hub: q.hub,
        carrier: q.carrierCode,
        service: q.serviceCode,
        account: account ? `own:${account.id}` : 'platform',
        trackingNo,
        from,
        to: { ...d.to, country: (d.to.country || 'US').toUpperCase(), residential: d.to.residential !== false },
        package: { lengthIn: +d.pkg.lengthIn, widthIn: +d.pkg.widthIn, heightIn: +d.pkg.heightIn, weightLb: +d.pkg.weightLb },
        declaredValue: round2(declaredValue),
        billableLb: q.billableLb,
        dimWeightLb: q.dimWeightLb,
        zone: q.zone,
        cost: q.cost,
        price: q.sellPrice,
        insurance: q.insurance,
        total: q.total,
        walletCharge: isTest ? 0 : q.walletCharge,
        carrierCharge: q.carrierCharge || 0,
        pricing: {
          base: q.base, fuel: q.fuel, residential: q.residential, markupPct: q.markupPct, source: q.source,
          cardId: q.cardId ?? null, overrideId: q.overrideId ?? null, platformFee: q.platformFee || 0,
          signatureFee: q.signatureFee || 0, ruleNotes: q.ruleNotes ?? [],
        },
        status: 'label_created',
        eta: q.etaDate,
        deliveredAt: null,
        events: [{ at, code: 'label_created', loc: locOf(from) }],
        labelFormat: '4x6',
        isDummy: false,
        manifestId: null,
        reweighAdjustmentId: null,
        signatureRequired: !!rates.signature.required,
        appliedRules: rates.rules.matched.map(m => ({ id: m.id, name: m.name })),
        aiPick: {
          chosen: aiChosen,
          reasonCode: rates.ai.reasonCode,
          reason: rates.ai.reason ?? aiReason(rates.ai.reasonCode, ai, rates.aiSavingsVsDefault),
          savingsVsDefault: aiChosen ? savingsVsDefault : 0,
          suggested: rates.aiPickKey,
          source: rates.ai.source,
        },
        items: d.items ?? order?.items ?? [],
        customs: d.customs ?? null,
        source: draft.source ?? 'panel',
        batchId: draft.batchId ?? null,
        createdBy: db.doc('user')?.name ?? null,
        test: isTest,
        printCount: 0,
      }
      db.insert('shipments', shipment)

      let wallet = { transaction: null, topup: null }
      if (!isTest) {
        wallet = chargeWallet({ amount: q.walletCharge, type: 'label', description: labelDescription(q), shipmentId: id })
        db.update('shipments', id, { walletTxnId: wallet.transaction?.id ?? null })
      }
      let updatedOrder = null
      if (order && !isTest) {
        const tags = [...new Set([...(order.tags ?? []), ...rates.tags])]
        updatedOrder = db.update('orders', order.id, {
          status: 'labeled', shipmentId: id, tags, holdReason: null,
          events: orderEvent(order, 'labeled', { shipmentId: id, trackingNo, carrier: q.carrierCode }),
        })
      }
      if (!isTest) {
        recordTriggers(rates.rules.matched.map(m => m.id))
        const hub = db.all('hubs').find(h => h.code === q.hub)
        if (hub) db.update('hubs', hub.code, { todayLoad: (hub.todayLoad ?? 0) + 1 })
        if (draft.draftId && db.get('drafts', draft.draftId)) db.remove('drafts', draft.draftId)
      }
      return { shipment: plain(db.get('shipments', id)), order: plain(updatedOrder), transaction: wallet.transaction, topup: wallet.topup }
    })

    const s = res.shipment
    const walletDoc = db.doc('wallet')
    if (!isTest) {
      notify({
        type: 'success',
        title: { tr: `Etiket oluşturuldu: ${s.id} · ${svcLabel(q)}`, en: `Label created: ${s.id} · ${svcLabel(q)}` },
        body: { tr: `${order ? order.id + ' · ' : ''}Takip no ${s.trackingNo}, $${s.walletCharge.toFixed(2)} cüzdandan düşüldü.`, en: `${order ? order.id + ' · ' : ''}Tracking ${s.trackingNo}, $${s.walletCharge.toFixed(2)} charged to the wallet.` },
        link: `/shipments/${s.id}`,
      })
      if (res.topup) {
        notify({
          type: 'info',
          title: { tr: `Otomatik yükleme: $${res.topup.amount.toFixed(2)} kayıtlı karttan çekildi`, en: `Auto top-up: $${res.topup.amount.toFixed(2)} charged to your saved card` },
          body: { tr: `Bakiye eşiğin altına düştüğü için yükleme yapıldı. Yeni bakiye $${walletDoc.balance.toFixed(2)}.`, en: `Triggered because the balance fell below the threshold. New balance $${walletDoc.balance.toFixed(2)}.` },
          link: '/billing',
        })
        audit('wallet.auto_topup_charge', res.topup.id, `$${res.topup.amount.toFixed(2)}`)
      }
      if (order) scheduleTrackingWriteBack(order.id, s.id)
    }
    audit(isTest ? 'shipment.create_test' : 'shipment.create', s.id, `${q.carrierCode} ${q.serviceCode} ${s.trackingNo}`)
    modelEvent('optimizer', aiChosen ? 'accept' : 'override', { shipmentId: s.id, suggested: rates.aiPickKey, chosen: key, savings: s.aiPick.savingsVsDefault })
    emitWebhook('shipment.created', { shipmentId: s.id, trackingNo: s.trackingNo, carrier: s.carrier, status: s.status, test: isTest })
    return { ...res, balance: walletDoc.balance, test: isTest, rules: s.appliedRules }
  }, { minMs: 700, maxMs: 1200, source: draft.source === 'api' ? 'api' : undefined })
}

// ---------------------------------------------------------------------------
// Void / reprint / return / dummy
// ---------------------------------------------------------------------------

export function voidLabel(id, { reason = null } = {}) {
  return request(`POST /v1/shipments/${id}/void`, async () => {
    const s = db.get('shipments', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    if (s.status !== 'label_created') throw new ApiError('VOID_NOT_ALLOWED', 'Only unused labels can be voided', 409, { status: s.status })
    const pendingRefund = s.carrier === 'USPS'
    const res = await db.transaction(() => {
      const at = nowIso()
      const shipment = db.update('shipments', id, { status: 'voided', voidedAt: at, voidReason: reason, events: [...(s.events ?? []), { at, code: 'voided', loc: locOf(s.from) }] })
      let refund = null
      const amount = round2(s.walletCharge ?? 0)
      if (!s.test && amount > 0) {
        const transaction = creditWallet({
          amount, type: 'refund', shipmentId: id, pending: pendingRefund, completeAfterMs: 10000,
          description: { tr: `İptal iadesi · ${id} (${s.carrier})`, en: `Void refund · ${id} (${s.carrier})` },
        })
        refund = { amount, status: transaction.status, transaction }
        db.update('shipments', id, { refundTxnId: transaction.id })
      }
      let order = null
      const o = s.orderId ? db.get('orders', s.orderId) : null
      if (o && o.shipmentId === id) {
        order = db.update('orders', o.id, { status: 'awaiting_shipment', shipmentId: null, trackingSyncedAt: null, events: orderEvent(o, 'label_voided', { shipmentId: id }) })
      }
      const hub = db.all('hubs').find(h => h.code === s.hub)
      if (hub && hub.todayLoad > 0 && s.createdAt.slice(0, 10) === at.slice(0, 10)) db.update('hubs', hub.code, { todayLoad: hub.todayLoad - 1 })
      return { shipment, order, refund }
    })
    if (res.refund) {
      notify({
        type: 'info',
        title: pendingRefund
          ? { tr: `Etiket iptal edildi: ${id}, $${res.refund.amount.toFixed(2)} iade onay bekliyor`, en: `Label voided: ${id}, $${res.refund.amount.toFixed(2)} refund pending` }
          : { tr: `Etiket iptal edildi: ${id}, $${res.refund.amount.toFixed(2)} iade edildi`, en: `Label voided: ${id}, $${res.refund.amount.toFixed(2)} refunded` },
        link: `/shipments/${id}`,
      })
    }
    audit('shipment.void', id, reason)
    emitWebhook('tracking.updated', { shipmentId: id, trackingNo: s.trackingNo, carrier: s.carrier, status: 'voided' })
    return { ...res, balance: db.doc('wallet').balance }
  }, { minMs: 500, maxMs: 900 })
}

export function reprintLabel(id) {
  return request(`POST /v1/shipments/${id}/label/reprint`, () => {
    const s = db.get('shipments', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    if (s.status === 'voided') throw new ApiError('LABEL_VOIDED', 'Label was voided', 409)
    const r = db.update('shipments', id, { printCount: (s.printCount ?? 0) + 1, lastPrintedAt: nowIso() })
    audit('shipment.reprint', id)
    return r
  }, { minMs: 250, maxMs: 500 })
}

function returnInput(s) {
  return { hub: s.hub, to: s.to, pkg: s.package, declaredValue: s.declaredValue ?? 0, insured: (s.insurance ?? 0) > 0, ignoreHubRule: true, orderContext: { channel: s.channel } }
}

export function quoteReturn(id) {
  return request(`POST /v1/shipments/${id}/return/rates`, async () => {
    const s = db.get('shipments', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    return rateShopNow(returnInput(plain(s)))
  }, { minMs: 350, maxMs: 700 })
}

export function createReturnLabel(id, { quoteKey = null } = {}) {
  return request(`POST /v1/shipments/${id}/return`, async () => {
    const s = db.get('shipments', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    if (s.status === 'voided' || s.status === 'label_created') throw new ApiError('RETURN_NOT_ALLOWED', 'Return labels need a shipped parcel', 409)
    if (s.returnShipmentId) throw new ApiError('RETURN_EXISTS', 'A return label already exists', 409, { shipmentId: s.returnShipmentId })
    if (s.isReturn) throw new ApiError('RETURN_NOT_ALLOWED', 'Cannot return a return', 409)
    const ctx = buildPricingContext()
    const rates = await rateShopNow(returnInput(plain(s)), ctx)
    const q = findQuote(rates, quoteKey ?? rates.aiPickKey)
    if (!q) throw new ApiError('QUOTE_UNAVAILABLE', 'Selected service is not available', 409)
    const account = q.source === 'own' ? ctx.carrierAccounts.find(a => a.id === q.accountId) : null
    const res = await db.transaction(() => {
      const rid = db.nextId('SHP')
      const at = nowIso()
      const trackingNo = uniqueTrackingNo(q.carrierCode, q.serviceCode, { own: !!account, accountNumber: account?.accountNumber, seed: rid })
      const hubAddr = hubAddress(s.hub)
      const shipment = {
        ...plain(s),
        id: rid, createdAt: at, orderId: s.orderId, reference: s.reference, carrier: q.carrierCode, service: q.serviceCode,
        account: account ? `own:${account.id}` : 'platform', trackingNo,
        from: { ...s.to }, to: { ...hubAddr, residential: false },
        billableLb: q.billableLb, dimWeightLb: q.dimWeightLb, zone: q.zone, cost: q.cost, price: q.sellPrice, insurance: q.insurance,
        total: q.total, walletCharge: q.walletCharge, carrierCharge: q.carrierCharge || 0,
        pricing: { base: q.base, fuel: q.fuel, residential: q.residential, markupPct: q.markupPct, source: q.source, cardId: q.cardId ?? null, overrideId: q.overrideId ?? null, platformFee: q.platformFee || 0, signatureFee: 0 },
        status: 'label_created', eta: q.etaDate, deliveredAt: null,
        events: [{ at, code: 'label_created', loc: locOf(s.to) }],
        manifestId: null, reweighAdjustmentId: null, isReturn: true, returnOf: s.id, returnShipmentId: null, dummyLabel: null,
        aiPick: { chosen: q.key === rates.aiPickKey, reasonCode: rates.ai.reasonCode, reason: aiReason(rates.ai.reasonCode, q, 0), savingsVsDefault: 0, suggested: rates.aiPickKey },
        source: 'panel', test: false, printCount: 0, walletTxnId: null, refundTxnId: null, voidedAt: null,
      }
      db.insert('shipments', shipment)
      const w = chargeWallet({ amount: q.walletCharge, type: 'label', description: labelDescription(q, { isReturn: true }), shipmentId: rid })
      db.update('shipments', rid, { walletTxnId: w.transaction?.id ?? null })
      db.update('shipments', s.id, { returnShipmentId: rid })
      return { shipment: db.get('shipments', rid), transaction: w.transaction, topup: w.topup }
    })
    notify({ type: 'success', title: { tr: `İade etiketi oluşturuldu: ${res.shipment.id} (${s.id})`, en: `Return label created: ${res.shipment.id} (${s.id})` }, link: `/shipments/${res.shipment.id}` })
    audit('shipment.return_label', res.shipment.id, s.id)
    return { ...res, balance: db.doc('wallet').balance }
  }, { minMs: 600, maxMs: 1000 })
}

function dummyTarget(ref) {
  if (ref?.intlId) {
    const r = db.get('intl_shipments', ref.intlId)
    if (!r) throw new ApiError('NOT_FOUND', 'International shipment not found', 404)
    return { col: 'intl_shipments', rec: r }
  }
  const r = db.get('shipments', ref?.shipmentId)
  if (!r) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
  return { col: 'shipments', rec: r }
}

export function createDummyLabel(ref) {
  return request('POST /v1/labels/temporary', () => {
    const { col, rec } = dummyTarget(ref)
    if (rec.dummyLabel?.status === 'active') return { dummyLabel: rec.dummyLabel, target: { col, id: rec.id }, existing: true }
    const n = db.nextId('TMP').split('-')[1]
    const dummyLabel = { ref: `KPZ-TMP-${String(Number(n) + 100000).slice(-6)}`, createdAt: nowIso(), status: 'active', watermark: DUMMY_WATERMARK }
    db.update(col, rec.id, { dummyLabel })
    audit('label.temporary_create', rec.id, dummyLabel.ref)
    return { dummyLabel, target: { col, id: rec.id }, existing: false }
  }, { minMs: 400, maxMs: 800 })
}

export function markDummyReplaced(ref, { finalShipmentId = null, finalTrackingNo = null } = {}) {
  return request('POST /v1/labels/temporary/replace', () => {
    const { col, rec } = dummyTarget(ref)
    if (!rec.dummyLabel) throw new ApiError('NO_TEMPORARY_LABEL', 'No temporary label', 409)
    const final = finalShipmentId ? db.get('shipments', finalShipmentId) : null
    const dummyLabel = { ...rec.dummyLabel, status: 'replaced', replacedAt: nowIso(), finalShipmentId: finalShipmentId ?? (col === 'shipments' ? rec.id : null), finalTrackingNo: finalTrackingNo ?? final?.trackingNo ?? (col === 'shipments' ? rec.trackingNo : null) }
    db.update(col, rec.id, { dummyLabel })
    audit('label.temporary_replace', rec.id, dummyLabel.ref)
    return { dummyLabel }
  }, { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listShipments(p = {}) {
  return request('GET /v1/shipments', () => {
    let list = db.all('shipments')
    if (p.includeTest === false) list = list.filter(s => !s.test)
    if (p.status && p.status !== 'all') list = list.filter(s => (Array.isArray(p.status) ? p.status.includes(s.status) : s.status === p.status))
    const inList = (v, x) => (Array.isArray(v) ? !v.length || v.includes(x) : v === x)
    if (p.carrier && p.carrier.length) list = list.filter(s => inList(p.carrier, s.carrier))
    if (p.service && p.service.length) list = list.filter(s => inList(p.service, s.service))
    if (p.hub && p.hub.length) list = list.filter(s => inList(p.hub, s.hub))
    if (p.account === 'own') list = list.filter(s => String(s.account).startsWith('own:'))
    if (p.account === 'platform') list = list.filter(s => s.account === 'platform')
    if (p.aiPick === 'yes') list = list.filter(s => s.aiPick?.chosen)
    if (p.aiPick === 'no') list = list.filter(s => !s.aiPick?.chosen)
    if (p.hasAdjustment) list = list.filter(s => !!s.reweighAdjustmentId)
    if (p.from) list = list.filter(s => s.createdAt >= p.from)
    if (p.to) list = list.filter(s => s.createdAt <= p.to)
    if (p.q) {
      const q = String(p.q).trim().toLowerCase()
      list = list.filter(s => [s.id, s.trackingNo, s.orderId, s.reference, s.to?.name, s.to?.city].some(v => String(v ?? '').toLowerCase().includes(q)))
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, { minMs: 300, maxMs: 700 })
}

export function shipmentCounts() {
  const c = { all: 0, label_created: 0, in_transit: 0, out_for_delivery: 0, delivered: 0, exception: 0, voided: 0, returned: 0, drafts: db.all('drafts').length }
  for (const s of db.all('shipments')) { c.all++; c[s.status] = (c[s.status] ?? 0) + 1 }
  return c
}

function breakdownOf(s) {
  const p = s.pricing ?? {}
  const out = [{ code: 'base', amount: p.base ?? 0 }, { code: 'fuel', amount: p.fuel ?? 0 }]
  if (p.residential) out.push({ code: 'residential', amount: p.residential })
  if (p.source === 'own') {
    out.push({ code: 'carrier_charge', amount: s.carrierCharge ?? round2((s.price ?? 0) - (p.platformFee ?? 0)) })
    out.push({ code: 'own_account_fee', amount: p.platformFee ?? 0.05 })
  } else {
    const cost = round2((p.base ?? 0) + (p.fuel ?? 0) + (p.residential ?? 0))
    out.push({ code: p.source === 'dynamic' ? 'dynamic' : 'markup', amount: round2((s.price ?? 0) - cost) })
  }
  if (p.signatureFee) out.push({ code: 'signature', amount: p.signatureFee })
  if (s.insurance) out.push({ code: 'insurance', amount: s.insurance })
  return out
}

export function getShipment(id) {
  return request(`GET /v1/shipments/${id}`, () => {
    const s = db.get('shipments', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    const order = s.orderId ? db.get('orders', s.orderId) ?? null : null
    const adjustment = s.reweighAdjustmentId ? db.get('adjustments', s.reweighAdjustmentId) ?? null : db.all('adjustments').find(a => a.shipmentId === id) ?? null
    const hubCity = locOf(s.from)
    const dest = locOf(s.to)
    const transit = (ROUTES[s.hub]?.[regionOf(s.to?.state)] ?? []).filter(c => c !== dest && c !== hubCity)
    const route = [hubCity, ...transit, dest].filter((v, i, a) => v && a.indexOf(v) === i)
    return {
      ...plain(s),
      order: plain(order),
      adjustment: plain(adjustment),
      returnShipment: s.returnShipmentId ? plain(db.get('shipments', s.returnShipmentId) ?? null) : null,
      returnOfShipment: s.returnOf ? plain(db.get('shipments', s.returnOf) ?? null) : null,
      breakdown: breakdownOf(s),
      route,
    }
  }, { minMs: 250, maxMs: 550 })
}

export function trackingProgressStep(status, events = []) {
  if (status === 'delivered') return 4
  if (status === 'out_for_delivery') return 3
  const codes = new Set(events.map(e => e.code))
  if (codes.has('departed') || codes.has('in_transit') || codes.has('arrived') || codes.has('picked_up') || status === 'returned' || status === 'exception') return 2
  if (codes.has('hub_received')) return 1
  return 0
}

function publicView(s) {
  const carrier = db.get('carriers', s.carrier)
  const service = carrier?.services?.find(x => x.code === s.service)
  return {
    shipmentId: s.id,
    trackingNo: s.trackingNo,
    carrier: s.carrier,
    carrierName: carrier?.name ?? s.carrier,
    service: s.service,
    serviceName: service?.name ?? s.service,
    status: s.status,
    step: trackingProgressStep(s.status, s.events),
    eta: s.eta ?? null,
    deliveredAt: s.deliveredAt ?? null,
    origin: { city: s.from?.city, state: s.from?.state },
    destination: { city: s.to?.city, state: s.to?.state },
    events: [...(s.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    orderRef: s.reference ?? s.orderId ?? null,
  }
}

export function trackLookup(query) {
  return request(`GET /v1/tracking/${encodeURIComponent(String(query ?? '').trim())}`, () => {
    const tokens = [...new Set(String(query ?? '').split(/[\s,;]+/).map(t => t.trim()).filter(Boolean))].slice(0, 25)
    if (!tokens.length) throw new ApiError('VALIDATION', 'Tracking number required', 422, { query: 'required' })
    const all = db.all('shipments').filter(s => !s.test)
    const orders = db.all('orders')
    const out = []
    for (const tok of tokens) {
      const t = tok.toUpperCase()
      let matches = all.filter(s => String(s.trackingNo).toUpperCase() === t || s.id === t)
      if (!matches.length) {
        const o = orders.find(x => x.id === t || String(x.channelOrderNo).toUpperCase() === t)
        if (o) matches = all.filter(s => s.orderId === o.id || (o.shipmentId && s.id === o.shipmentId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1)
      }
      if (!matches.length) matches = all.filter(s => s.reference && String(s.reference).toUpperCase() === t).slice(0, 1)
      if (matches.length) for (const m of matches) out.push({ query: tok, found: true, result: publicView(m) })
      else out.push({ query: tok, found: false, result: null })
    }
    return out
  }, { minMs: 300, maxMs: 700, source: 'api' })
}

export function advanceTracking(id) {
  return request(`POST /v1/shipments/${id}/simulate-scan`, async () => {
    const s = db.get('shipments', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Shipment not found', 404)
    if (['delivered', 'voided', 'returned'].includes(s.status)) throw new ApiError('TRACKING_FINAL', 'Shipment is in a final state', 409)
    const codes = (s.events ?? []).map(e => e.code)
    const route = ROUTES[s.hub]?.[regionOf(s.to?.state)] ?? []
    const hubLoc = locOf(s.from)
    const dest = locOf(s.to)
    let next
    if (!codes.includes('hub_received')) next = { code: 'hub_received', loc: hubLoc }
    else if (!codes.includes('picked_up')) next = { code: 'picked_up', loc: hubLoc }
    else if (!codes.includes('departed')) next = { code: 'departed', loc: route[0] ?? hubLoc }
    else {
      const transits = codes.filter(c => c === 'in_transit').length
      if (transits < route.length - 1) next = { code: 'in_transit', loc: route[transits + 1] }
      else if (!codes.includes('arrived')) next = { code: 'arrived', loc: dest }
      else if (!codes.includes('out_for_delivery')) next = { code: 'out_for_delivery', loc: dest }
      else next = { code: 'delivered', loc: dest }
    }
    const at = nowIso()
    const status = EVENT_STATUS[next.code]
    const res = await db.transaction(() => {
      const patch = { status, events: [...(s.events ?? []), { at, ...next }] }
      if (next.code === 'delivered') patch.deliveredAt = at
      const shipment = db.update('shipments', id, patch)
      const o = s.orderId ? db.get('orders', s.orderId) : null
      if (o && o.shipmentId === id) {
        if (status === 'in_transit' && o.status === 'labeled') db.update('orders', o.id, { status: 'shipped', events: orderEvent(o, 'shipped') })
        if (status === 'delivered') db.update('orders', o.id, { status: 'delivered', events: orderEvent(o, 'delivered') })
      }
      return shipment
    })
    if (next.code === 'delivered') {
      notify({ type: 'success', title: { tr: `Teslim edildi: ${id} (${dest})`, en: `Delivered: ${id} (${dest})` }, link: `/shipments/${id}` })
      emitWebhook('shipment.delivered', { shipmentId: id, trackingNo: s.trackingNo, carrier: s.carrier, status })
    }
    emitWebhook('tracking.updated', { shipmentId: id, trackingNo: s.trackingNo, carrier: s.carrier, status, event: next.code })
    audit('shipment.scan', id, next.code)
    return res
  }, { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function listDrafts() {
  return request('GET /v1/shipments/drafts', () => [...db.all('drafts')].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), { minMs: 200, maxMs: 450 })
}

export function getDraft(id) {
  return request(`GET /v1/shipments/drafts/${id}`, () => {
    const d = db.get('drafts', id)
    if (!d) throw new ApiError('NOT_FOUND', 'Draft not found', 404)
    return d
  }, { minMs: 150, maxMs: 300 })
}

export function saveDraft({ id = null, orderId = null, step = 0, data = {}, summary = null } = {}) {
  return request(id ? `PUT /v1/shipments/drafts/${id}` : 'POST /v1/shipments/drafts', () => {
    const at = nowIso()
    const d = plain(data) ?? {}
    const sum = summary ?? {
      toName: d.to?.name ?? null, city: d.to?.city ?? null, state: d.to?.state ?? null,
      carrier: d.quote?.carrierCode ?? d.carrier ?? null, service: d.quote?.serviceCode ?? d.service ?? null, total: d.quote?.total ?? null,
    }
    const existing = (id && db.get('drafts', id)) || (orderId && db.all('drafts').find(x => x.orderId === orderId))
    if (existing) return db.update('drafts', existing.id, { step, data: d, summary: sum, updatedAt: at, orderId: orderId ?? existing.orderId })
    const n = db.nextId('DRF').split('-')[1]
    return db.insert('drafts', { id: `DRF-${String(n).padStart(4, '0')}`, createdAt: at, updatedAt: at, orderId, step, data: d, summary: sum })
  }, { minMs: 120, maxMs: 250 })
}

export function deleteDraft(id) {
  return request(`DELETE /v1/shipments/drafts/${id}`, () => {
    const r = db.remove('drafts', id)
    if (!r) throw new ApiError('NOT_FOUND', 'Draft not found', 404)
    return { removed: r }
  }, { minMs: 150, maxMs: 300 })
}
