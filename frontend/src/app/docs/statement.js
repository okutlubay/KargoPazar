// Monthly platform invoice (invoices.json record) and prepaid wallet account
// statement (wallet.json transactions) (Section 5.10).
import {
  createDoc, beginPage, openSection, closeSection, finalize, docHeader, addressBox, addressLines, table,
  totalsBlock, note, sectionTitle, ensureSpace, stamp, companyInfo, userEmail, safeDoc, iso, f, t, tx, M,
  pageW, COLORS, text, rect, download, toBlobUrl, toDataUrl, fileSafe,
} from './pdf.js'

const ISSUER = ['KargoPazar', 'Fenece Teknoloji', 'billing@kargopazar.com', 'kargopazar.com']

function billTo(company) {
  const c = companyInfo(company)
  const a = c.senderAddress || {}
  return {
    lines: addressLines({ ...a, name: c.legalName || c.name, company: '' }),
    extra: [[t('docs.statement.taxId'), c.taxId], [t('docs.statement.phone'), c.phone], [t('docs.statement.email'), userEmail()]],
  }
}

function invoiceStatus(inv) {
  const v = t(`docs.statement.invStatus.${inv.status}`)
  return v.startsWith('docs.') ? inv.status : v
}

// ------------------------------------------------------------ monthly invoice

export function renderMonthlyInvoice(doc, inv, opts = {}) {
  beginPage(doc, 'a4')
  const title = t('docs.statement.invoiceTitle')
  const sec = openSection(doc, { title, number: inv.id })
  const W = pageW(doc)
  const cur = inv.currency || 'USD'
  let y = docHeader(doc, {
    title,
    subtitle: t('docs.statement.period', { from: f.date(inv.periodStart), to: f.date(inv.periodEnd) }),
    number: inv.id,
    barcodeValue: inv.id,
  })
  const bw = (W - 2 * M - 6) / 2
  const bt = billTo(opts.company)
  const h1 = addressBox(doc, t('docs.statement.issuer'), ISSUER, M, y, bw, { minH: 28 })
  const h2 = addressBox(doc, t('docs.statement.billTo'), bt.lines, M + bw + 6, y, bw, { extra: bt.extra, minH: 28 })
  y += Math.max(h1, h2) + 6
  rect(doc, M, y - 1, W - 2 * M, 12, { fill: COLORS.soft, r: 1.5 })
  const meta = [
    [t('docs.statement.invoiceNo'), inv.id],
    [t('docs.statement.issued'), f.date(inv.issuedAt)],
    [t('docs.statement.due'), f.date(inv.dueAt)],
    [t('docs.statement.statusLabel'), invoiceStatus(inv)],
    [t('docs.statement.paidFrom'), inv.paidFrom === 'wallet' ? t('docs.statement.wallet') : inv.paidFrom ? t('docs.statement.card') : '-'],
  ]
  const cw = (W - 2 * M - 6) / meta.length
  meta.forEach(([k, v], i) => {
    text(doc, String(k).toUpperCase(), M + 3 + i * cw, y + 3.6, { size: 6, bold: true, color: COLORS.ink3 })
    text(doc, v || '-', M + 3 + i * cw, y + 8.2, { size: 8.5, bold: true })
  })
  y += 16

  y = table(doc, {
    y,
    columns: [
      { key: 'desc', label: t('docs.statement.description'), width: 0.62 },
      { key: 'qty', label: t('docs.statement.qty'), width: 0.14, align: 'right' },
      { key: 'amount', label: t('docs.statement.amount'), width: 0.24, align: 'right', bold: true },
    ],
    rows: (inv.lines || []).map(l => ({ desc: tx(l.desc), qty: f.number(l.qty || 0), amount: f.money(l.amount || 0, cur) })),
    fontSize: 8.4,
    minRowH: 7,
    onPageBreak: () => M + 6,
  })
  y = ensureSpace(doc, y + 5, 40)
  const ty = totalsBlock(doc, [
    [t('docs.statement.subtotal'), f.money(inv.subtotal ?? 0, cur)],
    [t('docs.statement.tax'), f.money(inv.tax ?? 0, cur)],
    [t('docs.statement.total'), f.money(inv.total ?? 0, cur), { bold: true }],
  ], y)
  let ny = y + 2
  const lw = W - 2 * M - 88
  if (inv.status === 'paid') ny = note(doc, t('docs.statement.paidNote', { date: f.date(inv.dueAt || inv.issuedAt) }), M, ny, lw, { color: COLORS.success, bold: true })
  else ny = note(doc, t('docs.statement.openNote', { date: f.date(inv.dueAt) }), M, ny, lw, { color: COLORS.warning, bold: true })
  if (inv.estimated) ny = note(doc, t('docs.statement.estimatedNote'), M, ny, lw)
  ny = note(doc, t('docs.statement.invoiceNote'), M, ny, lw)
  if (inv.status === 'paid') stamp(doc, t('docs.statement.paidStamp'), M + lw / 2 + 10, Math.max(ny, ty) + 14, { color: COLORS.success, size: 26 })
  closeSection(doc, sec)
  return doc
}

export function monthlyInvoiceDoc(inv, opts = {}) {
  const doc = createDoc({ format: 'a4', title: `${t('docs.statement.invoiceTitle')} ${inv?.id || ''}` })
  renderMonthlyInvoice(doc, inv || {}, opts)
  return finalize(doc)
}
export function downloadMonthlyInvoice(inv, opts = {}) {
  return download(monthlyInvoiceDoc(inv, opts), opts.filename || fileSafe(`${t('docs.files.invoice')}-${inv?.id || ''}`) + '.pdf')
}
export const monthlyInvoiceBlobUrl = (inv, opts) => toBlobUrl(monthlyInvoiceDoc(inv, opts))

// ------------------------------------------------------------ account statement

const TYPES = ['topup', 'label', 'refund', 'adjustment', 'plan_fee', 'platform_fee', 'opening']

function typeLabel(type) {
  const v = t(`docs.statement.types.${type}`)
  return v.startsWith('docs.') ? type : v
}

/**
 * opts: { from, to (ISO / seed dates, default: all), transactions (default:
 * wallet.json transactions from app data), balance (current), company, title }
 */
export function renderStatement(doc, opts = {}) {
  beginPage(doc, 'a4')
  const wallet = safeDoc('wallet') || {}
  const all = (opts.transactions || wallet.transactions || []).map(x => ({ ...x, at: iso(x.at) })).filter(x => x.at)
  all.sort((a, b) => new Date(a.at) - new Date(b.at) || String(a.id).localeCompare(String(b.id)))
  const from = iso(opts.from) || all[0]?.at || new Date().toISOString()
  const to = iso(opts.to) || new Date().toISOString()
  const fromT = new Date(from).getTime(), toT = new Date(to).getTime()
  const before = all.filter(x => new Date(x.at).getTime() < fromT)
  const inRange = all.filter(x => { const v = new Date(x.at).getTime(); return v >= fromT && v <= toT })
  // an 'opening' transaction (balance carried forward) sets the opening balance, it is not a movement
  const openTx = inRange.find(x => x.type === 'opening')
  const moves = inRange.filter(x => x.type !== 'opening')
  const firstMove = moves[0]
  let opening
  if (before.length) opening = before[before.length - 1].balanceAfter
  else if (openTx) opening = openTx.balanceAfter
  else if (firstMove) opening = r2(firstMove.balanceAfter - firstMove.amount)
  else opening = all.length ? all[all.length - 1].balanceAfter : (wallet.balance ?? 0)
  opening = opening ?? 0
  const closing = moves.length ? moves[moves.length - 1].balanceAfter : opening
  const title = t('docs.statement.statementTitle')
  const number = opts.number || `STM-${fmtYmd(from)}-${fmtYmd(to)}`
  const sec = openSection(doc, { title, number })
  const W = pageW(doc)
  let y = docHeader(doc, {
    title,
    subtitle: t('docs.statement.period', { from: f.date(from), to: f.date(to) }),
    number,
  })
  const bw = (W - 2 * M - 6) / 2
  const bt = billTo(opts.company)
  const h1 = addressBox(doc, t('docs.statement.accountHolder'), bt.lines, M, y, bw, { extra: bt.extra, minH: 30 })
  // balance summary box
  const bx = M + bw + 6
  rect(doc, bx, y, bw, h1, { fill: COLORS.soft, r: 1.5 })
  const credits = moves.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0)
  const debits = moves.filter(x => x.amount < 0).reduce((s, x) => s + x.amount, 0)
  const rows = [
    [t('docs.statement.opening'), f.money(opening)],
    [t('docs.statement.credits'), f.money(r2(credits))],
    [t('docs.statement.debits'), f.money(r2(debits))],
  ]
  rows.forEach(([k, v], i) => {
    text(doc, k, bx + 4, y + 7 + i * 5.6, { size: 8, color: COLORS.ink2 })
    text(doc, v, bx + bw - 4, y + 7 + i * 5.6, { size: 8.6, bold: true, align: 'right' })
  })
  text(doc, t('docs.statement.closing'), bx + 4, y + h1 - 4.5, { size: 9, bold: true })
  text(doc, f.money(closing), bx + bw - 4, y + h1 - 4.5, { size: 12, bold: true, color: COLORS.accent, align: 'right' })
  y += h1 + 7

  y = table(doc, {
    y,
    columns: [
      { key: 'date', label: t('docs.statement.date'), width: 35 },
      { key: 'id', label: t('docs.statement.txn'), width: 21 },
      { key: 'type', label: t('docs.statement.type'), width: 26 },
      { key: 'desc', label: t('docs.statement.description'), width: 1 },
      { key: 'amount', label: t('docs.statement.amount'), width: 24, align: 'right', bold: true, color: r => (r.raw > 0 ? COLORS.success : COLORS.ink) },
      { key: 'balance', label: t('docs.statement.balance'), width: 24, align: 'right' },
    ],
    rows: moves.map(x => ({
      raw: x.amount,
      date: f.dateTime(x.at),
      id: x.id,
      type: typeLabel(x.type),
      desc: tx(x.description) + (x.shipmentId && !tx(x.description).includes(x.shipmentId) ? ` (${x.shipmentId})` : '') + (x.status && x.status !== 'completed' ? ` · ${t('docs.statement.pending')}` : ''),
      amount: (x.amount > 0 ? '+' : '') + f.money(x.amount),
      balance: f.money(x.balanceAfter),
    })),
    fontSize: 7.2,
    onPageBreak: () => M + 6,
  })

  // totals by type
  y = ensureSpace(doc, y + 7, 60)
  y = sectionTitle(doc, t('docs.statement.byType'), y)
  const byType = new Map()
  for (const x of moves) {
    const e = byType.get(x.type) || { n: 0, sum: 0 }
    e.n++; e.sum += x.amount
    byType.set(x.type, e)
  }
  const typeRows = [...byType.entries()].sort((a, b) => TYPES.indexOf(a[0]) - TYPES.indexOf(b[0])).map(([k, v]) => ({ type: typeLabel(k), n: f.number(v.n), sum: f.money(r2(v.sum)) }))
  y = table(doc, {
    y,
    w: 110,
    columns: [
      { key: 'type', label: t('docs.statement.type'), width: 0.5 },
      { key: 'n', label: t('docs.statement.count'), width: 0.2, align: 'right' },
      { key: 'sum', label: t('docs.statement.amount'), width: 0.3, align: 'right', bold: true },
    ],
    rows: typeRows,
    fontSize: 7.8,
    onPageBreak: () => M + 6,
  })
  y += 6
  note(doc, t('docs.statement.statementNote'), M, y, W - 2 * M)
  closeSection(doc, sec)
  return doc
}

const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const fmtYmd = v => String(iso(v) || '').slice(0, 10).replace(/-/g, '')

export function statementDoc(opts = {}) {
  const doc = createDoc({ format: 'a4', title: t('docs.statement.statementTitle') })
  renderStatement(doc, opts)
  return finalize(doc)
}
export function downloadStatement(opts = {}) {
  const from = iso(opts.from), to = iso(opts.to) || new Date().toISOString()
  return download(statementDoc(opts), opts.filename || fileSafe(`${t('docs.files.statement')}-${from ? from.slice(0, 10) + '_' : ''}${to.slice(0, 10)}`) + '.pdf')
}
export const statementBlobUrl = opts => toBlobUrl(statementDoc(opts))

/** Statement covering an invoice's period. */
export const invoiceStatementDoc = (inv, opts = {}) => statementDoc({ ...opts, from: inv?.periodStart, to: inv?.periodEnd, number: `STM-${inv?.id || ''}` })
export const downloadInvoiceStatement = (inv, opts = {}) => download(invoiceStatementDoc(inv, opts), opts.filename || fileSafe(`${t('docs.files.statement')}-${inv?.id || ''}`) + '.pdf')
