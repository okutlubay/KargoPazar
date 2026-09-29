/**
 * Prepaid wallet, cards, transactions, weight adjustments and invoices (spec 3.9, 5.10).
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * getWallet() -> { balance, currency, autoTopup: {enabled, threshold, amount, cardId}, cards: Card[],
 *                  pendingRefunds: number, summary: { spend30d, labels30d, topups30d, adjustments30d } }
 *
 * Top-up (two-call 3-D Secure flow):
 *   topUpStart({ amount, cardId } | { amount, newCard: { number, expMonth, expYear, cvc, holder, zip, save? } })
 *     -> { requires3ds: true, challengeId, amount, card: { brand, last4 } }
 *     errors: AMOUNT_MIN (min $25), AMOUNT_MAX, CARD_INVALID (details = field errors), CARD_DECLINED
 *             (4000 0000 0000 0002), CARD_EXPIRED, NOT_FOUND
 *   topUpConfirm(challengeId, { approve = true }) -> { balance, transaction, card|null }
 *     errors: CHALLENGE_EXPIRED, THREEDS_FAILED (approve false)
 *   topUpCancel(challengeId) -> { cancelled: true }
 *   topUp({ amount, cardId|newCard }) -> same as topUpConfirm (start + confirm, for onboarding)
 *
 * Cards: addCard(newCard) -> Card, removeCard(id) -> { removed, cards }, setDefaultCard(id) -> Card[]
 * updateAutoTopup({ enabled?, threshold?, amount?, cardId? }) -> autoTopup
 * Card helpers (sync): luhnValid(number), cardBrand(number) -> 'visa'|'mastercard'|'amex'|'discover'|null,
 *   validateCard(newCard) -> { valid, errors: { number?, exp?, cvc?, holder?, zip? }, brand }
 *   TEST_CARDS = { success: '4242424242424242', declined: '4000000000000002' }
 *
 * Transactions: listTransactions({ type?, status?, q?, from?, to? }) -> Txn[] newest first
 *   Txn = { id, at, type: 'label'|'topup'|'refund'|'adjustment'|'plan_fee'|'opening', amount, balanceAfter,
 *           description: {tr,en}, status: 'completed'|'pending', shipmentId?, adjustmentId?, cardId? }
 *   transactionsCsv(list?) -> string
 *
 * Adjustments: listAdjustments({ status? }) -> Adjustment[] (newest first), getAdjustment(id)
 *   disputeAdjustment(id, { reason, note }) -> Adjustment  (status 'disputed', 3 s later 'reviewing')
 *   DISPUTE_REASONS = ['measurement_error', 'packaging_included', 'wrong_package', 'other']
 *   errors: DISPUTE_NOT_ALLOWED (not charged), DISPUTE_WINDOW_CLOSED, VALIDATION
 * Invoices: listInvoices() -> Invoice[] newest first, getInvoice(id)
 * ownAccountShipments() -> [{ id, createdAt, carrier, service, trackingNo, accountId, carrierCharge,
 *                              platformFee, walletCharge, status, to }]
 *
 * Internal helpers for other api modules (no latency, call inside db.transaction):
 *   chargeWallet({ amount, type='label', description, shipmentId?, meta? }) -> { transaction, topup|null }
 *     auto top-up: if the balance would fall below autoTopup.threshold, the saved card is charged
 *     for autoTopup.amount (multiples when needed) first; INSUFFICIENT_FUNDS otherwise.
 *   creditWallet({ amount, type='refund', description, shipmentId?, pending?, completeAfterMs? }) -> Txn
 *     pending credits (USPS void refunds) are applied to the balance when they complete.
 *   settlePending() -> void (completes pending refunds / dispute reviews whose time has passed)
 */
import { toRaw } from 'vue'
import { request, ApiError, sleep } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { round2 } from '@/shared/rateEngine.js'

export const TEST_CARDS = { success: '4242424242424242', declined: '4000000000000002' }
export const DISPUTE_REASONS = ['measurement_error', 'packaging_included', 'wrong_package', 'other']
const MIN_TOPUP = 25
const MAX_TOPUP = 10000
const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()
const digits = s => String(s ?? '').replace(/\D/g, '')

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

export function luhnValid(number) {
  const d = digits(number)
  if (d.length < 12 || d.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i]
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export function cardBrand(number) {
  const d = digits(number)
  if (/^4/.test(d)) return 'visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return 'mastercard'
  if (/^3[47]/.test(d)) return 'amex'
  if (/^(6011|65|64[4-9])/.test(d)) return 'discover'
  return null
}

function normYear(y) { const n = Number(y); return n < 100 ? 2000 + n : n }

function isExpired(month, year, now = new Date()) {
  const y = normYear(year)
  const m = Number(month)
  return y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)
}

export function validateCard(c = {}) {
  const errors = {}
  const brand = cardBrand(c.number)
  const num = digits(c.number)
  if (!num) errors.number = 'required'
  else if (!luhnValid(num) || !brand) errors.number = 'card_number'
  const m = Number(c.expMonth)
  const y = Number(c.expYear)
  if (!c.expMonth || !c.expYear) errors.exp = 'required'
  else if (!(m >= 1 && m <= 12) || !(y > 0)) errors.exp = 'card_exp'
  else if (isExpired(m, y)) errors.exp = 'card_expired'
  const cvc = digits(c.cvc)
  if (!cvc) errors.cvc = 'required'
  else if (cvc.length !== (brand === 'amex' ? 4 : 3)) errors.cvc = 'card_cvc'
  if (!String(c.holder ?? '').trim()) errors.holder = 'required'
  const zip = String(c.zip ?? '').trim()
  if (!zip) errors.zip = 'required'
  else if (!/^[A-Za-z0-9 -]{3,10}$/.test(zip)) errors.zip = 'zip'
  return { valid: Object.keys(errors).length === 0, errors, brand }
}

function cardRecord(c, { isDefault = false } = {}) {
  const num = digits(c.number)
  return {
    id: `card_${num.slice(-4)}_${Date.now().toString(36).slice(-4)}`,
    brand: cardBrand(num),
    last4: num.slice(-4),
    expMonth: Number(c.expMonth),
    expYear: normYear(c.expYear),
    holder: String(c.holder).trim(),
    billingZip: String(c.zip).trim(),
    isDefault,
    addedAt: nowIso(),
  }
}

// ---------------------------------------------------------------------------
// Internal balance operations (used by shipments, ops, plan)
// ---------------------------------------------------------------------------

function wallet() { return db.doc('wallet') }

function appendTxn(t) {
  const n = db.nextId('TXN')
  const txn = { id: n, at: nowIso(), status: 'completed', ...t }
  db.patchDoc('wallet', w => ({ transactions: [...(w.transactions ?? []), txn] }))
  return txn
}

export function chargeWallet({ amount, type = 'label', description, shipmentId = null, meta = {} }) {
  const amt = round2(amount)
  if (!(amt > 0)) return { transaction: null, topup: null }
  const w = wallet()
  let balance = round2(w.balance)
  let topup = null
  const auto = w.autoTopup ?? {}
  if (auto.enabled && balance - amt < Number(auto.threshold ?? 0)) {
    const card = (w.cards ?? []).find(c => c.id === auto.cardId) ?? (w.cards ?? []).find(c => c.isDefault)
    if (card && !isExpired(card.expMonth, card.expYear)) {
      const step = Math.max(MIN_TOPUP, Number(auto.amount) || 500)
      let topAmt = step
      while (balance + topAmt - amt < 0) topAmt += step
      balance = round2(balance + topAmt)
      db.patchDoc('wallet', { balance })
      topup = appendTxn({
        type: 'topup', amount: topAmt, balanceAfter: balance, cardId: card.id, auto: true,
        description: { tr: `Otomatik yükleme · ${brandName(card.brand)} •••• ${card.last4}`, en: `Auto top-up · ${brandName(card.brand)} •••• ${card.last4}` },
      })
    }
  }
  if (balance < amt) {
    throw new ApiError('INSUFFICIENT_FUNDS', 'Insufficient wallet balance', 402, { balance, required: amt, autoTopup: !!auto.enabled })
  }
  balance = round2(balance - amt)
  db.patchDoc('wallet', { balance })
  const transaction = appendTxn({ type, amount: -amt, balanceAfter: balance, description, ...(shipmentId ? { shipmentId } : {}), ...meta })
  return { transaction, topup }
}

const pendingTimers = new Map()

export function creditWallet({ amount, type = 'refund', description, shipmentId = null, pending = false, completeAfterMs = 10000, meta = {} }) {
  const amt = round2(amount)
  if (!(amt > 0)) return null
  if (pending) {
    const txn = appendTxn({ type, amount: amt, balanceAfter: null, status: 'pending', completesAt: new Date(Date.now() + completeAfterMs).toISOString(), description, ...(shipmentId ? { shipmentId } : {}), ...meta })
    scheduleSettle(txn.id, completeAfterMs)
    return txn
  }
  const balance = round2(wallet().balance + amt)
  db.patchDoc('wallet', { balance })
  return appendTxn({ type, amount: amt, balanceAfter: balance, description, ...(shipmentId ? { shipmentId } : {}), ...meta })
}

function scheduleSettle(id, ms) {
  if (pendingTimers.has(id)) return
  pendingTimers.set(id, setTimeout(() => { pendingTimers.delete(id); completePending(id) }, Math.max(0, ms)))
}

function completePending(id) {
  const w = wallet()
  const txn = (w.transactions ?? []).find(t => t.id === id)
  if (!txn || txn.status !== 'pending') return
  const balance = round2(w.balance + txn.amount)
  db.patchDoc('wallet', d => ({
    balance,
    transactions: d.transactions.map(t => (t.id === id ? { ...t, status: 'completed', balanceAfter: balance, completedAt: nowIso() } : t)),
  }))
  notify({
    type: 'success',
    title: { tr: `İade onaylandı: $${txn.amount.toFixed(2)} cüzdanınıza eklendi`, en: `Refund approved: $${txn.amount.toFixed(2)} added to your wallet` },
    body: txn.description,
    link: '/billing',
  })
}

export function settlePending() {
  const now = Date.now()
  for (const t of wallet().transactions ?? []) {
    if (t.status !== 'pending' || !t.completesAt) continue
    const left = new Date(t.completesAt).getTime() - now
    if (left <= 0) completePending(t.id)
    else scheduleSettle(t.id, left)
  }
  for (const a of db.all('adjustments')) {
    if (a.status === 'disputed' && a.dispute?.reviewAt) {
      const left = new Date(a.dispute.reviewAt).getTime() - now
      if (left <= 0) markReviewing(a.id)
      else scheduleReview(a.id, left)
    }
  }
}

function brandName(b) { return { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' }[b] ?? 'Card' }

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function summary() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const recent = (wallet().transactions ?? []).filter(t => t.at >= since && t.status === 'completed')
  const sum = type => round2(recent.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0))
  return {
    spend30d: round2(-recent.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0)),
    labels30d: recent.filter(t => t.type === 'label').length,
    topups30d: sum('topup'),
    adjustments30d: round2(-sum('adjustment')),
    refunds30d: sum('refund'),
  }
}

export function getWallet() {
  return request('GET /v1/wallet', () => {
    settlePending()
    const w = wallet()
    return {
      balance: w.balance,
      currency: w.currency ?? 'USD',
      autoTopup: plain(w.autoTopup),
      cards: plain(w.cards ?? []),
      pendingRefunds: round2((w.transactions ?? []).filter(t => t.status === 'pending').reduce((s, t) => s + t.amount, 0)),
      summary: summary(),
    }
  }, { minMs: 250, maxMs: 550 })
}

// ---------------------------------------------------------------------------
// Top-up with 3-D Secure
// ---------------------------------------------------------------------------

const challenges = new Map()

function prepareTopup({ amount, cardId, newCard }) {
  const amt = round2(amount)
  if (!(amt >= MIN_TOPUP)) throw new ApiError('AMOUNT_MIN', 'Minimum top-up is $25', 422, { amount: 'min', min: MIN_TOPUP })
  if (amt > MAX_TOPUP) throw new ApiError('AMOUNT_MAX', 'Maximum top-up is $10,000', 422, { amount: 'max', max: MAX_TOPUP })
  let card
  if (newCard) {
    const v = validateCard(newCard)
    if (!v.valid) throw new ApiError(v.errors.exp === 'card_expired' ? 'CARD_EXPIRED' : 'CARD_INVALID', 'Invalid card', 422, v.errors)
    if (digits(newCard.number) === TEST_CARDS.declined) {
      audit('wallet.topup_declined', digits(newCard.number).slice(-4))
      throw new ApiError('CARD_DECLINED', 'Card declined', 402, { number: 'card_declined' })
    }
    card = { brand: v.brand, last4: digits(newCard.number).slice(-4), newCard: plain(newCard) }
  } else {
    const saved = (wallet().cards ?? []).find(c => c.id === cardId) ?? (!cardId ? (wallet().cards ?? []).find(c => c.isDefault) : null)
    if (!saved) throw new ApiError('NOT_FOUND', 'Card not found', 404, { cardId: 'required' })
    if (isExpired(saved.expMonth, saved.expYear)) throw new ApiError('CARD_EXPIRED', 'Card expired', 422)
    card = { brand: saved.brand, last4: saved.last4, cardId: saved.id }
  }
  return { amt, card }
}

export function topUpStart(input) {
  return request('POST /v1/wallet/topups', () => {
    const { amt, card } = prepareTopup(input)
    const challengeId = 'tds_' + Math.random().toString(36).slice(2, 10)
    challenges.set(challengeId, { amount: amt, card, expiresAt: Date.now() + 5 * 60 * 1000 })
    return { requires3ds: true, challengeId, amount: amt, card: { brand: card.brand, last4: card.last4 } }
  }, { minMs: 500, maxMs: 900 })
}

function finalizeTopup(ch) {
  let savedCard = null
  if (ch.card.newCard && ch.card.newCard.save !== false) {
    const w = wallet()
    const exists = (w.cards ?? []).find(c => c.last4 === ch.card.last4 && c.brand === ch.card.brand)
    savedCard = exists ?? cardRecord(ch.card.newCard, { isDefault: !(w.cards ?? []).length })
    if (!exists) db.patchDoc('wallet', d => ({ cards: [...(d.cards ?? []), savedCard] }))
  }
  const balance = round2(wallet().balance + ch.amount)
  db.patchDoc('wallet', { balance })
  const transaction = appendTxn({
    type: 'topup', amount: ch.amount, balanceAfter: balance, cardId: ch.card.cardId ?? savedCard?.id ?? null,
    description: { tr: `Bakiye yükleme · ${brandName(ch.card.brand)} •••• ${ch.card.last4}`, en: `Top-up · ${brandName(ch.card.brand)} •••• ${ch.card.last4}` },
  })
  audit('wallet.topup', transaction.id, `$${ch.amount.toFixed(2)}`)
  return { balance, transaction, card: savedCard }
}

export function topUpConfirm(challengeId, { approve = true } = {}) {
  return request('POST /v1/wallet/topups/confirm', async () => {
    const ch = challenges.get(challengeId)
    if (!ch || ch.expiresAt < Date.now()) { challenges.delete(challengeId); throw new ApiError('CHALLENGE_EXPIRED', '3-D Secure session expired', 410) }
    challenges.delete(challengeId)
    if (!approve) throw new ApiError('THREEDS_FAILED', '3-D Secure authentication failed', 402)
    return db.transaction(() => finalizeTopup(ch))
  }, { minMs: 700, maxMs: 1100 })
}

export function topUpCancel(challengeId) {
  challenges.delete(challengeId)
  return request('POST /v1/wallet/topups/cancel', () => ({ cancelled: true }), { minMs: 150, maxMs: 300 })
}

/** Single-call top-up (start + 3-D Secure approve). */
export function topUp(input) {
  return request('POST /v1/wallet/topups', async () => {
    const { amt, card } = prepareTopup(input)
    await sleep(600)
    return db.transaction(() => finalizeTopup({ amount: amt, card }))
  }, { minMs: 500, maxMs: 900 })
}

// ---------------------------------------------------------------------------
// Cards & auto top-up
// ---------------------------------------------------------------------------

export function addCard(newCard) {
  return request('POST /v1/wallet/cards', () => {
    const v = validateCard(newCard)
    if (!v.valid) throw new ApiError(v.errors.exp === 'card_expired' ? 'CARD_EXPIRED' : 'CARD_INVALID', 'Invalid card', 422, v.errors)
    if (digits(newCard.number) === TEST_CARDS.declined) throw new ApiError('CARD_DECLINED', 'Card declined', 402, { number: 'card_declined' })
    const w = wallet()
    const last4 = digits(newCard.number).slice(-4)
    if ((w.cards ?? []).some(c => c.last4 === last4 && c.brand === v.brand)) throw new ApiError('CARD_EXISTS', 'Card already saved', 409, { number: 'card_exists' })
    const card = cardRecord(newCard, { isDefault: !!newCard.makeDefault || !(w.cards ?? []).length })
    db.patchDoc('wallet', d => ({ cards: [...(d.cards ?? []).map(c => (card.isDefault ? { ...c, isDefault: false } : c)), card] }))
    audit('wallet.card_add', card.id, `${brandName(card.brand)} •••• ${card.last4}`)
    return card
  }, { minMs: 600, maxMs: 1000 })
}

export function removeCard(id) {
  return request(`DELETE /v1/wallet/cards/${id}`, () => {
    const w = wallet()
    const card = (w.cards ?? []).find(c => c.id === id)
    if (!card) throw new ApiError('NOT_FOUND', 'Card not found', 404)
    let cards = w.cards.filter(c => c.id !== id)
    if (card.isDefault && cards.length) cards = cards.map((c, i) => ({ ...c, isDefault: i === 0 }))
    const auto = { ...w.autoTopup }
    if (auto.cardId === id) {
      auto.cardId = cards.find(c => c.isDefault)?.id ?? null
      if (!auto.cardId) auto.enabled = false
    }
    db.patchDoc('wallet', { cards, autoTopup: auto })
    audit('wallet.card_remove', id, `${brandName(card.brand)} •••• ${card.last4}`)
    return { removed: card, cards, autoTopup: auto }
  }, { minMs: 300, maxMs: 600 })
}

export function setDefaultCard(id) {
  return request(`POST /v1/wallet/cards/${id}/default`, () => {
    const w = wallet()
    if (!(w.cards ?? []).some(c => c.id === id)) throw new ApiError('NOT_FOUND', 'Card not found', 404)
    const cards = w.cards.map(c => ({ ...c, isDefault: c.id === id }))
    db.patchDoc('wallet', { cards, autoTopup: { ...w.autoTopup, cardId: id } })
    audit('wallet.card_default', id)
    return cards
  }, { minMs: 250, maxMs: 500 })
}

export function updateAutoTopup(patch) {
  return request('PATCH /v1/wallet/auto-topup', () => {
    const w = wallet()
    const next = { ...w.autoTopup, ...patch }
    const errors = {}
    if (!(Number(next.threshold) >= 0)) errors.threshold = 'number'
    if (!(Number(next.amount) >= MIN_TOPUP)) errors.amount = 'min'
    if (next.enabled && !(w.cards ?? []).some(c => c.id === next.cardId)) {
      next.cardId = (w.cards ?? []).find(c => c.isDefault)?.id ?? null
      if (!next.cardId) errors.cardId = 'required'
    }
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid auto top-up settings', 422, errors)
    next.threshold = round2(next.threshold)
    next.amount = round2(next.amount)
    db.patchDoc('wallet', { autoTopup: next })
    audit('wallet.auto_topup', null, `${next.enabled ? 'on' : 'off'} ${next.threshold}/${next.amount}`)
    return next
  }, { minMs: 250, maxMs: 500 })
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export function listTransactions(p = {}) {
  return request('GET /v1/wallet/transactions', () => {
    settlePending()
    let list = [...(wallet().transactions ?? [])]
    if (p.type) list = list.filter(t => (Array.isArray(p.type) ? p.type.includes(t.type) : t.type === p.type))
    if (p.status) list = list.filter(t => t.status === p.status)
    if (p.from) list = list.filter(t => t.at >= p.from)
    if (p.to) list = list.filter(t => t.at <= p.to)
    if (p.q) {
      const q = String(p.q).toLowerCase()
      list = list.filter(t => [t.id, t.shipmentId, t.adjustmentId, t.description?.tr, t.description?.en].some(v => String(v ?? '').toLowerCase().includes(q)))
    }
    return list.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
  }, { minMs: 300, maxMs: 600 })
}

export function transactionsCsv(list = null, lang = 'en') {
  const rows = [['id', 'date', 'type', 'description', 'amount_usd', 'balance_after_usd', 'status', 'shipment_id']]
  const src = list ?? [...(wallet().transactions ?? [])].sort((a, b) => b.at.localeCompare(a.at))
  for (const t of src) rows.push([t.id, t.at, t.type, t.description?.[lang] ?? t.description?.en ?? '', t.amount.toFixed(2), t.balanceAfter == null ? '' : Number(t.balanceAfter).toFixed(2), t.status, t.shipmentId ?? ''])
  return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

const reviewTimers = new Map()
function scheduleReview(id, ms) {
  if (reviewTimers.has(id)) return
  reviewTimers.set(id, setTimeout(() => { reviewTimers.delete(id); markReviewing(id) }, Math.max(0, ms)))
}
function markReviewing(id) {
  const a = db.get('adjustments', id)
  if (!a || a.status !== 'disputed') return
  db.update('adjustments', id, { status: 'reviewing', dispute: { ...a.dispute, stage: 'reviewing', reviewStartedAt: nowIso() } })
  notify({ type: 'info', title: { tr: `İtirazınız inceleniyor: ${a.shipmentId}`, en: `Your dispute is under review: ${a.shipmentId}` }, link: '/billing?tab=adjustments' })
}

export function listAdjustments(p = {}) {
  return request('GET /v1/adjustments', () => {
    settlePending()
    let list = [...db.all('adjustments')]
    if (p.status) list = list.filter(a => a.status === p.status)
    return list.sort((a, b) => (b.measuredAt ?? '').localeCompare(a.measuredAt ?? ''))
  }, { minMs: 300, maxMs: 600 })
}

export function getAdjustment(id) {
  return request(`GET /v1/adjustments/${id}`, () => {
    const a = db.get('adjustments', id)
    if (!a) throw new ApiError('NOT_FOUND', 'Adjustment not found', 404)
    const shipment = db.get('shipments', a.shipmentId)
    return { ...plain(a), shipment: plain(shipment ?? null) }
  }, { minMs: 200, maxMs: 450 })
}

export function disputeAdjustment(id, { reason, note = '' } = {}) {
  return request(`POST /v1/adjustments/${id}/dispute`, () => {
    const a = db.get('adjustments', id)
    if (!a) throw new ApiError('NOT_FOUND', 'Adjustment not found', 404)
    if (!DISPUTE_REASONS.includes(reason)) throw new ApiError('VALIDATION', 'Reason required', 422, { reason: 'required' })
    if (reason === 'other' && String(note).trim().length < 10) throw new ApiError('VALIDATION', 'Please describe the reason', 422, { note: 'min', min: 10 })
    if (a.status !== 'charged') throw new ApiError('DISPUTE_NOT_ALLOWED', 'Only charged adjustments can be disputed', 409)
    if (a.disputeDeadline && new Date(a.disputeDeadline).getTime() < Date.now()) throw new ApiError('DISPUTE_WINDOW_CLOSED', 'Dispute window closed', 409)
    const reviewAt = new Date(Date.now() + 3000).toISOString()
    const r = db.update('adjustments', id, { status: 'disputed', dispute: { reason, note: String(note).trim(), at: nowIso(), stage: 'submitted', reviewAt } })
    scheduleReview(id, 3000)
    audit('adjustment.dispute', id, reason)
    return r
  }, { minMs: 400, maxMs: 800 })
}

// ---------------------------------------------------------------------------
// Invoices & own account shipments
// ---------------------------------------------------------------------------

export function listInvoices() {
  return request('GET /v1/invoices', () => [...db.all('invoices')].sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? '')), { minMs: 250, maxMs: 500 })
}

export function getInvoice(id) {
  return request(`GET /v1/invoices/${id}`, () => {
    const inv = db.get('invoices', id)
    if (!inv) throw new ApiError('NOT_FOUND', 'Invoice not found', 404)
    return inv
  }, { minMs: 200, maxMs: 400 })
}

export function ownAccountShipments() {
  return request('GET /v1/shipments?account=own', () => db.all('shipments')
    .filter(s => String(s.account ?? '').startsWith('own:'))
    .map(s => {
      const platformFee = s.pricing?.platformFee ?? 0.05
      return {
        id: s.id, createdAt: s.createdAt, carrier: s.carrier, service: s.service, trackingNo: s.trackingNo,
        accountId: s.account.slice(4), carrierCharge: s.carrierCharge ?? round2((s.price ?? 0) - platformFee),
        platformFee, insurance: s.insurance ?? 0, walletCharge: s.walletCharge ?? platformFee, status: s.status, to: s.to, orderId: s.orderId,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), { minMs: 300, maxMs: 600 })
}

// Complete pending refunds / reviews left over from a previous page load.
db.afterInit(() => { try { settlePending() } catch {} })
