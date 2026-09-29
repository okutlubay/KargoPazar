<script setup>
// 10 step first mile stage progress (spec 9.1). compact: thin segmented bar + counter.
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'
import { STAGES } from '@/app/api/intl.js'

const props = defineProps({
  stage: { type: String, required: true },
  history: { type: Array, default: () => [] }, // stageHistory for timestamps
  compact: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false }, // e.g. customs documents requested
})
const { t, fmt } = useI18n()
const idx = computed(() => STAGES.indexOf(props.stage))
const at = s => [...props.history].reverse().find(h => h.stage === s && !h.kind)?.at
function state(i) {
  if (i < idx.value || idx.value === STAGES.length - 1) return 'done'
  if (i === idx.value) return props.blocked ? 'blocked' : 'current'
  return 'todo'
}
</script>

<template>
  <div v-if="compact" class="sp-compact" :title="t('intl.stages.' + stage)">
    <span class="bars" aria-hidden="true">
      <span v-for="(s, i) in STAGES" :key="s" class="b" :class="state(i)" />
    </span>
    <span class="cnt num">{{ idx + 1 }}/{{ STAGES.length }}</span>
  </div>
  <ol v-else class="sp-full" :aria-label="t('intl.detail.progress')">
    <li v-for="(s, i) in STAGES" :key="s" :class="state(i)" :aria-current="i === idx ? 'step' : undefined">
      <span class="mk">
        <Icon v-if="state(i) === 'done'" name="check" :size="11" />
        <Icon v-else-if="state(i) === 'blocked'" name="alert" :size="11" />
        <span v-else class="n num">{{ i + 1 }}</span>
      </span>
      <span class="tx">
        <span class="l">{{ t('intl.stages.' + s) }}</span>
        <span class="d">{{ at(s) ? fmt.shortDate(at(s)) : '' }}</span>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.sp-compact { display: inline-flex; align-items: center; gap: 8px; }
.bars { display: inline-flex; gap: 2px; }
.b { width: 7px; height: 6px; border-radius: 2px; background: var(--line-2); }
.b.done { background: var(--accent-2); }
.b.current { background: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.b.blocked { background: var(--danger); }
.cnt { font-size: 11.5px; color: var(--ink-3); }

.sp-full { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 4px; }
.sp-full li { display: flex; flex-direction: column; gap: 6px; min-width: 0; position: relative; }
.sp-full li::before { content: ''; height: 4px; border-radius: 3px; background: var(--line-2); order: -1; }
.sp-full li.done::before { background: var(--accent-2); }
.sp-full li.current::before { background: var(--accent); }
.sp-full li.blocked::before { background: var(--danger); }
.mk { display: none; }
.tx { display: flex; flex-direction: column; min-width: 0; }
.l { font-size: 11.5px; line-height: 1.25; color: var(--ink-3); }
.done .l { color: var(--ink-2); }
.current .l, .blocked .l { color: var(--ink-1); font-weight: 600; }
.blocked .l { color: var(--danger); }
.d { font-size: 10.5px; color: var(--ink-4); font-family: var(--font-mono); min-height: 13px; }
@media (max-width: 1100px) {
  .sp-full { grid-template-columns: repeat(5, minmax(0, 1fr)); row-gap: 12px; }
}
@media (max-width: 560px) {
  .sp-full { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
