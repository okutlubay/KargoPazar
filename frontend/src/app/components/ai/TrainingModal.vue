<script setup>
// Retraining dialog shared by the AI module pages: progress, live content (#live slot, e.g. a loss
// curve or step list) and a result view (#result slot) with the version bump.
//   <TrainingModal v-model:open="open" :title :running :progress :step-label :done :from-version :to-version>
//     <template #intro>...</template> <template #live>...</template> <template #result>...</template>
//   </TrainingModal>
// Emits `start` from the primary button; the page runs the API call and updates the props.
import Modal from '../Modal.vue'
import ProgressBar from '../ProgressBar.vue'
import Spinner from '../Spinner.vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '../../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  running: { type: Boolean, default: false },
  progress: { type: Number, default: 0 },
  stepLabel: { type: String, default: '' },
  done: { type: Boolean, default: false },
  fromVersion: { type: String, default: '' },
  toVersion: { type: String, default: '' },
  startLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  disabledReason: { type: String, default: '' },
  size: { type: String, default: 'lg' },
})
const emit = defineEmits(['update:open', 'start', 'close'])
const { t } = useI18n()
function close() {
  if (props.running) return
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <Modal :open="open" :title="title" :subtitle="subtitle" :size="size" :closable="!running" @update:open="v => !v && close()">
    <div class="tm">
      <div v-if="!running && !done" class="intro"><slot name="intro" /></div>
      <div v-if="running || done" class="prog">
        <div class="prog-head">
          <span class="step"><Spinner v-if="running" :size="14" /><Icon v-else name="check-circle" :size="15" class="ok" />{{ done ? t('aiHub.training.completed') : stepLabel || t('aiHub.training.running') }}</span>
          <span class="num pct">{{ Math.round(progress) }}%</span>
        </div>
        <ProgressBar :value="progress" :tone="done ? 'success' : 'accent'" size="md" />
      </div>
      <div v-if="running || done" class="live"><slot name="live" /></div>
      <div v-if="done" class="result">
        <div v-if="fromVersion && toVersion" class="bump">
          <span class="ver old">{{ fromVersion }}</span>
          <Icon name="arrow" :size="14" />
          <span class="ver new">{{ toVersion }}</span>
          <span class="tag tag-success">{{ t('aiHub.training.published') }}</span>
        </div>
        <slot name="result" />
      </div>
    </div>
    <template #footer>
      <button v-if="!done" class="btn btn-ghost btn-sm" :disabled="running" @click="close">{{ t('common.cancel') }}</button>
      <button v-if="!done" data-testid="training-start" class="btn btn-accent btn-sm" :disabled="running || disabled" :title="disabled ? disabledReason : ''" @click="emit('start')">
        <Spinner v-if="running" :size="14" /><Icon v-else name="refresh" :size="14" />{{ startLabel || t('aiHub.training.start') }}
      </button>
      <button v-else data-testid="training-close" class="btn btn-primary btn-sm" @click="close">{{ t('common.close') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.tm { display: flex; flex-direction: column; gap: 16px; }
.intro { font-size: 13.5px; color: var(--ink-2); line-height: 1.55; }
.prog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; color: var(--ink-2); }
.step { display: inline-flex; align-items: center; gap: 8px; }
.ok { color: var(--success); }
.pct { font-weight: 600; color: var(--ink-1); }
.bump { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.ver { font-family: var(--font-mono); font-size: 13px; padding: 4px 10px; border-radius: 8px; background: var(--bg-3); }
.ver.new { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
</style>
