// Session, role preview and plan feature gates.
//
//   import { session, can, hasFeature } from '@/app/store/session.js'
//   can('shipments.create')      -> false when previewing the Finance role
//   hasFeature('api')            -> false on the Starter plan
import { reactive, computed } from 'vue'
import { db, NS } from './db.js'
import { setAuthProvider } from '../api/http.js'
import { setUnitsGetter } from '../i18n/index.js'

const SESSION_KEY = `${NS}:session`
const PREVIEW_KEY = `${NS}:rolePreview`

export const ROLES = ['owner', 'admin', 'operations', 'finance', 'readonly']

// The platform administrator account (username "admin") sees only the Yönetim module;
// every other user sees everything except it. Set on the server, never through role preview.
export const PLATFORM_ROLE = 'platform_admin'

// Role -> permission ids come from the `roles` seed document (editable in Settings > Team).
// Permission ids: orders.manage shipments.create shipments.void batch.run ops.manage billing.view
// billing.topup integrations.manage api.manage settings.manage team.manage rules.manage ai.manage
// reports.view admin.platform
function rolePermissions(role) {
  return db.doc('roles')?.roles?.find(r => r.id === role)?.permissions ?? []
}

// Features by plan (spec 5.11). Items not listed are available on every plan.
export const PLAN_FEATURES = {
  starter: [],
  professional: ['api', 'webhooks', 'batch', 'unlimitedStores'],
  enterprise: ['api', 'webhooks', 'batch', 'unlimitedStores', 'team', 'customRates', 'rules', 'intl', 'customs'],
}
const GATED = new Set(Object.values(PLAN_FEATURES).flat())

export const session = reactive({
  username: null,
  remember: false,
  token: null,
  expiresAt: null,
  /** 'offline' when the stored session could not load data at boot (server unreachable). */
  bootError: null,
  rolePreview: null,
  get user() { return this.username ? db.doc('user') : null },
  get effectiveRole() { return this.rolePreview ?? this.user?.role ?? 'owner' },
  get plan() { return this.user?.company?.plan ?? 'enterprise' },
})

setUnitsGetter(() => session.user?.preferences?.units ?? 'imperial')

function toMs(v) {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(n) ? n : null
}

/** Restore the stored session (token + user name). -> true when a valid token exists. */
export function loadSession() {
  let raw = null
  try { raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY) } catch {}
  if (!raw) return false
  try {
    const s = JSON.parse(raw)
    if (!s.token || (s.expiresAt && s.expiresAt < Date.now())) { clearSession(); return false }
    session.username = s.username
    session.remember = !!s.remember
    session.token = s.token
    session.expiresAt = s.expiresAt ?? null
  } catch { return false }
  try { session.rolePreview = sessionStorage.getItem(PREVIEW_KEY) || null } catch {}
  return true
}

/** Store the API token. remember: localStorage (survives restarts) vs sessionStorage (this tab). */
export function startSession(username, remember, token, expiresAt) {
  const exp = toMs(expiresAt)
  const payload = JSON.stringify({ username, remember, token, expiresAt: exp })
  try {
    if (remember) { localStorage.setItem(SESSION_KEY, payload); sessionStorage.removeItem(SESSION_KEY) }
    else { sessionStorage.setItem(SESSION_KEY, payload); localStorage.removeItem(SESSION_KEY) }
  } catch {}
  session.username = username
  session.remember = remember
  session.token = token
  session.expiresAt = exp
  session.bootError = null
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(PREVIEW_KEY) } catch {}
  session.username = null
  session.token = null
  session.expiresAt = null
  session.rolePreview = null
}

/** Session expired or revoked on the server: drop it and go to the login screen. */
export function handleUnauthorized() {
  const wasAuthed = !!session.token
  clearSession()
  db.unload()
  if (!wasAuthed) return
  const current = (location.hash || '#/').slice(1) || '/'
  if (current.startsWith('/login')) return
  location.hash = '#/login?redirect=' + encodeURIComponent(current)
}

setAuthProvider({
  getToken: () => session.token,
  onUnauthorized: handleUnauthorized,
})

export function isAuthenticated() { return !!session.username && !!session.token }

export function isPlatformAdmin() { return session.user?.role === PLATFORM_ROLE }

/** Landing route after sign-in: the admin module for the platform administrator, else the overview. */
export function homeRoute() { return isPlatformAdmin() ? { name: 'admin-carriers' } : { name: 'overview' } }

export function setRolePreview(role) {
  if (isPlatformAdmin()) role = null
  session.rolePreview = role && role !== session.user?.role ? role : null
  try {
    if (session.rolePreview) sessionStorage.setItem(PREVIEW_KEY, session.rolePreview)
    else sessionStorage.removeItem(PREVIEW_KEY)
  } catch {}
}

export function can(permission) {
  if (isPlatformAdmin()) return true
  return rolePermissions(session.effectiveRole).includes(permission)
}

export function hasFeature(feature) {
  if (!GATED.has(feature)) return true
  return (PLAN_FEATURES[session.plan] ?? []).includes(feature)
}

export const isPreviewing = computed(() => !!session.rolePreview)
