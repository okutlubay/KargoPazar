<script setup>
// Terminal style live log for the integration test runner (spec 9.4).
import { ref, watch, nextTick, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import CopyButton from '@/app/components/CopyButton.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  lines: { type: Array, default: () => [] }, // [{ at, kind, text }]
  running: { type: Boolean, default: false },
  title: { type: String, default: '' },
  height: { type: Number, default: 360 },
})
const emit = defineEmits(['clear'])
const { t } = useI18n()
const box = ref(null)
const follow = ref(true)

function onScroll() {
  const el = box.value
  if (!el) return
  follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 30
}
watch(() => props.lines.length, async () => {
  if (!follow.value) return
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
})
const stamp = iso => { const d = new Date(iso); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0') }
const plain = computed(() => props.lines.map(l => `[${stamp(l.at)}] ${l.text}`).join('\n'))
</script>

<template>
  <div class="term">
    <div class="th">
      <span class="dots" aria-hidden="true"><i /><i /><i /></span>
      <span class="tt">{{ title || t('tests.log.title') }}</span>
      <span v-if="running" class="live"><span class="pulse" />{{ t('tests.log.live') }}</span>
      <span class="grow" />
      <CopyButton v-if="lines.length" :text="plain" variant="dark" size="xs" :aria-label="t('tests.log.copy')" />
      <button type="button" class="tb" :disabled="!lines.length || running" :aria-label="t('tests.log.clear')" :title="t('tests.log.clear')" @click="emit('clear')"><Icon name="trash" :size="13" /></button>
    </div>
    <div ref="box" class="tbody" :style="{ height: height + 'px' }" role="log" aria-live="polite" @scroll="onScroll">
      <div v-if="!lines.length" class="empty">{{ t('tests.log.empty') }}</div>
      <div v-for="(l, i) in lines" :key="i" class="ln" :class="l.kind">
        <span class="ts">{{ stamp(l.at) }}</span><span class="tx">{{ l.text }}</span>
      </div>
      <div v-if="running" class="ln cursor"><span class="ts" /><span class="blink">_</span></div>
    </div>
  </div>
</template>

<style scoped>
.term { background: var(--ink-1); border-radius: var(--r-lg); overflow: hidden; color: oklch(0.9 0.01 265); box-shadow: var(--shadow-md); }
.th { display: flex; align-items: center; gap: 10px; padding: 9px 14px; background: oklch(0.24 0.02 265); font-size: 12px; }
.dots { display: inline-flex; gap: 5px; }
.dots i { width: 9px; height: 9px; border-radius: 50%; background: oklch(0.45 0.02 265); display: block; }
.dots i:nth-child(1) { background: oklch(0.65 0.18 25); } .dots i:nth-child(2) { background: oklch(0.8 0.14 80); } .dots i:nth-child(3) { background: oklch(0.7 0.15 150); }
.tt { font-family: var(--font-mono); color: oklch(0.8 0.01 265); }
.live { display: inline-flex; align-items: center; gap: 6px; color: oklch(0.82 0.14 150); font-weight: 600; font-family: var(--font-mono); }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: oklch(0.75 0.16 150); animation: p 1s infinite; }
@keyframes p { 50% { opacity: .3 } }
.grow { flex: 1; }
.tb { background: none; border: 0; color: oklch(0.75 0.01 265); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; }
.tb:hover:not(:disabled) { background: oklch(0.3 0.02 265); color: #fff; }
.tb:disabled { opacity: .4; cursor: default; }
.tbody { overflow: auto; padding: 10px 14px; font-family: var(--font-mono); font-size: 12px; line-height: 1.65; }
.empty { color: oklch(0.6 0.01 265); padding: 20px 0; text-align: center; }
.ln { display: flex; gap: 12px; white-space: pre-wrap; word-break: break-word; }
.ts { color: oklch(0.55 0.01 265); flex-shrink: 0; min-width: 88px; }
.ln.req .tx { color: oklch(0.78 0.08 240); }
.ln.ok .tx { color: oklch(0.82 0.14 150); }
.ln.fail .tx { color: oklch(0.75 0.16 25); font-weight: 600; }
.ln.info .tx { color: oklch(0.78 0.01 265); }
.ln.head .tx { color: #fff; font-weight: 600; }
.ln.sum .tx { color: oklch(0.86 0.12 85); font-weight: 600; }
.blink { animation: p 1s steps(1) infinite; }
</style>
