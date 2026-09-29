// Small pure helpers shared by the overview, orders and shipments screens.
import { t, tx, locale } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import trMessages from '../../i18n/tr.js'
import enMessages from '../../i18n/en.js'

/** True when an i18n key exists (no missing key warning). */
export function hasKey(key) {
  let cur = locale.value === 'en' ? enMessages : trMessages
  for (const part of key.split('.')) { if (cur == null) return false; cur = cur[part] }
  return typeof cur === 'string'
}

export const REGION_OF_STATE = {
  CT: 'Northeast', ME: 'Northeast', MA: 'Northeast', NH: 'Northeast', RI: 'Northeast', VT: 'Northeast', NJ: 'Northeast', NY: 'Northeast', PA: 'Northeast', DE: 'Northeast', MD: 'Northeast', DC: 'Northeast',
  AL: 'Southeast', AR: 'Southeast', FL: 'Southeast', GA: 'Southeast', KY: 'Southeast', LA: 'Southeast', MS: 'Southeast', NC: 'Southeast', SC: 'Southeast', TN: 'Southeast', VA: 'Southeast', WV: 'Southeast', PR: 'Southeast',
  IL: 'Midwest', IN: 'Midwest', IA: 'Midwest', KS: 'Midwest', MI: 'Midwest', MN: 'Midwest', MO: 'Midwest', NE: 'Midwest', ND: 'Midwest', OH: 'Midwest', SD: 'Midwest', WI: 'Midwest',
  AZ: 'Southwest', NM: 'Southwest', OK: 'Southwest', TX: 'Southwest',
  AK: 'West', CA: 'West', CO: 'West', HI: 'West', ID: 'West', MT: 'West', NV: 'West', OR: 'West', UT: 'West', WA: 'West', WY: 'West',
}
export const REGIONS = ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West']
export const regionOf = state => REGION_OF_STATE[String(state ?? '').toUpperCase()] ?? 'West'

export function carrierOf(code) { return db.get('carriers', code) ?? null }
export function carrierName(code) { return carrierOf(code)?.name ?? code ?? '-' }
export function serviceOf(carrier, service) { return carrierOf(carrier)?.services?.find(s => s.code === service) ?? null }
export function serviceName(carrier, service) { return serviceOf(carrier, service)?.name ?? service ?? '-' }

const DAY = 86400000
export function daysBetween(a, b) { return (new Date(b).getTime() - new Date(a).getTime()) / DAY }

export function businessDaysBetween(a, b) {
  const d = new Date(a)
  const end = new Date(b)
  d.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  let n = 0
  while (d < end) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++ }
  return n
}

/** On time = business days from carrier pickup to delivery <= service transit days for the zone. */
export function isOnTime(s) {
  if (s.status !== 'delivered' || !s.deliveredAt) return null
  const svc = serviceOf(s.carrier, s.service)
  const transit = svc?.transitDays?.[s.zone] ?? svc?.transitDays?.[String(s.zone)]
  const pick = (s.events ?? []).find(e => e.code === 'picked_up')?.at ?? s.createdAt
  if (transit == null) return s.eta ? new Date(s.deliveredAt) <= new Date(s.eta) : true
  return businessDaysBetween(pick, s.deliveredAt) <= transit
}

/** Label for an address issue: model label ({tr,en}) or the i18n catalogue. */
export function issueText(issue) {
  if (!issue) return ''
  if (issue.label) return tx(issue.label)
  const key = 'aiEngine.address.issues.' + issue.code
  if (!hasKey(key)) return issue.code
  const s = t(key, issue.params ?? {})
  return s.replace(/\{\w+\}/g, '').replace(/\(\s*\)/g, '').replace(/\s+,/g, ',').trim()
}

/** Download text as a file (CSV exports, templates). */
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([mime.startsWith('text/csv') ? '﻿' + text : text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function apiErrorText(e) {
  if (!e) return t('common.errorGeneric')
  const k = 'core.errors.' + e.code
  return hasKey(k) ? t(k, e.details ?? {}) : t('common.errorGeneric')
}

export function fieldErrorText(code) {
  const k = 'core.validation.' + code
  return hasKey(k) ? t(k) : t('common.validation.format')
}

export const addrLine = a => (a ? [a.line1, a.line2].filter(Boolean).join(', ') : '-')
export const cityState = a => (a ? [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '-')
