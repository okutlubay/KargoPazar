<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Card from '../Card.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import SegmentedControl from '../SegmentedControl.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { getSettings, updatePreferences } from '../../api/settings.js'
import { errorText } from './util.js'

const { t, fmt, locale } = useI18n()
const loading = ref(true)
const saving = ref(false)
const form = reactive({ units: 'imperial', currencyDisplay: 'symbol', dateFormat: 'locale' })
let initial = ''
const dirty = computed(() => JSON.stringify(form) !== initial)
const locked = computed(() => !can('settings.manage'))

onMounted(async () => {
  try {
    const s = await getSettings()
    Object.assign(form, { units: s.preferences.units ?? 'imperial', currencyDisplay: s.preferences.currencyDisplay ?? 'symbol', dateFormat: s.preferences.dateFormat ?? 'locale' })
    initial = JSON.stringify(form)
  } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
})

const sample = { weightLb: 3.2, dims: { lengthIn: 12, widthIn: 10, heightIn: 6 }, amount: 1248.6, date: new Date() }
const pad = n => String(n).padStart(2, '0')
function previewDate(kind) {
  const d = sample.date
  if (kind === 'iso') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (kind === 'us') return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (kind === 'eu') return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return fmt.dateTime(d.toISOString())
}
function previewMoney(kind) {
  if (kind === 'code') return (locale.value === 'tr' ? fmt.number(sample.amount, 2) + ' USD' : 'USD ' + fmt.number(sample.amount, 2))
  return fmt.money(sample.amount)
}

const unitOptions = computed(() => [
  { value: 'imperial', label: t('settings.units.imperial') },
  { value: 'metric', label: t('settings.units.metric') },
])
const currencyOptions = computed(() => [
  { value: 'symbol', label: t('settings.units.currencySymbol') },
  { value: 'code', label: t('settings.units.currencyCode') },
])
const dateOptions = computed(() => ['locale', 'iso', 'us', 'eu'].map(v => ({ value: v, label: t('settings.units.date.' + v) })))

async function save() {
  saving.value = true
  try {
    await updatePreferences({ ...form })
    initial = JSON.stringify(form)
    toast.success(t('settings.units.saved'))
  } catch (e) { toast.error(errorText(e)) } finally { saving.value = false }
}
</script>

<template>
  <Card :title="t('settings.units.title')" :subtitle="t('settings.units.desc')">
    <div v-if="loading"><Skeleton :lines="6" /></div>
    <div v-else class="stack-lg">
      <div class="row">
        <div class="lbl-col">
          <div class="lbl">{{ t('settings.units.system') }}</div>
          <div class="hint">{{ t('settings.units.systemHint') }}</div>
        </div>
        <div class="ctl">
          <SegmentedControl v-model="form.units" :options="unitOptions" :aria-label="t('settings.units.system')" />
          <div class="preview">
            <span>{{ t('settings.units.previewWeight') }}: <b class="num">{{ fmt.weight(sample.weightLb, form.units) }}</b></span>
            <span>{{ t('settings.units.previewDims') }}: <b class="num">{{ fmt.dims(sample.dims, form.units) }}</b></span>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="lbl-col">
          <div class="lbl">{{ t('settings.units.currency') }}</div>
          <div class="hint">{{ t('settings.units.currencyHint') }}</div>
        </div>
        <div class="ctl">
          <SegmentedControl v-model="form.currencyDisplay" :options="currencyOptions" :aria-label="t('settings.units.currency')" />
          <div class="preview"><span>{{ t('settings.units.preview') }}: <b class="num">{{ previewMoney(form.currencyDisplay) }}</b></span></div>
        </div>
      </div>
      <div class="row">
        <div class="lbl-col">
          <div class="lbl">{{ t('settings.units.dateFormat') }}</div>
          <div class="hint">{{ t('settings.units.dateHint') }}</div>
        </div>
        <div class="ctl">
          <SegmentedControl v-model="form.dateFormat" :options="dateOptions" size="sm" :aria-label="t('settings.units.dateFormat')" />
          <div class="preview"><span>{{ t('settings.units.preview') }}: <b class="num">{{ previewDate(form.dateFormat) }}</b></span></div>
        </div>
      </div>
      <div class="callout neutral">{{ t('settings.units.note') }}</div>
    </div>
    <template v-if="!loading" #footer>
      <div class="actions">
        <button class="btn btn-ghost" :disabled="!dirty || saving" @click="Object.assign(form, JSON.parse(initial))">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!dirty || saving || locked" :title="locked ? t('common.noPermission') : undefined" @click="save">
          <Spinner v-if="saving" :size="14" />{{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.row { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; padding-bottom: 18px; border-bottom: 1px solid var(--line-1); }
.row:last-of-type { border-bottom: 0; }
.lbl { font-weight: 600; font-size: 13.5px; }
.hint { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.ctl { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; min-width: 0; }
.preview { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); background: var(--bg-2); border: 1px dashed var(--line-2); border-radius: 8px; padding: 8px 12px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 860px) { .row { grid-template-columns: 1fr; } }
</style>
