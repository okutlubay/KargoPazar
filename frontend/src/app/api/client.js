// Fake API layer. Every screen reads/writes data through api/* functions which
// wrap their work in request(): artificial latency, request log, cloned results.
//
//   export const listOrders = () => request('GET /v1/orders', () => db.all('orders'))
//
// The request log (db 'requestLog', newest first, max 200) powers the API console
// and the System Status screen.
import { db } from '../store/db.js'

export class ApiError extends Error {
  constructor(code, message, status = 400, details) {
    super(message || code)
    this.code = code
    this.status = status
    this.details = details
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const rand = (min, max) => Math.round(min + Math.random() * (max - min))

let currentSource = 'panel'
/** Run fn with every request inside it logged under `source` ('panel' | 'api' | 'webhook'). */
export async function withSource(source, fn) {
  const prev = currentSource
  currentSource = source
  try { return await fn() } finally { currentSource = prev }
}

function uid() {
  return (crypto.randomUUID?.() ?? Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 8)
}

export function logRequest(id, name, status, started, extra = {}) {
  const [method, ...rest] = name.split(' ')
  const path = rest.join(' ') || method
  db.insert('requestLog', {
    id,
    at: new Date().toISOString(),
    method: rest.length ? method : 'GET',
    path,
    status,
    ms: Math.round(performance.now() - started),
    source: extra.source ?? currentSource,
    ...extra,
  })
  db.trim('requestLog', 200)
}

/**
 * @param {string} name   "METHOD /v1/path" used in the request log
 * @param {Function} fn   work to perform (sync or async); throw ApiError for 4xx
 * @param {{minMs?:number,maxMs?:number,failRate?:number,source?:string,fail?:boolean}} opts
 *   `fail: true` forces a deterministic 503 (used for scripted error scenarios).
 */
export async function request(name, fn, { minMs = 300, maxMs = 900, failRate = 0, fail = false, source } = {}) {
  const id = uid()
  const started = performance.now()
  await sleep(rand(minMs, maxMs))
  if (fail || (failRate > 0 && Math.random() < failRate)) {
    logRequest(id, name, 503, started, source ? { source } : {})
    throw new ApiError('SERVICE_UNAVAILABLE', 'Service unavailable', 503)
  }
  try {
    const result = await fn()
    logRequest(id, name, 200, started, source ? { source } : {})
    return result === undefined ? undefined : structuredClone(toRaw(result))
  } catch (e) {
    logRequest(id, name, e instanceof ApiError ? e.status : 500, started, source ? { source } : {})
    throw e
  }
}

// Vue reactive proxies can't be structuredClone'd; unwrap deeply via JSON.
function toRaw(v) {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v
}

/**
 * Long-running work with progress (model training, batch jobs, test runs).
 * steps: array of async functions; onProgress(0..100, index) called after each.
 */
export async function runSteps(steps, onProgress, { stepMs = [80, 150] } = {}) {
  const out = []
  for (let i = 0; i < steps.length; i++) {
    await sleep(rand(stepMs[0], stepMs[1]))
    out.push(await steps[i](i))
    onProgress?.(Math.round(((i + 1) / steps.length) * 100), i)
  }
  return out
}
