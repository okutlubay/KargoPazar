<script setup>
// Right-side detail panel. <Drawer v-model:open="x" :title="..." width="560px"> ... <template #footer/> </Drawer>
// Optional #actions slot renders buttons next to the close button (e.g. "open full page").
import { watch, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import { t } from '../i18n/index.js'
import { pushLayer, popLayer } from './layers.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  width: { type: String, default: '560px' },
})
const emit = defineEmits(['update:open', 'close'])
let layerId = null

function close() {
  emit('update:open', false)
  emit('close')
}

watch(() => props.open, v => {
  if (v) layerId = pushLayer(close)
  else if (layerId) { popLayer(layerId); layerId = null }
}, { immediate: true })

onBeforeUnmount(() => { if (layerId) popLayer(layerId) })
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="overlay" @mousedown.self="close">
        <aside class="panel" :style="{ width }" role="dialog" aria-modal="true" :aria-label="title">
          <header class="head">
            <div class="titles">
              <div class="title">{{ title }}</div>
              <div v-if="subtitle" class="sub">{{ subtitle }}</div>
              <slot name="header" />
            </div>
            <div class="tools">
              <slot name="actions" />
              <button class="x" :aria-label="t('common.close')" @click="close"><Icon name="x" :size="14" /></button>
            </div>
          </header>
          <div class="content"><slot /></div>
          <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 800; background: oklch(0.2 0.02 265 / 0.22); display: flex; justify-content: flex-end; }
.panel { height: 100%; max-width: 100vw; background: var(--surface); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
.head { display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line-1); }
.titles { min-width: 0; }
.title { font-family: var(--font-display); font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
.sub { color: var(--ink-3); font-size: 13px; margin-top: 2px; }
.tools { display: flex; align-items: flex-start; gap: 6px; }
.x { background: transparent; border: 0; padding: 6px; border-radius: 8px; color: var(--ink-3); display: inline-flex; }
.x:hover { background: var(--bg-2); color: var(--ink-1); }
.content { flex: 1; overflow-y: auto; padding: 18px 20px; font-size: 14px; }
.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line-1); background: var(--bg-2); flex-wrap: wrap; }
.drawer-enter-active, .drawer-leave-active { transition: opacity .2s ease; }
.drawer-enter-active .panel, .drawer-leave-active .panel { transition: transform .22s cubic-bezier(.2,.8,.2,1); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .panel, .drawer-leave-to .panel { transform: translateX(40px); }
</style>
