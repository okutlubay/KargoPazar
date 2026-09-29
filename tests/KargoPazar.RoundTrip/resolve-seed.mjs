// Reference resolver for the round-trip test: loads the seed files and resolves relative
// dates with the *actual* isRelDate/toIso/resolveDates source extracted from
// frontend/src/app/store/db.js (run with TZ=<zone> so Date uses the same local zone as the API).
//   TZ=Europe/Istanbul node resolve-seed.mjs --now=2026-10-01T09:00:00Z > resolved.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dbJs = fs.readFileSync(path.join(root, 'frontend', 'src', 'app', 'store', 'db.js'), 'utf8')

// isRelDate, toIso and resolveDates are consecutive in db.js; take them verbatim (brace matched).
const start = dbJs.indexOf('function isRelDate')
const rd = dbJs.indexOf('function resolveDates', start)
if (start < 0 || rd < 0) throw new Error('resolveDates() not found in db.js')
let depth = 0
let end = dbJs.indexOf('{', rd)
for (; end < dbJs.length; end++) {
  if (dbJs[end] === '{') depth++
  else if (dbJs[end] === '}' && --depth === 0) { end++; break }
}
const src = dbJs.slice(start, end).replace(/export\s+function/g, 'function')
const resolveDates = new Function(`${src}\nreturn resolveDates`)()

const arg = process.argv.find(a => a.startsWith('--now='))
const now = arg ? Date.parse(arg.slice(6)) : Date.now()
const dir = path.join(root, 'frontend', 'src', 'app', 'data', 'seed')
const out = {}
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort())
  out[f.slice(0, -5)] = resolveDates(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), now)
process.stdout.write(JSON.stringify(out))
