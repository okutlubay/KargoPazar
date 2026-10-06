// Display currency (landing + panel). Every internal amount is USD; screens convert for display.
//
//   import { fx, displayCurrency, rate, toDisplay, fromDisplay, convert, setDisplayCurrency } from '@/shared/currency.js'
//   rate('TRY')          -> 41.6   (units per 1 USD, demo rate)
//   toDisplay(120.19)    -> 5000   (USD -> display currency)
//   fromDisplay(5000)    -> 120.19 (display currency -> USD)
//   convert(10, 'EUR', 'GBP')
//
// The selected currency is kept in localStorage (kpz_demo:currency) so the landing page and the
// panel login screen agree; after login the panel syncs it with user.preferences.currency and the
// rates with the `fx` document (see app/store/currency.js).
import { reactive, computed } from 'vue'
import { money } from './format.js'

export const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP']
export const CURRENCY_KEY = 'kpz_demo:currency'
export const DEFAULT_CURRENCY = 'TRY'
export const DEFAULT_FX = Object.freeze({
  base: 'USD',
  date: '2026-10-01',
  rates: Object.freeze({ USD: 1, TRY: 41.6, EUR: 0.85, GBP: 0.74 }),
  source: 'demo',
})

function readStored() {
  try {
    const v = localStorage.getItem(CURRENCY_KEY)
    if (CURRENCIES.includes(v)) return v
  } catch {}
  return null
}

export const fx = reactive({
  display: readStored() ?? DEFAULT_CURRENCY,
  /** 'symbol' (₺, $) or 'code' (TRY, USD): user.preferences.currencyDisplay */
  style: 'symbol',
  date: DEFAULT_FX.date,
  source: DEFAULT_FX.source,
  rates: { ...DEFAULT_FX.rates },
})

export const displayCurrency = computed(() => fx.display)

export function setDisplayCurrency(cur, { store = true } = {}) {
  if (!CURRENCIES.includes(cur)) return
  fx.display = cur
  if (store) { try { localStorage.setItem(CURRENCY_KEY, cur) } catch {} }
}

/** Apply an fx document { rates, date, source }. Missing values keep the demo defaults. */
export function setRates(doc) {
  if (!doc || typeof doc !== 'object') return
  if (doc.rates && typeof doc.rates === 'object') {
    const next = { ...DEFAULT_FX.rates }
    for (const [k, v] of Object.entries(doc.rates)) if (Number(v) > 0) next[k] = Number(v)
    next.USD = 1
    fx.rates = next
  }
  if (doc.date) fx.date = doc.date
  if (doc.source) fx.source = doc.source
}

export function setStyle(style) { fx.style = style === 'code' ? 'code' : 'symbol' }

/** Units of `cur` per 1 USD. Unknown currency -> 1. */
export function rate(cur = fx.display) {
  const r = Number(fx.rates[cur])
  return r > 0 ? r : 1
}

/** Convert between any two known currencies through USD. */
export function convert(amount, from = 'USD', to = fx.display) {
  if (amount == null || Number.isNaN(Number(amount))) return amount
  if (from === to) return Number(amount)
  return (Number(amount) / rate(from)) * rate(to)
}

/** USD -> display currency. */
export function toDisplay(usd, cur = fx.display) { return convert(usd, 'USD', cur) }

/** Display currency -> USD. */
export function fromDisplay(amount, cur = fx.display) { return convert(amount, cur, 'USD') }

/** USD amount as display currency text in both languages (stored notification / audit texts). */
export function moneyText(usd, digits = 2) {
  const v = usd == null ? usd : toDisplay(usd)
  return { tr: money(v, 'tr', fx.display, digits), en: money(v, 'en', fx.display, digits) }
}

/** Should a value in `currency` be converted for display? Only USD amounts are converted. */
export function isConvertible(currency) { return !currency || currency === 'USD' }
