<template>
  <header :style="headerStyle">
    <div class="container spread" style="height: 64px;">
      <a href="#top" class="row" style="gap: 10px; align-items: center;">
        <Icons name="logo" :size="28" />
        <span class="logo-text">kargopazaryeri</span>
      </a>

      <nav class="row hide-md" style="gap: 4px;">
        <a
          v-for="link in navLinks"
          :key="link.href"
          :href="link.href"
          class="nav-link"
        >
          {{ link.label }}
        </a>
      </nav>

      <div class="row" style="gap: 8px;">
        <LangToggle />
        <a href="#dashboard" class="btn btn-ghost btn-sm hide-sm">{{ t?.nav?.login }}</a>
        <a href="#contact" class="btn btn-primary btn-sm">
          {{ t?.nav?.signup }}
          <Icons name="arrow" :size="14" />
        </a>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Icons from './Icons.vue';
import LangToggle from './LangToggle.vue';
import { t } from '../i18n';

const scrolled = ref(false);

const navLinks = computed(() => {
  const strings = t.value;
  if (!strings || !strings.nav) return [];
  return [
    { href: '#product', label: strings.nav.product },
    { href: '#integrations', label: strings.nav.integrations },
    { href: '#ai', label: strings.nav.ai },
    { href: '#calc', label: strings.nav.pricing },
    { href: '#about', label: strings.nav.about },
    { href: '#contact', label: strings.nav.contact },
  ];
});

const headerStyle = computed(() => ({
  position: 'sticky' as const,
  top: 0,
  zIndex: 50,
  background: scrolled.value ? 'rgba(254, 254, 252, 0.85)' : 'transparent',
  backdropFilter: scrolled.value ? 'saturate(1.4) blur(12px)' : 'none',
  WebkitBackdropFilter: scrolled.value ? 'saturate(1.4) blur(12px)' : 'none',
  borderBottom: scrolled.value ? '1px solid var(--line-1)' : '1px solid transparent',
  transition: 'background 0.2s, border-color 0.2s',
} as any));

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => {
    scrolled.value = window.scrollY > 8;
  }, { passive: true });
}
</script>

<style scoped>
.logo-text {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.02em;
  color: var(--ink-1);
}

.nav-link {
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-2);
  border-radius: 6px;
  transition: color 0.2s ease;
}

.nav-link:hover {
  color: var(--ink-1);
}
</style>
