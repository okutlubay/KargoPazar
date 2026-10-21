// Builds the bundled 6-digit tariff table (src/shared/tariff/hs6.json) from public sources.
//
//   node scripts/build-tariff.mjs <source-dir>
//
// <source-dir> must contain (download them yourself; they are not committed):
//   hs.csv    HS nomenclature, https://raw.githubusercontent.com/datasets/harmonized-system/main/data/harmonized-system.csv
//   hts.json  US HTS export, https://hts.usitc.gov/reststop/exportList?from=0100&to=9999&format=JSON&styles=false
//   ukm.csv   UK Global Tariff measures, https://data.api.trade.gov.uk/v1/datasets/uk-tariff-2021-01-01/versions/latest/tables/measures-on-declarable-commodities/data?format=csv&download
//
// Per 6-digit code: US general (MFN) rate, UK third country duty, UK preference for Türkiye origin.
// EU (DE) and Türkiye rates are approximations derived from the UK rate (the UK Global Tariff was built
// from the EU common external tariff; Türkiye applies the EU tariff to industrial goods under the customs
// union). Specific duties (cents/kg etc.) have no ad valorem equivalent here: those codes take the median
// of their heading or chapter. Demo data, not a substitute for the official tariff.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const SRC = process.argv[2]
if (!SRC) { console.error('usage: node scripts/build-tariff.mjs <source-dir>'); process.exit(1) }
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../src/shared/tariff/hs6.json')

function parseCsvLine(line) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pctOf = text => {
  const t = String(text || '').trim()
  if (/^free\b/i.test(t)) return 0
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/)
  return m ? Number(m[1]) : null
}

// ---- HS nomenclature (6-digit codes + English descriptions)
const hsRows = fs.readFileSync(path.join(SRC, 'hs.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(parseCsvLine)
const codes = new Map() // code6 -> desc
const headings = new Map()
for (const [, code, desc, , level] of hsRows) {
  if (level === '6') codes.set(code, desc)
  if (level === '4') headings.set(code, desc)
}

// ---- US HTS general column
const usBy6 = new Map()
for (const x of JSON.parse(fs.readFileSync(path.join(SRC, 'hts.json'), 'utf8'))) {
  const d = String(x.htsno || '').replace(/\D/g, '')
  if (d.length < 8 || !x.general) continue
  const p = pctOf(x.general)
  if (p == null) continue
  const k = d.slice(0, 6)
  if (!usBy6.has(k)) usBy6.set(k, [])
  usBy6.get(k).push(p)
}

// ---- UK measures: 103 third country duty (ERGA OMNES), 142 preference with geographical area TR
const ukBy6 = new Map(), ukTrBy6 = new Map()
const rl = readline.createInterface({ input: fs.createReadStream(path.join(SRC, 'ukm.csv')), crlfDelay: Infinity })
let header = null
for await (const line of rl) {
  if (!header) { header = parseCsvLine(line); continue }
  if (!line.includes('"103"') && !(line.includes('"142"') && line.includes('"TR"'))) continue
  const f = parseCsvLine(line)
  const code = f[2], type = f[6], duty = f[10], end = f[12], geo = f[17]
  if (end !== '#NA') continue
  const p = pctOf(duty)
  if (p == null) continue
  const k = code.slice(0, 6)
  const target = type === '103' && geo === '1011' ? ukBy6 : type === '142' && geo === 'TR' ? ukTrBy6 : null
  if (!target) continue
  if (!target.has(k)) target.set(k, [])
  target.get(k).push(p)
}

// ---- assemble with heading / chapter fill
function filler(map) {
  const by4 = new Map(), by2 = new Map()
  for (const [k, v] of map) {
    const m = median(v)
    for (const [mp, key] of [[by4, k.slice(0, 4)], [by2, k.slice(0, 2)]]) { if (!mp.has(key)) mp.set(key, []); mp.get(key).push(m) }
  }
  return code => {
    if (map.has(code)) return { v: median(map.get(code)), est: 0 }
    if (by4.has(code.slice(0, 4))) return { v: median(by4.get(code.slice(0, 4))), est: 1 }
    if (by2.has(code.slice(0, 2))) return { v: median(by2.get(code.slice(0, 2))), est: 1 }
    return { v: null, est: 1 }
  }
}
const us = filler(usBy6), gb = filler(ukBy6)
const r1 = v => (v == null ? null : Math.round(v * 10) / 10)
const rows = []
let exactUs = 0, exactGb = 0, prefTr = 0
for (const [code, desc] of [...codes].sort((a, b) => a[0].localeCompare(b[0]))) {
  const u = us(code), g = gb(code)
  const usv = u.v ?? 3.5, gbv = g.v ?? 4
  const tr = ukTrBy6.has(code) ? median(ukTrBy6.get(code)) : null
  if (!u.est) exactUs++
  if (!g.est) exactGb++
  if (tr != null) prefTr++
  const ch = Number(code.slice(0, 2))
  const eu = gbv // UKGT ~ EU CET (approximation)
  const euTr = ch >= 25 ? 0 : eu // EU-Türkiye customs union: industrial goods duty free
  const trDest = ch >= 25 ? eu : Math.max(eu + 15, 20) // Türkiye: CET for industrial goods, higher agricultural duties (approx.)
  // [code, desc, us, gb, gbTR|null, eu, euTR, tr, flags] flags: 1 = US estimated, 2 = GB estimated
  rows.push([code, desc, r1(usv), r1(gbv), r1(tr), r1(eu), r1(euTr), r1(trDest), (u.est ? 1 : 0) | (g.est ? 2 : 0)])
}
const out = {
  v: 1,
  builtAt: new Date().toISOString().slice(0, 10),
  note: 'Rates in percent. us: US HTS general; gb: UK Global Tariff third country duty; gbTR: UK preference for TR origin; eu/euTR/tr: approximations. flags 1/2: US/GB value filled from heading or chapter median.',
  headings: Object.fromEntries([...headings].sort((a, b) => a[0].localeCompare(b[0]))),
  rows,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out))
console.log(`hs6: ${rows.length} codes (US exact ${exactUs}, GB exact ${exactGb}, GB TR preference ${prefTr}), headings ${headings.size} -> ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`)
