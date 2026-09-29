<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'

const props = defineProps({ doc: { type: String, required: true } })
const emit = defineEmits(['close'])
const { t, f, lang } = useI18n()

const DOCS = ['privacy', 'terms', 'kvkk', 'cookies']
const current = ref(DOCS.includes(props.doc) ? props.doc : 'privacy')
const content = computed(() => t.value.legal[current.value])
const updated = computed(() => new Date(2026, 8, 1).toLocaleDateString(lang.value === 'tr' ? 'tr-TR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }))

const dialog = ref(null)
let lastFocus = null
const close = () => emit('close')
const onKey = (e) => {
  if (e.key === 'Escape') close()
  if (e.key === 'Tab' && dialog.value) {
    const els = dialog.value.querySelectorAll('button, a[href]')
    if (!els.length) return
    const first = els[0]
    const last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
}
onMounted(async () => {
  lastFocus = document.activeElement
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  await nextTick()
  const btn = dialog.value && dialog.value.querySelector('.close')
  if (btn) btn.focus()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  if (lastFocus && lastFocus.focus) lastFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="close">
      <div ref="dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title">
        <div class="head">
          <div class="tabs" role="tablist">
            <button
              v-for="d in DOCS"
              :key="d"
              type="button"
              role="tab"
              :aria-selected="current === d"
              :class="['tab', { active: current === d }]"
              @click="current = d"
            >{{ t.legal.names[d] }}</button>
          </div>
          <button type="button" class="close" :aria-label="t.common.close" @click="close"><Icon name="x" :size="16" /></button>
        </div>
        <div class="body">
          <h2 id="legal-title" class="h-3">{{ content.title }}</h2>
          <p class="mono updated">{{ f(t.legal.updated, { date: updated }) }}</p>
          <p v-for="(p, i) in content.body" :key="current + i" class="para">{{ p }}</p>
        </div>
        <div class="foot">
          <button type="button" class="btn btn-primary btn-sm" @click="close">{{ t.common.close }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(16, 18, 32, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 16px; animation: fade 0.15s ease;
}
.dialog {
  width: 100%; max-width: 620px; max-height: calc(100vh - 32px);
  background: var(--surface); border-radius: 16px; box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; overflow: hidden;
  animation: pop 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--line-1); }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.tab {
  height: 30px; padding: 0 12px; border-radius: 8px; border: 0; cursor: pointer;
  background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 500;
}
.tab:hover { background: var(--bg-2); }
.tab.active { background: var(--ink-1); color: var(--bg); }
.close {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line-2); flex: 0 0 auto;
  background: var(--surface); color: var(--ink-2); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.body { padding: 20px 24px; overflow-y: auto; }
.body h2 { margin: 0 0 4px; }
.updated { margin: 0 0 16px; font-size: 11px; color: var(--ink-4); }
.para { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.foot { display: flex; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid var(--line-1); background: var(--bg-2); }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
</style>
