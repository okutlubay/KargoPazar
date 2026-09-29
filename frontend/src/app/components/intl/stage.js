import { locale } from '@/app/i18n/index.js'
import trB from '@/app/i18n/tr.js'
import enB from '@/app/i18n/en.js'
// Shared helpers for the international screens.
export function stageTone(stage, customsStatus) {
  if (customsStatus === 'docs_requested') return 'danger'
  if (stage === 'completed') return 'success'
  if (stage === 'us_customs') return 'warning'
  if (stage === 'created') return 'neutral'
  return 'info'
}

export const CUSTOMS_TONES = {
  pending: 'neutral', submitted: 'info', docs_requested: 'danger', cleared: 'success',
  created: 'neutral', customs_submitted: 'info', customs_cleared: 'success', handed_over: 'info',
}

/** Read a File as a data URL (small uploads are stored so they can be downloaded again). */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export function fileSize(bytes, fmtNumber) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${fmtNumber(bytes / 1024, 0)} KB`
  return `${fmtNumber(bytes / 1024 / 1024, 1)} MB`
}

/** Localized ApiError message: intl.errors.<code>, then core.errors.<code>, then generic. */
export function hasKey(key) {
  let cur = locale.value === 'en' ? enB : trB
  for (const p of key.split('.')) { if (cur == null) return false; cur = cur[p] }
  return typeof cur === 'string'
}
export function errorText(t, e) {
  const code = e?.code || 'generic'
  for (const ns of ['intl.errors.', 'core.errors.']) {
    if (hasKey(ns + code)) return t(ns + code, e?.details || {})
  }
  return t('common.errorGeneric')
}
