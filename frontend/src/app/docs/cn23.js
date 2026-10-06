// CN23 customs declaration (UPU style numbered boxes, A4) for items above USD 400.
import {
  createDoc, beginPage, openSection, closeSection, finalize, text, rect, hline, vline, checkbox, fit, wrap,
  barcode, logo, countryName, f, t, M, pageW, pageH, COLORS, download, toBlobUrl, toDataUrl, fileSafe,
} from './pdf.js'
import { buildCustomsData } from './customs.js'
import { CATEGORIES } from './cn22.js'

const asData = (data, opts) => (data && data.form && data.exporter ? data : buildCustomsData(data, opts))
const ink = '#000000'

function boxLabel(doc, n, label, x, y) {
  const s = n ? `(${n}) ${label}` : label
  text(doc, s, x + 1.8, y + 3.2, { size: 5.8, bold: true, color: COLORS.ink2 })
}

function partyBox(doc, title, p, x, y, w, h) {
  rect(doc, x, y, w, h, { stroke: ink, lw: 0.35 })
  boxLabel(doc, null, title, x, y)
  const rows = [
    [t('docs.cn23.name'), p?.name],
    [t('docs.cn23.business'), p?.company],
    [t('docs.cn23.street'), [p?.line1, p?.line2].filter(Boolean).join(', ')],
    [t('docs.cn23.postcodeCity'), [p?.zip, p?.city, p?.state].filter(Boolean).join(' ')],
    [t('docs.cn23.country'), countryName(p?.country)],
  ]
  rows.forEach(([k, v], i) => {
    const ry = y + 8 + i * 5.2
    text(doc, k, x + 2, ry, { size: 5.8, color: COLORS.ink3 })
    text(doc, fit(doc, v || '-', w - 28, { size: 8, bold: i === 0 }), x + 25, ry, { size: 8, bold: i === 0, color: ink })
    hline(doc, x + 24, x + w - 2, ry + 1.3, { color: COLORS.line, lw: 0.15 })
  })
}

export function renderCn23(doc, d) {
  beginPage(doc, 'a4')
  const sec = openSection(doc, { title: 'CN 23', number: d.docNo })
  const W = pageW(doc)
  const x0 = M - 2, x1 = W - M + 2, iw = x1 - x0
  const cur = d.currency || 'USD'

  // title band
  logo(doc, x0, 9, 8)
  text(doc, 'KargoPazar', x0 + 10, 14.8, { size: 11, bold: true })
  text(doc, t('docs.cn.customsDeclaration'), W / 2, 13, { size: 12, bold: true, align: 'center' })
  text(doc, t('docs.cn.openedOfficially'), W / 2, 17.4, { size: 7, color: COLORS.ink2, align: 'center' })
  rect(doc, x1 - 30, 8, 30, 12, { fill: ink })
  text(doc, 'CN 23', x1 - 15, 16.4, { size: 15, bold: true, color: '#FFFFFF', align: 'center' })

  let y = 23
  const lw = iw * 0.56
  const rw = iw - lw
  partyBox(doc, t('docs.cn.from'), d.exporter, x0, y, lw, 34)
  // right: operator, item no + barcode
  rect(doc, x0 + lw, y, rw, 34, { stroke: ink, lw: 0.35 })
  boxLabel(doc, null, t('docs.cn.operator'), x0 + lw, y)
  text(doc, fit(doc, d.carrier || 'KargoPazar', rw - 4, { size: 9, bold: true }), x0 + lw + 2, y + 8.5, { size: 9, bold: true })
  text(doc, t('docs.cn.itemNo'), x0 + lw + 2, y + 14, { size: 5.8, bold: true, color: COLORS.ink2 })
  barcode(doc, d.reference || d.docNo || 'CN23', x0 + lw + 2, y + 15.5, rw - 4, 11, { align: 'left', maxModule: 0.36 })
  text(doc, d.reference || '-', x0 + lw + 2, y + 30.5, { size: 8, bold: true })
  y += 34
  partyBox(doc, t('docs.cn.to'), d.importer, x0, y, lw, 34)
  rect(doc, x0 + lw, y, rw, 34, { stroke: ink, lw: 0.35 })
  boxLabel(doc, null, t('docs.cn23.importerRef'), x0 + lw, y)
  text(doc, fit(doc, d.importer?.taxId || '-', rw - 4, { size: 8.5, bold: true }), x0 + lw + 2, y + 8.5, { size: 8.5, bold: true })
  boxLabel(doc, null, t('docs.cn23.importerContact'), x0 + lw, y + 11)
  text(doc, fit(doc, [d.importer?.phone, d.importer?.email].filter(Boolean).join(' · ') || '-', rw - 4, { size: 8 }), x0 + lw + 2, y + 19.5, { size: 8 })
  boxLabel(doc, null, t('docs.cn23.senderRef'), x0 + lw, y + 22)
  text(doc, fit(doc, d.exporter?.taxId || d.docNo || '-', rw - 4, { size: 8 }), x0 + lw + 2, y + 30.5, { size: 8 })
  y += 34

  // items table
  const cols = [
    { n: 1, label: t('docs.cn23.description'), w: iw - 118 },
    { n: 2, label: t('docs.cn23.qty'), w: 14 },
    { n: 3, label: t('docs.cn23.netWeight'), w: 20 },
    { n: 5, label: t('docs.cn23.value', { cur }), w: 24 },
    { n: 7, label: t('docs.cn23.hs'), w: 28 },
    { n: 8, label: t('docs.cn23.origin'), w: 32 },
  ]
  const headH = 9
  rect(doc, x0, y, iw, headH, { fill: COLORS.soft, stroke: ink, lw: 0.35 })
  let cx = x0
  cols.forEach(c => {
    const lines = wrap(doc, `(${c.n}) ${c.label}`, c.w - 3, { size: 5.8, bold: true })
    text(doc, lines.slice(0, 2), cx + 1.6, y + 3.4, { size: 5.8, bold: true, color: COLORS.ink2 })
    cx += c.w
  })
  y += headH
  const rowH = 6.2
  const minRows = 8
  const maxRowsPage = 14
  const items = d.items.slice(0, maxRowsPage)
  const extra = d.items.length - items.length
  const nRows = Math.max(minRows, items.length + (extra > 0 ? 1 : 0))
  const tableTop = y
  for (let i = 0; i < nRows; i++) {
    const it = items[i]
    const ry = y + i * rowH
    hline(doc, x0, x1, ry + rowH, { color: COLORS.line, lw: 0.2 })
    if (!it) {
      if (i === items.length && extra > 0) text(doc, t('docs.cn.moreItems', { n: extra }), x0 + 1.6, ry + 4.2, { size: 7, color: COLORS.ink2 })
      continue
    }
    const vals = [
      fit(doc, it.description, cols[0].w - 3, { size: 7.6 }),
      f.number(it.qty),
      it.weightKg != null ? f.number(it.weightKg, 3) : '-',
      f.number(it.totalValue, 2),
      it.hsCode || '-',
      countryName(it.origin),
    ]
    let x = x0
    vals.forEach((v, j) => {
      const right = j >= 1 && j <= 3
      text(doc, fit(doc, v, cols[j].w - 3, { size: 7.6 }), right ? x + cols[j].w - 1.6 : x + 1.6, ry + 4.2, { size: 7.6, bold: j === 3, color: ink, align: right ? 'right' : undefined })
      x += cols[j].w
    })
  }
  y += nRows * rowH
  rect(doc, x0, tableTop, iw, y - tableTop, { stroke: ink, lw: 0.35 })
  cx = x0
  cols.slice(0, -1).forEach(c => { cx += c.w; vline(doc, cx, tableTop - headH, y, { color: ink, lw: 0.25 }) })

  // totals row: (4) gross weight, (6) total value, (9) postal charges
  const tH = 12
  const tw = [iw - 118 + 14, 20 + 24, 28 + 32]
  rect(doc, x0, y, iw, tH, { stroke: ink, lw: 0.35 })
  boxLabel(doc, 4, t('docs.cn23.grossWeight'), x0, y)
  text(doc, f.kg(d.grossWeightKg), x0 + tw[0] - 2, y + 9.5, { size: 10, bold: true, align: 'right' })
  vline(doc, x0 + tw[0], y, y + tH, { color: ink, lw: 0.25 })
  boxLabel(doc, 6, t('docs.cn23.totalValue', { cur }), x0 + tw[0], y)
  text(doc, f.moneyNative(d.totalValue, cur), x0 + tw[0] + tw[1] - 2, y + 9.5, { size: 10, bold: true, align: 'right' })
  vline(doc, x0 + tw[0] + tw[1], y, y + tH, { color: ink, lw: 0.25 })
  boxLabel(doc, 9, t('docs.cn23.postalCharges'), x0 + tw[0] + tw[1], y)
  text(doc, f.moneyNative((d.freight || 0) + (d.insurance || 0), cur), x1 - 2, y + 9.5, { size: 10, bold: true, align: 'right' })
  y += tH

  // (10) category + explanation
  const catH = 22
  rect(doc, x0, y, iw, catH, { stroke: ink, lw: 0.35 })
  boxLabel(doc, 10, t('docs.cn23.category'), x0, y)
  CATEGORIES.forEach((c, i) => {
    const bx = x0 + 3 + (i % 3) * 42
    const by = y + 6.5 + Math.floor(i / 3) * 6
    checkbox(doc, bx, by, d.contentType === c || (c === 'merchandise' && !CATEGORIES.includes(d.contentType)), t(`docs.customs.types.${c}`), { size: 3.2, labelSize: 7.4 })
  })
  vline(doc, x0 + 130, y, y + catH, { color: ink, lw: 0.25 })
  boxLabel(doc, null, t('docs.cn23.explanation'), x0 + 130, y)
  const expl = d.explanation || (d.contentType === 'merchandise' ? t('docs.cn23.explanationSale') : '')
  text(doc, wrap(doc, expl || '-', iw - 134, { size: 7.4 }).slice(0, 3), x0 + 132, y + 8, { size: 7.4 })
  y += catH

  // (11) comments
  const comH = 14
  rect(doc, x0, y, iw, comH, { stroke: ink, lw: 0.35 })
  boxLabel(doc, 11, t('docs.cn23.comments'), x0, y)
  const comment = d.comments || (d.deMinimis?.suspended ? t('docs.invoice.deMinimisSuspended') : d.deMinimis?.exceeded ? t('docs.invoice.deMinimisOver', { v: f.moneyNative(d.deMinimis.threshold, d.deMinimis.currency || 'USD') }) : t('docs.cn23.commentsDefault', { mawb: d.mawb || '-', flight: d.flight || '-' }))
  text(doc, wrap(doc, comment, iw - 4, { size: 7.4 }).slice(0, 2), x0 + 2, y + 7.6, { size: 7.4 })
  y += comH

  // (12) licence (13) certificate (14) invoice
  const lH = 13
  const lwid = iw / 3
  const docs = [
    [12, t('docs.cn23.licence'), d.licenceNo || '-'],
    [13, t('docs.cn23.certificate'), d.certificateNo || '-'],
    [14, t('docs.cn23.invoice'), d.invoiceNo || d.docNo || '-'],
  ]
  docs.forEach(([n, label, v], i) => {
    rect(doc, x0 + i * lwid, y, lwid, lH, { stroke: ink, lw: 0.35 })
    boxLabel(doc, n, label, x0 + i * lwid, y)
    text(doc, fit(doc, v, lwid - 4, { size: 8.5, bold: true }), x0 + i * lwid + 2, y + 9.5, { size: 8.5, bold: true })
  })
  y += lH

  // office of origin / date of posting + (15) declaration & signature
  const sH = 34
  rect(doc, x0, y, iw * 0.38, sH, { stroke: ink, lw: 0.35 })
  boxLabel(doc, null, t('docs.cn23.officeOrigin'), x0, y)
  text(doc, fit(doc, d.exporter?.city ? `${d.exporter.city}, ${countryName(d.exporter.country)}` : '-', iw * 0.38 - 4, { size: 8.5, bold: true }), x0 + 2, y + 9.5, { size: 8.5, bold: true })
  text(doc, f.dateTime(d.date), x0 + 2, y + 15, { size: 8 })
  if (d.mawb) {
    text(doc, 'MAWB', x0 + 2, y + 22, { size: 5.8, bold: true, color: COLORS.ink2 })
    text(doc, d.mawb, x0 + 2, y + 26.5, { size: 8.5, bold: true })
    if (d.flight) text(doc, d.flight, x0 + 2, y + 31, { size: 7.5, color: COLORS.ink2 })
  }
  const sx = x0 + iw * 0.38
  const sw = iw - iw * 0.38
  rect(doc, sx, y, sw, sH, { stroke: ink, lw: 0.35 })
  boxLabel(doc, 15, t('docs.cn23.declarationTitle'), sx, y)
  const decl = wrap(doc, t('docs.cn.declaration'), sw - 4, { size: 6.6 })
  text(doc, decl.slice(0, 5), sx + 2, y + 7.6, { size: 6.6, color: COLORS.ink })
  hline(doc, sx + 2, sx + sw - 2, y + sH - 6, { color: ink, lw: 0.3 })
  text(doc, `${f.date(d.date)} · ${d.signer || ''}`, sx + 2, y + sH - 7.5, { size: 8.5, bold: true })
  text(doc, t('docs.cn.dateSignature'), sx + 2, y + sH - 2.2, { size: 6, color: COLORS.ink3 })
  y += sH

  text(doc, t('docs.cn23.footNote'), x0, Math.min(y + 5, pageH(doc) - 14), { size: 6.4, color: COLORS.ink3 })
  closeSection(doc, sec)
  return doc
}

export function cn23Doc(data, opts = {}) {
  const d = asData(data, opts)
  const doc = createDoc({ format: 'a4', title: `CN23 ${d.reference || ''}` })
  renderCn23(doc, d)
  return finalize(doc)
}
export function downloadCn23(data, opts = {}) {
  const d = asData(data, opts)
  return download(cn23Doc(d), opts.filename || fileSafe(`CN23-${d.reference || d.docNo}`) + '.pdf')
}
export const cn23BlobUrl = (data, opts) => toBlobUrl(cn23Doc(data, opts))
export const cn23DataUrl = (data, opts) => toDataUrl(cn23Doc(data, opts))
