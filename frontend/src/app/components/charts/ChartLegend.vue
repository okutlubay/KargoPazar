<script setup>
// Internal legend. items: [{ key, label, color, shape: 'square'|'line'|'dashed'|'dot', off, extra }]
import { useI18n } from '@/app/i18n/index.js'

defineProps({
  items: { type: Array, default: () => [] },
  interactive: { type: Boolean, default: true },
})
const emit = defineEmits(['toggle', 'hover'])
const { t } = useI18n()
</script>

<template>
  <div class="kc-legend">
    <component
      :is="interactive ? 'button' : 'span'"
      v-for="it in items"
      :key="it.key"
      class="kc-legend-item"
      :class="{ off: it.off }"
      :type="interactive ? 'button' : undefined"
      :aria-pressed="interactive ? String(!it.off) : undefined"
      :aria-label="interactive ? t('charts.toggleSeries', { label: it.label }) : undefined"
      @click="interactive && emit('toggle', it.key)"
      @mouseenter="emit('hover', it.key)"
      @mouseleave="emit('hover', null)"
    >
      <span
        class="kc-swatch"
        :class="it.shape"
        :style="it.shape === 'dashed' ? { color: it.color } : { background: it.color }"
      />
      <span class="kc-legend-label">{{ it.label }}</span>
      <span v-if="it.extra != null && it.extra !== ''" class="kc-legend-extra">{{ it.extra }}</span>
    </component>
  </div>
</template>
