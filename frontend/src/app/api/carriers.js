/**
 * Carrier accounts (customer's own accounts, spec 7.4) and the platform carrier list
 * (Admin > Carriers, add-carrier wizard, spec 10.1 / 9.5).
 *
 * ---------------------------------------------------------------------------
 * API summary: customer carrier accounts
 * ---------------------------------------------------------------------------
 * OWN_ACCOUNT_CARRIERS = ['FDX', 'UPS', 'USPS', 'DHLE']
 * ACCOUNT_FIELDS[carrier] = [{ id, kind: 'digits'|'alnum'|'zip'|'country'|'money'|'secret'|'text', length?, min? }]
 *   labels: t('core.carrierAccounts.fields.<id>')
 * validateAccountInput(carrier, input) -> { valid, errors: { <fieldId>: code } }         (sync)
 *   FedEx: accountNumber (9 digits), billingZip, invoiceNumber (9 digits), invoiceAmount
 *   UPS: accountNumber (6 characters), billingZip, country
 *   USPS: userId (6-20 characters)
 *   DHL eCommerce: pickupAccount (7-10 digits), clientId (8+), clientSecret (12+)
 * listCarrierAccounts() -> [{ ...account, carrierName, color, ink, usage }]
 * verifyCarrierAccount(carrier, input) -> { verificationToken, accountMasked }         ~1.5 s
 *   account number '000000000' (any all-zero number) -> ApiError ACCOUNT_VERIFICATION_FAILED
 * fetchNegotiatedRates(carrier, input) -> { discountPct 0.10..0.25 (deterministic per account), samples: [{ service, serviceName, platform, own }] }
 * connectCarrierAccount(carrier, { input, verificationToken, discountPct, ratesSource: 'fetched'|'manual', mode? }) -> Account
 * updateCarrierAccount(id, { mode?: 'cheapest'|'always', discountPct? }) -> Account
 * disconnectCarrierAccount(id) -> Account (status 'not_connected'; past shipments keep their own:<id> reference)
 * carrierAccountUsage(id) -> { shipments, shipments30d, carrierCharges, platformFees, estimatedSavings }  (sync)
 *
 * ---------------------------------------------------------------------------
 * API summary: platform carriers (admin)
 * ---------------------------------------------------------------------------
 * ADAPTER_TEMPLATES = ['REST-JSON', 'SOAP-XML', 'CSV-SFTP']
 * ADAPTER_OPS = ['getRates', 'createLabel', 'voidLabel', 'track', 'createManifest']
 * listCarriers() -> [{ ...carrier, serviceCount, shipments30d, apiHealth }]
 * getCarrier(code) -> carrier & { agreement, stats: { shipments30d, shipments90d, onTimeByZone (measured), samples } }
 * sampleCarrierDefinition() -> definition prefilled with 'Veho' (regional, Northeast) for the wizard
 * copyServicesFrom(code) -> services[] (zone tables of an existing carrier, deep copy)
 * parseZoneCsv(text) -> { services: [{ code, name, level, base, perLb, resFee, transitDays }], errors: [{ row, code }] }
 *   CSV columns: service_code, service_name, level, zone, base, per_lb, transit_days, res_fee
 * validateCarrierDefinition(def) -> { valid, errors }
 * addCarrier(def) -> Carrier (status 'testing')             CARRIER_EXISTS when the code is taken
 * updateCarrier(code, patch) -> Carrier
 * testCarrierConnection(code, { onProgress }) -> { passed, results: [{ id, status: 'passed'|'failed', ms, detail: {tr,en} }], ranAt }
 *   4 scenarios: auth, rates, label, tracking (runs on the carrier's own definition)
 * activateCarrier(code) -> Carrier (status 'active'; rate engine picks it up immediately). CARRIER_NOT_TESTED otherwise.
 * setCarrierStatus(code, 'active'|'inactive') -> Carrier
 */
import { toRaw } from 'vue'
import { request, ApiError, runSteps } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { hashSeed, mulberry32 } from '../ai/prng.js'
import { quoteService, round2 } from '@/shared/rateEngine.js'
import { ZONES } from '@/shared/carriers.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()

export const OWN_ACCOUNT_CARRIERS = ['FDX', 'UPS', 'USPS', 'DHLE']
export const ACCOUNT_FIELDS = {
  FDX: [{ id: 'accountNumber', kind: 'digits', length: 9 }, { id: 'billingZip', kind: 'zip' }, { id: 'invoiceNumber', kind: 'digits', length: 9 }, { id: 'invoiceAmount', kind: 'money' }],
  UPS: [{ id: 'accountNumber', kind: 'alnum', length: 6 }, { id: 'billingZip', kind: 'zip' }, { id: 'country', kind: 'country' }],
  USPS: [{ id: 'userId', kind: 'text', min: 6 }],
  DHLE: [{ id: 'pickupAccount', kind: 'digits', min: 7 }, { id: 'clientId', kind: 'text', min: 8 }, { id: 'clientSecret', kind: 'secret', min: 12 }],
}

function accountIdentifier(carrier, input) {
  return String(carrier === 'USPS' ? input.userId : carrier === 'DHLE' ? input.pickupAccount : input.accountNumber ?? '').trim()
}

export function validateAccountInput(carrier, input = {}) {
  const errors = {}
  const fields = ACCOUNT_FIELDS[carrier]
  if (!fields) return { valid: false, errors: { carrier: 'invalid' } }
  for (const f of fields) {
    const v = String(input[f.id] ?? '').trim()
    if (!v) { errors[f.id] = 'required'; continue }
    if (f.kind === 'digits' && (!/^\d+$/.test(v) || (f.length && v.length !== f.length) || (f.min && (v.length < f.min || v.length > 10)))) errors[f.id] = f.length ? 'digits_length' : 'digits'
    if (f.kind === 'alnum' && !new RegExp(`^[A-Za-z0-9]{${f.length}}$`).test(v)) errors[f.id] = 'alnum_length'
    if (f.kind === 'zip' && !/^\d{5}(-\d{4})?$/.test(v)) errors[f.id] = 'zip'
    if (f.kind === 'country' && !/^[A-Za-z]{2}$/.test(v)) errors[f.id] = 'country'
    if (f.kind === 'money' && !(Number(v.replace(/[$,]/g, '')) > 0)) errors[f.id] = 'number'
    if ((f.kind === 'text' || f.kind === 'secret') && f.min && v.length < f.min) errors[f.id] = 'min_length'
    if (f.kind === 'text' && f.id === 'userId' && !/^[A-Za-z0-9_-]{6,20}$/.test(v)) errors[f.id] = 'min_length'
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

function mask(id) { return '••••' + String(id).slice(-2) }

export function carrierAccountUsage(id) {
  const list = db.all('shipments').filter(s => s.account === `own:${id}` && s.status !== 'voided')
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const carrierCharges = round2(list.reduce((s, x) => s + (x.carrierCharge || round2((x.price ?? 0) - (x.pricing?.platformFee ?? 0.05))), 0))
  const platformFees = round2(list.reduce((s, x) => s + (x.pricing?.platformFee ?? 0.05), 0))
  const acc = db.get('carrier_accounts', id)
  const disc = acc?.negotiatedDiscountPct ?? 0
  return {
    shipments: list.length,
    shipments30d: list.filter(s => s.createdAt >= since).length,
    carrierCharges,
    platformFees,
    estimatedSavings: round2(list.reduce((s, x) => s + (x.cost ?? 0) * (1 + 0.14) - (x.carrierCharge || (x.cost ?? 0) * (1 - disc)), 0)),
  }
}

export function listCarrierAccounts() {
  return request('GET /v1/carrier-accounts', () => {
    const carriers = db.all('carriers')
    return OWN_ACCOUNT_CARRIERS.map(code => {
      const acc = db.all('carrier_accounts').find(a => a.carrier === code) ?? { id: `CA-${code}`, carrier: code, status: 'not_connected' }
      const c = carriers.find(x => x.code === code)
      return { ...plain(acc), carrierName: c?.name ?? code, color: c?.color, ink: c?.ink, usage: carrierAccountUsage(acc.id) }
    })
  }, { minMs: 300, maxMs: 600 })
}

const verifications = new Map()

export function verifyCarrierAccount(carrier, input) {
  return request(`POST /v1/carrier-accounts/${carrier}/verify`, () => {
    const v = validateAccountInput(carrier, input)
    if (!v.valid) throw new ApiError('VALIDATION', 'Invalid account details', 422, v.errors)
    const ident = accountIdentifier(carrier, input)
    if (/^0+$/.test(ident)) {
      audit('carrier_account.verify_failed', carrier, mask(ident))
      throw new ApiError('ACCOUNT_VERIFICATION_FAILED', 'Account could not be verified', 422, { [carrier === 'USPS' ? 'userId' : carrier === 'DHLE' ? 'pickupAccount' : 'accountNumber']: 'account_unverified' })
    }
    const token = 'ver_' + Math.random().toString(36).slice(2, 10)
    verifications.set(token, { carrier, ident, at: Date.now() })
    return { verificationToken: token, accountMasked: mask(ident) }
  }, { minMs: 1500, maxMs: 1700 })
}

function discountFor(carrier, ident) {
  const rng = mulberry32(hashSeed(`${carrier}:${ident}`))
  return Math.round((0.1 + rng() * 0.15) * 100) / 100
}

function samplesFor(carrier, discountPct) {
  const c = db.get('carriers', carrier)
  if (!c) return []
  const rc = plain(db.doc('rate_cards'))
  const plan = db.doc('user')?.company?.plan ?? 'enterprise'
  return (c.services ?? []).map(s => {
    const base = { carriers: plain(db.all('carriers')), carrier, service: s.code, hub: 'NJ01', toZip: '60601', pkg: { lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 3 }, residential: true, plan, rateCards: rc }
    const p = quoteService(base)
    const o = quoteService({ ...base, carrierAccount: { id: 'preview', carrier, status: 'connected', negotiatedDiscountPct: discountPct } })
    return p && o ? { service: s.code, serviceName: s.name, platform: p.total, own: o.total } : null
  }).filter(Boolean)
}

export function fetchNegotiatedRates(carrier, input) {
  return request(`GET /v1/carrier-accounts/${carrier}/negotiated-rates`, () => {
    const ident = accountIdentifier(carrier, input ?? {})
    if (!ident) throw new ApiError('VALIDATION', 'Account required', 422)
    const discountPct = discountFor(carrier, ident)
    return { discountPct, samples: samplesFor(carrier, discountPct) }
  }, { minMs: 1100, maxMs: 1500 })
}

export function connectCarrierAccount(carrier, { input, verificationToken, discountPct, ratesSource = 'fetched', mode = 'cheapest' } = {}) {
  return request(`POST /v1/carrier-accounts/${carrier}`, () => {
    const ver = verifications.get(verificationToken)
    if (!ver || ver.carrier !== carrier) throw new ApiError('NOT_VERIFIED', 'Verify the account first', 409)
    const d = Number(discountPct)
    if (!(d >= 0 && d <= 0.6)) throw new ApiError('VALIDATION', 'Discount must be between 0% and 60%', 422, { discountPct: 'range' })
    verifications.delete(verificationToken)
    const at = nowIso()
    const existing = db.all('carrier_accounts').find(a => a.carrier === carrier)
    const record = {
      carrier, status: 'connected', accountNumber: ver.ident, accountMasked: mask(ver.ident),
      billingZip: input?.billingZip ?? null, country: (input?.country ?? 'US').toUpperCase(),
      negotiatedDiscountPct: round2(d), verifiedAt: at, connectedAt: at, mode: mode === 'always' ? 'always' : 'cheapest', ratesSource,
      ...(carrier === 'DHLE' ? { clientId: input?.clientId, clientSecretMasked: '••••' + String(input?.clientSecret ?? '').slice(-4) } : {}),
    }
    let acc
    if (existing) acc = db.update('carrier_accounts', existing.id, { ...record, disconnectedAt: null })
    else acc = db.insert('carrier_accounts', { id: `CA-${carrier}`, ...record }, { prepend: false })
    const name = db.get('carriers', carrier)?.name ?? carrier
    audit('carrier_account.connect', acc.id, `${name} ${acc.accountMasked}`)
    notify({ type: 'success', title: { tr: `${name} hesabınız bağlandı (${acc.accountMasked})`, en: `Your ${name} account is connected (${acc.accountMasked})` }, body: { tr: `Anlaşmalı indirim %${Math.round(d * 100)}. Gönderi oluştururken iki fiyat göreceksiniz.`, en: `Negotiated discount ${Math.round(d * 100)}%. You will see two prices when creating shipments.` }, link: '/integrations/carrier-accounts' })
    return plain(acc)
  }, { minMs: 500, maxMs: 900 })
}

export function updateCarrierAccount(id, patch = {}) {
  return request(`PATCH /v1/carrier-accounts/${id}`, () => {
    const acc = db.get('carrier_accounts', id)
    if (!acc) throw new ApiError('NOT_FOUND', 'Account not found', 404)
    const p = {}
    if (patch.mode) {
      if (!['cheapest', 'always'].includes(patch.mode)) throw new ApiError('VALIDATION', 'Invalid mode', 422, { mode: 'invalid' })
      p.mode = patch.mode
    }
    if (patch.discountPct != null) {
      const d = Number(patch.discountPct)
      if (!(d >= 0 && d <= 0.6)) throw new ApiError('VALIDATION', 'Discount must be between 0% and 60%', 422, { discountPct: 'range' })
      p.negotiatedDiscountPct = round2(d)
      p.ratesSource = 'manual'
    }
    const r = db.update('carrier_accounts', id, p)
    audit('carrier_account.update', id, JSON.stringify(p))
    return plain(r)
  }, { minMs: 250, maxMs: 500 })
}

export function disconnectCarrierAccount(id) {
  return request(`DELETE /v1/carrier-accounts/${id}`, () => {
    const acc = db.get('carrier_accounts', id)
    if (!acc) throw new ApiError('NOT_FOUND', 'Account not found', 404)
    if (acc.status !== 'connected') throw new ApiError('ACCOUNT_NOT_CONNECTED', 'Account is not connected', 409)
    const r = db.update('carrier_accounts', id, { status: 'not_connected', disconnectedAt: nowIso(), previousMasked: acc.accountMasked })
    const name = db.get('carriers', acc.carrier)?.name ?? acc.carrier
    audit('carrier_account.disconnect', id, `${name} ${acc.accountMasked}`)
    notify({ type: 'warning', title: { tr: `${name} hesabı bağlantısı kesildi`, en: `${name} account disconnected` }, link: '/integrations/carrier-accounts' })
    return plain(r)
  }, { minMs: 400, maxMs: 800 })
}

// ---------------------------------------------------------------------------
// Platform carriers
// ---------------------------------------------------------------------------

export const ADAPTER_TEMPLATES = ['REST-JSON', 'SOAP-XML', 'CSV-SFTP']
export const ADAPTER_OPS = ['getRates', 'createLabel', 'voidLabel', 'track', 'createManifest']
const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')

function stats(code) {
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString()
  const since90 = new Date(Date.now() - 90 * 864e5).toISOString()
  const list = db.all('shipments').filter(s => s.carrier === code && !s.test)
  return { shipments30d: list.filter(s => s.createdAt >= since30).length, shipments90d: list.filter(s => s.createdAt >= since90).length, total: list.length }
}

export function listCarriers() {
  return request('GET /v1/admin/carriers', () => db.all('carriers').map(c => ({
    ...plain(c), serviceCount: (c.services ?? []).length, shipments30d: stats(c.code).shipments30d,
  })), { minMs: 300, maxMs: 600 })
}

export function getCarrier(code) {
  return request(`GET /v1/admin/carriers/${code}`, () => {
    const c = db.get('carriers', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Carrier not found', 404)
    const agreement = (db.doc('rate_cards')?.carrierAgreements ?? []).find(a => a.carrier === code) ?? null
    const delivered = db.all('shipments').filter(s => s.carrier === code && s.status === 'delivered' && s.eta && s.deliveredAt)
    const measured = {}
    const samples = {}
    for (const z of ZONES) {
      const zs = delivered.filter(s => s.zone === z)
      samples[z] = zs.length
      measured[z] = zs.length ? round2(zs.filter(s => s.deliveredAt <= s.eta).length / zs.length) : null
    }
    return { ...plain(c), agreement: plain(agreement), stats: { ...stats(code), onTimeByZone: measured, samples } }
  }, { minMs: 300, maxMs: 600 })
}

export function copyServicesFrom(code) {
  const c = db.get('carriers', code)
  return c ? plain(c.services ?? []).map(s => ({ ...s })) : []
}

export function sampleCarrierDefinition() {
  const ne = ['NY', 'NJ', 'PA', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME', 'DE', 'MD', 'DC']
  const z = arr => Object.fromEntries(ZONES.map((zone, i) => [zone, arr[i]]))
  return {
    code: 'VEHO',
    name: 'Veho',
    type: 'regional',
    color: '#1B5E4B',
    ink: '#FFFFFF',
    adapterTemplate: 'REST-JSON',
    credentials: { apiKey: 'veho_sandbox_7f3a91c2', apiSecret: 'sk_sandbox_d81e4b0f6a' },
    coverage: ne,
    originHubs: ['NJ01'],
    poBoxAllowed: false,
    fuelPct: 0.12,
    services: [
      { code: 'NEXT', name: 'Veho Next Day', level: 'express', base: z([6.4, 6.8, 7.3, 7.9, 8.6, 9.4, 10.3]), perLb: z([0.4, 0.5, 0.62, 0.78, 0.95, 1.12, 1.3]), resFee: 0, transitDays: z([1, 1, 1, 2, 2, 2, 3]) },
      { code: 'STD', name: 'Veho Standard', level: 'economy', base: z([5.2, 5.5, 5.9, 6.4, 7.0, 7.7, 8.4]), perLb: z([0.32, 0.4, 0.5, 0.64, 0.78, 0.92, 1.08]), resFee: 0, transitDays: z([2, 2, 2, 3, 3, 4, 4]) },
    ],
  }
}

export function parseZoneCsv(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const errors = []
  const byCode = new Map()
  if (lines.length < 2) return { services: [], errors: [{ row: 0, code: 'empty' }] }
  const head = lines[0].toLowerCase().split(',').map(s => s.trim())
  const idx = k => head.indexOf(k)
  const need = ['service_code', 'zone', 'base', 'per_lb', 'transit_days']
  for (const k of need) if (idx(k) < 0) errors.push({ row: 1, code: 'missing_column', column: k })
  if (errors.length) return { services: [], errors }
  lines.slice(1).forEach((line, i) => {
    const c = line.split(',').map(s => s.trim())
    const row = i + 2
    const code = c[idx('service_code')]
    const zone = Number(c[idx('zone')])
    const base = Number(c[idx('base')])
    const perLb = Number(c[idx('per_lb')])
    const days = Number(c[idx('transit_days')])
    if (!code || !ZONES.includes(zone) || !(base > 0) || !(perLb >= 0) || !(days > 0)) { errors.push({ row, code: 'invalid_row' }); return }
    if (!byCode.has(code)) byCode.set(code, { code, name: (idx('service_name') >= 0 && c[idx('service_name')]) || code, level: (idx('level') >= 0 && c[idx('level')]) || 'standard', base: {}, perLb: {}, resFee: idx('res_fee') >= 0 ? Number(c[idx('res_fee')]) || 0 : 0, transitDays: {} })
    const s = byCode.get(code)
    s.base[zone] = base
    s.perLb[zone] = perLb
    s.transitDays[zone] = days
  })
  const services = [...byCode.values()]
  for (const s of services) for (const z of ZONES) if (s.base[z] == null) errors.push({ row: 0, code: 'missing_zone', service: s.code, zone: z })
  return { services, errors }
}

export function validateCarrierDefinition(def = {}) {
  const errors = {}
  if (!String(def.name ?? '').trim()) errors.name = 'required'
  const code = String(def.code ?? '').trim().toUpperCase()
  if (!code) errors.code = 'required'
  else if (!/^[A-Z0-9]{2,6}$/.test(code)) errors.code = 'carrier_code'
  else if (db.get('carriers', code)) errors.code = 'carrier_exists'
  if (!['domestic', 'regional', 'international'].includes(def.type)) errors.type = 'required'
  if (!ADAPTER_TEMPLATES.includes(def.adapterTemplate)) errors.adapterTemplate = 'required'
  if (!def.credentials || !String(def.credentials.apiKey ?? '').trim()) errors['credentials.apiKey'] = 'required'
  if (def.type === 'regional' && !(def.coverage ?? []).length) errors.coverage = 'required'
  if ((def.coverage ?? []).some(s => !US_STATES.includes(s))) errors.coverage = 'state'
  const services = def.services ?? []
  if (!services.length) errors.services = 'required'
  services.forEach((s, i) => {
    if (!s.code || !s.name) errors[`services.${i}.name`] = 'required'
    for (const z of ZONES) if (!(Number(s.base?.[z]) > 0) || !(Number(s.transitDays?.[z]) > 0)) errors[`services.${i}.zones`] = 'zone_table'
  })
  return { valid: Object.keys(errors).length === 0, errors }
}

export function addCarrier(def) {
  return request('POST /v1/admin/carriers', () => {
    const v = validateCarrierDefinition(def)
    if (!v.valid) throw new ApiError(v.errors.code === 'carrier_exists' ? 'CARRIER_EXISTS' : 'VALIDATION', 'Invalid carrier', 422, v.errors)
    const code = String(def.code).trim().toUpperCase()
    const z = val => Object.fromEntries(ZONES.map(zone => [zone, val]))
    const carrier = {
      code,
      name: String(def.name).trim(),
      type: def.type,
      color: def.color || '#334155',
      ink: def.ink || '#FFFFFF',
      status: 'testing',
      coverage: def.type === 'regional' || (def.coverage ?? []).length ? [...def.coverage] : null,
      ...(def.originHubs?.length ? { originHubs: [...def.originHubs] } : {}),
      poBoxAllowed: !!def.poBoxAllowed,
      fuelPct: Number(def.fuelPct ?? 0.12),
      addressCorrectionFee: Number(def.addressCorrectionFee ?? 15),
      onTimeByZone: def.onTimeByZone ?? z(0.94),
      volumeTiers: def.volumeTiers ?? [{ weeklyVolume: 0, discountPct: 0 }],
      adapterVersion: '1.0.0',
      adapterTemplate: def.adapterTemplate,
      apiHealth: { avgMs: null },
      supportedOps: ['rates', 'label', 'void', 'track', ...(def.type !== 'international' ? ['manifest'] : [])],
      credentialsMasked: { apiKey: '••••' + String(def.credentials.apiKey).slice(-4) },
      services: plain(def.services).map(s => ({
        code: String(s.code).toUpperCase(), name: s.name, level: s.level ?? 'standard',
        base: Object.fromEntries(ZONES.map(zz => [zz, Number(s.base[zz])])),
        perLb: Object.fromEntries(ZONES.map(zz => [zz, Number(s.perLb?.[zz] ?? 0)])),
        resFee: Number(s.resFee ?? 0),
        transitDays: Object.fromEntries(ZONES.map(zz => [zz, Number(s.transitDays[zz])])),
      })),
      connectedSince: null,
      createdAt: nowIso(),
      lastTest: null,
    }
    db.insert('carriers', carrier, { prepend: false })
    audit('carrier.create', code, carrier.name)
    return carrier
  }, { minMs: 500, maxMs: 900 })
}

export function updateCarrier(code, patch) {
  return request(`PATCH /v1/admin/carriers/${code}`, () => {
    const c = db.get('carriers', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Carrier not found', 404)
    const { code: _ignore, status, ...rest } = plain(patch)
    const r = db.update('carriers', code, rest)
    audit('carrier.update', code, Object.keys(rest).join(', '))
    return r
  }, { minMs: 300, maxMs: 600 })
}

const SCENARIOS = [
  { id: 'auth', detail: { tr: 'Kimlik doğrulama ve token alma', en: 'Authentication and token exchange' } },
  { id: 'rates', detail: { tr: 'Fiyat sorgusu (3 zone, 2 ağırlık)', en: 'Rate request (3 zones, 2 weights)' } },
  { id: 'label', detail: { tr: 'Test etiketi oluşturma ve iptal', en: 'Test label create and void' } },
  { id: 'tracking', detail: { tr: 'Takip olayı sorgulama', en: 'Tracking event lookup' } },
]

export function testCarrierConnection(code, { onProgress } = {}) {
  return request(`POST /v1/admin/carriers/${code}/test`, async () => {
    const c = db.get('carriers', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Carrier not found', 404)
    const rng = mulberry32(hashSeed(`test:${code}:${(c.lastTest?.runs ?? 0) + 1}`))
    const results = await runSteps(SCENARIOS.map(sc => async () => {
      let ok = true
      if (sc.id === 'auth') ok = !!(c.credentialsMasked?.apiKey || c.adapterVersion)
      if (sc.id === 'rates') {
        const svc = c.services?.[0]
        const q = svc && quoteService({ carriers: [plain(c)], carrier: plain(c), service: plain(svc), hub: c.originHubs?.[0] ?? 'NJ01', toZip: '10001', pkg: { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: 2 } })
        ok = !!q && q.total > 0
      }
      return { id: sc.id, status: ok ? 'passed' : 'failed', ms: 120 + Math.round(rng() * 380), detail: sc.detail }
    }), onProgress, { stepMs: [350, 650] })
    const passed = results.every(r => r.status === 'passed')
    const ranAt = nowIso()
    db.update('carriers', code, { lastTest: { passed, ranAt, results, runs: (c.lastTest?.runs ?? 0) + 1 }, apiHealth: { avgMs: Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length) } })
    audit('carrier.test', code, passed ? 'passed' : 'failed')
    return { passed, results, ranAt }
  }, { minMs: 200, maxMs: 400 })
}

export function activateCarrier(code) {
  return request(`POST /v1/admin/carriers/${code}/activate`, () => {
    const c = db.get('carriers', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Carrier not found', 404)
    if (c.status !== 'active' && !c.lastTest?.passed) throw new ApiError('CARRIER_NOT_TESTED', 'Run a passing connection test first', 409)
    const r = db.update('carriers', code, { status: 'active', connectedSince: c.connectedSince ?? nowIso() })
    audit('carrier.activate', code, c.name)
    notify({ type: 'success', title: { tr: `Yeni taşıyıcı etkin: ${c.name}`, en: `New carrier active: ${c.name}` }, body: { tr: 'Fiyat karşılaştırmada ve gönderi oluşturmada artık görünür.', en: 'Now available in rate shopping and shipment creation.' }, link: `/admin/carriers/${code}` })
    return plain(r)
  }, { minMs: 400, maxMs: 800 })
}

export function setCarrierStatus(code, status) {
  return request(`PATCH /v1/admin/carriers/${code}/status`, () => {
    const c = db.get('carriers', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Carrier not found', 404)
    if (!['active', 'inactive'].includes(status)) throw new ApiError('VALIDATION', 'Invalid status', 422)
    if (status === 'active' && c.status === 'testing' && !c.lastTest?.passed) throw new ApiError('CARRIER_NOT_TESTED', 'Run a passing connection test first', 409)
    const r = db.update('carriers', code, { status })
    audit(status === 'active' ? 'carrier.activate' : 'carrier.deactivate', code, c.name)
    return plain(r)
  }, { minMs: 300, maxMs: 600 })
}
