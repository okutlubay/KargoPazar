/**
 * Notification center (bell + /notifications).
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * listNotifications({ unread?, type?, limit? }) -> Notification[] newest first
 *   Notification = { id, at, type, title: {tr,en}, body: {tr,en}|null, link: string|null, read }
 *   (`at` is normalized from seed `at` / events.notify() `createdAt`)
 * unreadCount() -> number                                 (sync, reactive-friendly)
 * latestNotifications(n = 8) -> Notification[]            (sync, for the bell dropdown)
 * markRead(id) -> Notification           undo: markUnread(id)
 * markUnread(id) -> Notification
 * markAllRead() -> { ids }               undo: markUnreadMany(ids)
 * markUnreadMany(ids) -> { ids }
 * removeNotification(id) -> { removed }  undo: restoreNotification(removed)
 * restoreNotification(n) -> Notification
 * clearRead() -> { removed: Notification[] }
 */
import { toRaw } from 'vue'
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const atOf = n => n.at ?? n.createdAt ?? ''
const norm = n => ({ ...plain(n), at: atOf(n) })
const sorted = () => [...db.all('notifications')].sort((a, b) => atOf(b).localeCompare(atOf(a)))

export function listNotifications(p = {}) {
  return request('GET /v1/notifications', () => {
    let list = sorted()
    if (p.unread) list = list.filter(n => !n.read)
    if (p.type) list = list.filter(n => n.type === p.type)
    if (p.limit) list = list.slice(0, p.limit)
    return list.map(norm)
  }, { minMs: 200, maxMs: 450 })
}

export function unreadCount() {
  return db.all('notifications').filter(n => !n.read).length
}

export function latestNotifications(n = 8) {
  return sorted().slice(0, n).map(x => ({ ...x, at: atOf(x) }))
}

function setRead(id, read) {
  const n = db.get('notifications', id)
  if (!n) throw new ApiError('NOT_FOUND', 'Notification not found', 404)
  return norm(db.update('notifications', id, { read }))
}

export function markRead(id) {
  return request(`POST /v1/notifications/${id}/read`, () => setRead(id, true), { minMs: 120, maxMs: 250 })
}

export function markUnread(id) {
  return request(`POST /v1/notifications/${id}/unread`, () => setRead(id, false), { minMs: 120, maxMs: 250 })
}

export function markAllRead() {
  return request('POST /v1/notifications/read-all', async () => {
    const ids = db.all('notifications').filter(n => !n.read).map(n => n.id)
    await db.transaction(() => { for (const id of ids) db.update('notifications', id, { read: true }) })
    return { ids }
  }, { minMs: 200, maxMs: 400 })
}

export function markUnreadMany(ids) {
  return request('POST /v1/notifications/unread', async () => {
    await db.transaction(() => { for (const id of ids) if (db.get('notifications', id)) db.update('notifications', id, { read: false }) })
    return { ids }
  }, { minMs: 120, maxMs: 250 })
}

export function removeNotification(id) {
  return request(`DELETE /v1/notifications/${id}`, () => {
    const r = db.remove('notifications', id)
    if (!r) throw new ApiError('NOT_FOUND', 'Notification not found', 404)
    return { removed: norm(r) }
  }, { minMs: 150, maxMs: 300 })
}

export function restoreNotification(n) {
  return request('POST /v1/notifications', () => {
    if (!db.get('notifications', n.id)) db.insert('notifications', plain(n))
    return norm(db.get('notifications', n.id))
  }, { minMs: 100, maxMs: 200 })
}

export function clearRead() {
  return request('DELETE /v1/notifications?read=true', async () => {
    const removed = db.all('notifications').filter(n => n.read).map(norm)
    await db.transaction(() => { for (const n of removed) db.remove('notifications', n.id) })
    return { removed }
  }, { minMs: 200, maxMs: 400 })
}
