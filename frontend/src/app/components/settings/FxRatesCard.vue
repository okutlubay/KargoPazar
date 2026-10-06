<script setup>
// Settings > Units: display currency and the editable demo FX table (document `fx`).
import { ref, reactive, computed, onMounted } from 'vue'
import Card from '../Card.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import SegmentedControl from '../SegmentedControl.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { getFxRates, updateFxRates } from '../../api/settings.js'
import { fx, CURRENCIES, DEFAULT_FX, setPanelCurrency } from '../../store/currency.js'
import { money as fmtMoney } from '@/shared/format.js'
import { errorText } from './util.js'

const { t, fmt, locale } = useI18n()
const EDITABLE = CURRENCIES.filter(c => c !== 'USD')
const loading = ref(true)
const saving = ref(false)
const form = reactive({ date: DEFAULT_FX.date, rates: Object.fromEntries(EDITABLE.map(c => [c, DEFAULT_FX.rates[c]])) })
let initial = ''
const dirty = computed(() => JSON.stringify(form) !== initial)
const locked = computed(() => !can('settings.manage'))
const invalid = computed(() => EDITABLE.filter(c => !(Number(form.rates[c]) > 0)))

onMounted(async () => {
  try {
    const d = await getFxRates()
    form.date = d.date ?? DEFAULT_FX.date
    for (const c of EDITABLE) form.rates[c] = d.rates?.[c] ?? DEFAULT_FX.rates[c]
    initial = JSON.stringify(form)
  } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
})

const currencyOptions = computed(() => CURRENCIES.map(c => ({ value: c, label: c })))
const example = c => t('fx.table.example', {
  usd: fmtMoney(100, locale.value, 'USD', 2),
  local: fmtMoney(100 * (Number(form.rates[c]) || 0), locale.value, c, 2),
})

function resetDemo() {
  form.date = DEFAULT_FX.date
  for (const c of EDITABLE) form.rates[c] = DEFAULT_FX.rates[c]
}

async function save() {
  if (invalid.value.length) { toast.error(t('fx.table.invalid')); return }
  saving.value = true
  try {
    await updateFxRates({ date: form.date, rates: { ...form.rates } })
    initial = JSON.stringify(form)
    toast.success(t('fx.table.saved'))
  } catch (e) { toast.error(errorText(e)) } finally { saving.value = false }
}
</script>

<template>
  <Card :title="t('fx.table.title')" :subtitle="t('fx.table.desc')">
    <div v-if="loading"><Skeleton :lines="5" /></div>
    <div v-else class="stack-lg">
      <div class="row">
        <div class="lbl-col">
          <div class="lbl">{{ t('fx.table.display') }}</div>
          <div class="hint">{{ t('fx.table.displayHint') }}</div>
        </div>
        <div class="ctl">
          <SegmentedControl :model-value="fx.display" :options="currencyOptions" :aria-label="t('fx.table.display')" @change="setPanelCurrency" />
        </div>
      </div>
      <div class="row">
        <div class="lbl-col">
          <div class="lbl">{{ t('fx.table.date') }}</div>
          <div class="hint">{{ t('fx.table.source') }}</div>
        </div>
        <div class="ctl">
          <input v-model="form.date" type="date" class="input date" :disabled="locked" :aria-label="t('fx.table.date')" />
        </div>
      </div>
      <table class="fx-table">
        <thead>
          <tr><th>{{ t('fx.table.currency') }}</th><th class="r">{{ t('fx.table.perUsd') }}</th><th class="hide-sm" /></tr>
        </thead>
        <tbody>
          <tr>
            <td><b class="mono">USD</b> <span class="muted">{{ t('fx.names.USD') }}</span></td>
            <td class="r num">1</td>
            <td class="hide-sm muted" />
          </tr>
          <tr v-for="c in EDITABLE" :key="c">
            <td><b class="mono">{{ c }}</b> <span class="muted">{{ t('fx.names.' + c) }}</span></td>
            <td class="r">
              <input
                v-model.number="form.rates[c]" type="number" min="0.0001" step="0.0001" inputmode="decimal"
                class="input rate num" :class="{ invalid: invalid.includes(c) }" :disabled="locked" :aria-label="`${t('fx.table.perUsd')} ${c}`"
              />
            </td>
            <td class="hide-sm muted num">{{ example(c) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="callout neutral">{{ t('fx.note', { rate: fmt.number(Number(form.rates.TRY) || 0, 2), cur: 'TRY' }) }} · {{ fmt.date(form.date) }}</div>
    </div>
    <template v-if="!loading" #footer>
      <div class="actions">
        <button class="btn btn-ghost" :disabled="saving || locked" @click="resetDemo">{{ t('fx.table.reset') }}</button>
        <span class="spacer" />
        <button class="btn btn-ghost" :disabled="!dirty || saving" @click="Object.assign(form, JSON.parse(initial))">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!dirty || saving || locked || invalid.length > 0" :title="locked ? t('common.noPermission') : undefined" @click="save">
          <Spinner v-if="saving" :size="14" />{{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.row { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; padding-bottom: 18px; border-bottom: 1px solid var(--line-1); }
.lbl { font-weight: 600; font-size: 13.5px; }
.hint { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.ctl { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; min-width: 0; }
.input.date { max-width: 200px; }
.fx-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.fx-table th { text-align: left; font-size: 11.5px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; border-bottom: 1px solid var(--line-1); }
.fx-table td { padding: 8px; border-bottom: 1px solid var(--line-1); vertical-align: middle; }
.fx-table .r { text-align: right; }
.input.rate { width: 140px; text-align: right; margin-left: auto; display: block; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.actions { display: flex; align-items: center; gap: 8px; }
.spacer { flex: 1; }
@media (max-width: 860px) { .row { grid-template-columns: 1fr; } }
</style>
