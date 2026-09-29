// Shared chart helpers: element size observer, nice ticks, time ticks, path builders.
import { ref, onMounted, onBeforeUnmount } from 'vue'

/** Reactive content-box size of an element via ResizeObserver. */
export function useElementSize(elRef) {
  const width = ref(0)
  const height = ref(0)
  let ro = null
  let raf = 0
  onMounted(() => {
    const el = elRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    width.value = Math.floor(rect.width)
    height.value = Math.floor(rect.height)
    if (typeof ResizeObserver === 'undefined') return
    ro = new ResizeObserver(entries => {
      const cr = entries[0] && entries[0].contentRect
      if (!cr) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const w = Math.floor(cr.width), h = Math.floor(cr.height)
        if (w !== width.value) width.value = w
        if (h !== height.value) height.value = h
      })
    })
    ro.observe(el)
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    if (ro) ro.disconnect()
  })
  return { width, height }
}

/** Coerce Date | ISO string | number to a number (ms for dates). */
export function toNum(x) {
  if (x == null) return NaN
  if (typeof x === 'number') return x
  if (x instanceof Date) return x.getTime()
  const n = Date.parse(x)
  return Number.isNaN(n) ? Number(x) : n
}

export function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function niceStep(span, count) {
  const raw = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step
  if (norm <= 1) step = 1
  else if (norm <= 2) step = 2
  else if (norm <= 2.5) step = 2.5
  else if (norm <= 5) step = 5
  else step = 10
  return step * mag
}

/**
 * Nice linear domain + ticks. Returns { min, max, ticks }.
 * Handles min === max and non-finite input.
 */
export function niceScale(min, max, count = 5) {
  if (!isFiniteNum(min) || !isFiniteNum(max)) { min = 0; max = 1 }
  if (min === max) {
    if (min === 0) { max = 1 } else {
      const pad = Math.abs(min) * 0.1
      min -= pad; max += pad
    }
  }
  if (min > max) [min, max] = [max, min]
  const step = niceStep(max - min, count)
  const nMin = Math.floor(min / step + 1e-9) * step
  const nMax = Math.ceil(max / step - 1e-9) * step
  const ticks = []
  const n = Math.round((nMax - nMin) / step)
  for (let i = 0; i <= n && i <= 50; i++) ticks.push(parseFloat((nMin + i * step).toPrecision(12)))
  return { min: nMin, max: nMax, ticks, step }
}

/** Linear scale function with .invert. */
export function linear(d0, d1, r0, r1) {
  const span = d1 - d0 || 1
  const k = (r1 - r0) / span
  const f = v => r0 + (v - d0) * k
  f.invert = px => d0 + (px - r0) / k
  return f
}

const DAY = 86400000
const localeTag = l => (l === 'tr' ? 'tr-TR' : 'en-US')
const dtfCache = new Map()
function dtf(locale, opts) {
  const key = locale + JSON.stringify(opts)
  if (!dtfCache.has(key)) dtfCache.set(key, new Intl.DateTimeFormat(localeTag(locale), opts))
  return dtfCache.get(key)
}

/**
 * Time ticks for a [t0, t1] ms domain. Returns [{ value, label }].
 * Picks day / week / month / quarter / year steps to fit ~count ticks.
 */
export function timeTicks(t0, t1, count, locale) {
  if (!isFiniteNum(t0) || !isFiniteNum(t1)) return []
  if (t0 === t1) return [{ value: t0, label: dtf(locale, { day: 'numeric', month: 'short' }).format(new Date(t0)) }]
  const span = t1 - t0
  const target = span / Math.max(1, count)
  const out = []
  const push = (d, opts) => {
    const v = d.getTime()
    if (v >= t0 - 1 && v <= t1 + 1) out.push({ value: v, label: dtf(locale, opts).format(d) })
  }
  if (target <= DAY * 3.5) {
    const step = target <= DAY * 1.5 ? 1 : 2
    const d = new Date(t0); d.setHours(0, 0, 0, 0)
    if (d.getTime() < t0) d.setDate(d.getDate() + 1)
    while (d.getTime() <= t1 && out.length < 400) {
      push(d, { day: 'numeric', month: 'short' })
      d.setDate(d.getDate() + step)
    }
    return out
  }
  if (target <= DAY * 20) {
    const step = target <= DAY * 9 ? 7 : 14
    const d = new Date(t0); d.setHours(0, 0, 0, 0)
    const dow = (d.getDay() + 6) % 7 // Monday = 0
    if (dow) d.setDate(d.getDate() + (7 - dow))
    while (d.getTime() <= t1 && out.length < 400) {
      push(d, { day: 'numeric', month: 'short' })
      d.setDate(d.getDate() + step)
    }
    return out
  }
  if (target <= DAY * 320) {
    const months = target <= DAY * 45 ? 1 : target <= DAY * 75 ? 2 : target <= DAY * 120 ? 3 : 6
    const d = new Date(t0); d.setHours(0, 0, 0, 0); d.setDate(1)
    if (d.getTime() < t0) d.setMonth(d.getMonth() + 1)
    while (d.getMonth() % months !== 0) d.setMonth(d.getMonth() + 1)
    let first = true
    while (d.getTime() <= t1 && out.length < 400) {
      const withYear = first || d.getMonth() === 0
      push(d, withYear ? { month: 'short', year: 'numeric' } : { month: 'short' })
      first = false
      d.setMonth(d.getMonth() + months)
    }
    return out
  }
  const years = Math.max(1, Math.round(target / (DAY * 365)))
  const d = new Date(new Date(t0).getFullYear(), 0, 1)
  if (d.getTime() < t0) d.setFullYear(d.getFullYear() + 1)
  while (d.getTime() <= t1 && out.length < 400) {
    push(d, { year: 'numeric' })
    d.setFullYear(d.getFullYear() + years)
  }
  return out
}

/** Full localized date for tooltips. */
export function formatDate(ms, locale) {
  if (!isFiniteNum(ms)) return '-'
  return dtf(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms))
}

/** Default number formatter (locale-aware, compact decimals). */
export function formatNumber(v, locale, maxDigits = 2) {
  if (v == null || Number.isNaN(v)) return '-'
  const key = 'n' + locale + maxDigits
  if (!dtfCache.has(key)) dtfCache.set(key, new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: maxDigits }))
  return dtfCache.get(key).format(v)
}

/** Linear path through [[x,y],...]. */
export function linePath(pts) {
  if (!pts.length) return ''
  let d = 'M' + r(pts[0][0]) + ',' + r(pts[0][1])
  for (let i = 1; i < pts.length; i++) d += 'L' + r(pts[i][0]) + ',' + r(pts[i][1])
  return d
}

function r(v) { return Math.round(v * 10) / 10 }

/** Monotone cubic (monotoneX) path; works for increasing or decreasing x. */
export function monotonePath(pts, continueFrom = false) {
  const n = pts.length
  if (!n) return ''
  const start = (continueFrom ? 'L' : 'M') + r(pts[0][0]) + ',' + r(pts[0][1])
  if (n < 3) return start + (n === 2 ? 'L' + r(pts[1][0]) + ',' + r(pts[1][1]) : '')
  const dx = new Array(n - 1), s = new Array(n - 1), m = new Array(n)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0]
    s[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0
  }
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) { m[i] = 0; continue }
    const p = (s[i - 1] * dx[i] + s[i] * dx[i - 1]) / (dx[i - 1] + dx[i])
    m[i] = (Math.sign(s[i - 1]) + Math.sign(s[i])) * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p)) || 0
  }
  m[0] = (3 * s[0] - m[1]) / 2
  m[n - 1] = (3 * s[n - 2] - m[n - 2]) / 2
  // keep end tangents from overshooting
  if (Math.sign(m[0]) !== Math.sign(s[0])) m[0] = 0
  if (Math.sign(m[n - 1]) !== Math.sign(s[n - 2])) m[n - 1] = 0
  let d = start
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += 'C' + r(pts[i][0] + h) + ',' + r(pts[i][1] + m[i] * h) + ',' +
      r(pts[i + 1][0] - h) + ',' + r(pts[i + 1][1] - m[i + 1] * h) + ',' +
      r(pts[i + 1][0]) + ',' + r(pts[i + 1][1])
  }
  return d
}

/** Split [{x,y}] (already projected to [px,py] or null) into continuous runs. */
export function segments(projected) {
  const out = []
  let cur = []
  for (const p of projected) {
    if (p == null) { if (cur.length) out.push(cur); cur = [] } else cur.push(p)
  }
  if (cur.length) out.push(cur)
  return out
}

/** Binary search: index of the value in a sorted numeric array closest to v. */
export function nearestIndex(sorted, v) {
  const n = sorted.length
  if (!n) return -1
  let lo = 0, hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= v) lo = mid; else hi = mid
  }
  return Math.abs(sorted[lo] - v) <= Math.abs(sorted[hi] - v) ? lo : hi
}

/** Rough text width estimate in px (for axis gutters). */
export function textWidth(str, fontSize = 11) {
  return String(str ?? '').length * fontSize * 0.6
}

/** SVG arc path (angles in radians, 0 = 12 o'clock, clockwise). */
export function arcPath(cx, cy, radius, a0, a1) {
  const x0 = cx + radius * Math.sin(a0), y0 = cy - radius * Math.cos(a0)
  const x1 = cx + radius * Math.sin(a1), y1 = cy - radius * Math.cos(a1)
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  return `M${r(x0)},${r(y0)}A${r(radius)},${r(radius)} 0 ${large} ${sweep} ${r(x1)},${r(y1)}`
}

/** Donut slice path between inner and outer radius. */
export function ringSlice(cx, cy, rOuter, rInner, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4
  const p = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)]
  const [x0, y0] = p(rOuter, a0), [x1, y1] = p(rOuter, a1)
  const [x2, y2] = p(rInner, a1), [x3, y3] = p(rInner, a0)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${r(x0)},${r(y0)}A${rOuter},${rOuter} 0 ${large} 1 ${r(x1)},${r(y1)}` +
    `L${r(x2)},${r(y2)}A${rInner},${rInner} 0 ${large} 0 ${r(x3)},${r(y3)}Z`
}

let uid = 0
/** Unique id prefix for gradients / clip paths. */
export function chartId(prefix = 'kc') {
  uid += 1
  return `${prefix}-${uid}`
}
