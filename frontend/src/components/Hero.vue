<template>
  <section id="top" class="hero">
    <div class="grid-bg" />
    <div class="glow" />

    <div class="container" style="position: relative; z-index: 1; padding-top: 80px; padding-bottom: 96px;">
      <div class="hero-content">
        <span class="pill fade-up">
          <Icons name="spark" :size="14" />
          {{ t?.hero?.pill }}
        </span>

        <h1 class="h-display fade-up" style="animation-delay: 0.05s;">
          <template v-for="(line, i) in lines" :key="i">
            <span v-if="i === 1" class="accent">{{ line }}</span>
            <span v-else>{{ line }}</span>
            <br v-if="i < 2" />
          </template>
        </h1>

        <p class="lede fade-up" style="animation-delay: 0.1s; max-width: 680px;">
          {{ t?.hero?.sub }}
        </p>

        <div class="row fade-up" style="gap: 12px; animation-delay: 0.15s; flex-wrap: wrap; justify-content: center;">
          <a href="#calc" class="btn btn-primary btn-lg">
            {{ t?.hero?.cta1 }}
            <Icons name="arrow" :size="14" />
          </a>
          <a href="#dashboard" class="btn btn-ghost btn-lg">
            ▶ {{ t?.hero?.cta2 }}
          </a>
        </div>

        <div class="mono fade-up" style="font-size: 12px; color: var(--ink-3); animation-delay: 0.2s;">
          {{ t?.hero?.meta }}
        </div>
      </div>

      <div class="fade-up" style="margin-top: 64px; animation-delay: 0.25s;">
        <HeroProduct />
      </div>
    </div>

    <LogoCloud />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import Icons from './Icons.vue';
import HeroProduct from './HeroProduct.vue';
import LogoCloud from './LogoCloud.vue';

const lines = computed(() => {
  const strings = t.value as any;
  return (strings?.hero?.title || '').split('\n');
});
</script>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  padding-top: 32px;
  padding-bottom: 0;
}

.grid-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-image: linear-gradient(to right, oklch(0.92 0.005 265 / 0.5) 1px, transparent 1px),
    linear-gradient(to bottom, oklch(0.92 0.005 265 / 0.5) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%);
}

.glow {
  position: absolute;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: 900px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(ellipse, oklch(0.85 0.10 268 / 0.35), transparent 60%);
  z-index: 0;
  pointer-events: none;
}

.hero-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 24px;
  max-width: 880px;
  margin: 0 auto;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.accent {
  color: var(--accent-ink);
}
</style>
