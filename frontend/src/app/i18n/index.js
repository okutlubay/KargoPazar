// App i18n. Messages live in ./modules/<area>.js files, each exporting
// `export default { tr: { <namespace>: {...} }, en: { <namespace>: {...} } }`.
// All modules are deep-merged into tr.js / en.js bundles.
//
// Usage in components:
//   const { t, tx, locale, fmt } = useI18n()
//   t('orders.title')                 -> string
//   t('orders.count', { n: 5 })       -> "{n} sipariş" interpolation
//   tx({ tr: '..', en: '..' })        -> localized seed field
//   fmt.money(12.5), fmt.dateTime(iso), fmt.weight(lb) ...
import { ref, computed } from 'vue'
import tr from './tr.js'
import en from './en.js'
import * as F from '@/shared/format.js'
import { fx, toDisplay, isConvertible } from '@/shared/currency.js'

const MESSAGES = { tr, en }
const LANG_KEY = 'kpz_demo:lang'

function initialLocale() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'tr' || saved === 'en') return saved
  } catch {}
  return 'tr'
}

export const locale = ref(initialLocale())

export function setLocale(l) {
  locale.value = l
  try { localStorage.setItem(LANG_KEY, l) } catch {}
  document.documentElement.lang = l
}

const warned = new Set()
function lookup(lang, key) {
  let cur = MESSAGES[lang]
  for (const part of key.split('.')) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

export function t(key, params) {
  let str = lookup(locale.value, key)
  if (str == null) {
    if (import.meta.env.DEV && !warned.has(locale.value + key)) {
      warned.add(locale.value + key)
      console.warn(`[i18n] missing key "${key}" for locale "${locale.value}"`)
    }
    str = lookup(locale.value === 'tr' ? 'en' : 'tr', key) ?? key
  }
  if (typeof str !== 'string') return str
  if (params) str = str.replace(/\{(\w+)\}/g, (m, p) => (params[p] ?? m))
  return str
}

/** Localize a seed field: { tr, en } object or plain string. */
export function tx(v) {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  return v[locale.value] ?? v.en ?? v.tr ?? ''
}

export const fmt = {
  // USD amounts (default) are converted to the display currency; other currencies stay native.
  money: (v, cur = 'USD', d = 2) => (isConvertible(cur)
    ? F.money(v == null ? v : toDisplay(v), locale.value, fx.display, d, fx.style)
    : F.money(v, locale.value, cur, d, fx.style)),
  // No conversion: the value is shown in `cur` as is (customs local values, API contract samples).
  moneyNative: (v, cur = 'USD', d = 2) => F.money(v, locale.value, cur, d, fx.style),
  // "₺5.000,00 (120,19 $)" when the display currency is not USD, else "$120.19".
  moneyDual: (usd, d = 2) => (fx.display === 'USD'
    ? F.money(usd, locale.value, 'USD', d, fx.style)
    : `${F.money(usd == null ? usd : toDisplay(usd), locale.value, fx.display, d, fx.style)} (${F.money(usd, locale.value, 'USD', d, fx.style)})`),
  /** Current display currency code (TRY, USD, EUR, GBP). */
  get currency() { return fx.display },
  number: (v, d = 0) => F.number(v, locale.value, d),
  percent: (v, d = 1) => F.percent(v, locale.value, d),
  weight: (lb, units, d = 1) => F.weight(lb, locale.value, units ?? unitsPref(), d),
  dims: (x, units) => F.dims(x, locale.value, units ?? unitsPref()),
  // Secondary (imperial) equivalent shown next to metric values; '' when imperial is primary.
  weightAlt: (lb, units, d = 1) => ((units ?? unitsPref()) === 'metric' && lb != null && !Number.isNaN(lb) ? F.weight(lb, locale.value, 'imperial', d) : ''),
  dimsAlt: (x, units) => ((units ?? unitsPref()) === 'metric' && x ? F.dims(x, locale.value, 'imperial') : ''),
  // Plain-text dual form for strings: "1,5 kg (3,2 lb)" when metric, "3,2 lb" when imperial.
  weightDual: (lb, units, d = 1) => { const u = units ?? unitsPref(); const p = F.weight(lb, locale.value, u, d); return u === 'metric' && lb != null && !Number.isNaN(lb) ? `${p} (${F.weight(lb, locale.value, 'imperial', d)})` : p },
  dimsDual: (x, units) => { const u = units ?? unitsPref(); const p = F.dims(x, locale.value, u); return u === 'metric' && x ? `${p} (${F.dims(x, locale.value, 'imperial')})` : p },
  date: iso => F.date(iso, locale.value),
  dateTime: iso => F.dateTime(iso, locale.value),
  shortDate: iso => F.shortDate(iso, locale.value),
  relative: iso => F.relative(iso, locale.value),
}

// Units preference hook, set by the session store once the user is loaded.
let unitsGetter = () => 'metric'
export function setUnitsGetter(fn) { unitsGetter = fn }
function unitsPref() { return unitsGetter() }

export function useI18n() {
  return { t, tx, locale, setLocale, fmt, isTr: computed(() => locale.value === 'tr') }
}

// Global plugin: exposes $t / $tx / $fmt in templates.
export default {
  install(app) {
    app.config.globalProperties.$t = t
    app.config.globalProperties.$tx = tx
    app.config.globalProperties.$fmt = fmt
  },
}
