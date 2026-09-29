<script setup>
// Page title area: breadcrumb (from route meta), title, subtitle, primary actions (#actions slot).
//   <PageHeader :title="t('nav.orders')" :subtitle="..."><template #actions>...</template></PageHeader>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  crumbs: { type: Array, default: null }, // [{ label, to }]
  badge: { type: String, default: '' },
})

const route = useRoute()
const router = useRouter()

const trail = computed(() => {
  if (props.crumbs) return props.crumbs
  const out = []
  const g = route.meta.group
  if (g) out.push({ label: t(`nav.groups.${g}`) })
  const parent = route.meta.parent && router.getRoutes().find(r => r.name === route.meta.parent)
  if (parent) out.push({ label: t(parent.meta.title), to: { name: parent.name } })
  return out
})
</script>

<template>
  <header class="ph">
    <div class="left">
      <nav v-if="trail.length" class="crumbs" aria-label="breadcrumb">
        <template v-for="(c, i) in trail" :key="i">
          <RouterLink v-if="c.to" :to="c.to" class="crumb link-crumb">{{ c.label }}</RouterLink>
          <span v-else class="crumb">{{ c.label }}</span>
          <Icon name="chevron-right" :size="11" class="sep" />
        </template>
      </nav>
      <div class="title-row">
        <h1 class="title">{{ title }}</h1>
        <span v-if="badge" class="badge-ai">{{ badge }}</span>
        <slot name="title-extra" />
      </div>
      <p v-if="subtitle" class="sub">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.ph { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.left { min-width: 0; }
.crumbs { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-3); margin-bottom: 6px; flex-wrap: wrap; }
.sep { color: var(--ink-4); }
.link-crumb:hover { color: var(--ink-1); }
.title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.title { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 24px; letter-spacing: -0.02em; line-height: 1.2; }
.sub { margin: 4px 0 0; color: var(--ink-3); font-size: 14px; max-width: 760px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
