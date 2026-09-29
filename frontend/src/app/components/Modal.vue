<script setup>
// <Modal v-model:open="show" :title="t('x')" size="md"> ...body... <template #footer>...</template></Modal>
import { watch, onBeforeUnmount, ref, nextTick } from 'vue'
import Icon from '@/components/Icon.vue'
import { t } from '../i18n/index.js'
import { pushLayer, popLayer } from './layers.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  size: { type: String, default: 'md' }, // sm | md | lg | xl
  closable: { type: Boolean, default: true },
})
const emit = defineEmits(['update:open', 'close'])
const panel = ref(null)
let layerId = null

function close() {
  if (!props.closable) return
  emit('update:open', false)
  emit('close')
}

watch(() => props.open, async v => {
  if (v) {
    layerId = pushLayer(close)
    await nextTick()
    panel.value?.querySelector('[autofocus], input, select, textarea, button:not(.x)')?.focus()
  } else if (layerId) { popLayer(layerId); layerId = null }
}, { immediate: true })

onBeforeUnmount(() => { if (layerId) popLayer(layerId) })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="overlay" @mousedown.self="close">
        <div ref="panel" :class="['panel', size]" role="dialog" aria-modal="true" :aria-label="title">
          <header v-if="title || closable" class="head">
            <div>
              <div class="title">{{ title }}</div>
              <div v-if="subtitle" class="sub">{{ subtitle }}</div>
            </div>
            <button v-if="closable" class="x" :aria-label="t('common.close')" @click="close"><Icon name="x" :size="14" /></button>
          </header>
          <div class="content"><slot /></div>
          <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 900; background: oklch(0.2 0.02 265 / 0.38); backdrop-filter: blur(2px); display: flex; align-items: flex-start; justify-content: center; padding: 8vh 16px 16px; overflow-y: auto; }
.panel { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-lg); width: 100%; display: flex; flex-direction: column; max-height: 84vh; }
.sm { max-width: 420px; } .md { max-width: 560px; } .lg { max-width: 760px; } .xl { max-width: 1040px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px 0; }
.title { font-family: var(--font-display); font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
.sub { color: var(--ink-3); font-size: 13.5px; margin-top: 2px; }
.x { background: transparent; border: 0; padding: 6px; border-radius: 8px; color: var(--ink-3); display: inline-flex; }
.x:hover { background: var(--bg-2); color: var(--ink-1); }
.content { padding: 16px 20px 20px; overflow-y: auto; font-size: 14px; }
.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--line-1); background: var(--bg-2); border-radius: 0 0 var(--r-lg) var(--r-lg); flex-wrap: wrap; }
.modal-enter-active, .modal-leave-active { transition: opacity .18s ease; }
.modal-enter-active .panel, .modal-leave-active .panel { transition: transform .18s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .panel { transform: translateY(10px) scale(.99); }
@media (max-width: 560px) { .overlay { padding: 16px 8px; } }
</style>
