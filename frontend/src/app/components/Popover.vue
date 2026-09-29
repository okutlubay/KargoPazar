<script setup>
// Anchored floating panel. Teleported to <body> with fixed positioning so it is never
// clipped by tables / cards. Closes on outside click, Esc (via layers.js) and route scroll.
import { ref, watch, nextTick, onBeforeUnmount, useId } from 'vue'
import { pushLayer, popLayer } from './layers.js'

const props = defineProps({
  open: { type: Boolean, default: undefined }, // v-model:open (optional, uncontrolled if omitted)
  // 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'top'
  placement: { type: String, default: 'bottom-start' },
  width: { type: [Number, String], default: null }, // px number or CSS width; default auto
  offset: { type: Number, default: 6 },
  closeOnContentClick: { type: Boolean, default: false },
  autoFocus: { type: Boolean, default: false }, // focus first focusable element on open
  role: { type: String, default: 'dialog' },
  ariaLabel: { type: String, default: '' },
  panelClass: { type: [String, Array, Object], default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'show', 'hide'])

const id = useId()
const inner = ref(false)
const triggerEl = ref(null)
const panelEl = ref(null)
const pos = ref({ top: 0, left: 0, minWidth: 0, maxHeight: 0, flipped: false })
let layerId = null

const isOpen = () => (props.open === undefined ? inner.value : props.open)
const visible = ref(false)

function setOpen(v) {
  if (props.disabled && v) return
  inner.value = v
  emit('update:open', v)
}
function toggle() { setOpen(!isOpen()) }
function show() { setOpen(true) }
function close() { setOpen(false) }

function anchorEl() {
  const el = triggerEl.value
  if (!el) return null
  return el.firstElementChild || el
}

function place() {
  const a = anchorEl()
  const p = panelEl.value
  if (!a || !p) return
  const r = a.getBoundingClientRect()
  const vw = window.innerWidth, vh = window.innerHeight
  const pw = p.offsetWidth, ph = p.offsetHeight
  const [side, align] = props.placement.split('-')
  const below = vh - r.bottom - props.offset - 8
  const above = r.top - props.offset - 8
  let top
  let flipped = false
  if (side === 'top') {
    if (ph > above && below > above) { top = r.bottom + props.offset; flipped = true }
    else top = r.top - props.offset - Math.min(ph, above)
  } else if (ph > below && above > below) {
    top = r.top - props.offset - Math.min(ph, above); flipped = true
  } else {
    top = r.bottom + props.offset
  }
  let left
  if (align === 'end') left = r.right - pw
  else if (!align) left = r.left + r.width / 2 - pw / 2
  else left = r.left
  left = Math.max(8, Math.min(left, vw - pw - 8))
  const room = (side === 'top') !== flipped ? above : below
  pos.value = { top: Math.max(8, top), left, minWidth: r.width, maxHeight: Math.max(160, room), flipped }
}

function onDocPointer(e) {
  const t = e.target
  if (triggerEl.value?.contains(t) || panelEl.value?.contains(t)) return
  close()
}
function onReflow() { if (visible.value) place() }

async function onOpened() {
  visible.value = true
  layerId = pushLayer(() => { close(); anchorEl()?.focus?.() })
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('resize', onReflow)
  window.addEventListener('scroll', onReflow, true)
  await nextTick()
  place()
  if (props.autoFocus) {
    const f = panelEl.value?.querySelector('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    f?.focus()
  }
  emit('show')
}
function onClosed() {
  visible.value = false
  if (layerId != null) { popLayer(layerId); layerId = null }
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
  emit('hide')
}

watch(() => isOpen(), v => {
  if (v && !visible.value) onOpened()
  else if (!v && visible.value) onClosed()
}, { immediate: true })
onBeforeUnmount(() => { if (visible.value) onClosed() })

function onPanelClick() { if (props.closeOnContentClick) close() }

defineExpose({ open: show, close, toggle, reposition: place })
</script>

<template>
  <span ref="triggerEl" class="kpz-pop-trigger">
    <slot name="trigger" :open="visible" :toggle="toggle" :close="close" :id="id" />
  </span>
  <Teleport to="body">
    <div
      v-if="visible"
      :id="id"
      ref="panelEl"
      class="kpz-popover"
      :class="[panelClass, { flipped: pos.flipped }]"
      :role="role"
      :aria-label="ariaLabel || undefined"
      :style="{
        top: pos.top + 'px',
        left: pos.left + 'px',
        width: width == null ? undefined : typeof width === 'number' ? width + 'px' : width,
        maxHeight: pos.maxHeight ? pos.maxHeight + 'px' : undefined,
      }"
      @click="onPanelClick"
    >
      <slot :close="close" />
    </div>
  </Teleport>
</template>

<style scoped>
.kpz-pop-trigger { display: inline-flex; max-width: 100%; }
.kpz-popover {
  position: fixed; z-index: 960; min-width: 180px; max-width: calc(100vw - 16px); overflow: auto;
  background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-md);
  box-shadow: var(--shadow-lg); padding: 6px; font-size: 13.5px; color: var(--ink-1);
  animation: kpz-pop-in 0.14s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: top left;
}
.kpz-popover.flipped { transform-origin: bottom left; }
@keyframes kpz-pop-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
</style>
