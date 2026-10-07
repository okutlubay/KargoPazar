<script>
import { hasLayers } from './layers.js'

// Date range helpers (also usable by screens for filtering rows).
const pad = n => String(n).padStart(2, '0')
export const toYmd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function presetRange(preset, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (preset === 'last7') start.setDate(end.getDate() - 6)
  else if (preset === 'last30') start.setDate(end.getDate() - 29)
  else if (preset === 'last90') start.setDate(end.getDate() - 89)
  else if (preset === 'thisMonth') start.setDate(1)
  else return null
  return { preset, from: toYmd(start), to: toYmd(end) }
}

/** { from: Date (00:00), to: Date (23:59:59.999) } or null. */
export function rangeBounds(range) {
  if (!range) return null
  const r = range.preset && range.preset !== 'custom' ? presetRange(range.preset) : range
  if (!r || (!r.from && !r.to)) return null
  const from = r.from ? new Date(r.from + 'T00:00:00') : new Date(0)
  const to = r.to ? new Date(r.to + 'T23:59:59.999') : new Date(8.64e15)
  return { from, to }
}

/** True when the ISO datetime falls inside the range (null range = always true). */
export function inRange(iso, range) {
  const b = rangeBounds(range)
  if (!b) return true
  if (!iso) return false
  const d = new Date(iso)
  return d >= b.from && d <= b.to
}

// Only the top-most mounted FilterBar reacts to "/".
const stack = []
function onSlash(e) {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
  const el = e.target
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
  if (hasLayers() || document.querySelector('[aria-modal="true"]')) return
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  top()
}
if (typeof window !== 'undefined') window.addEventListener('keydown', onSlash)
export function registerSlash(fn) { stack.push(fn); return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1) } }
</script>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import Popover from './Popover.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  search: { type: String, default: undefined }, // v-model:search (omit to hide the search box)
  searchPlaceholder: { type: String, default: '' },
  // [{ key, label, icon?, multiple = true, options: [{ value, label, icon?, count? }] }]
  chips: { type: Array, default: () => [] },
  filters: { type: Object, default: () => ({}) }, // v-model:filters { [key]: array (multiple) | value | null }
  range: { type: Object, default: undefined }, // v-model:range { preset, from, to } | null (omit to hide)
  defaultRange: { type: Object, default: null }, // value restored by "clear filters"
  rangePresets: { type: Array, default: () => ['last7', 'last30', 'last90', 'thisMonth', 'custom'] },
  showClear: { type: Boolean, default: true },
})
const emit = defineEmits(['update:search', 'update:filters', 'update:range', 'clear'])
const { t, fmt } = useI18n()
const searchEl = ref(null)

// ---- search
const hasSearch = computed(() => props.search !== undefined)
function onSearch(e) { emit('update:search', e.target.value) }
function clearSearch() { emit('update:search', ''); searchEl.value?.focus() }
let unregister = null
onMounted(() => { if (hasSearch.value) unregister = registerSlash(() => { searchEl.value?.focus(); searchEl.value?.select() }) })
onBeforeUnmount(() => unregister?.())

// ---- chips
const isMulti = c => c.multiple !== false
function selectedOf(c) {
  const v = props.filters?.[c.key]
  if (isMulti(c)) return Array.isArray(v) ? v : v == null || v === '' ? [] : [v]
  return v == null || v === '' ? [] : [v]
}
function isOn(c, value) { return selectedOf(c).includes(value) }
function toggleOpt(c, value, close) {
  const cur = selectedOf(c)
  let next
  if (isMulti(c)) next = cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value]
  else { next = cur[0] === value ? null : value; close?.() }
  emit('update:filters', { ...props.filters, [c.key]: next })
}
function clearChip(c) { emit('update:filters', { ...props.filters, [c.key]: isMulti(c) ? [] : null }) }
function chipSummary(c) {
  const sel = selectedOf(c)
  if (!sel.length) return ''
  const first = c.options.find(o => o.value === sel[0])
  return (first?.label ?? String(sel[0])) + (sel.length > 1 ? ' +' + (sel.length - 1) : '')
}

// ---- range
const hasRange = computed(() => props.range !== undefined)
const rangeActive = computed(() => {
  if (!hasRange.value || !props.range) return false
  if (!props.defaultRange) return true
  return JSON.stringify(props.range) !== JSON.stringify(props.defaultRange) && props.range.preset !== props.defaultRange.preset
})
const customFrom = ref('')
const customTo = ref('')
function pickPreset(p, close) {
  if (p === 'custom') {
    customFrom.value = props.range?.from || toYmd(new Date(Date.now() - 29 * 864e5))
    customTo.value = props.range?.to || toYmd(new Date())
    emit('update:range', { preset: 'custom', from: customFrom.value, to: customTo.value })
    return
  }
  emit('update:range', presetRange(p))
  close?.()
}
function applyCustom(close) {
  let from = customFrom.value, to = customTo.value
  if (from && to && from > to) [from, to] = [to, from]
  emit('update:range', { preset: 'custom', from, to })
  close?.()
}
function onRangeShow() {
  customFrom.value = props.range?.from || ''
  customTo.value = props.range?.to || ''
}
const rangeLabel = computed(() => {
  const r = props.range
  if (!r) return ''
  if (r.preset && r.preset !== 'custom') return t('common.' + r.preset)
  const f = r.from ? fmt.shortDate(r.from + 'T12:00:00') : '...'
  const to = r.to ? fmt.shortDate(r.to + 'T12:00:00') : '...'
  return f + ' - ' + to
})

// ---- clear all
const anyActive = computed(() =>
  (hasSearch.value && !!props.search) ||
  props.chips.some(c => selectedOf(c).length) ||
  rangeActive.value)
function clearAll() {
  if (hasSearch.value) emit('update:search', '')
  const f = { ...props.filters }
  for (const c of props.chips) f[c.key] = isMulti(c) ? [] : null
  emit('update:filters', f)
  if (hasRange.value) emit('update:range', props.defaultRange ? { ...props.defaultRange } : null)
  emit('clear')
}

defineExpose({ focusSearch: () => searchEl.value?.focus(), clearAll })
</script>

<template>
  <div class="kpz-filterbar">
    <div v-if="hasSearch" class="fb-search">
      <Icon name="search" :size="14" class="fb-s-icon" />
      <input
        ref="searchEl"
        type="search"
        class="input fb-s-input"
        :value="search"
        :placeholder="searchPlaceholder || t('common.searchPlaceholder')"
        :aria-label="searchPlaceholder || t('common.search')"
        @input="onSearch"
        @keydown.esc="search ? clearSearch() : $event.target.blur()"
      />
      <button v-if="search" type="button" class="fb-s-clear" :aria-label="t('components.filter.clearSearch')" @click="clearSearch"><Icon name="x" :size="12" /></button>
      <kbd v-else class="mono fb-kbd" aria-hidden="true">/</kbd>
    </div>

    <div class="fb-chips">
      <Popover v-for="c in chips" :key="c.key" placement="bottom-start" :width="240" :aria-label="c.label">
        <template #trigger="{ toggle, open, id }">
          <span class="fb-chip" :class="{ on: selectedOf(c).length, open }">
            <button type="button" :data-testid="'filter-chip-' + c.key" class="fb-chip-btn" :aria-expanded="open" :aria-controls="open ? id : undefined" aria-haspopup="dialog" @click="toggle">
              <Icon :name="c.icon || (selectedOf(c).length ? 'filter' : 'plus')" :size="12" />
              <span class="fb-chip-label">{{ c.label }}</span>
              <template v-if="selectedOf(c).length"><span class="fb-sep" aria-hidden="true" /><span class="fb-chip-val">{{ chipSummary(c) }}</span></template>
              <Icon name="chevron-down" :size="11" class="fb-caret" />
            </button>
            <button v-if="selectedOf(c).length" type="button" class="fb-chip-x" :aria-label="t('components.filter.clearChip', { name: c.label })" @click="clearChip(c)"><Icon name="x" :size="10" /></button>
          </span>
        </template>
        <template #default="{ close }">
          <div class="fb-pop-title">{{ c.label }}</div>
          <div class="fb-opts" role="group" :aria-label="c.label">
            <button
              v-for="o in c.options"
              :key="String(o.value)"
              type="button"
              class="fb-opt"
              :data-testid="'filter-opt-' + c.key + '-' + o.value"
              :role="isMulti(c) ? 'checkbox' : 'radio'"
              :aria-checked="isOn(c, o.value)"
              @click="toggleOpt(c, o.value, close)"
            >
              <span class="fb-check" :class="{ radio: !isMulti(c), on: isOn(c, o.value) }"><Icon v-if="isOn(c, o.value)" name="check" :size="10" /></span>
              <Icon v-if="o.icon" :name="o.icon" :size="13" class="fb-opt-icon" />
              <span class="fb-opt-label">{{ o.label }}</span>
              <span v-if="o.count != null" class="mono fb-opt-count">{{ fmt.number(o.count) }}</span>
            </button>
            <div v-if="!c.options.length" class="fb-none">{{ t('common.none') }}</div>
          </div>
          <div v-if="selectedOf(c).length" class="fb-pop-foot">
            <button type="button" class="btn btn-ghost btn-sm" @click="clearChip(c)">{{ t('components.filter.clear') }}</button>
          </div>
        </template>
      </Popover>

      <Popover v-if="hasRange" placement="bottom-start" :width="260" :aria-label="t('common.dateRange')" @show="onRangeShow">
        <template #trigger="{ toggle, open, id }">
          <span class="fb-chip" :class="{ on: rangeActive, open }">
            <button type="button" class="fb-chip-btn" :aria-expanded="open" :aria-controls="open ? id : undefined" aria-haspopup="dialog" @click="toggle">
              <Icon name="calendar" :size="12" />
              <span class="fb-chip-label">{{ range ? rangeLabel : t('common.dateRange') }}</span>
              <Icon name="chevron-down" :size="11" class="fb-caret" />
            </button>
          </span>
        </template>
        <template #default="{ close }">
          <div class="fb-pop-title">{{ t('common.dateRange') }}</div>
          <div class="fb-opts" role="radiogroup" :aria-label="t('common.dateRange')">
            <button
              v-for="p in rangePresets"
              :key="p"
              type="button"
              role="radio"
              class="fb-opt"
              :aria-checked="range?.preset === p"
              @click="pickPreset(p, close)"
            >
              <span class="fb-check radio" :class="{ on: range?.preset === p }"><Icon v-if="range?.preset === p" name="check" :size="10" /></span>
              <span class="fb-opt-label">{{ t('common.' + p) }}</span>
            </button>
          </div>
          <div v-if="range?.preset === 'custom'" class="fb-custom">
            <label class="fb-date">
              <span class="field-label">{{ t('common.from') }}</span>
              <input v-model="customFrom" type="date" class="input" :max="customTo || undefined" />
            </label>
            <label class="fb-date">
              <span class="field-label">{{ t('common.to') }}</span>
              <input v-model="customTo" type="date" class="input" :min="customFrom || undefined" />
            </label>
            <button type="button" class="btn btn-primary btn-sm" @click="applyCustom(close)">{{ t('common.apply') }}</button>
          </div>
        </template>
      </Popover>

      <slot name="chips" />

      <button v-if="showClear && anyActive" type="button" class="btn btn-sm fb-clear-all" @click="clearAll">
        <Icon name="x" :size="12" />{{ t('common.clearFilters') }}
      </button>
    </div>

    <div v-if="$slots.actions" class="fb-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.kpz-filterbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.fb-search { position: relative; flex: 0 1 300px; min-width: 200px; }
.fb-s-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--ink-3); pointer-events: none; }
.fb-s-input { height: 34px; padding-left: 32px; padding-right: 30px; font-size: 13.5px; }
.fb-s-input::-webkit-search-cancel-button { display: none; }
.fb-kbd {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10.5px; color: var(--ink-3);
  border: 1px solid var(--line-2); border-radius: 4px; padding: 0 5px; line-height: 16px; background: var(--bg-2);
}
.fb-s-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: var(--ink-3); display: inline-flex; align-items: center; justify-content: center; }
.fb-s-clear:hover { background: var(--bg-2); color: var(--ink-1); }
.fb-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.fb-chip {
  display: inline-flex; align-items: center; height: 30px; border-radius: 999px; border: 1px dashed var(--line-strong);
  background: var(--surface); color: var(--ink-2); font-size: 12.5px; font-weight: 500; max-width: 100%; transition: all 0.15s;
}
.fb-chip.on { border-style: solid; border-color: oklch(0.85 0.07 268); background: var(--accent-soft); color: var(--accent-ink); }
.fb-chip.open { box-shadow: 0 0 0 3px var(--accent-soft); }
.fb-chip-btn { display: inline-flex; align-items: center; gap: 6px; height: 100%; padding: 0 10px; border: 0; background: transparent; color: inherit; border-radius: 999px; min-width: 0; }
.fb-chip-label { white-space: nowrap; }
.fb-sep { width: 1px; height: 12px; background: currentColor; opacity: 0.25; }
.fb-chip-val { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.fb-caret { opacity: 0.6; }
.fb-chip-x { width: 22px; height: 22px; margin-right: 4px; margin-left: -4px; border: 0; border-radius: 999px; background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center; }
.fb-chip-x:hover { background: rgba(0, 0, 0, 0.06); }
.fb-pop-title { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); padding: 6px 8px 4px; }
.fb-opts { display: flex; flex-direction: column; gap: 1px; max-height: 300px; overflow: auto; }
.fb-opt { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border: 0; border-radius: 7px; background: transparent; text-align: left; font-size: 13px; color: var(--ink-1); }
.fb-opt:hover { background: var(--bg-2); }
.fb-check { width: 16px; height: 16px; flex: none; border-radius: 4px; border: 1px solid var(--line-strong); display: inline-flex; align-items: center; justify-content: center; background: var(--surface); color: white; }
.fb-check.radio { border-radius: 999px; }
.fb-check.on { background: var(--accent); border-color: var(--accent); }
.fb-opt-icon { color: var(--ink-3); }
.fb-opt-label { flex: 1; min-width: 0; }
.fb-opt-count { font-size: 11px; color: var(--ink-3); }
.fb-none { padding: 8px; font-size: 12.5px; color: var(--ink-3); }
.fb-pop-foot { border-top: 1px solid var(--line-1); margin-top: 4px; padding: 6px 2px 0; display: flex; justify-content: flex-end; }
.fb-custom { border-top: 1px solid var(--line-1); margin-top: 4px; padding: 8px 4px 4px; display: flex; flex-direction: column; gap: 8px; }
.fb-date { display: flex; flex-direction: column; }
.fb-date .input { height: 34px; font-size: 13px; }
.fb-custom .btn { align-self: flex-end; }
.fb-clear-all { background: transparent; color: var(--ink-2); border-color: transparent; height: 30px; }
.fb-clear-all:hover { background: var(--bg-2); color: var(--ink-1); }
.fb-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.fb-chip-btn:focus-visible, .fb-chip-x:focus-visible, .fb-opt:focus-visible, .fb-s-clear:focus-visible, .fb-clear-all:focus-visible {
  outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent);
}
@media (max-width: 560px) { .fb-search { flex: 1 1 100%; } }
</style>
