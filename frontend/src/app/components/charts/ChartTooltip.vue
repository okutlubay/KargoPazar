<script setup>
// Internal: absolutely positioned tooltip inside a .kc-root container.
// x/y are container-relative pixels of the anchor; it flips left when near the right edge.
import { computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  containerWidth: { type: Number, default: 0 },
  containerHeight: { type: Number, default: 0 },
  offset: { type: Number, default: 14 },
})

const style = computed(() => {
  const flip = props.containerWidth > 0 && props.x > props.containerWidth * 0.58
  const top = Math.max(0, props.containerHeight ? Math.min(props.y, props.containerHeight - 24) : props.y)
  return {
    left: (flip ? props.x - props.offset : props.x + props.offset) + 'px',
    top: top + 'px',
    transform: `translate(${flip ? '-100%' : '0'}, -50%)`,
    opacity: props.visible ? 1 : 0,
  }
})
</script>

<template>
  <div v-show="visible" class="kc-tip" :style="style" role="presentation">
    <slot />
  </div>
</template>
