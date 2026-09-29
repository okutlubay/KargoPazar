<script setup>
import { ref, computed, watch, useId } from 'vue'
import Icon from '@/components/Icon.vue'
import { runRules } from './validation.js'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' }, // external error (wins over rule errors)
  required: { type: Boolean, default: false }, // shows the marker and adds a required rule
  optional: { type: Boolean, default: false }, // shows "(isteğe bağlı)" next to the label
  rules: { type: Array, default: () => [] }, // [value => true | 'message']
  value: { default: undefined }, // the value to validate
  id: { type: String, default: '' },
  validateOn: { type: String, default: 'blur' }, // 'blur' | 'input'
})
const emit = defineEmits(['validate'])
const { t } = useI18n()
const autoId = useId()
const fieldId = computed(() => props.id || 'f' + autoId.replace(/[^a-zA-Z0-9_-]/g, ''))
const root = ref(null)
const ruleError = ref('')
const touched = ref(false)

const allRules = computed(() => {
  const list = [...props.rules]
  if (props.required) {
    list.unshift(v => (v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length) ? t('common.validation.required') : true))
  }
  return list
})
const message = computed(() => props.error || ruleError.value)
const invalid = computed(() => !!message.value)
const describedBy = computed(() => [message.value ? fieldId.value + '-err' : '', props.hint ? fieldId.value + '-hint' : ''].filter(Boolean).join(' ') || undefined)

function validate() {
  touched.value = true
  ruleError.value = runRules(allRules.value, props.value)
  emit('validate', !ruleError.value && !props.error)
  return !ruleError.value && !props.error
}
function reset() {
  touched.value = false
  ruleError.value = ''
}
function focus(opts) {
  const el = root.value?.querySelector('input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])')
  el?.focus(opts)
}
function onFocusOut(e) {
  if (root.value?.contains(e.relatedTarget)) return
  validate()
}

watch(() => props.value, () => {
  if (props.validateOn === 'input' || (touched.value && ruleError.value)) validate()
}, { deep: true })

defineExpose({ validate, reset, focus, el: root, invalid })
</script>

<template>
  <div ref="root" class="kpz-field" :class="{ invalid }" @focusout="onFocusOut">
    <div v-if="label || $slots.labelRight" class="ff-top">
      <label v-if="label" :for="fieldId" class="field-label ff-label">
        {{ label }}<span v-if="required" class="ff-req" aria-hidden="true">*</span>
        <span v-if="optional && !required" class="ff-opt">({{ t('common.optional') }})</span>
      </label>
      <slot name="labelRight" />
    </div>
    <slot :id="fieldId" :invalid="invalid" :described-by="describedBy" :describedBy="describedBy" :validate="validate" />
    <div v-if="message" :id="fieldId + '-err'" class="ff-error" role="alert"><Icon name="alert" :size="12" />{{ message }}</div>
    <div v-else-if="hint" :id="fieldId + '-hint'" class="ff-hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.kpz-field { display: flex; flex-direction: column; min-width: 0; }
.ff-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ff-label { display: inline-flex; align-items: baseline; gap: 3px; }
.ff-req { color: var(--danger); font-weight: 600; }
.ff-opt { color: var(--ink-4); font-weight: 400; margin-left: 3px; }
.ff-error { display: flex; align-items: center; gap: 5px; margin-top: 5px; font-size: 12px; color: var(--danger); line-height: 1.35; }
.ff-hint { margin-top: 5px; font-size: 12px; color: var(--ink-3); line-height: 1.35; }
.kpz-field.invalid :deep(.input), .kpz-field.invalid :deep(.select), .kpz-field.invalid :deep(textarea) { border-color: var(--danger); }
.kpz-field.invalid :deep(.input:focus), .kpz-field.invalid :deep(.select:focus) { box-shadow: 0 0 0 3px oklch(0.95 0.03 25); }
</style>
