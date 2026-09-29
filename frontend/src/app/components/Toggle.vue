<script setup>
import { useId } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'md' }, // 'sm' | 'md'
  ariaLabel: { type: String, default: '' }, // required when there is no visible label
})
const emit = defineEmits(['update:modelValue', 'change'])
const id = useId()

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
  emit('change', !props.modelValue)
}
</script>

<template>
  <div class="kpz-toggle" :class="['size-' + size, { disabled }]">
    <button
      :id="id"
      type="button"
      role="switch"
      class="sw"
      :class="{ on: modelValue }"
      :aria-checked="modelValue"
      :aria-label="ariaLabel || undefined"
      :aria-describedby="description ? id + '-d' : undefined"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="knob" />
    </button>
    <div v-if="label || description || $slots.default" class="tg-text">
      <label v-if="label" :for="id" class="tg-label">{{ label }}</label>
      <slot />
      <div v-if="description" :id="id + '-d'" class="tg-desc">{{ description }}</div>
    </div>
  </div>
</template>

<style scoped>
.kpz-toggle { display: inline-flex; align-items: flex-start; gap: 10px; }
.kpz-toggle.disabled { opacity: 0.55; }
.sw {
  position: relative; flex: none; padding: 0; border: 0; border-radius: 999px;
  background: var(--line-2); transition: background 0.18s;
}
.size-md .sw { width: 36px; height: 20px; }
.size-sm .sw { width: 28px; height: 16px; }
.sw.on { background: var(--accent); }
.sw:disabled { cursor: not-allowed; }
.knob {
  position: absolute; top: 2px; left: 2px; border-radius: 999px; background: white;
  box-shadow: 0 1px 2px rgba(20, 22, 40, 0.25); transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.size-md .knob { width: 16px; height: 16px; }
.size-sm .knob { width: 12px; height: 12px; }
.size-md .sw.on .knob { transform: translateX(16px); }
.size-sm .sw.on .knob { transform: translateX(12px); }
.sw:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.tg-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tg-label { font-size: 13.5px; font-weight: 500; color: var(--ink-1); cursor: pointer; line-height: 20px; }
.size-sm .tg-label { font-size: 12.5px; line-height: 16px; }
.tg-desc { font-size: 12.5px; color: var(--ink-3); line-height: 1.4; }
</style>
