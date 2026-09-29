<script setup>
// Model activity list (trainings, predictions, user corrections, approvals).
//   <ModelActivityLog :limit="20" />                 all modules with a module filter
//   <ModelActivityLog module="address" :limit="8" />  one module, no filter
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import SegmentedControl from '../SegmentedControl.vue'
import EmptyState from '../EmptyState.vue'
import Skeleton from '../Skeleton.vue'
import { useI18n } from '../../i18n/index.js'
import { useModelActivity, eventText, kindIcon, MODULES } from './activity.js'

const props = defineProps({
  limit: { type: Number, default: 20 },
  module: { type: String, default: null },
  loading: { type: Boolean, default: false },
  showFilter: { type: Boolean, default: true },
})

const { t, tx, fmt } = useI18n()
const filter = ref('all')
const activeModule = computed(() => props.module || (filter.value === 'all' ? null : filter.value))
const events = useModelActivity({ limit: computed(() => props.limit), module: activeModule })
const options = computed(() => [{ value: 'all', label: t('common.all') }, ...MODULES.map(m => ({ value: m, label: t(`aiHub.modules.${m}.short`) }))])
const toneOf = kind => ({ train: 'accent', predict: 'info', feedback: 'warning', approve: 'success', accept: 'success', override: 'neutral' }[kind] || 'neutral')
</script>

<template>
  <div class="mal">
    <div v-if="!module && showFilter" class="filter">
      <SegmentedControl v-model="filter" :options="options" size="sm" :aria-label="t('aiHub.activity.filter')" />
    </div>
    <div v-if="loading" class="rows"><Skeleton v-for="i in 5" :key="i" variant="lines" :lines="1" /></div>
    <EmptyState v-else-if="!events.length" compact icon="brain" :title="t('aiHub.activity.empty')" :description="t('aiHub.activity.emptyDesc')" />
    <ol v-else class="rows">
      <li v-for="ev in events" :key="ev.id" class="row">
        <span :class="['ic', toneOf(ev.kind)]"><Icon :name="kindIcon(ev.kind)" :size="13" /></span>
        <div class="body">
          <div class="line">
            <span class="tag mod">{{ t(`aiHub.modules.${ev.module}.short`) }}</span>
            <span class="kind">{{ t(`aiHub.activity.kinds.${ev.kind}`) }}</span>
          </div>
          <div class="text">{{ eventText(ev, { t, tx, fmt }) }}</div>
        </div>
        <time class="when" :title="fmt.dateTime(ev.at)">{{ fmt.relative(ev.at) }}</time>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.filter { margin-bottom: 12px; overflow-x: auto; }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.row { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: start; padding: 9px 4px; border-bottom: 1px solid var(--line-1); }
.row:last-child { border-bottom: 0; }
.ic { width: 26px; height: 26px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-3); color: var(--ink-2); }
.ic.accent { background: var(--accent-soft); color: var(--accent-ink); }
.ic.info { background: oklch(0.95 0.03 230); color: oklch(0.42 0.1 235); }
.ic.warning { background: oklch(0.96 0.06 80); color: oklch(0.45 0.1 70); }
.ic.success { background: oklch(0.95 0.05 155); color: oklch(0.4 0.1 155); }
.line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mod { height: 20px; font-size: 11px; }
.kind { font-size: 12px; color: var(--ink-3); }
.text { font-size: 13.5px; color: var(--ink-1); margin-top: 2px; line-height: 1.45; word-break: break-word; }
.when { font-size: 12px; color: var(--ink-3); white-space: nowrap; padding-top: 3px; }
</style>
