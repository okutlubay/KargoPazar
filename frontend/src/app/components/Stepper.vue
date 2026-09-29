<script setup>
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  steps: { type: Array, required: true }, // [{ key, label, description?, error?, optional? }]
  current: { type: Number, default: 0 }, // v-model:current (index)
  orientation: { type: String, default: 'horizontal' }, // 'horizontal' | 'vertical'
  // (targetIndex, currentIndex) => boolean. Default: completed steps (index < current) are clickable.
  canNavigate: { type: Function, default: null },
  // highest index reached so far (lets users jump forward to already visited steps)
  maxReached: { type: Number, default: null },
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:current', 'navigate'])
const { t } = useI18n()

function state(i) {
  if (props.steps[i]?.error) return 'error'
  if (i === props.current) return 'current'
  if (i < props.current || (props.maxReached != null && i <= props.maxReached)) return 'done'
  return 'todo'
}
function clickable(i) {
  if (i === props.current) return false
  if (props.canNavigate) return !!props.canNavigate(i, props.current)
  return i < props.current || (props.maxReached != null && i <= props.maxReached)
}
function go(i) {
  if (!clickable(i)) return
  emit('update:current', i)
  emit('navigate', i)
}
</script>

<template>
  <nav class="kpz-stepper" :class="'o-' + orientation" :aria-label="ariaLabel || t('components.stepper.aria')">
    <ol>
      <li
        v-for="(s, i) in steps"
        :key="s.key || i"
        class="st"
        :class="['s-' + state(i), { clickable: clickable(i) }]"
        :aria-current="i === current ? 'step' : undefined"
      >
        <button type="button" class="st-btn" :disabled="!clickable(i)" :tabindex="clickable(i) ? 0 : -1" @click="go(i)">
          <span class="st-mark" aria-hidden="true">
            <Icon v-if="state(i) === 'done'" name="check" :size="12" />
            <Icon v-else-if="state(i) === 'error'" name="alert" :size="12" />
            <span v-else class="mono">{{ i + 1 }}</span>
          </span>
          <span class="st-text">
            <span class="st-label">{{ s.label }}</span>
            <span v-if="s.description && orientation === 'vertical'" class="st-desc">{{ s.description }}</span>
            <span v-if="s.optional" class="st-desc">{{ t('common.optional') }}</span>
          </span>
          <span class="sr-only">{{ t('components.stepper.state.' + state(i)) }}</span>
        </button>
        <span v-if="i < steps.length - 1" class="st-line" aria-hidden="true" />
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.kpz-stepper ol { list-style: none; margin: 0; padding: 0; display: flex; }
.o-horizontal ol { align-items: center; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.o-horizontal ol::-webkit-scrollbar { display: none; }
.o-vertical ol { flex-direction: column; }
.st { display: flex; align-items: center; gap: 8px; min-width: 0; }
.o-horizontal .st { flex: 1 1 auto; }
.o-horizontal .st:last-child { flex: 0 0 auto; }
.o-vertical .st { flex-direction: column; align-items: stretch; gap: 0; }
.st-btn {
  display: flex; align-items: center; gap: 10px; border: 0; background: transparent; padding: 4px; border-radius: 8px;
  text-align: left; color: var(--ink-3); cursor: default; min-width: 0;
}
.o-vertical .st-btn { align-items: flex-start; padding: 6px 4px; }
.st.clickable .st-btn { cursor: pointer; }
.st.clickable .st-btn:hover .st-label { color: var(--ink-1); text-decoration: underline; text-underline-offset: 3px; }
.st-btn:disabled { color: inherit; }
.st-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.st-mark {
  width: 24px; height: 24px; flex: none; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
  font-size: 11.5px; font-weight: 600; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-3);
  transition: all 0.15s;
}
.s-current .st-mark { background: var(--ink-1); border-color: var(--ink-1); color: var(--bg); box-shadow: 0 0 0 4px var(--accent-soft); }
.s-done .st-mark { background: var(--accent); border-color: var(--accent); color: white; }
.s-error .st-mark { background: var(--danger); border-color: var(--danger); color: white; }
.st-text { display: flex; flex-direction: column; min-width: 0; }
.st-label { font-size: 13px; font-weight: 500; white-space: nowrap; color: var(--ink-3); }
.s-current .st-label { color: var(--ink-1); font-weight: 600; }
.s-done .st-label { color: var(--ink-2); }
.s-error .st-label { color: var(--danger); }
.st-desc { font-size: 12px; color: var(--ink-3); line-height: 1.35; margin-top: 1px; }
.st-line { flex: 1; height: 1px; min-width: 16px; background: var(--line-2); }
.s-done .st-line { background: var(--accent); }
.o-vertical .st-line { width: 1px; height: auto; min-height: 16px; flex: 1 0 16px; margin-left: 16px; }
@media (max-width: 860px) {
  .o-horizontal .st:not(.s-current) .st-text { display: none; }
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
