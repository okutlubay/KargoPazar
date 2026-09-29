// Promise-based confirmation dialog rendered by ConfirmHost.vue.
//   if (await confirm({ title, message, confirmLabel, danger: true })) { ... }
import { reactive } from 'vue'

export const confirmState = reactive({ open: false, title: '', message: '', confirmLabel: '', cancelLabel: '', danger: false, resolve: null })

export function confirm({ title, message = '', confirmLabel = '', cancelLabel = '', danger = false }) {
  if (confirmState.resolve) confirmState.resolve(false)
  return new Promise(resolve => {
    Object.assign(confirmState, { open: true, title, message, confirmLabel, cancelLabel, danger, resolve })
  })
}

export function settle(value) {
  const r = confirmState.resolve
  confirmState.open = false
  confirmState.resolve = null
  r?.(value)
}
