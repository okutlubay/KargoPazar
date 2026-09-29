<script setup>
import Icon from '@/components/Icon.vue'
import { toasts, dismiss } from './toast.js'
import { t } from '../i18n/index.js'

const ICON = { success: 'check-circle', info: 'info', warning: 'alert', error: 'x-circle' }

function runAction(item) {
  item.action.onClick?.()
  dismiss(item.id)
}
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toasts" :key="item.id" :class="['toast', item.type]" role="status">
        <Icon :name="ICON[item.type]" :size="16" class="ic" />
        <div class="body">
          <div v-if="item.title" class="title">{{ item.title }}</div>
          <div class="msg">{{ item.message }}</div>
        </div>
        <button v-if="item.action" class="act" @click="runAction(item)">{{ item.action.label }}</button>
        <button class="x" :aria-label="t('common.close')" @click="dismiss(item.id)"><Icon name="x" :size="12" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host { position: fixed; right: 20px; bottom: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
.toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; min-width: 280px; max-width: 420px; padding: 12px 12px 12px 14px; background: var(--ink-1); color: var(--bg); border-radius: var(--r-md); box-shadow: var(--shadow-lg); font-size: 13.5px; }
.ic { flex: none; margin-top: 2px; }
.success .ic { color: oklch(0.8 0.13 155); }
.info .ic { color: oklch(0.8 0.1 268); }
.warning .ic { color: oklch(0.85 0.13 80); }
.error .ic { color: oklch(0.75 0.16 25); }
.body { flex: 1; min-width: 0; }
.title { font-weight: 600; margin-bottom: 2px; }
.msg { line-height: 1.45; }
.act { background: transparent; border: 0; color: oklch(0.82 0.1 268); font-weight: 600; font-size: 13px; padding: 2px 6px; border-radius: 6px; }
.act:hover { background: rgba(255,255,255,0.08); }
.x { background: transparent; border: 0; color: var(--ink-4); padding: 4px; border-radius: 6px; display: inline-flex; }
.x:hover { color: var(--bg); }
.toast-enter-active, .toast-leave-active { transition: all .2s ease; }
.toast-enter-from { opacity: 0; transform: translateY(8px); }
.toast-leave-to { opacity: 0; transform: translateX(16px); }
@media (max-width: 560px) { .toast-host { left: 12px; right: 12px; bottom: 12px; } .toast { min-width: 0; max-width: none; width: 100%; } }
</style>
