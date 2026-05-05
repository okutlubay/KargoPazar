<script setup lang="ts">
import { computed } from 'vue';
import { t, currentLang } from '../i18n';
import Icons from './Icons.vue';

const lang = computed(() => currentLang.value);
</script>

<template>
  <section class="section-sm" :style="{
    position: 'relative',
    overflow: 'hidden',
    background: 'var(--ink-1)',
    color: 'var(--bg)',
  }">
    <div :style="{
      position: 'absolute',
      inset: 0,
      opacity: 0.5,
      backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
      backgroundSize: '48px 48px',
    }" />
    <div class="container" style="position: relative; text-align: center;">
      <h2 class="h-1" style="color: var(--bg); margin: 0 auto 16px; max-width: 720px;">
        {{ lang === 'tr' ? 'Bugün başlayın, yarın gönderin.' : 'Start today, ship tomorrow.' }}
      </h2>
      <p class="lede" style="color: oklch(0.78 0.01 265); max-width: 600px; margin: 0 auto 28px;">
        {{ lang === 'tr' ? '14 gün ücretsiz. Kredi kartı gerekmez. İptal etmek için sadece bir tık.' : '14 days free. No credit card. One click to cancel.' }}
      </p>
      <div class="row" style="justify-content: center; gap: 12px;">
        <a href="#contact" class="btn btn-accent btn-lg">
          {{ lang === 'tr' ? 'Ücretsiz başla' : 'Start free' }}
          <Icons name="arrow" />
        </a>
        <a href="#calc" class="btn btn-lg" :style="{
          background: 'transparent',
          color: 'var(--bg)',
          border: '1px solid rgba(255,255,255,0.2)',
        }">
          {{ lang === 'tr' ? 'Fiyat hesapla' : 'Calculate rate' }}
        </a>
      </div>
    </div>
  </section>
</template>
