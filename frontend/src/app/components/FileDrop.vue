<script setup>
import { ref, computed, useId } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  accept: { type: String, default: '.csv' }, // comma separated extensions / mime types
  maxSizeMb: { type: Number, default: 5 },
  title: { type: String, default: '' }, // default: common.dropFile
  hint: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['file', 'clear', 'error'])
const { t } = useI18n()
const id = useId()
const input = ref(null)
const dragging = ref(false)
const fileName = ref('')
const fileSize = ref(0)
const error = ref('')
const reading = ref(false)
let depth = 0

const acceptList = computed(() => props.accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))

function isAccepted(file) {
  if (!acceptList.value.length) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return acceptList.value.some(a => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a))
}

function fail(msg) {
  error.value = msg
  emit('error', msg)
}

function handle(file) {
  if (!file || props.disabled) return
  error.value = ''
  if (!isAccepted(file)) return fail(t('components.fileDrop.wrongType', { types: props.accept }))
  if (file.size > props.maxSizeMb * 1024 * 1024) return fail(t('components.fileDrop.tooLarge', { n: props.maxSizeMb }))
  reading.value = true
  const reader = new FileReader()
  reader.onload = () => {
    reading.value = false
    fileName.value = file.name
    fileSize.value = file.size
    emit('file', { name: file.name, text: String(reader.result || ''), size: file.size, type: file.type })
  }
  reader.onerror = () => { reading.value = false; fail(t('common.invalidFile')) }
  reader.readAsText(file)
}

function onDrop(e) {
  depth = 0
  dragging.value = false
  handle(e.dataTransfer?.files?.[0])
}
function onEnter() { depth++; if (!props.disabled) dragging.value = true }
function onLeave() { depth = Math.max(0, depth - 1); if (!depth) dragging.value = false }
function onPick(e) {
  handle(e.target.files?.[0])
  e.target.value = ''
}
function browse() { if (!props.disabled) input.value?.click() }
function clear() {
  fileName.value = ''
  fileSize.value = 0
  error.value = ''
  emit('clear')
}
const sizeText = computed(() => (fileSize.value < 1024 ? fileSize.value + ' B' : (fileSize.value / 1024).toFixed(1) + ' KB'))

defineExpose({ clear, browse })
</script>

<template>
  <div class="kpz-drop-wrap">
    <div
      class="kpz-drop"
      :class="{ dragging, compact, disabled, 'has-error': !!error }"
      role="button"
      :tabindex="disabled ? -1 : 0"
      :aria-disabled="disabled"
      :aria-describedby="error ? id + '-err' : undefined"
      :aria-label="title || t('common.dropFile')"
      @click="browse"
      @keydown.enter.prevent="browse"
      @keydown.space.prevent="browse"
      @dragenter.prevent="onEnter"
      @dragover.prevent
      @dragleave.prevent="onLeave"
      @drop.prevent="onDrop"
    >
      <input ref="input" type="file" class="fd-input" :accept="accept" tabindex="-1" aria-hidden="true" @change="onPick" />
      <div class="fd-icon" aria-hidden="true"><Icon :name="reading ? 'refresh' : 'upload'" :size="18" /></div>
      <div class="fd-text">
        <div class="fd-title">{{ title || t('common.dropFile') }}</div>
        <div class="fd-hint">{{ hint || t('components.fileDrop.hint', { types: accept, n: maxSizeMb }) }}</div>
      </div>
      <span class="btn btn-ghost btn-sm fd-btn">{{ t('common.chooseFile') }}</span>
    </div>
    <div v-if="fileName" class="fd-file">
      <Icon name="file" :size="14" />
      <span class="fd-name">{{ fileName }}</span>
      <span class="mono fd-size">{{ sizeText }}</span>
      <button type="button" class="fd-clear" :aria-label="t('components.fileDrop.remove')" @click="clear"><Icon name="x" :size="12" /></button>
    </div>
    <div v-if="error" :id="id + '-err'" class="fd-error" role="alert"><Icon name="alert" :size="13" />{{ error }}</div>
  </div>
</template>

<style scoped>
.kpz-drop-wrap { display: flex; flex-direction: column; gap: 8px; }
.kpz-drop {
  display: flex; align-items: center; gap: 14px; padding: 22px 20px; border-radius: var(--r-lg);
  border: 1.5px dashed var(--line-strong); background: var(--bg-2); cursor: pointer; transition: all 0.15s;
}
.kpz-drop.compact { padding: 12px 14px; }
.kpz-drop:hover { border-color: var(--accent); background: var(--accent-soft); }
.kpz-drop.dragging { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 4px var(--accent-soft); }
.kpz-drop.has-error { border-color: var(--danger); }
.kpz-drop.disabled { opacity: 0.55; cursor: not-allowed; }
.kpz-drop:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.fd-input { display: none; }
.fd-icon {
  width: 40px; height: 40px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center;
  background: var(--surface); border: 1px solid var(--line-1); color: var(--accent-ink);
}
.fd-text { flex: 1; min-width: 0; }
.fd-title { font-weight: 500; font-size: 14px; color: var(--ink-1); }
.fd-hint { font-size: 12.5px; color: var(--ink-3); }
.fd-btn { pointer-events: none; background: var(--surface); }
.fd-file {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--line-1); border-radius: var(--r-md);
  background: var(--surface); font-size: 13px; color: var(--ink-2);
}
.fd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-1); font-weight: 500; }
.fd-size { font-size: 11.5px; color: var(--ink-3); }
.fd-clear { width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: var(--ink-3); display: inline-flex; align-items: center; justify-content: center; }
.fd-clear:hover { background: var(--bg-2); color: var(--ink-1); }
.fd-clear:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }
.fd-error { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--danger); }
@media (max-width: 560px) { .fd-btn { display: none; } }
</style>
