<script setup>
// Country configuration form sections (spec 9.6), shared by the detail editor and the new market wizard.
// v-model = country object (mutated in place through the reactive parent), `section` picks the part to render.
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import FormField from '../FormField.vue'
import SegmentedControl from '../SegmentedControl.vue'
import CarrierLogo from '../CarrierLogo.vue'
import { useI18n } from '../../i18n/index.js'
import { availableServices } from '../../api/countries.js'

const props = defineProps({
  country: { type: Object, required: true },
  section: { type: String, required: true }, // general | carriers | customs
  errors: { type: Object, default: () => ({}) },
  lockRole: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
const { t, tx, fmt } = useI18n()
const c = computed(() => props.country)
const services = computed(() => availableServices())
const groups = computed(() => {
  const m = new Map()
  for (const s of services.value) {
    if (!m.has(s.carrier)) m.set(s.carrier, { carrier: s.carrier, name: s.carrierName, type: s.type, items: [] })
    m.get(s.carrier).items.push(s)
  }
  return [...m.values()]
})
function toggleService(key) {
  const list = c.value.carriers ?? (c.value.carriers = [])
  const i = list.indexOf(key)
  if (i >= 0) list.splice(i, 1)
  else list.push(key)
}
function addProhibited() { (c.value.prohibited ?? (c.value.prohibited = [])).push({ category: { tr: '', en: '' }, hsPrefixes: [] }) }
function setPrefixes(p, v) { p.hsPrefixes = String(v).split(/[\s,;]+/).map(x => x.replace(/\D/g, '')).filter(Boolean) }
const vatPct = computed({ get: () => Math.round((Number(c.value.vatRate) || 0) * 1000) / 10, set: v => { c.value.vatRate = Number(v) / 100 } })
const deMinUsd = computed(() => (c.value.deMinimis?.amount != null && c.value.fxToUsd ? Number(c.value.deMinimis.amount) * Number(c.value.fxToUsd) : null))
</script>

<template>
  <div class="cf">
    <!-- general -->
    <div v-if="section === 'general'" class="stack-lg">
      <div class="form-grid">
        <FormField :label="t('admin.countries.nameTr')" required :error="errors['name.tr']" :value="c.name.tr" v-slot="{ id }">
          <input :id="id" v-model="c.name.tr" class="input" :disabled="disabled" />
        </FormField>
        <FormField :label="t('admin.countries.nameEn')" required :error="errors['name.en']" :value="c.name.en" v-slot="{ id }">
          <input :id="id" v-model="c.name.en" class="input" :disabled="disabled" />
        </FormField>
      </div>
      <div>
        <div class="lbl">{{ t('admin.countries.role') }}</div>
        <SegmentedControl v-model="c.role" :options="['origin', 'destination', 'both'].map(v => ({ value: v, label: t('admin.countries.roles.' + v), disabled: lockRole || disabled }))" :aria-label="t('admin.countries.role')" />
        <p v-if="lockRole" class="hint">{{ t('admin.countries.roleLocked') }}</p>
      </div>
      <div class="form-grid three">
        <FormField :label="t('admin.countries.currency')" required :error="errors.currency" :value="c.currency" v-slot="{ id }">
          <input :id="id" v-model="c.currency" class="input mono" maxlength="3" :disabled="disabled" @input="c.currency = c.currency.toUpperCase()" />
        </FormField>
        <FormField :label="t('admin.countries.symbol')" required :error="errors.currencySymbol" :value="c.currencySymbol" v-slot="{ id }">
          <input :id="id" v-model="c.currencySymbol" class="input" maxlength="4" :disabled="disabled" />
        </FormField>
        <FormField :label="t('admin.countries.fx')" required :hint="t('admin.countries.fxHint', { cur: c.currency || '-' })" :error="errors.fxToUsd" :value="c.fxToUsd" v-slot="{ id }">
          <input :id="id" v-model.number="c.fxToUsd" type="number" step="0.01" min="0" class="input num" :disabled="disabled" />
        </FormField>
      </div>
      <div class="form-grid">
        <div>
          <div class="lbl">{{ t('admin.countries.units') }}</div>
          <SegmentedControl v-model="c.units" :options="[{ value: 'metric', label: t('admin.countries.metric'), disabled }, { value: 'imperial', label: t('admin.countries.imperial'), disabled }]" :aria-label="t('admin.countries.units')" />
        </div>
        <div>
          <div class="lbl">{{ t('admin.countries.lang') }}</div>
          <SegmentedControl v-model="c.defaultLang" :options="[{ value: 'tr', label: 'Türkçe', disabled }, { value: 'en', label: 'English', disabled }]" :aria-label="t('admin.countries.lang')" />
        </div>
      </div>
    </div>

    <!-- carriers -->
    <div v-else-if="section === 'carriers'" class="stack">
      <p class="hint">{{ t('admin.countries.carriersHint') }}</p>
      <div v-if="errors.carriers" class="field-error">{{ errors.carriers }}</div>
      <div class="cgroups">
        <div v-for="g in groups" :key="g.carrier" class="cg">
          <CarrierLogo :code="g.carrier" :name="g.name" show-name :size="22" :sub="t('admin.types.' + g.type)" />
          <label v-for="s in g.items" :key="s.key" class="svc">
            <input type="checkbox" class="checkbox" :checked="(c.carriers ?? []).includes(s.key)" :disabled="disabled" @change="toggleService(s.key)" />
            <span>{{ s.serviceName }}</span>
          </label>
        </div>
      </div>
      <p class="hint">{{ t('admin.countries.selectedN', { n: (c.carriers ?? []).length }) }}</p>
    </div>

    <!-- customs -->
    <div v-else class="stack-lg">
      <div class="form-grid three">
        <FormField :label="t('admin.countries.deMinimis')" :error="errors['deMinimis.amount']" :value="c.deMinimis.amount" v-slot="{ id }">
          <input :id="id" v-model.number="c.deMinimis.amount" type="number" min="0" step="1" class="input num" :disabled="disabled" />
        </FormField>
        <FormField :label="t('admin.countries.deMinimisCur')" :value="c.deMinimis.currency" v-slot="{ id }">
          <input :id="id" v-model="c.deMinimis.currency" class="input mono" maxlength="3" :disabled="disabled" @input="c.deMinimis.currency = c.deMinimis.currency.toUpperCase()" />
        </FormField>
        <FormField :label="t('admin.countries.vat')" :error="errors.vatRate" :value="vatPct" v-slot="{ id }">
          <div class="suffix"><input :id="id" v-model.number="vatPct" type="number" min="0" max="50" step="0.5" class="input num" :disabled="disabled" /><span>%</span></div>
        </FormField>
      </div>
      <p v-if="deMinUsd != null" class="hint">{{ t('admin.countries.deMinimisUsd', { v: fmt.money(deMinUsd, 'USD', 0) }) }}</p>
      <div>
        <div class="sec-head">
          <div class="lbl">{{ t('admin.countries.prohibited') }}</div>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="disabled" @click="addProhibited"><Icon name="plus" :size="12" />{{ t('admin.countries.addProhibited') }}</button>
        </div>
        <div v-if="!(c.prohibited ?? []).length" class="hint">{{ t('admin.countries.noProhibited') }}</div>
        <div v-for="(p, i) in c.prohibited" :key="i" class="prow">
          <input v-model="p.category.tr" class="input sm" :placeholder="t('admin.countries.categoryTr')" :aria-label="t('admin.countries.categoryTr')" :disabled="disabled" />
          <input v-model="p.category.en" class="input sm" :placeholder="t('admin.countries.categoryEn')" :aria-label="t('admin.countries.categoryEn')" :disabled="disabled" />
          <input :value="(p.hsPrefixes ?? []).join(', ')" class="input sm mono" :placeholder="t('admin.countries.hsPrefixes')" :aria-label="t('admin.countries.hsPrefixes')" :disabled="disabled" @change="e => setPrefixes(p, e.target.value)" />
          <button type="button" class="btn-icon" :aria-label="t('admin.countries.removeProhibited')" :disabled="disabled" @click="c.prohibited.splice(i, 1)"><Icon name="trash" :size="13" /></button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lbl { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--ink-2); }
.hint { font-size: 12px; color: var(--ink-3); margin: 4px 0 0; }
.form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cgroups { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.cg { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: 10px; }
.svc { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.suffix { display: flex; align-items: center; gap: 6px; }
.suffix span { color: var(--ink-3); }
.suffix .input { width: 100%; }
.sec-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.prow { display: grid; grid-template-columns: 1fr 1fr 150px 32px; gap: 8px; margin-bottom: 6px; }
.input.sm { height: 32px; font-size: 13px; }
@media (max-width: 860px) { .form-grid.three { grid-template-columns: 1fr; } .prow { grid-template-columns: 1fr 1fr; } }
</style>
