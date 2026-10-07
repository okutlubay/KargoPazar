<script setup>
// Presentation-mode strip for the R&D work package walkthrough (spec 10.5).
// Visible when presentation mode is on and the current route is one of the active
// roadmap item's demo screens: "İP3 · <item name> · ← Ar-Ge listesine dön · Sonraki kalem →".
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { t, tx } from '../i18n/index.js'
import { presentation, activeItem, matchesItem, nextItem, prevItem, openItem, roadmapItems, setPresentation, linkPath } from './admin/presentation.js'

const route = useRoute()
const router = useRouter()

const item = computed(() => (presentation.on ? activeItem() : null))
const visible = computed(() => !!item.value && matchesItem(item.value, route.path))
const items = computed(() => roadmapItems())
const index = computed(() => items.value.findIndex(x => x.id === item.value?.id))
const isLast = computed(() => index.value === items.value.length - 1)
const links = computed(() => item.value?.demoLinks ?? [])
const activeLink = computed(() => links.value.findIndex(l => linkPath(l) === route.path))

function back() { router.push({ path: '/admin/rnd', hash: item.value ? `#${item.value.id}` : '' }) }
function exit() { setPresentation(false); router.push('/admin/rnd') }
</script>

<template>
  <div v-if="visible" data-testid="presentation-bar" class="pbar" role="navigation" :aria-label="t('rnd.bar.aria')">
    <div class="pb-left">
      <span class="wp mono">{{ item.wpLabel }}</span>
      <span class="dot">·</span>
      <span class="no mono">{{ item.no }}/{{ items.length }}</span>
      <span class="name" :title="tx(item.name)">{{ tx(item.name) }}</span>
      <span v-if="links.length > 1" class="screens">
        <button
          v-for="(l, i) in links" :key="l.path"
          :class="['scr', { on: i === activeLink }]"
          :aria-current="i === activeLink ? 'page' : undefined"
          @click="openItem(router, item.id, i)"
        >{{ tx(l.label) }}</button>
      </span>
    </div>
    <div class="pb-right">
      <button class="pb-btn" @click="back">{{ t('rnd.bar.back') }}</button>
      <button class="pb-btn" :disabled="index <= 0" :aria-label="t('rnd.bar.prev')" @click="prevItem(router)"><Icon name="chevron-left" :size="12" /></button>
      <button class="pb-btn strong" @click="nextItem(router)">
        {{ isLast ? t('rnd.bar.finish') : t('rnd.bar.next') }}
      </button>
      <button class="pb-btn icon" :aria-label="t('rnd.bar.exit')" :title="t('rnd.bar.exit')" @click="exit"><Icon name="x" :size="12" /></button>
    </div>
  </div>
</template>

<style scoped>
.pbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 6px 20px; background: var(--ink-1); color: var(--bg); font-size: 12.5px; position: sticky; top: 56px; z-index: 19; }
.pb-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; flex-wrap: wrap; }
.wp { background: var(--accent); color: white; padding: 1px 7px; border-radius: 5px; font-size: 11px; font-weight: 600; }
.dot { opacity: .5; }
.no { opacity: .7; font-size: 11.5px; }
.name { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; }
.screens { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.scr { border: 1px solid color-mix(in oklch, var(--bg) 30%, transparent); background: transparent; color: inherit; border-radius: 999px; height: 22px; padding: 0 9px; font-size: 11.5px; opacity: .8; }
.scr:hover { opacity: 1; }
.scr.on { background: var(--bg); color: var(--ink-1); opacity: 1; }
.pb-right { display: flex; align-items: center; gap: 6px; }
.pb-btn { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 7px; border: 1px solid color-mix(in oklch, var(--bg) 25%, transparent); background: transparent; color: inherit; font-size: 12.5px; font-weight: 500; }
.pb-btn:hover:not(:disabled) { background: color-mix(in oklch, var(--bg) 14%, transparent); }
.pb-btn:disabled { opacity: .4; cursor: not-allowed; }
.pb-btn.strong { background: var(--bg); color: var(--ink-1); border-color: transparent; }
.pb-btn.strong:hover { background: color-mix(in oklch, var(--bg) 88%, transparent); }
.pb-btn.icon { width: 26px; padding: 0; justify-content: center; }
@media (max-width: 860px) { .pbar { padding: 6px 12px; } .name { max-width: 100%; white-space: normal; } }
</style>
