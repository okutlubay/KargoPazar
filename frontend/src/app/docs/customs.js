// Customs document data model shared by the commercial invoice, CN22 and CN23
// generators, plus the merged "all documents" PDF (Section 6.6).
//
// CustomsData shape (all generators accept it; build it with buildCustomsData):
// {
//   id, docNo, date (ISO), reference, currency: 'USD',
//   exporter: { name, company, line1, line2, city, state, zip, country, phone, email, taxId },
//   importer: { ...same },
//   originCountry, destinationCountry, contentType: 'merchandise'|'gift'|'sample'|'documents'|'returned'|'other',
//   explanation, incoterm, carrier, tracking, mawb, flight, parcels, grossWeightKg,
//   items: [{ sku, description, hsCode, origin, qty, unitValue, totalValue, weightKg }],
//   totalValue, netWeightKg, freight, insurance, comments, invoiceNo, licenceNo, certificateNo,
//   signer, deMinimis: { threshold, currency, suspended, exceeded } | null (suspended = no exemption)
// }
import { companyInfo, intlImporter, hubInfo, iso, LB_PER_KG, safeAll, createDoc, finalize, download, toBlobUrl, toDataUrl, fileSafe, t } from './pdf.js'
import { renderCommercialInvoice } from './invoice.js'
import { renderCn22 } from './cn22.js'
import { renderCn23 } from './cn23.js'

export const CN22_LIMIT_USD = 400

/** 'cn22' for declared value <= $400, otherwise 'cn23'. */
export function customsFormFor(valueUsd) {
  return Number(valueUsd) <= CN22_LIMIT_USD ? 'cn22' : 'cn23'
}

const r2 = v => Math.round((Number(v) || 0) * 100) / 100

function productBySku(sku) {
  const list = safeAll('products') || []
  return list.find(p => p.sku === sku) || null
}

function normItems(items) {
  return items.map(i => {
    const p = !i.hsCode || !i.origin ? productBySku(i.sku) : null
    const qty = Number(i.qty) || 1
    const unitValue = r2(i.unitValue ?? (i.totalValue != null ? i.totalValue / qty : 0))
    return {
      sku: i.sku || '',
      description: i.description || i.title || '-',
      hsCode: i.hsCode || p?.hsCode || '',
      origin: i.origin || p?.origin || '',
      qty,
      unitValue,
      totalValue: r2(i.totalValue ?? unitValue * qty),
      weightKg: i.weightKg != null ? Math.round(i.weightKg * 1000) / 1000 : null,
    }
  })
}

function finish(d) {
  d.items = normItems(d.items || [])
  d.totalValue = r2(d.items.reduce((s, i) => s + i.totalValue, 0))
  d.netWeightKg = Math.round(d.items.reduce((s, i) => s + (i.weightKg || 0), 0) * 1000) / 1000
  if (d.grossWeightKg == null) d.grossWeightKg = Math.round(d.netWeightKg * 1.08 * 100) / 100
  d.form = customsFormFor(d.totalValue)
  return d
}

/**
 * Build CustomsData from:
 *   - an international first mile shipment (intl_shipments.json shape, has parcels[]),
 *   - a shipment (shipments.json shape) plus opts.order (orders.json shape) for items,
 *   - or an already normalized object (has exporter + items), which is just completed.
 * opts: { order, company, hubs, overrides, items (replace items, e.g. normalized
 *         descriptions from the customs automation engine), contentType, deMinimis }
 */
export function buildCustomsData(source, opts = {}) {
  const s = source || {}
  let d
  if (s.exporter && Array.isArray(s.items)) {
    d = { ...s }
  } else if (Array.isArray(s.parcels)) {
    const company = companyInfo(opts.company)
    const hub = hubInfo(s.destHub, opts.hubs)
    // merge identical SKUs across parcels
    const map = new Map()
    for (const p of s.parcels) {
      for (const it of p.items || []) {
        const k = it.sku || it.title
        const prev = map.get(k)
        if (prev) {
          prev.qty += it.qty
          prev.weightKg += it.weightKg || 0
          prev.totalValue += (it.unitValueUsd || 0) * it.qty
        } else {
          map.set(k, { sku: it.sku, description: it.customsDescription || it.title, hsCode: it.hsCode, origin: it.origin || s.origin, qty: it.qty, unitValue: it.unitValueUsd, totalValue: (it.unitValueUsd || 0) * it.qty, weightKg: it.weightKg || 0 })
        }
      }
    }
    d = {
      id: s.id,
      docNo: 'CI-' + String(s.id || '').replace(/^INT-/, ''),
      date: iso(s.createdAt) || new Date().toISOString(),
      reference: s.id,
      currency: 'USD',
      exporter: { ...(s.sender || {}), name: s.sender?.company || s.sender?.name, company: s.sender?.company ? s.sender?.name : '' },
      importer: {
        name: intlImporter(s, company).name,
        company: 'c/o KargoPazar ' + (s.destHub || ''),
        ...(hub?.address || company.senderAddress || {}),
        phone: intlImporter(s, company).phone,
        taxId: intlImporter(s, company).taxId,
      },
      originCountry: s.origin,
      destinationCountry: 'US',
      contentType: s.contentType || 'merchandise',
      incoterm: 'DAP',
      carrier: 'DHL Express',
      tracking: s.mawb || s.dummyLabel?.ref || '',
      mawb: s.mawb || '',
      flight: s.flight || '',
      parcels: s.parcelCount || s.parcels.length,
      grossWeightKg: s.totalWeightKg ?? null,
      items: [...map.values()],
      localCurrency: s.currency && s.currency !== 'USD' ? { code: s.currency, total: s.declaredValueLocal, fxRate: s.fxRate } : null,
      signer: s.sender?.name || '',
    }
  } else {
    const order = opts.order || null
    const items = (order?.items || []).map(i => {
      const p = productBySku(i.sku)
      return {
        sku: i.sku,
        description: i.title,
        hsCode: i.hsCode || p?.hsCode || '',
        origin: p?.origin || 'US',
        qty: i.qty,
        unitValue: i.unitPrice,
        weightKg: i.weightLb != null ? (i.weightLb * i.qty) / LB_PER_KG : null,
      }
    })
    if (!items.length) {
      items.push({ description: s.contents || '-', hsCode: '', origin: s.from?.country || 'US', qty: 1, unitValue: s.declaredValue || 0, weightKg: s.package?.weightLb != null ? s.package.weightLb / LB_PER_KG : null })
    }
    const company = companyInfo(opts.company)
    d = {
      id: s.id,
      docNo: 'CI-' + String(s.id || '').replace(/^SHP-/, ''),
      date: iso(s.createdAt) || new Date().toISOString(),
      reference: s.reference || s.orderId || s.id,
      currency: 'USD',
      exporter: { ...(s.from || company.senderAddress || {}), company: s.from?.company || company.legalName, phone: company.phone, taxId: company.taxId },
      importer: { ...(s.to || {}), phone: order?.customer?.phone, email: order?.customer?.email },
      originCountry: s.from?.country || 'US',
      destinationCountry: s.to?.country || 'US',
      contentType: 'merchandise',
      incoterm: 'DAP',
      carrier: s.carrier || '',
      tracking: s.trackingNo || '',
      parcels: 1,
      grossWeightKg: s.package?.weightLb != null ? Math.round((s.package.weightLb / LB_PER_KG) * 100) / 100 : null,
      items,
      signer: '',
    }
  }
  if (opts.items) d.items = opts.items
  if (opts.contentType) d.contentType = opts.contentType
  if (opts.deMinimis !== undefined) d.deMinimis = opts.deMinimis
  if (opts.overrides) Object.assign(d, opts.overrides)
  if (!d.signer) d.signer = companyInfo(opts.company).name
  return finish(d)
}

// ---------------------------------------------------------- merged bundle

// resolved at call time (invoice/cn22/cn23 import this module too)
const renderers = () => ({
  commercial_invoice: renderCommercialInvoice,
  cn22: renderCn22,
  cn23: renderCn23,
})

/**
 * Merged customs PDF (single file instead of a ZIP).
 * include: array of 'commercial_invoice' | 'cn22' | 'cn23' | 'auto'
 * ('auto' = CN22 or CN23 by value). Default: ['commercial_invoice', 'auto'].
 * `data` may be raw (intl shipment / shipment) or CustomsData.
 */
export function customsBundleDoc(data, { include = ['commercial_invoice', 'auto'], ...opts } = {}) {
  const d = data && data.form && data.exporter ? data : buildCustomsData(data, opts)
  const RENDER = renderers()
  const docs = include.map(k => (k === 'auto' ? d.form : k)).filter((k, i, a) => RENDER[k] && a.indexOf(k) === i)
  const doc = createDoc({ format: docs[0] === 'cn22' ? 'label' : 'a4', title: t('docs.customs.bundleTitle') + ' ' + (d.reference || '') })
  for (const k of docs) RENDER[k](doc, d)
  return finalize(doc)
}

export function downloadCustomsBundle(data, opts = {}) {
  const d = data && data.form && data.exporter ? data : buildCustomsData(data, opts)
  return download(customsBundleDoc(d, opts), opts.filename || fileSafe(`${t('docs.files.customs')}-${d.reference || d.id || ''}`) + '.pdf')
}
export const customsBundleBlobUrl = (data, opts) => toBlobUrl(customsBundleDoc(data, opts))
export const customsBundleDataUrl = (data, opts) => toDataUrl(customsBundleDoc(data, opts))
