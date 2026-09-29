// Stack of open overlays (Modal, Drawer, CommandPalette, ConfirmDialog) so that
// Esc closes only the top-most one.
const stack = []
let seq = 0

export function pushLayer(onEscape) {
  const id = ++seq
  stack.push({ id, onEscape })
  return id
}

export function popLayer(id) {
  const i = stack.findIndex(l => l.id === id)
  if (i >= 0) stack.splice(i, 1)
}

export function hasLayers() { return stack.length > 0 }

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault()
    stack[stack.length - 1].onEscape?.()
  }
})
