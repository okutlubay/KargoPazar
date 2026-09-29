<script setup>
import { computed } from 'vue'
import Card from '../Card.vue'
import { useI18n } from '../../i18n/index.js'

const { t } = useI18n()
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const mod = isMac ? '⌘' : 'Ctrl'

const groups = computed(() => [
  { key: 'global', items: [
    { id: 'palette', keys: [[mod, 'K']] },
    { id: 'newShipment', keys: [['N']] },
    { id: 'search', keys: [['/']] },
    { id: 'close', keys: [['Esc']] },
  ] },
  { key: 'navigation', items: [
    { id: 'orders', keys: [['G'], ['O']], sequence: true },
    { id: 'shipments', keys: [['G'], ['S']], sequence: true },
  ] },
  { key: 'lists', items: [
    { id: 'rowOpen', keys: [['Enter']] },
    { id: 'tabs', keys: [['←'], ['→']], alt: true },
    { id: 'paletteNav', keys: [['↑'], ['↓']], alt: true },
  ] },
])
</script>

<template>
  <Card :title="t('settings.shortcuts.title')" :subtitle="t('settings.shortcuts.desc')">
    <div class="groups">
      <section v-for="g in groups" :key="g.key">
        <h3 class="gt">{{ t('settings.shortcuts.groups.' + g.key) }}</h3>
        <ul class="list">
          <li v-for="it in g.items" :key="it.id">
            <span class="desc">{{ t('settings.shortcuts.items.' + it.id) }}</span>
            <span class="keys">
              <template v-for="(combo, ci) in it.keys" :key="ci">
                <span v-if="ci > 0" class="sep">{{ it.sequence ? t('settings.shortcuts.then') : it.alt ? '/' : '+' }}</span>
                <kbd v-for="k in combo" :key="k">{{ k }}</kbd>
              </template>
            </span>
          </li>
        </ul>
      </section>
    </div>
    <template #footer>
      <div class="note">{{ t('settings.shortcuts.note') }}</div>
    </template>
  </Card>
</template>

<style scoped>
.groups { display: grid; gap: 24px; }
.gt { font-family: var(--font-display); font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .05em; }
.list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line-1); border-radius: 10px; }
.list li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--line-1); }
.list li:first-child { border-top: 0; }
.desc { font-size: 13.5px; }
.keys { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.sep { font-size: 12px; color: var(--ink-4); margin: 0 2px; }
kbd { font-family: var(--font-mono); font-size: 12px; min-width: 26px; height: 24px; padding: 0 7px; display: inline-grid; place-items: center; border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 6px; background: var(--surface); color: var(--ink-1); }
.note { font-size: 12.5px; color: var(--ink-3); }
</style>
