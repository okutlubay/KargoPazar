<script setup>
// Small "Neden?" (Why?) button that opens a popover with the model's reasoning.
//   <WhyPopover :title="t('x')" :items="[{ label, value?, weight? 0..1 }] | ['text']" />
// Slot default replaces the body.
import Icon from '@/components/Icon.vue'
import Popover from '../Popover.vue'
import { t } from '../../i18n/index.js'

defineProps({
  title: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  width: { type: [Number, String], default: 320 },
  placement: { type: String, default: 'bottom-end' },
  size: { type: String, default: 'sm' }, // sm | xs
})
</script>

<template>
  <Popover :width="width" :placement="placement" :aria-label="title || t('common.why')">
    <template #trigger="{ toggle, open, id }">
      <button type="button" class="why-btn" :class="'s-' + size" :aria-expanded="open" :aria-controls="id" data-no-row-click @click.stop="toggle">
        <Icon name="spark" :size="11" />{{ label || t('common.why') }}
      </button>
    </template>
    <div class="why-body">
      <div class="why-head"><span class="badge-ai"><Icon name="spark" :size="10" />AI</span>{{ title || t('common.why') }}</div>
      <slot>
        <ul class="why-list">
          <li v-for="(it, i) in items" :key="i">
            <template v-if="typeof it === 'string'">{{ it }}</template>
            <template v-else>
              <div class="why-row"><span>{{ it.label }}</span><span v-if="it.value != null" class="mono">{{ it.value }}</span></div>
              <div v-if="it.weight != null" class="why-bar"><span :style="{ width: Math.max(2, Math.min(100, it.weight * 100)) + '%' }" /></div>
            </template>
          </li>
        </ul>
      </slot>
    </div>
  </Popover>
</template>

<style scoped>
.why-btn { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line-1); background: var(--surface); color: var(--accent-ink); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.why-btn.s-xs { height: 20px; padding: 0 6px; font-size: 11px; }
.why-btn:hover { background: var(--accent-soft); border-color: transparent; }
.why-body { padding: 12px 14px; }
.why-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.why-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
.why-row { display: flex; justify-content: space-between; gap: 10px; }
.why-bar { height: 4px; border-radius: 4px; background: var(--bg-3); margin-top: 4px; overflow: hidden; }
.why-bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
</style>
