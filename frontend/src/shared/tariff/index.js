// Bundled 6-digit tariff table (hs6.json, built by scripts/build-tariff.mjs from the US HTS and the UK
// Global Tariff), loaded lazily so it does not weigh on the first page load.
//
//   loadTariff()            -> Promise<Tariff>  (starts the download once; call early, e.g. on app start)
//   getTariff()             -> Tariff | null    (sync; null until loaded)
//   tariffVersion           -> ref(number)      (bumps when the table is ready, so computed values re-run)
//   searchHs(query, limit)  -> [{ code: '9609.10', desc, chapter }] by description words or code prefix
//
// Tariff = { byCode: Map('960910' -> row), headings: { '9609': desc }, size }
// row = { code: '9609.10', desc, us, gb, gbTR, eu, euTR, tr, usEst, gbEst }  (rates as fractions)
import { ref } from 'vue'

export const tariffVersion = ref(0)
let tariff = null
let loading = null

const pct = v => (v == null ? null : Math.round(Number(v) * 10) / 1000)

export function loadTariff() {
  if (tariff) return Promise.resolve(tariff)
  if (!loading) {
    loading = import('./hs6.json').then(m => {
      const data = m.default || m
      const byCode = new Map()
      for (const [c, desc, us, gb, gbTR, eu, euTR, tr, flags] of data.rows) {
        byCode.set(c, { code: c.slice(0, 4) + '.' + c.slice(4, 6), desc, us: pct(us), gb: pct(gb), gbTR: pct(gbTR), eu: pct(eu), euTR: pct(euTR), tr: pct(tr), usEst: !!(flags & 1), gbEst: !!(flags & 2) })
      }
      tariff = { byCode, headings: data.headings || {}, size: byCode.size, builtAt: data.builtAt }
      tariffVersion.value++
      return tariff
    }).catch(e => { loading = null; throw e })
  }
  return loading
}

export function getTariff() { return tariff }

/** Rate columns of a row for a destination: { base, origin: { TR: rate } | null, estimated } */
export function tariffRates(row, dest) {
  if (!row) return null
  switch (dest) {
    case 'US': return { base: row.us, origin: null, estimated: row.usEst }
    case 'GB': return { base: row.gb, origin: row.gbTR != null ? { TR: row.gbTR } : null, estimated: row.gbEst }
    case 'DE': return { base: row.eu, origin: { TR: row.euTR }, estimated: true }
    case 'TR': return { base: row.tr, origin: null, estimated: true }
    default: return null
  }
}

const fold = s => String(s ?? '').toLocaleLowerCase('en').normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Description words (all must match) or a code prefix (2+ digits). Shorter descriptions rank first. */
export function searchHs(query, limit = 8) {
  if (!tariff) return []
  const q = fold(query).trim()
  if (!q) return []
  const digits = q.replace(/[\s.]/g, '')
  const out = []
  if (/^\d{2,6}$/.test(digits)) {
    for (const [c, r] of tariff.byCode) if (c.startsWith(digits)) { out.push(r); if (out.length >= limit) break }
    return out.map(r => ({ code: r.code, desc: r.desc, chapter: r.code.slice(0, 2) }))
  }
  const words = q.split(/\s+/).filter(w => w.length >= 2).map(w => w.replace(/(ies|es|s)$/, ''))
  if (!words.length) return []
  for (const r of tariff.byCode.values()) {
    const d = fold(r.desc)
    if (words.every(w => d.includes(w))) out.push(r)
  }
  return out.sort((a, b) => a.desc.length - b.desc.length).slice(0, limit).map(r => ({ code: r.code, desc: r.desc, chapter: r.code.slice(0, 2) }))
}
