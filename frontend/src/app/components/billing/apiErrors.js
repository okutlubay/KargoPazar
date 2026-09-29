// Translate ApiError codes without triggering missing-key warnings.
//   errorText(e, ['ops.errors'])  -> first existing of ops.errors.<code>, core.errors.<code>, common.errorGeneric
//   fieldError(code)              -> core.validation.<code> or common.validation.<code>
import { t, locale } from '../../i18n/index.js'
import tr from '../../i18n/tr.js'
import en from '../../i18n/en.js'

const BUNDLES = { tr, en }

export function hasKey(key) {
  let cur = BUNDLES[locale.value] ?? tr
  for (const p of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return false
    cur = cur[p]
  }
  return typeof cur === 'string'
}

export function errorText(e, namespaces = [], params = {}) {
  const code = e?.code
  if (code) {
    for (const ns of [...namespaces, 'core.errors']) {
      const k = `${ns}.${code}`
      if (hasKey(k)) return t(k, { ...(e.details ?? {}), ...params })
    }
  }
  return t('common.errorGeneric')
}

export function fieldError(code, params = {}) {
  if (!code) return ''
  for (const ns of ['core.validation', 'common.validation']) {
    const k = `${ns}.${code}`
    if (hasKey(k)) return t(k, params)
  }
  return t('common.validation.format')
}

/** Trigger a browser download for generated text (CSV). */
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
