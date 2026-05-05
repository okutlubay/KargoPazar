<template>
  <footer class="footer">
    <div class="container">
      <div class="footer-top">
        <div class="footer-brand">
          <div class="row" style="gap: 10px; align-items: center;">
            <Icons name="logo" :size="28" />
            <span class="brand-text">kargopazaryeri</span>
          </div>
          <p class="tagline">{{ t?.footer.tagline }}</p>
        </div>

        <div class="footer-columns">
          <div class="footer-col">
            <h4 class="col-title">{{ t?.footer.product }}</h4>
            <ul class="col-links">
              <li><a href="#product">{{ lang === 'tr' ? 'Özellikler' : 'Features' }}</a></li>
              <li><a href="#calc">{{ lang === 'tr' ? 'Fiyatlandırma' : 'Pricing' }}</a></li>
              <li><a href="#dashboard">{{ lang === 'tr' ? 'Panel' : 'Dashboard' }}</a></li>
            </ul>
          </div>

          <div class="footer-col">
            <h4 class="col-title">{{ t?.footer.company }}</h4>
            <ul class="col-links">
              <li><a href="#about">{{ lang === 'tr' ? 'Hakkımızda' : 'About' }}</a></li>
              <li><a href="#contact">{{ lang === 'tr' ? 'İletişim' : 'Contact' }}</a></li>
              <li><a href="#">{{ lang === 'tr' ? 'Blog' : 'Blog' }}</a></li>
            </ul>
          </div>

          <div class="footer-col">
            <h4 class="col-title">{{ t?.footer.legal }}</h4>
            <ul class="col-links">
              <li><a href="#">{{ lang === 'tr' ? 'Gizlilik' : 'Privacy' }}</a></li>
              <li><a href="#">{{ lang === 'tr' ? 'Şartlar' : 'Terms' }}</a></li>
              <li><a href="#">{{ lang === 'tr' ? 'Çerezler' : 'Cookies' }}</a></li>
            </ul>
          </div>
        </div>
      </div>

      <hr class="divider" />

      <div class="footer-bottom">
        <p class="copyright">{{ t?.footer.copyright }}</p>
        <div class="badge-ai">
          <Icons name="spark" :size="12" />
          {{ t?.footer.teknopark }}
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t, currentLang } from '../i18n';
import Icons from './Icons.vue';

const lang = computed(() => currentLang.value);
</script>

<style scoped>
.footer {
  background: var(--bg-2);
  border-top: 1px solid var(--line-1);
  padding: 64px 0 32px;
}

.footer-top {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 64px;
  margin-bottom: 48px;
}

.footer-brand {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.brand-text {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.02em;
}

.tagline {
  color: var(--ink-3);
  font-size: 14px;
  max-width: 280px;
}

.footer-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 48px;
}

.col-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  margin-bottom: 16px;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.col-links {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.col-links a {
  font-size: 14px;
  color: var(--ink-2);
  transition: color 0.2s ease;
}

.col-links a:hover {
  color: var(--ink-1);
}

.footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 32px;
}

.copyright {
  font-size: 13px;
  color: var(--ink-3);
}

@media (max-width: 860px) {
  .footer-top {
    grid-template-columns: 1fr;
    gap: 48px;
  }

  .footer-columns {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 24px;
  }

  .footer-bottom {
    flex-direction: column;
    gap: 16px;
    align-items: flex-start;
  }
}
</style>
