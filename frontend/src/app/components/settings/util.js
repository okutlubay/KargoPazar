// Small helpers shared by the settings and admin screens.
import { t, locale } from '../../i18n/index.js'
import tr from '../../i18n/tr.js'
import en from '../../i18n/en.js'

const BUNDLES = { tr, en }

export function hasKey(key) {
  let cur = BUNDLES[locale.value]
  for (const p of key.split('.')) {
    if (cur == null) return false
    cur = cur[p]
  }
  return typeof cur === 'string'
}

/** First existing translation among keys, else the fallback key. */
export function tFirst(keys, params, fallback = 'common.errorGeneric') {
  for (const k of keys) if (hasKey(k)) return t(k, params)
  return t(fallback, params)
}

/** Toast-ready message for an ApiError (or any error). */
export function errorText(e, ns = 'settings') {
  const code = e?.code
  if (!code) return t('common.errorGeneric')
  return tFirst([`${ns}.errors.${code}`, `core.errors.${code}`, `aiModel.errors.${code}`])
}

/** Field message for a validation code from ApiError.details. */
export function fieldText(code, ns = 'settings', params) {
  if (!code) return ''
  return tFirst([`${ns}.validation.${code}`, `core.validation.${code}`, `common.validation.${code}`], params, 'common.validation.format')
}

/** Map ApiError.details ({field: code}) to translated messages. */
export function fieldErrors(e, ns = 'settings') {
  const out = {}
  for (const [k, v] of Object.entries(e?.details ?? {})) out[k] = fieldText(v, ns)
  return out
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function formatBytes(n, fmtNumber) {
  if (n == null) return '-'
  if (n < 1024) return `${fmtNumber(n)} B`
  if (n < 1024 * 1024) return `${fmtNumber(n / 1024, 1)} KB`
  return `${fmtNumber(n / 1024 / 1024, 2)} MB`
}
