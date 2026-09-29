<script setup>
// CSV order import (spec 5.4): template download, preview of the first 5 rows, column mapping
// (auto guess + manual), row level errors, import with progress. Imported orders are channel 'manual'.
//   <CsvImportModal v-model:open="x" @imported="orders => ..." />
import { ref, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import FileDrop from '../FileDrop.vue'
import ProgressBar from '../ProgressBar.vue'
import ScoreBadge from '../ScoreBadge.vue'
import { t } from '../../i18n/index.js'
import { toast } from '../toast.js'
import { ORDER_CSV_FIELDS, ordersCsvTemplate, parseOrdersCsv, validateCsvRows, importOrders } from '../../api/orders.js'
import { downloadText, apiErrorText, fieldErrorText } from '../shipments/helpers.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'imported'])

const stage = ref('upload') // upload | map | importing | done
const file = ref(null)
const parsed = ref(null)
const mapping = ref({})
const parseError = ref('')
const progress = ref(0)
const created = ref([])
const drop = ref(null)

watch(() => props.open, v => { if (v) reset() })
function reset() { stage.value = 'upload'; file.value = null; parsed.value = null; mapping.value = {}; parseError.value = ''; progress.value = 0; created.value = [] }

function downloadTemplate() {
  downloadText('orders_template.csv', ordersCsvTemplate())
  toast.info(t('orders.csv.templateDownloaded'))
}

function onFile(f) {
  parseError.value = ''
  try {
    const p = parseOrdersCsv(f.text)
    file.value = f
    parsed.value = p
    mapping.value = { ...p.mapping }
    stage.value = 'map'
  } catch (e) {
    parseError.value = apiErrorText(e)
    drop.value?.clear?.()
  }
}

const check = computed(() => (parsed.value ? validateCsvRows(parsed.value, mapping.value) : { orders: [], errors: [], rowCount: 0 }))
const mappingErrors = computed(() => check.value.errors.filter(e => e.row === 0))
const rowErrors = computed(() => check.value.errors.filter(e => e.row > 0))
const errorRows = computed(() => new Set(rowErrors.value.map(e => e.row)).size)
const readyCount = computed(() => check.value.orders.length)
const usedColumns = computed(() => new Set(Object.values(mapping.value).filter(v => v != null)))
const colField = computed(() => {
  const out = {}
  for (const [f, c] of Object.entries(mapping.value)) if (c != null) out[c] = f
  return out
})
const fieldLabel = id => t('core.csv.fields.' + id)

function setMap(field, value) {
  const v = value === '' ? null : Number(value)
  const next = { ...mapping.value }
  if (v != null) for (const k of Object.keys(next)) if (next[k] === v && k !== field) next[k] = null
  next[field] = v
  mapping.value = next
}

async function runImport() {
  if (!readyCount.value || mappingErrors.value.length) return
  stage.value = 'importing'
  progress.value = 0
  try {
    created.value = await importOrders(check.value.orders, { onProgress: p => { progress.value = p } })
    progress.value = 100
    stage.value = 'done'
    emit('imported', created.value)
  } catch (e) {
    toast.error(apiErrorText(e))
    stage.value = 'map'
  }
}
const problems = computed(() => created.value.filter(o => (o.addressCheck?.score ?? 100) < 70).length)
function close() { if (stage.value !== 'importing') emit('update:open', false) }
</script>

<template>
  <Modal :open="open" :title="t('orders.csv.title')" :subtitle="t('orders.csv.sub')" size="xl" :closable="stage !== 'importing'" @update:open="v => !v && close()">
    <ol class="steps mono" aria-hidden="true">
      <li :class="{ on: stage === 'upload', done: stage !== 'upload' }">1 · {{ t('orders.csv.s1') }}</li>
      <li :class="{ on: stage === 'map', done: ['importing', 'done'].includes(stage) }">2 · {{ t('orders.csv.s2') }}</li>
      <li :class="{ on: stage === 'importing' || stage === 'done' }">3 · {{ t('orders.csv.s3') }}</li>
    </ol>

    <template v-if="stage === 'upload'">
      <FileDrop ref="drop" accept=".csv" :hint="t('orders.csv.hint')" @file="onFile" @error="m => parseError = m" />
      <div v-if="parseError" class="callout danger mt" role="alert"><Icon name="alert" :size="15" />{{ parseError }}</div>
      <div class="tpl">
        <div>
          <div class="strong">{{ t('orders.csv.templateTitle') }}</div>
          <div class="muted small">{{ t('orders.csv.templateDesc') }}</div>
        </div>
        <button class="btn btn-ghost btn-sm" @click="downloadTemplate"><Icon name="download" :size="13" />{{ t('orders.csv.template') }}</button>
      </div>
    </template>

    <template v-else-if="stage === 'map' && parsed">
      <div class="file-row">
        <Icon name="file" :size="15" /><span class="mono">{{ file?.name }}</span>
        <span class="muted small">{{ t('orders.csv.rows', { n: parsed.rows.length, cols: parsed.headers.length }) }}</span>
        <button class="btn-link small" @click="reset">{{ t('orders.csv.changeFile') }}</button>
      </div>

      <h4 class="h4">{{ t('orders.csv.preview') }}</h4>
      <div class="table-wrap preview">
        <table class="table-simple">
          <thead>
            <tr>
              <th v-for="(h, i) in parsed.headers" :key="i" :class="{ unmapped: !usedColumns.has(i) }">
                <div class="mono">{{ h }}</div>
                <div class="map-to">{{ colField[i] ? '→ ' + fieldLabel(colField[i]) : t('orders.csv.ignored') }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, ri) in parsed.preview" :key="ri"><td v-for="(c, ci) in parsed.headers" :key="ci" class="mono small" :class="{ unmapped: !usedColumns.has(ci) }">{{ r[ci] || '-' }}</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="h4">{{ t('orders.csv.mapping') }} <span class="muted small">{{ t('orders.csv.mappingHint') }}</span></h4>
      <div class="map-grid">
        <label v-for="f in ORDER_CSV_FIELDS" :key="f.id" class="map-item" :class="{ missing: f.required && mapping[f.id] == null }">
          <span class="map-label">{{ fieldLabel(f.id) }}<span v-if="f.required" class="req">*</span></span>
          <select class="input select sm" :value="mapping[f.id] ?? ''" @change="setMap(f.id, $event.target.value)">
            <option value="">{{ t('orders.csv.notMapped') }}</option>
            <option v-for="(h, i) in parsed.headers" :key="i" :value="i">{{ h }}</option>
          </select>
        </label>
      </div>

      <div v-if="mappingErrors.length" class="callout danger mt" role="alert">
        <Icon name="alert" :size="15" />{{ t('orders.csv.unmapped', { fields: mappingErrors.map(e => fieldLabel(e.field)).join(', ') }) }}
      </div>
      <div v-if="rowErrors.length" class="errors mt">
        <div class="err-head"><Icon name="alert" :size="14" />{{ t('orders.csv.rowErrors', { n: rowErrors.length, rows: errorRows }) }}</div>
        <ul class="err-list">
          <li v-for="(e, i) in rowErrors.slice(0, 50)" :key="i">{{ t('core.csv.rowError', { row: e.row, field: fieldLabel(e.field), message: fieldErrorText(e.code) }) }}</li>
        </ul>
        <div v-if="rowErrors.length > 50" class="muted small">{{ t('orders.csv.more', { n: rowErrors.length - 50 }) }}</div>
      </div>
      <div class="summary mt">
        <span class="tag tag-success">{{ t('orders.csv.ready', { n: readyCount }) }}</span>
        <span v-if="errorRows" class="tag tag-danger">{{ t('orders.csv.skipped', { n: errorRows }) }}</span>
        <span class="muted small">{{ t('orders.csv.channelNote') }}</span>
      </div>
    </template>

    <template v-else-if="stage === 'importing'">
      <p>{{ t('orders.csv.importing', { n: readyCount }) }}</p>
      <ProgressBar :value="progress" show-value />
      <p class="muted small">{{ t('orders.csv.validating') }}</p>
    </template>

    <template v-else-if="stage === 'done'">
      <div class="done">
        <span class="done-ic"><Icon name="check" :size="20" /></span>
        <div class="done-title">{{ t('orders.csv.done', { n: created.length }) }}</div>
        <p v-if="problems" class="muted">{{ t('orders.csv.doneProblems', { n: problems }) }}</p>
      </div>
      <div class="table-wrap">
        <table class="table-simple">
          <thead><tr><th>{{ t('orders.cols.order') }}</th><th>{{ t('orders.cols.customer') }}</th><th>{{ t('orders.cols.destination') }}</th><th>{{ t('orders.cols.score') }}</th></tr></thead>
          <tbody>
            <tr v-for="o in created.slice(0, 8)" :key="o.id"><td class="mono">{{ o.id }}</td><td>{{ o.customer?.name }}</td><td>{{ o.shipTo.city }}, {{ o.shipTo.state }}</td><td><ScoreBadge :score="o.addressCheck?.score" size="sm" /></td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template #footer>
      <template v-if="stage === 'upload'">
        <button class="btn btn-ghost" @click="close">{{ t('common.cancel') }}</button>
      </template>
      <template v-else-if="stage === 'map'">
        <button class="btn btn-ghost" @click="reset">{{ t('common.back') }}</button>
        <button class="btn btn-primary" :disabled="!readyCount || mappingErrors.length > 0" @click="runImport"><Icon name="upload" :size="13" />{{ t('orders.csv.import', { n: readyCount }) }}</button>
      </template>
      <template v-else-if="stage === 'done'">
        <button class="btn btn-primary" @click="emit('update:open', false)">{{ t('orders.csv.viewOrders') }}</button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.steps { list-style: none; padding: 0; margin: 0 0 14px; display: flex; align-items: center; gap: 16px; font-size: 11.5px; color: var(--ink-4); flex-wrap: wrap; }
.steps li { line-height: 18px; margin: 0; padding: 0; }
.steps .on { color: var(--accent); font-weight: 600; }
.steps .done { color: var(--success); }
.mt { margin-top: 12px; }
.small { font-size: 12px; }
.strong { font-weight: 600; }
.tpl { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line-1); flex-wrap: wrap; }
.file-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.h4 { margin: 16px 0 8px; font-size: 13.5px; font-weight: 600; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.preview { max-height: 230px; overflow: auto; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.preview th { vertical-align: top; background: var(--bg-2); position: sticky; top: 0; white-space: nowrap; }
.preview td { white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.map-to { font-size: 11px; color: var(--accent); font-weight: 500; margin-top: 2px; white-space: nowrap; }
.unmapped { color: var(--ink-4) !important; }
.unmapped .map-to { color: var(--ink-4); }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 12px; }
.map-item { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.map-label { color: var(--ink-2); font-weight: 500; }
.req { color: var(--danger); margin-left: 2px; }
.map-item.missing .select { border-color: var(--danger); }
.select.sm { height: 32px; font-size: 13px; }
.errors { border: 1px solid oklch(0.88 0.06 25); background: oklch(0.98 0.015 25); border-radius: var(--r-md); padding: 10px 12px; }
.err-head { display: flex; gap: 6px; align-items: center; font-weight: 600; color: var(--danger); font-size: 13px; margin-bottom: 6px; }
.err-list { margin: 0; padding-left: 18px; max-height: 140px; overflow: auto; font-size: 12.5px; color: var(--ink-2); display: flex; flex-direction: column; gap: 2px; }
.summary { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.done { text-align: center; padding: 8px 0 14px; }
.done-ic { width: 44px; height: 44px; border-radius: 999px; background: oklch(0.95 0.05 155); color: var(--success); display: inline-grid; place-items: center; }
.done-title { font-weight: 600; font-size: 15px; margin-top: 8px; }
</style>
