<script setup>
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  tabs: { type: Array, required: true }, // [{ key, label, count?, icon?, disabled? }]
  modelValue: { type: [String, Number], default: null },
  variant: { type: String, default: 'underline' }, // 'underline' | 'pill'
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'change'])
const { fmt } = useI18n()
const btns = ref([])

function select(tab) {
  if (tab.disabled || tab.key === props.modelValue) return
  emit('update:modelValue', tab.key)
  emit('change', tab.key)
}
function onKey(e, i) {
  const enabled = props.tabs.map((tb, idx) => (tb.disabled ? -1 : idx)).filter(x => x >= 0)
  const pos = enabled.indexOf(i)
  let next = null
  if (e.key === 'ArrowRight') next = enabled[(pos + 1) % enabled.length]
  else if (e.key === 'ArrowLeft') next = enabled[(pos - 1 + enabled.length) % enabled.length]
  else if (e.key === 'Home') next = enabled[0]
  else if (e.key === 'End') next = enabled[enabled.length - 1]
  if (next == null) return
  e.preventDefault()
  select(props.tabs[next])
  btns.value[next]?.focus()
}
</script>

<template>
  <div class="kpz-tabs" :class="'v-' + variant" role="tablist" :aria-label="ariaLabel || undefined">
    <button
      v-for="(tab, i) in tabs"
      :key="tab.key"
      :ref="el => (btns[i] = el)"
      type="button"
      role="tab"
      :data-testid="'tab-' + tab.key"
      class="tab"
      :class="{ active: tab.key === modelValue }"
      :aria-selected="tab.key === modelValue"
      :tabindex="tab.key === modelValue ? 0 : -1"
      :disabled="tab.disabled"
      @click="select(tab)"
      @keydown="onKey($event, i)"
    >
      <Icon v-if="tab.icon" :name="tab.icon" :size="14" />
      <span>{{ tab.label }}</span>
      <span v-if="tab.count != null" class="mono count">{{ typeof tab.count === 'number' ? fmt.number(tab.count) : tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.kpz-tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; max-width: 100%; }
.kpz-tabs::-webkit-scrollbar { display: none; }
.v-underline { border-bottom: 1px solid var(--line-1); gap: 20px; }
.tab {
  display: inline-flex; align-items: center; gap: 7px; flex: none;
  border: 0; background: transparent; font-size: 13.5px; font-weight: 500; color: var(--ink-3);
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.tab:disabled { opacity: 0.45; cursor: not-allowed; }
.v-underline .tab { height: 40px; padding: 0 2px; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 0; }
.v-underline .tab:hover:not(:disabled) { color: var(--ink-1); }
.v-underline .tab.active { color: var(--ink-1); border-bottom-color: var(--ink-1); }
.v-pill { padding: 3px; background: var(--bg-2); border: 1px solid var(--line-1); border-radius: 10px; width: max-content; }
.v-pill .tab { height: 30px; padding: 0 12px; border-radius: 7px; }
.v-pill .tab:hover:not(:disabled) { color: var(--ink-1); }
.v-pill .tab.active { background: var(--surface); color: var(--ink-1); box-shadow: var(--shadow-sm); }
.count {
  min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-3); color: var(--ink-2); font-size: 10.5px; font-weight: 600;
}
.tab.active .count { background: var(--accent-soft); color: var(--accent-ink); }
.tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); border-radius: 6px; }
</style>
