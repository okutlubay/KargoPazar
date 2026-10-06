// Display helpers for offers (panel). Texts come from the compare i18n module.
import { t, locale } from '../../i18n/index.js'
import { formatParams } from '../../api/quotePros.js'

export function offerTitle(o) {
  if (!o) return ''
  if (o.kind === 'package') return t('compare.card.packageTitle', { point: o.originPoint || o.origin, hub: o.hub, service: o.serviceLabel || o.serviceName })
  return o.serviceName
}

export function offerSub(o) {
  if (!o) return ''
  if (o.kind === 'package') return o.subLabel || t('compare.card.packageSub', { carrier: o.carrierName || '-' })
  if (o.source === 'own') return t('compare.card.ownAccount', { carrier: o.carrierName, masked: o.accountLabel || '' })
  if (o.kind === 'direct' && !o.hub) return t('compare.card.directSub')
  return t('compare.card.hubSub', { hub: o.hub || o.origin, carrier: o.carrierName })
}

export function itemText(it) {
  return t(`compare.${it.sign === '+' ? 'pros' : 'cons'}.${it.code}`, formatParams(it.params, locale.value))
}

export function daysText(o) {
  if (!o) return '-'
  return o.etaMinDays === o.etaMaxDays ? t('compare.card.daysOne', { n: o.etaMaxDays }) : t('compare.card.days', { min: o.etaMinDays, max: o.etaMaxDays })
}

export function summaryText(s, offers) {
  const o = (offers || []).find(x => x.key === s.key)
  const pro = s.pro ? itemText(s.pro) : ''
  return t('compare.summary.' + s.code, formatParams({ ...s.params, name: o ? offerTitle(o) : s.params?.name, pro: pro ? pro.charAt(0).toLocaleLowerCase(locale.value) + pro.slice(1) : '' }, locale.value))
}
