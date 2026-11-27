<script setup>
import { computed } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import Wordmark from './Wordmark.vue'
import { LEGAL_DOCS as legalDocs, LEGAL_PATHS } from '../legal/content.js'

const { t, f } = useI18n()

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
          <a v-for="d in legalDocs" :key="d" :href="LEGAL_PATHS[d]" class="flink">{{ t.legal.names[d] }}</a>
        </div>
      </div>

      <div class="bottom">
        <span class="col legal-lines">
          <span class="mono copy">{{ t.footer.copyright }}</span>
          <span class="mono build">{{ t.footer.address }}</span>
          <span class="mono build">{{ t.footer.tax }}</span>
          <span class="build trademark">{{ t.footer.etsy }} {{ t.footer.etsyLocal }}</span>
        </span>
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
.trademark { margin-top: 6px; max-width: 760px; line-height: 1.5; }

.bottom {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 48px; padding-top: 24px;
  border-top: 1px solid var(--line-1);
}
.copy { font-size: 11.5px; color: var(--ink-3); }
.legal-lines { gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.build { font-size: 11px; color: var(--ink-4); }

@media (max-width: 960px) {
  .grid { grid-template-columns: 1fr 1fr 1fr; }
  .brand-col { grid-column: 1 / -1; }
}
/* Touch layouts: 44px tap targets for footer links. */
@media (max-width: 860px) {
  .fcol { gap: 0; }
  .flink { display: inline-flex; align-items: center; min-height: 44px; }
}
@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr 1fr; }
  .bottom { flex-direction: column; align-items: flex-start; }
}
</style>
