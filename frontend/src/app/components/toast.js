// Global toast queue (bottom-right, 4 s). Rendered by ToastHost.vue in App.vue.
//   toast.success('Saved')
//   toast.info(t('x'), { action: { label: t('common.undo'), onClick: () => restore() } })
import { reactive } from 'vue'

export const toasts = reactive([])
let seq = 0

function push(type, message, { action, duration = 4000, title } = {}) {
  const id = ++seq
  const item = { id, type, message, title, action }
  toasts.push(item)
  item.timer = setTimeout(() => dismiss(id), duration)
  return id
}

export function dismiss(id) {
  const i = toasts.findIndex(t => t.id === id)
  if (i >= 0) { clearTimeout(toasts[i].timer); toasts.splice(i, 1) }
}

export const toast = {
  success: (m, o) => push('success', m, o),
  info: (m, o) => push('info', m, o),
  warning: (m, o) => push('warning', m, o),
  error: (m, o) => push('error', m, o),
  dismiss,
}
