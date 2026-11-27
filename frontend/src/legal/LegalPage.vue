<script setup>
// Full page legal text (/gizlilik/, /kvkk/, /kullanim-sartlari/, /cerez-politikasi/).
// Same content as the landing LegalModal, with a light header/footer and a TR/EN toggle.
import { computed, watch } from 'vue'
import { provideI18n } from '../i18n.js'
import { PLATFORM_COMPANY as CO, taxLine } from '../shared/company.js'
import Wordmark from '../components/Wordmark.vue'
import LegalBody from './LegalBody.vue'
import { LEGAL_DOCS, LEGAL_PATHS, LEGAL_UPDATED } from './content.js'

const props = defineProps({ doc: { type: String, required: true } })
const { t, lang, setLang, f } = provideI18n()

const legal = computed(() => t.value.legal)
const content = computed(() => legal.value[props.doc])
const updated = computed(() => LEGAL_UPDATED.toLocaleDateString(lang.value === 'tr' ? 'tr-TR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }))

// provideI18n sets the landing title/description on language change; this watcher runs after it.
watch(lang, () => {
  document.title = `${content.value.title} | KargoPazar`
  const d = document.querySelector('meta[name="description"]')
  if (d) d.setAttribute('content', content.value.description)
}, { immediate: true })
</script>

<template>
  <header class="lp-head">
    <div class="container lp-head-inner">
      <a href="/" aria-label="KargoPazar"><Wordmark /></a>
      <div class="lang" role="group" :aria-label="t.nav.language">
        <button v-for="l in ['tr', 'en']" :key="l" type="button" :class="['lang-btn', { on: lang === l }]" :aria-pressed="lang === l" @click="setLang(l)">{{ l.toUpperCase() }}</button>
      </div>
    </div>
  </header>

  <main class="container lp-main">
    <nav class="lp-tabs" :aria-label="legal.others">
      <a v-for="d in LEGAL_DOCS" :key="d" :href="LEGAL_PATHS[d]" :class="['lp-tab', { active: d === doc }]" :aria-current="d === doc ? 'page' : null">{{ legal.names[d] }}</a>
    </nav>
    <article class="lp-card">
      <h1 class="h-2 lp-title">{{ content.title }}</h1>
      <p class="mono lp-updated">{{ f(legal.updated, { date: updated }) }}</p>
      <LegalBody :body="content.body" />
    </article>
    <a href="/" class="lp-back">← {{ legal.back }}</a>
  </main>

  <footer class="lp-foot">
    <div class="container lp-foot-inner">
      <span class="mono">{{ t.footer.copyright }}</span>
      <span class="mono">{{ CO.addressLine }} · {{ CO.phone }} · {{ CO.email }}</span>
      <span class="mono">{{ taxLine(lang) }}</span>
    </div>
  </footer>
</template>

<style scoped>
.lp-head { border-bottom: 1px solid var(--line-1); background: var(--surface); }
.lp-head-inner { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 64px; }
.lang { display: inline-flex; border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden; }
.lang-btn { height: 30px; min-width: 40px; padding: 0 10px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.lang-btn.on { background: var(--ink-1); color: var(--bg); }

.lp-main { padding-top: 32px; padding-bottom: 48px; max-width: 820px; }
.lp-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.lp-tab { height: 32px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; font-size: 13px; font-weight: 500; color: var(--ink-2); border: 1px solid var(--line-1); background: var(--surface); }
.lp-tab:hover { background: var(--bg-2); }
.lp-tab.active { background: var(--ink-1); color: var(--bg); border-color: var(--ink-1); }
.lp-card { background: var(--surface); border: 1px solid var(--line-1); border-radius: 14px; padding: 28px 32px; }
.lp-title { margin: 0 0 4px; }
.lp-updated { margin: 0 0 20px; font-size: 12px; color: var(--ink-3); }
.lp-back { display: inline-block; margin-top: 20px; font-size: 13.5px; color: var(--accent-ink); }

.lp-foot { border-top: 1px solid var(--line-1); background: var(--bg-2); padding: 24px 0; }
.lp-foot-inner { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--ink-3); overflow-wrap: anywhere; }

@media (max-width: 560px) {
  .lp-card { padding: 20px 18px; }
  .lp-main { padding-top: 20px; }
}
</style>
