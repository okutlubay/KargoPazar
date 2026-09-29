import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import i18n, { locale } from './i18n/index.js'
import { db } from './store/db.js'
import { loadSession } from './store/session.js'
import '../styles.css'
import './app.css'

document.body.classList.add('app-body')
document.documentElement.lang = locale.value

async function boot() {
  await db.init()
  loadSession()
  const app = createApp(App)
  app.use(i18n)
  app.use(router)
  await router.isReady().catch(() => {})
  app.mount('#app')
}

boot()
