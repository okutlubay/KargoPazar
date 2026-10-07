<script setup>
// Parcels + items editor for the first mile wizard (spec 9.2 step 2).
// Mutates the reactive `parcels` array it receives (owned by the wizard draft).
// Dimensions are entered in cm / kg (origin markets are metric); in / lb shown alongside.
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Spinner from '@/app/components/Spinner.vue'
import { useI18n } from '@/app/i18n/index.js'
import { toast } from '@/app/components/toast.js'
import { suggestHs, recordHsFeedback, normalizeHsCode } from '@/app/api/ai.js'
import { volumetricKgOf, cmToIn, kgToLb, toUsdDemo, fromUsdDemo } from '@/app/api/intl.js'
import { errorText } from './stage.js'

const props = defineProps({
  parcels: { type: Array, required: true },
  origin: { type: String, required: true },
  currency: { type: String, default: 'USD' },
  symbol: { type: String, default: '$' },
  products: { type: Array, default: () => [] },
})
const { t, tx, fmt, locale } = useI18n()
const errors = ref({})
const hsBusy = ref({})
const hsResults = ref({})

const PRESETS = [
  { key: 's', l: 30, w: 25, h: 15 },
  { key: 'm', l: 40, w: 30, h: 30 },
  { key: 'l', l: 50, w: 40, h: 40 },
]

function blankItem() { return { sku: '', title: '', qty: 1, unitValueLocal: '', hsCode: '', hsSource: null, origin: props.origin, weightKg: '' } }
function addParcel() {
  props.parcels.push({ lengthCm: 40, widthCm: 30, heightCm: 30, weightKg: '', items: [blankItem()] })
}
function removeParcel(i) { props.parcels.splice(i, 1) }
function addItem(p) { p.items.push(blankItem()) }
function removeItem(p, j) { p.items.splice(j, 1) }
function applyPreset(p, pr) { p.lengthCm = pr.l; p.widthCm = pr.w; p.heightCm = pr.h }

function pickProduct(item, sku) {
  const prod = props.products.find(x => x.sku === sku)
  if (!prod) { item.sku = ''; return }
  item.sku = prod.sku
  item.title = prod.title?.en || tx(prod.title)
  item.hsCode = prod.hsCode || ''
  item.hsSource = prod.hsCode ? 'catalog' : null
  item.unitValueLocal = fromUsdDemo(prod.value, props.currency)
  item.weightKg = Math.round((prod.weightLb / 2.20462) * 100) / 100
  item.origin = prod.origin || props.origin
}

const key = (i, j) => `${i}.${j}`
async function aiHs(item, i, j) {
  if (!String(item.title || '').trim()) { errors.value = { ...errors.value, [`${i}.${j}.title`]: 'required' }; return }
  hsBusy.value = { ...hsBusy.value, [key(i, j)]: true }
  try {
    const r = await suggestHs(item.title, '', { source: 'intl_new' })
    hsResults.value = { ...hsResults.value, [key(i, j)]: r }
  } catch (e) { toast.error(errorText(t, e)) } finally { hsBusy.value = { ...hsBusy.value, [key(i, j)]: false } }
}
function acceptHs(item, i, j, code) {
  const r = hsResults.value[key(i, j)]
  item.hsCode = code
  item.hsSource = 'ai'
  const e = { ...errors.value }; delete e[`${i}.${j}.hsCode`]; errors.value = e
  recordHsFeedback({ title: item.title, code, predicted: r?.top?.[0]?.code || null, action: code === r?.top?.[0]?.code ? 'confirm' : 'correct', source: 'intl_new' }).catch(() => {})
  const copy = { ...hsResults.value }; delete copy[key(i, j)]; hsResults.value = copy
}
function onHsBlur(item) {
  const n = normalizeHsCode(item.hsCode)
  if (n) item.hsCode = n
  if (item.hsSource === 'ai' || item.hsSource === 'catalog') item.hsSource = item.hsSource
}

const totals = computed(() => {
  let kg = 0, vol = 0, val = 0, qty = 0
  for (const p of props.parcels) {
    kg += Number(p.weightKg) || 0
    vol += volumetricKgOf(p)
    for (const it of p.items) { val += (Number(it.qty) || 0) * (Number(it.unitValueLocal) || 0); qty += Number(it.qty) || 0 }
  }
  return { kg, vol, val, qty, usd: toUsdDemo(val, props.currency) }
})
const itemsKg = p => p.items.reduce((s, it) => s + (Number(it.weightKg) || 0) * (Number(it.qty) || 0), 0)
const lineUsd = it => toUsdDemo((Number(it.qty) || 0) * (Number(it.unitValueLocal) || 0), props.currency)
const money = (v, cur) => fmt.moneyNative(v, cur)

function validate() {
  const e = {}
  if (!props.parcels.length) e.parcels = 'required'
  props.parcels.forEach((p, i) => {
    for (const k of ['lengthCm', 'widthCm', 'heightCm', 'weightKg']) if (!(Number(p[k]) > 0)) e[`${i}.${k}`] = 'number'
    if (!p.items.length) e[`${i}.items`] = 'required'
    p.items.forEach((it, j) => {
      if (!String(it.title || '').trim()) e[`${i}.${j}.title`] = 'required'
      if (!(Number(it.qty) >= 1)) e[`${i}.${j}.qty`] = 'number'
      if (!(Number(it.unitValueLocal) > 0)) e[`${i}.${j}.unitValueLocal`] = 'number'
      const hs = normalizeHsCode(it.hsCode)
      if (!hs) e[`${i}.${j}.hsCode`] = it.hsCode ? 'hs' : 'required'
      else it.hsCode = hs
    })
  })
  errors.value = e
  if (Object.keys(e).length) {
    requestAnimationFrame(() => {
      const el = document.querySelector('.pe [aria-invalid="true"]')
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.focus?.()
    })
    return false
  }
  return true
}
function err(k) { const c = errors.value[k]; return c ? t('intl.validation.' + c) : '' }
function clearErr(k) { if (errors.value[k]) { const e = { ...errors.value }; delete e[k]; errors.value = e } }
defineExpose({ validate })
</script>

<template>
  <div class="pe">
    <div v-if="errors.parcels" class="callout danger"><Icon name="alert" :size="15" />{{ t('intl.parcels.none') }}</div>
    <section v-for="(p, i) in parcels" :key="i" class="parcel panel">
      <header class="ph">
        <div class="pt"><Icon name="box" :size="15" /><strong>{{ t('intl.parcels.parcel', { n: i + 1 }) }}</strong>
          <span class="muted num">{{ t('intl.parcels.volumetric', { kg: fmt.number(volumetricKgOf(p), 1) }) }}</span>
        </div>
        <div class="presets">
          <button v-for="pr in PRESETS" :key="pr.key" type="button" class="btn btn-ghost btn-xs" @click="applyPreset(p, pr)">{{ pr.l }}x{{ pr.w }}x{{ pr.h }}</button>
          <button type="button" class="btn-icon" :aria-label="t('intl.parcels.remove')" :title="t('intl.parcels.remove')" :disabled="parcels.length === 1" @click="removeParcel(i)"><Icon name="trash" :size="14" /></button>
        </div>
      </header>
      <div class="dims">
        <label v-for="k in ['lengthCm', 'widthCm', 'heightCm']" :key="k" class="fld">
          <span class="fl">{{ t('intl.parcels.' + k) }} (cm)</span>
          <input v-model.number="p[k]" type="number" min="1" step="1" class="input num" :class="{ invalid: errors[i + '.' + k] }" :aria-invalid="!!errors[i + '.' + k]" @input="clearErr(i + '.' + k)" />
          <span class="conv num">{{ fmt.number(cmToIn(p[k]), 1) }} in</span>
        </label>
        <label class="fld">
          <span class="fl">{{ t('intl.parcels.weight') }} (kg)</span>
          <input v-model.number="p.weightKg" :data-testid="'intl-parcel-weight-' + i" type="number" min="0.01" step="0.1" class="input num" :class="{ invalid: errors[i + '.weightKg'] }" :aria-invalid="!!errors[i + '.weightKg']" @input="clearErr(i + '.weightKg')" />
          <span class="conv num">{{ fmt.number(kgToLb(p.weightKg), 2) }} lb</span>
        </label>
      </div>
      <div v-if="itemsKg(p) > (Number(p.weightKg) || 0) + 0.01 && Number(p.weightKg) > 0" class="callout warn sm"><Icon name="alert" :size="14" />{{ t('intl.parcels.itemsHeavier', { kg: fmt.number(itemsKg(p), 2) }) }}</div>

      <div class="items">
        <div class="ih">
          <span>{{ t('intl.parcels.items') }}</span>
          <span class="muted">{{ t('intl.parcels.valueIn', { cur: currency }) }}</span>
        </div>
        <div v-for="(it, j) in p.items" :key="j" class="item">
          <div class="row1">
            <label class="fld grow">
              <span class="fl">{{ t('intl.parcels.product') }}</span>
              <select class="select" data-testid="intl-item-product" :value="it.sku" @change="pickProduct(it, $event.target.value)">
                <option value="">{{ t('intl.parcels.freeText') }}</option>
                <option v-for="pr in products" :key="pr.sku" :value="pr.sku">{{ pr.sku }} · {{ tx(pr.title) }}</option>
              </select>
            </label>
            <label class="fld grow2">
              <span class="fl">{{ t('intl.parcels.title') }}</span>
              <input v-model="it.title" class="input" :class="{ invalid: errors[i + '.' + j + '.title'] }" :aria-invalid="!!errors[i + '.' + j + '.title']" :placeholder="t('intl.parcels.titlePh')" @input="clearErr(i + '.' + j + '.title')" />
              <span v-if="err(i + '.' + j + '.title')" class="field-error">{{ err(i + '.' + j + '.title') }}</span>
            </label>
          </div>
          <div class="row2">
            <label class="fld qty">
              <span class="fl">{{ t('intl.parcels.qty') }}</span>
              <input v-model.number="it.qty" type="number" min="1" step="1" class="input num" :class="{ invalid: errors[i + '.' + j + '.qty'] }" :aria-invalid="!!errors[i + '.' + j + '.qty']" @input="clearErr(i + '.' + j + '.qty')" />
            </label>
            <label class="fld val">
              <span class="fl">{{ t('intl.parcels.unitValue') }} ({{ symbol }})</span>
              <input v-model.number="it.unitValueLocal" type="number" min="0.01" step="0.01" class="input num" :class="{ invalid: errors[i + '.' + j + '.unitValueLocal'] }" :aria-invalid="!!errors[i + '.' + j + '.unitValueLocal']" @input="clearErr(i + '.' + j + '.unitValueLocal')" />
              <span class="conv num">= {{ money(lineUsd(it), 'USD') }}</span>
            </label>
            <label class="fld wt">
              <span class="fl">{{ t('intl.parcels.itemWeight') }} (kg)</span>
              <input v-model.number="it.weightKg" type="number" min="0" step="0.01" class="input num" :placeholder="t('common.optional')" />
            </label>
            <div class="fld hs">
              <span class="fl">{{ t('intl.parcels.hs') }}
                <span v-if="it.hsSource === 'ai'" class="tag tag-accent xs">AI</span>
                <span v-else-if="it.hsSource === 'catalog'" class="tag xs">{{ t('intl.parcels.fromCatalog') }}</span>
              </span>
              <div class="hsrow">
                <input v-model="it.hsCode" class="input num" placeholder="0000.00" :class="{ invalid: errors[i + '.' + j + '.hsCode'] }" :aria-invalid="!!errors[i + '.' + j + '.hsCode']" @input="clearErr(i + '.' + j + '.hsCode'); it.hsSource = 'manual'" @blur="onHsBlur(it)" />
                <button type="button" class="btn btn-soft btn-sm" :disabled="hsBusy[key(i, j)]" :title="t('intl.parcels.aiHsHint')" @click="aiHs(it, i, j)">
                  <Spinner v-if="hsBusy[key(i, j)]" :size="13" /><Icon v-else name="wand" :size="13" />{{ t('intl.parcels.aiHs') }}
                </button>
              </div>
              <span v-if="err(i + '.' + j + '.hsCode')" class="field-error">{{ err(i + '.' + j + '.hsCode') }}</span>
            </div>
            <button type="button" class="btn-icon rm" :aria-label="t('intl.parcels.removeItem')" :title="t('intl.parcels.removeItem')" :disabled="p.items.length === 1" @click="removeItem(p, j)"><Icon name="x" :size="14" /></button>
          </div>
          <div v-if="hsResults[key(i, j)]" class="hsres">
            <span class="hl"><Icon name="spark" :size="12" />{{ t('intl.parcels.aiTop3') }}</span>
            <button v-for="s in hsResults[key(i, j)].top" :key="s.code" type="button" class="hschip" @click="acceptHs(it, i, j, s.code)">
              <strong class="num">{{ s.code }}</strong><span>{{ tx(s.desc) }}</span><span class="pct num">{{ fmt.percent(s.prob, 0) }}</span>
            </button>
            <span v-if="hsResults[key(i, j)].lowConfidence" class="tag tag-warning">{{ t('intl.parcels.lowConfidence') }}</span>
            <span class="words">{{ t('intl.parcels.topWords') }}: {{ hsResults[key(i, j)].topWords.map(w => w.word).join(', ') }}</span>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="addItem(p)"><Icon name="plus" :size="13" />{{ t('intl.parcels.addItem') }}</button>
      </div>
    </section>

    <div class="foot">
      <button type="button" class="btn btn-ghost" @click="addParcel"><Icon name="plus" :size="14" />{{ t('intl.parcels.add') }}</button>
      <div class="sum">
        <span>{{ t('intl.parcels.summary', { n: parcels.length, qty: totals.qty }) }}</span>
        <span class="num">{{ fmt.number(totals.kg, 2) }} kg · {{ fmt.number(kgToLb(totals.kg), 1) }} lb</span>
        <span class="num">{{ t('intl.parcels.volumetricTotal', { kg: fmt.number(totals.vol, 1) }) }}</span>
        <strong class="num">{{ money(totals.val, currency) }} = {{ money(totals.usd, 'USD') }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pe { display: flex; flex-direction: column; gap: 14px; }
.parcel { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.ph { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.pt { display: flex; align-items: center; gap: 8px; }
.presets { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.dims { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fl { font-size: 12px; color: var(--ink-3); font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
.conv { font-size: 11.5px; color: var(--ink-3); }
.items { border-top: 1px dashed var(--line-2); padding-top: 10px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.ih { display: flex; justify-content: space-between; width: 100%; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.item { width: 100%; background: var(--bg-2); border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.row1 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 10px; }
.row2 { display: grid; grid-template-columns: 80px 150px 120px minmax(0, 1fr) 32px; gap: 10px; align-items: start; }
.hsrow { display: flex; gap: 6px; }
.hsrow .input { flex: 1; min-width: 90px; }
.rm { margin-top: 20px; }
.xs { height: 17px; font-size: 10px; padding: 0 5px; }
.hsres { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12.5px; }
.hl { display: inline-flex; align-items: center; gap: 4px; color: var(--accent-ink); font-weight: 600; }
.hschip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line-2); cursor: pointer; font: inherit; font-size: 12.5px; }
.hschip:hover { border-color: var(--accent); background: var(--accent-soft); }
.pct { color: var(--accent); font-weight: 600; }
.words { color: var(--ink-3); font-size: 12px; }
.callout.sm { padding: 8px 12px; font-size: 12.5px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.sum { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); }
@media (max-width: 860px) {
  .dims { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row1 { grid-template-columns: 1fr; }
  .row2 { grid-template-columns: 1fr 1fr; }
  .rm { margin-top: 0; }
}
</style>
