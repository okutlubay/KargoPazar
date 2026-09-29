<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 'lines' | 'rect' | 'circle'
  variant: { type: String, default: 'lines' },
  lines: { type: Number, default: 3 },
  width: { type: [String, Number], default: null },
  height: { type: [String, Number], default: null },
  radius: { type: [String, Number], default: null },
})

const px = v => (v == null ? null : typeof v === 'number' ? v + 'px' : v)
const boxStyle = computed(() => {
  const size = px(props.width) || (props.variant === 'circle' ? '32px' : '100%')
  return {
    width: size,
    height: px(props.height) || (props.variant === 'circle' ? size : '80px'),
    borderRadius: px(props.radius) || (props.variant === 'circle' ? '999px' : 'var(--r-md)'),
  }
})
// Stable pseudo-random line widths so skeletons look natural.
const lineWidths = computed(() => Array.from({ length: props.lines }, (_, i) =>
  i === props.lines - 1 && props.lines > 1 ? '62%' : ['100%', '92%', '96%', '84%'][i % 4]))
</script>

<template>
  <div v-if="variant === 'lines'" class="sk-lines" aria-hidden="true" :style="{ width: px(width) || '100%' }">
    <span v-for="(w, i) in lineWidths" :key="i" class="sk" :style="{ width: w, height: px(height) || '10px' }" />
  </div>
  <span v-else class="sk sk-block" aria-hidden="true" :style="boxStyle" />
</template>

<style scoped>
.sk-lines { display: flex; flex-direction: column; gap: 8px; }
.sk {
  display: block; border-radius: 5px;
  background: linear-gradient(90deg, var(--bg-3) 0%, oklch(0.975 0.004 265) 40%, var(--bg-3) 80%);
  background-size: 300% 100%;
  animation: kpz-shimmer 1.4s ease-in-out infinite;
}
.sk-block { flex: none; }
@keyframes kpz-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
</style>
