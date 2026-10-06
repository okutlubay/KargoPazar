<script setup>
// Top level tabs of the Customs menu: Information Center (default) and customs operations.
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useI18n } from '../../i18n/index.js'

const { t } = useI18n()
const route = useRoute()
const TABS = [
  { name: 'customs-info', icon: 'info', label: 'customsInfo.nav.info' },
  { name: 'customs', icon: 'shield', label: 'customsInfo.nav.ops' },
]
</script>

<template>
  <nav class="cnt" :aria-label="t('nav.groups.customs')" data-testid="customs-nav-tabs">
    <RouterLink v-for="tb in TABS" :key="tb.name" :to="{ name: tb.name }" :class="['ct', { on: route.name === tb.name }]" :aria-current="route.name === tb.name ? 'page' : undefined" :data-testid="'customs-nav-' + tb.name">
      <Icon :name="tb.icon" :size="14" />{{ t(tb.label) }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.cnt { display: inline-flex; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); margin-bottom: 14px; flex-wrap: wrap; }
.ct { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: calc(var(--r-md) - 2px); font-size: 13px; color: var(--ink-2); text-decoration: none; }
.ct:hover { color: var(--ink-1); }
.ct.on { background: var(--surface); color: var(--ink-1); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
</style>
