// Tiny fetch wrapper for the KargoPazar backend API (contract: docs/BACKEND.md).
//
//   import { http } from './http.js'
//   const state = await http.get('/state')
//   await http.post('/state/batch', { ops })
//
// - base URL: import.meta.env.VITE_API_BASE_URL (for example http://localhost:5000/api)
// - JSON in / JSON out, Bearer token from the session (registered by store/session.js)
// - error JSON { code, message } -> ApiError(code, message, status)
// - network failure -> ApiError('NETWORK_ERROR', ..., 0), timeout -> ApiError('TIMEOUT', ..., 0)
// - 401 on a non auth endpoint -> session cleared and redirect to #/login?redirect=<current path>
import { ApiError } from './client.js'

export const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')

let auth = { getToken: () => null, onUnauthorized: () => {} }
/** Registered once by store/session.js (avoids an import cycle). */
export function setAuthProvider(p) { auth = { ...auth, ...p } }

const DEFAULT_TIMEOUT = 15000

export async function httpRequest(method, path, { body, timeout = DEFAULT_TIMEOUT, auth: useAuth = true, keepalive = false, headers = {} } = {}) {
  const url = API_BASE + (path.startsWith('/') ? path : '/' + path)
  const h = { Accept: 'application/json', ...headers }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const token = useAuth ? auth.getToken() : null
  if (token) h.Authorization = `Bearer ${token}`
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null
  let res
  try {
    res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl?.signal, keepalive })
  } catch (e) {
    if (e?.name === 'AbortError') throw new ApiError('TIMEOUT', 'Request timed out', 0)
    throw new ApiError('NETWORK_ERROR', 'Server unreachable', 0)
  } finally {
    if (timer) clearTimeout(timer)
  }
  let data = null
  const text = res.status === 204 ? '' : await res.text().catch(() => '')
  if (text) { try { data = JSON.parse(text) } catch { data = null } }
  if (!res.ok) {
    const code = data?.code || (res.status === 401 ? 'UNAUTHORIZED' : res.status === 429 ? 'LOCKED' : res.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'HTTP_' + res.status)
    const err = new ApiError(code, data?.message || res.statusText || code, res.status, data?.details)
    const retryAfter = Number(res.headers.get('Retry-After'))
    if (retryAfter > 0) err.retryAfter = retryAfter
    if (res.status === 401 && useAuth && !path.startsWith('/auth/')) {
      try { auth.onUnauthorized() } catch {}
    }
    throw err
  }
  return data
}

export const http = {
  get: (path, opts) => httpRequest('GET', path, opts),
  post: (path, body, opts) => httpRequest('POST', path, { ...opts, body }),
}
