// Session, role preview and plan feature gates.
//
//   import { session, can, hasFeature } from '@/app/store/session.js'
//   can('shipments.create')      -> false when previewing the Finance role
//   hasFeature('api')            -> false on the Starter plan
import { reactive, computed } from 'vue'
import { db, NS } from './db.js'
import { setUnitsGetter } from '../i18n/index.js'

const SESSION_KEY = `${NS}:session`
const PREVIEW_KEY = `${NS}:rolePreview`
const THIRTY_DAYS = 30 * 24 * 3600 * 1000

export const ROLES = ['owner', 'admin', 'operations', 'finance', 'readonly']

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
  rolePreview: null,
  get user() { return this.username ? db.doc('user') : null },
  get effectiveRole() { return this.rolePreview ?? this.user?.role ?? 'owner' },
  get plan() { return this.user?.company?.plan ?? 'enterprise' },
})

setUnitsGetter(() => session.user?.preferences?.units ?? 'imperial')

export function loadSession() {
  let raw = null
  try { raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY) } catch {}
  if (!raw) return false
  try {
    const s = JSON.parse(raw)
    if (s.expiresAt && s.expiresAt < Date.now()) { clearSession(); return false }
    session.username = s.username
    session.remember = !!s.remember
  } catch { return false }
  try { session.rolePreview = sessionStorage.getItem(PREVIEW_KEY) || null } catch {}
  return true
}

export function startSession(username, remember) {
  const payload = JSON.stringify({ username, remember, expiresAt: remember ? Date.now() + THIRTY_DAYS : null })
  try {
    if (remember) { localStorage.setItem(SESSION_KEY, payload); sessionStorage.removeItem(SESSION_KEY) }
    else { sessionStorage.setItem(SESSION_KEY, payload); localStorage.removeItem(SESSION_KEY) }
  } catch {}
  session.username = username
  session.remember = remember
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(PREVIEW_KEY) } catch {}
  session.username = null
  session.rolePreview = null
}

export function isAuthenticated() { return !!session.username }

export function setRolePreview(role) {
  session.rolePreview = role && role !== session.user?.role ? role : null
  try {
    if (session.rolePreview) sessionStorage.setItem(PREVIEW_KEY, session.rolePreview)
    else sessionStorage.removeItem(PREVIEW_KEY)
  } catch {}
}

export function can(permission) {
  return rolePermissions(session.effectiveRole).includes(permission)
}

export function hasFeature(feature) {
  if (!GATED.has(feature)) return true
  return (PLAN_FEATURES[session.plan] ?? []).includes(feature)
}

export const isPreviewing = computed(() => !!session.rolePreview)
