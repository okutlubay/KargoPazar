// Sidebar structure (spec 4.1). Used by AppShell and CommandPalette.
// badge: function returning a live count (or null) from the db.
import { db } from './store/db.js'

const pendingOrders = () => db.all('orders').filter(o => o.status === 'awaiting_shipment' || o.status === 'on_hold').length || null
const exceptions = () => db.all('shipments').filter(s => s.status === 'exception').length || null
const pricingPending = () => {
  const recs = db.all('pricing_recs')
  return Array.isArray(recs) ? recs.filter(r => r.status === 'suggested').length || null : null
}

export const NAV = [
  {
    key: 'operations',
    items: [
      { name: 'overview', icon: 'home' },
      { name: 'orders', icon: 'list', badge: pendingOrders },
      { name: 'shipments', icon: 'box', badge: exceptions, badgeTone: 'danger' },
      { name: 'batch', icon: 'layers', feature: 'batch' },
      { name: 'manifests', icon: 'file' },
      { name: 'ops', icon: 'warehouse' },
      { name: 'track', icon: 'radar' },
    ],
  },
  {
    key: 'international',
    items: [
      { name: 'intl', icon: 'plane', feature: 'intl' },
      { name: 'customs', icon: 'shield', feature: 'customs' },
      { name: 'intl-tests', icon: 'flask' },
    ],
  },
  {
    key: 'ai',
    items: [
      {
        name: 'ai', icon: 'brain',
        children: [
          { name: 'ai-address', icon: 'pin' },
          { name: 'ai-forecast', icon: 'chart' },
          { name: 'ai-pricing', icon: 'dollar', badge: pricingPending },
          { name: 'ai-optimizer', icon: 'route' },
          { name: 'ai-hs', icon: 'tag' },
          { name: 'ai-customs-docs', icon: 'file' },
        ],
      },
    ],
  },
  {
    key: 'integrations',
    items: [
      { name: 'stores', icon: 'store' },
      { name: 'carrier-accounts', icon: 'truck' },
      { name: 'api', icon: 'code', feature: 'api' },
    ],
  },
  {
    key: 'account',
    items: [
      { name: 'billing', icon: 'wallet' },
      { name: 'plan', icon: 'star' },
      { name: 'settings', icon: 'settings' },
    ],
  },
  {
    key: 'admin',
    platform: true,
    items: [
      { name: 'admin-carriers', icon: 'truck' },
      { name: 'admin-rate-cards', icon: 'dollar' },
      { name: 'admin-countries', icon: 'globe' },
      { name: 'admin-customers', icon: 'users' },
      { name: 'admin-system', icon: 'server' },
      { name: 'admin-rnd', icon: 'flag' },
    ],
  },
]

export function flatNav() {
  const out = []
  for (const g of NAV) for (const it of g.items) {
    out.push({ ...it, group: g.key })
    for (const c of it.children ?? []) out.push({ ...c, group: g.key, parent: it.name })
  }
  return out
}
