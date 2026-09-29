<script setup>
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Popover from './Popover.vue'
import Spinner from './Spinner.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  badge: { type: String, default: '' }, // badge text (default "AI")
  actionLabel: { type: String, default: '' }, // default "Uygula"
  actionIcon: { type: String, default: '' },
  hideAction: { type: Boolean, default: false },
  applying: { type: Boolean, default: false }, // shows spinner + disables action
  applied: { type: Boolean, default: false }, // shows "Uygulandı" state
  // reason: string, or [string], or [{ label, value?, weight? (0-1) }]
  reason: { type: [String, Array], default: null },
  reasonTitle: { type: String, default: '' }, // default components.ai.reasonTitle
  confidence: { type: Number, default: null }, // 0-1, shown in footer of popover
  meta: { type: String, default: '' }, // small right-aligned text (e.g. "2 dk önce")
  compact: { type: Boolean, default: false },
  tone: { type: String, default: 'accent' }, // 'accent' | 'plain'
})
const emit = defineEmits(['apply', 'why'])
const { t, fmt } = useI18n()

const factors = computed(() => {
  if (!props.reason) return []
  if (typeof props.reason === 'string') return [{ label: props.reason }]
  return props.reason.map(r => (typeof r === 'string' ? { label: r } : r))
})
const hasReason = computed(() => factors.value.length > 0)
</script>

<template>
  <div class="kpz-ai" :class="['tone-' + tone, { compact }]">
    <div class="ai-head">
      <span class="badge-ai"><Icon name="spark" :size="11" />{{ badge || t('common.aiBadge') }}</span>
      <span v-if="meta" class="ai-meta">{{ meta }}</span>
    </div>
    <div v-if="title" class="ai-title">{{ title }}</div>
    <div v-if="description || $slots.default" class="ai-desc">
      <slot>{{ description }}</slot>
    </div>
    <div v-if="!hideAction || hasReason || $slots.reason || $slots.actions" class="ai-actions">
      <button
        v-if="!hideAction"
        type="button"
        class="btn btn-sm"
        :class="applied ? 'btn-ghost' : 'btn-accent'"
        :disabled="applying || applied"
        @click="emit('apply')"
      >
        <Spinner v-if="applying" :size="13" />
        <Icon v-else :name="applied ? 'check' : actionIcon || 'wand'" :size="13" />
        {{ applied ? t('components.ai.applied') : actionLabel || t('common.apply') }}
      </button>
      <Popover v-if="hasReason || $slots.reason" placement="bottom-start" :width="320" :aria-label="reasonTitle || t('components.ai.reasonTitle')" @show="emit('why')">
        <template #trigger="{ toggle, open, id }">
          <button type="button" class="btn btn-ghost btn-sm" :aria-expanded="open" :aria-controls="open ? id : undefined" @click.stop="toggle">
            <Icon name="info" :size="13" />{{ t('common.why') }}
          </button>
        </template>
        <div class="why">
          <div class="why-head">
            <span class="badge-ai"><Icon name="brain" :size="11" />{{ t('common.aiBadge') }}</span>
            <span class="why-title">{{ reasonTitle || t('components.ai.reasonTitle') }}</span>
          </div>
          <slot name="reason">
            <ul class="why-list">
              <li v-for="(f, i) in factors" :key="i">
                <div class="why-row">
                  <span class="why-label">{{ f.label }}</span>
                  <span v-if="f.value != null" class="mono why-val">{{ f.value }}</span>
                </div>
                <div v-if="typeof f.weight === 'number'" class="why-bar"><span :style="{ width: Math.max(2, Math.min(100, f.weight * 100)) + '%' }" /></div>
              </li>
            </ul>
          </slot>
          <div v-if="confidence != null" class="why-foot">
            <span>{{ t('components.ai.confidence') }}</span>
            <span class="mono">{{ fmt.percent(confidence, 0) }}</span>
          </div>
        </div>
      </Popover>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.kpz-ai {
  display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: var(--r-lg);
  border: 1px solid var(--line-1); background: var(--surface); min-width: 0;
}
.kpz-ai.tone-accent {
  border-color: oklch(0.9 0.05 268);
  background: linear-gradient(180deg, oklch(0.975 0.02 268), var(--surface) 70%);
}
.kpz-ai.compact { padding: 10px 12px; gap: 6px; }
.ai-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ai-meta { font-size: 11.5px; color: var(--ink-3); }
.ai-title { font-family: var(--font-display); font-weight: 600; font-size: 14.5px; letter-spacing: -0.01em; color: var(--ink-1); }
.ai-desc { font-size: 13px; line-height: 1.5; color: var(--ink-2); text-wrap: pretty; }
.ai-desc :deep(b) { color: var(--ink-1); }
.ai-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.ai-actions .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.ai-actions .btn:disabled { opacity: 0.7; cursor: default; transform: none; }
.why { padding: 6px 6px 4px; display: flex; flex-direction: column; gap: 10px; }
.why-head { display: flex; align-items: center; gap: 8px; }
.why-title { font-weight: 600; font-size: 13px; }
.why-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.why-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
.why-label { color: var(--ink-2); }
.why-val { color: var(--ink-1); font-weight: 600; font-size: 12px; white-space: nowrap; }
.why-bar { height: 4px; border-radius: 999px; background: var(--bg-3); margin-top: 4px; overflow: hidden; }
.why-bar span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.why-foot { display: flex; justify-content: space-between; border-top: 1px solid var(--line-1); padding-top: 8px; font-size: 12px; color: var(--ink-3); }
</style>
