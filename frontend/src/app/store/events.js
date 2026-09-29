// Cross-cutting side effects shared by all api/* modules:
// notifications (bell), audit log (Settings > Audit) and model activity log (AI hub).
import { db } from './db.js'
import { session } from './session.js'

/**
 * @param {{type?:'info'|'success'|'warning'|'error', title:{tr,en}, body?:{tr,en}, link?:string}} n
 */
export function notify(n) {
  return db.insert('notifications', {
    id: 'NTF-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: n.type ?? 'info',
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    createdAt: new Date().toISOString(),
    read: false,
  })
}

/** action: short code like 'shipment.create'; target: id; detail: {tr,en} or string */
export function audit(action, target, detail) {
  db.insert('audit_log', {
    id: 'AUD-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    at: new Date().toISOString(),
    actor: session.user?.name ?? 'system',
    role: session.effectiveRole,
    action,
    target: target ?? null,
    detail: detail ?? null,
  })
  db.trim('audit_log', 500)
}

/** module: 'address'|'forecast'|'pricing'|'optimizer'|'hs'|'customs'; kind: 'train'|'predict'|'feedback'|'approve' */
export function modelEvent(module, kind, detail) {
  db.insert('modelEvents', {
    id: 'MEV-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    at: new Date().toISOString(),
    module, kind, detail,
  })
  db.trim('modelEvents', 100)
}
