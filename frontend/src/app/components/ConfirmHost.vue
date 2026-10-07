<script setup>
import Modal from './Modal.vue'
import Icon from '@/components/Icon.vue'
import { confirmState, settle } from './confirm.js'
import { t } from '../i18n/index.js'

function onOpen(v) { if (!v) settle(false) }
</script>

<template>
  <Modal :open="confirmState.open" :title="confirmState.title" size="sm" @update:open="onOpen">
    <div class="row-msg">
      <span :class="['ic', { danger: confirmState.danger }]"><Icon :name="confirmState.danger ? 'alert' : 'info'" :size="16" /></span>
      <p class="msg">{{ confirmState.message }}</p>
    </div>
    <template #footer>
      <button class="btn btn-ghost btn-sm" data-testid="confirm-cancel" @click="settle(false)">{{ confirmState.cancelLabel || t('common.cancel') }}</button>
      <button :class="['btn btn-sm', confirmState.danger ? 'btn-danger' : 'btn-primary']" data-testid="confirm-ok" autofocus @click="settle(true)">
        {{ confirmState.confirmLabel || t('common.confirm') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.row-msg { display: flex; gap: 12px; align-items: flex-start; }
.ic { flex: none; width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-ink); }
.ic.danger { background: oklch(0.95 0.04 25); color: var(--danger); }
.msg { margin: 6px 0 0; color: var(--ink-2); line-height: 1.5; }
</style>
