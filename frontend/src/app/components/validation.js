// Form validation helpers shared by FormField / AddressForm / PackageForm and screens.
//
// A rule is `value => true | 'error message'` (message already translated).
// Rule factories translate lazily at validation time, so locale switches are respected.
import { t } from '@/app/i18n/index.js'

const isEmpty = v => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export function required(message) {
  return v => (isEmpty(v) || v === false ? message || t('common.validation.required') : true)
}

export function email(message) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  return v => (isEmpty(v) || re.test(String(v).trim()) ? true : message || t('common.validation.email'))
}

/** Numeric minimum (value must be a number >= n). Empty values pass (combine with required()). */
export function min(n, message) {
  return v => {
    if (isEmpty(v)) return true
    const num = Number(v)
    if (Number.isNaN(num)) return t('common.validation.number')
    return num >= n ? true : message || t('common.validation.min', { n })
  }
}

/** Numeric maximum. */
export function max(n, message) {
  return v => {
    if (isEmpty(v)) return true
    const num = Number(v)
    if (Number.isNaN(num)) return t('common.validation.number')
    return num <= n ? true : message || t('common.validation.max', { n })
  }
}

/** Minimum string length. */
export function minLength(n, message) {
  return v => (isEmpty(v) || String(v).trim().length >= n ? true : message || t('components.validation.minLength', { n }))
}

/** Must be a number (empty passes). */
export function number(message) {
  return v => (isEmpty(v) || !Number.isNaN(Number(v)) ? true : message || t('common.validation.number'))
}

/** Regex rule. `key` is an i18n key for the message (default common.validation.format). */
export function pattern(re, key = 'common.validation.format', params) {
  const rx = typeof re === 'string' ? new RegExp(re, 'i') : re
  return v => (isEmpty(v) || rx.test(String(v).trim()) ? true : t(key, params))
}

/** Run rules in order, return the first error message or ''. */
export function runRules(rules, value) {
  for (const rule of rules || []) {
    if (typeof rule !== 'function') continue
    const res = rule(value)
    if (res !== true && res != null && res !== '') return typeof res === 'string' ? res : t('common.validation.format')
  }
  return ''
}

function flatten(refs) {
  const out = []
  const seen = new Set()
  const walk = (r, depth = 0) => {
    if (!r || typeof r !== 'object' || depth > 4 || seen.has(r)) return
    seen.add(r)
    if (Array.isArray(r)) return r.forEach(x => walk(x, depth + 1))
    if (typeof r.validate === 'function') return out.push(r)
    if ('$el' in r || (typeof Element !== 'undefined' && r instanceof Element)) return
    if ('value' in r && r.value && typeof r.value === 'object') return walk(r.value, depth + 1)
    Object.values(r).forEach(x => walk(x, depth + 1))
  }
  walk(refs)
  return out
}

/**
 * Validate every field (FormField, AddressForm, PackageForm or anything exposing
 * `validate(): boolean`, optional `focus()` and `el`). Scrolls to and focuses the first
 * invalid one. Accepts an array, an object map, template refs or v-for ref arrays.
 * Returns true when everything is valid.
 */
export function validateAll(refs, { scroll = true } = {}) {
  const fields = flatten(refs)
  let first = null
  for (const f of fields) {
    const ok = f.validate()
    if (!ok && !first) first = f
  }
  if (first && scroll) {
    const el = first.el?.value ?? first.el ?? first.$el
    try { el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }) } catch { /* ignore */ }
    setTimeout(() => first.focus?.({ preventScroll: true }), 0)
  }
  return !first
}
