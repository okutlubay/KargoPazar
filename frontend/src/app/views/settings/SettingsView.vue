<script setup>
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import { useI18n } from '@/app/i18n/index.js'
import ProfileSection from '@/app/components/settings/ProfileSection.vue'
import CompanySection from '@/app/components/settings/CompanySection.vue'
import UnitsSection from '@/app/components/settings/UnitsSection.vue'
import PresetsSection from '@/app/components/settings/PresetsSection.vue'
import NotificationsSection from '@/app/components/settings/NotificationsSection.vue'
import SecuritySection from '@/app/components/settings/SecuritySection.vue'
import RulesSection from '@/app/components/settings/RulesSection.vue'
import TeamSection from '@/app/components/settings/TeamSection.vue'
import AuditSection from '@/app/components/settings/AuditSection.vue'
import ShortcutsSection from '@/app/components/settings/ShortcutsSection.vue'
import DemoDataSection from '@/app/components/settings/DemoDataSection.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const GROUPS = [
  { key: 'account', items: [
    { key: 'profile', icon: 'user', comp: ProfileSection },
    { key: 'company', icon: 'warehouse', comp: CompanySection },
    { key: 'units', icon: 'scale', comp: UnitsSection },
    { key: 'presets', icon: 'box', comp: PresetsSection },
    { key: 'notifications', icon: 'bell', comp: NotificationsSection },
    { key: 'security', icon: 'shield', comp: SecuritySection },
  ] },
  { key: 'enterprise', items: [
    { key: 'rules', icon: 'route', comp: RulesSection },
    { key: 'team', icon: 'users', comp: TeamSection },
    { key: 'audit', icon: 'list', comp: AuditSection },
  ] },
  { key: 'system', items: [
    { key: 'shortcuts', icon: 'keyboard', comp: ShortcutsSection },
    { key: 'demo', icon: 'database', comp: DemoDataSection },
  ] },
]
const ALL = GROUPS.flatMap(g => g.items)

const current = computed(() => ALL.find(s => s.key === route.params.section) ?? null)

watch(() => route.params.section, s => {
  if (route.name !== 'settings') return
  if (!s || !ALL.some(x => x.key === s)) router.replace({ name: 'settings', params: { section: 'profile' } })
}, { immediate: true })

watch(current, c => {
  if (c) document.title = `${t('settings.sections.' + c.key)} · ${t('nav.settings')} · KargoPazar`
}, { immediate: true })
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.settings')" :subtitle="t('settings.subtitle')" />
    <div class="layout">
      <nav class="subnav" :aria-label="t('settings.navAria')">
        <div v-for="g in GROUPS" :key="g.key" class="sg">
          <div class="sg-title mono">{{ t('settings.groups.' + g.key) }}</div>
          <RouterLink
            v-for="s in g.items" :key="s.key"
            :to="{ name: 'settings', params: { section: s.key } }"
            :class="['si', { active: current?.key === s.key }]"
            :aria-current="current?.key === s.key ? 'page' : undefined"
          >
            <Icon :name="s.icon" :size="14" />
            <span>{{ t('settings.sections.' + s.key) }}</span>
          </RouterLink>
        </div>
      </nav>
      <section class="body">
        <component :is="current.comp" v-if="current" :key="current.key" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; align-items: start; }
.subnav { position: sticky; top: 76px; display: flex; flex-direction: column; gap: 14px; }
.sg-title { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); padding: 0 10px 6px; }
.si { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: 8px; color: var(--ink-2); font-size: 13.5px; font-weight: 500; }
.si:hover { background: var(--surface); color: var(--ink-1); }
.si.active { background: var(--surface); color: var(--accent-ink); box-shadow: var(--shadow-sm); border: 1px solid var(--line-1); }
.body { min-width: 0; }
@media (max-width: 1024px) {
  .layout { grid-template-columns: 1fr; }
  .subnav { position: static; flex-direction: row; overflow-x: auto; gap: 4px; padding-bottom: 4px; }
  .sg { display: contents; }
  .sg-title { display: none; }
  .si { flex: none; white-space: nowrap; }
}
</style>
