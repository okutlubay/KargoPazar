#!/usr/bin/env node
// Generates database/002_SeedData.sql from the single seed source
// frontend/src/app/data/seed/*.json, using the collection registry
// backend/Data/collections.json (same file the API embeds).
//
//   node database/generate-seed-sql.mjs [--now=2026-10-01T09:00:00Z] [--tz=Europe/Istanbul] [--out=path]
//
// Relative dates ({ daysAgo, hour, minute }) are resolved at generation time exactly like
// resolveDates() in frontend/src/app/store/db.js (calendar day minus daysAgo, local
// hour:minute in --tz, default 09:00). Output is deterministic for a fixed --now.
// Rows match database/001_InitialSchema.sql and the API's own decomposition
// (StateMapper.cs): full record text in `data`, derived typed columns, sort_order = index.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const SEED_DIR = path.join(root, 'frontend', 'src', 'app', 'data', 'seed')
const REGISTRY = path.join(root, 'backend', 'Data', 'collections.json')
const APPSETTINGS = path.join(root, 'backend', 'appsettings.json')

// BCrypt (work factor 11) of the demo password Demo123!, generated once with BCrypt.Net-Next.
// The API re-hashes on "Demo verisini sifirla" (POST /api/state/reset).
const DEMO_PASSWORD_HASH = '$2a$11$AsnPIq4Lw0IwFtQcIZngPOCPtaN2OkVoWZAK1rwcfjsPgaZdu4zYO'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=(.*)$/.exec(a)
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true']
}))
const NOW = args.now ? Date.parse(args.now) : Date.now()
if (Number.isNaN(NOW)) throw new Error(`Invalid --now: ${args.now}`)
const appsettings = JSON.parse(fs.readFileSync(APPSETTINGS, 'utf8'))
const TZ = args.tz ?? appsettings.Seed?.TimeZone ?? 'Europe/Istanbul'
const SEED_VERSION = appsettings.Seed?.Version ?? '2026.10.2'
const OUT = path.resolve(args.out ?? path.join(here, '002_SeedData.sql'))
const MAX_KEY = 64

// ── Relative dates (db.js semantics, time zone explicit) ────────────────────
const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})
function wallParts(ms) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}
function offsetAt(ms) { // tz offset in ms at UTC instant ms
  const w = wallParts(ms)
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000
}
function wallToUtc(wallMs) { // wall clock (as if UTC) -> UTC instant
  let utc = wallMs - offsetAt(wallMs)
  const o2 = offsetAt(utc)
  if (wallMs - o2 !== utc) utc = wallMs - o2
  return utc
}
function isRelDate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.daysAgo !== 'number') return false
  return Object.keys(v).every(k => k === 'daysAgo' || k === 'hour' || k === 'minute')
}
function toIso(v) {
  const w = wallParts(NOW)
  const wall = Date.UTC(w.y, w.mo - 1, w.d - Math.trunc(v.daysAgo), 0, 0, 0, 0)
    + (v.hour ?? 9) * 3600000 + (v.minute ?? 0) * 60000
  return new Date(wallToUtc(wall)).toISOString()
}
function resolveDates(value) {
  if (Array.isArray(value)) return value.map(resolveDates)
  if (value && typeof value === 'object') {
    if (isRelDate(value)) return toIso(value)
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveDates(v)
    return out
  }
  return value
}

// ── Typed values (StateMapper.Convert semantics) ────────────────────────────
function get(rec, pathParts) {
  let cur = rec
  for (const p of pathParts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !(p in cur)) return undefined
    cur = cur[p]
  }
  return cur
}
function toStr(v, len) {
  let s = null
  if (typeof v === 'string') s = v
  else if (typeof v === 'number') s = JSON.stringify(v)
  else if (typeof v === 'boolean') s = v ? 'true' : 'false'
  if (s !== null && len > 0 && s.length > len) s = s.slice(0, len)
  return s
}
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
function toDate(v) {
  if (typeof v !== 'string' || v.length < 10 || !ISO_RE.test(v)) return null
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(v) && v.length > 10
  const ms = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : hasZone ? v : `${v.replace(' ', 'T')}Z`)
  if (Number.isNaN(ms)) return null
  const y = new Date(ms).getUTCFullYear()
  if (y < 1000 || y > 9999) return null
  return { datetime: new Date(ms).toISOString().replace('T', ' ').replace('Z', '') }
}
function convert(v, type) {
  const [kind, arg] = type.split(':')
  switch (kind) {
    case 'string': return toStr(v, +arg)
    case 'int': return typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? v : null
    case 'double': return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'bool': return typeof v === 'boolean' ? v : null
    case 'datetime': return toDate(v)
    case 'decimal': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null
      const [p, s] = arg.split(',').map(Number)
      const limit = 10 ** (p - s)
      // MySQL rounds half away from zero into DECIMAL(p,s), like the API (MidpointRounding.AwayFromZero).
      const r = Math.round(Math.abs(v) * 10 ** s) / 10 ** s
      return r < limit ? { decimal: JSON.stringify(v) } : null
    }
    default: throw new Error(`unknown column type ${type}`)
  }
}

function keyOf(rec, keyField) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
  const fields = keyField == null || keyField === 'id' || keyField === 'code' ? ['id', 'code'] : [keyField, 'id', 'code']
  for (const f of fields) {
    if (f in rec) {
      const v = rec[f]
      if (typeof v === 'string') return v
      if (typeof v === 'number') return JSON.stringify(v)
    }
  }
  return null
}
function uniqueKeys(keys) {
  const seen = new Set()
  return keys.map((k, i) => {
    let key = typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY ? k : `#${i}`
    if (seen.has(key)) { key = `${key.length > 40 ? key.slice(0, 40) : key}#dup${i}`; console.warn(`duplicate key -> ${key}`) }
    seen.add(key)
    return key
  })
}

// ── SQL helpers ─────────────────────────────────────────────────────────────
function sqlStr(s) {
  return "'" + s.replace(/[\\'\0\n\r\x1a]/g, c => ({ '\\': '\\\\', "'": "\\'", '\0': '\\0', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z' })[c]) + "'"
}
function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'string') return sqlStr(v)
  if (typeof v === 'number') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v.datetime) return sqlStr(v.datetime)
  if (v.decimal) return v.decimal
  throw new Error(`cannot encode ${JSON.stringify(v)}`)
}
const out = []
function insert(table, columns, rows, chunk = 100) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk)
    out.push(`INSERT INTO \`${table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES\n`
      + part.map(r => `(${r.map(sqlVal).join(', ')})`).join(',\n') + ';')
  }
}

// ── Load ────────────────────────────────────────────────────────────────────
const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
const knownDocs = new Set(['user', 'wallet', ...registry.documents])
const seedNames = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
const seed = {}
for (const n of seedNames) seed[n] = resolveDates(JSON.parse(fs.readFileSync(path.join(SEED_DIR, `${n}.json`), 'utf8')))

const nowIso = new Date(NOW).toISOString()
out.push(`-- =============================================================================
-- KargoPazar - 002_SeedData.sql  (GENERATED by database/generate-seed-sql.mjs, do not edit)
-- seed-now: ${nowIso}
-- seed-tz: ${TZ}
-- seed-version: ${SEED_VERSION}
-- source: frontend/src/app/data/seed/*.json (${seedNames.length} files)
--
-- OPTIONAL: the API seeds an empty database (no users) by itself at startup, and
-- "Demo verisini sifirla" (POST /api/state/reset) re-seeds with fresh dates. Dates in
-- this file are frozen at seed-now. Replaces all demo data (leads are kept).
-- Demo login: demo / Demo123!
-- =============================================================================

SET NAMES utf8mb4;
USE \`kargopazar\`;
START TRANSACTION;
`)

const collectionTables = Object.keys(registry.collections)
for (const t of [...collectionTables, 'wallet_transactions', 'wallets', 'users', 'companies', 'app_records', 'app_documents', 'app_meta'])
  out.push(`DELETE FROM \`${t}\`;`)
out.push('')

// user + company
let companyId = null
if (seed.user && typeof seed.user === 'object' && !Array.isArray(seed.user)) {
  const u = seed.user
  const profile = { ...u }
  delete profile.password
  const company = u.company && typeof u.company === 'object' && !Array.isArray(u.company) ? u.company : null
  if (company) profile.company = null
  const username = toStr(u.username, 64) || 'demo'
  const email = toStr(u.email, 190) || `${username}@kargopazar.com`
  companyId = toStr(u.customerId, 64) ?? 'CMP-001'
  if (company) {
    insert('companies', ['id', 'name', 'legal_name', 'tax_id', 'phone', 'plan', 'default_hub', 'data'], [[
      companyId, toStr(company.name, 160), toStr(company.legalName, 160), toStr(company.taxId, 32),
      toStr(company.phone, 40), toStr(company.plan, 32), toStr(company.defaultHub, 16), JSON.stringify(company),
    ]])
  }
  insert('users', ['id', 'username', 'email', 'password_hash', 'name', 'role', 'company_id', 'created_at', 'profile'], [[
    typeof u.id === 'string' ? u.id : 'USR-001', username, email, DEMO_PASSWORD_HASH,
    toStr(u.name, 160), toStr(u.role, 32), companyId, toDate(u.createdAt), JSON.stringify(profile),
  ]])
}

// wallet + transactions
if (seed.wallet && typeof seed.wallet === 'object' && !Array.isArray(seed.wallet)) {
  const w = seed.wallet
  const data = { ...w }
  const txs = Array.isArray(w.transactions) ? w.transactions : []
  if (Array.isArray(w.transactions)) data.transactions = null
  insert('wallets', ['id', 'company_id', 'balance', 'currency', 'data'], [[
    'WAL-001', companyId, convert(w.balance, 'decimal:12,2'), toStr(w.currency, 8), JSON.stringify(data),
  ]])
  const keys = uniqueKeys(txs.map((t, i) => keyOf(t, 'id') ?? `#${i}`))
  insert('wallet_transactions', ['id', 'wallet_id', 'type', 'status', 'amount', 'balance_after', 'shipment_id', 'created_at', 'sort_order', 'data'],
    txs.map((t, i) => [keys[i], 'WAL-001', toStr(t.type, 32), toStr(t.status, 32), convert(t.amount, 'decimal:12,2'),
      convert(t.balanceAfter, 'decimal:12,2'), toStr(t.shipmentId, 64), toDate(t.at), i, JSON.stringify(t)]))
}

// collection tables, documents, records
const docs = []
const records = []
for (const name of seedNames) {
  if (name === 'user' || name === 'wallet') continue
  const value = seed[name]
  const def = registry.collections[name]
  if (def) {
    if (!Array.isArray(value)) { console.warn(`skip ${name}: expected array`); continue }
    const keyCol = def.key ?? 'seq'
    const keys = def.key ? uniqueKeys(value.map(r => keyOf(r, def.key))) : value.map((_, i) => i)
    const cols = [keyCol, 'sort_order', ...def.columns.map(c => c.name), 'data', 'created_at']
    insert(name, cols, value.map((r, i) => [
      keys[i], i, ...def.columns.map(c => convert(get(r, c.path.split('.')), c.type)),
      JSON.stringify(r), def.createdAt ? toDate(get(r, def.createdAt.split('.'))) : null,
    ]))
  } else if (Array.isArray(value) && !knownDocs.has(name)) {
    const keys = uniqueKeys(value.map(r => keyOf(r, null)))
    value.forEach((r, i) => records.push([name, keys[i], i, JSON.stringify(r)]))
  } else {
    docs.push([name, JSON.stringify(value)])
  }
}
insert('app_documents', ['name', 'data'], docs, 1)
if (records.length) insert('app_records', ['collection', 'id', 'sort_order', 'data'], records)
insert('app_meta', ['name', 'value'], [['seed_version', SEED_VERSION], ['seeded_at', nowIso]])

out.push('\nCOMMIT;\n')
fs.writeFileSync(OUT, out.join('\n'), 'utf8')
console.log(`wrote ${path.relative(root, OUT)} (${seedNames.length} seed files, now=${nowIso}, tz=${TZ})`)
