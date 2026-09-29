// Integration test report (Section 9.4): suite names, date, environment,
// scenario table, pass rate, failed scenarios with fix notes, signature area.
//
// Input: a run ({ id, startedAt, finishedAt, env, version, suiteIds, triggeredBy,
// results: [{ scenarioId, result: passed|failed|skipped, durationMs, error?, fixNote?, fixedIn? }] })
// and the suites definition (test_suites.json `suites`), from opts.suites or app data.
import {
  createDoc, beginPage, openSection, closeSection, finalize, docHeader, table, signature, note, sectionTitle,
  ensureSpace, safeDoc, wrap, f, t, tx, M, pageW, COLORS, text, rect, download, toBlobUrl, toDataUrl, fileSafe,
} from './pdf.js'

const RESULT_COLOR = { passed: COLORS.success, failed: COLORS.danger, skipped: COLORS.ink3 }

function suitesSource(opts) {
  if (opts.suites) return opts.suites
  const d = safeDoc('test_suites')
  return d?.suites || []
}

export function summarize(results = []) {
  const s = { total: results.length, passed: 0, failed: 0, skipped: 0, durationMs: 0 }
  for (const r of results) {
    if (r.result in s) s[r.result]++
    s.durationMs += r.durationMs || 0
  }
  const executed = s.passed + s.failed
  s.passRate = executed ? s.passed / executed : 0
  return s
}

function statCard(doc, x, y, w, label, value, color) {
  rect(doc, x, y, w, 17, { fill: COLORS.soft, r: 1.8 })
  rect(doc, x, y, 1.4, 17, { fill: color || COLORS.ink })
  text(doc, String(label).toUpperCase(), x + 4, y + 5.5, { size: 6.3, bold: true, color: COLORS.ink3 })
  text(doc, value, x + 4, y + 13, { size: 13, bold: true, color: color || COLORS.ink })
}

/**
 * opts: { suites, suiteId (limit to one suite), history: [runs] (pass rate trend),
 *         preparedBy, approvedBy }
 */
export function renderTestReport(doc, run, opts = {}) {
  beginPage(doc, 'a4')
  const suites = suitesSource(opts)
  const suiteIds = opts.suiteId ? [opts.suiteId] : run?.suiteIds?.length ? run.suiteIds : suites.map(s => s.id)
  const inRun = suites.filter(s => suiteIds.includes(s.id))
  const scenarioMap = new Map()
  for (const s of suites) for (const sc of s.scenarios || []) scenarioMap.set(sc.id, { ...sc, suiteId: s.id })
  const allowed = new Set(inRun.flatMap(s => (s.scenarios || []).map(sc => sc.id)))
  const results = (run?.results || []).filter(r => !allowed.size || allowed.has(r.scenarioId))
  const sum = summarize(results)
  const title = t('docs.test.title')
  const sec = openSection(doc, { title, number: run?.id })
  const W = pageW(doc)
  const started = run?.startedAt, finished = run?.finishedAt
  const durMin = started && finished ? (new Date(finished) - new Date(started)) / 1000 : sum.durationMs / 1000
  let y = docHeader(doc, {
    title,
    subtitle: inRun.length === 1 ? tx(inRun[0].name) : t('docs.test.subtitle', { n: inRun.length }),
    number: run?.id,
    meta: [
      [t('docs.test.run'), run?.id],
      [t('docs.test.date'), f.dateTime(started)],
      [t('docs.test.env'), run?.env ? t(`docs.test.envs.${run.env}`) : '-'],
      [t('docs.test.version'), run?.version],
      [t('docs.test.triggeredBy'), run?.triggeredBy],
      [t('docs.test.finished'), f.dateTime(finished)],
      [t('docs.test.duration'), durMin >= 60 ? t('docs.test.minutes', { n: f.number(durMin / 60, 1) }) : t('docs.test.seconds', { n: f.number(durMin, 1) })],
      [t('docs.test.suites'), inRun.map(s => tx(s.name)).join(', ')],
    ],
    metaLines: 4,
  })

  // summary cards
  const cw = (W - 2 * M - 4 * 4) / 5
  const cards = [
    [t('docs.test.total'), f.number(sum.total), COLORS.ink],
    [t('docs.test.passed'), f.number(sum.passed), COLORS.success],
    [t('docs.test.failed'), f.number(sum.failed), sum.failed ? COLORS.danger : COLORS.ink3],
    [t('docs.test.skipped'), f.number(sum.skipped), COLORS.ink3],
    [t('docs.test.passRate'), f.percent(sum.passRate, 1), sum.passRate >= 0.999 ? COLORS.success : sum.passRate >= 0.9 ? COLORS.warning : COLORS.danger],
  ]
  cards.forEach(([l, v, c], i) => statCard(doc, M + i * (cw + 4), y, cw, l, v, c))
  y += 23

  // pass rate bar
  if (sum.total) {
    const bw = W - 2 * M
    rect(doc, M, y, bw, 2.4, { fill: COLORS.soft, r: 1.2 })
    const pw = bw * (sum.passed / sum.total), fw = bw * (sum.failed / sum.total)
    if (pw) rect(doc, M, y, pw, 2.4, { fill: COLORS.success })
    if (fw) rect(doc, M + pw, y, fw, 2.4, { fill: COLORS.danger })
    y += 8
  }

  // per suite scenario tables
  for (const s of inRun) {
    const rs = results.filter(r => scenarioMap.get(r.scenarioId)?.suiteId === s.id)
    const ss = summarize(rs)
    y = ensureSpace(doc, y, 30)
    y = sectionTitle(doc, `${tx(s.name)} · ${t('docs.test.suiteSummary', { p: ss.passed, n: ss.total })}`, y + 2)
    const resultById = new Map(rs.map(r => [r.scenarioId, r]))
    const rows = (s.scenarios || []).map(sc => {
      const r = resultById.get(sc.id)
      return {
        id: sc.id,
        name: tx(sc.name),
        expected: tx(sc.expected),
        result: r ? r.result : 'not_run',
        duration: r?.durationMs != null ? `${f.number(r.durationMs)} ms` : '-',
      }
    })
    y = table(doc, {
      y,
      columns: [
        { key: 'id', label: 'ID', width: 17, bold: true },
        { key: 'name', label: t('docs.test.scenario'), width: 0.45 },
        { key: 'expected', label: t('docs.test.expected'), width: 0.55 },
        { key: 'result', label: t('docs.test.result'), width: 22, value: r => t(`docs.test.results.${r.result}`), color: r => RESULT_COLOR[r.result] || COLORS.ink3, boldIf: () => true },
        { key: 'duration', label: t('docs.test.durationShort'), width: 18, align: 'right' },
      ],
      rows,
      fontSize: 7.4,
      onPageBreak: () => M + 6,
    })
    y += 4
  }

  // failures and fixes
  const failures = results.filter(r => r.result === 'failed')
  y = ensureSpace(doc, y + 2, 30)
  y = sectionTitle(doc, t('docs.test.failuresTitle'), y + 2)
  if (!failures.length) {
    y = note(doc, t('docs.test.noFailures'), M, y, W - 2 * M, { size: 8, color: COLORS.success, bold: true })
  } else {
    for (const r of failures) {
      const sc = scenarioMap.get(r.scenarioId)
      const lines = [
        [t('docs.test.error'), tx(r.error) || '-'],
        [t('docs.test.fixNote'), tx(r.fixNote) || t('docs.test.fixPending')],
        [t('docs.test.fixedIn'), r.fixedIn || '-'],
      ]
      const est = 10 + lines.reduce((s, [, v]) => s + wrap(doc, String(v), W - 2 * M - 34, { size: 7.6 }).length * 3.4, 0)
      y = ensureSpace(doc, y, est + 4)
      rect(doc, M, y, W - 2 * M, est, { fill: COLORS.dangerSoft, r: 1.5 })
      rect(doc, M, y, 1.4, est, { fill: COLORS.danger })
      text(doc, `${r.scenarioId} · ${tx(sc?.name) || ''}`, M + 4, y + 5, { size: 8.4, bold: true })
      let ly = y + 9.8
      for (const [k, v] of lines) {
        text(doc, k, M + 4, ly, { size: 7, bold: true, color: COLORS.ink2 })
        const wl = wrap(doc, String(v), W - 2 * M - 34, { size: 7.6 })
        text(doc, wl, M + 30, ly, { size: 7.6, color: k === t('docs.test.fixedIn') ? COLORS.success : COLORS.ink, bold: k === t('docs.test.fixedIn') })
        ly += wl.length * 3.4
      }
      y += est + 3
    }
  }

  // history
  const history = (opts.history || []).filter(h => h?.results?.length)
  if (history.length > 1) {
    y = ensureSpace(doc, y + 2, 20 + history.length * 7)
    y = sectionTitle(doc, t('docs.test.historyTitle'), y + 2)
    y = table(doc, {
      y,
      columns: [
        { key: 'id', label: t('docs.test.run'), width: 24, bold: true },
        { key: 'date', label: t('docs.test.date'), width: 0.4 },
        { key: 'version', label: t('docs.test.version'), width: 0.25 },
        { key: 'res', label: t('docs.test.passedOfTotal'), width: 0.35, align: 'right' },
        { key: 'rate', label: t('docs.test.passRate'), width: 26, align: 'right', bold: true },
      ],
      rows: history.map(h => {
        const hs = summarize(h.results)
        return { id: h.id, date: f.dateTime(h.startedAt), version: h.version || '-', res: `${hs.passed} / ${hs.total}`, rate: f.percent(hs.passRate, 1) }
      }),
      onPageBreak: () => M + 6,
    })
  }

  // sign off
  y = ensureSpace(doc, y + 8, 34)
  y = note(doc, t('docs.test.statement'), M, y, W - 2 * M, { size: 7.6, color: COLORS.ink })
  y += 16
  const sw = (W - 2 * M - 12) / 3
  signature(doc, M, y, sw, t('docs.test.engineer'), { name: opts.preparedBy || run?.triggeredBy || '' })
  signature(doc, M + sw + 6, y, sw, t('docs.test.approver'), { name: opts.approvedBy || '' })
  signature(doc, M + 2 * (sw + 6), y, sw, t('docs.test.signDate'), { name: f.date(finished || started) })
  closeSection(doc, sec)
  return doc
}

export function testReportDoc(run, opts = {}) {
  const doc = createDoc({ format: 'a4', title: `${t('docs.test.title')} ${run?.id || ''}` })
  renderTestReport(doc, run, opts)
  return finalize(doc)
}
export function downloadTestReport(run, opts = {}) {
  return download(testReportDoc(run, opts), opts.filename || fileSafe(`${t('docs.files.testReport')}-${run?.id || ''}${opts.suiteId ? '-' + opts.suiteId : ''}`) + '.pdf')
}
export const testReportBlobUrl = (run, opts) => toBlobUrl(testReportDoc(run, opts))
export const testReportDataUrl = (run, opts) => toDataUrl(testReportDoc(run, opts))
