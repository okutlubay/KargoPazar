// Entry of the standalone legal pages. Each page's index.html sets data-doc on #app.
import { createApp } from 'vue'
import LegalPage from './LegalPage.vue'
import { LEGAL_DOCS } from './content.js'
import '../styles.css'

const el = document.getElementById('app')
const doc = LEGAL_DOCS.includes(el.dataset.doc) ? el.dataset.doc : 'privacy'
createApp(LegalPage, { doc }).mount(el)
