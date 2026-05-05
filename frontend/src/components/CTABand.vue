<script setup>
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'

const { lang } = useI18n()
</script>

<template>
  <section class="cta">
    <div class="grid-bg" />
    <div class="container inner">
      <h2 class="h-1 title">
        {{ lang === 'tr' ? 'Bugün başlayın, yarın gönderin.' : 'Start today, ship tomorrow.' }}
      </h2>
      <p class="lede sub">
        {{ lang === 'tr' ? '14 gün ücretsiz. Kredi kartı gerekmez. İptal etmek için sadece bir tık.' : '14 days free. No credit card. One click to cancel.' }}
      </p>
      <div class="row ctas">
        <a href="#contact" class="btn btn-accent btn-lg">{{ lang === 'tr' ? 'Ücretsiz başla' : 'Start free' }} <Icon name="arrow" /></a>
        <a href="#calc" class="btn btn-lg secondary">{{ lang === 'tr' ? 'Fiyat hesapla' : 'Calculate rate' }}</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cta {
  position: relative; overflow: hidden;
  background: var(--ink-1); color: var(--bg);
  padding: 64px 0;
}
.grid-bg {
  position: absolute; inset: 0; opacity: 0.5;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
}
.inner { position: relative; text-align: center; }
.title { color: var(--bg); margin: 0 auto 16px; max-width: 720px; }
.sub { color: oklch(0.78 0.01 265); max-width: 600px; margin: 0 auto 28px; }
.ctas { justify-content: center; gap: 12px; }
.secondary {
  background: transparent;
  color: var(--bg);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
</style>
