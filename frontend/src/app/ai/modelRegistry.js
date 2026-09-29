/**
 * AI model registry: version, last training time, dataset sizes, cached metrics
 * and training history for every AI module. Persisted in the db collection
 * `aiModels` (one record per module, id = module key). Records are created on
 * the first training; until then getModelInfo() returns the defaults below
 * (no write). Writes happen only through recordTraining() / updateModelInfo(),
 * which are called from api/*.js inside request().
 *
 *   getModelInfo('address') -> { id, name, version, label: 'addr-ml v1.3', lastTrainedAt, trainSize,
 *                                testSize, datasetSize, metrics, feedbackIds, history: [...] }
 *   listModelInfo() -> same for all six modules
 *   recordTraining(key, { metrics, trainSize, testSize, datasetSize, feedbackIds, extra }) -> new info (minor version +1)
 *   updateModelInfo(key, patch) -> info (no version bump; e.g. cache metrics of the initial model)
 *   trainedFeedback(key, collection) -> feedback records included in the last training
 *   bilingual(key, params) -> { tr, en } built from i18n/modules/ai-engine.js (key under aiEngine.)
 */
import { db } from '../store/db.js'
import messages from '../i18n/modules/ai-engine.js'

const COL = 'aiModels'

// Initial versions shipped with the demo. lastTrained is relative to "now" so the
// demo always looks current; metrics are never stored here (always computed).
export const MODEL_DEFAULTS = {
  address: { name: 'addr-ml', version: '1.3', trainedDaysAgo: 6 },
  forecast: { name: 'forecast', version: '2.1', trainedDaysAgo: 2 },
  pricing: { name: 'pricing', version: '1.4', trainedDaysAgo: 2 },
  optimizer: { name: 'opt', version: '2.0', trainedDaysAgo: 1 },
  hs: { name: 'hs-nb', version: '1.2', trainedDaysAgo: 9 },
  customs: { name: 'customs-docs', version: '1.1', trainedDaysAgo: 14 },
}

function daysAgoIso(d) {
  const t = new Date()
  t.setDate(t.getDate() - d)
  t.setHours(3, 12, 0, 0)
  return t.toISOString()
}

function defaults(key) {
  const d = MODEL_DEFAULTS[key] || { name: key, version: '1.0', trainedDaysAgo: 0 }
  return {
    id: key,
    name: d.name,
    version: d.version,
    lastTrainedAt: daysAgoIso(d.trainedDaysAgo),
    trainSize: null,
    testSize: null,
    datasetSize: null,
    metrics: null,
    feedbackIds: [],
    history: [],
  }
}

function withLabel(rec) {
  return { ...rec, label: `${rec.name} v${rec.version}` }
}

export function getModelInfo(key) {
  const rec = db.get(COL, key)
  return withLabel(rec ? { ...defaults(key), ...rec } : defaults(key))
}

export function listModelInfo() {
  return Object.keys(MODEL_DEFAULTS).map(getModelInfo)
}

function bump(version) {
  const [maj, min] = String(version).split('.').map(n => parseInt(n, 10) || 0)
  return `${maj}.${min + 1}`
}

function upsert(key, patch) {
  const existing = db.get(COL, key)
  if (existing) db.update(COL, key, patch)
  else db.insert(COL, { ...defaults(key), ...patch, id: key }, { prepend: false })
  return getModelInfo(key)
}

export function updateModelInfo(key, patch) {
  return upsert(key, patch)
}

export function recordTraining(key, { metrics, trainSize, testSize, datasetSize, feedbackIds, extra } = {}) {
  const cur = getModelInfo(key)
  const version = bump(cur.version)
  const at = new Date().toISOString()
  const history = [
    ...(cur.history || []),
    ...(cur.history?.length ? [] : [{ version: cur.version, at: cur.lastTrainedAt, metrics: cur.metrics, trainSize: cur.trainSize }]),
    { version, at, metrics: metrics ?? null, trainSize: trainSize ?? null },
  ].slice(-20)
  return upsert(key, {
    version,
    lastTrainedAt: at,
    metrics: metrics ?? null,
    trainSize: trainSize ?? cur.trainSize,
    testSize: testSize ?? cur.testSize,
    datasetSize: datasetSize ?? cur.datasetSize,
    feedbackIds: feedbackIds ?? cur.feedbackIds,
    history,
    ...(extra || {}),
  })
}

/** Feedback records (from `collection`) that were part of the last training of `key`. */
export function trainedFeedback(key, collection) {
  const ids = new Set(getModelInfo(key).feedbackIds || [])
  if (!ids.size) return []
  return db.all(collection).filter(f => ids.has(f.id))
}

function lookup(obj, path) {
  let cur = obj
  for (const p of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

function interp(str, params) {
  if (typeof str !== 'string' || !params) return str
  return str.replace(/\{(\w+)\}/g, (m, p) => {
    const v = params[p]
    if (v == null) return m
    if (typeof v === 'object' && 'tr' in v) return m
    return String(v)
  })
}

/** Bilingual label from the aiEngine i18n namespace. Param values may be {tr,en} objects. */
export function bilingual(key, params) {
  const out = {}
  for (const lang of ['tr', 'en']) {
    const raw = lookup(messages[lang]?.aiEngine, key) ?? key
    const p = params ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v && typeof v === 'object' && lang in v ? v[lang] : v])) : null
    out[lang] = interp(raw, p)
  }
  return out
}
