/**
 * Team and roles API (spec 8.8). Members live in the `team` collection, the role -> permission
 * matrix in the `roles` document (read by store/session.js can()).
 *
 *   listTeam() -> { members: Member[], invites: Member[], seats: { used, limit|null } }
 *     Member = { id, name, email, role, status: 'active'|'invited', initials, joinedAt, lastActiveAt,
 *                invitedAt?, invitedBy?, expiresAt?, isOwner, isYou }
 *   inviteMember({ email, role, name? }) -> Member (status 'invited')   VALIDATION | MEMBER_EXISTS | FORBIDDEN
 *   resendInvite(id) -> Member          cancelInvite(id) -> { removed }
 *   changeRole(id, role) -> Member      OWNER_LOCKED when touching the owner
 *   removeMember(id) -> { removed, index }       restoreMember(member, index) -> Member   (undo)
 *   getRoles() -> { permissions: [{ id, label{tr,en} }], roles: [{ id, name{tr,en}, permissions[] }] }
 *   setRolePermission(roleId, permissionId, enabled) -> roles doc   (owner column is locked)
 * All writes require can('team.manage') (FORBIDDEN otherwise) and write an audit entry.
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { can, session, ROLES } from '../store/session.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function requireManage() {
  if (!can('team.manage')) throw new ApiError('FORBIDDEN', 'Not allowed', 403)
}

function decorate(m) {
  const me = db.doc('user')
  return { ...plain(m), isOwner: m.role === 'owner', isYou: m.id === me.id }
}

function initialsOf(name, email) {
  const src = String(name || '').trim() || String(email || '').split('@')[0].replace(/[._-]+/g, ' ')
  return src.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function nextMemberId() {
  let n = db.all('team').reduce((m, r) => Math.max(m, Number(String(r.id).split('-')[1]) || 0), 0) + 1
  while (db.get('team', `USR-${String(n).padStart(3, '0')}`)) n++
  return `USR-${String(n).padStart(3, '0')}`
}

export function listTeam() {
  return request('GET /v1/team', () => {
    const all = db.all('team').map(decorate)
    const order = r => ROLES.indexOf(r.role)
    const members = all.filter(m => m.status !== 'invited').sort((a, b) => order(a) - order(b))
    const invites = all.filter(m => m.status === 'invited').sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)))
    const plan = session.plan
    const limit = plan === 'enterprise' ? null : plan === 'professional' ? 3 : 1
    return { members, invites, seats: { used: all.length, limit } }
  }, { minMs: 300, maxMs: 600 })
}

export function inviteMember({ email, role, name = '' } = {}) {
  return request('POST /v1/team/invitations', () => {
    requireManage()
    const errors = {}
    const e = String(email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(e)) errors.email = 'email'
    if (!ROLES.includes(role) || role === 'owner') errors.role = 'required'
    if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid invite', 422, errors)
    if (db.all('team').some(m => m.email.toLowerCase() === e)) throw new ApiError('MEMBER_EXISTS', 'Member exists', 409, { email: 'member_exists' })
    const now = new Date()
    const rec = {
      id: nextMemberId(),
      name: String(name).trim() || e.split('@')[0],
      email: e, role, status: 'invited',
      initials: initialsOf(name, e),
      invitedAt: now.toISOString(),
      invitedBy: session.user?.name ?? 'system',
      expiresAt: new Date(now.getTime() + 7 * 864e5).toISOString(),
      joinedAt: null, lastActiveAt: null,
    }
    db.insert('team', rec, { prepend: false })
    audit('team.invite', rec.id, { tr: `Davet gönderildi: ${e} (${role})`, en: `Invitation sent: ${e} (${role})` })
    notify({ type: 'info', title: { tr: `Ekip daveti gönderildi: ${e}`, en: `Team invitation sent: ${e}` }, link: '/settings/team' })
    return decorate(rec)
  }, { minMs: 500, maxMs: 900 })
}

export function resendInvite(id) {
  return request(`POST /v1/team/invitations/${id}/resend`, () => {
    requireManage()
    const m = db.get('team', id)
    if (!m || m.status !== 'invited') throw new ApiError('NOT_FOUND', 'Invitation not found', 404)
    const now = new Date()
    const r = db.update('team', id, { invitedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 864e5).toISOString() })
    audit('team.invite_resend', id, { tr: `Davet yeniden gönderildi: ${m.email}`, en: `Invitation resent: ${m.email}` })
    return decorate(r)
  })
}

export function cancelInvite(id) {
  return request(`DELETE /v1/team/invitations/${id}`, () => {
    requireManage()
    const m = db.get('team', id)
    if (!m || m.status !== 'invited') throw new ApiError('NOT_FOUND', 'Invitation not found', 404)
    db.remove('team', id)
    audit('team.invite_cancel', id, { tr: `Davet iptal edildi: ${m.email}`, en: `Invitation cancelled: ${m.email}` })
    return { removed: plain(m) }
  })
}

export function changeRole(id, role) {
  return request(`PATCH /v1/team/${id}`, () => {
    requireManage()
    const m = db.get('team', id)
    if (!m) throw new ApiError('NOT_FOUND', 'Member not found', 404)
    if (m.role === 'owner' || role === 'owner') throw new ApiError('OWNER_LOCKED', 'Owner role cannot change', 409)
    if (!ROLES.includes(role)) throw new ApiError('VALIDATION', 'Invalid role', 422, { role: 'required' })
    const prev = m.role
    const r = db.update('team', id, { role })
    audit('team.role_change', id, { tr: `${m.name}: ${prev} > ${role}`, en: `${m.name}: ${prev} > ${role}` })
    return { ...decorate(r), previousRole: prev }
  }, { minMs: 300, maxMs: 600 })
}

export function removeMember(id) {
  return request(`DELETE /v1/team/${id}`, () => {
    requireManage()
    const m = db.get('team', id)
    if (!m) throw new ApiError('NOT_FOUND', 'Member not found', 404)
    if (m.role === 'owner') throw new ApiError('OWNER_LOCKED', 'Owner cannot be removed', 409)
    const index = db.all('team').findIndex(x => x.id === id)
    db.remove('team', id)
    audit('team.remove', id, { tr: `Ekipten çıkarıldı: ${m.name}`, en: `Removed from team: ${m.name}` })
    return { removed: plain(m), index }
  })
}

export function restoreMember(member, index = null) {
  return request('POST /v1/team', () => {
    requireManage()
    if (!db.get('team', member.id)) {
      const arr = db.all('team')
      const rec = plain(member)
      delete rec.isOwner; delete rec.isYou
      if (index != null && index >= 0 && index <= arr.length) { arr.splice(index, 0, rec); db.touch('team') }
      else db.insert('team', rec, { prepend: false })
    }
    audit('team.restore', member.id, { tr: `Ekibe geri eklendi: ${member.name}`, en: `Restored to team: ${member.name}` })
    return decorate(db.get('team', member.id))
  }, { minMs: 150, maxMs: 300 })
}

export function getRoles() {
  return request('GET /v1/roles', () => plain(db.doc('roles')), { minMs: 200, maxMs: 400 })
}

export function setRolePermission(roleId, permissionId, enabled) {
  return request(`PATCH /v1/roles/${roleId}`, () => {
    requireManage()
    if (roleId === 'owner') throw new ApiError('OWNER_LOCKED', 'Owner permissions are fixed', 409)
    if (permissionId === 'admin.platform') throw new ApiError('OWNER_LOCKED', 'Platform permission is owner only', 409)
    const doc = db.doc('roles')
    const role = doc.roles.find(r => r.id === roleId)
    if (!role) throw new ApiError('NOT_FOUND', 'Role not found', 404)
    if (!doc.permissions.some(p => p.id === permissionId)) throw new ApiError('NOT_FOUND', 'Permission not found', 404)
    const set = new Set(role.permissions)
    if (enabled) set.add(permissionId)
    else set.delete(permissionId)
    const order = doc.permissions.map(p => p.id)
    role.permissions = order.filter(p => set.has(p))
    db.touch('roles')
    audit('role.permission', roleId, { tr: `${roleId}: ${permissionId} ${enabled ? 'açıldı' : 'kapatıldı'}`, en: `${roleId}: ${permissionId} ${enabled ? 'granted' : 'revoked'}` })
    return plain(doc)
  }, { minMs: 200, maxMs: 400 })
}
