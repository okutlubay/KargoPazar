/**
 * Demand forecast API (spec 6.2, 5.3 insight card). Wraps ai/forecastModel.js.
 *
 * Model state lives in the db document 'aiForecast' (not seeded):
 *   { version: 'v2.1', trainedAt: ISO, trainWeeks: 77, history: [{version, trainedAt, mape, mae, trainWeeks}] }
 * Default (never retrained): v2.1, trained at the start of the latest history week
 * on the first 77 weeks, so "retrain" really adds data (the latest closed week and
 * every shipment created after the seed, appended to the latest week).
 *
 * Exported API
 *   listBreakdowns() -> [{ group, label: {tr,en}, items: [{ key, label: {tr,en}|string }] }]   (sync)
 *   getForecast(key = 'total') -> Promise<ForecastResult & { label, meta }>
 *       ForecastResult: see ai/forecastModel.js runForecast (history, fitted, forecast[{weekStart, h,
 *       yhat, lo80, hi80, lo95, hi95, lastYear, holiday}], decomposition{trend, seasonalIndex[12],
 *       holidayAdj, residuals, sigma}, metrics{mape (fraction), mae, holdout, backtest}, sufficiency{score,
 *       parts, text}, insights[{id, severity, tr, en, link?}], summary{next4, last4, changePct, band80, bandPct}, version)
 *       meta: { version, trainedAt, trainWeeks, dataWeeks, newShipments, pendingShipments, lastWeekStart }
 *   retrain(onProgress?) -> Promise<{ version, previousVersion, trainedAt, trainWeeks, metrics, previousMetrics, sufficiency }>
 *       onProgress(pct 0-100, step: { key, label: {tr,en} })
 *   exportCsv(key = 'total') -> Promise<{ filename, csv, mime }>
 *   downloadCsv(key = 'total') -> Promise<{ filename }>   (exportCsv + browser download)
 *   forecastSummary() -> Promise<{ changePct, bandPct, next4, last4, band80, version, trainedAt, text: {tr,en}, link }>
 *   getModelInfo() -> Promise<{ id: 'forecast', version, label, trainedAt, trainWeeks, datasetSize, series,
 *       metric: { key: 'mape', value }, mae, sufficiency, status: 'active' }>
 *   forecastMeta() -> { version, trainedAt, trainWeeks }   (sync, reactive read)
 *   computeForecast(key) -> ForecastResult   (sync, no request; used by api/pricing.js)
 *   computeStockout(hub = 'NJ01') -> StockoutPlan & { inboundShipments, nextEta, version }   (sync)
 *   stockoutInsight(hub = 'NJ01') -> Promise<same>   GET /v1/ai/forecast/stockout?hub=
 *       hub forecast (next 4 weeks avg) x stock-flow share x units per order, allocated to SKUs by
 *       the last 12 weeks of sales; see ai/forecastModel.js stockoutPlan.
 */
import { db } from '../store/db.js'
import { can } from '../store/session.js'
import { notify, audit, modelEvent } from '../store/events.js'
import { request, runSteps, ApiError } from './client.js'
import { t, locale } from '../i18n/index.js'
import M from '../i18n/modules/ai-forecast.js'
import {
  runForecast,
  buildSeries,
  addIncrements,
  seriesKeys,
  parseKey,
  computeInsights,
  LA01_WEEKLY_CAPACITY,
  stockoutPlan,
} from '../ai/forecastModel.js'
import { stageIndex } from './intl.js'

const STATE = 'aiForecast'
const DEFAULT_VERSION = 'v2.1'

/** { tr, en } for a key in the aiModel namespace (for notifications / audit). */
export function both(path, params) {
  const get = (lang) => {
    let cur = M[lang].aiModel
    for (const p of path.split('.')) cur = cur?.[p]
    let s = typeof cur === 'string' ? cur : path
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m)
    return s
  }
  return { tr: get('tr'), en: get('en') }
}

function history() {
  return db.all('history_weekly')
}

let seedIds = null
function newShipments() {
  if (!seedIds) seedIds = new Set((db.seed('shipments') || []).map((s) => s.id))
  return db.all('shipments').filter((s) => !seedIds.has(s.id) && s.status !== 'voided')
}

function defaultState() {
  const h = history()
  const last = h[h.length - 1]
  const trainedAt = last ? new Date(new Date(last.weekStart).getTime() + 6 * 3600000).toISOString() : new Date().toISOString()
  return { version: DEFAULT_VERSION, trainedAt, trainWeeks: Math.max(0, h.length - 1), history: [] }
}

function state() {
  const s = db.doc(STATE)
  if (!s || Array.isArray(s) || !s.version) return defaultState()
  return s
}

export function forecastMeta() {
  const s = state()
  return { version: s.version, trainedAt: s.trainedAt, trainWeeks: s.trainWeeks }
}

function bumpVersion(v) {
  const m = /^v?(\d+)\.(\d+)$/.exec(v || '')
  if (!m) return DEFAULT_VERSION
  return `v${m[1]}.${Number(m[2]) + 1}`
}

/** History with post-seed shipments (created up to `until`) appended to the latest week. */
function modelHistory(until) {
  const cutoff = until ? new Date(until).getTime() : Infinity
  const extra = newShipments().filter((s) => new Date(s.createdAt).getTime() <= cutoff)
  return { rows: addIncrements(history(), extra), extra: extra.length }
}

const cache = new Map()
function cacheKey(key, s) {
  return `${key}|${s.version}|${s.trainedAt}|${s.trainWeeks}|${db.all('shipments').length}`
}

export function computeForecast(key = 'total') {
  const s = state()
  const ck = cacheKey(key, s)
  if (cache.has(ck)) return cache.get(ck)
  // the model sees data up to its training time; the chart shows everything
  const train = modelHistory(s.trainedAt)
  const shown = modelHistory(null)
  const r = runForecast({ history: train.rows, key, trainWeeks: s.trainWeeks, version: s.version, trainedAt: s.trainedAt })
  if (!r) return null
  // display the live history (includes shipments created after training)
  const result = { ...r, history: buildSeries(shown.rows, key), trainExtra: train.extra, liveExtra: shown.extra }
  if (cache.size > 60) cache.clear()
  cache.set(ck, result)
  return result
}

function carrierName(code) {
  return db.get('carriers', code)?.name ?? code
}
const CHANNEL_NAMES = { shopify: 'Shopify', etsy: 'Etsy', amazon: 'Amazon', ebay: 'eBay', woocommerce: 'WooCommerce', manual: { tr: 'Manuel', en: 'Manual' }, api: 'API' }

function labelFor(key) {
  const p = parseKey(key)
  if (!p) return key
  if (p.group === 'total') return both('forecast.groups.total')
  if (p.group === 'byHub') return p.member
  if (p.group === 'byCarrier') return carrierName(p.member)
  if (p.group === 'byRegion') return both(`forecast.regions.${p.member}`)
  return CHANNEL_NAMES[p.member] ?? p.member
}

export function listBreakdowns() {
  const keys = seriesKeys(history())
  const groups = ['total', 'byHub', 'byCarrier', 'byRegion', 'byChannel']
  return groups.map((g) => ({
    group: g,
    label: both(`forecast.groups.${g}`),
    items: keys.filter((k) => (g === 'total' ? k === 'total' : k.startsWith(g + '.'))).map((k) => ({ key: k, label: labelFor(k) })),
  }))
}

function withInsights(key) {
  const result = computeForecast(key)
  if (!result) throw new ApiError('UNKNOWN_SERIES', t('aiModel.errors.UNKNOWN_SERIES'), 404)
  const la01 = computeForecast('byHub.LA01')
  const ups = computeForecast('byCarrier.UPS')
  const upsTiers = db.get('carriers', 'UPS')?.volumeTiers
  const label = key === 'total' ? null : labelFor(key)
  const insights = computeInsights({ key, label, result, la01, ups, upsTiers, la01Capacity: LA01_WEEKLY_CAPACITY })
  return { ...result, insights, label: labelFor(key) }
}

function meta() {
  const s = state()
  const h = history()
  const pending = newShipments().filter((x) => new Date(x.createdAt).getTime() > new Date(s.trainedAt).getTime()).length
  return {
    version: s.version,
    trainedAt: s.trainedAt,
    trainWeeks: s.trainWeeks,
    dataWeeks: h.length,
    newShipments: newShipments().length,
    pendingShipments: pending, // created after the last training (retrain includes them)
    pendingWeeks: Math.max(0, h.length - s.trainWeeks),
    lastWeekStart: h[h.length - 1]?.weekStart ?? null,
  }
}

const predicted = new Set()

export function getForecast(key = 'total') {
  return request(`GET /v1/ai/forecast?series=${key}`, () => {
    if (!parseKey(key)) throw new ApiError('UNKNOWN_SERIES', t('aiModel.errors.UNKNOWN_SERIES'), 404)
    const r = withInsights(key)
    const m = meta()
    const tag = `${key}|${m.version}`
    if (!predicted.has(tag)) {
      predicted.add(tag)
      const lbl = r.label
      const name = { tr: typeof lbl === 'string' ? lbl : lbl.tr, en: typeof lbl === 'string' ? lbl : lbl.en }
      modelEvent('forecast', 'predict', {
        tr: `${name.tr} serisi için 12 haftalık tahmin üretildi (${m.version})`,
        en: `12 week forecast generated for ${name.en} (${m.version})`,
      })
    }
    return { ...r, meta: m }
  }, { minMs: 350, maxMs: 750 })
}

const TRAIN_STEPS = ['load', 'ma', 'trend', 'seasonal', 'holiday', 'residuals', 'backtest', 'sufficiency', 'publish']

export function retrain(onProgress) {
  return request('POST /v1/ai/forecast/train', async () => {
    if (!can('ai.manage')) throw new ApiError('FORBIDDEN', t('aiModel.errors.FORBIDDEN'), 403)
    const prev = state()
    const before = computeForecast('total')
    const previousMetrics = { mape: before.metrics.mape, mae: before.metrics.mae, sufficiency: before.sufficiency.score }
    const now = new Date().toISOString()
    const next = {
      version: bumpVersion(prev.version),
      trainedAt: now,
      trainWeeks: history().length,
      history: [
        ...(prev.history || []),
        { version: prev.version, trainedAt: prev.trainedAt, trainWeeks: prev.trainWeeks, mape: previousMetrics.mape, mae: previousMetrics.mae },
      ].slice(-20),
    }
    let after = null
    const steps = TRAIN_STEPS.map((k) => async () => {
      if (k === 'backtest') {
        // fit the new model on the new data (not yet published)
        const rows = modelHistory(now).rows
        after = runForecast({ history: rows, key: 'total', trainWeeks: next.trainWeeks, version: next.version, trainedAt: now })
      }
      if (k === 'publish') {
        db.set(STATE, next)
        cache.clear()
      }
      return k
    })
    await runSteps(steps, (pct, i) => onProgress?.(pct, { key: TRAIN_STEPS[i], label: both(`forecast.steps.${TRAIN_STEPS[i]}`) }), { stepMs: [220, 380] })
    const metrics = { mape: after.metrics.mape, mae: after.metrics.mae, sufficiency: after.sufficiency.score }
    const fmtM = (v) => (v == null ? '-' : (v * 100).toFixed(1))
    modelEvent('forecast', 'train', {
      tr: `Model ${prev.version} -> ${next.version} yeniden eğitildi: ${next.trainWeeks} hafta, MAPE %${fmtM(previousMetrics.mape).replace('.', ',')} -> %${fmtM(metrics.mape).replace('.', ',')}`,
      en: `Model retrained ${prev.version} -> ${next.version}: ${next.trainWeeks} weeks, MAPE ${fmtM(previousMetrics.mape)}% -> ${fmtM(metrics.mape)}%`,
    })
    audit('ai.forecast.retrain', next.version, { tr: `Talep tahmini ${next.version} yayınlandı`, en: `Demand forecast ${next.version} published` })
    notify({
      type: 'info',
      title: both('forecast.retrainNotifyTitle', { v: next.version }),
      body: both('forecast.retrainNotifyBody'),
      link: '/ai/pricing',
    })
    return {
      version: next.version,
      previousVersion: prev.version,
      trainedAt: now,
      trainWeeks: next.trainWeeks,
      previousTrainWeeks: prev.trainWeeks,
      metrics,
      previousMetrics,
      sufficiency: after.sufficiency,
    }
  }, { minMs: 300, maxMs: 500 })
}

function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function localDay(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildCsv(key) {
  const r = withInsights(key)
  const c = (k) => t(`aiModel.forecast.csv.${k}`)
  const lbl = typeof r.label === 'string' ? r.label : r.label[locale.value] ?? r.label.en
  const lines = []
  lines.push([c('series'), lbl, c('version'), r.version].map(csvCell).join(','))
  lines.push(['weekStart', 'type', 'actual', 'forecast', 'lo80', 'hi80', 'lo95', 'hi95', 'lastYear', 'change'].map((k) => csvCell(c(k))).join(','))
  r.history.forEach((p, i) => {
    lines.push([localDay(p.weekStart), c('history'), p.y, r.fitted[i]?.yhat ?? '', '', '', '', '', '', ''].map(csvCell).join(','))
  })
  for (const p of r.forecast) {
    const chg = p.lastYear ? ((p.yhat / p.lastYear - 1) * 100).toFixed(1) : ''
    lines.push([localDay(p.weekStart), c('future'), '', p.yhat, p.lo80, p.hi80, p.lo95, p.hi95, p.lastYear ?? '', chg].map(csvCell).join(','))
  }
  const date = localDay(new Date().toISOString())
  return { filename: `kargopazar-forecast-${key.replace(/\./g, '-')}-${r.version}-${date}.csv`, csv: '﻿' + lines.join('\r\n'), mime: 'text/csv;charset=utf-8' }
}

export function exportCsv(key = 'total') {
  return request(`GET /v1/ai/forecast/export?series=${key}`, () => {
    if (!parseKey(key)) throw new ApiError('UNKNOWN_SERIES', t('aiModel.errors.UNKNOWN_SERIES'), 404)
    return buildCsv(key)
  }, { minMs: 250, maxMs: 500 })
}

export async function downloadCsv(key = 'total') {
  const out = await exportCsv(key)
  const blob = new Blob([out.csv], { type: out.mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = out.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { filename: out.filename }
}

function pctText(v, lang) {
  const s = (Math.abs(v) * 100).toFixed(1)
  return lang === 'tr' ? `%${s.replace('.', ',')}` : `${s}%`
}

export function forecastSummary() {
  return request('GET /v1/ai/forecast/summary', () => {
    const r = computeForecast('total')
    const s = r.summary
    const k = s.changePct > 0.005 ? 'summaryUp' : s.changePct < -0.005 ? 'summaryDown' : 'summaryFlat'
    const text = {
      tr: both(`forecast.${k}`, { pct: pctText(s.changePct, 'tr'), band: pctText(s.bandPct, 'tr') }).tr,
      en: both(`forecast.${k}`, { pct: pctText(s.changePct, 'en'), band: pctText(s.bandPct, 'en') }).en,
    }
    return { ...s, version: r.version, trainedAt: r.trainedAt, text, link: '/ai/forecast' }
  }, { minMs: 200, maxMs: 450 })
}

export function getModelInfo() {
  return request('GET /v1/ai/models/forecast', () => {
    const r = computeForecast('total')
    const keys = seriesKeys(history())
    return {
      id: 'forecast',
      version: r.version,
      label: `forecast ${r.version}`,
      trainedAt: r.trainedAt,
      trainWeeks: r.trainWeeks,
      datasetSize: r.trainWeeks * keys.length, // weekly observations across all breakdown series
      series: keys.length,
      metric: { key: 'mape', value: r.metrics.mape },
      mae: r.metrics.mae,
      sufficiency: r.sufficiency.score,
      status: 'active',
    }
  }, { minMs: 200, maxMs: 450 })
}

// ---------------------------------------------------------------------------
// US hub stock-out estimate (demand forecast x on-hand + inbound first-mile stock)
// ---------------------------------------------------------------------------

const SALES_WINDOW_DAYS = 84

/** First-mile stock shipments of the signed-in customer still on the way to `hub` (before at_us_hub). */
export function inboundFirstMile(hub) {
  const me = db.doc('user')?.customerId
  const atHub = stageIndex('at_us_hub')
  return db.all('intl_shipments').filter((r) => r.purpose === 'stock' && (!me || !r.customerId || r.customerId === me)
    && (!hub || r.destHub === hub) && stageIndex(r.stage) >= 0 && stageIndex(r.stage) < atHub)
}

export function computeStockout(hub = 'NJ01') {
  const f = computeForecast(`byHub.${hub}`)
  const next = (f?.forecast || []).slice(0, 4)
  const hubWeekly = next.length ? next.reduce((s, p) => s + p.yhat, 0) / next.length : 0
  const since = Date.now() - SALES_WINDOW_DAYS * 86400000
  const recentShip = db.all('shipments').filter((s) => s.hub === hub && !s.test && s.status !== 'voided' && new Date(s.createdAt).getTime() >= since)
  const stockShare = recentShip.length ? recentShip.filter((s) => (s.flow ?? 'stock') === 'stock').length / recentShip.length : 1
  const shipHub = new Map(db.all('shipments').map((s) => [s.id, s.hub]))
  const orders = db.all('orders').filter((o) => (o.flow ?? 'stock') === 'stock' && new Date(o.createdAt).getTime() >= since)
  const hubOrders = orders.filter((o) => shipHub.get(o.shipmentId) === hub)
  const basis = hubOrders.length >= 10 ? hubOrders : orders
  const salesBySku = {}
  let units = 0
  for (const o of basis) for (const it of o.items || []) { salesBySku[it.sku] = (salesBySku[it.sku] || 0) + (Number(it.qty) || 0); units += Number(it.qty) || 0 }
  const unitsPerShipment = basis.length ? units / basis.length : 1
  const inboundShipments = inboundFirstMile(hub)
  const inboundBySku = {}
  for (const r of inboundShipments) for (const pc of r.parcels || []) for (const it of pc.items || []) inboundBySku[it.sku] = (inboundBySku[it.sku] || 0) + (Number(it.qty) || 0)
  const plan = stockoutPlan({ hub, products: db.all('products'), salesBySku, inboundBySku, weeklyShipments: hubWeekly * stockShare, unitsPerShipment })
  const etas = inboundShipments.map((r) => r.eta).filter(Boolean).sort()
  return { ...plan, inboundShipments: inboundShipments.length, nextEta: etas[0] ?? null, version: f?.version ?? null }
}

export function stockoutInsight(hub = 'NJ01') {
  return request(`GET /v1/ai/forecast/stockout?hub=${hub}`, () => computeStockout(hub), { minMs: 200, maxMs: 450 })
}

/** Route query for the first-mile form prefilled with a stock-out proposal (IntlNewView reads it). */
export function firstMileQuery(plan, origin = 'TR') {
  const skus = (plan?.recommended || []).map((i) => `${i.sku}:${i.qty}`).join(',')
  return { skus, hub: plan?.hub || 'NJ01', origin }
}
