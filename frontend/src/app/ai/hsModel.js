/**
 * HS code suggestion model (spec 6.5): multinomial Naive Bayes.
 *
 * Preprocessing: lower case, punctuation removal, English stop words, light stemming
 * (trailing "ies" -> "y", "es", "ing", "s"), unigram + bigram word features, and
 * character 3-grams as a separate feature set (robust to typos such as "cushion covver").
 * Laplace smoothing (add-one) per feature set. Class score:
 *   log P(c) + sum_word log P(w|c) + CHAR_WEIGHT * sum_gram log P(g|c)
 * Probabilities: softmax over class scores divided by a temperature T that is
 * calibrated on the validation split (T only rescales probabilities, the ranking
 * and therefore top-1 / top-3 accuracy do not depend on it).
 *
 * Data: hs_training.json (stratified 85/15 split, seed 20261001) + user
 * confirmations / corrections (hsFeedback) included at the last retrain.
 * A user correction is counted FEEDBACK_WEIGHT times (explicit expert label).
 *
 * suggest(title, desc?) -> {
 *   top: [{ code, prob, desc:{tr,en}, customsDesc }] (3 items),
 *   confidence (top-1 prob), lowConfidence (confidence < 0.55),
 *   topWords: [{ word, contribution, code }] (5 words that pushed the top-1 class the most),
 *   tokens: [original words], modelVersion
 * }
 * train({ feedback }) -> model;  evaluate() -> { top1, top3, trainSize, testSize, classes, temperature }
 * getModel(), codes(), describe(code)
 */
import training from '../data/seed/hs_training.json'
import hsCodes from '../data/seed/hs_codes.json'
import { mulberry32, shuffle } from './prng.js'
import { trainedFeedback, getModelInfo } from './modelRegistry.js'

export const LOW_CONFIDENCE = 0.55
export const FEEDBACK_WEIGHT = 3
const CHAR_WEIGHT = 0.35
const SPLIT_SEED = 20261001

const STOP = new Set(('a an the and or of for with w in on to by from at as is are be this that these those it its ' +
  'your our my you we me new free fast shipping gift gifts idea ideas great best perfect beautiful cute lovely nice unique ' +
  'item items pcs pc piece pieces x').split(' '))

const codeInfo = new Map(hsCodes.map(c => [c.code, c]))
export const codes = () => hsCodes.map(c => ({ ...c }))
export const describe = code => codeInfo.get(code) || null

export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && /(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2)
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  return w
}

/** Returns [{ orig, stem }] for the meaningful words of a text. */
export function tokenize(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(\d)\s*["']/g, '$1 ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const out = []
  for (const w of raw) {
    if (STOP.has(w)) continue
    if (/^\d+$/.test(w)) continue // bare numbers carry no class information
    out.push({ orig: w, stem: stem(w) })
  }
  return out
}

function wordFeatures(toks) {
  const f = toks.map(t => 'w:' + t.stem)
  for (let i = 0; i + 1 < toks.length; i++) f.push('b:' + toks[i].stem + '_' + toks[i + 1].stem)
  return f
}

function charFeatures(toks) {
  const f = []
  for (const t of toks) {
    if (/^\d+x\d+/.test(t.stem)) continue // sizes like 16x16 are counted as words only
    const s = '#' + t.stem + '#'
    for (let i = 0; i + 3 <= s.length; i++) f.push(s.slice(i, i + 3))
  }
  return f
}

function docOf(title, desc) {
  const toks = tokenize([title, desc].filter(Boolean).join(' '))
  return { toks, words: wordFeatures(toks), chars: charFeatures(toks) }
}

// ---------------------------------------------------------------------------
let splitCache = null
function split() {
  if (splitCache) return splitCache
  const rng = mulberry32(SPLIT_SEED)
  const byClass = new Map()
  for (const r of training) {
    if (!byClass.has(r.hsCode)) byClass.set(r.hsCode, [])
    byClass.get(r.hsCode).push(r)
  }
  const train = []
  const test = []
  for (const code of [...byClass.keys()].sort()) {
    const list = shuffle(rng, byClass.get(code))
    const nTest = Math.max(1, Math.round(list.length * 0.15))
    test.push(...list.slice(0, nTest))
    train.push(...list.slice(nTest))
  }
  splitCache = { train, test }
  return splitCache
}

let model = null

function newTable() { return { counts: new Map(), total: 0 } }
function addCounts(table, feats, w) {
  for (const f of feats) {
    table.counts.set(f, (table.counts.get(f) || 0) + w)
    table.total += w
  }
}

export function train({ feedback = [] } = {}) {
  const s = split()
  const classes = hsCodes.map(c => c.code)
  const classDocs = new Map(classes.map(c => [c, 0]))
  const wordT = new Map(classes.map(c => [c, newTable()]))
  const charT = new Map(classes.map(c => [c, newTable()]))
  const vocabW = new Set()
  const vocabC = new Set()
  let nDocs = 0
  const add = (title, desc, code, weight) => {
    if (!classDocs.has(code)) {
      // free 6 digit codes entered by users become new classes
      classes.push(code)
      classDocs.set(code, 0)
      wordT.set(code, newTable())
      charT.set(code, newTable())
    }
    const d = docOf(title, desc)
    classDocs.set(code, classDocs.get(code) + weight)
    nDocs += weight
    addCounts(wordT.get(code), d.words, weight)
    addCounts(charT.get(code), d.chars, weight)
    d.words.forEach(f => vocabW.add(f))
    d.chars.forEach(f => vocabC.add(f))
  }
  for (const r of s.train) add(r.title, '', r.hsCode, 1)
  const fb = (feedback || []).filter(f => f && f.title && f.code)
  for (const f of fb) add(f.title, f.desc || '', f.code, f.action === 'correct' ? FEEDBACK_WEIGHT : 1)
  model = {
    classes,
    classDocs,
    wordT,
    charT,
    vW: vocabW.size,
    vC: vocabC.size,
    nDocs,
    temperature: 1,
    trainSize: s.train.length + fb.length,
    testSize: s.test.length,
    feedbackUsed: fb.length,
    datasetSize: training.length + fb.length,
    trainedAt: new Date().toISOString(),
  }
  model.temperature = calibrate()
  model.metrics = computeMetrics()
  return model
}

export function getModel() {
  if (!model) {
    let fb = []
    try { fb = trainedFeedback('hs', 'hsFeedback') } catch { fb = [] }
    train({ feedback: fb })
  }
  return model
}

function logP(table, f, V) {
  return Math.log(((table.counts.get(f) || 0) + 1) / (table.total + V + 1))
}

function scores(doc, m = model) {
  const K = m.classes.length
  return m.classes.map(c => {
    let s = Math.log((m.classDocs.get(c) + 1) / (m.nDocs + K))
    const wt = m.wordT.get(c)
    const ct = m.charT.get(c)
    for (const f of doc.words) s += logP(wt, f, m.vW)
    let cs = 0
    for (const f of doc.chars) cs += logP(ct, f, m.vC)
    return s + CHAR_WEIGHT * cs
  })
}

function softmax(arr, T) {
  const mx = Math.max(...arr)
  const e = arr.map(v => Math.exp((v - mx) / T))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map(v => v / sum)
}

function calibrate() {
  // choose T minimizing validation log loss (grid search)
  const s = split()
  const raw = s.test.map(r => ({ sc: scores(docOf(r.title, '')), y: model.classes.indexOf(r.hsCode) }))
  let best = 1
  let bestLoss = Infinity
  for (let T = 1; T <= 12; T += 0.25) {
    let loss = 0
    for (const r of raw) loss -= Math.log(Math.max(softmax(r.sc, T)[r.y], 1e-12))
    if (loss < bestLoss) { bestLoss = loss; best = T }
  }
  return best
}

function computeMetrics() {
  const s = split()
  let top1 = 0
  let top3 = 0
  for (const r of s.test) {
    const sc = scores(docOf(r.title, ''))
    const order = sc.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(x => model.classes[x[1]])
    if (order[0] === r.hsCode) top1++
    if (order.slice(0, 3).includes(r.hsCode)) top3++
  }
  const n = s.test.length
  return {
    top1: Math.round((top1 / n) * 10000) / 10000,
    top3: Math.round((top3 / n) * 10000) / 10000,
    correctTop1: top1,
    correctTop3: top3,
    trainSize: model.trainSize,
    testSize: n,
    classes: model.classes.length,
    temperature: model.temperature,
  }
}

export function evaluate() {
  return getModel().metrics
}

function safeVersion() {
  try { return getModelInfo('hs').label } catch { return 'hs-nb' }
}

export function suggest(title, desc = '') {
  const m = getModel()
  const doc = docOf(title, desc)
  if (!doc.toks.length) return { top: [], confidence: 0, lowConfidence: true, topWords: [], tokens: [], modelVersion: safeVersion() }
  const sc = scores(doc, m)
  const probs = softmax(sc, m.temperature)
  const ranked = probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0])
  const top = ranked.slice(0, 3).map(([p, i]) => {
    const code = m.classes[i]
    const info = codeInfo.get(code)
    return { code, prob: Math.round(p * 10000) / 10000, desc: info?.desc ?? null, customsDesc: info?.customsDesc ?? null }
  })
  // Word influence: log-likelihood of the word (its unigram + bigrams it starts + its char grams)
  // under the top-1 class minus the average over all classes.
  const c1 = top[0].code
  const K = m.classes.length
  const infl = doc.toks.map((t, idx) => {
    const feats = ['w:' + t.stem]
    if (idx + 1 < doc.toks.length) feats.push('b:' + t.stem + '_' + doc.toks[idx + 1].stem)
    const grams = charFeatures([t])
    const lp = c => {
      let v = 0
      for (const f of feats) v += logP(m.wordT.get(c), f, m.vW)
      for (const g of grams) v += CHAR_WEIGHT * logP(m.charT.get(c), g, m.vC)
      return v
    }
    const own = lp(c1)
    let avg = 0
    for (const c of m.classes) avg += lp(c) / K
    return { word: t.orig, stem: t.stem, contribution: Math.round((own - avg) * 1000) / 1000, code: c1 }
  })
  const seen = new Set()
  const topWords = infl
    .sort((a, b) => b.contribution - a.contribution)
    .filter(w => (seen.has(w.word) ? false : seen.add(w.word)))
    .slice(0, 5)
  return {
    top,
    confidence: top[0].prob,
    lowConfidence: top[0].prob < LOW_CONFIDENCE,
    topWords,
    tokens: doc.toks.map(t => t.orig),
    modelVersion: safeVersion(),
  }
}

export function datasetInfo() {
  const s = split()
  return { total: training.length, train: s.train.length, test: s.test.length, classes: hsCodes.length }
}
