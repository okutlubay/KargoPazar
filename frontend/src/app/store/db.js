// localStorage persistence layer.
//
// - Seed files in ../data/seed/*.json are the read-only initial state. File name
//   (without .json) is the collection name: orders.json -> db.all('orders').
// - Array seeds are "collections" (records with an `id`, or `code` for carriers/countries).
//   Object seeds are "documents": db.doc('user'), db.patchDoc('user', {...}).
// - Only collections that have been written are persisted (kpz_demo:<name>);
//   untouched ones are served from the seed. Collections without a seed file
//   (requestLog, addressFeedback, drafts, ...) start empty.
// - Seed datetimes are relative ({ daysAgo, hour, minute }) and are converted to
//   ISO strings at load time so the demo always looks current.
import { reactive } from 'vue'

export const NS = 'kpz_demo'
export const SEED_VERSION = '2026.10.1'

const seedLoaders = import.meta.glob('../data/seed/*.json', { import: 'default' })
const SEED_NAMES = Object.keys(seedLoaders).map(p => p.split('/').pop().replace('.json', ''))

// Keys under NS that are not data collections and survive reset().
const PRESERVED = new Set(['session', 'lang', 'leads', 'ui'])

const state = reactive({})
const seeds = {}
let ready = false
let txDepth = 0
const txDirty = new Set()

function key(name) { return `${NS}:${name}` }

function isRelDate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.daysAgo !== 'number') return false
  const keys = Object.keys(v)
  return keys.every(k => k === 'daysAgo' || k === 'hour' || k === 'minute')
}

function toIso(v, now) {
  const d = new Date(now)
  d.setDate(d.getDate() - v.daysAgo)
  d.setHours(v.hour ?? 9, v.minute ?? 0, 0, 0)
  return d.toISOString()
}

export function resolveDates(value, now = Date.now()) {
  if (Array.isArray(value)) return value.map(v => resolveDates(v, now))
  if (value && typeof value === 'object') {
    if (isRelDate(value)) return toIso(value, now)
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveDates(v, now)
    return out
  }
  return value
}

function readStored(name) {
  try {
    const raw = localStorage.getItem(key(name))
    return raw == null ? undefined : JSON.parse(raw)
  } catch { return undefined }
}

function persist(name) {
  if (txDepth > 0) { txDirty.add(name); return }
  try {
    localStorage.setItem(key(name), JSON.stringify(state[name]))
  } catch (e) {
    console.error('[db] persist failed', name, e)
  }
}

function freshSeed(name) {
  return resolveDates(structuredClone(seeds[name]))
}

function ensure(name) {
  if (!(name in state)) {
    const stored = readStored(name)
    if (stored !== undefined) state[name] = stored
    else if (name in seeds) state[name] = freshSeed(name)
    else state[name] = []
  }
  return state[name]
}

function idOf(rec) { return rec.id ?? rec.code }

export const db = {
  get ready() { return ready },

  async init() {
    const loaded = await Promise.all(SEED_NAMES.map(n => seedLoaders[`../data/seed/${n}.json`]()))
    SEED_NAMES.forEach((n, i) => { seeds[n] = loaded[i] })
    let version = null
    try { version = localStorage.getItem(key('version')) } catch {}
    if (version !== SEED_VERSION) {
      clearData()
      try { localStorage.setItem(key('version'), SEED_VERSION) } catch {}
    }
    for (const n of SEED_NAMES) ensure(n)
    ready = true
  },

  /** Reactive live array for a collection (do not mutate records directly; use update()). */
  all(col) { return ensure(col) },

  get(col, id) { return ensure(col).find(r => idOf(r) === id) },

  find(col, pred) { return ensure(col).find(pred) },

  filter(col, pred) { return ensure(col).filter(pred) },

  insert(col, obj, { prepend = true } = {}) {
    const arr = ensure(col)
    if (prepend) arr.unshift(obj)
    else arr.push(obj)
    persist(col)
    return arr[prepend ? 0 : arr.length - 1]
  },

  update(col, id, patch) {
    const rec = db.get(col, id)
    if (!rec) throw new Error(`[db] ${col}/${id} not found`)
    Object.assign(rec, typeof patch === 'function' ? patch(rec) ?? {} : patch)
    persist(col)
    return rec
  },

  remove(col, id) {
    const arr = ensure(col)
    const i = arr.findIndex(r => idOf(r) === id)
    if (i >= 0) { const [r] = arr.splice(i, 1); persist(col); return r }
    return null
  },

  /** Replace a whole collection or document. */
  set(col, value) {
    state[col] = value
    persist(col)
    return state[col]
  },

  /** Keep only the first `max` records (used for logs). */
  trim(col, max) {
    const arr = ensure(col)
    if (arr.length > max) { arr.splice(max); persist(col) }
  },

  /** Document seeds (user.json, wallet.json, system.json ...). */
  doc(name) { return ensure(name) },

  patchDoc(name, patch) {
    const d = ensure(name)
    Object.assign(d, typeof patch === 'function' ? patch(d) ?? {} : patch)
    persist(name)
    return d
  },

  /** Mark a collection as changed after mutating nested data in place. */
  touch(col) { persist(col) },

  /**
   * Run several writes atomically. If fn throws, every collection is restored
   * to its state before the transaction and nothing is written to storage.
   */
  async transaction(fn) {
    const snapshot = {}
    for (const n of Object.keys(state)) snapshot[n] = JSON.stringify(state[n])
    txDepth++
    try {
      const res = await fn(db)
      txDepth--
      if (txDepth === 0) { for (const n of txDirty) persist(n); txDirty.clear() }
      return res
    } catch (e) {
      txDepth--
      for (const n of Object.keys(state)) {
        if (n in snapshot) {
          const restored = JSON.parse(snapshot[n])
          if (Array.isArray(state[n])) state[n].splice(0, state[n].length, ...restored)
          else state[n] = restored
        } else delete state[n]
      }
      if (txDepth === 0) txDirty.clear()
      throw e
    }
  },

  /** Sequential readable ids: ORD-10483, SHP-20931, TXN-7712, MNF-0412, INV-2026-0098. */
  nextId(prefix) {
    const counters = ensure('counters')
    const n = (counters[prefix] ?? 0) + 1
    counters[prefix] = n
    persist('counters')
    if (prefix === 'MNF') return `MNF-${String(n).padStart(4, '0')}`
    if (prefix === 'INV') return `INV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`
    return `${prefix}-${n}`
  },

  /** Reset every collection to seed. Session and language are preserved. */
  reset() {
    clearData()
    for (const n of Object.keys(state)) delete state[n]
    try { localStorage.setItem(key('version'), SEED_VERSION) } catch {}
    for (const n of SEED_NAMES) ensure(n)
  },

  export() {
    const out = { version: SEED_VERSION, exportedAt: new Date().toISOString(), data: {} }
    for (const n of new Set([...SEED_NAMES, ...Object.keys(state)])) out.data[n] = ensure(n)
    return JSON.stringify(out, null, 2)
  },

  import(json) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json
    if (!parsed || typeof parsed.data !== 'object') throw new Error('INVALID_EXPORT')
    clearData()
    for (const n of Object.keys(state)) delete state[n]
    for (const [n, v] of Object.entries(parsed.data)) { state[n] = v; persist(n) }
    for (const n of SEED_NAMES) ensure(n)
    try { localStorage.setItem(key('version'), SEED_VERSION) } catch {}
  },

  storageBytes() {
    let total = 0
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k.startsWith(NS + ':')) total += (k.length + (localStorage.getItem(k) || '').length) * 2
      }
    } catch {}
    return total
  },

  seedVersion: SEED_VERSION,
  seedNames: SEED_NAMES,
  /** Raw (date-resolved) seed copy, e.g. for "compare with seed" features. */
  seed(name) { return name in seeds ? freshSeed(name) : undefined },
}

function clearData() {
  try {
    const drop = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k.startsWith(NS + ':') && !PRESERVED.has(k.slice(NS.length + 1))) drop.push(k)
    }
    drop.forEach(k => localStorage.removeItem(k))
  } catch {}
}

if (import.meta.env.DEV) window.__db = db
