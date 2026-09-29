/**
 * Settings API (spec 8.1-8.6, 8.9, 8.11). Every call goes through request().
 *
 * Profile / company / preferences
 *   getSettings() -> { user, company, preferences, notificationPrefs, twoFactorEnabled, sessions }
 *   updateProfile({ name, email, phone, timezone, lang }) -> user           VALIDATION {field: code}
 *   updateCompany({ name, legalName, taxId, phone, defaultHub, senderAddress }) -> company
 *   updatePreferences({ units, currencyDisplay, dateFormat }) -> preferences
 *   TIMEZONES, NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS, DEFAULT_NOTIFICATION_PREFS
 *   updateNotificationPrefs(prefs) -> prefs   prefs = { <event>: { email: bool, panel: bool } }
 *
 * Box presets (collection box_presets)
 *   listBoxPresets() -> Preset[]            saveBoxPreset(preset) -> Preset (insert when no id)
 *   removeBoxPreset(id) -> { removed }      restoreBoxPreset(preset) -> Preset
 *   setDefaultBoxPreset(id) -> Preset[]
 *
 * Security
 *   passwordStrength(pw) -> { score 0..4, checks: { length, upper, lower, digit, symbol } }   (sync)
 *   startTwoFactor() -> { secret, otpauth, demoCode }        demoCode = code the demo "authenticator" shows
 *   currentTotp(secret) -> '123456'                          (sync, 30 s window)
 *   confirmTwoFactor(secret, code) -> { enabled, recoveryCodes }   INVALID_CODE
 *   disableTwoFactor(password) -> { enabled: false }               WRONG_PASSWORD
 *   revokeSession(id) -> sessions            revokeOtherSessions() -> sessions
 *
 * Audit log
 *   listAuditLog() -> [{ id, at, actorName, actorRole, action, target, summary ({tr,en}|string), source, ip }]
 *
 * Demo data (8.11)
 *   storageInfo() -> { bytes, quotaBytes, seedVersion, collections: [{ name, bytes, records }], stored }  (sync, in-memory data size)
 *   exportState() -> { filename, json }
 *   importState(json) -> { collections }     INVALID_EXPORT | VERSION_MISMATCH
 *   resetDemo() -> { ok }                    caller then sets location.hash = '#/' and reloads
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { verifyPassword } from './auth.js'
import { audit } from '../store/events.js'
import { session } from '../store/session.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

export const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Berlin', 'Europe/Istanbul', 'UTC',
]

export const NOTIFICATION_EVENTS = [
  'address_issue', 'label_created', 'void_refund', 'weight_adjustment', 'low_balance',
  'sync_error', 'tracking_exception', 'forecast', 'pricing', 'manifest', 'team', 'security',
]
export const NOTIFICATION_CHANNELS = ['email', 'panel']
export const DEFAULT_NOTIFICATION_PREFS = Object.fromEntries(NOTIFICATION_EVENTS.map(e => [e, {
  email: ['address_issue', 'weight_adjustment', 'low_balance', 'sync_error', 'tracking_exception', 'security'].includes(e),
  panel: true,
}]))

function vErr(errors) {
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid input', 422, errors)
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function getSettings() {
  return request('GET /v1/settings', () => {
    const u = db.doc('user')
    return {
      user: { name: u.name, email: u.email, phone: u.phone, timezone: u.timezone, username: u.username, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt },
      company: plain(u.company),
      preferences: { currencyDisplay: 'symbol', dateFormat: 'locale', ...plain(u.preferences) },
      notificationPrefs: { ...plain(DEFAULT_NOTIFICATION_PREFS), ...plain(u.notificationPrefs ?? {}) },
      twoFactorEnabled: !!u.twoFactorEnabled,
      twoFactorEnabledAt: u.twoFactorEnabledAt ?? null,
      sessions: plain(u.sessions ?? []),
      passwordChangedAt: u.passwordChangedAt ?? null,
    }
  }, { minMs: 250, maxMs: 500 })
}

export function updateProfile(input) {
  return request('PATCH /v1/me', () => {
    const errors = {}
    const name = String(input.name ?? '').trim()
    const email = String(input.email ?? '').trim()
    if (name.length < 2) errors.name = 'required'
    if (!EMAIL_RE.test(email)) errors.email = 'email'
    if (input.phone && !/^[+\d][\d\s().-]{6,}$/.test(input.phone)) errors.phone = 'invalid'
    if (input.timezone && !TIMEZONES.includes(input.timezone)) errors.timezone = 'invalid'
    vErr(errors)
    const u = db.doc('user')
    const lang = input.lang === 'en' ? 'en' : input.lang === 'tr' ? 'tr' : u.preferences?.lang
    db.patchDoc('user', { name, email, phone: String(input.phone ?? '').trim(), timezone: input.timezone ?? u.timezone, preferences: { ...u.preferences, lang } })
    const member = db.get('team', u.id)
    if (member) {
      const initials = name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()
      db.update('team', u.id, { name, email, initials })
    }
    audit('profile.update', u.id, { tr: 'Profil bilgileri güncellendi', en: 'Profile details updated' })
    return { name, email, phone: db.doc('user').phone, timezone: db.doc('user').timezone, lang }
  })
}

export function updateCompany(input) {
  return request('PATCH /v1/company', () => {
    const errors = {}
    if (String(input.name ?? '').trim().length < 2) errors.name = 'required'
    if (String(input.legalName ?? '').trim().length < 2) errors.legalName = 'required'
    if (!/^\d{2}-\d{7}$/.test(String(input.taxId ?? '').trim())) errors.taxId = 'tax_id'
    if (!['NJ01', 'LA01'].includes(input.defaultHub)) errors.defaultHub = 'required'
    const a = input.senderAddress ?? {}
    for (const k of ['line1', 'city', 'state', 'zip']) if (!String(a[k] ?? '').trim()) errors['senderAddress.' + k] = 'required'
    if (a.zip && !/^\d{5}(-\d{4})?$/.test(a.zip)) errors['senderAddress.zip'] = 'zip'
    vErr(errors)
    const u = db.doc('user')
    const company = {
      ...u.company,
      name: input.name.trim(), legalName: input.legalName.trim(), taxId: input.taxId.trim(),
      phone: String(input.phone ?? '').trim(), defaultHub: input.defaultHub,
      senderAddress: { ...plain(a), country: 'US' },
    }
    db.patchDoc('user', { company })
    const cus = db.get('customers', u.customerId)
    if (cus) db.update('customers', cus.id, { name: company.name, hub: company.defaultHub })
    audit('company.update', u.customerId, { tr: 'Şirket bilgileri güncellendi', en: 'Company details updated' })
    return plain(company)
  })
}

export function updatePreferences(input) {
  return request('PATCH /v1/me/preferences', () => {
    const errors = {}
    if (input.units && !['imperial', 'metric'].includes(input.units)) errors.units = 'invalid'
    if (input.currencyDisplay && !['symbol', 'code'].includes(input.currencyDisplay)) errors.currencyDisplay = 'invalid'
    if (input.dateFormat && !['locale', 'iso', 'us', 'eu'].includes(input.dateFormat)) errors.dateFormat = 'invalid'
    vErr(errors)
    const u = db.doc('user')
    const preferences = { ...u.preferences, ...plain(input) }
    db.patchDoc('user', { preferences })
    audit('preferences.update', u.id, { tr: 'Birim ve biçim tercihleri güncellendi', en: 'Units and format preferences updated' })
    return plain(preferences)
  }, { minMs: 250, maxMs: 500 })
}

export function updateNotificationPrefs(prefs) {
  return request('PUT /v1/me/notification-preferences', () => {
    const clean = {}
    for (const e of NOTIFICATION_EVENTS) clean[e] = { email: !!prefs?.[e]?.email, panel: !!prefs?.[e]?.panel }
    db.patchDoc('user', { notificationPrefs: clean })
    audit('notifications.preferences', db.doc('user').id, { tr: 'Bildirim tercihleri güncellendi', en: 'Notification preferences updated' })
    return clean
  }, { minMs: 250, maxMs: 500 })
}

// ---------------------------------------------------------------------------
// Box presets
// ---------------------------------------------------------------------------
function sortedPresets() { return [...db.all('box_presets')] }

export function listBoxPresets() {
  return request('GET /v1/box-presets', () => sortedPresets(), { minMs: 250, maxMs: 500 })
}

function validatePreset(p) {
  const errors = {}
  const name = typeof p.name === 'string' ? p.name : (p.name?.tr || p.name?.en || '')
  if (!String(name).trim()) errors.name = 'required'
  for (const k of ['lengthIn', 'widthIn', 'heightIn']) {
    const v = Number(p[k])
    if (!(v > 0)) errors[k] = 'positive'
    else if (v > 108) errors[k] = 'max_dim'
  }
  if (p.tareLb != null && p.tareLb !== '' && !(Number(p.tareLb) >= 0)) errors.tareLb = 'number'
  if (!['box', 'poly', 'envelope', 'tube'].includes(p.type)) errors.type = 'required'
  vErr(errors)
}

export function saveBoxPreset(input) {
  return request(input.id ? `PUT /v1/box-presets/${input.id}` : 'POST /v1/box-presets', () => {
    validatePreset(input)
    const name = typeof input.name === 'string' ? { tr: input.name.trim(), en: input.name.trim() } : input.name
    const rec = {
      name, type: input.type,
      lengthIn: Number(input.lengthIn), widthIn: Number(input.widthIn), heightIn: Number(input.heightIn),
      tareLb: Number(input.tareLb || 0),
    }
    if (input.id && db.get('box_presets', input.id)) {
      const r = db.update('box_presets', input.id, rec)
      audit('box_preset.update', input.id, name)
      return r
    }
    let n = db.all('box_presets').length + 1
    while (db.get('box_presets', `BOX-${n}`)) n++
    const r = db.insert('box_presets', { id: `BOX-${n}`, ...rec, isDefault: false }, { prepend: false })
    audit('box_preset.create', r.id, name)
    return r
  })
}

export function removeBoxPreset(id) {
  return request(`DELETE /v1/box-presets/${id}`, () => {
    const index = db.all('box_presets').findIndex(p => p.id === id)
    const r = db.remove('box_presets', id)
    if (!r) throw new ApiError('NOT_FOUND', 'Preset not found', 404)
    if (r.isDefault && db.all('box_presets').length) db.update('box_presets', db.all('box_presets')[0].id, { isDefault: true })
    audit('box_preset.delete', id, r.name)
    return { removed: r, index }
  })
}

export function restoreBoxPreset(preset, index = null) {
  return request('POST /v1/box-presets', () => {
    if (!db.get('box_presets', preset.id)) {
      if (preset.isDefault) db.all('box_presets').forEach(p => p.isDefault && db.update('box_presets', p.id, { isDefault: false }))
      const arr = db.all('box_presets')
      if (index != null && index >= 0 && index < arr.length) { arr.splice(index, 0, plain(preset)); db.touch('box_presets') }
      else db.insert('box_presets', plain(preset), { prepend: false })
    }
    audit('box_preset.restore', preset.id, preset.name)
    return db.get('box_presets', preset.id)
  }, { minMs: 150, maxMs: 300 })
}

export function setDefaultBoxPreset(id) {
  return request(`POST /v1/box-presets/${id}/default`, async () => {
    if (!db.get('box_presets', id)) throw new ApiError('NOT_FOUND', 'Preset not found', 404)
    await db.transaction(() => {
      for (const p of db.all('box_presets')) db.update('box_presets', p.id, { isDefault: p.id === id })
    })
    audit('box_preset.default', id, db.get('box_presets', id).name)
    return sortedPresets()
  }, { minMs: 200, maxMs: 400 })
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------
export function passwordStrength(pw = '') {
  const checks = {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  }
  let score = Object.values(checks).filter(Boolean).length - 1
  if (pw.length >= 12 && score >= 3) score += 1
  if (!checks.length) score = Math.min(score, 1)
  return { score: Math.max(0, Math.min(4, score)), checks }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function hash32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15
  return h >>> 0
}

/** Demo TOTP: deterministic 6-digit code per secret and 30 second window. */
export function currentTotp(secret, offset = 0) {
  const win = Math.floor(Date.now() / 30000) + offset
  return String(hash32(`${secret}:${win}`) % 1000000).padStart(6, '0')
}

export function startTwoFactor() {
  return request('POST /v1/me/2fa/setup', () => {
    let secret = ''
    for (let i = 0; i < 16; i++) secret += B32[Math.floor(Math.random() * 32)]
    const u = db.doc('user')
    const label = encodeURIComponent(`KargoPazar:${u.email}`)
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=KargoPazar&digits=6&period=30`
    return { secret, otpauth, demoCode: currentTotp(secret) }
  }, { minMs: 300, maxMs: 600 })
}

export function confirmTwoFactor(secret, code) {
  return request('POST /v1/me/2fa/verify', () => {
    const c = String(code ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(c)) throw new ApiError('INVALID_CODE', 'Code must be 6 digits', 422)
    if (![currentTotp(secret), currentTotp(secret, -1)].includes(c)) throw new ApiError('INVALID_CODE', 'Invalid code', 422)
    const recoveryCodes = Array.from({ length: 8 }, (_, i) => {
      const h = hash32(`${secret}:rc:${i}`).toString(36).toUpperCase().padStart(8, '0').slice(0, 8)
      return `${h.slice(0, 4)}-${h.slice(4, 8)}`
    })
    db.patchDoc('user', { twoFactorEnabled: true, twoFactorEnabledAt: new Date().toISOString(), twoFactorSecretMasked: '••••' + secret.slice(-4) })
    audit('security.2fa_enable', db.doc('user').id, { tr: 'İki adımlı doğrulama açıldı', en: 'Two-step verification enabled' })
    return { enabled: true, recoveryCodes }
  }, { minMs: 400, maxMs: 700 })
}

export function disableTwoFactor(password) {
  return request('POST /v1/me/2fa/disable', async () => {
    await verifyPassword(password)
    const u = db.doc('user')
    db.patchDoc('user', { twoFactorEnabled: false, twoFactorEnabledAt: null, twoFactorSecretMasked: null })
    audit('security.2fa_disable', u.id, { tr: 'İki adımlı doğrulama kapatıldı', en: 'Two-step verification disabled' })
    return { enabled: false }
  }, { minMs: 400, maxMs: 700 })
}

export function revokeSession(id) {
  return request(`DELETE /v1/me/sessions/${id}`, () => {
    const u = db.doc('user')
    const s = (u.sessions ?? []).find(x => x.id === id)
    if (!s) throw new ApiError('NOT_FOUND', 'Session not found', 404)
    if (s.current) throw new ApiError('CURRENT_SESSION', 'Cannot revoke the current session', 409)
    db.patchDoc('user', { sessions: u.sessions.filter(x => x.id !== id) })
    audit('security.session_revoke', id, { tr: `Oturum kapatıldı: ${s.device}`, en: `Session signed out: ${s.device}` })
    return plain(db.doc('user').sessions)
  })
}

export function revokeOtherSessions() {
  return request('DELETE /v1/me/sessions', () => {
    const u = db.doc('user')
    const n = (u.sessions ?? []).filter(x => !x.current).length
    db.patchDoc('user', { sessions: (u.sessions ?? []).filter(x => x.current) })
    audit('security.session_revoke_all', u.id, { tr: `${n} oturum kapatıldı`, en: `${n} sessions signed out` })
    return plain(db.doc('user').sessions)
  })
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
function normAudit(a) {
  const actor = a.actor
  const actorName = typeof actor === 'string' ? actor : actor?.name ?? 'system'
  const actorRole = typeof actor === 'object' && actor ? actor.role : a.role
  const target = typeof a.target === 'object' && a.target ? a.target.id : a.target
  let summary = a.summary ?? a.detail ?? null
  if (summary && typeof summary === 'object' && !('tr' in summary) && !('en' in summary)) summary = JSON.stringify(summary)
  return { id: a.id, at: a.at, actorName, actorRole: actorRole ?? null, action: a.action, target: target ?? null, summary, source: a.source ?? 'panel', ip: a.ip ?? null }
}

export function listAuditLog() {
  return request('GET /v1/audit-log', () => db.all('audit_log').map(normAudit).sort((a, b) => String(b.at).localeCompare(String(a.at))), { minMs: 300, maxMs: 600 })
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------
export function storageInfo() {
  const collections = db.collectionSizes().sort((a, b) => b.bytes - a.bytes)
  const bytes = collections.reduce((a, c) => a + c.bytes, 0)
  return { bytes, quotaBytes: 64 * 1024 * 1024, seedVersion: db.seedVersion, collections, stored: collections.length, seedCollections: db.seedNames.length }
}

export function exportState() {
  return request('GET /v1/demo/export', async () => {
    const d = new Date()
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    audit('demo.export', null, { tr: 'Demo durumu dışa aktarıldı', en: 'Demo state exported' })
    return { filename: `kargopazar-demo-${ymd}.json`, json: await db.export() }
  }, { minMs: 300, maxMs: 600 })
}

export function importState(json) {
  return request('POST /v1/demo/import', async () => {
    let parsed
    try { parsed = typeof json === 'string' ? JSON.parse(json) : json } catch { throw new ApiError('INVALID_EXPORT', 'Invalid JSON', 422) }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.data !== 'object' || !parsed.data) throw new ApiError('INVALID_EXPORT', 'Invalid export', 422)
    if ((parsed.version ?? parsed.seedVersion) !== db.seedVersion) throw new ApiError('VERSION_MISMATCH', 'Seed version mismatch', 409, { version: parsed.version, expected: db.seedVersion })
    if (!parsed.data.user || typeof parsed.data.user !== 'object') throw new ApiError('INVALID_EXPORT', 'Missing user', 422)
    const n = Object.keys(parsed.data).length
    await db.import(parsed)
    audit('demo.import', null, { tr: `Demo durumu içe aktarıldı (${n} koleksiyon)`, en: `Demo state imported (${n} collections)` })
    return { collections: n, exportedAt: parsed.exportedAt ?? null }
  }, { minMs: 500, maxMs: 900 })
}

export function resetDemo() {
  return request('POST /v1/demo/reset', async () => {
    await db.reset()
    return { ok: true, user: session.username }
  }, { minMs: 400, maxMs: 700 })
}
