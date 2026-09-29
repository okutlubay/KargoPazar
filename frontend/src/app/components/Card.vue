<script setup>
import Icon from '@/components/Icon.vue'

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
  padding: { type: String, default: 'md' }, // 'none' | 'sm' | 'md' | 'lg'
  soft: { type: Boolean, default: false }, // bg-2 background
  tag: { type: String, default: 'section' },
})
</script>

<template>
  <component :is="tag" class="kpz-card" :class="[soft ? 'card-soft' : 'card', 'pad-' + padding]">
    <header v-if="title || subtitle || $slots.header || $slots.actions" class="kc-head">
      <slot name="header">
        <div class="kc-titles">
          <div v-if="title" class="kc-title">
            <Icon v-if="icon" :name="icon" :size="15" />
            <span>{{ title }}</span>
          </div>
          <div v-if="subtitle" class="kc-sub">{{ subtitle }}</div>
        </div>
      </slot>
      <div v-if="$slots.actions" class="kc-actions"><slot name="actions" /></div>
    </header>
    <div class="kc-body"><slot /></div>
    <footer v-if="$slots.footer" class="kc-foot"><slot name="footer" /></footer>
  </component>
</template>

<style scoped>
.kpz-card { display: flex; flex-direction: column; min-width: 0; }
.kc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px 0; flex-wrap: wrap; }
.kc-titles { min-width: 0; }
.kc-title { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 600; font-size: 15px; letter-spacing: -0.01em; color: var(--ink-1); }
.kc-title :deep(svg) { color: var(--ink-3); }
.kc-sub { margin-top: 2px; font-size: 12.5px; color: var(--ink-3); }
.kc-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kc-body { min-width: 0; }
.pad-sm .kc-body { padding: 12px 16px; }
.pad-md .kc-body { padding: 16px 20px 20px; }
.pad-lg .kc-body { padding: 24px 28px 28px; }
.pad-none .kc-head { padding-bottom: 12px; }
.pad-sm .kc-head { padding: 12px 16px 0; }
.pad-lg .kc-head { padding: 24px 28px 0; }
.kc-foot { border-top: 1px solid var(--line-1); padding: 12px 20px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
</style>
