#!/usr/bin/env node
// Live check against a running API + real MySQL (complements tests/KargoPazar.RoundTrip,
// which uses SQLite in-memory). It RESETS the shared demo data, so it only runs with --reset.
//
//   node tests/verify-api-roundtrip.mjs --base=http://localhost:5000/api --reset [--tz=Europe/Istanbul]
//
// Steps: login demo/Demo123!, POST /state/reset, GET /state and compare every seed file with
// the seed resolved by db.js's own resolveDates() (same --tz as the API's Seed:TimeZone),
// then a small batch round trip on a scratch collection, then GET /healthz and public endpoints.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return [m[1], m[2] || 'true'] }))
const BASE = (args.base ?? 'http://localhost:5000/api').replace(/\/+$/, '')
const TZ = args.tz ?? 'Europe/Istanbul'
if (!args.reset) { console.error('Refusing to run without --reset (this wipes the shared demo data).'); process.exit(2) }

let failures = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + detail}`); if (!ok) failures++ }
let token = null
async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}
function diff(a, b, p = '$') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return `${p}: type`
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${p}: length ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${p}[${i}]`); if (d) return d }
    return null
  }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    if (ka.join('\u0000') !== kb.join('\u0000')) return `${p}: keys ${ka.slice(0, 8)} vs ${kb.slice(0, 8)}`
    for (const k of ka) { const d = diff(a[k], b[k], `${p}.${k}`); if (d) return d }
    return null
  }
  return Object.is(a, b) ? null : `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
}

const health = await fetch(BASE.replace(/\/api$/, '') + '/healthz').then(r => r.status).catch(() => 0)
check('GET /healthz', health === 200, String(health))

let r = await call('POST', '/auth/login', { identifier: 'demo', password: 'Demo123!' })
if (r.status !== 200) {
  // A previous run may have changed the password; the demo user is reset below anyway.
  console.error(`login failed (${r.status} ${JSON.stringify(r.body)})`); process.exit(1)
}
token = r.body.token
check('login demo/Demo123!', typeof token === 'string' && r.body.user?.username === 'demo' && !('password' in r.body.user))
r = await call('POST', '/auth/login', { identifier: 'demo@kargopazar.com', password: 'wrong' })
check('wrong password -> 401 INVALID_CREDENTIALS', r.status === 401 && r.body?.code === 'INVALID_CREDENTIALS')

r = await call('POST', '/state/reset')
check('POST /state/reset -> 204', r.status === 204, String(r.status))
const now = new Date().toISOString()
const ref = spawnSync(process.execPath, [path.join(here, 'KargoPazar.RoundTrip', 'resolve-seed.mjs'), `--now=${now}`], { env: { ...process.env, TZ }, encoding: 'utf8', maxBuffer: 64 << 20 })
if (ref.status !== 0) { console.error(ref.stderr); process.exit(1) }
const seed = JSON.parse(ref.stdout)
delete seed.user.password

r = await call('GET', '/state')
check('GET /state', r.status === 200 && r.body?.collections, String(r.status))
const cols = r.body.collections
console.log(`  seedVersion ${r.body.seedVersion}, ${Object.keys(cols).length} collections`)
for (const name of Object.keys(seed)) {
  const d = name in cols ? diff(seed[name], cols[name], name) : 'missing'
  check(`round-trip ${name}`, !d, d)
}

// batch round trip on a scratch collection (removed again at the end)
const scratch = '__verify'
r = await call('POST', '/state/batch', { ops: [
  { op: 'upsert', collection: scratch, id: 'A', data: { id: 'A', n: 1.5, z: { b: 1, a: 2 } }, position: 'last' },
  { op: 'upsert', collection: scratch, id: 'B', data: { id: 'B' }, position: 'first' },
] })
check('batch upsert -> { applied: 2 }', r.status === 200 && r.body?.applied === 2, JSON.stringify(r.body))
r = await call('GET', '/state')
check('batch visible in order', JSON.stringify(r.body.collections[scratch]) === '[{"id":"B"},{"id":"A","n":1.5,"z":{"b":1,"a":2}}]', JSON.stringify(r.body.collections[scratch]))
await call('POST', '/state/batch', { ops: [{ op: 'replaceCollection', collection: scratch, data: [] }] })

r = await call('GET', '/public/pricing-config')
check('GET /public/pricing-config', r.status === 200 && Array.isArray(r.body?.carriers) && r.body?.rateCards?.plans != null)
const tn = seed.shipments[0].trackingNo
r = await call('GET', `/public/track?q=${encodeURIComponent(tn + ',NOPE')}`)
check('GET /public/track', r.status === 200 && r.body?.[0]?.found === true && r.body?.[1]?.found === false)

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
