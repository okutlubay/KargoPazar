import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { startSession, clearSession } from '../store/session.js'
import { audit } from '../store/events.js'

const LOCK_KEY = 'kpz_demo:loginLock'
const MAX_ATTEMPTS = 5
const LOCK_MS = 30_000

function lockState() {
  try { return JSON.parse(sessionStorage.getItem(LOCK_KEY)) ?? { fails: 0, until: 0 } } catch { return { fails: 0, until: 0 } }
}
function saveLock(s) { try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(s)) } catch {} }

/** Remaining lock time in ms (0 when not locked). */
export function lockRemaining() {
  return Math.max(0, lockState().until - Date.now())
}

export function login(identifier, password, remember) {
  return request('POST /v1/auth/login', () => {
    if (lockRemaining() > 0) throw new ApiError('LOCKED', 'Too many attempts', 429)
    const user = db.doc('user')
    const id = (identifier ?? '').trim().toLowerCase()
    const ok = (id === user.username || id === user.email.toLowerCase()) && password === user.password
    if (!ok) {
      const s = lockState()
      s.fails += 1
      if (s.fails >= MAX_ATTEMPTS) { s.fails = 0; s.until = Date.now() + LOCK_MS }
      saveLock(s)
      throw new ApiError(s.until > Date.now() ? 'LOCKED' : 'INVALID_CREDENTIALS', 'Invalid credentials', 401)
    }
    saveLock({ fails: 0, until: 0 })
    startSession(user.username, !!remember)
    audit('auth.login', user.username)
    return { username: user.username, name: user.name }
  }, { minMs: 350, maxMs: 700 })
}

export function logout() {
  clearSession()
}

export function requestPasswordReset(email) {
  return request('POST /v1/auth/password-reset', () => ({ sent: true, email }), { minMs: 500, maxMs: 900 })
}

export function changePassword(current, next) {
  return request('POST /v1/auth/change-password', () => {
    const user = db.doc('user')
    if (current !== user.password) throw new ApiError('WRONG_PASSWORD', 'Current password is incorrect', 400)
    db.patchDoc('user', { password: next })
    audit('auth.password_change', user.username)
    return { ok: true }
  })
}
