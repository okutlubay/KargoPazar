// Panel side of the display currency (see shared/currency.js for the API).
//
//   import { fx, displayCurrency, rate, toDisplay, fromDisplay, setPanelCurrency } from '@/app/store/currency.js'
//
// After login the display currency follows user.preferences.currency and the rates follow the
// `fx` document ({ base: 'USD', date, rates: { USD, TRY, EUR, GBP }, source }). Before login the
// value stored by the landing page (localStorage kpz_demo:currency) is used.
import { watch } from 'vue'
import { db } from './db.js'
import { session } from './session.js'
import { fx, setDisplayCurrency, setRates, setStyle, CURRENCIES } from '@/shared/currency.js'

export * from '@/shared/currency.js'

watch(() => session.user?.preferences?.currency, cur => {
  if (CURRENCIES.includes(cur)) setDisplayCurrency(cur)
}, { immediate: true })

watch(() => session.user?.preferences?.currencyDisplay, s => setStyle(s), { immediate: true })

watch(() => (session.user ? JSON.stringify(db.doc('fx') ?? null) : null), json => {
  if (json) setRates(JSON.parse(json))
}, { immediate: true })

/** Topbar selector: switch the display currency and keep it in the user preferences. */
export function setPanelCurrency(cur) {
  if (!CURRENCIES.includes(cur)) return
  setDisplayCurrency(cur)
  if (session.user && db.ready) {
    const u = db.doc('user')
    if (u.preferences?.currency !== cur) db.patchDoc('user', { preferences: { ...(u.preferences ?? {}), currency: cur } })
  }
}
