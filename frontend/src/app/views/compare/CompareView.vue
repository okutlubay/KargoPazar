<script setup>
// Quote marketplace (route 'compare'): origin x destination x package -> every offer side by side.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import Weight from '../../components/Weight.vue'
import QuoteComparison from '../../components/compare/QuoteComparison.vue'
import { offerTitle } from '../../components/compare/labels.js'
import { t, tx, fmt } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { compareQuotes, stateForZip } from '../../api/compare.js'

const LB_PER_KG = 2.20462
const IN_PER_CM = 0.393701

const form = reactive({ origin: 'TR', country: 'US', zip: '78701', line1: '', lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2, valueUsd: 120, hsCode: '6912.00' })
const result = ref(null)
const loading = ref(false)
const error = ref('')
const chosenKey = ref(null)

const originOptions = computed(() => ['TR', 'NJ01', 'LA01'].map(v => ({ value: v, label: v === 'TR' ? 'TR · IST-CP' : v, icon: v === 'TR' ? 'plane' : 'warehouse' })))
const originCountry = computed(() => (form.origin === 'TR' ? 'TR' : 'US'))
const destCountries = computed(() => {
  // US hubs ship domestically and abroad; a first mile origin cannot be its own destination.
  const list = (db.all('countries') || []).filter(c => c.active !== false && (originCountry.value === 'US' || c.code !== originCountry.value))
  if (!list.some(c => c.code === 'US')) list.unshift({ code: 'US', name: { tr: 'Amerika Birleşik Devletleri', en: 'United States' } })
  return [...list.filter(c => c.code === 'US'), ...list.filter(c => c.code !== 'US')]
})
watch(destCountries, list => { if (!list.some(c => c.code === form.country)) form.country = list[0]?.code ?? 'US' }, { immediate: true })

const isUs = computed(() => form.country === 'US')
const state = computed(() => (isUs.value ? stateForZip(form.zip) : null))
const errors = computed(() => {
  const e = {}
  if (isUs.value && !/^\d{5}$/.test(String(form.zip || ''))) e.zip = t('compare.form.errors.zip')
  for (const k of ['lengthCm', 'widthCm', 'heightCm', 'weightKg']) if (!(Number(form[k]) > 0)) e[k] = t('compare.form.errors.positive')
  return e
})
const valid = computed(() => !Object.keys(errors.value).length)
const lb = computed(() => (Number(form.weightKg) || 0) * LB_PER_KG)
const dimsIn = computed(() => ['lengthCm', 'widthCm', 'heightCm'].map(k => fmt.number((Number(form[k]) || 0) * IN_PER_CM, 1)).join(' x ') + ' in')

let seq = 0
async function run() {
  if (!valid.value) return
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await compareQuotes({
      origin: form.origin,
      dest: { country: form.country, zip: form.zip, state: state.value, line1: form.line1 },
      pkg: { lengthCm: +form.lengthCm, widthCm: +form.widthCm, heightCm: +form.heightCm, weightKg: +form.weightKg },
      valueUsd: +form.valueUsd || 0,
      hsCode: form.hsCode,
    })
    if (my !== seq) return
    result.value = r
    if (!r.offers.some(o => o.key === chosenKey.value)) chosenKey.value = null
  } catch (e) {
    if (my === seq) error.value = e?.message || t('common.errorGeneric')
  } finally {
    if (my === seq) loading.value = false
  }
}
let timer = null
watch(form, () => { clearTimeout(timer); timer = setTimeout(run, 450) }, { deep: true })
onMounted(run)
onBeforeUnmount(() => clearTimeout(timer))

const chosen = computed(() => result.value?.offers.find(o => o.key === chosenKey.value) ?? null)
const createRoute = computed(() => (chosen.value?.kind === 'package' ? { name: 'intl-new' } : { name: 'shipment-new' }))
</script>

<template>
  <div class="page">
    <PageHeader :title="t('compare.title')" :subtitle="t('compare.subtitle')" />

    <div class="cmp-layout">
      <form class="panel panel-pad cmp-form" novalidate data-testid="compare-form" @submit.prevent="run">
        <div class="panel-title">{{ t('compare.form.title') }}</div>

        <div class="fld">
          <span class="field-label">{{ t('compare.form.origin') }}</span>
          <SegmentedControl v-model="form.origin" size="sm" block :options="originOptions" :aria-label="t('compare.form.origin')" data-testid="compare-origin" />
          <span class="hint">{{ t('compare.form.originHints.' + form.origin) }}</span>
        </div>

        <div class="fld-row">
          <label class="fld">
            <span class="field-label">{{ t('compare.form.country') }}</span>
            <select v-model="form.country" class="select" data-testid="compare-dest-country">
              <option v-for="c in destCountries" :key="c.code" :value="c.code">{{ c.flag ? c.flag + ' ' : '' }}{{ tx(c.name) || c.code }}</option>
            </select>
          </label>
          <label class="fld">
            <span class="field-label">{{ t('compare.form.zip') }}</span>
            <input v-model.trim="form.zip" class="input mono" :class="{ invalid: errors.zip }" inputmode="numeric" maxlength="10" :placeholder="t('compare.form.zipPh')" data-testid="compare-zip" />
            <span v-if="errors.zip" class="err">{{ errors.zip }}</span>
            <span v-else-if="state" class="hint">{{ t('compare.form.state') }}: {{ state }}</span>
          </label>
        </div>
        <label class="fld">
          <span class="field-label">{{ t('compare.form.poBox') }}</span>
          <input v-model="form.line1" class="input" :placeholder="t('compare.form.poBoxPh')" data-testid="compare-address" />
        </label>

        <div class="fld">
          <span class="field-label">{{ t('compare.form.dims') }}</span>
          <div class="dims">
            <input v-model.number="form.lengthCm" class="input" type="number" min="1" step="1" :aria-label="t('compare.form.length')" :class="{ invalid: errors.lengthCm }" data-testid="compare-length" />
            <span>x</span>
            <input v-model.number="form.widthCm" class="input" type="number" min="1" step="1" :aria-label="t('compare.form.width')" :class="{ invalid: errors.widthCm }" data-testid="compare-width" />
            <span>x</span>
            <input v-model.number="form.heightCm" class="input" type="number" min="1" step="1" :aria-label="t('compare.form.height')" :class="{ invalid: errors.heightCm }" data-testid="compare-height" />
          </div>
          <span class="hint mono">{{ dimsIn }}</span>
        </div>
        <div class="fld-row">
          <label class="fld">
            <span class="field-label">{{ t('compare.form.weight') }} (kg)</span>
            <input v-model.number="form.weightKg" class="input" type="number" min="0.1" step="0.1" :class="{ invalid: errors.weightKg }" data-testid="compare-weight" />
            <span class="hint"><Weight :lb="lb" units="imperial" /></span>
          </label>
          <label class="fld">
            <span class="field-label">{{ t('compare.form.value') }}</span>
            <input v-model.number="form.valueUsd" class="input" type="number" min="0" step="1" data-testid="compare-value" />
          </label>
        </div>
        <label class="fld">
          <span class="field-label">{{ t('compare.form.hs') }}</span>
          <input v-model.trim="form.hsCode" class="input mono" :placeholder="t('compare.form.hsPh')" data-testid="compare-hs" />
          <span class="hint">{{ t('compare.form.hsHint') }}</span>
        </label>
        <button type="submit" class="btn btn-primary" :disabled="!valid || loading" data-testid="compare-submit">
          <Icon :name="loading ? 'refresh' : 'search'" :size="14" />{{ loading ? t('compare.form.refreshing') : t('compare.form.submit') }}
        </button>
      </form>

      <section class="cmp-results">
        <div v-if="error" class="callout danger" role="alert"><Icon name="alert" :size="15" />{{ error }}</div>
        <div v-else-if="loading && !result" class="stack"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="150" /></div>
        <EmptyState v-else-if="!result" icon="search" :title="t('compare.results.start')" :description="t('compare.results.startDesc')" />
        <template v-else>
          <div class="info-line">
            <span v-if="result.duty" class="tag">{{ result.duty.averaged ? t('compare.results.dutyAvg') : t('compare.results.dutyHs', { hs: result.duty.hsCode }) }}</span>
            <span v-if="result.hubSuggestion && (form.origin === 'NJ01' || form.origin === 'LA01') && result.hubSuggestion !== form.origin" class="tag tag-accent">
              <Icon name="route" :size="11" />{{ t('compare.results.hubHint', { hub: result.hubSuggestion }) }}
              <button type="button" class="btn-link" @click="form.origin = result.hubSuggestion">{{ result.hubSuggestion }}</button>
            </span>
          </div>
          <div v-if="chosen" class="callout chosen" data-testid="compare-chosen">
            <Icon name="check-circle" :size="15" />
            <span class="grow">{{ t('compare.results.chosenTitle', { name: offerTitle(chosen) }) }}</span>
            <RouterLink class="btn btn-primary btn-sm" :to="createRoute">{{ chosen.kind === 'package' ? t('compare.results.createIntl') : t('compare.results.createShipment') }}<Icon name="arrow" :size="12" /></RouterLink>
          </div>
          <QuoteComparison v-model="chosenKey" :offers="result.offers" :recommended-key="result.recommendedKey" :loading="loading" />
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.cmp-layout { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 18px; align-items: start; }
.cmp-form { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 76px; }
.fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fld .field-label { margin-bottom: 2px; }
.fld-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dims { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; gap: 6px; color: var(--ink-3); }
.dims .input { text-align: center; padding: 0 6px; }
.hint { font-size: 11.5px; color: var(--ink-3); line-height: 1.4; }
.err { font-size: 11.5px; color: var(--danger); }
.input.invalid { border-color: var(--danger); }
.mono { font-family: var(--font-mono); }
.cmp-results { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.info-line { display: flex; flex-wrap: wrap; gap: 8px; }
.info-line .tag { display: inline-flex; align-items: center; gap: 5px; }
.callout.chosen { align-items: center; background: oklch(0.96 0.04 155); color: oklch(0.36 0.1 155); }
.grow { flex: 1; }
@media (max-width: 1000px) {
  .cmp-layout { grid-template-columns: 1fr; }
  .cmp-form { position: static; }
}
</style>
