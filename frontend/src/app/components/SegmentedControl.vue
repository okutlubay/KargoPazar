<script setup>
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps({
  options: { type: Array, required: true }, // [{ value, label, icon?, disabled? }]
  modelValue: { type: [String, Number, Boolean], default: null },
  size: { type: String, default: 'md' }, // 'sm' | 'md'
  block: { type: Boolean, default: false }, // stretch to full width
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'change'])
const btns = ref([])

function pick(o) {
  if (o.disabled || o.value === props.modelValue) return
  emit('update:modelValue', o.value)
  emit('change', o.value)
}
function onKey(e, i) {
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!dir) return
  e.preventDefault()
  const n = props.options.length
  for (let k = 1; k <= n; k++) {
    const j = (i + dir * k + n) % n
    if (!props.options[j].disabled) { pick(props.options[j]); btns.value[j]?.focus(); break }
  }
}
</script>

<template>
  <div class="kpz-seg" :class="['size-' + size, { block }]" role="radiogroup" :aria-label="ariaLabel || undefined">
    <button
      v-for="(o, i) in options"
      :key="String(o.value)"
      :ref="el => (btns[i] = el)"
      :data-testid="'seg-' + String(o.value)"
      type="button"
      role="radio"
      :aria-checked="o.value === modelValue"
      :tabindex="o.value === modelValue ? 0 : -1"
      :class="{ active: o.value === modelValue }"
      :disabled="o.disabled"
      @click="pick(o)"
      @keydown="onKey($event, i)"
    >
      <Icon v-if="o.icon" :name="o.icon" :size="13" />
      <span v-if="o.label">{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.kpz-seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--bg-2); border: 1px solid var(--line-1); border-radius: 10px; max-width: 100%; overflow-x: auto; }
.kpz-seg.block { display: flex; width: 100%; }
.kpz-seg.block button { flex: 1; justify-content: center; }
button {
  display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent;
  color: var(--ink-3); font-weight: 500; border-radius: 7px; white-space: nowrap; transition: all 0.15s;
}
.size-md button { height: 30px; padding: 0 12px; font-size: 13px; }
.size-sm button { height: 24px; padding: 0 9px; font-size: 12px; border-radius: 6px; }
button:hover:not(:disabled):not(.active) { color: var(--ink-1); }
button.active { background: var(--ink-1); color: var(--bg); font-weight: 600; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
</style>
