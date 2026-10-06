/**
 * Demand forecast model (spec 6.2): classical multiplicative decomposition.
 * PURE JavaScript (no Vue, no db, no alias imports) so it runs in the browser
 * and under Node for verification.
 *
 *   y[t] = trend(t) * seasonalIndex(month(t)) * holidayAdj(t) * noise
 *
 * Steps
 *   1. Series: weekly totals for one breakdown ('total', 'byHub.NJ01', 'byCarrier.UPS',
 *      'byRegion.West', 'byChannel.etsy'). Built from history_weekly rows; shipments
 *      created after the seed are added as increments to the latest week.
 *   2. Trend: 13 week centered moving average, then ordinary least squares line
 *      through the moving average points: trend(t) = a + b*t.
 *   3. Seasonality: ratios y/trend averaged by calendar month of the week midpoint
 *      (holiday weeks excluded), normalized so the 12 indices average to 1.
 *      Holiday weeks (last week of November, first 2 weeks of December) get their
 *      own correction factor: mean(y / (trend*SI)) over those weeks.
 *   4. Forecast: yhat(t) = trend(t) * SI(month(t)) * holidayAdj(t), 12 weeks ahead.
 *   5. Bands: sigma = std of the last 26 residuals (y - fitted); horizon h gets
 *      yhat +- z * sigma * sqrt(h), z80 = 1.2816, z95 = 1.96 (lower bound >= 0).
 *   6. Backtest: last 8 weeks hidden, model rebuilt on the rest, MAPE / MAE computed
 *      against the hidden actuals.
 *   7. Data sufficiency score 0-100: duration (vs 24 months), missing weeks,
 *      seasonal cycle repetitions, samples per breakdown.
 *
 * Exported API
 *   REGION_OF, regionOf(state)
 *   parseKey(key) -> { group: 'total'|'byHub'|'byCarrier'|'byRegion'|'byChannel', member }
 *   seriesKeys(history) -> ['total', 'byHub.NJ01', ...]
 *   addIncrements(history, shipments) -> history copy, latest week incremented
 *   buildSeries(history, key) -> [{ weekStart, y }]
 *   decompose(series, opts?) -> model object (trend line, SI, holiday factors, fitted, residuals, sigma)
 *   forecastFrom(model, series, horizon = 12) -> [{ weekStart, h, yhat, lo80, hi80, lo95, hi95, lastYear, holiday }]
 *   backtest(series, holdout = 8) -> { mape, mae, points: [{ weekStart, y, yhat }] }
 *   sufficiency(series, { months }) -> { score, parts: [...], text: {tr,en} }
 *   runForecast({ history, key, trainWeeks?, version, trainedAt, horizon?, thresholds? }) -> ForecastResult
 *     ForecastResult = { key, version, trainedAt, trainWeeks, history: [{weekStart, y}],
 *       fitted: [{weekStart, yhat}], forecast: [...], decomposition: { trend: [{weekStart, ma, value}],
 *       seasonalIndex: [12], holidayAdj: {novLast, dec1, dec2}, residuals: [{weekStart, value}], sigma, slope, intercept },
 *       metrics: { mape, mae, holdout }, sufficiency, insights: [{ id, severity, tr, en, link? }],
 *       summary: { next4, last4, changePct, bandPct } }
 *   computeInsights({ key, result, la01, ups, upsTiers, la01Capacity }) -> insights
 *   stockoutPlan({ hub, products, salesBySku, inboundBySku, weeklyShipments, unitsPerShipment, ... })
 *     -> US hub stock-out estimate: forecast weekly shipments x units per shipment, allocated to SKUs
 *        by recent sales share; weeks of cover per hub / SKU and a first-mile replenishment proposal.
 *
 * All dates are ISO strings. Month index 0 = January.
 */

export const HORIZON = 12
export const HOLDOUT = 8
export const MA_WINDOW = 13
export const SIGMA_WINDOW = 26
export const Z80 = 1.2816
export const Z95 = 1.96
export const LA01_WEEKLY_CAPACITY = 180
export const UPS_TIER_THRESHOLD = 60

const DAY = 86400000

export const REGION_OF = {
  Northeast: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC'],
  Southeast: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN', 'KY', 'AR', 'LA'],
  Midwest: ['OH', 'IN', 'IL', 'MI', 'WI', 'MN', 'IA', 'MO', 'KS', 'NE', 'SD', 'ND'],
  Southwest: ['TX', 'OK', 'NM', 'AZ'],
  West: ['CA', 'NV', 'UT', 'CO', 'WY', 'ID', 'MT', 'OR', 'WA', 'AK', 'HI'],
}

export function regionOf(state) {
  for (const [r, list] of Object.entries(REGION_OF)) if (list.includes(state)) return r
  return 'Northeast'
}

const GROUPS = ['byHub', 'byCarrier', 'byRegion', 'byChannel']

export function parseKey(key = 'total') {
  if (!key || key === 'total') return { group: 'total', member: null }
  const i = key.indexOf('.')
  const group = i > 0 ? key.slice(0, i) : key
  const member = i > 0 ? key.slice(i + 1) : null
  if (!GROUPS.includes(group) || !member) return null
  return { group, member }
}

export function seriesKeys(history) {
  const keys = ['total']
  const last = history[history.length - 1] || {}
  for (const g of GROUPS) {
    const members = new Set()
    for (const row of history) for (const m of Object.keys(row[g] || {})) members.add(m)
    // order by latest volume, largest first
    const sorted = [...members].sort((a, b) => ((last[g] || {})[b] || 0) - ((last[g] || {})[a] || 0) || a.localeCompare(b))
    for (const m of sorted) keys.push(`${g}.${m}`)
  }
  return keys
}

/**
 * Add shipments created after the seed to the latest history week (DEMO_NOTES:
 * history_weekly and shipments.json live on different scales, so new shipments
 * are only appended as increments). Voided shipments are ignored.
 */
export function addIncrements(history, shipments = []) {
  const out = history.map((r) => ({
    ...r,
    byHub: { ...(r.byHub || {}) },
    byCarrier: { ...(r.byCarrier || {}) },
    byRegion: { ...(r.byRegion || {}) },
    byChannel: { ...(r.byChannel || {}) },
  }))
  if (!out.length) return out
  const last = out[out.length - 1]
  for (const s of shipments) {
    if (!s || s.status === 'voided') continue
    last.total = (last.total || 0) + 1
    if (s.hub) last.byHub[s.hub] = (last.byHub[s.hub] || 0) + 1
    if (s.carrier) last.byCarrier[s.carrier] = (last.byCarrier[s.carrier] || 0) + 1
    const st = s.to && s.to.state
    if (st && (!s.to.country || s.to.country === 'US')) {
      const r = regionOf(st)
      last.byRegion[r] = (last.byRegion[r] || 0) + 1
    }
    const ch = s.channel || 'manual'
    last.byChannel[ch] = (last.byChannel[ch] || 0) + 1
  }
  return out
}

export function buildSeries(history, key = 'total') {
  const p = parseKey(key)
  if (!p) return null
  return history.map((r) => ({
    weekStart: typeof r.weekStart === 'string' ? r.weekStart : new Date(r.weekStart).toISOString(),
    y: p.group === 'total' ? Number(r.total) || 0 : Number((r[p.group] || {})[p.member]) || 0,
  }))
}

function midDate(weekStart) {
  return new Date(new Date(weekStart).getTime() + 3.5 * DAY)
}

export function monthOf(weekStart) {
  return midDate(weekStart).getMonth()
}

/** 'novLast' | 'dec1' | 'dec2' | null, by the week midpoint. */
export function holidaySlot(weekStart) {
  const d = midDate(weekStart)
  const m = d.getMonth()
  const day = d.getDate()
  if (m === 10 && day >= 24) return 'novLast'
  if (m === 11 && day <= 7) return 'dec1'
  if (m === 11 && day <= 14) return 'dec2'
  return null
}

function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
}

function std(a) {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

function r1(v) {
  return Math.round(v * 10) / 10
}
function r3(v) {
  return Math.round(v * 1000) / 1000
}

/** 13 week centered moving average; null where the window does not fit. */
export function centeredMA(values, window = MA_WINDOW) {
  const half = Math.floor(window / 2)
  return values.map((_, t) => {
    if (t - half < 0 || t + half >= values.length) return null
    let s = 0
    for (let k = t - half; k <= t + half; k++) s += values[k]
    return s / window
  })
}

/** OLS through (t, v) pairs. */
export function linearRegression(points) {
  const n = points.length
  if (!n) return { intercept: 0, slope: 0 }
  const mx = mean(points.map((p) => p[0]))
  const my = mean(points.map((p) => p[1]))
  let sxy = 0
  let sxx = 0
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  return { intercept: my - slope * mx, slope }
}

/**
 * Fit the decomposition on a series ([{weekStart, y}]).
 * A 13 week moving average does not remove the yearly cycle, so the classical
 * procedure is iterated: after the first pass the series is deseasonalized
 * (y / (SI * holiday)) and the moving average + regression are recomputed on it.
 * `passes` = 1 gives the textbook single pass.
 */
export function decompose(series, { passes = 3 } = {}) {
  const y = series.map((p) => p.y)
  const n = y.length
  const slots = series.map((p) => holidaySlot(p.weekStart))
  const months = series.map((p) => monthOf(p.weekStart))
  let si = new Array(12).fill(1)
  let holidayAdj = { novLast: 1, dec1: 1, dec2: 1 }
  let ma = []
  let intercept = 0
  let slope = 0
  let monthsCovered = 0
  const factor = (t) => si[months[t]] * (slots[t] ? holidayAdj[slots[t]] : 1)
  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    const adjusted = y.map((v, t) => v / (factor(t) || 1))
    ma = centeredMA(adjusted)
    let pts = ma.map((v, t) => (v == null ? null : [t, v])).filter(Boolean)
    if (pts.length < 2) pts = adjusted.map((v, t) => [t, v]) // very short series: regress raw values
    ;({ intercept, slope } = linearRegression(pts))
    const tr = (t) => Math.max(0.01, intercept + slope * t)

    // seasonal index by month (holiday weeks excluded), normalized to mean 1
    const buckets = Array.from({ length: 12 }, () => [])
    for (let t = 0; t < n; t++) if (!slots[t]) buckets[months[t]].push(y[t] / tr(t))
    let next = buckets.map((b) => (b.length ? mean(b) : null))
    const known = next.filter((v) => v != null && v > 0)
    const siMean = known.length ? mean(known) : 1
    si = next.map((v) => (v != null && v > 0 ? v / siMean : 1))
    monthsCovered = buckets.filter((b) => b.length).length

    // holiday adjustment on top of the monthly index
    const hol = { novLast: [], dec1: [], dec2: [] }
    for (let t = 0; t < n; t++) {
      if (!slots[t]) continue
      const base = tr(t) * si[months[t]]
      if (base > 0) hol[slots[t]].push(y[t] / base)
    }
    holidayAdj = {
      novLast: hol.novLast.length ? mean(hol.novLast) : 1,
      dec1: hol.dec1.length ? mean(hol.dec1) : 1,
      dec2: hol.dec2.length ? mean(hol.dec2) : 1,
    }
  }
  const trendAt = (t) => Math.max(0.01, intercept + slope * t)
  const predictAt = (t, weekStart) => {
    const slot = holidaySlot(weekStart)
    return trendAt(t) * si[monthOf(weekStart)] * (slot ? holidayAdj[slot] : 1)
  }
  const fitted = series.map((p, t) => predictAt(t, p.weekStart))
  const residuals = y.map((v, t) => v - fitted[t])
  const sigma = std(residuals.slice(-SIGMA_WINDOW))
  return { n, ma, intercept, slope, trendAt, seasonalIndex: si, monthsCovered, holidayAdj, predictAt, fitted, residuals, sigma }
}

function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * DAY).toISOString()
}

/**
 * Forecast `horizon` weeks after the last week of `series` using a model fitted
 * on the first model.n weeks (model.n <= series.length). `lastYearSource` is the
 * full history used for "same week last year".
 */
export function forecastFrom(model, series, horizon = HORIZON, lastYearSource = series) {
  const lastWeek = series[series.length - 1].weekStart
  const tLast = series.length - 1
  const out = []
  for (let h = 1; h <= horizon; h++) {
    const weekStart = addDays(lastWeek, 7 * h)
    const t = tLast + h
    const steps = t - (model.n - 1) // distance from the end of the training data
    const yhat = Math.max(0, model.predictAt(t, weekStart))
    const w80 = Z80 * model.sigma * Math.sqrt(steps)
    const w95 = Z95 * model.sigma * Math.sqrt(steps)
    const ly = lastYearSource[t - 52]
    out.push({
      weekStart,
      h,
      yhat: r1(yhat),
      lo80: r1(Math.max(0, yhat - w80)),
      hi80: r1(yhat + w80),
      lo95: r1(Math.max(0, yhat - w95)),
      hi95: r1(yhat + w95),
      lastYear: ly ? ly.y : null,
      holiday: holidaySlot(weekStart),
    })
  }
  return out
}

export function backtest(series, holdout = HOLDOUT) {
  if (series.length <= holdout + MA_WINDOW) return { mape: null, mae: null, holdout, points: [] }
  const train = series.slice(0, series.length - holdout)
  const model = decompose(train)
  const points = series.slice(-holdout).map((p, i) => {
    const t = train.length + i
    return { weekStart: p.weekStart, y: p.y, yhat: r1(Math.max(0, model.predictAt(t, p.weekStart))) }
  })
  const withY = points.filter((p) => p.y > 0)
  const mape = withY.length ? mean(withY.map((p) => Math.abs(p.y - p.yhat) / p.y)) : null
  const mae = mean(points.map((p) => Math.abs(p.y - p.yhat)))
  return { mape: mape == null ? null : r3(mape), mae: r1(mae), holdout, points }
}

/**
 * Data sufficiency 0-100.
 *   duration  40 pts: months of data / 24
 *   coverage  20 pts: 1 - missing (zero) week ratio
 *   cycles    25 pts: seasonal cycles (weeks / 52) / 2
 *   samples   15 pts: mean weekly count of the series / 30
 */
export function sufficiency(series) {
  const weeks = series.length
  const months = Math.round((weeks * 7) / 30.44)
  const missing = series.filter((p) => !(p.y > 0)).length
  const cycles = weeks / 52
  const avg = mean(series.map((p) => p.y))
  const parts = [
    { key: 'duration', max: 40, score: 40 * Math.min(1, months / 24), value: months, target: 24, label: { tr: 'Veri süresi', en: 'Data duration' }, detail: { tr: `${months} / 24 ay`, en: `${months} / 24 months` } },
    { key: 'coverage', max: 20, score: 20 * (weeks ? 1 - missing / weeks : 0), value: missing, target: 0, label: { tr: 'Eksik hafta oranı', en: 'Missing week ratio' }, detail: { tr: `${missing} eksik hafta / ${weeks}`, en: `${missing} missing weeks / ${weeks}` } },
    { key: 'cycles', max: 25, score: 25 * Math.min(1, cycles / 2), value: r1(cycles), target: 2, label: { tr: 'Mevsimsel döngü tekrarı', en: 'Seasonal cycle repetitions' }, detail: { tr: `${r1(cycles).toLocaleString('tr-TR')} / 2 döngü`, en: `${r1(cycles)} / 2 cycles` } },
    { key: 'samples', max: 15, score: 15 * Math.min(1, avg / 30), value: r1(avg), target: 30, label: { tr: 'Kırılım başına örnek', en: 'Samples per breakdown' }, detail: { tr: `Haftalık ort. ${Math.round(avg)} gönderi (hedef 30+)`, en: `Weekly avg. ${Math.round(avg)} shipments (target 30+)` } },
  ].map((p) => ({ ...p, score: Math.round(p.score * 10) / 10 }))
  const score = Math.round(parts.reduce((s, p) => s + p.score, 0))
  const text =
    months >= 24
      ? { tr: `Mevcut ${months} aylık veri tam mevsimsel modelleme için yeterlidir.`, en: `The available ${months} months of data are sufficient for full seasonal modelling.` }
      : {
          tr: `Tam mevsimsel modelleme için 24 ay önerilir; mevcut ${months} ay ile temel model çalışmaktadır. Veri biriktikçe skor otomatik yükselir.`,
          en: `24 months are recommended for full seasonal modelling; the base model runs on the current ${months} months. The score rises automatically as data accumulates.`,
        }
  const lowSample = avg < 30 ? { tr: ' Bu kırılımda haftalık hacim düşük olduğu için güven aralığı geniştir.', en: ' Weekly volume in this breakdown is low, so the confidence band is wide.' } : null
  if (lowSample) {
    text.tr += lowSample.tr
    text.en += lowSample.en
  }
  return { score, parts, text, months, weeks }
}

function fmtPct(v, lang) {
  const s = Math.abs(v * 100).toFixed(1)
  const n = lang === 'tr' ? s.replace('.', ',') : s
  return lang === 'tr' ? `%${n}` : `${n}%`
}
function fmtNum(v, lang) {
  return Math.round(v).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')
}
function sign(v) {
  return v >= 0 ? '+' : '-'
}

/** Next-4 vs last-4 summary with an 80% band on the 4 week sum. */
export function summarize(result) {
  const hist = result.history
  const last4 = hist.slice(-4).reduce((s, p) => s + p.y, 0)
  const next = result.forecast.slice(0, 4)
  const next4 = next.reduce((s, p) => s + p.yhat, 0)
  // independent weekly errors with variance sigma^2*h -> sum variance sigma^2 * sum(h)
  const steps = next.map((p) => p.h + (result.trainGap || 0))
  const sd = result.decomposition.sigma * Math.sqrt(steps.reduce((s, h) => s + h, 0))
  const band = Z80 * sd
  return {
    next4: Math.round(next4),
    last4: Math.round(last4),
    changePct: last4 ? r3(next4 / last4 - 1) : null,
    band80: Math.round(band),
    bandPct: next4 ? r3(band / next4) : null,
  }
}

/**
 * Live insights. `la01` and `ups` are ForecastResults (without insights) for the
 * LA01 hub and UPS carrier series; `upsTiers` the UPS volumeTiers.
 */
export function computeInsights({ key, label, result, la01, ups, upsTiers, la01Capacity = LA01_WEEKLY_CAPACITY }) {
  const out = []
  const s = result.summary
  if (s && s.changePct != null) {
    const nameTr = label ? `${label.tr || label} için önümüzdeki` : 'Önümüzdeki'
    const nameEn = label ? `Next 4 weeks for ${label.en || label}:` : 'Next 4 weeks:'
    out.push({
      id: 'next4',
      severity: s.changePct >= 0.15 ? 'warning' : 'info',
      tr: `${nameTr} 4 hafta toplam tahmini ${fmtNum(s.next4, 'tr')} gönderi, geçen 4 haftaya (${fmtNum(s.last4, 'tr')}) göre ${sign(s.changePct)}${fmtPct(s.changePct, 'tr')} (güven aralığı ±${fmtNum(s.band80, 'tr')}).`,
      en: `${nameEn} ${fmtNum(s.next4, 'en')} shipments forecast in total, ${sign(s.changePct)}${fmtPct(s.changePct, 'en')} vs the last 4 weeks (${fmtNum(s.last4, 'en')}), confidence band ±${fmtNum(s.band80, 'en')}.`,
    })
  }
  const peak = result.forecast.reduce((m, p) => (p.yhat > m.yhat ? p : m), result.forecast[0])
  if (peak && peak.holiday) {
    out.push({
      id: 'holiday',
      severity: 'info',
      tr: `Tatil sezonu zirvesi ${peak.h}. haftada bekleniyor: ${fmtNum(peak.yhat, 'tr')} gönderi (tatil katsayısı x${result.decomposition.holidayAdj[peak.holiday].toFixed(2).replace('.', ',')}).`,
      en: `Holiday peak expected in week ${peak.h}: ${fmtNum(peak.yhat, 'en')} shipments (holiday factor x${result.decomposition.holidayAdj[peak.holiday].toFixed(2)}).`,
    })
  }
  if (la01) {
    const hitHat = la01.forecast.find((p) => p.yhat > la01Capacity)
    const hit80 = la01.forecast.find((p) => p.hi80 > la01Capacity)
    const maxP = la01.forecast.reduce((m, p) => (p.yhat > m.yhat ? p : m), la01.forecast[0])
    if (hitHat) {
      out.push({ id: 'la01Capacity', severity: 'danger', link: '/ops',
        tr: `LA01 kapasite eşiği (haftalık ${la01Capacity}) ${hitHat.h}. haftada aşılabilir: tahmin ${fmtNum(hitHat.yhat, 'tr')} gönderi.`,
        en: `LA01 capacity threshold (${la01Capacity} per week) may be exceeded in week ${hitHat.h}: forecast ${fmtNum(hitHat.yhat, 'en')} shipments.` })
    } else if (hit80) {
      out.push({ id: 'la01Capacity', severity: 'warning', link: '/ops',
        tr: `LA01 kapasite eşiği (haftalık ${la01Capacity}) ${hit80.h}. haftada %80 güven bandının üst sınırında aşılabilir (üst sınır ${fmtNum(hit80.hi80, 'tr')}).`,
        en: `LA01 capacity threshold (${la01Capacity} per week) may be exceeded in week ${hit80.h} at the upper 80% band (${fmtNum(hit80.hi80, 'en')}).` })
    } else if (maxP) {
      out.push({ id: 'la01Capacity', severity: 'success', link: '/ops',
        tr: `LA01 kapasite eşiği (haftalık ${la01Capacity}) 12 haftalık ufukta aşılmıyor: en yüksek tahmin ${maxP.h}. haftada ${fmtNum(maxP.yhat, 'tr')} gönderi (doluluk ${fmtPct(maxP.yhat / la01Capacity, 'tr')}).`,
        en: `LA01 capacity threshold (${la01Capacity} per week) is not exceeded within 12 weeks: peak forecast ${fmtNum(maxP.yhat, 'en')} shipments in week ${maxP.h} (${fmtPct(maxP.yhat / la01Capacity, 'en')} utilization).` })
    }
  }
  if (ups) {
    const tiers = (upsTiers || []).map((t) => t.weeklyVolume).filter((v) => v > 0).sort((a, b) => a - b)
    const lastActual = ups.history.slice(-4).reduce((s, p) => s + p.y, 0) / 4
    const threshold = tiers.find((v) => v > lastActual) ?? UPS_TIER_THRESHOLD
    const cross = ups.forecast.find((p) => p.yhat >= threshold)
    const near = ups.forecast.find((p) => p.yhat >= threshold * 0.85)
    if (cross) {
      out.push({ id: 'upsTier', severity: 'warning', link: '/ai/pricing',
        tr: `UPS hacminiz ${cross.h}. haftada tarife kademesi eşiğini (haftalık ${threshold}) aşıyor (tahmin ${fmtNum(cross.yhat, 'tr')}): dinamik fiyatlandırmaya aktarıldı.`,
        en: `Your UPS volume crosses the rate tier threshold (${threshold} per week) in week ${cross.h} (forecast ${fmtNum(cross.yhat, 'en')}): passed to dynamic pricing.` })
    } else if (near) {
      out.push({ id: 'upsTier', severity: 'info', link: '/ai/pricing',
        tr: `UPS hacminiz tarife kademesi eşiğine (haftalık ${threshold}) yaklaşıyor (${near.h}. hafta tahmini ${fmtNum(near.yhat, 'tr')}): dinamik fiyatlandırmaya aktarıldı.`,
        en: `Your UPS volume is approaching the rate tier threshold (${threshold} per week), week ${near.h} forecast ${fmtNum(near.yhat, 'en')}: passed to dynamic pricing.` })
    } else {
      out.push({ id: 'upsTier', severity: 'info', link: '/ai/pricing',
        tr: `UPS haftalık hacmi (ort. ${fmtNum(lastActual, 'tr')}) 12 hafta içinde tarife kademesi eşiğine (${threshold}) ulaşmıyor.`,
        en: `UPS weekly volume (avg. ${fmtNum(lastActual, 'en')}) does not reach the rate tier threshold (${threshold}) within 12 weeks.` })
    }
  }
  return out
}

/**
 * Full run for one breakdown series.
 * history: resolved history rows (ISO weekStart), increments already added.
 * trainWeeks: number of leading weeks the model is fitted on (default all).
 */
export function runForecast({ history, key = 'total', trainWeeks, version = 'v2.1', trainedAt = null, horizon = HORIZON }) {
  const series = buildSeries(history, key)
  if (!series || !series.length) return null
  const nTrain = Math.max(MA_WINDOW + 2, Math.min(series.length, trainWeeks || series.length))
  const train = series.slice(0, nTrain)
  const model = decompose(train)
  const fitted = series.map((p, t) => ({ weekStart: p.weekStart, yhat: r1(Math.max(0, model.predictAt(t, p.weekStart))) }))
  const residuals = series.map((p, t) => ({ weekStart: p.weekStart, value: r1(p.y - fitted[t].yhat) }))
  const forecast = forecastFrom(model, series, horizon)
  const bt = backtest(train, HOLDOUT)
  const result = {
    key,
    version,
    trainedAt,
    trainWeeks: nTrain,
    trainGap: series.length - nTrain,
    history: series,
    fitted,
    forecast,
    decomposition: {
      trend: series.map((p, t) => ({ weekStart: p.weekStart, ma: t < nTrain && model.ma[t] != null ? r1(model.ma[t]) : null, value: r1(model.trendAt(t)) })),
      seasonalIndex: model.seasonalIndex.map(r3),
      holidayAdj: { novLast: r3(model.holidayAdj.novLast), dec1: r3(model.holidayAdj.dec1), dec2: r3(model.holidayAdj.dec2) },
      residuals,
      sigma: r1(model.sigma),
      slope: r3(model.slope),
      intercept: r1(model.intercept),
      monthsCovered: model.monthsCovered,
    },
    metrics: { mape: bt.mape, mae: bt.mae, holdout: HOLDOUT, backtest: bt.points },
    sufficiency: sufficiency(train),
    insights: [],
  }
  result.summary = summarize(result)
  return result
}

export const STOCK_TARGET_WEEKS = 8 // cover to plan for after the first-mile shipment lands
export const FIRST_MILE_LEAD_WEEKS = 2 // Türkiye -> US hub door to shelf (air, customs, intake)

/**
 * Hub stock-out estimate (pure).
 *   products:        [{ sku, title, stock: { NJ01, LA01 }, inventoryHubs? }]
 *   salesBySku:      { sku: units sold recently } (any window; only the shares matter)
 *   inboundBySku:    { sku: units on first-mile shipments heading to this hub }
 *   weeklyShipments: forecast stock-flow shipments per week leaving this hub
 *   unitsPerShipment: average units per shipment (recent orders)
 * Returns { hub, weeklyUnits, onHand, inbound, weeksOnHand, weeksTotal, weeks, severity, items: [...], recommended: [...] }
 *   weeksTotal: (on hand + inbound) / weekly demand for the whole hub.
 *   weeks: the "may run out within X weeks" figure: SKU cover (on hand + inbound) at which
 *          SKUs carrying `stockoutShare` (25%) of the weekly demand are out of stock.
 */
export function stockoutPlan({ hub, products = [], salesBySku = {}, inboundBySku = {}, weeklyShipments = 0, unitsPerShipment = 1,
  targetWeeks = STOCK_TARGET_WEEKS, leadWeeks = FIRST_MILE_LEAD_WEEKS, maxItems = 8, packOf = 5, stockoutShare = 0.25 }) {
  const list = products.filter((p) => (p.inventoryHubs ? p.inventoryHubs.includes(hub) : (p.stock?.[hub] || 0) > 0))
  const n = list.length
  const sold = list.reduce((s, p) => s + (salesBySku[p.sku] || 0), 0)
  const weeklyUnits = Math.max(0, weeklyShipments * unitsPerShipment)
  const items = list.map((p) => {
    // light smoothing so a SKU with no recent sales still gets a small share
    const share = (sold + n * 0.5) > 0 ? ((salesBySku[p.sku] || 0) + 0.5) / (sold + n * 0.5) : 1 / Math.max(1, n)
    const weekly = weeklyUnits * share
    const onHand = Math.max(0, p.stock?.[hub] || 0)
    const inbound = Math.max(0, inboundBySku[p.sku] || 0)
    const cover = weekly > 0 ? (onHand + inbound) / weekly : Infinity
    const coverOnHand = weekly > 0 ? onHand / weekly : Infinity
    const need = weekly * (targetWeeks + leadWeeks) - onHand - inbound
    const qty = need > 0 ? Math.max(packOf, Math.ceil(need / packOf) * packOf) : 0
    return { sku: p.sku, title: p.title, share: r3(share), weekly: r1(weekly), onHand, inbound, cover: Number.isFinite(cover) ? r1(cover) : null, coverOnHand: Number.isFinite(coverOnHand) ? r1(coverOnHand) : null, qty }
  })
  const onHand = items.reduce((s, i) => s + i.onHand, 0)
  const inbound = items.reduce((s, i) => s + i.inbound, 0)
  const weeksTotal = weeklyUnits > 0 ? (onHand + inbound) / weeklyUnits : null
  const weeksOnHand = weeklyUnits > 0 ? onHand / weeklyUnits : null
  // Stock-out point: the week by which SKUs carrying `stockoutShare` of weekly demand have run out
  // (a hub "runs out" for the seller long before the last unit is gone).
  let weeks = null
  if (weeklyUnits > 0) {
    const sorted = items.filter((i) => i.cover != null).sort((a, b) => a.cover - b.cover)
    let acc = 0
    for (const i of sorted) { acc += i.weekly; if (acc >= weeklyUnits * stockoutShare) { weeks = i.cover; break } }
    if (weeks == null) weeks = weeksTotal
  }
  const recommended = items
    .filter((i) => i.qty > 0 && i.cover != null && i.cover < targetWeeks)
    .sort((a, b) => a.cover - b.cover || b.weekly - a.weekly)
    .slice(0, maxItems)
  const severity = weeks == null ? 'info' : weeks < leadWeeks + 2 ? 'danger' : weeks < targetWeeks ? 'warning' : 'info'
  return {
    hub, weeklyUnits: r1(weeklyUnits), weeklyShipments: r1(weeklyShipments), unitsPerShipment: r3(unitsPerShipment),
    onHand, inbound, weeks: weeks == null ? null : r1(weeks), weeksTotal: weeksTotal == null ? null : r1(weeksTotal), weeksOnHand: weeksOnHand == null ? null : r1(weeksOnHand),
    severity, targetWeeks, leadWeeks, items, recommended,
  }
}
