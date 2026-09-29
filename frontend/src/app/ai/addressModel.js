/**
 * Address validation model (spec 6.1): rule layer + logistic regression.
 *
 * validateAddress(address, { history?, carrier?, withSuggestionScore? = true }) -> {
 *   score: 0-100 (round(sigmoid(w·x) * 100)), mlApplied, modelVersion,
 *   issues: [{ code, field, severity: 'error'|'warning'|'info', label:{tr,en}, impact (score points lost), source: 'rule'|'ml' }],
 *   issueType: code | null,
 *   suggestion: { patch, display: {name,company,line1,line2,city,state,zip,country}, changedFields, source, confidence, score } | null,
 *   contributions: [{ feature, label:{tr,en}, value, weight, contribution }]   (sorted by |contribution|),
 *   ruleWarnings: [{ code, field, severity, label }],
 *   carrierAdvice: { recommend, service, avoid:[codes], label } | null   (PO Box),
 *   residential: { value, reason:{tr,en} },
 * }
 *   address: { name?, company?, line1, line2?, city, state, zip, country = 'US' }
 *   history: prior addresses of the same recipient pool ([{name, line1, line2, city, state, zip}]),
 *            used for the missing-unit / missing-number suggestion.
 *   carrier: carrier code the label will be bought with (PO Box rule).
 *
 * Training: 80% of addresses_labeled (seeded split, seed 20261001) + user feedback
 * included at the last retrain (modelRegistry 'address'.feedbackIds). Features are
 * standardized (z-score); batch gradient descent 300 iterations, lr 0.1, L2 0.1.
 * The model is trained lazily on first use and cached; train() retrains.
 *
 * Other exports:
 *   ruleCheck(address, {carrier}) -> ruleWarnings (rule layer only)
 *   extractFeatures(address, {carrier}) -> { values: {feature: number}, rules, ctx }
 *   train({ feedback, onIteration(point) }) -> model { weights, w, b, mean, std, lossCurve, metrics, trainSize, testSize }
 *   trainAsync({ feedback, onProgress(pct, {iter, loss, testLoss, points}), delayMs }) -> Promise<model>
 *   evaluate() -> { threshold, ml: {accuracy, precision, recall, f1, confusion}, rulesOnly: {...}, trainSize, testSize }
 *   featureImportances() -> [{ feature, label, weight, importance, direction }]
 *   getModel() -> current trained model (weights, scaler, lossCurve)
 *   FEATURES, PROBLEM_THRESHOLD, PO_BOX_BLOCKED_CARRIERS
 */
import zip3State from '../data/seed/zip3_state.json'
import zipCity from '../data/seed/zip_city.json'
import streets from '../data/seed/streets.json'
import labeled from '../data/seed/addresses_labeled.json'
import { mulberry32, shuffle } from './prng.js'
import { bilingual, trainedFeedback, getModelInfo } from './modelRegistry.js'

export const FEATURES = [
  'has_house_number',
  'has_unit',
  'apartment_zip',
  'apt_missing_unit',
  'line_length',
  'suffix_known',
  'unknown_token_ratio',
  'street_similarity',
  'street_near_miss',
  'zip_city_consistent',
  'state_consistent',
  'case_anomaly',
  'digit_ratio',
  'rule_warnings',
]

/** Score below this is treated as "problem" (same threshold as the red ScoreBadge). */
export const PROBLEM_THRESHOLD = 70
export const PO_BOX_BLOCKED_CARRIERS = ['UPS', 'FDX', 'ONT', 'LSO']
const CARRIER_NAMES = { UPS: 'UPS', FDX: 'FedEx', ONT: 'OnTrac', LSO: 'LSO', USPS: 'USPS', DHLE: 'DHL eCommerce' }

const SPLIT_SEED = 20261001
const ITERATIONS = 300
const LR = 0.1
const L2 = 0.1

// ---------------------------------------------------------------------------
// Reference data indexes
// ---------------------------------------------------------------------------
const norm = s => String(s ?? '').trim()
const lc = s => norm(s).toLowerCase().replace(/\s+/g, ' ')

const zipIndex = new Map() // zip -> [{city, state, primary}]
const cityIndex = new Map() // city|state -> [{zip, primary}]
for (const z of zipCity) {
  if (!zipIndex.has(z.zip)) zipIndex.set(z.zip, [])
  zipIndex.get(z.zip).push(z)
  const k = lc(z.city) + '|' + z.state
  if (!cityIndex.has(k)) cityIndex.set(k, [])
  cityIndex.get(k).push(z)
}
for (const list of cityIndex.values()) list.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))

const apartmentZips = new Set(streets.apartmentZips)
const SUFFIXES = new Set(streets.suffixes.map(s => s.toLowerCase()))
const EXTRA_SUFFIXES = ['street', 'avenue', 'boulevard', 'road', 'drive', 'lane', 'court', 'place', 'terrace', 'circle', 'highway', 'parkway', 'square', 'trail', 'row', 'plaza', 'alley', 'crossing']
EXTRA_SUFFIXES.forEach(s => SUFFIXES.add(s))
const knownByCity = new Map() // city|state -> [street lowercase]
const knownDisplay = new Map() // lowercase -> original casing
const VOCAB = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west', 'st.', 'saint', 'mt', 'of', 'the', 'la', 'el', 'de'])
for (const [k, list] of Object.entries(streets.knownStreets)) {
  const [city, state] = k.split('|')
  const key = lc(city) + '|' + state
  knownByCity.set(key, list.map(s => lc(s)))
  for (const s of list) {
    knownDisplay.set(lc(s), s)
    lc(s).split(' ').forEach(t => VOCAB.add(t))
  }
}
SUFFIXES.forEach(s => VOCAB.add(s))
const ALL_KNOWN = [...knownDisplay.keys()]

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
const PO_BOX_RX = /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|pob)\b/i
const UNIT_RX = /(^|\s)(apt|apartment|unit|ste|suite|fl|floor|rm|room|#)\s*\.?\s*[\w-]*|#\s*\w+/i
const SUITE_RX = /\b(ste|suite|fl|floor)\b/i
const APT_RX = /\b(apt|apartment|unit)\b|#/i

function isPoBox(a) { return PO_BOX_RX.test(a.line1 || '') || PO_BOX_RX.test(a.line2 || '') }

/** Split line1 into { number, street, unitInline } */
function parseLine1(line1) {
  let s = norm(line1)
  let unitInline = ''
  const um = s.match(/\s+(apt|apartment|unit|ste|suite|#)\s*\.?\s*[\w-]+$/i)
  if (um) { unitInline = um[0].trim(); s = s.slice(0, um.index).trim() }
  const m = s.match(/^(\d+[a-z]?(?:-\d+)?)\s+(.*)$/i)
  if (m) return { number: m[1], street: m[2].trim(), unitInline }
  if (/^\d+[a-z]?$/i.test(s)) return { number: s, street: '', unitInline }
  return { number: '', street: s, unitInline }
}

export function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array(n + 1)
  let cur = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

function similarity(a, b) {
  const d = levenshtein(a, b)
  return 1 - d / Math.max(a.length, b.length, 1)
}

function bestKnownStreet(street, city, state) {
  const s = lc(street)
  if (!s) return { match: null, sim: 0, exact: false, cityKnown: false }
  const list = knownByCity.get(lc(city) + '|' + state)
  const pool = list && list.length ? list : ALL_KNOWN
  let best = null
  let bestSim = 0
  for (const k of pool) {
    let sim = similarity(s, k)
    // "Jackson" vs "Jackson Ave": suffix omitted, treat as a near miss
    if (k.startsWith(s + ' ') && s.length >= 4) sim = Math.max(sim, 0.9)
    if (sim > bestSim) { bestSim = sim; best = k }
  }
  return { match: best, sim: bestSim, exact: bestSim === 1, cityKnown: !!(list && list.length) }
}

function caseAnomaly(a) {
  const text = [a.line1, a.city].map(norm).join(' ').replace(/[^A-Za-z]/g, '')
  if (text.length < 4) return 0
  if (/^[A-Z]+$/.test(text)) return 1 // ALL CAPS
  if (/^[a-z]+$/.test(text)) return 1 // all lower
  // Mixed inner caps like "brOADway"
  const words = [a.line1, a.city].map(norm).join(' ').split(/\s+/).filter(w => /[a-z]/i.test(w))
  const weird = words.filter(w => /[a-z][A-Z]/.test(w.replace(/^Mc|^Mac/, ''))).length
  return weird ? 0.5 : 0
}

// ---------------------------------------------------------------------------
// Rule layer
// ---------------------------------------------------------------------------
function issue(code, field, severity, params, source = 'rule') {
  return { code, field, severity, label: bilingual('address.issues.' + code, params), source }
}

export function ruleCheck(address, { carrier } = {}) {
  const a = address || {}
  const out = []
  const country = (a.country || 'US').toUpperCase()
  const required = ['line1', 'city', 'zip'].concat(country === 'US' ? ['state'] : [])
  for (const f of required) {
    if (!norm(a[f])) out.push(issue('required_missing', f, 'error', { field: bilingual('address.fields.' + f) }))
  }
  if (country !== 'US') return out
  const zip = norm(a.zip)
  const state = norm(a.state).toUpperCase()
  const city = norm(a.city)
  let zipOk = false
  if (zip) {
    if (!/^\d{5}(-\d{4})?$/.test(zip)) out.push(issue('invalid_zip', 'zip', 'error'))
    else {
      const expected = zip3State[zip.slice(0, 3)]
      if (!expected) out.push(issue('invalid_zip', 'zip', 'error'))
      else {
        zipOk = true
        if (state && expected !== state) out.push(issue('state_mismatch', 'state', 'error', { expected, state }))
      }
    }
  }
  if (zipOk && city) {
    const entries = zipIndex.get(zip.slice(0, 5))
    if (entries) {
      if (!entries.some(e => lc(e.city) === lc(city))) out.push(issue('zip_city_mismatch', 'zip', 'error', { zip, city: entries[0].city }))
    } else if (cityIndex.has(lc(city) + '|' + state)) {
      out.push(issue('zip_city_lookup', 'zip', 'warning', { zip }))
    } else {
      out.push(issue('zip_unverified', 'zip', 'info'))
    }
  }
  if (isPoBox(a)) {
    if (carrier && PO_BOX_BLOCKED_CARRIERS.includes(carrier)) out.push(issue('po_box_restricted', 'line1', 'error', { carrier: CARRIER_NAMES[carrier] || carrier }))
    else out.push(issue('po_box', 'line1', 'info'))
  } else if (norm(a.line1)) {
    const p = parseLine1(a.line1)
    if (!p.number) out.push(issue('incomplete_street', 'line1', 'error'))
  }
  return out
}

const ruleErrors = rules => rules.filter(r => r.severity === 'error')

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------
export function extractFeatures(address, { carrier } = {}) {
  const a = address || {}
  const rules = ruleCheck(a, { carrier })
  const line1 = norm(a.line1)
  const line2 = norm(a.line2)
  const zip = norm(a.zip).slice(0, 5)
  const state = norm(a.state).toUpperCase()
  const poBox = isPoBox(a)
  const p = parseLine1(line1)
  const hasUnit = !!(line2 || p.unitInline) && (UNIT_RX.test(line2) || !!p.unitInline || /\d/.test(line2))
  const aptZip = apartmentZips.has(zip)
  const streetTokens = lc(p.street).split(' ').filter(Boolean)
  const lastTok = streetTokens[streetTokens.length - 1] || ''
  const best = poBox ? { match: null, sim: 1, exact: true, cityKnown: true } : bestKnownStreet(p.street, a.city, state)
  const suffixKnown = poBox || best.exact || SUFFIXES.has(lastTok.replace(/\.$/, '')) ? 1 : 0
  const unknown = streetTokens.length
    ? streetTokens.filter(t => !VOCAB.has(t) && !/^\d+(st|nd|rd|th)?$/.test(t)).length / streetTokens.length
    : 1
  const nearMiss = !poBox && !best.exact && best.sim >= 0.7 ? 1 : 0
  const errs = ruleErrors(rules)
  const has = code => errs.some(r => r.code === code)
  const letters = (line1.match(/[a-z]/gi) || []).length
  const digits = (line1.match(/\d/g) || []).length
  const values = {
    has_house_number: poBox || p.number ? 1 : 0,
    has_unit: hasUnit ? 1 : 0,
    apartment_zip: aptZip ? 1 : 0,
    apt_missing_unit: aptZip && !hasUnit && !poBox ? 1 : 0,
    line_length: Math.min(line1.length / 30, 2),
    suffix_known: suffixKnown,
    unknown_token_ratio: poBox ? 0 : unknown,
    street_similarity: best.sim,
    street_near_miss: nearMiss,
    zip_city_consistent: has('zip_city_mismatch') || has('invalid_zip') ? 0 : rules.some(r => r.code === 'zip_city_lookup') ? 0.5 : 1,
    state_consistent: has('state_mismatch') || has('invalid_zip') ? 0 : 1,
    case_anomaly: caseAnomaly(a),
    digit_ratio: Math.min(digits / Math.max(letters, 1), 2),
    rule_warnings: Math.min(errs.length, 3),
  }
  return { values, rules, ctx: { parsed: p, best, poBox, hasUnit, aptZip, zip, state } }
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------
const sigmoid = z => 1 / (1 + Math.exp(-z))

let splitCache = null
function split() {
  if (splitCache) return splitCache
  const rng = mulberry32(SPLIT_SEED)
  const idx = shuffle(rng, labeled.map((_, i) => i))
  const cut = Math.round(labeled.length * 0.8)
  const toEx = i => ({ id: labeled[i].id, address: labeled[i].address, carrier: labeled[i].carrier, label: labeled[i].label, issueType: labeled[i].issueType })
  splitCache = { train: idx.slice(0, cut).map(toEx), test: idx.slice(cut).map(toEx) }
  return splitCache
}

function vectorize(ex) {
  const { values } = extractFeatures(ex.address, { carrier: ex.carrier })
  return FEATURES.map(f => values[f])
}

let featureCache = null
function cachedVectors() {
  if (featureCache) return featureCache
  const s = split()
  featureCache = { train: s.train.map(vectorize), test: s.test.map(vectorize) }
  return featureCache
}

/**
 * Feedback records (db 'addressFeedback'):
 *   { id, at, before: address, after: address | null, accepted: boolean, issueType, carrier?, source, orderId? }
 * accepted correction -> `before` is a problem example (0) and `after` a deliverable one (1);
 * rejected suggestion  -> the user confirms `before` is deliverable (1).
 * Records already in { address, label } form are used as they are.
 */
function feedbackExamples(feedback) {
  const out = []
  for (const f of feedback || []) {
    if (!f) continue
    if (f.address && (f.label === 0 || f.label === 1)) { out.push({ id: f.id, address: f.address, carrier: f.carrier || null, label: f.label }); continue }
    if (!f.before) continue
    if (f.accepted) {
      out.push({ id: f.id + ':before', address: f.before, carrier: f.carrier || null, label: 0 })
      if (f.after) out.push({ id: f.id + ':after', address: f.after, carrier: f.carrier || null, label: 1 })
    } else {
      out.push({ id: f.id + ':before', address: f.before, carrier: f.carrier || null, label: 1 })
    }
  }
  return out
}

let model = null

/**
 * Training as a generator: yields { iter, loss, testLoss } every 5 iterations, returns the model.
 * train() runs it synchronously; trainAsync() yields to the browser between chunks so a
 * loss curve can be drawn live.
 */
function* trainSteps({ feedback = [], l2 = L2 } = {}) {
  const s = split()
  const vec = cachedVectors()
  const fb = feedbackExamples(feedback)
  const X = [...vec.train, ...fb.map(vectorize)]
  const y = [...s.train.map(e => e.label), ...fb.map(e => e.label)]
  const Xt = vec.test
  const yt = s.test.map(e => e.label)
  const d = FEATURES.length
  const mean = new Array(d).fill(0)
  const std = new Array(d).fill(0)
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / X.length
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1
  const Z = X.map(x => x.map((v, j) => (v - mean[j]) / std[j]))
  const Zt = Xt.map(x => x.map((v, j) => (v - mean[j]) / std[j]))
  const w = new Array(d).fill(0)
  let b = 0
  const n = Z.length
  const lossCurve = []
  const logloss = (ZZ, yy) => {
    let l = 0
    for (let i = 0; i < ZZ.length; i++) {
      let z = b
      for (let j = 0; j < d; j++) z += w[j] * ZZ[i][j]
      const p = Math.min(Math.max(sigmoid(z), 1e-9), 1 - 1e-9)
      l -= yy[i] * Math.log(p) + (1 - yy[i]) * Math.log(1 - p)
    }
    return l / ZZ.length
  }
  for (let it = 1; it <= ITERATIONS; it++) {
    const gw = new Array(d).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j]
      const err = sigmoid(z) - y[i]
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j]
      gb += err
    }
    for (let j = 0; j < d; j++) w[j] -= LR * (gw[j] / n + l2 * w[j])
    b -= LR * (gb / n)
    if (it === 1 || it % 5 === 0 || it === ITERATIONS) {
      const reg = (l2 / 2) * w.reduce((acc, v) => acc + v * v, 0)
      const trainLoss = logloss(Z, y) + reg
      const testLoss = logloss(Zt, yt)
      const point = { iter: it, loss: round4(trainLoss), testLoss: round4(testLoss) }
      lossCurve.push(point)
      yield point
    }
  }
  model = {
    weights: Object.fromEntries(FEATURES.map((f, j) => [f, w[j]])),
    w, b, mean, std,
    lossCurve,
    trainSize: X.length,
    testSize: Xt.length,
    datasetSize: labeled.length + fb.length,
    feedbackUsed: fb.length,
    trainedAt: new Date().toISOString(),
  }
  model.metrics = computeMetrics()
  return model
}

/** Synchronous training. onIteration(point) receives every loss checkpoint. */
export function train({ feedback = [], onIteration, l2 = L2 } = {}) {
  const gen = trainSteps({ feedback, l2 })
  let r = gen.next()
  while (!r.done) { onIteration?.(r.value); r = gen.next() }
  return r.value
}

/**
 * Asynchronous training for the UI. onProgress(pct 0-100, { iter, loss, testLoss, points }) after every
 * checkpoint; waits `delayMs` between checkpoints so the curve animates.
 */
export async function trainAsync({ feedback = [], onProgress, delayMs = 40 } = {}) {
  const gen = trainSteps({ feedback })
  const points = []
  let r = gen.next()
  while (!r.done) {
    points.push(r.value)
    onProgress?.(Math.min(99, Math.round((r.value.iter / ITERATIONS) * 100)), { ...r.value, points: points.slice() })
    if (delayMs) await new Promise(res => setTimeout(res, delayMs))
    r = gen.next()
  }
  onProgress?.(100, { ...points[points.length - 1], points: points.slice() })
  return r.value
}

export const TRAINING = { iterations: ITERATIONS, learningRate: LR, l2: L2, split: 0.8, seed: SPLIT_SEED }

/** Lazily trained model (uses the feedback included at the last recorded retrain). */
export function getModel() {
  if (!model) {
    let fb = []
    try { fb = trainedFeedback('address', 'addressFeedback') } catch { fb = [] }
    train({ feedback: fb })
  }
  return model
}

const round4 = v => Math.round(v * 10000) / 10000
const round3 = v => Math.round(v * 1000) / 1000

function rawScore(values) {
  const m = getModel()
  let z = m.b
  const contribs = []
  FEATURES.forEach((f, j) => {
    const zj = (values[f] - m.mean[j]) / m.std[j]
    const c = m.w[j] * zj
    z += c
    contribs.push({ feature: f, value: round3(values[f]), weight: round4(m.w[j]), contribution: round4(c) })
  })
  return { z, contribs }
}

function prf(tp, fp, fn, tn) {
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  const accuracy = (tp + tn) / Math.max(tp + fp + fn + tn, 1)
  return { accuracy: round4(accuracy), precision: round4(precision), recall: round4(recall), f1: round4(f1), confusion: { tp, fp, fn, tn } }
}

function computeMetrics() {
  // Positive class = "problem" address (label 0). ML: score < threshold. Rules only: any rule error.
  const s = split()
  let m = [0, 0, 0, 0]
  let r = [0, 0, 0, 0]
  const add = (acc, pred, actual) => {
    if (pred && actual) acc[0]++
    else if (pred && !actual) acc[1]++
    else if (!pred && actual) acc[2]++
    else acc[3]++
  }
  for (const ex of s.test) {
    const { values, rules } = extractFeatures(ex.address, { carrier: ex.carrier })
    const { z } = rawScoreWith(values)
    const score = Math.round(sigmoid(z) * 100)
    const actual = ex.label === 0
    add(m, score < PROBLEM_THRESHOLD, actual)
    add(r, ruleErrors(rules).length > 0, actual)
  }
  return {
    threshold: PROBLEM_THRESHOLD,
    positiveClass: 'problem',
    ml: prf(...m),
    rulesOnly: prf(...r),
    trainSize: model.trainSize,
    testSize: s.test.length,
  }
}

// rawScore without triggering lazy training recursion (model is set when called from computeMetrics)
function rawScoreWith(values) {
  let z = model.b
  FEATURES.forEach((f, j) => { z += model.w[j] * ((values[f] - model.mean[j]) / model.std[j]) })
  return { z }
}

export function evaluate() {
  return getModel().metrics
}

export function featureImportances() {
  const m = getModel()
  return FEATURES.map((f, j) => ({
    feature: f,
    label: bilingual('address.features.' + f),
    weight: round4(m.w[j]),
    importance: round4(Math.abs(m.w[j])),
    direction: m.w[j] >= 0 ? 'deliverable' : 'problem',
  })).sort((a, b) => b.importance - a.importance)
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------
const FEATURE_ISSUE = {
  has_house_number: ['incomplete_street', 'line1'],
  apt_missing_unit: ['missing_unit', 'line2'],
  street_near_miss: ['typo_street', 'line1'],
  street_similarity: ['unrecognized_street', 'line1'],
  unknown_token_ratio: ['unrecognized_street', 'line1'],
  suffix_known: ['street_suffix_unknown', 'line1'],
  case_anomaly: ['case_anomaly', 'line1'],
  line_length: ['short_line', 'line1'],
}
const RULE_FEATURE = {
  invalid_zip: 'zip_city_consistent',
  state_mismatch: 'state_consistent',
  zip_city_mismatch: 'zip_city_consistent',
  zip_city_lookup: 'zip_city_consistent',
  incomplete_street: 'has_house_number',
  po_box_restricted: 'rule_warnings',
  required_missing: 'rule_warnings',
}
const ISSUE_PRIORITY = ['required_missing', 'invalid_zip', 'state_mismatch', 'zip_city_mismatch', 'po_box_restricted', 'incomplete_street', 'missing_unit', 'typo_street', 'missing_suffix', 'unrecognized_street', 'zip_city_lookup']

function pointsLost(z, contribution) {
  // Score points this feature costs relative to an average address.
  return Math.round((sigmoid(z - contribution) - sigmoid(z)) * 100)
}

function detectResidential(a, ctx) {
  if (norm(a.company)) return { value: false, reason: bilingual('address.residential.company') }
  if (SUITE_RX.test(norm(a.line2)) || SUITE_RX.test(ctx.parsed.unitInline)) return { value: false, reason: bilingual('address.residential.suite') }
  if (APT_RX.test(norm(a.line2)) || APT_RX.test(ctx.parsed.unitInline)) return { value: true, reason: bilingual('address.residential.unit') }
  if (ctx.aptZip) return { value: true, reason: bilingual('address.residential.apartmentZip') }
  return { value: true, reason: bilingual('address.residential.default') }
}

function sameName(x, y) { return lc(x) && lc(x) === lc(y) }

function buildSuggestion(a, rules, ctx, mlIssues, history) {
  const patch = {}
  const sources = []
  let confidence = 0
  const errs = ruleErrors(rules).map(r => r.code)
  const state = ctx.state
  const zip = ctx.zip
  const cityKey = lc(a.city) + '|'
  // State from ZIP3 when the ZIP itself agrees with the city.
  if (errs.includes('state_mismatch')) {
    const expected = zip3State[zip.slice(0, 3)]
    const entries = zipIndex.get(zip) || []
    if (entries.some(e => lc(e.city) === lc(a.city)) || cityIndex.has(cityKey + expected)) {
      patch.state = expected
      sources.push(entries.length ? 'zip_city' : 'zip3_state')
      confidence = Math.max(confidence, 0.9)
    }
  }
  const effState = patch.state || state
  if (errs.includes('zip_city_mismatch') || errs.includes('invalid_zip') || rules.some(r => r.code === 'zip_city_lookup')) {
    const cands = cityIndex.get(cityKey + effState)
    if (cands && cands.length) {
      const raw = norm(a.zip).replace(/\D/g, '')
      let best = cands[0]
      let bestD = Infinity
      for (const c of cands) {
        const dd = levenshtein(raw, c.zip) - (c.primary ? 0.1 : 0)
        if (dd < bestD) { bestD = dd; best = c }
      }
      if (best.zip !== zip || raw.length !== 5) {
        patch.zip = best.zip
        sources.push('zip_city')
        confidence = Math.max(confidence, bestD <= 1 ? 0.88 : cands.length === 1 ? 0.8 : 0.7)
      }
    }
  }
  // Street typo -> closest known street
  const hasIssue = code => mlIssues.some(i => i.code === code)
  if (!ctx.poBox && ctx.best.match && !ctx.best.exact && ctx.best.sim >= 0.7 && (hasIssue('typo_street') || hasIssue('missing_suffix') || hasIssue('unrecognized_street'))) {
    const fixed = knownDisplay.get(ctx.best.match)
    const num = ctx.parsed.number
    patch.line1 = [num, fixed].filter(Boolean).join(' ') + (ctx.parsed.unitInline ? ' ' + ctx.parsed.unitInline : '')
    sources.push('known_streets')
    confidence = Math.max(confidence, Math.min(0.95, ctx.best.sim))
  }
  const hist = Array.isArray(history)
    ? history.map(h => (h && (h.shipTo || h.to || h.address)) || h).filter(h => h && h.line1)
    : []
  // Missing unit -> recipient history (same street line + ZIP)
  if (hasIssue('missing_unit') && hist.length) {
    const l1 = lc(patch.line1 || a.line1)
    const match = hist.find(h => sameName(h.name, a.name) && lc(h.line1) === l1 && norm(h.line2))
      || hist.find(h => lc(h.line1) === l1 && norm(h.zip).slice(0, 5) === (patch.zip || zip) && norm(h.line2))
    if (match) {
      patch.line2 = norm(match.line2)
      sources.push('history')
      confidence = Math.max(confidence, sameName(match.name, a.name) ? 0.9 : 0.75)
    }
  }
  // Missing house number -> recipient history with the same street
  if (errs.includes('incomplete_street') && hist.length) {
    const street = lc(ctx.parsed.street)
    const match = hist.find(h => {
      const hp = parseLine1(h.line1)
      return hp.number && street && lc(hp.street) === street && (sameName(h.name, a.name) || norm(h.zip).slice(0, 5) === zip)
    })
    if (match) {
      patch.line1 = norm(match.line1)
      if (!norm(a.line2) && norm(match.line2)) patch.line2 = norm(match.line2)
      sources.push('history')
      confidence = Math.max(confidence, 0.8)
    }
  }
  const changedFields = Object.keys(patch).filter(k => norm(patch[k]) !== norm(a[k]))
  if (!changedFields.length) return null
  const display = {
    name: norm(a.name), company: norm(a.company),
    line1: norm(a.line1), line2: norm(a.line2), city: norm(a.city), state: norm(a.state).toUpperCase(), zip: norm(a.zip),
    country: (a.country || 'US').toUpperCase(),
    ...patch,
  }
  return { patch: Object.fromEntries(changedFields.map(k => [k, patch[k]])), display, changedFields, source: sources[0], sources: [...new Set(sources)], confidence: round3(confidence) }
}

function nonUsResult(a, rules) {
  const errs = ruleErrors(rules).length
  const score = Math.max(0, 96 - errs * 30 - rules.filter(r => r.severity === 'warning').length * 10)
  const issues = [...rules, issue('non_us_basic', 'country', 'info')].map(r => ({ ...r, impact: r.severity === 'error' ? 30 : 0 }))
  return {
    score, mlApplied: false, modelVersion: safeVersion(), issues,
    issueType: rules.find(r => r.severity === 'error')?.code ?? null,
    suggestion: null, contributions: [], ruleWarnings: rules, carrierAdvice: null,
    residential: { value: !norm(a.company), reason: bilingual(norm(a.company) ? 'address.residential.company' : 'address.residential.default') },
  }
}

function safeVersion() {
  try { return getModelInfo('address').label } catch { return 'addr-ml' }
}

export function validateAddress(address, { history, carrier, withSuggestionScore = true } = {}) {
  const a = address || {}
  const country = (a.country || 'US').toUpperCase()
  const { values, rules, ctx } = extractFeatures(a, { carrier })
  if (country !== 'US') return nonUsResult(a, rules)
  const { z, contribs } = rawScore(values)
  const score = Math.round(sigmoid(z) * 100)
  const contributions = contribs
    .map(c => ({ ...c, label: bilingual('address.features.' + c.feature) }))
    .sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))
  const contribOf = f => contribs.find(c => c.feature === f)?.contribution ?? 0

  // Rule issues, with the score impact of their related feature
  const issues = rules.map(r => ({ ...r, impact: r.severity === 'info' ? 0 : Math.max(0, pointsLost(z, contribOf(RULE_FEATURE[r.code] || 'rule_warnings'))) }))
  // ML issues: features that pull the score down the most
  const mlIssues = []
  for (const c of contribs.filter(c => c.contribution < -0.15).sort((x, y) => x.contribution - y.contribution)) {
    const map = FEATURE_ISSUE[c.feature]
    if (!map) continue
    let [code, field] = map
    // "Jackson" for "Jackson Ave": the street is right, only the suffix is missing
    if (code === 'typo_street' && ctx.best.match && ctx.best.match.startsWith(lc(ctx.parsed.street) + ' ')) code = 'missing_suffix'
    // only raise ML issues whose underlying condition is really present
    if (code === 'typo_street' && !values.street_near_miss) continue
    if (code === 'missing_unit' && !values.apt_missing_unit) continue
    if (code === 'unrecognized_street' && (values.street_near_miss || ctx.best.exact || ctx.poBox)) continue
    if (code === 'street_suffix_unknown' && values.suffix_known) continue
    if (code === 'case_anomaly' && !values.case_anomaly) continue
    if (code === 'short_line' && (values.line_length > 0.4 || ctx.poBox)) continue
    if (code === 'incomplete_street' && values.has_house_number) continue
    if (issues.some(i => i.code === code) || mlIssues.some(i => i.code === code)) continue
    const impact = pointsLost(z, c.contribution)
    if (impact < 3) continue
    const params = code === 'typo_street' || code === 'missing_suffix' ? { street: knownDisplay.get(ctx.best.match) || '' } : undefined
    mlIssues.push({ ...issue(code, field, code === 'case_anomaly' || code === 'street_suffix_unknown' ? 'info' : 'warning', params, 'ml'), impact })
  }
  if (mlIssues.some(i => i.code === 'missing_suffix')) mlIssues.splice(0, mlIssues.length, ...mlIssues.filter(i => i.code !== 'street_suffix_unknown'))
  const allIssues = [...issues, ...mlIssues].sort((x, y) => (y.severity === 'error') - (x.severity === 'error') || y.impact - x.impact)
  if (score < PROBLEM_THRESHOLD && !allIssues.some(i => i.severity !== 'info')) {
    allIssues.push({ ...issue('low_model_score', 'line1', 'warning', null, 'ml'), impact: 100 - score })
  }
  const errCodes = allIssues.filter(i => i.severity !== 'info').map(i => i.code)
  let issueType = null
  for (const code of ISSUE_PRIORITY) if (errCodes.includes(code)) { issueType = code; break }
  if (!issueType && score < 85 && errCodes.length) issueType = errCodes[0]

  const suggestion = buildSuggestion(a, rules, ctx, mlIssues, history)
  if (suggestion && withSuggestionScore) {
    suggestion.score = validateAddress(suggestion.display, { carrier, withSuggestionScore: false }).score
  }
  let carrierAdvice = null
  let finalSuggestion = suggestion
  if (ctx.poBox && !finalSuggestion && rules.some(r => r.code === 'po_box_restricted')) {
    // Same shape as seed orders: no address change, switch to a carrier that serves PO Boxes.
    finalSuggestion = {
      patch: {}, display: { name: norm(a.name), company: norm(a.company), line1: norm(a.line1), line2: norm(a.line2), city: norm(a.city), state: norm(a.state).toUpperCase(), zip: norm(a.zip), country },
      changedFields: [], source: 'carrier_rule', sources: ['carrier_rule'], carrier: 'USPS', service: 'GA', confidence: 0.97,
    }
    if (withSuggestionScore) finalSuggestion.score = validateAddress(a, { carrier: 'USPS', withSuggestionScore: false }).score
  }
  if (ctx.poBox) {
    carrierAdvice = {
      recommend: 'USPS', service: 'GA', avoid: [...PO_BOX_BLOCKED_CARRIERS],
      label: bilingual('address.carrierAdvice', { carrier: 'USPS', avoid: PO_BOX_BLOCKED_CARRIERS.map(c => CARRIER_NAMES[c]).join(', ') }),
    }
  }
  return {
    score,
    mlApplied: true,
    modelVersion: safeVersion(),
    issues: allIssues,
    issueType,
    suggestion: finalSuggestion,
    contributions,
    ruleWarnings: rules.filter(r => r.severity !== 'info' || r.code === 'po_box'),
    carrierAdvice,
    residential: detectResidential(a, ctx),
  }
}

/** Dataset stats for the AI screens. */
export function datasetInfo() {
  const s = split()
  const problems = labeled.filter(x => x.label === 0).length
  const byIssue = {}
  labeled.forEach(x => { if (x.issueType) byIssue[x.issueType] = (byIssue[x.issueType] || 0) + 1 })
  return { total: labeled.length, train: s.train.length, test: s.test.length, problems, deliverable: labeled.length - problems, byIssue }
}

/** Test-split examples (for "sample addresses" style demos). */
export function testExamples() {
  return split().test.map(e => ({ ...e }))
}
