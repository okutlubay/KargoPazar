<script setup>
import Icon from './Icon.vue'

defineProps({
  inverted: { type: Boolean, default: false },
})
</script>

<template>
  <div class="wordmark">
    <Icon name="logo" :size="28" />
    <span :class="['mark-text', { inverted }]">kargopazar</span>
  </div>
</template>

<style scoped>
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.mark-text {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.02em;
  color: var(--ink-1);
}
.mark-text.inverted {
  color: var(--bg);
}
</style>
