<script setup>
// 4x6 label preview rendered from the same generator as the PDF (docs/label.js labelSvg).
//   <LabelPreview :shipment="s" :opts="{ dummy, platformRef, replaced, isReturn }" :width="300" printable />
import { ref, watch } from 'vue'
import Skeleton from '../Skeleton.vue'
import { locale } from '../../i18n/index.js'

const props = defineProps({
  shipment: { type: Object, default: null },
  opts: { type: Object, default: () => ({}) },
  width: { type: Number, default: 300 },
  printable: { type: Boolean, default: false },
})
const svg = ref('')
const failed = ref(false)

async function render() {
  if (!props.shipment) { svg.value = ''; return }
  try {
    const d = await import('../../docs/index.js')
    svg.value = d.labelSvg(props.shipment, { ...props.opts, width: props.width })
    failed.value = false
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[label preview]', e)
    failed.value = true
  }
}
watch(() => [props.shipment, props.opts, locale.value], render, { immediate: true, deep: true })
</script>

<template>
  <div class="lp" :class="{ 'print-area': printable }" :style="{ width: width + 'px' }">
    <div v-if="svg" class="lp-svg" v-html="svg" />
    <Skeleton v-else-if="!failed" variant="rect" :width="width" :height="Math.round(width * 1.5)" />
    <div v-else class="lp-fail">-</div>
  </div>
</template>

<style scoped>
.lp { max-width: 100%; }
.lp-svg { border-radius: 6px; overflow: hidden; box-shadow: var(--shadow-md); background: white; line-height: 0; }
.lp-svg :deep(svg) { width: 100%; height: auto; display: block; }
.lp-fail { aspect-ratio: 2 / 3; display: grid; place-items: center; border: 1px dashed var(--line-2); border-radius: 6px; color: var(--ink-4); }
</style>
