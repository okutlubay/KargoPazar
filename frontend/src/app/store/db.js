// API-backed data layer (contract: docs/BACKEND.md).
//
// - The source of truth is MySQL behind the backend API. After login, init() loads the
//   whole state with GET /api/state into a reactive in-memory store (dates are ISO strings).
// - Array values are "collections" (records keyed by `id`, or `code` for carriers/countries).
//   Object values are "documents": db.doc('user'), db.patchDoc('user', {...}).
// - Writes are synchronous in memory (screens rely on it) and persisted write-behind:
//   persist(name) marks the collection dirty; a short timer (FLUSH_MS) or the end of a
//   transaction (next macrotask, so the follow-up writes of the same call join) flushes. A flush diffs every dirty collection against the last persisted
//   snapshot (one JSON string per record) and sends ONE POST /api/state/batch:
//     new record -> upsert with position first|last, changed record -> upsert,
//     missing record -> delete, reordered or keyless collection -> replaceCollection,
//     document -> setDoc.
//   One flush in flight at a time; failures keep the collections dirty and retry with
//   backoff. db.syncState exposes { status: idle|saving|error, pending, lastSavedAt, attempts }.
// - db.seed(name) serves bundled seed copies only for "compare with seed" features
//   (SEED_PRELOAD) and db.loadSeed(name) loads any seed on demand (public track sample).
import { reactive } from 'vue'
import { http } from '../api/http.js'

export const NS = 'kpz_demo'
export const SEED_VERSION = '2026.10.2'

const seedLoaders = import.meta.glob('../data/seed/*.json', { import: 'default' })
const SEED_NAMES = Object.keys(seedLoaders).map(p => p.split('/').pop().replace('.json', ''))
const SEED_PRELOAD = ['shipments'] // db.seed('shipments') is read by the forecast model

const FLUSH_MS = 200
const RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000]

const state = reactive({})
const seeds = {}
let ready = false
let serverSeedVersion = null
let txDepth = 0
const txDirty = new Set()
const readyHooks = []

// ---- write-behind sync state ----
const dirty = new Set()
const persisted = new Map() // name -> snapshot (see snapshotOf)
let flushTimer = null
let retryTimer = null
let inFlight = null
let inFlightNames = []
let suspended = 0
let attempt = 0

export const syncState = reactive({ status: 'idle', pending: 0, lastSavedAt: null, attempts: 0, error: null })
function updatePending() { syncState.pending = new Set([...dirty, ...txDirty, ...inFlightNames]).size }

function idOf(rec) { return rec?.id ?? rec?.code }
function hasKey(rec) { const k = idOf(rec); return k !== undefined && k !== null && k !== '' }

function isRelDate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.daysAgo !== 'number') return false
  return Object.keys(v).every(k => k === 'daysAgo' || k === 'hour' || k === 'minute')
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

function freshSeed(name) { return resolveDates(structuredClone(seeds[name])) }

function ensure(name, fallback) {
  if (!(name in state)) state[name] = fallback === 'doc' ? {} : []
  return state[name]
}

// ---------------------------------------------------------------------------
// Snapshots and diff
// ---------------------------------------------------------------------------
// snapshot = { kind: 'doc', json } | { kind: 'keyless', json } | { kind: 'records', order: [key], map: Map(key -> json) }
function snapshotOf(value) {
  if (value === undefined) return null
  if (!Array.isArray(value)) return { kind: 'doc', json: JSON.stringify(value ?? null) }
  if (!value.every(hasKey)) return { kind: 'keyless', json: JSON.stringify(value) }
  const order = []
  const map = new Map()
  for (const r of value) {
    const k = String(idOf(r))
    if (!map.has(k)) order.push(k)
    map.set(k, JSON.stringify(r))
  }
  return { kind: 'records', order, map }
}

/** -> { ops, snap } for one collection (ops empty when nothing changed). */
function diffCollection(name) {
  const cur = state[name]
  const prev = persisted.get(name) ?? null
  const snap = snapshotOf(cur)
  const ops = []
  if (!snap) return { ops, snap: prev }
  if (snap.kind === 'doc') {
    if (!prev || prev.kind !== 'doc' || prev.json !== snap.json) ops.push({ op: 'setDoc', collection: name, data: JSON.parse(snap.json) })
    return { ops, snap }
  }
  if (snap.kind === 'keyless' || !prev || prev.kind !== 'records') {
    const json = snap.kind === 'keyless' ? snap.json : JSON.stringify(cur)
    const prevJson = !prev ? null : prev.kind === 'records' ? JSON.stringify(prev.order.map(k => JSON.parse(prev.map.get(k)))) : prev.json
    if (json !== prevJson) ops.push({ op: 'replaceCollection', collection: name, data: JSON.parse(json) })
    return { ops, snap }
  }
  // Keyed records: detect reordering of surviving records (sorted in place -> replace).
  const surviving = snap.order.filter(k => prev.map.has(k))
  const prevSurviving = prev.order.filter(k => snap.map.has(k))
  if (surviving.some((k, i) => k !== prevSurviving[i])) {
    ops.push({ op: 'replaceCollection', collection: name, data: JSON.parse(JSON.stringify(cur)) })
    return { ops, snap }
  }
  for (const k of prev.order) if (!snap.map.has(k)) ops.push({ op: 'delete', collection: name, id: k })
  const firstOld = snap.order.findIndex(k => prev.map.has(k))
  const ups = []
  if (firstOld > 0) {
    // New records in front of the first persisted one: prepend, closest to it first.
    for (let i = firstOld - 1; i >= 0; i--) ups.push({ k: snap.order[i], position: 'first' })
  }
  const start = firstOld < 0 ? 0 : firstOld
  for (let i = start; i < snap.order.length; i++) {
    const k = snap.order[i]
    if (!prev.map.has(k)) ups.push({ k, position: 'last' })
    else if (prev.map.get(k) !== snap.map.get(k)) ups.push({ k })
  }
  for (const u of ups) {
    const op = { op: 'upsert', collection: name, id: u.k, data: JSON.parse(snap.map.get(u.k)) }
    if (u.position) op.position = u.position
    ops.push(op)
  }
  return { ops, snap }
}

function buildBatch() {
  const ops = []
  const snaps = new Map()
  for (const name of dirty) {
    const r = diffCollection(name)
    ops.push(...r.ops)
    snaps.set(name, r.snap)
  }
  return { ops, snaps, names: [...dirty] }
}

// ---------------------------------------------------------------------------
// Flush scheduling
// ---------------------------------------------------------------------------
function canSync() { return ready && suspended === 0 && txDepth === 0 }

function markDirty(name) {
  dirty.add(name)
  updatePending()
  scheduleFlush()
}

function scheduleFlush(ms = FLUSH_MS) {
  if (flushTimer || retryTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flush() }, ms)
}

function flushSoon() {
  if (retryTimer) return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushTimer = null; flush() }, 0)
}

function persist(name) {
  if (txDepth > 0) { txDirty.add(name); updatePending(); return }
  markDirty(name)
}

/** Send every pending change now. Resolves when nothing is pending (or on failure). */
async function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (inFlight) { await inFlight.catch(() => {}); if (dirty.size && canSync()) return flush(); return }
  if (!canSync() || !dirty.size) return
  const { ops, snaps, names } = buildBatch()
  names.forEach(n => dirty.delete(n))
  if (!ops.length) {
    for (const [n, s] of snaps) persisted.set(n, s)
    updatePending()
    return
  }
  syncState.status = 'saving'
  inFlightNames = names
  updatePending()
  inFlight = (async () => {
    try {
      await http.post('/state/batch', { ops })
      for (const [n, s] of snaps) persisted.set(n, s)
      attempt = 0
      syncState.attempts = 0
      syncState.error = null
      syncState.lastSavedAt = new Date().toISOString()
      syncState.status = 'idle'
    } catch (e) {
      // Keep the changes: the next attempt diffs against the same persisted snapshot.
      names.forEach(n => dirty.add(n))
      if (e?.status === 401 || !ready) { syncState.status = 'idle'; return }
      syncState.status = 'error'
      syncState.error = e?.code ?? 'NETWORK_ERROR'
      syncState.attempts = ++attempt
      const wait = RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)]
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; flush() }, wait)
      throw e
    } finally {
      inFlight = null
      inFlightNames = []
      updatePending()
    }
  })()
  try { await inFlight } catch { return }
  if (dirty.size) scheduleFlush(0)
}

/** Manual retry (save indicator). */
function retryNow() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  return flush()
}

// Best effort when the tab closes with unsaved changes: keepalive fetch.
function flushOnExit() {
  if (!ready || (!dirty.size && !txDirty.size && !inFlightNames.length)) return
  for (const n of txDirty) dirty.add(n)
  for (const n of inFlightNames) dirty.add(n)
  const { ops } = buildBatch()
  if (!ops.length) return
  http.post('/state/batch', { ops }, { keepalive: true }).catch(() => {})
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushOnExit)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && canSync() && dirty.size) flush() })
}

function resetSyncBookkeeping() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  dirty.clear()
  txDirty.clear()
  persisted.clear()
  attempt = 0
  Object.assign(syncState, { status: 'idle', pending: 0, attempts: 0, error: null })
}

/** Replace the in-memory state with a server payload { seedVersion, collections }. */
function applyServerState(payload) {
  const cols = payload?.collections ?? {}
  serverSeedVersion = payload?.seedVersion ?? serverSeedVersion
  for (const n of Object.keys(state)) if (!(n in cols)) delete state[n]
  for (const [n, v] of Object.entries(cols)) {
    if (Array.isArray(v) && Array.isArray(state[n])) state[n].splice(0, state[n].length, ...v)
    else state[n] = v
  }
  resetSyncBookkeeping()
  for (const n of Object.keys(state)) persisted.set(n, snapshotOf(state[n]))
}

async function loadServerState() {
  const [payload] = await Promise.all([
    http.get('/state', { timeout: 30000 }),
    ...SEED_PRELOAD.filter(n => !(n in seeds)).map(n => db.loadSeed(n).catch(() => undefined)),
  ])
  applyServerState(payload)
}

export const db = {
  get ready() { return ready },
  get seedVersion() { return serverSeedVersion ?? SEED_VERSION },
  seedNames: SEED_NAMES,
  syncState,

  /** Load the whole state from the API (requires a session token). */
  async init() {
    suspended++
    try {
      await loadServerState()
      ready = true
    } finally { suspended-- }
    const hooks = readyHooks.splice(0)
    for (const fn of hooks) { try { fn() } catch (e) { console.error('[db] ready hook failed', e) } }
  },

  /** Run fn once the state is loaded (immediately when it already is). */
  afterInit(fn) { if (ready) { try { fn() } catch (e) { console.error(e) } } else readyHooks.push(fn) },

  /** Drop the in-memory state (logout). Unsent changes are discarded. */
  unload() {
    ready = false
    resetSyncBookkeeping()
    for (const n of Object.keys(state)) delete state[n]
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

  /** Documents (user, wallet, system ...). */
  doc(name) { return ensure(name, 'doc') },

  patchDoc(name, patch) {
    const d = ensure(name, 'doc')
    Object.assign(d, typeof patch === 'function' ? patch(d) ?? {} : patch)
    persist(name)
    return d
  },

  /** Mark a collection as changed after mutating nested data in place. */
  touch(col) { persist(col) },

  /**
   * Run several writes atomically. If fn throws, every collection is restored to its
   * state before the transaction and nothing is sent. Otherwise everything written
   * inside goes to the server in a single batch right after the transaction ends.
   */
  async transaction(fn) {
    const snapshot = {}
    for (const n of Object.keys(state)) snapshot[n] = JSON.stringify(state[n])
    txDepth++
    try {
      const res = await fn(db)
      txDepth--
      if (txDepth === 0) {
        for (const n of txDirty) dirty.add(n)
        txDirty.clear()
        updatePending()
        // Flush right after the current task: the caller's synchronous follow-up writes
        // (notification, audit, request log) ride along in the same batch.
        if (dirty.size) flushSoon()
      }
      return res
    } catch (e) {
      txDepth--
      for (const n of Object.keys(state)) {
        if (n in snapshot) {
          const restored = JSON.parse(snapshot[n])
          if (Array.isArray(state[n]) && Array.isArray(restored)) state[n].splice(0, state[n].length, ...restored)
          else state[n] = restored
        } else delete state[n]
      }
      if (txDepth === 0) {
        txDirty.clear()
        updatePending()
        if (dirty.size) scheduleFlush()
      }
      throw e
    }
  },

  /** Sequential readable ids: ORD-10483, SHP-20931, TXN-7712, MNF-0412, INV-2026-0098. */
  nextId(prefix) {
    const counters = ensure('counters', 'doc')
    const n = (counters[prefix] ?? 0) + 1
    counters[prefix] = n
    persist('counters')
    if (prefix === 'MNF') return `MNF-${String(n).padStart(4, '0')}`
    if (prefix === 'INV') return `INV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`
    return `${prefix}-${n}`
  },

  /** Send pending changes now (resolves when the batch is acknowledged or failed). */
  flush,
  retry: retryNow,

  /** Reset every collection to seed on the server, then reload the state. */
  async reset() {
    await flush().catch(() => {})
    suspended++
    try {
      resetSyncBookkeeping()
      await http.post('/state/reset')
      await loadServerState()
    } finally { suspended-- }
  },

  /** -> JSON string { version, seedVersion, exportedAt, data } (server export). */
  async export() {
    await flush().catch(() => {})
    const out = await http.get('/state/export', { timeout: 30000 })
    const version = out?.seedVersion ?? out?.version ?? db.seedVersion
    return JSON.stringify({ version, seedVersion: version, exportedAt: out?.exportedAt ?? new Date().toISOString(), data: out?.data ?? {} }, null, 2)
  },

  /** Replace all server data with an export, then reload the state. */
  async import(json) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json
    if (!parsed || typeof parsed.data !== 'object') throw new Error('INVALID_EXPORT')
    await flush().catch(() => {})
    suspended++
    try {
      resetSyncBookkeeping()
      const version = parsed.seedVersion ?? parsed.version ?? db.seedVersion
      await http.post('/state/import', { seedVersion: version, exportedAt: parsed.exportedAt ?? null, data: parsed.data }, { timeout: 60000 })
      await loadServerState()
    } finally { suspended-- }
  },

  /** Approximate size of the in-memory data (UTF-16 bytes of its JSON). */
  storageBytes() {
    let total = 0
    for (const n of Object.keys(state)) total += (n.length + JSON.stringify(state[n] ?? null).length) * 2
    return total
  },

  /** Per collection size of the in-memory data: [{ name, bytes, records }]. */
  collectionSizes() {
    return Object.keys(state).map(n => {
      const v = state[n]
      return { name: n, bytes: (n.length + JSON.stringify(v ?? null).length) * 2, records: Array.isArray(v) ? v.length : null }
    })
  },

  /** Raw (date-resolved) bundled seed copy, e.g. for "compare with seed" features. */
  seed(name) { return name in seeds ? freshSeed(name) : undefined },

  /** Load a bundled seed file on demand -> date-resolved copy. */
  async loadSeed(name) {
    if (!(name in seeds)) {
      const loader = seedLoaders[`../data/seed/${name}.json`]
      if (!loader) return undefined
      seeds[name] = await loader()
    }
    return freshSeed(name)
  },
}

if (import.meta.env.DEV) window.__db = db
