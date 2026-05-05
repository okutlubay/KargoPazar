<script setup>
import { computed } from 'vue'

const props = defineProps({
  eyebrow: String,
  title: String,
  sub: { type: String, default: '' },
  align: { type: String, default: 'left' },
})

const titleLines = computed(() => (props.title || '').split('\n'))
</script>

<template>
  <div :class="['section-header', `align-${align}`]">
    <div class="eyebrow">{{ eyebrow }}</div>
    <h2 class="h-1">
      <template v-for="(line, i) in titleLines" :key="i">
        {{ line }}<br v-if="i < titleLines.length - 1" />
      </template>
    </h2>
    <p v-if="sub" class="lede">{{ sub }}</p>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
.section-header.align-center { align-items: center; margin: 0 auto; text-align: center; }
.section-header.align-left { align-items: flex-start; }
.section-header h2 { margin: 0; }
.section-header p { margin: 0; }
</style>
