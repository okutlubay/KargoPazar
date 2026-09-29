<script setup>
// Menu button: row "..." menus, user menu, "more actions".
import { ref, nextTick } from 'vue'
import Icon from '@/components/Icon.vue'
import Popover from './Popover.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  // [{ key, label, icon?, danger?, disabled?, hint?, shortcut?, divider?, header?, onClick? }]
  items: { type: Array, default: () => [] },
  placement: { type: String, default: 'bottom-end' },
  width: { type: [Number, String], default: 220 },
  icon: { type: String, default: 'more' }, // icon of the default trigger button
  label: { type: String, default: '' }, // visible text of the default trigger (optional)
  ariaLabel: { type: String, default: '' }, // aria-label of the default trigger
  size: { type: String, default: 'sm' }, // default trigger size 'sm' | 'md'
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
const { t } = useI18n()
const open = ref(false)
const menuEl = ref(null)

function choose(item) {
  if (item.disabled || item.divider || item.header) return
  open.value = false
  item.onClick?.(item)
  emit('select', item)
}
function focusables() {
  return [...(menuEl.value?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
}
function onKey(e) {
  const list = focusables()
  if (!list.length) return
  const i = list.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus() }
  else if (e.key === 'Home') { e.preventDefault(); list[0].focus() }
  else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus() }
  else if (e.key === 'Tab') { open.value = false }
}
async function onShow() {
  await nextTick()
  focusables()[0]?.focus()
}
function onTriggerKey(e) {
  if (e.key === 'ArrowDown' && !open.value) { e.preventDefault(); open.value = true }
}
</script>

<template>
  <Popover v-model:open="open" :placement="placement" :width="width" role="menu" :disabled="disabled" @show="onShow">
    <template #trigger="{ toggle, open: isOpen, id }">
      <slot name="trigger" :toggle="toggle" :open="isOpen">
        <button
          type="button"
          class="btn btn-ghost dd-trigger"
          :class="['size-' + size, { 'icon-only': !label, active: isOpen }]"
          :aria-label="ariaLabel || label || t('common.actions')"
          aria-haspopup="menu"
          :aria-expanded="isOpen"
          :aria-controls="isOpen ? id : undefined"
          :disabled="disabled"
          @click.stop="toggle"
          @keydown="onTriggerKey"
        >
          <Icon :name="icon" :size="15" />
          <span v-if="label">{{ label }}</span>
          <Icon v-if="label" name="chevron-down" :size="12" />
        </button>
      </slot>
    </template>
    <div ref="menuEl" class="kpz-menu" @keydown="onKey">
      <slot name="header" />
      <template v-for="(item, i) in items" :key="item.key || i">
        <div v-if="item.divider" class="dd-divider" role="separator" />
        <div v-else-if="item.header" class="mono dd-header">{{ item.label }}</div>
        <button
          v-else
          type="button"
          role="menuitem"
          class="dd-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click.stop="choose(item)"
        >
          <Icon v-if="item.icon" :name="item.icon" :size="14" class="dd-icon" />
          <span class="dd-label">
            <span>{{ item.label }}</span>
            <span v-if="item.hint" class="dd-hint">{{ item.hint }}</span>
          </span>
          <kbd v-if="item.shortcut" class="mono dd-kbd">{{ item.shortcut }}</kbd>
        </button>
      </template>
      <slot />
    </div>
  </Popover>
</template>

<style scoped>
.dd-trigger.size-sm { height: 32px; padding: 0 10px; font-size: 13px; border-radius: 8px; }
.dd-trigger.icon-only.size-sm { width: 32px; padding: 0; justify-content: center; }
.dd-trigger.icon-only.size-md { width: 40px; padding: 0; justify-content: center; }
.dd-trigger.icon-only { border-color: transparent; color: var(--ink-3); }
.dd-trigger.icon-only:hover, .dd-trigger.active { color: var(--ink-1); background: var(--bg-2); border-color: var(--line-1); }
.dd-trigger:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.kpz-menu { display: flex; flex-direction: column; gap: 1px; }
.dd-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 7px 10px; border: 0; border-radius: 7px; background: transparent;
  font-size: 13.5px; color: var(--ink-1);
}
.dd-item:hover:not(:disabled), .dd-item:focus-visible { background: var(--bg-2); outline: none; }
.dd-item:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }
.dd-item:disabled { opacity: 0.45; cursor: not-allowed; }
.dd-item.danger { color: var(--danger); }
.dd-item.danger:hover:not(:disabled) { background: oklch(0.97 0.02 25); }
.dd-icon { color: var(--ink-3); flex: none; }
.dd-item.danger .dd-icon { color: var(--danger); }
.dd-label { flex: 1; display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.dd-hint { font-size: 11.5px; color: var(--ink-3); }
.dd-kbd { font-size: 10.5px; color: var(--ink-3); background: var(--bg-2); border: 1px solid var(--line-1); border-radius: 4px; padding: 1px 5px; }
.dd-divider { height: 1px; background: var(--line-1); margin: 4px 2px; }
.dd-header { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); padding: 8px 10px 4px; }
</style>
