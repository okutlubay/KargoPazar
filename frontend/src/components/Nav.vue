<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import Icon from './Icon.vue'
import Wordmark from './Wordmark.vue'

const { t, lang, setLang } = useI18n()
const scrolled = ref(false)
const open = ref(false)

const links = computed(() => [
  { href: '#product', label: t.value.nav.product },
  { href: '#calc', label: t.value.nav.pricing },
  { href: '#integrations', label: t.value.nav.integrations },
  { href: '#ai', label: t.value.nav.ai },
  { href: '#about', label: t.value.nav.about },
  { href: '#contact', label: t.value.nav.contact },
])

const onScroll = () => { scrolled.value = window.scrollY > 8 }
const onKey = (e) => { if (e.key === 'Escape') open.value = false }
const onResize = () => { if (window.innerWidth > 860) open.value = false }

watch(open, (v) => { document.body.style.overflow = v ? 'hidden' : '' })

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  onScroll()
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  document.body.style.overflow = ''
})
</script>

<template>
  <header :class="['nav', { scrolled: scrolled || open }]">
    <div class="container nav-inner">
      <a href="#top" aria-label="KargoPazar"><Wordmark /></a>
      <nav class="links hide-md">
        <a v-for="l in links" :key="l.href" :href="l.href" class="nav-link">{{ l.label }}</a>
        <a :href="APP_LINKS.demo" class="nav-link demo-link"><span class="live-dot" />{{ t.nav.demo }}</a>
      </nav>
      <div class="actions">
        <div class="lang-toggle" role="group" :aria-label="t.nav.language">
          <button
            v-for="l in ['tr', 'en']"
            :key="l"
            type="button"
            :class="{ active: lang === l }"
            :aria-pressed="lang === l"
            @click="setLang(l)"
          >{{ l }}</button>
        </div>
        <a :href="APP_LINKS.login" class="btn btn-ghost btn-sm hide-sm">{{ t.nav.login }}</a>
        <a :href="APP_LINKS.signup" class="btn btn-primary btn-sm hide-xs">{{ t.nav.signup }}<Icon name="arrow" /></a>
        <button
          type="button"
          class="burger show-md"
          :aria-label="open ? t.nav.closeMenu : t.nav.menu"
          :aria-expanded="open"
          @click="open = !open"
        >
          <Icon :name="open ? 'x' : 'menu'" :size="18" />
        </button>
      </div>
    </div>

    <div v-if="open" class="mobile-panel show-md">
      <div class="container mobile-inner">
        <a v-for="l in links" :key="l.href" :href="l.href" class="m-link" @click="open = false">{{ l.label }}</a>
        <a :href="APP_LINKS.demo" class="m-link demo-link"><span class="live-dot" />{{ t.nav.demo }}</a>
        <div class="m-actions">
          <a :href="APP_LINKS.login" class="btn btn-ghost">{{ t.nav.login }}</a>
          <a :href="APP_LINKS.signup" class="btn btn-primary">{{ t.nav.signup }}<Icon name="arrow" /></a>
        </div>
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
  background: rgba(254, 254, 252, 0.9);
  backdrop-filter: saturate(1.4) blur(12px);
  -webkit-backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--line-1);
}
.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  gap: 12px;
}
.links { display: flex; align-items: center; gap: 2px; }
.nav-link {
  padding: 8px 11px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-2);
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}
.nav-link:hover { color: var(--ink-1); background: var(--bg-2); }
.demo-link { display: inline-flex; align-items: center; gap: 7px; color: var(--accent-ink); font-weight: 600; }
.live-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--success); box-shadow: 0 0 0 3px oklch(0.62 0.13 155 / 0.18); }
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
  cursor: pointer;
}
.lang-toggle button.active { background: var(--ink-1); color: var(--bg); }
.burger {
  width: 36px; height: 36px;
  border: 1px solid var(--line-2); border-radius: 8px;
  background: var(--surface); color: var(--ink-1);
  display: none; align-items: center; justify-content: center; cursor: pointer;
}
.mobile-panel { border-top: 1px solid var(--line-1); background: var(--bg); max-height: calc(100vh - 64px); overflow-y: auto; }
.mobile-inner { display: flex; flex-direction: column; padding-top: 12px; padding-bottom: 20px; gap: 2px; }
.m-link { padding: 12px 4px; font-size: 16px; font-weight: 500; color: var(--ink-1); border-bottom: 1px solid var(--line-1); }
.m-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
.m-actions .btn { justify-content: center; }
.show-md { display: none; }

@media (max-width: 1080px) {
  .nav-link { padding: 8px 8px; font-size: 13.5px; }
}
@media (max-width: 860px) {
  .burger { display: inline-flex; }
  .show-md { display: block; }
  .burger.show-md { display: inline-flex; }
}
@media (max-width: 420px) {
  .hide-xs { display: none !important; }
}
</style>
