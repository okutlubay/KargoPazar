// Small helpers shared by the integrations screens.
import { CHANNEL_META } from '../../api/integrations.js'
import { t, locale } from '../../i18n/index.js'
import trMsgs from '../../i18n/tr.js'
import enMsgs from '../../i18n/en.js'

/** true when an i18n key exists (avoids dev "missing key" warnings when probing) */
export function hasKey(key) {
  let cur = locale.value === 'en' ? enMsgs : trMsgs
  for (const part of key.split('.')) { if (cur == null) return false; cur = cur[part] }
  return typeof cur === 'string'
}

export function channelName(ch) { return CHANNEL_META[ch]?.name ?? ch }

/** Second line of a store card: domain, shop name, seller id ... */
export function storeIdentity(s) {
  if (!s) return ''
  switch (s.channel) {
    case 'shopify': return s.shopDomain ?? ''
    case 'etsy': return s.shopName ?? s.name ?? ''
    case 'amazon': return s.sellerId ? `${t('integrations.stores.sellerId')} ${s.sellerId.slice(0, 4)}… · ${s.marketplace ?? 'US'}` : (s.marketplace ? `${t('integrations.stores.marketplace')} ${s.marketplace}` : '')
    case 'ebay': return s.username ?? s.name ?? ''
    case 'woocommerce': return s.siteUrl ?? ''
    default: return s.name ?? ''
  }
}

/** StatusPill code for a store: connected | error | disconnected | not_connected */
export function storeStatus(s) {
  if (!s) return 'not_connected'
  if (s.status === 'connected') return s.health === 'error' ? 'error' : 'connected'
  return 'not_connected'
}

export function errorMessage(e) {
  if (!e) return t('common.errorGeneric')
  if (hasKey('integrations.errors.' + e.code)) return t('integrations.errors.' + e.code)
  if (hasKey('core.errors.' + e.code)) return t('core.errors.' + e.code)
  return e.message || t('common.errorGeneric')
}

export function fieldError(code) {
  if (!code) return ''
  if (hasKey('integrations.validation.' + code)) return t('integrations.validation.' + code)
  if (hasKey('core.validation.' + code)) return t('core.validation.' + code)
  return t('common.validation.format')
}

export const INTERNAL_STATUSES = ['awaiting_shipment', 'on_hold', 'labeled', 'shipped', 'delivered', 'cancelled']
