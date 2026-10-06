// 4x6 in shipping labels (PDF and identical SVG preview).
//
// The layout is written once against a tiny "painter" interface and rendered
// either into jsPDF (download / print / merged batch PDF) or into a
// self contained SVG string (on screen preview; the Noto Sans font is embedded
// so the preview matches the PDF glyph for glyph).
import { jsPDF } from 'jspdf'
import {
  createDoc, beginPage, carrierInfo, serviceInfo, hubInfo, companyInfo, intlImporter, countryName, code128Modules,
  barRuns, qrMatrix, withOpacity, FONT, PT, SIZES, COLORS, f, t, fileSafe, download, toDataUrl, toBlobUrl,
  printDoc, iso, LB_PER_KG, clean, safeAll,
} from './pdf.js'
import { NOTO_SANS_REGULAR, NOTO_SANS_BOLD } from './fonts/notoSans.js'
import { CARRIERS } from '@/shared/carriers.js'

const [W, H] = SIZES.label
export const WATERMARK = 'TEMPORARY LABEL · NOT FOR CARRIER USE'

// --------------------------------------------------------------- label data

function accountLabel(id, carrier) {
  const acc = (safeAll('carrier_accounts') || []).find(a => a.id === id)
  if (acc?.accountMasked) return `${carrier.name} ${acc.accountMasked}`
  return id
}

/**
 * Normalize a shipment (shipments.json shape) into the fields a label needs.
 * Works for last mile shipments, return labels and dummy (temporary) labels.
 */
export function labelData(shipment, opts = {}) {
  const s = shipment || {}
  const carrier = carrierInfo(s.carrier, opts.carriers)
  const service = serviceInfo(s.carrier, s.service, opts.carriers)
  const dummy = !!(opts.dummy ?? s.isDummy)
  const ownAccount = typeof s.account === 'string' && s.account.startsWith('own:')
  const pkg = s.package || {}
  const tracking = dummy ? (opts.platformRef || s.platformRef || s.dummyRef || s.trackingNo || s.id) : s.trackingNo
  return {
    id: s.id,
    carrierCode: carrier.code,
    carrierName: carrier.name,
    color: carrier.color || COLORS.ink,
    ink: carrier.ink || '#FFFFFF',
    serviceName: service.name || s.service || '-',
    serviceLevel: service.level || null,
    zone: s.zone ?? null,
    from: s.from || null,
    to: s.to || null,
    trackingNo: tracking || '-',
    reference: s.reference || s.orderId || '-',
    orderId: s.orderId || null,
    hub: s.hub || '-',
    weightLb: pkg.weightLb ?? null,
    billableLb: s.billableLb ?? null,
    dims: pkg.lengthIn ? pkg : null,
    createdAt: iso(s.createdAt) || new Date().toISOString(),
    account: ownAccount ? accountLabel(s.account.slice(4), carrier) : null,
    residential: s.to?.residential ?? null,
    declaredValue: s.declaredValue ?? null,
    isReturn: !!(s.isReturn || opts.isReturn),
    dummy,
    replaced: !!(opts.replaced ?? s.dummyStatus === 'replaced'),
    parcel: opts.parcel || null, // { index, count, ref }
    note: opts.note || null,
  }
}

/**
 * Temporary (dummy) label data for an international first mile shipment
 * (intl_shipments.json shape). One entry per parcel.
 */
export function dummyLabelsFromIntl(intl, opts = {}) {
  const s = intl || {}
  const hub = hubInfo(s.destHub, opts.hubs)
  const company = companyInfo(opts.company)
  const ref = s.dummyLabel?.ref || opts.platformRef || 'KPZ-TMP-' + String(s.id || '').replace(/\D/g, '').padStart(6, '0')
  const to = {
    name: intlImporter(s, company).name,
    company: 'c/o KargoPazar ' + (s.destHub || ''),
    ...(hub?.address || {}),
    residential: false,
  }
  const parcels = s.parcels?.length ? s.parcels : [{ ref: s.id, weightKg: s.totalWeightKg }]
  return parcels.map((p, i) => labelData({
    id: s.id,
    carrier: 'DHLX',
    service: 'EXPRESS_WW',
    from: s.sender,
    to,
    reference: s.id,
    hub: s.destHub,
    createdAt: s.dummyLabel?.createdAt || s.createdAt,
    package: {
      lengthIn: p.lengthCm ? Math.round((p.lengthCm / 2.54) * 10) / 10 : undefined,
      widthIn: p.widthCm ? Math.round((p.widthCm / 2.54) * 10) / 10 : undefined,
      heightIn: p.heightCm ? Math.round((p.heightCm / 2.54) * 10) / 10 : undefined,
      weightLb: p.weightKg != null ? Math.round(p.weightKg * LB_PER_KG * 10) / 10 : null,
    },
  }, {
    ...opts,
    dummy: true,
    platformRef: ref,
    replaced: opts.replaced ?? s.dummyLabel?.status === 'replaced',
    parcel: { index: i + 1, count: parcels.length, ref: p.ref },
  }))
}

// ---------------------------------------------------------------- painters

let measureDoc = null
function measurer() {
  if (!measureDoc) {
    measureDoc = new jsPDF({ unit: 'mm', format: SIZES.label })
    measureDoc.addFileToVFS('r.ttf', NOTO_SANS_REGULAR); measureDoc.addFont('r.ttf', FONT, 'normal')
    measureDoc.addFileToVFS('b.ttf', NOTO_SANS_BOLD); measureDoc.addFont('b.ttf', FONT, 'bold')
  }
  return measureDoc
}
function measure(str, size, bold) {
  const d = measurer()
  d.setFont(FONT, bold ? 'bold' : 'normal'); d.setFontSize(size)
  return d.getTextWidth(clean(str))
}
function fitText(str, max, size, bold) {
  let s = clean(str)
  if (measure(s, size, bold) <= max) return s
  while (s.length > 1 && measure(s + '...', size, bold) > max) s = s.slice(0, -1)
  return s.trimEnd() + '...'
}
/** Largest size (down to min) at which str fits max. */
function fitSize(str, max, size, min, bold) {
  let s = size
  while (s > min && measure(str, s, bold) > max) s -= 0.5
  return s
}

function pdfPainter(doc) {
  return {
    rect(x, y, w, h, { fill, stroke, lw = 0.3 } = {}) {
      if (fill) doc.setFillColor(fill)
      if (stroke) { doc.setDrawColor(stroke); doc.setLineWidth(lw) }
      doc.rect(x, y, w, h, fill && stroke ? 'FD' : fill ? 'F' : 'S')
    },
    line(x1, y1, x2, y2, { color = '#000000', lw = 0.3 } = {}) {
      doc.setDrawColor(color); doc.setLineWidth(lw); doc.line(x1, y1, x2, y2)
    },
    text(str, x, y, { size = 8, bold = false, color = '#000000', align, angle, opacity } = {}) {
      const draw = () => {
        doc.setFont(FONT, bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color)
        const o = {}
        if (align && align !== 'left') o.align = align
        if (angle) o.angle = angle
        doc.text(clean(str), x, y, o)
      }
      if (opacity != null && opacity < 1) withOpacity(doc, opacity, draw)
      else draw()
    },
    bars(modules, x, y, w, h) {
      const mw = w / modules.length
      doc.setFillColor('#000000')
      for (const [s, len] of barRuns(modules)) doc.rect(x + s * mw, y, len * mw, h, 'F')
    },
    qr(value, x, y, size) {
      const m = qrMatrix(value)
      const q = 1
      const cell = size / (m.size + q * 2)
      doc.setFillColor('#000000')
      for (let r = 0; r < m.size; r++) {
        let c = 0
        while (c < m.size) {
          if (m.get(r, c)) {
            let e = c
            while (e < m.size && m.get(r, e)) e++
            doc.rect(x + (c + q) * cell, y + (r + q) * cell, (e - c) * cell + 0.01, cell + 0.01, 'F')
            c = e
          } else c++
        }
      }
    },
    logo(x, y, s) {
      const k = s / 32
      doc.setFillColor('#151827'); doc.roundedRect(x + 2 * k, y + 2 * k, 28 * k, 28 * k, 7 * k, 7 * k, 'F')
      doc.setDrawColor('#FFFFFF'); doc.setLineWidth(2.2 * k); doc.setLineCap('round')
      doc.line(x + 9 * k, y + 9 * k, x + 9 * k, y + 23 * k)
      doc.line(x + 9 * k, y + 16 * k, x + 18 * k, y + 9 * k)
      doc.line(x + 9 * k, y + 16 * k, x + 18 * k, y + 23 * k)
      doc.setLineCap('butt')
    },
  }
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = v => Math.round(v * 1000) / 1000

function svgPainter() {
  const parts = []
  return {
    parts,
    rect(x, y, w, h, { fill, stroke, lw = 0.3 } = {}) {
      parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill || 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${lw}"` : ''}/>`)
    },
    line(x1, y1, x2, y2, { color = '#000000', lw = 0.3 } = {}) {
      parts.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${lw}"/>`)
    },
    text(str, x, y, { size = 8, bold = false, color = '#000000', align, angle, opacity } = {}) {
      const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
      const tr = angle ? ` transform="rotate(${-angle} ${n(x)} ${n(y)})"` : ''
      const op = opacity != null && opacity < 1 ? ` fill-opacity="${opacity}"` : ''
      parts.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(size * PT)}" font-weight="${bold ? 700 : 400}" fill="${color}" text-anchor="${anchor}"${op}${tr}>${esc(clean(str))}</text>`)
    },
    bars(modules, x, y, w, h) {
      const mw = w / modules.length
      const d = barRuns(modules).map(([s, len]) => `M${n(x + s * mw)} ${n(y)}h${n(len * mw)}v${n(h)}h${n(-len * mw)}z`).join('')
      parts.push(`<path d="${d}" fill="#000"/>`)
    },
    qr(value, x, y, size) {
      const m = qrMatrix(value)
      const q = 1
      const cell = size / (m.size + q * 2)
      let d = ''
      for (let r = 0; r < m.size; r++) {
        let c = 0
        while (c < m.size) {
          if (m.get(r, c)) {
            let e = c
            while (e < m.size && m.get(r, e)) e++
            d += `M${n(x + (c + q) * cell)} ${n(y + (r + q) * cell)}h${n((e - c) * cell + 0.01)}v${n(cell + 0.01)}h${n(-(e - c) * cell - 0.01)}z`
            c = e
          } else c++
        }
      }
      parts.push(`<path d="${d}" fill="#000"/>`)
    },
    logo(x, y, s) {
      const k = s / 32
      parts.push(`<rect x="${n(x + 2 * k)}" y="${n(y + 2 * k)}" width="${n(28 * k)}" height="${n(28 * k)}" rx="${n(7 * k)}" fill="#151827"/>`)
      parts.push(`<path d="M${n(x + 9 * k)} ${n(y + 9 * k)}V${n(y + 23 * k)}M${n(x + 9 * k)} ${n(y + 16 * k)}L${n(x + 18 * k)} ${n(y + 9 * k)}M${n(x + 9 * k)} ${n(y + 16 * k)}L${n(x + 18 * k)} ${n(y + 23 * k)}" stroke="#fff" stroke-width="${n(2.2 * k)}" stroke-linecap="round" fill="none"/>`)
    },
  }
}

// ------------------------------------------------------------------- layout

function formatTracking(no) {
  const s = String(no || '')
  if (/^1Z/.test(s)) return s.replace(/^(1Z)(\w{3})(\w{3})(\w{2})(\w{4})(\w{4})$/, '$1 $2 $3 $4 $5 $6')
  if (/^\d{20,22}$/.test(s)) return s.replace(/(\d{4})(?=\d)/g, '$1 ')
  if (/^\d{12}$/.test(s)) return s.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')
  return s
}

function levelMark(d) {
  if (d.dummy) return 'T'
  if (d.isReturn) return 'R'
  return { express: 'X', standard: 'G', economy: 'E' }[d.serviceLevel] || 'G'
}

function paintLabel(p, d) {
  const x0 = 2.5, x1 = W - 2.5, iw = x1 - x0
  const black = '#000000'
  const gray = '#555555'

  // frame
  p.rect(x0, 2.5, iw, H - 5, { stroke: black, lw: 0.5 })

  // A. carrier band
  const bandH = 17
  p.rect(x0, 2.5, iw, bandH, { fill: d.color })
  const nameSize = fitSize(d.carrierName, iw - 26, 17, 11, true)
  p.text(d.carrierName, x0 + 3.5, 11.6, { size: nameSize, bold: true, color: d.ink })
  p.text(fitText(d.serviceName, iw - 26, 8.5, false), x0 + 3.5, 16.6, { size: 8.5, color: d.ink })
  // level box
  const bx = x1 - 17, by = 4.5
  p.rect(bx, by, 13, 13, { fill: '#FFFFFF', stroke: black, lw: 0.4 })
  p.text(levelMark(d), bx + 6.5, by + 9.6, { size: 20, bold: true, color: black, align: 'center' })

  // B. from + ship info
  let y = 2.5 + bandH
  const colX = 63
  p.text(t('docs.label.from'), x0 + 3, y + 4.2, { size: 6, bold: true, color: gray })
  const fromLines = []
  const fr = d.from || {}
  if (fr.name) fromLines.push([fr.name, true])
  if (fr.company && fr.company !== fr.name) fromLines.push([fr.company, false])
  if (fr.line1) fromLines.push([[fr.line1, fr.line2].filter(Boolean).join(', '), false])
  fromLines.push([[fr.city, [fr.state, fr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') + (fr.country && fr.country !== 'US' ? ' ' + fr.country : ''), false])
  fromLines.slice(0, 4).forEach(([l, b], i) => p.text(fitText(l, colX - x0 - 5, 7.2, b), x0 + 3, y + 8 + i * 3.1, { size: 7.2, bold: b, color: black }))
  p.line(colX - 1.5, y, colX - 1.5, y + 22, { color: black, lw: 0.3 })
  const info = [
    [t('docs.label.shipDate'), f.date(d.createdAt)],
    [t('docs.label.weight'), d.weightLb != null ? f.lb(d.weightLb) + (d.dummy ? ` (${f.kg(d.weightLb / LB_PER_KG, 1)})` : '') : '-'],
    [t('docs.label.dims'), d.dims ? f.dims(d.dims) : '-'],
  ]
  info.forEach(([k, v], i) => {
    p.text(k, colX, y + 4.2 + i * 6.3, { size: 5.8, bold: true, color: gray })
    p.text(fitText(v, x1 - colX - 1.5, 7.4, true), colX, y + 7.2 + i * 6.3, { size: 7.4, bold: true, color: black })
  })
  y += 22
  p.line(x0, y, x1, y, { color: black, lw: 0.8 })

  // C. ship to + QR
  const qrSize = 25
  const toMax = iw - qrSize - 7
  p.text(t('docs.label.shipTo'), x0 + 3, y + 4.6, { size: 6.5, bold: true, color: gray })
  const to = d.to || {}
  let ty = y + 10.4
  const nameSz = fitSize(to.name || '-', toMax, 12, 9, true)
  p.text(fitText(to.name || '-', toMax, nameSz, true), x0 + 3, ty, { size: nameSz, bold: true, color: black }); ty += 4.9
  if (to.company) { p.text(fitText(to.company, toMax, 8.8, false), x0 + 3, ty, { size: 8.8, color: black }); ty += 4.1 }
  if (to.line1) { p.text(fitText(to.line1, toMax, 9.6, false), x0 + 3, ty, { size: 9.6, color: black }); ty += 4.3 }
  if (to.line2) { p.text(fitText(to.line2, toMax, 9.6, false), x0 + 3, ty, { size: 9.6, color: black }); ty += 4.3 }
  const cityLine = [to.city ? String(to.city).toUpperCase() : '', [to.state, to.zip].filter(Boolean).join(' ')].filter(Boolean).join(' ')
  const csz = fitSize(cityLine, toMax, 12.5, 9, true)
  p.text(fitText(cityLine, toMax, csz, true), x0 + 3, ty + 0.6, { size: csz, bold: true, color: black }); ty += 5
  p.text(fitText(countryName(to.country || 'US').toUpperCase(), toMax, 7.5, false), x0 + 3, ty + 0.4, { size: 7.5, color: gray })
  const qrValue = [d.dummy ? 'KPZ-TMP' : d.carrierCode, d.trackingNo, to.zip || '', to.country || 'US', d.id || ''].join('|')
  p.qr(qrValue, x1 - qrSize - 2, y + 2.5, qrSize)
  const tag = d.residential == null ? '' : d.residential ? t('docs.label.residential') : t('docs.label.commercial')
  if (tag) p.text(tag, x1 - qrSize / 2 - 2, y + qrSize + 5, { size: 6, bold: true, color: black, align: 'center' })
  y += 38
  p.line(x0, y, x1, y, { color: black, lw: 0.8 })

  // D. service strip
  const stripH = 10
  if (d.dummy) {
    p.rect(x0, y, iw, stripH, { fill: '#B42318' })
    const sz = fitSize(WATERMARK, iw - 6, 9.5, 6, true)
    p.text(WATERMARK, x0 + iw / 2, y + 6.6, { size: sz, bold: true, color: '#FFFFFF', align: 'center' })
  } else {
    p.rect(x0, y, iw, stripH, { fill: black })
    const svc = (d.isReturn ? t('docs.label.returnPrefix') + ' ' : '') + String(d.serviceName).toUpperCase()
    p.text(fitText(svc, iw - 30, 11, true), x0 + 3, y + 7, { size: 11, bold: true, color: '#FFFFFF' })
    const right = d.billableLb != null ? `${f.number(d.billableLb, 0)} LB` + (d.zone ? ` · Z${d.zone}` : '') : ''
    p.text(right, x1 - 3, y + 7, { size: 9, bold: true, color: '#FFFFFF', align: 'right' })
  }
  y += stripH

  // E. barcode
  p.text(d.dummy ? t('docs.label.platformRef') : t('docs.label.tracking'), x0 + 3, y + 4.4, { size: 6.2, bold: true, color: gray })
  if (d.parcel) p.text(t('docs.label.parcelOf', { i: d.parcel.index, n: d.parcel.count }), x1 - 3, y + 4.4, { size: 6.5, bold: true, color: black, align: 'right' })
  const modules = code128Modules(d.trackingNo)
  const maxW = iw - 10
  const mw = Math.min(0.48, maxW / modules.length)
  const bw = mw * modules.length
  p.bars(modules, x0 + (iw - bw) / 2, y + 6.5, bw, 21)
  const trk = formatTracking(d.trackingNo)
  p.text(trk, x0 + iw / 2, y + 32.2, { size: fitSize(trk, iw - 6, 11.5, 7, true), bold: true, color: black, align: 'center' })
  y += 35.5
  p.line(x0, y, x1, y, { color: black, lw: 0.8 })

  // F. references
  const cells = [
    [t('docs.label.reference'), d.reference],
    [t('docs.label.shipment'), d.parcel?.ref || d.id || '-'],
    [t('docs.label.hub'), d.hub],
    [t('docs.label.account'), d.account ? t('docs.label.ownAccount', { id: d.account }) : t('docs.label.platform')],
    [t('docs.label.value'), d.declaredValue != null ? f.moneyNative(d.declaredValue) : '-'],
    [t('docs.label.format'), '4x6 in'],
  ]
  const cw = iw / 3
  cells.forEach(([k, v], i) => {
    const cx = x0 + 3 + (i % 3) * cw
    const cy = y + 4 + Math.floor(i / 3) * 7.4
    p.text(k, cx, cy, { size: 5.6, bold: true, color: gray })
    p.text(fitText(v ?? '-', cw - 3.5, 7.2, true), cx, cy + 3.2, { size: 7.2, bold: true, color: black })
  })
  y += 15.8
  p.line(x0, y, x1, y, { color: black, lw: 0.3 })

  // footer
  const fy = H - 2.5 - 2.3
  p.logo(x0 + 2.2, fy - 3.2, 4.2)
  p.text('KargoPazar', x0 + 7, fy, { size: 7, bold: true, color: black })
  const foot = d.dummy ? t('docs.label.dummyNote') : (d.note || t('docs.label.footer'))
  p.text(fitText(foot, iw - 30, 5.8, false), x1 - 3, fy, { size: 5.8, color: gray, align: 'right' })

  // watermark for temporary labels
  if (d.dummy) {
    const wm = WATERMARK
    const angle = 56
    const size = fitSize(wm, 150, 15, 8, true)
    const tw = measure(wm, size, true)
    const rad = (angle * Math.PI) / 180
    const th = size * PT * 0.7
    const cx = W / 2, cy = H / 2 + 6
    const ox = cx - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * th) / 2
    const oy = cy + (Math.sin(rad) * tw) / 2 + (Math.cos(rad) * th) / 2
    p.text(wm, ox, oy, { size, bold: true, color: '#B42318', angle, opacity: 0.22 })
  }
  if (d.replaced) {
    const lbl = t('docs.label.replaced')
    const size = 22
    const tw = measure(lbl, size, true)
    const angle = 18
    const rad = (angle * Math.PI) / 180
    const th = size * PT * 0.7
    const cx = W / 2, cy = 72
    const ox = cx - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * th) / 2
    const oy = cy + (Math.sin(rad) * tw) / 2 + (Math.cos(rad) * th) / 2
    p.text(lbl, ox, oy, { size, bold: true, color: '#1E6B45', angle, opacity: 0.75 })
  }
}

function paintSeparator(p, { carrierCode, count, services, title, date, index, total }) {
  const c = carrierInfo(carrierCode)
  const x0 = 2.5, x1 = W - 2.5, iw = x1 - x0
  p.rect(x0, 2.5, iw, H - 5, { stroke: '#000000', lw: 0.5 })
  p.rect(x0, 2.5, iw, 46, { fill: c.color })
  p.text(t('docs.label.groupTitle'), x0 + 5, 13, { size: 8, bold: true, color: c.ink })
  p.text(c.name, x0 + 5, 27, { size: fitSize(c.name, iw - 10, 26, 14, true), bold: true, color: c.ink })
  p.text(t('docs.label.groupCount', { n: count }), x0 + 5, 40, { size: 13, bold: true, color: c.ink })
  let y = 60
  p.text(t('docs.label.groupServices'), x0 + 5, y, { size: 7, bold: true, color: '#555555' })
  y += 6
  services.slice(0, 10).forEach(([name, cnt]) => {
    p.text(fitText(name, iw - 30, 10, false), x0 + 5, y, { size: 10, color: '#000000' })
    p.text(String(cnt), x1 - 5, y, { size: 10, bold: true, color: '#000000', align: 'right' })
    p.line(x0 + 5, y + 2, x1 - 5, y + 2, { color: '#DDDDDD', lw: 0.2 })
    y += 7
  })
  const by = H - 42
  if (title) {
    p.text(t('docs.label.batch'), x0 + 5, by, { size: 7, bold: true, color: '#555555' })
    p.text(fitText(title, iw - 10, 11, true), x0 + 5, by + 5.5, { size: 11, bold: true, color: '#000000' })
  }
  p.text(t('docs.label.printed'), x0 + 5, by + 14, { size: 7, bold: true, color: '#555555' })
  p.text(f.dateTime(date), x0 + 5, by + 19.5, { size: 10, bold: true, color: '#000000' })
  p.text(t('docs.label.groupOf', { i: index, n: total }), x1 - 5, by + 19.5, { size: 10, bold: true, color: '#000000', align: 'right' })
  p.logo(x0 + 4.4, H - 11.2, 4.2)
  p.text('KargoPazar', x0 + 9.2, H - 8, { size: 7, bold: true, color: '#000000' })
}

// -------------------------------------------------------------- public API

/** Draw one label page into an existing doc (used by batch / merged PDFs). */
export function renderLabel(doc, shipmentOrData, opts = {}) {
  const d = shipmentOrData && shipmentOrData.carrierName && 'trackingNo' in shipmentOrData && 'color' in shipmentOrData ? shipmentOrData : labelData(shipmentOrData, opts)
  beginPage(doc, 'label')
  paintLabel(pdfPainter(doc), d)
  return doc
}

/** Single label PDF (4x6 in). */
export function labelDoc(shipment, opts = {}) {
  const doc = createDoc({ format: 'label', title: `${t('docs.label.title')} ${shipment?.id || ''}` })
  return renderLabel(doc, shipment, opts)
}

export function labelFilename(shipment, opts = {}) {
  const base = opts.dummy || shipment?.isDummy ? t('docs.files.dummyLabel') : t('docs.files.label')
  return fileSafe(`${base}-${shipment?.id || 'label'}`) + '.pdf'
}

export function downloadLabel(shipment, opts = {}) {
  return download(labelDoc(shipment, opts), opts.filename || labelFilename(shipment, opts))
}
export const labelDataUrl = (shipment, opts) => toDataUrl(labelDoc(shipment, opts))
export const labelBlobUrl = (shipment, opts) => toBlobUrl(labelDoc(shipment, opts))
export const printLabel = (shipment, opts) => printDoc(labelDoc(shipment, opts))

let fontCss = null
function svgFontCss() {
  if (!fontCss) {
    fontCss = `@font-face{font-family:KpzLabel;font-weight:400;src:url(data:font/ttf;base64,${NOTO_SANS_REGULAR}) format('truetype')}` +
      `@font-face{font-family:KpzLabel;font-weight:700;src:url(data:font/ttf;base64,${NOTO_SANS_BOLD}) format('truetype')}`
  }
  return fontCss
}

/**
 * Self contained SVG string of the label (same layout as the PDF).
 * Use with v-html, or as <img :src="labelSvgDataUrl(s)">. Width/height default
 * to the physical size (4in x 6in); pass { width: '100%' } for fluid previews.
 */
export function labelSvg(shipment, opts = {}) {
  const d = labelData(shipment, opts)
  const p = svgPainter()
  paintLabel(p, d)
  const w = opts.width || '4in', h = opts.height || (opts.width ? 'auto' : '6in')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${w}"${h === 'auto' ? '' : ` height="${h}"`} role="img" aria-label="${esc(t('docs.label.title') + ' ' + (d.trackingNo || ''))}">` +
    `<style>${svgFontCss()}text{font-family:KpzLabel,'Noto Sans',Inter,Arial,sans-serif}</style>` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${p.parts.join('')}</svg>`
}

export function labelSvgDataUrl(shipment, opts = {}) {
  const svg = labelSvg(shipment, opts)
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
}

// ---------------------------------------------------------- dummy labels

/** Temporary label PDF for a first mile shipment (one 4x6 page per parcel). */
export function dummyLabelDoc(intl, opts = {}) {
  const doc = createDoc({ format: 'label', title: `${t('docs.label.dummyTitle')} ${intl?.id || ''}` })
  for (const d of dummyLabelsFromIntl(intl, opts)) {
    beginPage(doc, 'label')
    paintLabel(pdfPainter(doc), d)
  }
  return doc
}
export function downloadDummyLabel(intl, opts = {}) {
  return download(dummyLabelDoc(intl, opts), opts.filename || fileSafe(`${t('docs.files.dummyLabel')}-${intl?.id || ''}`) + '.pdf')
}
export const dummyLabelDataUrl = (intl, opts) => toDataUrl(dummyLabelDoc(intl, opts))
export const dummyLabelBlobUrl = (intl, opts) => toBlobUrl(dummyLabelDoc(intl, opts))

/** SVG preview of the first parcel's temporary label. */
export function dummyLabelSvg(intl, opts = {}) {
  const [d] = dummyLabelsFromIntl(intl, opts)
  const p = svgPainter()
  paintLabel(p, d)
  const w = opts.width || '4in', h = opts.height || (opts.width ? 'auto' : '6in')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${w}"${h === 'auto' ? '' : ` height="${h}"`} role="img" aria-label="${esc(t('docs.label.dummyTitle'))}">` +
    `<style>${svgFontCss()}text{font-family:KpzLabel,'Noto Sans',Inter,Arial,sans-serif}</style>` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${p.parts.join('')}</svg>`
}

// ---------------------------------------------------------- combined PDF

const carrierOrder = code => {
  const i = CARRIERS.findIndex(c => c.code === code)
  return i < 0 ? 99 : i
}

/**
 * One PDF with every label (4x6 pages), grouped by carrier, each group
 * preceded by a separator sheet (disable with { separators: false }).
 * opts: { title (batch id), separators, carriers }
 */
export function combinedLabels(shipments, opts = {}) {
  const list = (shipments || []).filter(Boolean)
  const doc = createDoc({ format: 'label', title: opts.title || t('docs.label.combinedTitle') })
  const groups = new Map()
  for (const s of list) {
    if (!groups.has(s.carrier)) groups.set(s.carrier, [])
    groups.get(s.carrier).push(s)
  }
  const codes = [...groups.keys()].sort((a, b) => carrierOrder(a) - carrierOrder(b))
  const now = new Date().toISOString()
  codes.forEach((code, gi) => {
    const items = groups.get(code).slice().sort((a, b) => String(a.service).localeCompare(String(b.service)) || String(a.id).localeCompare(String(b.id)))
    if (opts.separators !== false) {
      const svc = new Map()
      for (const s of items) {
        const name = serviceInfo(s.carrier, s.service, opts.carriers).name || s.service
        svc.set(name, (svc.get(name) || 0) + 1)
      }
      beginPage(doc, 'label')
      paintSeparator(pdfPainter(doc), { carrierCode: code, count: items.length, services: [...svc.entries()], title: opts.title, date: now, index: gi + 1, total: codes.length })
    }
    for (const s of items) renderLabel(doc, s, opts)
  })
  if (!list.length) {
    beginPage(doc, 'label')
    pdfPainter(doc).text(t('docs.common.noRows'), W / 2, H / 2, { size: 10, color: '#555555', align: 'center' })
  }
  return doc
}

export function downloadCombinedLabels(shipments, opts = {}) {
  const name = opts.filename || fileSafe(`${t('docs.files.labels')}-${opts.title || new Date().toISOString().slice(0, 10)}`) + '.pdf'
  return download(combinedLabels(shipments, opts), name)
}
export const combinedLabelsBlobUrl = (shipments, opts) => toBlobUrl(combinedLabels(shipments, opts))
