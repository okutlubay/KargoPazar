<script setup>
// Small "Kur: demo, 1 USD = 41,60 TRY" note for screens that show converted totals.
//   <FxNote />            hidden while the display currency is USD
//   <FxNote always />     always visible (shows the TRY rate when the display currency is USD)
import { computed } from 'vue'
import { useI18n } from '../i18n/index.js'
import { fx, rate } from '@/shared/currency.js'

const props = defineProps({
  always: { type: Boolean, default: false },
  inline: { type: Boolean, default: false },
})
const { t, fmt } = useI18n()
const cur = computed(() => (fx.display === 'USD' ? 'TRY' : fx.display))
const visible = computed(() => props.always || fx.display !== 'USD')
const text = computed(() => t('fx.note', { rate: fmt.number(rate(cur.value), cur.value === 'TRY' ? 2 : 4), cur: cur.value }))
const title = computed(() => t('fx.noteTitle', { date: fmt.date(fx.date) }))
</script>

<template>
  <span v-if="visible" class="kpz-fx-note" :class="{ inline }" :title="title">{{ text }}</span>
</template>

<style scoped>
.kpz-fx-note { display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 4px; font-variant-numeric: tabular-nums; }
.kpz-fx-note.inline { display: inline; margin: 0 0 0 6px; }
</style>
