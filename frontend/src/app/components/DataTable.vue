<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import Skeleton from './Skeleton.vue'
import EmptyState from './EmptyState.vue'
import Popover from './Popover.vue'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  // [{ key, label, sortable?, align?: 'left'|'right'|'center', width?, hideBelow?: 'md'|'lg', visible?: true,
  //    hideable?: true, format?: (value, row) => string, value?: row => any, sortValue?: row => any,
  //    nowrap?: bool, hideOnCard?: bool, className? }]
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  rowKey: { type: [String, Function], default: 'id' },
  loading: { type: Boolean, default: false },
  selectable: { type: Boolean, default: false },
  selected: { type: Array, default: () => [] }, // v-model:selected (row keys)
  pageSizes: { type: Array, default: () => [25, 50, 100] },
  pageSize: { type: Number, default: null }, // initial page size (default pageSizes[0])
  paginate: { type: Boolean, default: true },
  defaultSort: { type: Object, default: null }, // { key, dir: 'asc'|'desc' }
  emptyTitle: { type: String, default: '' },
  emptyDesc: { type: String, default: '' },
  emptyIcon: { type: String, default: 'box' },
  emptyActionLabel: { type: String, default: '' }, // shows a button in the (unfiltered) empty state, emits empty-action
  filtered: { type: Boolean, default: false }, // rows are filtered -> "no results for these filters" + clear button
  stickyHeader: { type: Boolean, default: true },
  maxHeight: { type: [String, Number], default: null }, // makes the table body scroll inside the card
  highlightKeys: { type: [Array, Set], default: () => [] },
  rowClass: { type: Function, default: null }, // row => string | object
  clickable: { type: Boolean, default: true }, // rows emit row-click and show pointer cursor
  storageKey: { type: String, default: '' }, // persists hidden columns + page size
  columnMenu: { type: Boolean, default: true },
  cardBreakpoint: { type: Number, default: 860 },
  dense: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['row-click', 'sort', 'update:selected', 'clear-filters', 'empty-action', 'page'])
const { t, fmt, locale } = useI18n()

// ---- persistence
const STORE = computed(() => (props.storageKey ? `kpz_demo:ui:table:${props.storageKey}` : ''))
function loadPrefs() {
  if (!STORE.value) return null
  try { return JSON.parse(localStorage.getItem(STORE.value) || 'null') } catch { return null }
}
function savePrefs() {
  if (!STORE.value) return
  try { localStorage.setItem(STORE.value, JSON.stringify({ hidden: [...hidden.value], pageSize: size.value })) } catch { /* ignore */ }
}
const prefs = loadPrefs()

// ---- columns
const hidden = ref(new Set(prefs?.hidden ?? props.columns.filter(c => c.visible === false).map(c => c.key)))
const shownCols = computed(() => props.columns.filter(c => !hidden.value.has(c.key)))
const hideableCols = computed(() => props.columns.filter(c => c.hideable !== false && c.label))
function toggleCol(c) {
  const s = new Set(hidden.value)
  if (s.has(c.key)) s.delete(c.key)
  else if (shownCols.value.length > 1) s.add(c.key)
  hidden.value = s
  savePrefs()
}
function resetCols() {
  hidden.value = new Set(props.columns.filter(c => c.visible === false).map(c => c.key))
  savePrefs()
}

// ---- keys + values
const keyOf = row => (typeof props.rowKey === 'function' ? props.rowKey(row) : row?.[props.rowKey])
function rawValue(c, row) {
  if (c.value) return c.value(row)
  if (!c.key.includes('.')) return row?.[c.key]
  return c.key.split('.').reduce((o, k) => (o == null ? o : o[k]), row)
}
function display(c, row) {
  const v = rawValue(c, row)
  const out = c.format ? c.format(v, row) : v
  return out == null || out === '' ? '-' : out
}

// ---- sorting
const sort = ref(props.defaultSort ? { ...props.defaultSort } : { key: null, dir: null })
function toggleSort(c) {
  if (!c.sortable) return
  let dir = 'asc'
  if (sort.value.key === c.key) dir = sort.value.dir === 'asc' ? 'desc' : sort.value.dir === 'desc' ? null : 'asc'
  sort.value = { key: dir ? c.key : null, dir }
  page.value = 1
  emit('sort', { ...sort.value })
}
const sortedRows = computed(() => {
  const rows = props.rows || []
  const { key, dir } = sort.value
  if (!key || !dir) return rows
  const c = props.columns.find(x => x.key === key)
  if (!c) return rows
  const get = c.sortValue || (r => rawValue(c, r))
  const coll = new Intl.Collator(locale.value === 'tr' ? 'tr-TR' : 'en-US', { numeric: true, sensitivity: 'base' })
  const m = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = get(a), vb = get(b)
    const ea = va == null || va === '', eb = vb == null || vb === ''
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1 // empties always last
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m
    if (typeof va === 'boolean' || typeof vb === 'boolean') return (Number(va) - Number(vb)) * m
    return coll.compare(String(va), String(vb)) * m
  })
})
function ariaSort(c) {
  if (!c.sortable) return undefined
  if (sort.value.key !== c.key) return 'none'
  return sort.value.dir === 'asc' ? 'ascending' : 'descending'
}

// ---- pagination
const size = ref(prefs?.pageSize && props.pageSizes.includes(prefs.pageSize) ? prefs.pageSize : props.pageSize || props.pageSizes[0] || 25)
const page = ref(1)
const total = computed(() => sortedRows.value.length)
const pageCount = computed(() => (props.paginate ? Math.max(1, Math.ceil(total.value / size.value)) : 1))
const pageRows = computed(() => {
  if (!props.paginate) return sortedRows.value
  const start = (page.value - 1) * size.value
  return sortedRows.value.slice(start, start + size.value)
})
const fromIdx = computed(() => (total.value ? (page.value - 1) * size.value + 1 : 0))
const toIdx = computed(() => (props.paginate ? Math.min(total.value, page.value * size.value) : total.value))
watch(() => props.rows?.length, (n, o) => { if (n !== o) page.value = 1 })
watch(pageCount, n => { if (page.value > n) page.value = n })
function setSize(e) {
  size.value = Number(e.target.value)
  page.value = 1
  savePrefs()
}
function go(p) {
  page.value = Math.min(Math.max(1, p), pageCount.value)
  emit('page', page.value)
}

// ---- selection
const selSet = computed(() => new Set(props.selected))
const pageKeys = computed(() => pageRows.value.map(keyOf))
const allPageSelected = computed(() => pageKeys.value.length > 0 && pageKeys.value.every(k => selSet.value.has(k)))
const somePageSelected = computed(() => pageKeys.value.some(k => selSet.value.has(k)))
const allSelected = computed(() => total.value > 0 && sortedRows.value.every(r => selSet.value.has(keyOf(r))))
function toggleRow(row) {
  const k = keyOf(row)
  emit('update:selected', selSet.value.has(k) ? props.selected.filter(x => x !== k) : [...props.selected, k])
}
function togglePage() {
  if (allPageSelected.value) emit('update:selected', props.selected.filter(k => !pageKeys.value.includes(k)))
  else emit('update:selected', [...new Set([...props.selected, ...pageKeys.value])])
}
function selectAll() { emit('update:selected', sortedRows.value.map(keyOf)) }
function clearSelection() { emit('update:selected', []) }

// ---- highlight / classes
const hlSet = computed(() => (props.highlightKeys instanceof Set ? props.highlightKeys : new Set(props.highlightKeys || [])))
function rowClasses(row) {
  const k = keyOf(row)
  return [props.rowClass ? props.rowClass(row) : null, { 'is-selected': selSet.value.has(k), 'is-hl': hlSet.value.has(k), 'is-click': props.clickable }]
}

// ---- row click
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="menu"], [data-no-row-click]'
function onRowClick(row, e) {
  if (!props.clickable) return
  if (e.target?.closest?.(INTERACTIVE)) return
  if (window.getSelection?.()?.toString()) return
  emit('row-click', row, e)
}
function onRowKey(row, e) {
  if (!props.clickable || e.target !== e.currentTarget) return
  e.preventDefault()
  emit('row-click', row, e)
}

// ---- responsive card mode
const isCards = ref(false)
let mq = null
const onMq = () => { isCards.value = !!mq?.matches }
onMounted(() => {
  mq = window.matchMedia(`(max-width: ${props.cardBreakpoint}px)`)
  onMq()
  mq.addEventListener?.('change', onMq)
})
onBeforeUnmount(() => mq?.removeEventListener?.('change', onMq))
const titleCol = computed(() => shownCols.value[0])
const actionCol = computed(() => shownCols.value.find(c => c.key === 'actions' || c.isAction))
const cardCols = computed(() => shownCols.value.slice(1).filter(c => c !== actionCol.value && !c.hideOnCard))

// ---- states
const skeletonCount = computed(() => Math.min(size.value, 8))
const isEmpty = computed(() => !props.loading && total.value === 0)
const colSpan = computed(() => shownCols.value.length + (props.selectable ? 1 : 0) + (props.columnMenu ? 1 : 0))
const mh = computed(() => (props.maxHeight == null ? null : typeof props.maxHeight === 'number' ? props.maxHeight + 'px' : props.maxHeight))
const w = c => (c.width == null ? undefined : typeof c.width === 'number' ? c.width + 'px' : c.width)
const skW = i => ['72%', '54%', '86%', '64%', '48%'][i % 5]

defineExpose({ page, pageSize: size, sort, goToPage: go, resetColumns: resetCols })
</script>

<template>
  <div class="kpz-table" :class="{ dense, sticky: stickyHeader, cards: isCards }">
    <!-- bulk action bar -->
    <div v-if="selectable && selected.length" class="dt-bulk" role="region" :aria-label="t('components.table.bulkAria')">
      <span class="dt-bulk-count">{{ t('common.selected', { n: fmt.number(selected.length) }) }}</span>
      <button v-if="!allSelected && total > pageRows.length" type="button" class="dt-link" @click="selectAll">
        {{ t('components.table.selectAll', { n: fmt.number(total) }) }}
      </button>
      <div class="dt-bulk-actions"><slot name="bulk" :selected="selected" :clear="clearSelection" /></div>
      <button type="button" class="dt-bulk-x" :aria-label="t('components.table.clearSelection')" @click="clearSelection"><Icon name="x" :size="13" /></button>
    </div>

    <!-- ===== table mode ===== -->
    <div v-if="!isCards" class="dt-scroll" :class="{ 'has-max': !!mh, clipx: stickyHeader && !mh }" :style="{ maxHeight: mh || undefined }">
      <table :aria-label="ariaLabel || undefined" :aria-busy="loading">
        <thead>
          <tr>
            <th v-if="selectable" class="dt-check" scope="col">
              <input
                type="checkbox"
                class="dt-cb"
                :checked="allPageSelected"
                :indeterminate.prop="somePageSelected && !allPageSelected"
                :disabled="loading || !pageRows.length"
                :aria-label="t('components.table.selectPage')"
                @change="togglePage"
              />
            </th>
            <th
              v-for="c in shownCols"
              :key="c.key"
              scope="col"
              :class="['al-' + (c.align || 'left'), c.hideBelow ? 'hb-' + c.hideBelow : null, { sortable: c.sortable, sorted: sort.key === c.key }]"
              :aria-sort="ariaSort(c)"
              :style="{ width: w(c) }"
            >
              <button v-if="c.sortable" type="button" class="dt-sort" @click="toggleSort(c)">
                <span>{{ c.label }}</span>
                <Icon :name="sort.key === c.key ? (sort.dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'sort'" :size="11" class="dt-sort-ic" />
              </button>
              <span v-else>{{ c.label }}</span>
            </th>
            <th v-if="columnMenu" class="dt-colmenu" scope="col">
              <Popover placement="bottom-end" :width="220" :aria-label="t('common.columns')">
                <template #trigger="{ toggle, open, id }">
                  <button type="button" class="dt-icon-btn" :class="{ active: open }" :aria-label="t('components.table.columnsMenu')" :aria-expanded="open" :aria-controls="open ? id : undefined" @click="toggle">
                    <Icon name="settings" :size="13" />
                  </button>
                </template>
                <div class="dt-pop-title mono">{{ t('common.columns') }}</div>
                <button
                  v-for="c in hideableCols"
                  :key="c.key"
                  type="button"
                  role="menuitemcheckbox"
                  class="dt-col-opt"
                  :aria-checked="!hidden.has(c.key)"
                  :disabled="!hidden.has(c.key) && shownCols.length <= 1"
                  @click="toggleCol(c)"
                >
                  <span class="dt-box" :class="{ on: !hidden.has(c.key) }"><Icon v-if="!hidden.has(c.key)" name="check" :size="10" /></span>
                  <span>{{ c.label }}</span>
                </button>
                <div class="dt-pop-foot"><button type="button" class="btn btn-ghost btn-sm" @click="resetCols">{{ t('components.table.resetColumns') }}</button></div>
              </Popover>
            </th>
          </tr>
        </thead>
        <tbody v-if="loading">
          <tr v-for="i in skeletonCount" :key="'sk' + i" class="dt-sk-row">
            <td v-if="selectable" class="dt-check"><Skeleton variant="rect" :width="14" :height="14" :radius="4" /></td>
            <td v-for="(c, ci) in shownCols" :key="c.key" :class="['al-' + (c.align || 'left'), c.hideBelow ? 'hb-' + c.hideBelow : null]">
              <Skeleton variant="rect" :width="skW(i + ci)" :height="10" :radius="4" />
            </td>
            <td v-if="columnMenu" />
          </tr>
        </tbody>
        <tbody v-else-if="!isEmpty">
          <tr
            v-for="row in pageRows"
            :key="keyOf(row)"
            :class="rowClasses(row)"
            :tabindex="clickable ? 0 : undefined"
            @click="onRowClick(row, $event)"
            @keydown.enter="onRowKey(row, $event)"
          >
            <td v-if="selectable" class="dt-check" data-no-row-click>
              <input type="checkbox" class="dt-cb" :checked="selSet.has(keyOf(row))" :aria-label="t('components.table.selectRow')" @change="toggleRow(row)" />
            </td>
            <td
              v-for="c in shownCols"
              :key="c.key"
              :class="['al-' + (c.align || 'left'), c.hideBelow ? 'hb-' + c.hideBelow : null, c.className, { nowrap: c.nowrap }]"
            >
              <slot :name="'cell-' + c.key" :row="row" :value="rawValue(c, row)" :column="c">{{ display(c, row) }}</slot>
            </td>
            <td v-if="columnMenu" />
          </tr>
        </tbody>
      </table>
      <div v-if="isEmpty" class="dt-empty">
        <slot v-if="filtered" name="empty-filtered">
          <EmptyState icon="filter" :title="t('common.emptyFiltered')" :description="t('common.emptyFilteredDesc')" :action-label="t('common.clearFilters')" action-icon="x" action-variant="ghost" @action="emit('clear-filters')" />
        </slot>
        <slot v-else name="empty">
          <EmptyState :icon="emptyIcon" :title="emptyTitle || t('common.emptyTitle')" :description="emptyDesc" :action-label="emptyActionLabel" action-icon="plus" @action="emit('empty-action')" />
        </slot>
      </div>
    </div>

    <!-- ===== card mode (< cardBreakpoint) ===== -->
    <div v-else class="dt-cards" :aria-busy="loading">
      <template v-if="loading">
        <div v-for="i in Math.min(skeletonCount, 5)" :key="'skc' + i" class="dt-card">
          <Skeleton variant="rect" width="55%" :height="12" :radius="4" />
          <Skeleton :lines="2" :height="9" />
        </div>
      </template>
      <template v-else-if="!isEmpty">
        <div
          v-for="row in pageRows"
          :key="keyOf(row)"
          class="dt-card"
          :class="rowClasses(row)"
          :tabindex="clickable ? 0 : undefined"
          @click="onRowClick(row, $event)"
          @keydown.enter="onRowKey(row, $event)"
        >
          <div class="dt-card-head">
            <input v-if="selectable" type="checkbox" class="dt-cb" :checked="selSet.has(keyOf(row))" :aria-label="t('components.table.selectRow')" @change="toggleRow(row)" />
            <div v-if="titleCol" class="dt-card-title">
              <slot :name="'cell-' + titleCol.key" :row="row" :value="rawValue(titleCol, row)" :column="titleCol">{{ display(titleCol, row) }}</slot>
            </div>
            <div v-if="actionCol && actionCol !== titleCol" class="dt-card-act">
              <slot :name="'cell-' + actionCol.key" :row="row" :value="rawValue(actionCol, row)" :column="actionCol">{{ display(actionCol, row) }}</slot>
            </div>
          </div>
          <dl v-if="cardCols.length" class="dt-card-body">
            <template v-for="c in cardCols" :key="c.key">
              <dt>{{ c.label }}</dt>
              <dd :class="'al-left'"><slot :name="'cell-' + c.key" :row="row" :value="rawValue(c, row)" :column="c">{{ display(c, row) }}</slot></dd>
            </template>
          </dl>
        </div>
      </template>
      <div v-if="isEmpty" class="dt-empty">
        <slot v-if="filtered" name="empty-filtered">
          <EmptyState compact icon="filter" :title="t('common.emptyFiltered')" :description="t('common.emptyFilteredDesc')" :action-label="t('common.clearFilters')" action-icon="x" action-variant="ghost" @action="emit('clear-filters')" />
        </slot>
        <slot v-else name="empty">
          <EmptyState compact :icon="emptyIcon" :title="emptyTitle || t('common.emptyTitle')" :description="emptyDesc" :action-label="emptyActionLabel" action-icon="plus" @action="emit('empty-action')" />
        </slot>
      </div>
    </div>

    <!-- footer / pagination -->
    <div v-if="paginate && !loading && total > 0" class="dt-foot">
      <span class="mono dt-range">{{ t('common.rowsOf', { from: fmt.number(fromIdx), to: fmt.number(toIdx), total: fmt.number(total) }) }}</span>
      <div class="dt-pager">
        <label class="dt-size">
          <span>{{ t('common.perPage') }}</span>
          <select class="select dt-size-sel" :value="size" @change="setSize">
            <option v-for="s in pageSizes" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <span class="dt-pageinfo">{{ t('common.page', { n: page, total: pageCount }) }}</span>
        <button type="button" class="dt-icon-btn bordered" :disabled="page <= 1" :aria-label="t('components.table.prevPage')" @click="go(page - 1)"><Icon name="chevron-left" :size="13" /></button>
        <button type="button" class="dt-icon-btn bordered" :disabled="page >= pageCount" :aria-label="t('components.table.nextPage')" @click="go(page + 1)"><Icon name="chevron-right" :size="13" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpz-table {
  --dt-pad-y: 11px;
  background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-lg); min-width: 0; position: relative;
}
.kpz-table.dense { --dt-pad-y: 7px; }
.kpz-table.cards { background: transparent; border: 0; }

/* bulk bar */
.dt-bulk {
  position: sticky; top: var(--kpz-sticky-top, 0px); z-index: 3;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 10px 8px 14px;
  background: var(--ink-1); color: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; font-size: 13px;
  animation: dt-in 0.16s ease;
}
.cards .dt-bulk { border-radius: var(--r-md); margin-bottom: 8px; }
.dt-bulk-count { font-weight: 600; }
.dt-link { border: 0; background: transparent; color: oklch(0.8 0.1 268); font-size: 12.5px; text-decoration: underline; text-underline-offset: 3px; padding: 0; }
.dt-bulk-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.dt-bulk-actions :deep(.btn-ghost) { color: var(--bg); border-color: rgba(255, 255, 255, 0.2); }
.dt-bulk-actions :deep(.btn-ghost:hover) { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.35); }
.dt-bulk-x { width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center; }
.dt-bulk-x:hover { background: rgba(255, 255, 255, 0.1); }
@keyframes dt-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

/* table */
.dt-scroll { overflow-x: auto; border-radius: var(--r-lg); }
.dt-scroll.clipx { overflow-x: clip; overflow-y: visible; }
.dt-scroll.has-max { overflow: auto; }
.dt-bulk + .dt-scroll { border-top-left-radius: 0; border-top-right-radius: 0; }
table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px; }
th {
  text-align: left; font-family: var(--font-mono); font-size: 10.5px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-3); padding: 10px 12px; background: var(--bg-2); border-bottom: 1px solid var(--line-1); white-space: nowrap;
}
.sticky th { position: sticky; top: var(--kpz-sticky-top, 0px); z-index: 2; }
.sticky .dt-bulk ~ .dt-scroll th { top: calc(var(--kpz-sticky-top, 0px) + 46px); }
.has-max th { top: 0 !important; }
thead tr th:first-child { border-top-left-radius: var(--r-lg); }
thead tr th:last-child { border-top-right-radius: var(--r-lg); }
.dt-bulk + .dt-scroll thead tr th { border-radius: 0; }
td { padding: var(--dt-pad-y) 12px; border-bottom: 1px solid var(--line-1); color: var(--ink-1); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
td.nowrap { white-space: nowrap; }
.al-right { text-align: right; }
.al-center { text-align: center; }
th.al-right .dt-sort { flex-direction: row-reverse; }
.dt-sort { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; padding: 0; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; }
.dt-sort:hover, th.sorted { color: var(--ink-1); }
.dt-sort-ic { opacity: 0.55; }
th.sorted .dt-sort-ic { opacity: 1; }
.dt-check { width: 40px; padding-left: 14px; padding-right: 0; }
.dt-cb { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); cursor: pointer; vertical-align: middle; }
.dt-colmenu { width: 40px; padding: 4px 8px; text-align: right; }
tbody tr.is-click { cursor: pointer; }
tbody tr { transition: background 0.12s; }
tbody tr:hover td { background: var(--bg-2); }
tbody tr.is-selected td { background: oklch(0.975 0.02 268); }
tbody tr:focus-visible { outline: none; }
tbody tr:focus-visible td { background: var(--accent-soft); }
tbody tr:focus-visible td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
.is-hl td, .dt-card.is-hl { animation: dt-hl 2.6s ease-out; }
@keyframes dt-hl { 0%, 35% { background: oklch(0.95 0.06 155); } 100% { background: transparent; } }
.dt-sk-row td { padding-top: 15px; padding-bottom: 15px; }
.dt-empty { border-top: 0; }

.dt-icon-btn {
  width: 28px; height: 28px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--ink-3);
  display: inline-flex; align-items: center; justify-content: center;
}
.dt-icon-btn:hover:not(:disabled), .dt-icon-btn.active { background: var(--surface); border-color: var(--line-2); color: var(--ink-1); }
.dt-icon-btn.bordered { border-color: var(--line-2); background: var(--surface); }
.dt-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.dt-pop-title { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); padding: 6px 8px 4px; }
.dt-col-opt { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border: 0; border-radius: 7px; background: transparent; text-align: left; font-size: 13px; color: var(--ink-1); }
.dt-col-opt:hover:not(:disabled) { background: var(--bg-2); }
.dt-col-opt:disabled { opacity: 0.5; cursor: not-allowed; }
.dt-box { width: 16px; height: 16px; flex: none; border-radius: 4px; border: 1px solid var(--line-strong); display: inline-flex; align-items: center; justify-content: center; color: white; }
.dt-box.on { background: var(--accent); border-color: var(--accent); }
.dt-pop-foot { border-top: 1px solid var(--line-1); margin-top: 4px; padding: 6px 2px 0; display: flex; justify-content: flex-end; }

/* footer */
.dt-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--line-1); font-size: 12.5px; color: var(--ink-3); }
.cards .dt-foot { border-top: 0; padding: 12px 2px; }
.dt-range { font-size: 12px; }
.dt-pager { display: flex; align-items: center; gap: 8px; }
.dt-size { display: inline-flex; align-items: center; gap: 6px; }
.dt-size-sel { width: auto; height: 28px; padding: 0 6px; font-size: 12.5px; border-radius: 7px; }
.dt-pageinfo { white-space: nowrap; }

/* cards */
.dt-cards { display: flex; flex-direction: column; gap: 8px; }
.dt-card { background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.dt-card.is-click { cursor: pointer; }
.dt-card.is-selected { border-color: var(--accent); background: oklch(0.985 0.012 268); }
.dt-card:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.dt-card-head { display: flex; align-items: center; gap: 10px; }
.dt-card-title { flex: 1; min-width: 0; font-weight: 600; font-size: 14px; }
.dt-card-act { flex: none; }
.dt-card-body { display: grid; grid-template-columns: minmax(90px, auto) 1fr; gap: 6px 12px; margin: 0; font-size: 13px; }
.dt-card-body dt { color: var(--ink-3); font-size: 12px; }
.dt-card-body dd { margin: 0; min-width: 0; color: var(--ink-1); }
.cards .dt-empty { background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-md); }

/* responsive column hiding */
@media (max-width: 1279px) { .hb-lg { display: none; } }
@media (max-width: 1023px) { .hb-md { display: none; } }

.dt-sort:focus-visible, .dt-icon-btn:focus-visible, .dt-col-opt:focus-visible, .dt-bulk-x:focus-visible, .dt-link:focus-visible, .dt-cb:focus-visible, .dt-size-sel:focus-visible {
  outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); border-radius: 5px;
}
</style>
