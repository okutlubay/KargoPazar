// Model activity feed for the AI hub and module pages (spec 6.0 "Model etkinlik log'u").
// Read only: merges the live `modelEvents` collection (written by api/* through modelEvent())
// with events derived from real records that existed before this session (model trainings in
// the registry, forecast training, pricing recompute, AI picks on shipments, address checks on
// orders), so a fresh demo still shows what the models have been doing.
import { computed } from 'vue'
import { db } from '../../store/db.js'
import { listModelInfo } from '../../ai/modelRegistry.js'
import { forecastMeta } from '../../api/forecast.js'

export const MODULES = ['address', 'forecast', 'pricing', 'optimizer', 'hs', 'customs']

const KIND_ICON = {
  train: 'refresh', predict: 'spark', feedback: 'edit', approve: 'check-circle', accept: 'check', override: 'x-circle',
}
export const kindIcon = kind => KIND_ICON[kind] || 'info'

function derived() {
  const out = []
  const live = db.all('modelEvents')
  const liveTrain = new Set(live.filter(e => e.kind === 'train').map(e => e.module))
  for (const m of listModelInfo()) {
    if (m.id === 'forecast' || m.id === 'pricing') continue
    const hist = m.history?.length ? m.history : [{ version: m.version, at: m.lastTrainedAt }]
    // trainings done in this session already have a live event
    for (const h of hist) {
      if (!h.at) continue
      if (liveTrain.has(m.id) && h.version === m.version) continue
      out.push({ id: `D-${m.id}-${h.version}`, at: h.at, module: m.id, kind: 'train', detail: { code: 'train', version: `${m.name} v${h.version}` }, derived: true })
    }
  }
  try {
    const f = forecastMeta()
    if (f?.trainedAt && !liveTrain.has('forecast')) out.push({ id: `D-forecast-${f.version}`, at: f.trainedAt, module: 'forecast', kind: 'train', detail: { code: 'train', version: `forecast ${f.version}` }, derived: true })
  } catch { /* forecast state not ready */ }
  const recs = db.doc('pricing_recs')
  if (recs?.generatedAt && !live.some(e => e.module === 'pricing' && e.kind === 'predict')) {
    const lanes = Array.isArray(recs.lanes) ? recs.lanes : []
    out.push({ id: 'D-pricing-gen', at: recs.generatedAt, module: 'pricing', kind: 'predict', detail: { code: 'pricingGenerated', n: lanes.length, proposed: lanes.filter(l => l.status === 'proposed').length }, derived: true })
  }
  const ships = db.all('shipments').filter(s => s.aiPick && s.createdAt).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8)
  for (const s of ships) {
    if (live.some(e => e.detail?.shipmentId === s.id)) continue
    out.push({ id: `D-opt-${s.id}`, at: s.createdAt, module: 'optimizer', kind: s.aiPick.chosen ? 'accept' : 'override', detail: { code: s.aiPick.chosen ? 'pickAccepted' : 'pickOverridden', shipmentId: s.id, carrier: s.carrier, service: s.service, savings: s.aiPick.savingsVsDefault }, derived: true })
  }
  const orders = db.all('orders').filter(o => o.addressCheck?.checkedAt).slice().sort((a, b) => String(b.addressCheck.checkedAt).localeCompare(String(a.addressCheck.checkedAt))).slice(0, 6)
  for (const o of orders) {
    out.push({ id: `D-addr-${o.id}`, at: o.addressCheck.checkedAt, module: 'address', kind: 'predict', detail: { code: 'orderChecked', orderId: o.id, score: o.addressCheck.score }, derived: true })
  }
  return out
}

/** Reactive list, newest first. module: optional filter. */
export function useModelActivity({ limit = 20, module = null } = {}) {
  return computed(() => {
    const mod = typeof module === 'function' ? module() : module?.value !== undefined ? module.value : module
    const all = [...db.all('modelEvents').map(e => ({ ...e, derived: false })), ...derived()]
      .filter(e => !mod || e.module === mod)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const lim = typeof limit === 'object' && limit ? limit.value : limit
    return all.slice(0, lim)
  })
}

/** Human readable text of an event (details are {tr,en} or structured objects). */
export function eventText(ev, { t, tx, fmt }) {
  const d = ev.detail
  if (d == null) return t(`aiHub.activity.kinds.${ev.kind}`)
  if (typeof d === 'string') return d
  if (typeof d === 'object' && ('tr' in d || 'en' in d)) return tx(d)
  const p = { ...d }
  if (d.code && ev.derived) {
    if (d.savings != null) p.savings = fmt.money(d.savings)
    return t(`aiHub.activity.derived.${d.code}`, p)
  }
  if (ev.module === 'address' && ev.kind === 'predict' && d.count != null) return t('aiHub.activity.structured.addressBatch', { n: d.count, problems: d.problems ?? 0 })
  if (ev.module === 'address' && ev.kind === 'feedback' && d.orderId) return t('aiHub.activity.structured.addressApplied', { order: d.orderId, before: d.before ?? '-', after: d.after ?? '-' })
  if (ev.module === 'hs' && ev.kind === 'predict' && d.title) return t('aiHub.activity.structured.hsPredict', { title: d.title, code: d.code, prob: fmt.percent(d.prob ?? 0, 0) })
  if (ev.module === 'optimizer' && (ev.kind === 'accept' || ev.kind === 'override') && d.shipmentId) {
    return t(`aiHub.activity.structured.${ev.kind === 'accept' ? 'pickAccepted' : 'pickOverridden'}`, { shipment: d.shipmentId, suggested: d.suggested ?? '-', chosen: d.chosen ?? '-', savings: fmt.money(d.savings ?? 0) })
  }
  return t(`aiHub.activity.kinds.${ev.kind}`)
}
