/**
 * Marketplace integrations (spec 7.1, 7.2, 7.3, 5.4 "Senkronize et").
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * STORE_CHANNELS = ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce']
 * CHANNEL_META[channel] = { name, input: 'shopUrl'|'siteUrl'|'region'|null, permissions: [code] }
 *   permission labels: t('core.integrations.permissions.<code>')
 *
 * listStores() -> Store[] (+ health: 'ok'|'error' (latest job failed, not retried)|'off', unresolvedErrors, orderCount)
 * getStore(id) -> Store & { recentLogs: SyncLog[] }
 * validateStoreInput(channel, input) -> { valid, errors: { shopUrl?|siteUrl?|region? } }   (sync)
 *   Shopify: *.myshopify.com, WooCommerce: https://..., Amazon: region 'US'
 * startStoreConnection(channel, input) -> { sessionId, channel, permissions, requiresApiKey, store: {name, domain} }
 * authorizeStoreConnection(sessionId, { approve }) -> { store, apiKey: { consumerKeyMasked }|null }
 *   approve false -> ApiError OAUTH_DENIED (flow restarts). WooCommerce also creates a REST API key.
 * initialSync(storeId, { onProgress }) -> { storeId, channel, newOrders, orderIds }
 *   WooCommerce first sync imports 12 orders (1 with a problematic address); other channels 0-3.
 * syncStore(storeId, { onProgress }) -> { storeId, channel, newOrders, orderIds }
 * syncAllStores({ onProgress }) -> [{ storeId, channel, name, newOrders, orderIds }]   connected stores only
 *   New orders come from a seeded generator (deterministic per store and sync count), pass address
 *   validation and are inserted at the top of the orders list (flag `justSynced: true` for highlight).
 * updateStoreSettings(id, patch) -> Store   patch: { autoPull, frequency: '15m'|'1h', writeBackTracking, statusMap, skuMap }
 * disconnectStore(id) -> Store              orders are kept and flagged storeDisconnected: true
 *
 * listSyncLogs({ store?, result?, op?, q?, limit? }) -> SyncLog[] newest first
 *   SyncLog = { id, at, store (channel), op: 'order_pull'|'tracking_push'|'status_update'|'inventory',
 *               result: 'success'|'warning'|'error', detail: {tr,en}, orderId?, trackingNo?, retryable?, attempts?,
 *               resolvedAt?, retryOf? }
 * retrySync(logId) -> { log, original }     re-runs a failed job; the error log gets resolvedAt,
 *                                           a new success log is added (tracking pushes update the order)
 *
 * Internal (used by shipments.js):
 *   scheduleTrackingWriteBack(orderId, shipmentId, delayMs = 2000) -> void
 *   nextFormattedId(prefix) -> 'SYN-0081' style id using counters.formats
 */
import { toRaw } from 'vue'
import { request, ApiError, runSteps } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { insertOrderRecord } from './orders.js'
import { mulberry32, hashSeed, randInt, pick } from '../ai/prng.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(toRaw(v))))
const nowIso = () => new Date().toISOString()

export const STORE_CHANNELS = ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce']
const BASE_PERMS = ['read_orders', 'read_products', 'write_products', 'read_customers', 'write_fulfillments']
export const CHANNEL_META = {
  shopify: { name: 'Shopify', input: 'shopUrl', permissions: BASE_PERMS },
  etsy: { name: 'Etsy', input: null, permissions: BASE_PERMS },
  amazon: { name: 'Amazon', input: 'region', permissions: BASE_PERMS },
  ebay: { name: 'eBay', input: null, permissions: BASE_PERMS },
  woocommerce: { name: 'WooCommerce', input: 'siteUrl', permissions: BASE_PERMS },
}

export function nextFormattedId(prefix) {
  const raw = db.nextId(prefix)
  const n = Number(raw.split('-').pop())
  const f = db.doc('counters')?.formats?.[prefix]
  const m = f && f.match(/\{n:(\d+)\}/)
  return m ? `${prefix}-${String(n).padStart(Number(m[1]), '0')}` : raw
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

function storeByChannel(channel) { return db.all('stores').find(s => s.channel === channel) }

function enrich(store) {
  const logs = db.all('sync_logs').filter(l => l.store === store.channel)
  const unresolved = logs.filter(l => l.result === 'error' && !l.resolvedAt).length
  // "Hata" only while the store's most recent sync job failed and was not retried
  const latest = logs.reduce((m, l) => (!m || l.at > m.at ? l : m), null)
  return {
    ...plain(store),
    health: store.status !== 'connected' ? 'off' : latest && latest.result === 'error' && !latest.resolvedAt ? 'error' : 'ok',
    unresolvedErrors: unresolved,
    orderCount: db.all('orders').filter(o => o.channel === store.channel).length,
  }
}

export function listStores() {
  return request('GET /v1/stores', () => db.all('stores').map(enrich), { minMs: 300, maxMs: 600 })
}

export function getStore(id) {
  return request(`GET /v1/stores/${id}`, () => {
    const s = db.get('stores', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Store not found', 404)
    const recentLogs = db.all('sync_logs').filter(l => l.store === s.channel).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)
    return { ...enrich(s), recentLogs: plain(recentLogs) }
  }, { minMs: 250, maxMs: 500 })
}

export function validateStoreInput(channel, input = {}) {
  const errors = {}
  if (!CHANNEL_META[channel]) errors.channel = 'invalid'
  if (channel === 'shopify') {
    const v = String(input.shopUrl ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!v) errors.shopUrl = 'required'
    else if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v)) errors.shopUrl = 'shopify_domain'
  }
  if (channel === 'woocommerce') {
    const v = String(input.siteUrl ?? '').trim()
    if (!v) errors.siteUrl = 'required'
    else if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(v)) errors.siteUrl = 'https_url'
  }
  if (channel === 'amazon' && (input.region ?? 'US') !== 'US') errors.region = 'region'
  return { valid: Object.keys(errors).length === 0, errors }
}

const sessions = new Map()

export function startStoreConnection(channel, input = {}) {
  return request(`POST /v1/stores/${channel}/oauth/start`, () => {
    const v = validateStoreInput(channel, input)
    if (!v.valid) throw new ApiError('VALIDATION', 'Invalid store details', 422, v.errors)
    const existing = storeByChannel(channel)
    if (existing?.status === 'connected') throw new ApiError('STORE_ALREADY_CONNECTED', 'Store already connected', 409)
    const sessionId = 'oa_' + Math.random().toString(36).slice(2, 10)
    const domain = channel === 'shopify' ? String(input.shopUrl).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      : channel === 'woocommerce' ? String(input.siteUrl).trim().replace(/\/$/, '') : null
    sessions.set(sessionId, { channel, input: plain(input), domain, at: Date.now() })
    return { sessionId, channel, permissions: CHANNEL_META[channel].permissions, requiresApiKey: channel === 'woocommerce', store: { name: domain ?? CHANNEL_META[channel].name, domain } }
  }, { minMs: 500, maxMs: 900 })
}

export function authorizeStoreConnection(sessionId, { approve = true } = {}) {
  return request('POST /v1/stores/oauth/callback', () => {
    const sess = sessions.get(sessionId)
    if (!sess) throw new ApiError('SESSION_EXPIRED', 'Authorization session expired', 410)
    sessions.delete(sessionId)
    const { channel, domain } = sess
    if (!approve) {
      audit('store.oauth_denied', channel)
      throw new ApiError('OAUTH_DENIED', 'Authorization was denied', 403)
    }
    const at = nowIso()
    let store = storeByChannel(channel)
    const patch = {
      status: 'connected', connectedAt: at, lastSyncAt: null, disconnectedAt: null,
      scopes: CHANNEL_META[channel].permissions,
      settings: { autoPull: true, frequency: '15m', writeBackTracking: true, statusMap: [], skuMap: [], ...(store?.settings ?? {}), autoPull: true },
    }
    if (channel === 'shopify') Object.assign(patch, { shopDomain: domain, name: store?.name ?? domain.replace('.myshopify.com', '') })
    if (channel === 'woocommerce') Object.assign(patch, { siteUrl: domain, name: domain.replace(/^https:\/\//, ''), consumerKeyMasked: 'ck_••••' + Math.random().toString(16).slice(2, 6) })
    if (channel === 'amazon') Object.assign(patch, { marketplace: sess.input.region ?? 'US' })
    if (store) store = db.update('stores', store.id, patch)
    else store = db.insert('stores', { id: `ST-${channel.toUpperCase()}`, channel, orders30d: 0, ...patch }, { prepend: false })
    // orders from a previously disconnected store are live again
    for (const o of db.all('orders')) if (o.channel === channel && o.storeDisconnected) db.update('orders', o.id, { storeDisconnected: false })
    audit('store.connect', store.id, CHANNEL_META[channel].name)
    notify({ type: 'success', title: { tr: `${CHANNEL_META[channel].name} mağazanız bağlandı`, en: `Your ${CHANNEL_META[channel].name} store is connected` }, link: '/integrations/stores' })
    return { store: enrich(store), apiKey: channel === 'woocommerce' ? { consumerKeyMasked: store.consumerKeyMasked } : null }
  }, { minMs: 800, maxMs: 1300 })
}

export function updateStoreSettings(id, patch) {
  return request(`PATCH /v1/stores/${id}/settings`, () => {
    const s = db.get('stores', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Store not found', 404)
    if (patch.frequency && !['15m', '1h'].includes(patch.frequency)) throw new ApiError('VALIDATION', 'Invalid frequency', 422, { frequency: 'invalid' })
    const r = db.update('stores', id, { settings: { ...plain(s.settings), ...plain(patch) } })
    audit('store.settings', id, Object.keys(patch).join(', '))
    return enrich(r)
  }, { minMs: 250, maxMs: 500 })
}

export function disconnectStore(id) {
  return request(`DELETE /v1/stores/${id}/connection`, async () => {
    const s = db.get('stores', id)
    if (!s) throw new ApiError('NOT_FOUND', 'Store not found', 404)
    if (s.status !== 'connected') throw new ApiError('STORE_NOT_CONNECTED', 'Store is not connected', 409)
    await db.transaction(() => {
      db.update('stores', id, { status: 'not_connected', disconnectedAt: nowIso(), settings: { ...plain(s.settings), autoPull: false } })
      for (const o of db.all('orders')) if (o.channel === s.channel && !o.storeDisconnected) db.update('orders', o.id, { storeDisconnected: true })
    })
    audit('store.disconnect', id, CHANNEL_META[s.channel]?.name)
    notify({ type: 'warning', title: { tr: `${CHANNEL_META[s.channel]?.name} bağlantısı kesildi`, en: `${CHANNEL_META[s.channel]?.name} disconnected` }, body: { tr: 'Mevcut siparişler korunur.', en: 'Existing orders are kept.' }, link: '/integrations/stores' })
    return enrich(db.get('stores', id))
  }, { minMs: 500, maxMs: 900 })
}

// ---------------------------------------------------------------------------
// Order generator (seeded)
// ---------------------------------------------------------------------------

const FIRST = ['Olivia', 'Mateo', 'Harper', 'Ethan', 'Nora', 'Julian', 'Leah', 'Caleb', 'Aria', 'Miles', 'Zoe', 'Adrian', 'Ivy', 'Owen', 'Maya', 'Levi', 'Chloe', 'Isaac', 'Ruby', 'Theo', 'Naomi', 'Elias', 'Stella', 'Rowan', 'Farah', 'Dev', 'Lucia', 'Kenji', 'Amara', 'Tobias']
const LAST = ['Bennett', 'Alvarez', 'Chen', 'Whitaker', 'Okafor', 'Kowalski', 'Sato', 'Reyes', 'Lindqvist', 'Patel', 'Morrison', 'Haddad', 'Fischer', 'Duarte', 'Nakamura', 'Sullivan', 'Mensah', 'Castillo', 'Novak', 'Brooks', 'Iyer', 'Moreau', 'Delgado', 'Holm']
const DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'proton.me']

function channelOrderNo(rng, channel, seq) {
  switch (channel) {
    case 'shopify': return `#${5300 + seq}`
    case 'etsy': return String(3300000000 + randInt(rng, 0, 99999999))
    case 'amazon': return `11${randInt(rng, 1, 4)}-${String(randInt(rng, 0, 9999999)).padStart(7, '0')}-${String(randInt(rng, 0, 9999999)).padStart(7, '0')}`
    case 'ebay': return `${randInt(rng, 10, 27)}-${String(randInt(rng, 0, 99999)).padStart(5, '0')}-${String(randInt(rng, 0, 99999)).padStart(5, '0')}`
    case 'woocommerce': return `WC-${1200 + seq}`
    default: return `EXT-${seq}`
  }
}

function genAddress(rng, { bad = false } = {}) {
  const streets = db.doc('streets') ?? {}
  const known = streets.knownStreets ?? {}
  const cities = db.all('zip_city')
  const keys = Object.keys(known).filter(k => { const [c, st] = k.split('|'); return cities.some(z => z.city === c && z.state === st) })
  const key = keys.length ? pick(rng, keys) : 'Austin|TX'
  const [city, state] = key.split('|')
  const zips = cities.filter(z => z.city === city && z.state === state)
  const z = zips.find(x => x.primary) ?? zips[0] ?? { zip: '78701' }
  const street = pick(rng, known[key] ?? ['Main St'])
  const apt = (streets.apartmentZips ?? []).includes(z.zip)
  let zip = z.zip
  if (bad) {
    // ZIP from a different city in the same state (zip/city mismatch) for the demo problem order
    const other = cities.find(x => x.state === state && x.city !== city) ?? cities.find(x => x.city !== city)
    if (other) zip = other.zip
  }
  return { line1: `${randInt(rng, 12, 4890)} ${street}`, line2: apt ? `Apt ${randInt(rng, 1, 30)}${pick(rng, ['', 'A', 'B', 'C'])}` : '', city, state, zip, country: 'US' }
}

function genOrderInput(rng, channel, seq, opts = {}) {
  const first = pick(rng, FIRST)
  const last = pick(rng, LAST)
  const name = `${first} ${last}`
  const products = db.all('products')
  const nItems = randInt(rng, 1, 3)
  const items = []
  for (let i = 0; i < nItems; i++) {
    const p = pick(rng, products)
    if (items.some(x => x.sku === p.sku)) continue
    items.push({ sku: p.sku, title: p.title?.en ?? p.sku, qty: randInt(rng, 1, 2), unitPrice: p.value, weightLb: p.weightLb, hsCode: p.hsCode })
  }
  const addr = genAddress(rng, opts)
  return {
    channel,
    channelOrderNo: channelOrderNo(rng, channel, seq),
    customer: { name, email: `${first}.${last}${randInt(rng, 1, 99)}@${pick(rng, DOMAINS)}`.toLowerCase(), phone: `+1 (${randInt(rng, 201, 989)}) 555-01${String(randInt(rng, 0, 99)).padStart(2, '0')}` },
    shipTo: { name, company: '', ...addr, residential: true },
    items,
    package: null,
    tags: [],
  }
}

async function pullOrders(store, count, { onProgress, badIndex = -1 } = {}) {
  const n = (store.syncCount ?? 0) + 1
  const rng = mulberry32(hashSeed(`${store.id}:${n}`))
  const ids = []
  const base = db.all('orders').filter(o => o.channel === store.channel).length
  await runSteps(Array.from({ length: count }, (_, i) => async () => {
    const input = genOrderInput(rng, store.channel, base + i + 1, { bad: i === badIndex })
    const o = await insertOrderRecord(input, { channel: store.channel, eventCode: 'synced' })
    db.update('orders', o.id, { justSynced: true, syncedFrom: store.id })
    ids.push(o.id)
  }), onProgress, { stepMs: [60, 120] })
  if (!count) onProgress?.(100, 0)
  const at = nowIso()
  db.update('stores', store.id, { syncCount: n, lastSyncAt: at, orders30d: (store.orders30d ?? 0) + count })
  const name = CHANNEL_META[store.channel]?.name ?? store.channel
  db.insert('sync_logs', {
    id: nextFormattedId('SYN'), at, store: store.channel, op: 'order_pull', result: 'success', count,
    detail: { tr: `${name}: ${count} yeni sipariş çekildi`, en: `${name}: ${count} new orders pulled` },
  })
  // clear the highlight flag a little later
  if (ids.length) setTimeout(() => { for (const id of ids) if (db.get('orders', id)) db.update('orders', id, { justSynced: false }) }, 8000)
  return ids
}

function syncCountFor(store) {
  const n = (store.syncCount ?? 0) + 1
  const rng = mulberry32(hashSeed(`${store.id}:count:${n}`))
  return randInt(rng, 0, 3)
}

export function initialSync(storeId, { onProgress } = {}) {
  return request(`POST /v1/stores/${storeId}/sync`, async () => {
    const s = db.get('stores', storeId)
    if (!s) throw new ApiError('NOT_FOUND', 'Store not found', 404)
    if (s.status !== 'connected') throw new ApiError('STORE_NOT_CONNECTED', 'Store is not connected', 409)
    const isWooFirst = s.channel === 'woocommerce' && !(s.syncCount > 0)
    const count = isWooFirst ? 12 : syncCountFor(s)
    const orderIds = await pullOrders(s, count, { onProgress, badIndex: isWooFirst ? 7 : -1 })
    finishSync(s, orderIds)
    return { storeId, channel: s.channel, newOrders: orderIds.length, orderIds }
  }, { minMs: 400, maxMs: 700 })
}

function finishSync(store, ids) {
  if (!ids.length) return
  const problems = ids.map(id => db.get('orders', id)).filter(o => o && o.addressCheck?.score < 70).length
  const name = CHANNEL_META[store.channel]?.name ?? store.channel
  notify({
    type: problems ? 'warning' : 'info',
    title: { tr: `${name}: ${ids.length} yeni sipariş`, en: `${name}: ${ids.length} new orders` },
    body: problems ? { tr: `${problems} siparişte adres sorunu tespit edildi.`, en: `Address issues detected on ${problems} orders.` } : null,
    link: problems ? '/orders?addressScore=lt70' : '/orders',
  })
  audit('store.sync', store.id, `${ids.length}`)
}

export function syncStore(storeId, opts = {}) { return initialSync(storeId, opts) }

export function syncAllStores({ onProgress } = {}) {
  return request('POST /v1/stores/sync', async () => {
    const stores = db.all('stores').filter(s => s.status === 'connected')
    const out = []
    let i = 0
    for (const s of stores) {
      const count = s.channel === 'woocommerce' && !(s.syncCount > 0) ? 12 : syncCountFor(s)
      const ids = await pullOrders(s, count, {
        badIndex: s.channel === 'woocommerce' && !(s.syncCount > 0) ? 7 : -1,
        onProgress: p => onProgress?.(Math.round(((i + p / 100) / stores.length) * 100), s.channel),
      })
      i++
      onProgress?.(Math.round((i / stores.length) * 100), s.channel)
      out.push({ storeId: s.id, channel: s.channel, name: CHANNEL_META[s.channel]?.name ?? s.channel, newOrders: ids.length, orderIds: ids })
    }
    const all = out.flatMap(r => r.orderIds)
    if (all.length) {
      const problems = all.map(id => db.get('orders', id)).filter(o => o && o.addressCheck?.score < 70).length
      notify({
        type: problems ? 'warning' : 'info',
        title: { tr: `Senkronizasyon: ${all.length} yeni sipariş`, en: `Sync: ${all.length} new orders` },
        body: problems ? { tr: `${problems} siparişte adres sorunu tespit edildi.`, en: `Address issues detected on ${problems} orders.` } : null,
        link: '/orders',
      })
    }
    audit('store.sync_all', null, out.map(r => `${r.channel}:${r.newOrders}`).join(', '))
    return out
  }, { minMs: 300, maxMs: 500 })
}

// ---------------------------------------------------------------------------
// Sync logs
// ---------------------------------------------------------------------------

export function listSyncLogs(p = {}) {
  return request('GET /v1/sync-logs', () => {
    let list = db.all('sync_logs')
    if (p.store) list = list.filter(l => l.store === p.store)
    if (p.result) list = list.filter(l => l.result === p.result)
    if (p.op) list = list.filter(l => l.op === p.op)
    if (p.q) {
      const q = String(p.q).toLowerCase()
      list = list.filter(l => [l.id, l.orderId, l.trackingNo, l.detail?.tr, l.detail?.en].some(v => String(v ?? '').toLowerCase().includes(q)))
    }
    list = [...list].sort((a, b) => b.at.localeCompare(a.at))
    return p.limit ? list.slice(0, p.limit) : list
  }, { minMs: 250, maxMs: 550 })
}

function channelName(ch) { return CHANNEL_META[ch]?.name ?? ch }

export function retrySync(logId) {
  return request(`POST /v1/sync-logs/${logId}/retry`, async () => {
    const log = db.get('sync_logs', logId)
    if (!log) throw new ApiError('NOT_FOUND', 'Log not found', 404)
    if (log.result !== 'error' || log.resolvedAt) throw new ApiError('NOT_RETRYABLE', 'Nothing to retry', 409)
    const store = storeByChannel(log.store)
    if (!store || store.status !== 'connected') throw new ApiError('STORE_NOT_CONNECTED', 'Store is not connected', 409)
    const at = nowIso()
    const name = channelName(log.store)
    const detail = {
      order_pull: { tr: `${name}: yeniden denendi, belirteç yenilendi, siparişler çekildi`, en: `${name}: retried, token refreshed, orders pulled` },
      tracking_push: { tr: `${name}: yeniden denendi, takip no yazıldı: ${log.trackingNo ?? '-'}`, en: `${name}: retried, tracking number written: ${log.trackingNo ?? '-'}` },
      status_update: { tr: `${name}: yeniden denendi, sipariş durumu güncellendi`, en: `${name}: retried, order status updated` },
      inventory: { tr: `${name}: yeniden denendi, stok güncellendi`, en: `${name}: retried, inventory updated` },
    }[log.op] ?? { tr: `${name}: yeniden denendi, başarılı`, en: `${name}: retried, success` }
    const res = await db.transaction(() => {
      const original = db.update('sync_logs', logId, { resolvedAt: at, attempts: (log.attempts ?? 1) + 1 })
      const entry = db.insert('sync_logs', { id: nextFormattedId('SYN'), at, store: log.store, op: log.op, result: 'success', retryOf: logId, orderId: log.orderId ?? null, trackingNo: log.trackingNo ?? null, attempts: (log.attempts ?? 1) + 1, detail })
      if (log.op === 'tracking_push' && log.orderId) {
        const o = db.get('orders', log.orderId)
        if (o) db.update('orders', o.id, { trackingSyncedAt: at, events: [...(o.events ?? []), { at, code: 'tracking_synced', detail: { channel: log.store, trackingNo: log.trackingNo } }] })
      }
      return { log: entry, original }
    })
    audit('sync.retry', logId, log.op)
    return plain(res)
  }, { minMs: 700, maxMs: 1200 })
}

// ---------------------------------------------------------------------------
// Tracking write-back (called by shipments.createShipment)
// ---------------------------------------------------------------------------

export function scheduleTrackingWriteBack(orderId, shipmentId, delayMs = 2000) {
  const order = db.get('orders', orderId)
  if (!order) return
  const store = storeByChannel(order.channel)
  if (!store || store.status !== 'connected' || store.settings?.writeBackTracking === false) return
  setTimeout(() => {
    const o = db.get('orders', orderId)
    const s = db.get('shipments', shipmentId)
    if (!o || !s || s.status === 'voided' || o.shipmentId !== shipmentId) return
    const at = nowIso()
    const name = channelName(order.channel)
    db.insert('sync_logs', {
      id: nextFormattedId('SYN'), at, store: order.channel, op: 'tracking_push', result: 'success', orderId, trackingNo: s.trackingNo,
      detail: { tr: `Takip no ${name}'a yazıldı: ${s.trackingNo}`, en: `Tracking number written to ${name}: ${s.trackingNo}` },
    })
    db.update('orders', orderId, { trackingSyncedAt: at, events: [...(o.events ?? []), { at, code: 'tracking_synced', detail: { channel: order.channel, trackingNo: s.trackingNo } }] })
  }, delayMs)
}
