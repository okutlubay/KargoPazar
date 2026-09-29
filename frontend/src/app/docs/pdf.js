// Shared jsPDF helpers for every KargoPazar document generator.
//
// All sizes are millimetres. Every generator is a pure function of plain data
// (seed shaped objects, dates as ISO strings) that returns a jsPDF instance;
// output helpers below turn it into a download, a blob URL (iframe preview),
// a data URL or a print job. Text follows the current app locale (i18n).
//
// Screens should import generators lazily so jsPDF stays out of the main chunk:
//   const { downloadLabel } = await import('@/app/docs/label.js')
import { jsPDF, GState } from 'jspdf'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { NOTO_SANS_REGULAR, NOTO_SANS_BOLD } from './fonts/notoSans.js'
import { t, tx, locale } from '../i18n/index.js'
import * as F from '@/shared/format.js'
import { CARRIERS } from '@/shared/carriers.js'
import { db } from '../store/db.js'

export { t, tx }

export const FONT = 'NotoSans'
export const PT = 0.352778 // mm per point
export const SIZES = {
  a4: [210, 297],
  label: [101.6, 152.4], // 4 x 6 in
}
export const COLORS = {
  ink: '#151827',
  ink2: '#4A4F63',
  ink3: '#7A7F92',
  line: '#D9DBE3',
  soft: '#F3F4F8',
  accent: '#4B4FD8',
  accentSoft: '#ECEDFC',
  success: '#1E8E5A',
  successSoft: '#E6F4EC',
  danger: '#C0392B',
  dangerSoft: '#FBEAE8',
  warning: '#B7791F',
  warningSoft: '#FDF3E1',
}

// ---------------------------------------------------------------- formatting

export const lang = () => (locale.value === 'en' ? 'en' : 'tr')

/** ISO string, Date, epoch or seed style { daysAgo, hour, minute } -> ISO string (or null). */
export function iso(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return new Date(v).toISOString()
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object' && 'daysAgo' in v) {
    const d = new Date()
    d.setDate(d.getDate() - (v.daysAgo || 0))
    d.setHours(v.hour ?? 0, v.minute ?? 0, 0, 0)
    return d.toISOString()
  }
  return null
}

export const f = {
  money: (v, cur = 'USD', d = 2) => F.money(v, lang(), cur, d),
  number: (v, d = 0) => F.number(v, lang(), d),
  percent: (v, d = 1) => F.percent(v, lang(), d),
  date: v => F.date(iso(v), lang()),
  dateTime: v => F.dateTime(iso(v), lang()),
  lb: (v, d = 1) => (v == null ? '-' : F.number(v, lang(), d) + ' lb'),
  kg: (v, d = 2) => (v == null ? '-' : F.number(v, lang(), d) + ' kg'),
  dims: p => {
    if (!p) return '-'
    const l = p.lengthIn ?? p.l, w = p.widthIn ?? p.w, h = p.heightIn ?? p.h
    if (l == null) return '-'
    return [l, w, h].map(x => F.number(x, lang(), x % 1 ? 1 : 0)).join(' x ') + ' in'
  },
}

export const LB_PER_KG = F.LB_PER_KG

const GLYPH_MAP = { '\u2192': '->', '\u2190': '<-', '\u2191': '^', '\u2193': 'v', '\u2713': 'OK', '\u2714': 'OK', '\u2717': 'x', '\u25CF': '\u2022', '\u2014': '-', '\u2013': '-' }
/** Replace characters the embedded font has no glyph for (arrows, check marks, emoji flags). */
export function clean(str) {
  return String(str ?? '')
    .replace(/[\u2190-\u2193\u2713\u2714\u2717\u25CF\u2014\u2013]/g, c => GLYPH_MAP[c] || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{FE0F}]/gu, '')
}
export const dash = v => (v == null || v === '' ? '-' : String(v))

/** Safe ASCII filename piece. */
export function fileSafe(s) {
  return String(s ?? '')
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[çÇ]/g, 'c').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ------------------------------------------------------------ reference data

function safeAll(col) {
  try { const a = db.all(col); return Array.isArray(a) && a.length ? a : null } catch { return null }
}
function safeDoc(name) {
  try { const d = db.doc(name); return d && typeof d === 'object' && !Array.isArray(d) ? d : null } catch { return null }
}

/** Carrier record (user modified copy from db, else built in defaults). */
export function carrierInfo(code, carriers) {
  const list = carriers || safeAll('carriers') || CARRIERS
  const c = list.find(x => x.code === code) || CARRIERS.find(x => x.code === code)
  return c || { code: code || '-', name: code || '-', color: COLORS.ink, ink: '#FFFFFF', services: [] }
}

export function serviceInfo(carrierCode, serviceCode, carriers) {
  const c = carrierInfo(carrierCode, carriers)
  return (c.services || []).find(s => s.code === serviceCode) || { code: serviceCode, name: serviceCode || '-' }
}

export function hubInfo(code, hubs) {
  const list = hubs || safeAll('hubs') || []
  return list.find(h => h.code === code) || null
}

/** Demo company (user.company) with fallbacks. */
export function companyInfo(company) {
  if (company) return company
  const u = safeDoc('user')
  return u?.company || { name: 'Anatolia Home & Craft LLC', legalName: 'Anatolia Home & Craft LLC', taxId: '88-1234567', phone: '+1 (201) 555-0148', senderAddress: { name: 'Anatolia Home & Craft', line1: '400 Commerce Blvd', line2: 'Suite 12', city: 'Carlstadt', state: 'NJ', zip: '07072', country: 'US' } }
}

export function userEmail() {
  return safeDoc('user')?.email || 'demo@kargopazar.com'
}

export { safeAll, safeDoc }

/** Country display name in the current locale (falls back to the code). */
export function countryName(code) {
  if (!code) return '-'
  const list = safeAll('countries') || []
  const c = list.find(x => x.code === code)
  if (c?.name) return tx(c.name)
  try {
    return new Intl.DisplayNames([lang() === 'tr' ? 'tr-TR' : 'en-US'], { type: 'region' }).of(code) || code
  } catch { return code }
}

/** Address -> printable lines. */
export function addressLines(a, { withCountry = true, withName = true } = {}) {
  if (!a) return ['-']
  const out = []
  if (withName && a.name) out.push(a.name)
  if (a.company && a.company !== a.name) out.push(a.company)
  if (a.line1) out.push(a.line1)
  if (a.line2) out.push(a.line2)
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (cityLine) out.push(cityLine)
  if (withCountry && a.country) out.push(countryName(a.country))
  return out
}

// ------------------------------------------------------------------- doc core

/** New jsPDF with embedded Unicode fonts. format: 'a4' | 'label' | [w, h] (mm). */
export function createDoc({ format = 'a4', orientation = 'portrait', title, subject } = {}) {
  const size = Array.isArray(format) ? format : SIZES[format] || SIZES.a4
  const doc = new jsPDF({ unit: 'mm', format: size, orientation, compress: true })
  doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR)
  doc.addFont('NotoSans-Regular.ttf', FONT, 'normal')
  doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD)
  doc.addFont('NotoSans-Bold.ttf', FONT, 'bold')
  doc.setFont(FONT, 'normal')
  doc.setLineHeightFactor(1.2)
  doc.__kpz = { fresh: true, sections: [] }
  doc.setProperties({ title: title || 'KargoPazar', subject: subject || '', creator: 'KargoPazar', author: 'KargoPazar' })
  doc.setLanguage(lang() === 'tr' ? 'tr-TR' : 'en-US')
  return doc
}

/**
 * Start a new page with the given format. The blank first page created by
 * createDoc() is reused (or replaced when its size differs).
 */
export function beginPage(doc, format = 'a4', orientation = 'portrait') {
  const size = Array.isArray(format) ? format : SIZES[format] || SIZES.a4
  const [w, h] = orientation === 'landscape' ? [Math.max(...size), Math.min(...size)] : [Math.min(...size), Math.max(...size)]
  const st = doc.__kpz || (doc.__kpz = { fresh: false, sections: [] })
  if (st.fresh) {
    st.fresh = false
    const cw = doc.internal.pageSize.getWidth(), ch = doc.internal.pageSize.getHeight()
    if (Math.abs(cw - w) < 0.5 && Math.abs(ch - h) < 0.5) return
    doc.addPage(size, orientation)
    doc.deletePage(1)
    return
  }
  doc.addPage(size, orientation)
}

export const pageW = doc => doc.internal.pageSize.getWidth()
export const pageH = doc => doc.internal.pageSize.getHeight()
export const pageNo = doc => doc.internal.getCurrentPageInfo().pageNumber

/** Register a logical document section (for per-document page numbering in merged PDFs). */
export function openSection(doc, { title, number, footer = true }) {
  const s = { title, number, footer, start: pageNo(doc), end: pageNo(doc) }
  doc.__kpz.sections.push(s)
  return s
}
export function closeSection(doc, s) { s.end = doc.getNumberOfPages() }

export function font(doc, { size = 9, bold = false, color = COLORS.ink } = {}) {
  doc.setFont(FONT, bold ? 'bold' : 'normal')
  doc.setFontSize(size)
  doc.setTextColor(color)
}

export function text(doc, str, x, y, opts = {}) {
  const { size, bold, color, align, maxWidth, angle } = opts
  font(doc, { size, bold, color })
  const o = {}
  if (align) o.align = align
  if (maxWidth) o.maxWidth = maxWidth
  if (angle) o.angle = angle
  doc.text(Array.isArray(str) ? str.map(clean) : clean(str), x, y, o)
}

/** Truncate a single line to fit maxWidth (mm) at the current font. */
export function fit(doc, str, maxWidth, opts = {}) {
  font(doc, opts)
  let s = clean(str)
  if (doc.getTextWidth(s) <= maxWidth) return s
  while (s.length > 1 && doc.getTextWidth(s + '...') > maxWidth) s = s.slice(0, -1)
  return s.trimEnd() + '...'
}

/** Wrap to lines (array) at the given font. */
export function wrap(doc, str, maxWidth, opts = {}) {
  font(doc, opts)
  return doc.splitTextToSize(clean(str), maxWidth)
}

export function rect(doc, x, y, w, h, { fill, stroke, lw = 0.2, r = 0 } = {}) {
  if (fill) doc.setFillColor(fill)
  if (stroke) { doc.setDrawColor(stroke); doc.setLineWidth(lw) }
  const style = fill && stroke ? 'FD' : fill ? 'F' : 'S'
  if (r) doc.roundedRect(x, y, w, h, r, r, style)
  else doc.rect(x, y, w, h, style)
}

export function hline(doc, x1, x2, y, { color = COLORS.line, lw = 0.2 } = {}) {
  doc.setDrawColor(color); doc.setLineWidth(lw); doc.line(x1, y, x2, y)
}
export function vline(doc, x, y1, y2, { color = COLORS.line, lw = 0.2 } = {}) {
  doc.setDrawColor(color); doc.setLineWidth(lw); doc.line(x, y1, x, y2)
}

export function withOpacity(doc, opacity, fn) {
  doc.saveGraphicsState()
  doc.setGState(new GState({ opacity, 'stroke-opacity': opacity }))
  try { fn() } finally { doc.restoreGraphicsState() }
}

/** KargoPazar mark (same geometry as the app logo icon). */
export function logo(doc, x, y, size = 7) {
  const k = size / 32
  rect(doc, x + 2 * k, y + 2 * k, 28 * k, 28 * k, { fill: COLORS.ink, r: 7 * k })
  doc.setDrawColor('#FFFFFF'); doc.setLineWidth(2.2 * k); doc.setLineCap('round'); doc.setLineJoin('round')
  doc.line(x + 9 * k, y + 9 * k, x + 9 * k, y + 23 * k)
  doc.line(x + 9 * k, y + 16 * k, x + 18 * k, y + 9 * k)
  doc.line(x + 9 * k, y + 16 * k, x + 18 * k, y + 23 * k)
  doc.setLineCap('butt'); doc.setLineJoin('miter')
  doc.setFillColor('#6F73F0'); doc.circle(x + 22.5 * k, y + 9.5 * k, 2 * k, 'F')
}

// ------------------------------------------------------------ barcode and QR

/** Code128 module pattern ('1'/'0' string) for a value. */
export function code128Modules(value) {
  const data = {}
  JsBarcode(data, String(value), { format: 'CODE128' })
  return (data.encodings || []).map(e => e.data).join('')
}

/** Merge module string into [start, length] runs of dark bars. */
export function barRuns(modules) {
  const runs = []
  let i = 0
  while (i < modules.length) {
    if (modules[i] === '1') {
      let j = i
      while (j < modules.length && modules[j] === '1') j++
      runs.push([i, j - i]); i = j
    } else i++
  }
  return runs
}

/**
 * Vector Code128 barcode. Width is the maximum; the module width is chosen to
 * fit (capped at maxModule mm). Returns the drawn { x, w }.
 */
export function barcode(doc, value, x, y, w, h, { align = 'center', maxModule = 0.5, color = '#000000' } = {}) {
  const modules = code128Modules(value)
  const mw = Math.min(maxModule, w / modules.length)
  const bw = mw * modules.length
  const bx = align === 'center' ? x + (w - bw) / 2 : align === 'right' ? x + w - bw : x
  doc.setFillColor(color)
  for (const [s, len] of barRuns(modules)) doc.rect(bx + s * mw, y, len * mw, h, 'F')
  return { x: bx, w: bw }
}

/** QR module matrix { size, get(r, c) }. */
export function qrMatrix(value, ecl = 'M') {
  const q = QRCode.create(String(value), { errorCorrectionLevel: ecl })
  const size = q.modules.size
  const data = q.modules.data
  return { size, get: (r, c) => !!data[r * size + c] }
}

/** Vector QR code (square of side `size` mm, 2 module quiet zone included). */
export function qr(doc, value, x, y, size, { color = '#000000', quiet = 2 } = {}) {
  const m = qrMatrix(value)
  const cell = size / (m.size + quiet * 2)
  doc.setFillColor(color)
  for (let r = 0; r < m.size; r++) {
    let c = 0
    while (c < m.size) {
      if (m.get(r, c)) {
        let e = c
        while (e < m.size && m.get(r, e)) e++
        doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, (e - c) * cell + 0.01, cell + 0.01, 'F')
        c = e
      } else c++
    }
  }
}

// ------------------------------------------------------ A4 document furniture

export const M = 14 // A4 page margin

/**
 * Standard A4 header: logo + brand on the left, document title and meta on
 * the right. Returns the y position below the header.
 */
export function docHeader(doc, { title, subtitle, number, barcodeValue, meta = [], metaLines = 2 }) {
  const W = pageW(doc)
  logo(doc, M, 11, 9)
  text(doc, 'KargoPazar', M + 11, 17.2, { size: 13, bold: true })
  text(doc, 'kargopazar.com', M + 11, 21.2, { size: 7, color: COLORS.ink3 })
  text(doc, title, W - M, 16.5, { size: 15, bold: true, align: 'right' })
  let y = 21.5
  if (subtitle) { text(doc, subtitle, W - M, y, { size: 8, color: COLORS.ink2, align: 'right' }); y += 4 }
  if (number) { text(doc, number, W - M, y, { size: 9, bold: true, color: COLORS.accent, align: 'right' }); y += 4 }
  let bottom = Math.max(y, 26)
  if (barcodeValue) {
    barcode(doc, barcodeValue, W - M - 60, bottom - 1, 60, 9, { align: 'right', maxModule: 0.33 })
    bottom += 10
  }
  hline(doc, M, W - M, bottom + 1, { color: COLORS.ink, lw: 0.5 })
  let yy = bottom + 6
  if (meta.length) yy = metaGrid(doc, meta, M, yy, W - 2 * M, { cols: Math.min(4, meta.length), maxLines: metaLines })
  return yy
}

/** Grid of label/value pairs. Returns y below. */
export function metaGrid(doc, pairs, x, y, w, { cols = 4, gap = 3, labelSize = 6.5, valueSize = 8.5, maxLines = 2 } = {}) {
  const cw = (w - gap * (cols - 1)) / cols
  let rowH = 0
  let cy = y
  pairs.forEach(([label, value], i) => {
    const c = i % cols
    if (c === 0 && i > 0) { cy += rowH + 2.5; rowH = 0 }
    const cx = x + c * (cw + gap)
    text(doc, String(label).toUpperCase(), cx, cy, { size: labelSize, bold: true, color: COLORS.ink3 })
    const lines = wrap(doc, dash(value), cw, { size: valueSize, bold: true })
    const shown = lines.slice(0, maxLines)
    text(doc, shown, cx, cy + 3.8, { size: valueSize, bold: true })
    rowH = Math.max(rowH, 3.8 + shown.length * valueSize * PT * 1.2)
  })
  return cy + rowH + 3
}

/** Titled address box. Returns height used. */
export function addressBox(doc, title, lines, x, y, w, { extra = [], minH = 30 } = {}) {
  const pad = 3
  const body = []
  for (const l of lines) body.push(...wrap(doc, l, w - 2 * pad, { size: 8.5 }))
  const extraLines = extra.filter(e => e && e[1]).map(([k, v]) => `${k}: ${v}`)
  const h = Math.max(minH, 8 + body.length * 3.9 + extraLines.length * 3.6 + pad)
  rect(doc, x, y, w, h, { stroke: COLORS.line, r: 1.5 })
  rect(doc, x, y, w, 6, { fill: COLORS.soft, r: 1.5 })
  doc.setFillColor(COLORS.soft); doc.rect(x, y + 3, w, 3, 'F')
  hline(doc, x, x + w, y + 6)
  text(doc, String(title).toUpperCase(), x + pad, y + 4.2, { size: 6.5, bold: true, color: COLORS.ink2 })
  let cy = y + 10.5
  body.forEach((l, i) => { text(doc, l, x + pad, cy, { size: 8.5, bold: i === 0 }); cy += 3.9 })
  extraLines.forEach(l => { text(doc, l, x + pad, cy, { size: 7.5, color: COLORS.ink2 }); cy += 3.6 })
  return h
}

/**
 * Table with wrapping cells and automatic page breaks.
 * columns: [{ key, label, width (fraction or mm), align, bold, color(row) }]
 * rows: array of objects (cell text = row[key] or col.value(row)).
 * Returns y below the table.
 */
export function table(doc, { x = M, y, w, columns, rows, fontSize = 7.8, headSize = 6.8, zebra = true, onPageBreak, format = 'a4', orientation = 'portrait', footRows = [], minRowH = 6 }) {
  w = w ?? pageW(doc) - 2 * M
  const totalFrac = columns.reduce((s, c) => s + (c.width <= 1 ? c.width : 0), 0)
  const fixed = columns.reduce((s, c) => s + (c.width > 1 ? c.width : 0), 0)
  const widths = columns.map(c => (c.width > 1 ? c.width : ((w - fixed) * c.width) / (totalFrac || 1)))
  const pad = 1.6
  const lh = fontSize * PT * 1.25
  const bottom = pageH(doc) - 18

  const drawHead = () => {
    rect(doc, x, y, w, 6.5, { fill: COLORS.ink })
    let cx = x
    columns.forEach((c, i) => {
      const lines = wrap(doc, String(c.label).toUpperCase(), widths[i] - 2 * pad, { size: headSize, bold: true })
      const tx0 = c.align === 'right' ? cx + widths[i] - pad : c.align === 'center' ? cx + widths[i] / 2 : cx + pad
      text(doc, lines[0], tx0, y + 4.3, { size: headSize, bold: true, color: '#FFFFFF', align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : undefined })
      cx += widths[i]
    })
    y += 6.5
  }
  drawHead()

  const cell = (c, r) => (c.value ? c.value(r) : r[c.key])
  const drawRow = (r, idx, { foot = false } = {}) => {
    const cellLines = columns.map((c, i) => wrap(doc, foot ? String(cell(c, r) ?? '') : dash(cell(c, r)), widths[i] - 2 * pad, { size: fontSize, bold: foot || c.bold }))
    const h = Math.max(minRowH, Math.max(...cellLines.map(l => l.length)) * lh + 2 * pad)
    if (y + h > bottom) {
      beginPage(doc, format, orientation)
      y = onPageBreak ? onPageBreak(doc) : M + 4
      drawHead()
    }
    if (foot) rect(doc, x, y, w, h, { fill: COLORS.soft })
    else if (zebra && idx % 2 === 1) rect(doc, x, y, w, h, { fill: '#FAFAFC' })
    let cx = x
    columns.forEach((c, i) => {
      const color = (c.color && c.color(r)) || COLORS.ink
      const al = c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : undefined
      const tx0 = al === 'right' ? cx + widths[i] - pad : al === 'center' ? cx + widths[i] / 2 : cx + pad
      text(doc, cellLines[i], tx0, y + pad + fontSize * PT * 0.95, { size: fontSize, bold: foot || c.bold || (c.boldIf && c.boldIf(r)), color, align: al })
      cx += widths[i]
    })
    y += h
    hline(doc, x, x + w, y, { color: COLORS.line, lw: 0.15 })
  }
  rows.forEach((r, i) => drawRow(r, i))
  if (!rows.length) {
    text(doc, t('docs.common.noRows'), x + w / 2, y + 5, { size: fontSize, color: COLORS.ink3, align: 'center' })
    y += 8
    hline(doc, x, x + w, y, { color: COLORS.line, lw: 0.15 })
  }
  footRows.forEach((r, i) => drawRow(r, i, { foot: true }))
  return y
}

/** Right aligned totals block: rows [[label, value, {bold}]]. Returns y below. */
export function totalsBlock(doc, rows, y, { w = 78, x } = {}) {
  x = x ?? pageW(doc) - M - w
  rows.forEach(([label, value, o = {}]) => {
    if (o.bold) {
      rect(doc, x, y - 0.5, w, 7.5, { fill: COLORS.ink })
      text(doc, label, x + 2.5, y + 4.4, { size: 9, bold: true, color: '#FFFFFF' })
      text(doc, value, x + w - 2.5, y + 4.4, { size: 10, bold: true, color: '#FFFFFF', align: 'right' })
      y += 8.5
    } else {
      text(doc, label, x + 2.5, y + 3.8, { size: 8, color: COLORS.ink2 })
      text(doc, value, x + w - 2.5, y + 3.8, { size: 8.5, bold: true, align: 'right' })
      hline(doc, x, x + w, y + 5.6, { color: COLORS.line, lw: 0.15 })
      y += 6.2
    }
  })
  return y
}

/** Signature line with a caption. */
export function signature(doc, x, y, w, caption, { name, date } = {}) {
  hline(doc, x, x + w, y, { color: COLORS.ink2, lw: 0.3 })
  text(doc, caption, x, y + 4, { size: 7, color: COLORS.ink3 })
  if (name) text(doc, name, x, y - 2, { size: 8.5, bold: true })
  if (date) text(doc, date, x + w, y - 2, { size: 8, color: COLORS.ink2, align: 'right' })
}

export function checkbox(doc, x, y, checked, label, { size = 3.2, labelSize = 7.5 } = {}) {
  rect(doc, x, y, size, size, { stroke: COLORS.ink, lw: 0.3 })
  if (checked) {
    doc.setDrawColor(COLORS.ink); doc.setLineWidth(0.5)
    doc.line(x + 0.6, y + size * 0.55, x + size * 0.42, y + size - 0.6)
    doc.line(x + size * 0.42, y + size - 0.6, x + size - 0.5, y + 0.6)
  }
  if (label) text(doc, label, x + size + 1.5, y + size - 0.5, { size: labelSize, bold: checked })
}

/** Rotated rubber stamp (PAID, REPLACED ...). */
export function stamp(doc, label, cx, cy, { color = COLORS.success, size = 20, angle = 18, opacity = 0.85 } = {}) {
  withOpacity(doc, opacity, () => {
    font(doc, { size, bold: true, color })
    const tw = doc.getTextWidth(label)
    const th = size * PT * 0.7
    const rad = (angle * Math.PI) / 180
    // jsPDF rotates around the baseline origin: move it so the text is centred on (cx, cy)
    const ox = cx - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * th) / 2
    const oy = cy + (Math.sin(rad) * tw) / 2 + (Math.cos(rad) * th) / 2
    doc.text(label, ox, oy, { angle })
  })
}

/** Small note paragraph. Returns y below. */
export function note(doc, str, x, y, w, { size = 7.2, color = COLORS.ink2, bold = false } = {}) {
  const lines = wrap(doc, str, w, { size, bold })
  text(doc, lines, x, y, { size, color, bold })
  return y + lines.length * size * PT * 1.25 + 1
}

/** Section title with rule. Returns y below. */
export function sectionTitle(doc, label, y, { x = M, w } = {}) {
  w = w ?? pageW(doc) - 2 * M
  text(doc, label, x, y, { size: 10, bold: true })
  hline(doc, x, x + w, y + 1.8, { color: COLORS.line, lw: 0.3 })
  return y + 6.5
}

/** Ensure `need` mm fit on the page, else start a new page. Returns y. */
export function ensureSpace(doc, y, need, { format = 'a4', orientation = 'portrait', top = M + 4 } = {}) {
  if (y + need <= pageH(doc) - 18) return y
  beginPage(doc, format, orientation)
  return top
}

/** Footer on every page of each A4 section: brand, generated at, page i / n. */
export function finalize(doc) {
  const total = doc.getNumberOfPages()
  const generated = t('docs.common.generated', { at: f.dateTime(new Date().toISOString()) })
  for (const s of doc.__kpz?.sections || []) {
    if (!s.footer) continue
    const n = s.end - s.start + 1
    for (let p = s.start; p <= s.end && p <= total; p++) {
      doc.setPage(p)
      const W = pageW(doc), H = pageH(doc)
      hline(doc, M, W - M, H - 11, { color: COLORS.line, lw: 0.2 })
      text(doc, `KargoPazar · ${s.title}${s.number ? ' · ' + s.number : ''}`, M, H - 7, { size: 6.8, color: COLORS.ink3 })
      text(doc, `${generated} · ${t('docs.common.page', { i: p - s.start + 1, n })}`, W - M, H - 7, { size: 6.8, color: COLORS.ink3, align: 'right' })
    }
  }
  if (total) doc.setPage(total)
  return doc
}

// -------------------------------------------------------------------- output

/** Save the PDF (browser download). Returns the filename. */
export function download(doc, filename) {
  const name = filename.endsWith('.pdf') ? filename : filename + '.pdf'
  doc.save(name)
  return name
}

/** Blob URL for <iframe src> previews. Call URL.revokeObjectURL(url) when done. */
export function toBlobUrl(doc) {
  return URL.createObjectURL(doc.output('blob'))
}

/** data:application/pdf;base64 URL. */
export function toDataUrl(doc) {
  return doc.output('datauristring')
}

export function toBlob(doc) {
  return doc.output('blob')
}

/** Print only this PDF (hidden iframe + browser print dialog). */
export function printDoc(doc) {
  doc.autoPrint()
  const url = toBlobUrl(doc)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0'
  frame.src = url
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print() } catch { window.open(url, '_blank') }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60000)
  }
  document.body.appendChild(frame)
  return url
}
