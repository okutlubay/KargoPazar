// Manifests (Section 5.8):
//   - carrier handover manifests (USPS SCAN Form, FedEx / UPS / DHL eCommerce end of day), A4 portrait
//   - air cargo customs manifests for first mile shipments (MAWB + HAWB lines), A4 landscape
// Input: manifests.json record. Carrier manifests list their shipments from
// opts.shipments (array) or, when omitted, from the app data by shipmentIds.
import {
  createDoc, beginPage, openSection, closeSection, finalize, docHeader, table, totalsBlock, signature, note,
  ensureSpace, carrierInfo, serviceInfo, hubInfo, countryName, safeAll, f, t, tx, M, pageW, COLORS, text, rect,
  download, toBlobUrl, toDataUrl, fileSafe, LB_PER_KG,
} from './pdf.js'

export function manifestTitle(m) {
  if (m?.type === 'air_customs') return t('docs.manifest.airTitle')
  if (m?.formType === 'usps_scan_form') return t('docs.manifest.scanTitle')
  return t('docs.manifest.eodTitle')
}

function statusLabel(s) {
  const v = t(`docs.manifest.status.${s}`)
  return v.startsWith('docs.') ? (s || '-') : v
}

function hubName(code) {
  const h = hubInfo(code)
  return h ? `${code} · ${tx(h.name)}` : code || '-'
}

function resolveShipments(m, opts) {
  if (Array.isArray(opts.shipments)) {
    const ids = new Set(m.shipmentIds || [])
    return ids.size ? opts.shipments.filter(s => ids.has(s.id)) : opts.shipments
  }
  const all = safeAll('shipments') || []
  const ids = m.shipmentIds || []
  const byId = new Map(all.map(s => [s.id, s]))
  return ids.map(id => byId.get(id) || { id })
}

function renderCarrier(doc, m, opts) {
  const orientation = 'portrait'
  beginPage(doc, 'a4', orientation)
  const title = manifestTitle(m)
  const sec = openSection(doc, { title, number: m.id })
  const carrier = carrierInfo(m.carrier)
  const hub = hubInfo(m.hub)
  const pickup = hub?.carrierPickups?.find(p => p.carrier === m.carrier)?.time
  const ships = resolveShipments(m, opts)
  let y = docHeader(doc, {
    title,
    subtitle: m.formType === 'usps_scan_form' ? t('docs.manifest.scanSubtitle') : t('docs.manifest.eodSubtitle', { carrier: carrier.name }),
    number: m.id,
    barcodeValue: m.id,
    meta: [
      [t('docs.manifest.carrier'), carrier.name],
      [t('docs.manifest.hub'), hubName(m.hub)],
      [t('docs.manifest.created'), f.dateTime(m.createdAt)],
      [t('docs.manifest.statusLabel'), statusLabel(m.status)],
      [t('docs.manifest.hubAddress'), hub ? [hub.address.line1, hub.address.city, hub.address.state, hub.address.zip].filter(Boolean).join(', ') : '-'],
      [t('docs.manifest.pickupTime'), pickup || '-'],
      [t('docs.manifest.handedOver'), m.handedOverAt ? f.dateTime(m.handedOverAt) : '-'],
      [t('docs.manifest.parcels'), f.number(m.totals?.parcels ?? ships.length)],
    ],
  })
  // carrier colour strip
  rect(doc, M, y - 2, pageW(doc) - 2 * M, 1.2, { fill: carrier.color || COLORS.ink })
  y += 3
  let totalW = 0, totalB = 0
  const rows = ships.map((s, i) => {
    totalW += s.package?.weightLb || 0
    totalB += s.billableLb || 0
    return {
      n: i + 1,
      id: s.id,
      tracking: s.trackingNo || '-',
      service: s.service ? serviceInfo(s.carrier || m.carrier, s.service).name : '-',
      to: s.to ? `${s.to.name || ''}\n${[s.to.city, s.to.state, s.to.zip].filter(Boolean).join(' ')}` : '-',
      weight: s.package?.weightLb != null ? f.number(s.package.weightLb, 1) : '-',
      billable: s.billableLb != null ? f.number(s.billableLb, 0) : '-',
    }
  })
  y = table(doc, {
    y,
    columns: [
      { key: 'n', label: '#', width: 8, align: 'center' },
      { key: 'id', label: t('docs.manifest.shipment'), width: 22, bold: true },
      { key: 'tracking', label: t('docs.manifest.tracking'), width: 44 },
      { key: 'service', label: t('docs.manifest.service'), width: 0.5 },
      { key: 'to', label: t('docs.manifest.destination'), width: 0.5 },
      { key: 'weight', label: t('docs.manifest.weightLb'), width: 17, align: 'right' },
      { key: 'billable', label: t('docs.manifest.billableLb'), width: 17, align: 'right' },
    ],
    rows,
    footRows: rows.length ? [{ n: '', id: t('docs.manifest.total'), tracking: t('docs.manifest.pieces', { n: rows.length }), service: '', to: '', weight: f.number(m.totals?.weightLb ?? totalW, 1), billable: f.number(totalB, 0) }] : [],
    onPageBreak: () => M + 6,
  })
  y = ensureSpace(doc, y + 8, 46)
  const W = pageW(doc)
  y = note(doc, m.formType === 'usps_scan_form' ? t('docs.manifest.scanNote') : t('docs.manifest.eodNote'), M, y, W - 2 * M)
  y += 16
  const sw = (W - 2 * M - 12) / 3
  signature(doc, M, y, sw, t('docs.manifest.hubOperator'), { name: opts.operator || '' })
  signature(doc, M + sw + 6, y, sw, t('docs.manifest.driver', { carrier: carrier.name }))
  signature(doc, M + 2 * (sw + 6), y, sw, t('docs.manifest.pickupDateTime'), { name: m.handedOverAt ? f.dateTime(m.handedOverAt) : '' })
  closeSection(doc, sec)
}

function renderAir(doc, m) {
  const orientation = 'landscape'
  beginPage(doc, 'a4', orientation)
  const title = t('docs.manifest.airTitle')
  const sec = openSection(doc, { title, number: m.id })
  const hub = hubInfo(m.hub)
  const hawbs = m.hawbs || []
  let y = docHeader(doc, {
    title,
    subtitle: t('docs.manifest.airSubtitle'),
    number: `${m.id} · MAWB ${m.mawb || '-'}`,
    barcodeValue: (m.mawb || m.id).replace(/\s/g, ''),
    meta: [
      ['MAWB', m.mawb],
      [t('docs.manifest.flight'), m.flight],
      [t('docs.manifest.route'), m.route],
      [t('docs.manifest.origin'), countryName(m.origin)],
      [t('docs.manifest.destinationHub'), hub ? `${m.hub} · ${tx(hub.name)}` : m.hub],
      [t('docs.manifest.created'), f.dateTime(m.createdAt)],
      [t('docs.manifest.statusLabel'), statusLabel(m.status)],
      [t('docs.manifest.hawbCount'), f.number(hawbs.length)],
    ],
  })
  y += 1
  const tot = m.totals || {}
  const sumParcels = hawbs.reduce((s, h) => s + (h.parcels || 0), 0)
  const sumKg = hawbs.reduce((s, h) => s + (h.weightKg || 0), 0)
  const sumVal = hawbs.reduce((s, h) => s + (h.valueUsd || 0), 0)
  y = table(doc, {
    y,
    format: 'a4',
    orientation,
    columns: [
      { key: 'n', label: '#', width: 8, align: 'center' },
      { key: 'hawb', label: 'HAWB', width: 26, bold: true },
      { key: 'shipper', label: t('docs.manifest.shipper'), width: 0.16 },
      { key: 'consignee', label: t('docs.manifest.consignee'), width: 0.18 },
      { key: 'contents', label: t('docs.manifest.contents'), width: 0.3 },
      { key: 'hs', label: t('docs.manifest.hsCodes'), width: 0.13 },
      { key: 'origin', label: t('docs.manifest.originShort'), width: 16, align: 'center' },
      { key: 'parcels', label: t('docs.manifest.parcelsShort'), width: 15, align: 'right' },
      { key: 'kg', label: 'kg', width: 16, align: 'right' },
      { key: 'value', label: t('docs.manifest.valueUsd'), width: 24, align: 'right' },
    ],
    rows: hawbs.map((h, i) => ({
      n: i + 1,
      hawb: h.hawb + (h.intlShipmentId ? `\n${h.intlShipmentId}` : ''),
      shipper: h.shipper,
      consignee: h.consignee,
      contents: h.contents,
      hs: (h.hsCodes || []).join(', '),
      origin: h.origin || m.origin,
      parcels: f.number(h.parcels || 0),
      kg: f.number(h.weightKg || 0, 1),
      value: f.money(h.valueUsd || 0),
    })),
    footRows: hawbs.length ? [{ n: '', hawb: t('docs.manifest.total'), shipper: '', consignee: '', contents: '', hs: '', origin: '', parcels: f.number(tot.parcels ?? sumParcels), kg: f.number(tot.weightKg ?? sumKg, 1), value: f.money(tot.valueUsd ?? sumVal) }] : [],
    onPageBreak: () => M + 6,
  })
  y = ensureSpace(doc, y + 6, 42, { orientation })
  const W = pageW(doc)
  const totalLb = (tot.weightKg ?? sumKg) * LB_PER_KG
  const ty = totalsBlock(doc, [
    [t('docs.manifest.totalParcels'), f.number(tot.parcels ?? sumParcels)],
    [t('docs.manifest.totalWeight'), `${f.kg(tot.weightKg ?? sumKg, 1)} (${f.lb(totalLb)})`],
    [t('docs.manifest.totalValue'), f.money(tot.valueUsd ?? sumVal), { bold: true }],
  ], y, { w: 90 })
  let ny = note(doc, t('docs.manifest.airNote'), M, y + 2, W - 2 * M - 100)
  ny = Math.max(ny, ty) + 14
  const sw = (W - 2 * M - 12) / 3
  signature(doc, M, ny, sw, t('docs.manifest.preparedBy'), { name: 'KargoPazar ' + (m.hub || '') })
  signature(doc, M + sw + 6, ny, sw, t('docs.manifest.airline'), { name: (m.flight || '').split(' ').slice(0, 2).join(' ') })
  signature(doc, M + 2 * (sw + 6), ny, sw, t('docs.manifest.broker'))
  closeSection(doc, sec)
}

/** Draw a manifest into an existing doc. */
export function renderManifest(doc, manifest, opts = {}) {
  if (manifest?.type === 'air_customs') renderAir(doc, manifest, opts)
  else renderCarrier(doc, manifest || {}, opts)
  return doc
}

/** Manifest PDF. opts: { shipments, operator } */
export function manifestDoc(manifest, opts = {}) {
  const air = manifest?.type === 'air_customs'
  const doc = createDoc({ format: 'a4', orientation: air ? 'landscape' : 'portrait', title: `${manifestTitle(manifest)} ${manifest?.id || ''}` })
  renderManifest(doc, manifest, opts)
  return finalize(doc)
}

export function downloadManifest(manifest, opts = {}) {
  return download(manifestDoc(manifest, opts), opts.filename || fileSafe(`${t('docs.files.manifest')}-${manifest?.id || ''}`) + '.pdf')
}
export const manifestBlobUrl = (manifest, opts) => toBlobUrl(manifestDoc(manifest, opts))
export const manifestDataUrl = (manifest, opts) => toDataUrl(manifestDoc(manifest, opts))

/** Several manifests in one PDF (e.g. after a batch: one per hub + carrier). */
export function combinedManifests(manifests, opts = {}) {
  const list = (manifests || []).filter(Boolean)
  const first = list[0]
  const doc = createDoc({ format: 'a4', orientation: first?.type === 'air_customs' ? 'landscape' : 'portrait', title: t('docs.manifest.combinedTitle') })
  list.forEach(m => renderManifest(doc, m, opts))
  return finalize(doc)
}
export function downloadCombinedManifests(manifests, opts = {}) {
  return download(combinedManifests(manifests, opts), opts.filename || fileSafe(`${t('docs.files.manifests')}-${new Date().toISOString().slice(0, 10)}`) + '.pdf')
}
