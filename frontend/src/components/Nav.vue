<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import Wordmark from './Wordmark.vue'

const { t, lang, setLang } = useI18n()
const scrolled = ref(false)

const links = computed(() => [
  { href: '#product', label: t.value.nav.product },
  { href: '#integrations', label: t.value.nav.integrations },
  { href: '#ai', label: t.value.nav.ai },
  { href: '#calc', label: t.value.nav.pricing },
  { href: '#about', label: t.value.nav.about },
  { href: '#contact', label: t.value.nav.contact },
])

const onScroll = () => { scrolled.value = window.scrollY > 8 }

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header :class="['nav', { scrolled }]">
    <div class="container nav-inner">
      <a href="#top" aria-label="kargopazar"><Wordmark /></a>
      <nav class="links hide-md">
        <a v-for="l in links" :key="l.href" :href="l.href" class="nav-link">{{ l.label }}</a>
      </nav>
      <div class="actions">
        <div class="lang-toggle">
          <button
            v-for="l in ['tr', 'en']"
            :key="l"
            :class="{ active: lang === l }"
            @click="setLang(l)"
          >{{ l }}</button>
        </div>
        <a href="#dashboard" class="btn btn-ghost btn-sm hide-sm">{{ t.nav.login }}</a>
        <a href="#contact" class="btn btn-primary btn-sm">{{ t.nav.signup }}<Icon name="arrow" /></a>
      </div>
    </div>
  </header>
</template>

<style scoped>
.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: transparent;
  border-bottom: 1px solid transparent;
  transition: background 0.2s, border-color 0.2s;
}
.nav.scrolled {
  background: rgba(254, 254, 252, 0.85);
  backdrop-filter: saturate(1.4) blur(12px);
  -webkit-backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--line-1);
}
.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}
.links { display: flex; align-items: center; gap: 4px; }
.nav-link {
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-2);
  border-radius: 6px;
  transition: color 0.15s;
}
.nav-link:hover { color: var(--ink-1); }
.actions { display: flex; align-items: center; gap: 8px; }
.lang-toggle {
  display: flex;
  align-items: center;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  padding: 2px;
  background: var(--surface);
  height: 32px;
}
.lang-toggle button {
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-family: var(--font-mono);
  background: transparent;
  color: var(--ink-3);
  border: 0;
  border-radius: 6px;
}
.lang-toggle button.active {
  background: var(--ink-1);
  color: var(--bg);
}
</style>
