<script>
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Plain-span JSON highlighter (no external libs).
export function highlightJson(src) {
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index))
    const tok = m[0]
    let cls = 'num'
    if (tok[0] === '"') cls = m[2] ? 'key' : 'str'
    else if (tok === 'true' || tok === 'false') cls = 'bool'
    else if (tok === 'null') cls = 'null'
    if (cls === 'key') {
      const colon = tok.lastIndexOf(':')
      out += `<span class="tk-key">${esc(tok.slice(0, colon).trimEnd())}</span>${esc(tok.slice(tok.slice(0, colon).trimEnd().length))}`
    } else {
      out += `<span class="tk-${cls}">${esc(tok)}</span>`
    }
    last = m.index + tok.length
  }
  return out + esc(src.slice(last))
}

// Minimal shell highlighter: comments, strings, flags.
export function highlightShell(src) {
  return src.split('\n').map(line => {
    if (/^\s*#/.test(line)) return `<span class="tk-com">${esc(line)}</span>`
    return esc(line)
      .replace(/(&quot;|")(.*?)(\1)/g, '<span class="tk-str">$1$2$3</span>')
      .replace(/(\s)(--?[a-zA-Z][\w-]*)/g, '$1<span class="tk-key">$2</span>')
  }).join('\n')
}
</script>

<script setup>
import { computed } from 'vue'
import CopyButton from './CopyButton.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  code: { type: [String, Object, Array], default: '' }, // objects are JSON.stringify'd
  modelValue: { type: String, default: undefined }, // editable mode (v-model)
  language: { type: String, default: 'json' }, // 'json' | 'shell' | 'text'
  editable: { type: Boolean, default: false },
  lineNumbers: { type: Boolean, default: false },
  copyable: { type: Boolean, default: true },
  title: { type: String, default: '' },
  maxHeight: { type: [Number, String], default: 420 },
  rows: { type: Number, default: 12 }, // textarea rows in editable mode
  wrap: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'valid'])
const { t } = useI18n()

const text = computed(() => {
  if (props.editable || props.modelValue !== undefined) return props.modelValue ?? ''
  if (typeof props.code === 'string') return props.code
  return JSON.stringify(props.code, null, 2)
})
const html = computed(() => {
  if (props.language === 'json') return highlightJson(text.value)
  if (props.language === 'shell') return highlightShell(text.value)
  return text.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
})
const lineCount = computed(() => text.value.split('\n').length)
const jsonError = computed(() => {
  if (!props.editable || props.language !== 'json' || !text.value.trim()) return ''
  try { JSON.parse(text.value); return '' } catch { return t('components.code.invalidJson') }
})
const mh = computed(() => (typeof props.maxHeight === 'number' ? props.maxHeight + 'px' : props.maxHeight))

function onInput(e) {
  emit('update:modelValue', e.target.value)
  if (props.language === 'json') {
    let ok = true
    try { JSON.parse(e.target.value) } catch { ok = false }
    emit('valid', ok)
  }
}
function onTab(e) {
  const ta = e.target
  const s = ta.selectionStart, en = ta.selectionEnd
  ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en)
  ta.selectionStart = ta.selectionEnd = s + 2
  onInput(e)
}
</script>

<template>
  <div class="kpz-code" :class="{ editable, invalid: !!jsonError }">
    <div v-if="title || copyable" class="cb-head">
      <span class="mono cb-title">{{ title || language.toUpperCase() }}</span>
      <CopyButton v-if="copyable" :text="text" variant="dark" size="xs" />
    </div>
    <div class="cb-body" :style="{ maxHeight: editable ? undefined : mh }">
      <div v-if="lineNumbers && !editable" class="mono cb-lines" aria-hidden="true">
        <span v-for="n in lineCount" :key="n">{{ n }}</span>
      </div>
      <textarea
        v-if="editable"
        class="mono cb-textarea"
        :value="text"
        :rows="rows"
        spellcheck="false"
        :aria-label="title || t('components.code.editor')"
        :aria-invalid="!!jsonError"
        @input="onInput"
        @keydown.tab.prevent="onTab"
      />
      <!-- eslint-disable-next-line vue/no-v-html -->
      <pre v-else class="mono cb-pre" :class="{ wrap }"><code v-html="html" /></pre>
    </div>
    <div v-if="jsonError" class="cb-error" role="alert">{{ jsonError }}</div>
  </div>
</template>

<style scoped>
.kpz-code {
  background: var(--ink-1); color: oklch(0.92 0.01 265); border-radius: var(--r-md); overflow: hidden;
  border: 1px solid oklch(0.28 0.02 265); min-width: 0;
}
.kpz-code.invalid { border-color: var(--danger); }
.cb-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 8px 6px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.cb-title { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: oklch(0.7 0.01 265); }
.cb-body { display: flex; overflow: auto; }
.cb-lines {
  display: flex; flex-direction: column; padding: 12px 10px 12px 14px; text-align: right; user-select: none;
  color: oklch(0.5 0.01 265); font-size: 12.5px; line-height: 1.65; border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.cb-pre { margin: 0; padding: 12px 14px; font-size: 12.5px; line-height: 1.65; white-space: pre; flex: 1; min-width: 0; }
.cb-pre.wrap { white-space: pre-wrap; word-break: break-word; }
.cb-textarea {
  width: 100%; border: 0; resize: vertical; background: transparent; color: inherit;
  font-size: 12.5px; line-height: 1.65; padding: 12px 14px; tab-size: 2;
}
.cb-textarea:focus { outline: none; box-shadow: inset 0 0 0 2px oklch(0.62 0.18 268 / 0.6); }
.cb-error { font-size: 12px; color: oklch(0.8 0.1 25); padding: 6px 14px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.cb-pre :deep(.tk-key) { color: oklch(0.8 0.1 268); }
.cb-pre :deep(.tk-str) { color: oklch(0.82 0.12 150); }
.cb-pre :deep(.tk-num) { color: oklch(0.83 0.12 75); }
.cb-pre :deep(.tk-bool) { color: oklch(0.78 0.14 25); }
.cb-pre :deep(.tk-null) { color: oklch(0.65 0.01 265); font-style: italic; }
.cb-pre :deep(.tk-com) { color: oklch(0.6 0.01 265); }
</style>
