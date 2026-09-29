/**
 * API keys and the request log (spec 7.5).
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * API_SCOPES = ['orders:read', 'orders:write', 'shipments:write', 'rates:read', 'tracking:read', 'webhooks:manage']
 * listApiKeys({ includeRevoked = true }) -> ApiKey[]  (active first, newest first)
 *   ApiKey = { id, name, env: 'live'|'test', prefix, last4, masked, scopes[], createdAt, lastUsedAt, createdBy,
 *              status: 'active'|'revoked', revokedAt? }
 * createApiKey({ name, env, scopes }) -> { key: ApiKey, secret }   secret is the full key, returned ONCE (never stored)
 *   errors: VALIDATION { name: 'required'|'min_length', scopes: 'required', env: 'invalid' }
 * revokeApiKey(id) -> ApiKey (status 'revoked')    errors: NOT_FOUND, KEY_REVOKED
 * touchApiKey(id) -> void                            (sync) marks lastUsedAt, used by the API console
 * isTestKey(keyOrPrefix) -> boolean                  (sync)
 *
 * listRequestLog({ source?, q?, status?: 'ok'|'error', limit? }) -> LogEntry[] newest first
 *   LogEntry = { id, at, method, path, status, ms, source: 'panel'|'api'|'webhook', keyPrefix?, historical? }
 *   Merges the live requestLog collection with history derived from the seed: API-channel orders
 *   (POST /v1/orders) and shipments (POST /v1/shipments) and outbound webhook deliveries.
 * requestLogEntries(params) -> same as listRequestLog, sync + reactive (no log entry)
 * requestLogStats() -> { total, bySource: {panel, api, webhook}, errors, p50, p95 }   (sync, live log only)
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { session } from '../store/session.js'
import { nextFormattedId } from './integrations.js'
import { hashSeed, mulberry32, randInt } from '../ai/prng.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()

export const API_SCOPES = ['orders:read', 'orders:write', 'shipments:write', 'rates:read', 'tracking:read', 'webhooks:manage']
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function randomToken(n) {
  const buf = new Uint32Array(n)
  try { crypto.getRandomValues(buf) } catch { for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 1e9) }
  let s = ''
  for (let i = 0; i < n; i++) s += CHARS[buf[i] % CHARS.length]
  return s
}

export function isTestKey(k) {
  const p = typeof k === 'string' ? k : k?.prefix ?? ''
  return String(p).startsWith('kp_test_')
}

export function listApiKeys({ includeRevoked = true } = {}) {
  return request('GET /v1/api-keys', () => {
    let list = db.all('api_keys')
    if (!includeRevoked) list = list.filter(k => k.status !== 'revoked')
    return [...list].sort((a, b) => (a.status === b.status ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.status === 'active' ? -1 : 1))
  }, { minMs: 250, maxMs: 500 })
}

export function createApiKey({ name, env = 'live', scopes = [] } = {}) {
  return request('POST /v1/api-keys', () => {
    const errors = {}
    const nm = String(name ?? '').trim()
    if (!nm) errors.name = 'required'
    else if (nm.length < 3) errors.name = 'min_length'
    if (!['live', 'test'].includes(env)) errors.env = 'invalid'
    const sc = [...new Set(scopes)].filter(s => API_SCOPES.includes(s))
    if (!sc.length) errors.scopes = 'required'
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid API key', 422, errors)
    const secret = `kp_${env}_${randomToken(32)}`
    const prefix = secret.slice(0, env === 'live' ? 12 : 12)
    const last4 = secret.slice(-4)
    const key = {
      id: nextFormattedId('KEY'),
      name: nm,
      env,
      prefix,
      last4,
      masked: `${prefix}${'•'.repeat(16)}${last4}`,
      scopes: sc,
      createdAt: nowIso(),
      lastUsedAt: null,
      createdBy: session.user?.name ?? db.doc('user')?.name ?? null,
      status: 'active',
    }
    db.insert('api_keys', key)
    audit('api_key.create', key.id, `${key.name} (${env})`)
    notify({ type: 'info', title: { tr: `Yeni API anahtarı oluşturuldu: ${key.name}`, en: `New API key created: ${key.name}` }, body: { tr: `${key.prefix}… · ${sc.length} kapsam`, en: `${key.prefix}… · ${sc.length} scopes` }, link: '/integrations/api' })
    return { key: plain(key), secret }
  }, { minMs: 500, maxMs: 900 })
}

export function revokeApiKey(id) {
  return request(`DELETE /v1/api-keys/${id}`, () => {
    const k = db.get('api_keys', id)
    if (!k) throw new ApiError('NOT_FOUND', 'API key not found', 404)
    if (k.status === 'revoked') throw new ApiError('KEY_REVOKED', 'API key already revoked', 409)
    const r = db.update('api_keys', id, { status: 'revoked', revokedAt: nowIso() })
    audit('api_key.revoke', id, k.name)
    notify({ type: 'warning', title: { tr: `API anahtarı iptal edildi: ${k.name}`, en: `API key revoked: ${k.name}` }, link: '/integrations/api' })
    return plain(r)
  }, { minMs: 400, maxMs: 800 })
}

export function touchApiKey(id) {
  if (db.get('api_keys', id)) db.update('api_keys', id, { lastUsedAt: nowIso() })
}

// ---------------------------------------------------------------------------
// Request log
// ---------------------------------------------------------------------------

function historicalEntries() {
  const out = []
  const liveKey = db.all('api_keys').find(k => k.env === 'live')
  const keyPrefix = liveKey?.prefix ?? null
  for (const o of db.all('orders')) {
    if (o.channel !== 'api' || !o.createdAt) continue
    const rng = mulberry32(hashSeed('ord:' + o.id))
    out.push({ id: 'h-' + o.id, at: o.createdAt, method: 'POST', path: '/v1/orders', status: 200, ms: randInt(rng, 140, 420), source: 'api', keyPrefix, historical: true, ref: o.id })
  }
  for (const s of db.all('shipments')) {
    if (s.channel !== 'api' || !s.createdAt || s.source === 'api') continue
    const rng = mulberry32(hashSeed('shp:' + s.id))
    const at = s.createdAt
    const before = new Date(new Date(at).getTime() - randInt(rng, 4, 40) * 1000).toISOString()
    out.push({ id: 'h-r-' + s.id, at: before, method: 'POST', path: '/v1/rates', status: 200, ms: randInt(rng, 180, 520), source: 'api', keyPrefix, historical: true })
    out.push({ id: 'h-' + s.id, at, method: 'POST', path: '/v1/shipments', status: 200, ms: randInt(rng, 520, 1100), source: 'api', keyPrefix, historical: true, ref: s.id })
  }
  const wh = db.doc('webhooks') ?? {}
  const eps = wh.endpoints ?? []
  for (const d of wh.deliveries ?? []) {
    const ep = eps.find(e => e.id === d.endpointId)
    let path = ep?.url ?? d.endpointId
    try { const u = new URL(ep.url); path = u.host + u.pathname } catch {}
    out.push({ id: 'h-' + d.id, at: d.at, method: 'POST', path, status: d.status, ms: d.durationMs ?? 0, source: 'webhook', historical: true, event: d.event, ref: d.id })
  }
  return out
}

/** Same data as listRequestLog, synchronous and reactive (for the live view; no extra log entry). */
export function requestLogEntries(p = {}) {
  const live = db.all('requestLog').map(r => ({ ...r }))
  let list = [...live, ...historicalEntries()]
  if (p.source) {
    const src = Array.isArray(p.source) ? p.source : [p.source]
    if (src.length) list = list.filter(r => src.includes(r.source))
  }
  if (p.status === 'ok') list = list.filter(r => r.status < 400)
  if (p.status === 'error') list = list.filter(r => r.status >= 400)
  if (p.q) {
    const q = String(p.q).toLowerCase()
    list = list.filter(r => `${r.method} ${r.path} ${r.status} ${r.event ?? ''}`.toLowerCase().includes(q))
  }
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return p.limit ? list.slice(0, p.limit) : list
}

export function listRequestLog(p = {}) {
  return request('GET /v1/request-log', () => requestLogEntries(p), { minMs: 200, maxMs: 450 })
}

export function requestLogStats() {
  const live = db.all('requestLog')
  const bySource = { panel: 0, api: 0, webhook: 0 }
  for (const r of live) bySource[r.source] = (bySource[r.source] ?? 0) + 1
  const ms = live.map(r => r.ms).sort((a, b) => a - b)
  const q = f => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * f))] : 0)
  return { total: live.length, bySource, errors: live.filter(r => r.status >= 400).length, p50: q(0.5), p95: q(0.95) }
}
