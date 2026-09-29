<script setup>
import Icon from '@/components/Icon.vue'

defineProps({
  icon: { type: String, default: 'box' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
  actionIcon: { type: String, default: '' },
  actionVariant: { type: String, default: 'primary' }, // 'primary' | 'accent' | 'ghost'
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['action'])
</script>

<template>
  <div class="kpz-empty" :class="{ compact }">
    <div class="em-icon" aria-hidden="true"><Icon :name="icon" :size="compact ? 18 : 22" /></div>
    <div v-if="title" class="em-title">{{ title }}</div>
    <p v-if="description" class="em-desc">{{ description }}</p>
    <div v-if="$slots.action || actionLabel" class="em-actions">
      <slot name="action">
        <button type="button" class="btn btn-sm" :class="'btn-' + actionVariant" @click="emit('action')">
          <Icon v-if="actionIcon" :name="actionIcon" :size="14" />
          {{ actionLabel }}
        </button>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.kpz-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 24px; gap: 6px; }
.kpz-empty.compact { padding: 24px 16px; }
.em-icon {
  width: 48px; height: 48px; border-radius: 12px; margin-bottom: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-2); border: 1px solid var(--line-1); color: var(--ink-3);
}
.compact .em-icon { width: 36px; height: 36px; border-radius: 10px; margin-bottom: 4px; }
.em-title { font-family: var(--font-display); font-weight: 600; font-size: 16px; letter-spacing: -0.01em; color: var(--ink-1); }
.compact .em-title { font-size: 14.5px; }
.em-desc { margin: 0; max-width: 420px; font-size: 13.5px; color: var(--ink-3); text-wrap: pretty; }
.em-actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
</style>
