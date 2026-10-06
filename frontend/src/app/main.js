import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import i18n, { locale } from './i18n/index.js'
import { db } from './store/db.js'
import { session, loadSession, clearSession } from './store/session.js'
import './store/currency.js'
import '../styles.css'
import './app.css'

document.body.classList.add('app-body')
document.documentElement.lang = locale.value

async function boot() {
  // A stored, unexpired token loads the whole state from the API before the first render.
  // Without a session only the public pages (login, signup, track) are reachable.
  if (loadSession()) {
    try {
      await db.init()
    } catch (e) {
      if (e?.status === 401) clearSession()
      else {
        // Server unreachable: keep the stored token for the next reload, show the login screen.
        session.username = null
        session.bootError = 'offline'
      }
      db.unload()
    }
  }
  const app = createApp(App)
  app.use(i18n)
  app.use(router)
  await router.isReady().catch(() => {})
  app.mount('#app')
}

boot()
