<script setup>
// Money value that counts up/down to the new amount (wallet balance after a top-up).
//   <AnimatedMoney :value="balance" :duration="900" />
import { ref, watch, onBeforeUnmount } from 'vue'
import { fmt } from '../../i18n/index.js'

const props = defineProps({
  value: { type: Number, default: 0 },
  from: { type: Number, default: null },
  duration: { type: Number, default: 900 },
  currency: { type: String, default: 'USD' },
})
const shown = ref(props.from ?? props.value)
const flash = ref(false)
let raf = 0

function animate(from, to) {
  cancelAnimationFrame(raf)
  if (from === to) { shown.value = to; return }
  const start = performance.now()
  flash.value = to > from ? 'up' : 'down'
  const step = now => {
    const p = Math.min(1, (now - start) / props.duration)
    const e = 1 - Math.pow(1 - p, 3)
    shown.value = from + (to - from) * e
    if (p < 1) raf = requestAnimationFrame(step)
    else { shown.value = to; setTimeout(() => { flash.value = false }, 600) }
  }
  raf = requestAnimationFrame(step)
}

watch(() => props.value, (v, old) => animate(old ?? shown.value, v))
if (props.from != null && props.from !== props.value) animate(props.from, props.value)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <span class="am num" :class="flash && `am-${flash}`">{{ fmt.money(shown, currency) }}</span>
</template>

<style scoped>
.am { transition: color .4s ease; }
.am-up { color: var(--success); }
.am-down { color: var(--danger); }
</style>
