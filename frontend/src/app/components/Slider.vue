<script setup>
import { computed, useId } from 'vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  label: { type: String, default: '' },
  leftLabel: { type: String, default: '' }, // e.g. "Maliyet"
  rightLabel: { type: String, default: '' }, // e.g. "Hız"
  showValue: { type: Boolean, default: true },
  format: { type: Function, default: null }, // v => string
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])
const { fmt } = useI18n()
const id = useId()

const pct = computed(() => {
  const span = props.max - props.min || 1
  return ((props.modelValue - props.min) / span) * 100
})
const display = computed(() => (props.format ? props.format(props.modelValue) : fmt.number(props.modelValue, props.step % 1 ? 1 : 0)))
</script>

<template>
  <div class="kpz-slider" :class="{ disabled }">
    <div v-if="label || showValue" class="sl-head">
      <label v-if="label" :for="id" class="sl-label">{{ label }}</label>
      <span v-if="showValue" class="mono sl-value">{{ display }}</span>
    </div>
    <div class="sl-row">
      <span v-if="leftLabel" class="sl-end">{{ leftLabel }}</span>
      <input
        :id="id"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        :aria-label="label ? undefined : [leftLabel, rightLabel].filter(Boolean).join(' - ') || undefined"
        :aria-valuetext="display"
        :style="{ '--pct': pct + '%' }"
        @input="emit('update:modelValue', Number($event.target.value))"
        @change="emit('change', Number($event.target.value))"
      />
      <span v-if="rightLabel" class="sl-end">{{ rightLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.kpz-slider { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.kpz-slider.disabled { opacity: 0.55; }
.sl-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.sl-label { font-size: 12.5px; font-weight: 500; color: var(--ink-2); }
.sl-value { font-size: 12px; color: var(--ink-1); font-weight: 600; }
.sl-row { display: flex; align-items: center; gap: 12px; }
.sl-end { font-size: 12px; color: var(--ink-3); white-space: nowrap; font-weight: 500; }
input[type='range'] {
  -webkit-appearance: none; appearance: none; flex: 1; min-width: 80px; height: 20px; margin: 0;
  background: transparent; cursor: pointer;
}
input[type='range']:disabled { cursor: not-allowed; }
input[type='range']::-webkit-slider-runnable-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(to right, var(--accent) 0, var(--accent) var(--pct), var(--bg-3) var(--pct), var(--bg-3) 100%);
}
input[type='range']::-moz-range-track { height: 6px; border-radius: 999px; background: var(--bg-3); }
input[type='range']::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--accent); }
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 18px; height: 18px; margin-top: -6px; border-radius: 999px;
  background: white; border: 1px solid var(--line-strong); box-shadow: 0 1px 3px rgba(20, 22, 40, 0.2);
}
input[type='range']::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 999px; background: white; border: 1px solid var(--line-strong);
  box-shadow: 0 1px 3px rgba(20, 22, 40, 0.2);
}
input[type='range']:focus { outline: none; }
input[type='range']:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px var(--accent-soft), 0 0 0 1px var(--accent); }
input[type='range']:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px var(--accent-soft), 0 0 0 1px var(--accent); }
</style>
