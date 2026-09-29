// Authentication against the backend API (docs/BACKEND.md).
//
//   login(identifier, password, remember) -> { username, name }   POST /api/auth/login, then db.init()
//     errors: INVALID_CREDENTIALS (401), LOCKED (429 from the server or the client side lock)
//   logout() -> flushes pending changes, clears token and in-memory state
//   changePassword(current, next) -> { ok }   POST /api/auth/change-password (WRONG_PASSWORD, WEAK_PASSWORD)
//   verifyPassword(password) -> true | ApiError WRONG_PASSWORD   (re-authentication for sensitive actions)
//   loginDemo() -> { username, name }  signs into the shared demo account (signup / onboarding flow)
import { request, ApiError, sleep } from './client.js'
import { http } from './http.js'
import { db } from '../store/db.js'
import { session, startSession, clearSession } from '../store/session.js'
import { audit } from '../store/events.js'

const LOCK_KEY = 'kpz_demo:loginLock'
const MAX_ATTEMPTS = 5
const LOCK_MS = 30_000
export const DEMO_CREDENTIALS = { identifier: 'demo', password: 'Demo123!' }

function lockState() {
  try { return JSON.parse(sessionStorage.getItem(LOCK_KEY)) ?? { fails: 0, until: 0 } } catch { return { fails: 0, until: 0 } }
}
function saveLock(s) { try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(s)) } catch {} }

/** Remaining lock time in ms (0 when not locked). */
export function lockRemaining() {
  return Math.max(0, lockState().until - Date.now())
}

/** POST /auth/login + db.init(). Throws ApiError; does not touch the lock counters. */
async function serverLogin(identifier, password, remember) {
  const res = await http.post('/auth/login', { identifier: String(identifier ?? '').trim(), password: String(password ?? '') }, { auth: false })
  const user = res?.user ?? {}
  const username = user.username ?? String(identifier ?? '').trim().toLowerCase()
  startSession(username, !!remember, res.token, res.expiresAt)
  try {
    await db.init()
  } catch (e) {
    clearSession()
    db.unload()
    throw e
  }
  return { username, name: db.doc('user')?.name ?? user.name ?? username }
}

export function login(identifier, password, remember) {
  return request('POST /v1/auth/login', async () => {
    if (lockRemaining() > 0) throw new ApiError('LOCKED', 'Too many attempts', 429)
    try {
      const u = await serverLogin(identifier, password, remember)
      saveLock({ fails: 0, until: 0 })
      audit('auth.login', u.username)
      return u
    } catch (e) {
      if (e?.code === 'LOCKED' || e?.status === 429) {
        saveLock({ fails: 0, until: Date.now() + (e.retryAfter ? e.retryAfter * 1000 : LOCK_MS) })
        throw new ApiError('LOCKED', e.message || 'Too many attempts', 429)
      }
      if (e?.status === 401 || e?.code === 'INVALID_CREDENTIALS') {
        const s = lockState()
        s.fails += 1
        if (s.fails >= MAX_ATTEMPTS) { s.fails = 0; s.until = Date.now() + LOCK_MS }
        saveLock(s)
        throw new ApiError(s.until > Date.now() ? 'LOCKED' : 'INVALID_CREDENTIALS', 'Invalid credentials', s.until > Date.now() ? 429 : 401)
      }
      throw e
    }
  }, { minMs: 150, maxMs: 300 })
}

/** Sign into the shared demo account (signup never creates a company, spec 5.2). */
export async function loginDemo() {
  if (session.token && db.ready) return { username: session.username, name: db.doc('user')?.name }
  return serverLogin(DEMO_CREDENTIALS.identifier, DEMO_CREDENTIALS.password, false)
}

export async function logout() {
  try { await Promise.race([db.flush(), sleep(3000)]) } catch {}
  clearSession()
  db.unload()
}

export function requestPasswordReset(email) {
  return request('POST /v1/auth/password-reset', () => ({ sent: true, email }), { minMs: 500, maxMs: 900 })
}

export async function verifyPassword(password) {
  try {
    await http.post('/auth/verify-password', { password: String(password ?? '') })
    return true
  } catch (e) {
    if (e?.status === 401 || e?.code === 'INVALID_CREDENTIALS') throw new ApiError('WRONG_PASSWORD', 'Wrong password', 400)
    throw e
  }
}

export function changePassword(current, next) {
  return request('POST /v1/auth/change-password', async () => {
    await http.post('/auth/change-password', { current, next })
    audit('auth.password_change', db.doc('user')?.username ?? session.username)
    return { ok: true }
  }, { minMs: 100, maxMs: 250 })
}
