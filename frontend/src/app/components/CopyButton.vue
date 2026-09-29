<script>
export async function copyText(text) {
  const s = String(text ?? '')
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(s)
      return true
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = s
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
</script>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  text: { type: [String, Number], required: true },
  label: { type: String, default: '' }, // visible label (variant 'button'); default "Kopyala"
  variant: { type: String, default: 'icon' }, // 'icon' | 'button' | 'dark' (for dark backgrounds)
  size: { type: String, default: 'sm' },
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['copied'])
const { t } = useI18n()
const done = ref(false)
let timer = null

async function copy() {
  const ok = await copyText(props.text)
  if (!ok) return
  done.value = true
  emit('copied', String(props.text))
  clearTimeout(timer)
  timer = setTimeout(() => (done.value = false), 1600)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button
    type="button"
    class="kpz-copy"
    :class="['v-' + variant, 'size-' + size, { done }]"
    :aria-label="done ? t('common.copied') : ariaLabel || label || t('common.copy')"
    :title="done ? t('common.copied') : ariaLabel || label || t('common.copy')"
    @click.stop="copy"
  >
    <Icon :name="done ? 'check' : 'copy'" :size="size === 'xs' ? 12 : 14" />
    <span v-if="variant === 'button'">{{ done ? t('common.copied') : label || t('common.copy') }}</span>
    <span v-else-if="done" class="cp-tip" aria-hidden="true">{{ t('common.copied') }}</span>
    <span class="sr-only" aria-live="polite">{{ done ? t('common.copied') : '' }}</span>
  </button>
</template>

<style scoped>
.kpz-copy {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none;
  border: 1px solid transparent; background: transparent; color: var(--ink-3); border-radius: 7px; transition: all 0.15s;
}
.v-icon.size-sm, .v-dark.size-sm { width: 28px; height: 28px; }
.v-icon.size-xs, .v-dark.size-xs { width: 22px; height: 22px; border-radius: 5px; }
.v-icon.size-md, .v-dark.size-md { width: 34px; height: 34px; }
.v-icon:hover { background: var(--bg-2); color: var(--ink-1); border-color: var(--line-1); }
.v-button { height: 32px; padding: 0 12px; border-color: var(--line-2); color: var(--ink-1); font-size: 13px; font-weight: 500; background: var(--surface); }
.v-button:hover { background: var(--bg-2); border-color: var(--line-strong); }
.v-dark { color: oklch(0.8 0.01 265); }
.v-dark:hover { background: rgba(255, 255, 255, 0.08); color: white; }
.done { color: var(--success) !important; }
.kpz-copy:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.cp-tip {
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: var(--ink-1); color: var(--bg); font-size: 11px; font-weight: 500; padding: 3px 7px; border-radius: 5px;
  white-space: nowrap; pointer-events: none; animation: kpz-tip 0.15s ease;
}
@keyframes kpz-tip { from { opacity: 0; transform: translate(-50%, 3px); } to { opacity: 1; transform: translate(-50%, 0); } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
