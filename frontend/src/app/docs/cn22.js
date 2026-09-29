// CN22 customs declaration (UPU style boxed form) for items up to USD 400,
// printed on a 4x6 in page so it can go through the label printer.
import {
  createDoc, beginPage, openSection, closeSection, finalize, text, rect, hline, vline, checkbox, fit, wrap,
  barcode, countryName, f, t, SIZES, COLORS, PT, download, toBlobUrl, toDataUrl, fileSafe,
} from './pdf.js'
import { buildCustomsData } from './customs.js'

const [W, H] = SIZES.label
const TABLE_END = 100
const asData = (data, opts) => (data && data.form && data.exporter ? data : buildCustomsData(data, opts))

export const CATEGORIES = ['gift', 'documents', 'sample', 'returned', 'merchandise', 'other']

export function renderCn22(doc, d) {
  beginPage(doc, 'label')
  const sec = openSection(doc, { title: 'CN 22', number: d.docNo, footer: false })
  const x0 = 3, x1 = W - 3, iw = x1 - x0
  const ink = '#000000'
  rect(doc, x0, 3, iw, H - 6, { stroke: ink, lw: 0.5 })

  // header
  text(doc, t('docs.cn.customsDeclaration'), x0 + 2.5, 8.6, { size: 8.5, bold: true, color: ink })
  text(doc, t('docs.cn.openedOfficially'), x0 + 2.5, 12.2, { size: 6, color: COLORS.ink2 })
  rect(doc, x1 - 22, 3, 22, 11, { fill: ink })
  text(doc, 'CN 22', x1 - 11, 10.6, { size: 13, bold: true, color: '#FFFFFF', align: 'center' })
  hline(doc, x0, x1, 14, { color: ink, lw: 0.4 })
  text(doc, t('docs.cn.operator'), x0 + 2.5, 17.6, { size: 5.6, bold: true, color: COLORS.ink2 })
  text(doc, fit(doc, d.carrier || 'KargoPazar', iw - 30, { size: 7.5, bold: true }), x0 + 2.5, 21, { size: 7.5, bold: true, color: ink })
  text(doc, t('docs.cn.itemNo'), x1 - 2.5, 17.6, { size: 5.6, bold: true, color: COLORS.ink2, align: 'right' })
  text(doc, fit(doc, d.reference || '-', 40, { size: 7.5, bold: true }), x1 - 2.5, 21, { size: 7.5, bold: true, color: ink, align: 'right' })
  hline(doc, x0, x1, 23.5, { color: ink, lw: 0.4 })

  // sender / addressee (compact)
  const half = iw / 2
  const party = (label, p, x) => {
    text(doc, label, x + 2, 27, { size: 5.6, bold: true, color: COLORS.ink2 })
    const lines = [p?.name, p?.company, p?.line1, [p?.zip, p?.city].filter(Boolean).join(' '), countryName(p?.country)].filter(Boolean)
    lines.slice(0, 5).forEach((l, i) => text(doc, fit(doc, l, half - 4, { size: 6.4, bold: i === 0 }), x + 2, 30.4 + i * 2.9, { size: 6.4, bold: i === 0, color: ink }))
  }
  party(t('docs.cn.from'), d.exporter, x0)
  vline(doc, x0 + half, 23.5, 45, { color: ink, lw: 0.3 })
  party(t('docs.cn.to'), d.importer, x0 + half)
  hline(doc, x0, x1, 45, { color: ink, lw: 0.4 })

  // categories
  const cats = CATEGORIES
  cats.forEach((c, i) => {
    const cx = x0 + 2.5 + (i % 3) * (iw / 3)
    const cy = 47.2 + Math.floor(i / 3) * 4.8
    checkbox(doc, cx, cy, d.contentType === c || (c === 'merchandise' && !cats.includes(d.contentType)), t(`docs.customs.types.${c}`), { size: 2.8, labelSize: 6.2 })
  })
  hline(doc, x0, x1, 57, { color: ink, lw: 0.4 })

  // items table
  const cols = [
    { label: t('docs.cn.description'), w: iw - 49 },
    { label: t('docs.cn.hs'), w: 15 },
    { label: t('docs.cn.originShort'), w: 10 },
    { label: 'kg', w: 10 },
    { label: t('docs.cn.value', { cur: d.currency || 'USD' }), w: 14 },
  ]
  let y = 57
  rect(doc, x0, y, iw, 6, { fill: COLORS.soft })
  let cx = x0
  cols.forEach((c, i) => {
    const lines = wrap(doc, c.label, c.w - 2, { size: 5.2, bold: true })
    text(doc, lines.slice(0, 2), i === 0 ? cx + 1.5 : cx + c.w / 2, y + 2.5, { size: 5.2, bold: true, color: ink, align: i === 0 ? undefined : 'center' })
    cx += c.w
    if (i < cols.length - 1) vline(doc, cx, y, TABLE_END, { color: ink, lw: 0.25 })
  })
  y += 6
  hline(doc, x0, x1, y, { color: ink, lw: 0.3 })
  const maxRows = 6
  const items = d.items.slice(0, maxRows)
  const extra = d.items.length - items.length
  items.forEach((it, idx) => {
    const ry = y + 1 + idx * 5.6
    const desc = `${f.number(it.qty)} x ${it.description}`
    const vals = [
      fit(doc, desc, cols[0].w - 2.5, { size: 6.2 }),
      it.hsCode || '-',
      it.origin || '-',
      it.weightKg != null ? f.number(it.weightKg, 2) : '-',
      f.number(it.totalValue, 2),
    ]
    let x = x0
    vals.forEach((v, i) => {
      text(doc, v, i === 0 ? x + 1.5 : i === 4 ? x + cols[i].w - 1.3 : x + cols[i].w / 2, ry + 3.2, { size: 6.2, bold: i === 4, color: ink, align: i === 0 ? undefined : i === 4 ? 'right' : 'center' })
      x += cols[i].w
    })
    hline(doc, x0, x1, ry + 4.6, { color: COLORS.line, lw: 0.15 })
  })
  if (extra > 0) text(doc, t('docs.cn.moreItems', { n: extra }), x0 + 1.5, y + 1 + maxRows * 5.6 - 1.4, { size: 5.8, color: COLORS.ink2 })
  y = TABLE_END
  hline(doc, x0, x1, y, { color: ink, lw: 0.4 })

  // totals
  text(doc, t('docs.cn.totalWeight'), x0 + 2, y + 3.6, { size: 5.6, bold: true, color: COLORS.ink2 })
  text(doc, f.kg(d.grossWeightKg), x0 + 2, y + 8, { size: 8.5, bold: true, color: ink })
  vline(doc, x0 + half, y, y + 10.5, { color: ink, lw: 0.3 })
  text(doc, t('docs.cn.totalValue'), x0 + half + 2, y + 3.6, { size: 5.6, bold: true, color: COLORS.ink2 })
  text(doc, f.money(d.totalValue, d.currency || 'USD'), x0 + half + 2, y + 8, { size: 8.5, bold: true, color: ink })
  y += 10.5
  hline(doc, x0, x1, y, { color: ink, lw: 0.4 })

  // declaration + signature
  const decl = wrap(doc, t('docs.cn.declaration'), iw - 5, { size: 5.3 })
  text(doc, decl.slice(0, 5), x0 + 2.5, y + 3, { size: 5.3, color: COLORS.ink2 })
  y += 3 + Math.min(5, decl.length) * 5.3 * PT * 1.2 + 2
  text(doc, t('docs.cn.dateSignature'), x0 + 2.5, y + 2, { size: 5.6, bold: true, color: COLORS.ink2 })
  text(doc, `${f.date(d.date)} · ${d.signer || ''}`, x0 + 2.5, y + 6.2, { size: 7.5, bold: true, color: ink })
  hline(doc, x0 + half + 4, x1 - 3, y + 6.5, { color: ink, lw: 0.3 })
  y = H - 14.5
  hline(doc, x0, x1, y - 1.5, { color: ink, lw: 0.3 })
  barcode(doc, d.docNo || d.reference || 'CN22', x0 + 2, y, iw - 36, 6.5, { align: 'left', maxModule: 0.3 })
  text(doc, d.docNo || '', x0 + 2, y + 9.2, { size: 5.8, color: ink })
  text(doc, 'KargoPazar', x1 - 2.5, y + 5, { size: 7, bold: true, color: ink, align: 'right' })
  text(doc, t('docs.cn.limitNote'), x1 - 2.5, y + 8.5, { size: 5.2, color: COLORS.ink2, align: 'right' })
  closeSection(doc, sec)
  return doc
}

export function cn22Doc(data, opts = {}) {
  const d = asData(data, opts)
  const doc = createDoc({ format: 'label', title: `CN22 ${d.reference || ''}` })
  renderCn22(doc, d)
  return finalize(doc)
}
export function downloadCn22(data, opts = {}) {
  const d = asData(data, opts)
  return download(cn22Doc(d), opts.filename || fileSafe(`CN22-${d.reference || d.docNo}`) + '.pdf')
}
export const cn22BlobUrl = (data, opts) => toBlobUrl(cn22Doc(data, opts))
export const cn22DataUrl = (data, opts) => toDataUrl(cn22Doc(data, opts))
