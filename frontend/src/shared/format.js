// Shared number / money / weight / date formatting for landing and app.
// TR: "₺1.248,60", "1.248,60 $", "29 Eyl 2026 14:05"   EN: "$1,248.60", "TRY 1,248.60", "Sep 29, 2026 2:05 PM"

const SYMBOLS = { USD: '$', GBP: '£', EUR: '€', TRY: '₺', CAD: 'C$', AUD: 'A$' }

const nfCache = new Map()
function nf(locale, opts) {
  const key = locale + JSON.stringify(opts)
  if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', opts))
  return nfCache.get(key)
}

export function number(value, locale = 'tr', digits = 0) {
  if (value == null || Number.isNaN(value)) return '-'
  return nf(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

// TR: TRY uses a leading symbol ("₺1.248,60"), other currencies a trailing one ("120,19 $").
// EN: USD uses "$1,248.60", other currencies the ISO code prefix ("TRY 1,248.60").
// style 'code' always uses the ISO code (TR "1.248,60 USD", EN "USD 1,248.60").
export function money(value, locale = 'tr', currency = 'USD', digits = 2, style = 'symbol') {
  if (value == null || Number.isNaN(value)) return '-'
  const neg = value < 0
  const body = nf(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value))
  const sign = neg ? '-' : ''
  if (style === 'code') return locale === 'tr' ? sign + body + ' ' + currency : sign + currency + ' ' + body
  if (locale === 'tr') {
    if (currency === 'TRY') return sign + SYMBOLS.TRY + body
    return sign + body + ' ' + (SYMBOLS[currency] || currency)
  }
  if (currency === 'USD') return sign + SYMBOLS.USD + body
  return sign + currency + ' ' + body
}

export function percent(value, locale = 'tr', digits = 1) {
  if (value == null || Number.isNaN(value)) return '-'
  const body = number(value * 100, locale, digits)
  return locale === 'tr' ? '%' + body : body + '%'
}

export const LB_PER_KG = 2.20462
export const IN_PER_CM = 0.393701

export function weight(lb, locale = 'tr', units = 'imperial', digits = 1) {
  if (lb == null || Number.isNaN(lb)) return '-'
  if (units === 'metric') return number(lb / LB_PER_KG, locale, digits) + ' kg'
  return number(lb, locale, digits) + ' lb'
}

export function dims(d, locale = 'tr', units = 'imperial') {
  if (!d) return '-'
  const l = d.lengthIn ?? d.l, w = d.widthIn ?? d.w, h = d.heightIn ?? d.h
  if (units === 'metric') return [l, w, h].map(v => number(v / IN_PER_CM, locale, 0)).join('x') + ' cm'
  return [l, w, h].map(v => number(v, locale, v % 1 ? 1 : 0)).join('x') + ' in'
}

const dfCache = new Map()
function df(locale, opts) {
  const key = locale + JSON.stringify(opts)
  if (!dfCache.has(key)) dfCache.set(key, new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', opts))
  return dfCache.get(key)
}

export function date(iso, locale = 'tr') {
  if (!iso) return '-'
  return df(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function dateTime(iso, locale = 'tr') {
  if (!iso) return '-'
  const d = new Date(iso)
  const time = df(locale, { hour: locale === 'tr' ? '2-digit' : 'numeric', minute: '2-digit', hour12: locale !== 'tr' }).format(d)
  return date(iso, locale) + ' ' + time
}

export function shortDate(iso, locale = 'tr') {
  if (!iso) return '-'
  return df(locale, { day: 'numeric', month: 'short' }).format(new Date(iso))
}

export function relative(iso, locale = 'tr', now = Date.now()) {
  if (!iso) return '-'
  const diff = (new Date(iso).getTime() - now) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month')
  return rtf.format(Math.round(diff / (86400 * 365)), 'year')
}

export function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100
}
