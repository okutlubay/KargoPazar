<script setup>
// HS code chooser: search the 24 known codes or type any 6 digit code.
//   <HsCodePicker v-model="code" :exclude="['5702.42']" />
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '../../i18n/index.js'
import { hsCodeList, normalizeHsCode } from '../../api/ai.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  highlight: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])
const { t, tx } = useI18n()
const q = ref('')
const free = ref('')
const freeError = ref('')
const codes = hsCodeList()

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  const digits = s.replace(/\D/g, '')
  return codes.filter(c => !s || c.code.replace('.', '').includes(digits || '###') || tx(c.desc).toLowerCase().includes(s) || String(c.customsDesc || '').toLowerCase().includes(s))
})
function pick(code) { freeError.value = ''; emit('update:modelValue', code) }
function useFree() {
  const c = normalizeHsCode(free.value)
  if (!c) { freeError.value = t('aiHs.picker.invalid'); return }
  freeError.value = ''
  emit('update:modelValue', c)
}
const isKnown = computed(() => codes.some(c => c.code === props.modelValue))
</script>

<template>
  <div class="hp">
    <div class="search">
      <Icon name="search" :size="14" class="si" />
      <input v-model="q" data-testid="hs-picker-search" class="input" :placeholder="t('aiHs.picker.search')" :aria-label="t('aiHs.picker.search')" />
    </div>
    <div class="list" role="listbox" :aria-label="t('aiHs.picker.title')">
      <button v-for="c in list" :key="c.code" :data-testid="'hs-picker-opt-' + c.code" type="button" role="option" :aria-selected="modelValue === c.code"
        :class="['opt', { on: modelValue === c.code, hl: highlight.includes(c.code) }]" @click="pick(c.code)">
        <span class="code num">{{ c.code }}</span>
        <span class="desc">{{ tx(c.desc) }}</span>
        <Icon v-if="modelValue === c.code" name="check" :size="14" class="chk" />
      </button>
      <div v-if="!list.length" class="none">{{ t('aiHs.picker.none') }}</div>
    </div>
    <div class="free">
      <label class="free-l" for="hs-free">{{ t('aiHs.picker.free') }}</label>
      <div class="free-row">
        <input id="hs-free" v-model="free" class="input num" :class="{ invalid: freeError }" inputmode="numeric" maxlength="7" placeholder="630492" @keydown.enter.prevent="useFree" />
        <button type="button" class="btn btn-ghost btn-sm" @click="useFree">{{ t('aiHs.picker.useCode') }}</button>
      </div>
      <div v-if="freeError" class="field-error">{{ freeError }}</div>
      <div v-else-if="modelValue && !isKnown" class="field-hint">{{ t('aiHs.picker.customSelected', { code: modelValue }) }}</div>
    </div>
  </div>
</template>

<style scoped>
.hp { display: flex; flex-direction: column; gap: 10px; }
.search { position: relative; }
.si { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--ink-3); }
.search .input { width: 100%; padding-left: 32px; }
.list { max-height: 260px; overflow-y: auto; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.opt { display: grid; grid-template-columns: 70px 1fr 16px; gap: 10px; align-items: center; width: 100%; text-align: left; padding: 8px 12px; background: none; border: 0; border-bottom: 1px solid var(--line-1); font-size: 13px; cursor: pointer; color: var(--ink-1); }
.opt:last-child { border-bottom: 0; }
.opt:hover { background: var(--bg-2); }
.opt.on { background: var(--accent-soft); }
.opt.hl .code { color: var(--accent); }
.code { font-family: var(--font-mono); font-weight: 600; font-size: 12.5px; }
.desc { color: var(--ink-2); }
.chk { color: var(--accent); }
.none { padding: 14px; color: var(--ink-3); font-size: 13px; text-align: center; }
.free-l { font-size: 12.5px; color: var(--ink-3); }
.free-row { display: flex; gap: 8px; margin-top: 4px; }
.free-row .input { width: 140px; }
</style>
