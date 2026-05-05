<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import Wordmark from './Wordmark.vue'

const { t, lang } = useI18n()

const productLinks = computed(() => [
  ['#product', lang.value === 'tr' ? 'Özellikler' : 'Features'],
  ['#calc', lang.value === 'tr' ? 'Fiyat hesapla' : 'Calculator'],
  ['#integrations', lang.value === 'tr' ? 'Entegrasyonlar' : 'Integrations'],
  ['#ai', 'AI'],
  ['#dashboard', 'Dashboard'],
])

const companyLinks = computed(() => [
  ['#about', lang.value === 'tr' ? 'Hakkımızda' : 'About'],
  ['#contact', lang.value === 'tr' ? 'İletişim' : 'Contact'],
  ['#about', lang.value === 'tr' ? 'Kariyer' : 'Careers'],
  ['#about', lang.value === 'tr' ? 'Basın' : 'Press'],
])

const legalLinks = computed(() => [
  ['#', lang.value === 'tr' ? 'Gizlilik' : 'Privacy'],
  ['#', lang.value === 'tr' ? 'Şartlar' : 'Terms'],
  ['#', 'KVKK'],
  ['#', 'Cookies'],
])
</script>

<template>
  <footer class="footer">
    <div class="container">
      <div class="grid">
        <div class="col" style="gap: 12px">
          <a href="#top"><Wordmark /></a>
          <p class="tagline">{{ t.footer.tagline }}</p>
          <span class="pill teknopark"><span class="dot" />{{ t.footer.teknopark }}</span>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.product }}</div>
          <a v-for="[h, l] in productLinks" :key="l" :href="h" class="flink">{{ l }}</a>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.company }}</div>
          <a v-for="[h, l] in companyLinks" :key="l" :href="h" class="flink">{{ l }}</a>
        </div>
        <div class="col fcol">
          <div class="mono col-title">{{ t.footer.legal }}</div>
          <a v-for="[h, l] in legalLinks" :key="l" :href="h" class="flink">{{ l }}</a>
        </div>
      </div>

      <div class="bottom">
        <span class="mono copy">{{ t.footer.copyright }}</span>
        <span class="mono build">v0.9.4-beta · Build 2026.05.02</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer { border-top: 1px solid var(--line-1); background: var(--bg-2); padding: 56px 0 32px; }
.grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 32px; }
.tagline { font-size: 13px; color: var(--ink-3); margin: 0; max-width: 280px; line-height: 1.55; }
.teknopark { align-self: flex-start; }
.fcol { gap: 10px; }
.col-title { font-size: 11px; color: var(--ink-3); letter-spacing: 0.08em; text-transform: uppercase; }
.flink { font-size: 13.5px; color: var(--ink-2); }

.bottom {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 48px; padding-top: 24px;
  border-top: 1px solid var(--line-1);
}
.copy { font-size: 11.5px; color: var(--ink-3); }
.build { font-size: 11px; color: var(--ink-4); }

@media (max-width: 860px) {
  .grid { grid-template-columns: 1fr 1fr; }
  .bottom { flex-direction: column; gap: 12px; align-items: flex-start; }
}
</style>
