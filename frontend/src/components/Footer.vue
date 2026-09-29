<script setup>
import { computed, inject } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import Wordmark from './Wordmark.vue'

const { t, f } = useI18n()
const legal = inject('kpzLegal')

/* global __APP_VERSION__, __BUILD_DATE__ */
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'
const buildDate = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '-'

const productLinks = computed(() => {
  const l = t.value.footer.links
  return [['#product', l.features], ['#calc', l.calc], ['#integrations', l.integrations], ['#ai', l.ai], ['#dashboard', l.dashboard]]
})
const companyLinks = computed(() => {
  const l = t.value.footer.links
  return [['#about', l.about], ['#contact', l.contact]]
})
const panelLinks = computed(() => {
  const l = t.value.footer.links
  return [[APP_LINKS.demo, l.demo], [APP_LINKS.login, l.login], [APP_LINKS.signup, l.signup], [APP_LINKS.track, l.track]]
})
const legalDocs = ['privacy', 'terms', 'kvkk', 'cookies']
</script>

<template>
  <footer class="footer">
    <div class="container">
      <div class="grid">
        <div class="col brand-col">
          <a href="#top" aria-label="KargoPazar"><Wordmark /></a>
          <p class="tagline">{{ t.footer.tagline }}</p>
          <span class="pill teknopark"><span class="dot" />{{ t.footer.teknopark }}</span>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.product }}</div>
          <a v-for="[h, l] in productLinks" :key="h" :href="h" class="flink">{{ l }}</a>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.resources }}</div>
          <a v-for="[h, l] in panelLinks" :key="h" :href="h" class="flink">{{ l }}</a>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.company }}</div>
          <a v-for="[h, l] in companyLinks" :key="h" :href="h" class="flink">{{ l }}</a>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.legal }}</div>
          <button v-for="d in legalDocs" :key="d" type="button" class="flink linkbtn" @click="legal.open(d)">{{ t.legal.names[d] }}</button>
        </div>
      </div>

      <div class="bottom">
        <span class="mono copy">{{ t.footer.copyright }}</span>
        <span class="mono build">{{ f(t.footer.build, { version, date: buildDate }) }}</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer { border-top: 1px solid var(--line-1); background: var(--bg-2); padding: 56px 0 32px; }
.grid { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr 1fr; gap: 32px; }
.brand-col { gap: 12px; }
.tagline { font-size: 13px; color: var(--ink-3); margin: 0; max-width: 280px; line-height: 1.55; }
.teknopark { align-self: flex-start; }
.fcol { gap: 10px; align-items: flex-start; }
.col-title { font-size: 11px; color: var(--ink-3); letter-spacing: 0.08em; text-transform: uppercase; }
.flink { font-size: 13.5px; color: var(--ink-2); }
.flink:hover { color: var(--ink-1); }
.linkbtn { background: none; border: 0; padding: 0; font: inherit; font-size: 13.5px; cursor: pointer; text-align: left; }

.bottom {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 48px; padding-top: 24px;
  border-top: 1px solid var(--line-1);
}
.copy { font-size: 11.5px; color: var(--ink-3); }
.build { font-size: 11px; color: var(--ink-4); }

@media (max-width: 960px) {
  .grid { grid-template-columns: 1fr 1fr 1fr; }
  .brand-col { grid-column: 1 / -1; }
}
@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr 1fr; }
  .bottom { flex-direction: column; align-items: flex-start; }
}
</style>
