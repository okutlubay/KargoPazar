<script>
export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name }))

// 81 provinces (plate order 01-81).
export const TR_PROVINCES = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir',
  'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir',
  'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir',
  'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman',
  'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye',
  'Düzce',
]

export const POSTAL = {
  US: /^\d{5}(-\d{4})?$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  DE: /^\d{5}$/,
  TR: /^\d{5}$/,
}

/** "sw1a1aa" -> "SW1A 1AA" */
export function normalizeGbPostcode(v) {
  const s = String(v || '').toUpperCase().replace(/\s+/g, '')
  if (s.length < 5) return String(v || '').toUpperCase().trim()
  return s.slice(0, -3) + ' ' + s.slice(-3)
}

/** One-line address used in suggestion boxes and summaries. */
export function formatAddressLine(a = {}) {
  const street = [a.line1, a.line2].filter(Boolean).join(' ')
  const tail = [a.state, a.zip].filter(Boolean).join(' ')
  return [street, a.city, tail].filter(Boolean).join(', ')
}
</script>

<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import FormField from './FormField.vue'
import Toggle from './Toggle.vue'
import ScoreBadge from './ScoreBadge.vue'
import Spinner from './Spinner.vue'
import { email as emailRule, pattern, validateAll } from './validation.js'
import { useI18n } from '@/app/i18n/index.js'

const props = defineProps({
  // { name, company, line1, line2, city, state, zip, country, phone, email, residential }
  modelValue: { type: Object, default: () => ({}) },
  country: { type: String, default: '' }, // overrides modelValue.country (default 'US')
  // generic country format (from country config): { fields: [{ key, label{tr,en}, required }], postalRegex, postalExample }
  format: { type: Object, default: null },
  // async (address) => { score, issues: [{ code, label }], suggestion: {...partial address} | null }
  validator: { type: Function, default: null },
  countries: { type: Array, default: () => [] }, // [{ code, name }] -> shows a country select
  showPhone: { type: Boolean, default: true },
  showEmail: { type: Boolean, default: true },
  showResidential: { type: Boolean, default: true },
  showCompany: { type: Boolean, default: true },
  requiredFields: { type: Array, default: () => [] }, // extra required keys, e.g. ['phone']
  disabled: { type: Boolean, default: false },
  debounce: { type: Number, default: 400 },
})
const emit = defineEmits(['update:modelValue', 'apply-suggestion', 'validated', 'country-change'])
const { t, tx, locale } = useI18n()

const model = computed(() => props.modelValue || {})
const cc = computed(() => (props.country || model.value.country || 'US').toUpperCase())

// ---- model updates (merged within a tick so several patches do not overwrite each other)
let pending = null
function patch(obj) {
  pending = { ...(pending || model.value), ...obj }
  emit('update:modelValue', pending)
  nextTick(() => { pending = null })
}
function set(key, v) { patch({ [key]: v }) }

watch(() => props.country, c => {
  if (c && model.value.country !== c.toUpperCase()) patch({ country: c.toUpperCase() })
}, { immediate: true })

// ---- field definitions per country
const phoneRule = pattern(/^[+\d(][\d\s().-]{6,}$/, 'components.address.phoneInvalid')
const L = k => t('components.address.' + k)

const fields = computed(() => {
  void locale.value
  const c = cc.value
  const F = []
  const add = (key, label, opts = {}) => F.push({ key, label, type: 'text', span: 12, required: false, rules: [], ...opts })
  add('name', L('name'), { span: props.showCompany ? 6 : 12, required: true, autocomplete: 'name' })
  if (props.showCompany) add('company', L('company'), { span: 6, autocomplete: 'organization', optional: true })

  if (c === 'US') {
    add('line1', L('line1'), { required: true, autocomplete: 'address-line1', placeholder: '1450 Market St' })
    add('line2', L('line2'), { autocomplete: 'address-line2', optional: true, placeholder: L('line2Ph') })
    add('city', L('city'), { span: 5, required: true, autocomplete: 'address-level2' })
    add('state', L('state'), { span: 4, required: true, type: 'select', autocomplete: 'address-level1', options: US_STATES.map(s => ({ value: s.code, label: s.code + ' - ' + s.name })) })
    add('zip', L('zip'), { span: 3, required: true, autocomplete: 'postal-code', placeholder: '94103', inputmode: 'numeric', rules: [pattern(POSTAL.US, 'components.address.zipUsErr')], hint: '' })
  } else if (c === 'GB') {
    add('line1', L('line1'), { required: true, autocomplete: 'address-line1' })
    add('line2', L('line2'), { autocomplete: 'address-line2', optional: true })
    add('city', L('town'), { span: 5, required: true, autocomplete: 'address-level2' })
    add('state', L('county'), { span: 4, optional: true, autocomplete: 'address-level1' })
    add('zip', L('postcode'), { span: 3, required: true, autocomplete: 'postal-code', placeholder: 'SW1A 1AA', normalize: normalizeGbPostcode, rules: [pattern(POSTAL.GB, 'components.address.postcodeGbErr')] })
  } else if (c === 'TR') {
    const provinces = [...TR_PROVINCES].sort((a, b) => a.localeCompare(b, 'tr'))
    add('line1', L('line1Tr'), { required: true, autocomplete: 'address-line1' })
    add('line2', L('line2'), { autocomplete: 'address-line2', optional: true })
    add('state', L('province'), { span: 5, required: true, type: 'select', autocomplete: 'address-level1', options: provinces.map(p => ({ value: p, label: p })) })
    add('city', L('district'), { span: 4, required: true, autocomplete: 'address-level2' })
    add('zip', L('postcode'), { span: 3, required: true, autocomplete: 'postal-code', placeholder: '34000', inputmode: 'numeric', rules: [pattern(POSTAL.TR, 'components.address.postcode5Err')] })
  } else if (c === 'DE') {
    add('line1', L('line1De'), { required: true, autocomplete: 'address-line1', placeholder: 'Friedrichstraße 43' })
    add('line2', L('line2'), { autocomplete: 'address-line2', optional: true })
    add('zip', L('plz'), { span: 4, required: true, autocomplete: 'postal-code', placeholder: '10117', inputmode: 'numeric', rules: [pattern(POSTAL.DE, 'components.address.plzErr')] })
    add('city', L('city'), { span: 8, required: true, autocomplete: 'address-level2' })
  } else {
    const fmtFields = props.format?.fields?.filter(f => !['name', 'company', 'phone', 'email'].includes(f.key))
    const postalRx = props.format?.postalRegex ? new RegExp(props.format.postalRegex, 'i') : null
    if (fmtFields?.length) {
      const addrFields = fmtFields.filter(f => f.key === 'line1' || f.key === 'line2')
      const rest = fmtFields.filter(f => f.key !== 'line1' && f.key !== 'line2')
      const span = rest.length >= 3 ? 4 : rest.length === 2 ? 6 : 12
      for (const f of [...addrFields, ...rest]) {
        const isZip = f.key === 'zip'
        add(f.key, tx(f.label) || L(f.key), {
          span: f.key === 'line1' || f.key === 'line2' ? 12 : span,
          required: !!f.required,
          optional: !f.required,
          placeholder: isZip ? props.format.postalExample || '' : '',
          rules: isZip && postalRx ? [pattern(postalRx, 'common.validation.zip')] : [],
          normalize: isZip ? v => String(v || '').toUpperCase().trim() : null,
          autocomplete: { line1: 'address-line1', line2: 'address-line2', city: 'address-level2', state: 'address-level1', zip: 'postal-code' }[f.key],
        })
      }
    } else {
      add('line1', L('line1'), { required: true, autocomplete: 'address-line1' })
      add('line2', L('line2'), { autocomplete: 'address-line2', optional: true })
      add('city', L('city'), { span: 5, required: true, autocomplete: 'address-level2' })
      add('state', L('region'), { span: 4, optional: true, autocomplete: 'address-level1' })
      add('zip', L('postcode'), { span: 3, autocomplete: 'postal-code', optional: true, rules: postalRx ? [pattern(postalRx, 'common.validation.zip')] : [] })
    }
  }
  if (props.showPhone) add('phone', L('phone'), { span: props.showEmail ? 6 : 12, type: 'tel', autocomplete: 'tel', rules: [phoneRule], optional: true })
  if (props.showEmail) add('email', L('email'), { span: props.showPhone ? 6 : 12, type: 'email', autocomplete: 'email', rules: [emailRule()], optional: true })

  for (const f of F) {
    if (props.requiredFields.includes(f.key)) { f.required = true; f.optional = false }
  }
  return F
})

const countryOptions = computed(() => props.countries.map(c => ({ value: c.code, label: tx(c.name) || c.code })))
function onCountry(e) {
  const code = e.target.value
  patch({ country: code, state: '', zip: '' })
  emit('country-change', code)
}

// ---- refs + validation API
const root = ref(null)
const fieldRefs = {}
function setRef(key, el) { if (el) fieldRefs[key] = el; else delete fieldRefs[key] }
function orderedRefs() { return fields.value.map(f => fieldRefs[f.key]).filter(Boolean) }
function validate() { return validateAll(orderedRefs(), { scroll: false }) }
function focus(opts) {
  const first = orderedRefs().find(r => r.invalid) || orderedRefs()[0]
  first?.focus(opts)
}

function onBlurField(f) {
  if (f.normalize) {
    const v = model.value[f.key]
    const n = f.normalize(v)
    if (n !== v && v) set(f.key, n)
  } else if (typeof model.value[f.key] === 'string' && model.value[f.key] !== model.value[f.key].trim()) {
    set(f.key, model.value[f.key].trim())
  }
}

// ---- residential auto-detect from company
const residentialManual = ref(false)
watch(() => model.value.company, company => {
  if (!props.showResidential || residentialManual.value) return
  const res = !String(company || '').trim()
  if (model.value.residential !== res) set('residential', res)
}, { immediate: true })
function onResidential(v) {
  residentialManual.value = true
  set('residential', v)
}

// ---- live validation (AI address model)
const vState = ref('idle') // idle | checking | done | error
const result = ref(null)
let timer = null
let seq = 0
const ready = computed(() => !!(String(model.value.line1 || '').trim() && (String(model.value.zip || '').trim() || String(model.value.city || '').trim())))
const watchKey = computed(() => ['line1', 'line2', 'city', 'state', 'zip', 'country', 'company', 'name'].map(k => model.value[k] || '').join('|') + '|' + cc.value)

async function runValidator() {
  if (!props.validator) return
  if (!ready.value) { vState.value = 'idle'; result.value = null; return }
  const my = ++seq
  vState.value = 'checking'
  try {
    const res = await props.validator({ ...model.value, country: cc.value })
    if (my !== seq) return
    result.value = res || null
    vState.value = 'done'
    emit('validated', res)
  } catch {
    if (my !== seq) return
    vState.value = 'error'
    result.value = null
    emit('validated', null)
  }
}
watch(watchKey, () => {
  if (!props.validator) return
  clearTimeout(timer)
  timer = setTimeout(runValidator, props.debounce)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))

const issues = computed(() => (result.value?.issues || []).map(i => ({ ...i, text: tx(i.label) || i.code })))

// Suggestion with changed words highlighted.
const DIFF_KEYS = ['line1', 'line2', 'city', 'state', 'zip']
const suggestionParts = computed(() => {
  const s = result.value?.suggestion
  if (!s) return null
  const merged = { ...model.value, ...s }
  const words = key => new Set(String(model.value[key] || '').toLowerCase().split(/\s+/).filter(Boolean))
  const piece = key => {
    const val = String(merged[key] || '').trim()
    if (!val) return []
    const orig = words(key)
    return val.split(/(\s+)/).map(tok => ({ text: tok, changed: !!tok.trim() && !orig.has(tok.toLowerCase().replace(/,$/, '')) }))
  }
  const out = []
  const push = (arr, sep) => { if (arr.length) { if (out.length && sep) out.push({ text: sep, changed: false }); out.push(...arr) } }
  push(piece('line1'))
  push(piece('line2'), ' ')
  push(piece('city'), ', ')
  push(piece('state'), ', ')
  push(piece('zip'), merged.state ? ' ' : ', ')
  const anyChange = DIFF_KEYS.some(k => String(s[k] ?? model.value[k] ?? '') !== String(model.value[k] ?? ''))
  return anyChange ? out : null
})
function applySuggestion() {
  const s = result.value?.suggestion
  if (!s) return
  patch({ ...s })
  emit('apply-suggestion', s)
}

defineExpose({ validate, focus, el: root, revalidate: runValidator, result })
</script>

<template>
  <fieldset ref="root" class="kpz-address" :disabled="disabled">
    <div class="af-grid">
      <FormField v-if="countryOptions.length" class="span-12" :label="L('country')" :value="cc" required v-slot="{ id, invalid, describedBy }">
        <select :id="id" class="select" :value="cc" autocomplete="country" :aria-invalid="invalid" :aria-describedby="describedBy" @change="onCountry">
          <option v-for="o in countryOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </FormField>

      <FormField
        v-for="f in fields"
        :key="cc + f.key"
        :ref="el => setRef(f.key, el)"
        :class="'span-' + f.span"
        :label="f.label"
        :required="f.required"
        :optional="f.optional"
        :rules="f.rules"
        :value="model[f.key]"
        :hint="f.hint"
        v-slot="{ id, invalid, describedBy }"
      >
        <select
          v-if="f.type === 'select'"
          :id="id"
          class="select"
          :value="model[f.key] || ''"
          :autocomplete="f.autocomplete"
          :aria-invalid="invalid"
          :aria-required="f.required"
          :aria-describedby="describedBy"
          @change="set(f.key, $event.target.value)"
        >
          <option value="" disabled>{{ L('selectPlaceholder') }}</option>
          <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-else
          :id="id"
          class="input"
          :type="f.type"
          :value="model[f.key] ?? ''"
          :placeholder="f.placeholder || undefined"
          :autocomplete="f.autocomplete"
          :inputmode="f.inputmode"
          :aria-invalid="invalid"
          :aria-required="f.required"
          :aria-describedby="describedBy"
          @input="set(f.key, $event.target.value)"
          @blur="onBlurField(f)"
        />
      </FormField>
    </div>

    <div v-if="showResidential" class="af-res">
      <Toggle
        :model-value="!!model.residential"
        :label="L('residential')"
        :description="residentialManual ? L('residentialManual') : L('residentialAuto')"
        @update:model-value="onResidential"
      />
      <span class="af-res-pill" :class="model.residential ? 'res' : 'biz'">
        <Icon :name="model.residential ? 'home' : 'store'" :size="12" />
        {{ model.residential ? L('residentialYes') : L('business') }}
      </span>
    </div>

    <div v-if="validator" class="af-validate" :class="'vs-' + vState" aria-live="polite">
      <div class="av-head">
        <span class="badge-ai"><Icon name="spark" :size="11" />{{ t('common.aiBadge') }}</span>
        <span class="av-title">{{ L('validationTitle') }}</span>
        <span class="av-right">
          <Spinner v-if="vState === 'checking'" :size="14" />
          <ScoreBadge v-if="vState === 'done' && result && result.score != null" :score="result.score" show-label size="sm" />
        </span>
      </div>
      <div v-if="vState === 'idle'" class="av-note">{{ L('validationIdle') }}</div>
      <div v-else-if="vState === 'checking' && !result" class="av-note">{{ L('validating') }}</div>
      <div v-else-if="vState === 'error'" class="av-note av-err">
        <Icon name="alert" :size="13" />{{ t('common.errorGeneric') }}
        <button type="button" class="btn btn-ghost btn-sm" @click="runValidator">{{ t('common.retry') }}</button>
      </div>
      <template v-else-if="result">
        <ul v-if="issues.length" class="av-issues">
          <li v-for="i in issues" :key="i.code"><Icon name="alert" :size="13" />{{ i.text }}</li>
        </ul>
        <div v-else class="av-ok"><Icon name="check-circle" :size="14" />{{ L('validationOk') }}</div>
        <div v-if="suggestionParts" class="av-sugg">
          <div class="av-sugg-text">
            <span class="av-sugg-q">{{ L('didYouMean') }}</span>
            <span class="av-sugg-addr"><template v-for="(p, i) in suggestionParts" :key="i"><mark v-if="p.changed">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
          </div>
          <button type="button" class="btn btn-accent btn-sm" @click="applySuggestion"><Icon name="check" :size="13" />{{ t('common.apply') }}</button>
        </div>
      </template>
    </div>
  </fieldset>
</template>

<style scoped>
.kpz-address { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.af-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px 12px; }
.span-12 { grid-column: span 12; }
.span-8 { grid-column: span 8; }
.span-6 { grid-column: span 6; }
.span-5 { grid-column: span 5; }
.span-4 { grid-column: span 4; }
.span-3 { grid-column: span 3; }
@media (max-width: 640px) {
  .af-grid > * { grid-column: span 12; }
}
.af-res { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.af-res-pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid var(--line-1); background: var(--bg-2); color: var(--ink-2); }
.af-validate { border: 1px solid var(--line-1); border-radius: var(--r-md); background: var(--bg-2); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.av-head { display: flex; align-items: center; gap: 8px; }
.av-title { font-weight: 600; font-size: 13px; }
.av-right { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.av-note { font-size: 12.5px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.av-err { color: var(--danger); }
.av-issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.av-issues li { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: oklch(0.45 0.10 65); }
.av-issues li :deep(svg) { margin-top: 2px; flex: none; }
.av-ok { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: oklch(0.42 0.11 155); }
.av-sugg {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 12px; border-radius: 8px; background: var(--surface); border: 1px solid oklch(0.9 0.05 268);
}
.av-sugg-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
.av-sugg-q { font-size: 12px; color: var(--accent-ink); font-weight: 500; }
.av-sugg-addr { color: var(--ink-1); }
.av-sugg-addr mark { background: var(--accent-soft); color: var(--accent-ink); font-weight: 700; padding: 0 2px; border-radius: 3px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
</style>
