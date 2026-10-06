// Commercial invoice (A4). Input: CustomsData (see customs.js) or a raw
// intl shipment / shipment, which is converted with buildCustomsData().
import {
  createDoc, beginPage, openSection, closeSection, finalize, docHeader, addressBox, addressLines, table,
  totalsBlock, signature, note, ensureSpace, countryName, f, t, M, pageW, COLORS, text,
  rect, download, toBlobUrl, toDataUrl, fileSafe,
} from './pdf.js'
import { buildCustomsData } from './customs.js'

const asData = (data, opts) => (data && data.form && data.exporter ? data : buildCustomsData(data, opts))

export function contentTypeLabel(type) {
  return t(`docs.customs.types.${type || 'merchandise'}`)
}

function partyExtra(p) {
  return [
    [t('docs.customs.phone'), p?.phone],
    [t('docs.customs.email'), p?.email],
    [t('docs.customs.taxId'), p?.taxId],
  ]
}

/** Draw the commercial invoice into doc (new A4 page[s]). */
export function renderCommercialInvoice(doc, data) {
  beginPage(doc, 'a4')
  const d = data
  const title = t('docs.invoice.title')
  const sec = openSection(doc, { title, number: d.docNo })
  const W = pageW(doc)
  let y = docHeader(doc, {
    title,
    subtitle: t('docs.invoice.subtitle'),
    number: d.docNo,
    barcodeValue: d.docNo,
  })
  const bw = (W - 2 * M - 6) / 2
  const h1 = addressBox(doc, t('docs.invoice.exporter'), addressLines(d.exporter), M, y, bw, { extra: partyExtra(d.exporter) })
  const h2 = addressBox(doc, t('docs.invoice.importer'), addressLines(d.importer), M + bw + 6, y, bw, { extra: partyExtra(d.importer) })
  y += Math.max(h1, h2) + 6

  const meta = [
    [t('docs.invoice.invoiceNo'), d.docNo],
    [t('docs.invoice.date'), f.date(d.date)],
    [t('docs.invoice.reference'), d.reference],
    [t('docs.invoice.reason'), contentTypeLabel(d.contentType)],
    [t('docs.invoice.origin'), countryName(d.originCountry)],
    [t('docs.invoice.destination'), countryName(d.destinationCountry)],
    [t('docs.invoice.incoterm'), d.incoterm || 'DAP'],
    [t('docs.invoice.currency'), d.currency || 'USD'],
    [t('docs.invoice.carrier'), d.carrier],
    [t('docs.invoice.awb'), d.mawb || d.tracking],
    [t('docs.invoice.flight'), d.flight],
    [t('docs.invoice.parcels'), d.parcels],
  ]
  rect(doc, M, y - 1, W - 2 * M, 25, { fill: COLORS.soft, r: 1.5 })
  y = gridIn(doc, meta, y + 3.5)
  y += 3

  y = table(doc, {
    y,
    columns: [
      { key: 'n', label: '#', width: 8, align: 'center' },
      { key: 'description', label: t('docs.invoice.description'), width: 0.42 },
      { key: 'hsCode', label: t('docs.invoice.hs'), width: 20 },
      { key: 'origin', label: t('docs.invoice.originShort'), width: 16, align: 'center' },
      { key: 'qty', label: t('docs.invoice.qty'), width: 13, align: 'right' },
      { key: 'weight', label: t('docs.invoice.weightKg'), width: 18, align: 'right' },
      { key: 'unit', label: t('docs.invoice.unitValue'), width: 22, align: 'right' },
      { key: 'total', label: t('docs.invoice.totalValue'), width: 24, align: 'right', bold: true },
    ],
    rows: d.items.map((i, idx) => ({
      n: idx + 1,
      description: i.description + (i.sku ? `\n${i.sku}` : ''),
      hsCode: i.hsCode || '-',
      origin: i.origin || '-',
      qty: f.number(i.qty),
      weight: i.weightKg != null ? f.number(i.weightKg, 2) : '-',
      unit: f.moneyNative(i.unitValue, d.currency),
      total: f.moneyNative(i.totalValue, d.currency),
    })),
    onPageBreak: () => M + 6,
  })

  y = ensureSpace(doc, y + 4, 50)
  const totals = [
    [t('docs.invoice.totalQty'), f.number(d.items.reduce((s, i) => s + i.qty, 0))],
    [t('docs.invoice.netWeight'), f.kg(d.netWeightKg)],
    [t('docs.invoice.grossWeight'), f.kg(d.grossWeightKg)],
    [t('docs.invoice.subtotal'), f.moneyNative(d.totalValue, d.currency)],
    [t('docs.invoice.freight'), f.moneyNative(d.freight || 0, d.currency)],
    [t('docs.invoice.insurance'), f.moneyNative(d.insurance || 0, d.currency)],
    [t('docs.invoice.grandTotal'), f.moneyNative(d.totalValue + (d.freight || 0) + (d.insurance || 0), d.currency), { bold: true }],
  ]
  const ty = totalsBlock(doc, totals, y)
  // left column: notes + declaration
  let ny = y + 1
  const lw = W - 2 * M - 86
  text(doc, t('docs.invoice.notes').toUpperCase(), M, ny + 2, { size: 6.5, bold: true, color: COLORS.ink3 })
  ny += 5.5
  if (d.localCurrency) ny = note(doc, t('docs.invoice.fx', { cur: d.localCurrency.code, total: f.moneyNative(d.localCurrency.total, d.localCurrency.code), rate: f.number(d.localCurrency.fxRate, 4) }), M, ny, lw)
  if (d.deMinimis) ny = note(doc, d.deMinimis.suspended ? t('docs.invoice.deMinimisSuspended') : d.deMinimis.exceeded ? t('docs.invoice.deMinimisOver', { v: f.moneyNative(d.deMinimis.threshold, d.deMinimis.currency || 'USD') }) : t('docs.invoice.deMinimisUnder', { v: f.moneyNative(d.deMinimis.threshold, d.deMinimis.currency || 'USD') }), M, ny, lw, { color: d.deMinimis.exceeded ? COLORS.warning : COLORS.ink2, bold: d.deMinimis.exceeded })
  if (d.comments) ny = note(doc, d.comments, M, ny, lw)
  if ((d.currency || 'USD') === 'USD' && f.fxNote()) ny = note(doc, t('fx.displayEquivalent', { v: f.money(d.totalValue + (d.freight || 0) + (d.insurance || 0)), note: f.fxNote() }), M, ny, lw)
  ny = note(doc, t('docs.invoice.noteCommercial'), M, ny, lw)
  ny += 2
  text(doc, t('docs.invoice.declarationTitle').toUpperCase(), M, ny + 2, { size: 6.5, bold: true, color: COLORS.ink3 })
  ny = note(doc, t('docs.invoice.declaration'), M, ny + 5.5, lw, { size: 7.4, color: COLORS.ink })

  y = Math.max(ty, ny) + 2
  y = ensureSpace(doc, y, 17) + 12
  const sw = (W - 2 * M - 12) / 3
  signature(doc, M, y, sw, t('docs.invoice.signature'), { name: d.signer })
  signature(doc, M + sw + 6, y, sw, t('docs.invoice.signerTitle'), { name: t('docs.invoice.exporterRole') })
  signature(doc, M + 2 * (sw + 6), y, sw, t('docs.invoice.placeDate'), { name: `${d.exporter?.city || ''}${d.exporter?.city ? ', ' : ''}${f.date(d.date)}` })
  closeSection(doc, sec)
  return doc
}

function gridIn(doc, pairs, y) {
  const W = pageW(doc)
  const cols = 4
  const cw = (W - 2 * M - 8) / cols
  pairs.forEach(([k, v], i) => {
    const cx = M + 3 + (i % cols) * (cw + 0.7)
    const cy = y + Math.floor(i / cols) * 7.5
    text(doc, String(k).toUpperCase(), cx, cy, { size: 6, bold: true, color: COLORS.ink3 })
    const val = v == null || v === '' ? '-' : String(v)
    doc.setFontSize(8.2)
    text(doc, doc.splitTextToSize(val, cw - 2)[0], cx, cy + 3.5, { size: 8.2, bold: true })
  })
  return y + Math.ceil(pairs.length / cols) * 7.5
}

export function commercialInvoiceDoc(data, opts = {}) {
  const d = asData(data, opts)
  const doc = createDoc({ format: 'a4', title: `${t('docs.invoice.title')} ${d.docNo}` })
  renderCommercialInvoice(doc, d)
  return finalize(doc)
}

export function downloadCommercialInvoice(data, opts = {}) {
  const d = asData(data, opts)
  return download(commercialInvoiceDoc(d), opts.filename || fileSafe(`${t('docs.files.commercialInvoice')}-${d.reference || d.docNo}`) + '.pdf')
}
export const commercialInvoiceBlobUrl = (data, opts) => toBlobUrl(commercialInvoiceDoc(data, opts))
export const commercialInvoiceDataUrl = (data, opts) => toDataUrl(commercialInvoiceDoc(data, opts))
