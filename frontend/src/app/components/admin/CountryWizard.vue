<script setup>
// New market wizard (spec 9.6): pick a preset (CA, FR, NL, AU), defaults are filled automatically,
// address format template, carriers, customs thresholds, restricted goods, activate.
// The activated country is immediately an origin in the international shipment wizard and in AddressForm.
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import Stepper from '../Stepper.vue'
import Spinner from '../Spinner.vue'
import EmptyState from '../EmptyState.vue'
import AddressForm from '../AddressForm.vue'
import CountryForm from './CountryForm.vue'
import Flag from '../intl/Flag.vue'
import AddressFormatEditor from './AddressFormatEditor.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { countryPresets, createCountry, testPostcode } from '../../api/countries.js'
import { errorText, fieldText } from '../settings/util.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'done'])
const { t, tx, fmt } = useI18n()
const router = useRouter()

const KEYS = ['country', 'defaults', 'address', 'carriers', 'customs', 'review']
const step = ref(0)
const maxReached = ref(0)
const presets = ref([])
const picked = ref('')
const draft = ref(null)
const errors = ref({})
const saving = ref(false)
const created = ref(null)
const previewAddr = ref({})

watch(() => props.open, v => { if (v) reset() }, { immediate: true })
function reset() {
  presets.value = countryPresets()
  picked.value = ''
  draft.value = null
  errors.value = {}
  step.value = 0
  maxReached.value = 0
  created.value = null
  previewAddr.value = {}
}

function pick(code) {
  const p = presets.value.find(x => x.code === code)
  if (!p) return
  picked.value = code
  draft.value = reactive(JSON.parse(JSON.stringify({ ...p, deMinimis: { status: 'applied', ...(p.deMinimis ?? { amount: 0, currency: p.currency }) } })))
  previewAddr.value = { country: code }
  errors.value = {}
}

const STEP_OF = k => (k === 'code' ? 0 : k.startsWith('addressFormat') ? 2 : k === 'carriers' ? 3 : k.startsWith('deMinimis') || k === 'vatRate' ? 4 : 1)
const steps = computed(() => KEYS.map((k, i) => ({ key: k, label: t('admin.countries.wizard.steps.' + k), error: Object.keys(errors.value).some(e => STEP_OF(e) === i) })))
const msg = computed(() => Object.fromEntries(Object.entries(errors.value).map(([k, v]) => [k, fieldText(v, 'admin')])))

function check(i) {
  const d = draft.value
  const e = {}
  if (!d) return { code: 'required' }
  if (i >= 1) {
    if (!String(d.name.tr).trim()) e['name.tr'] = 'required'
    if (!String(d.name.en).trim()) e['name.en'] = 'required'
    if (!/^[A-Z]{3}$/.test(d.currency ?? '')) e.currency = 'currency'
    if (!String(d.currencySymbol ?? '').trim()) e.currencySymbol = 'required'
    if (!(Number(d.fxToUsd) > 0)) e.fxToUsd = 'positive'
  }
  if (i >= 2) {
    const f = d.addressFormat
    if (!f.fields?.length) e['addressFormat.fields'] = 'required'
    else if (!f.fields.some(x => x.key === 'line1')) e['addressFormat.fields'] = 'line1_required'
    if (!String(f.postalRegex ?? '').trim()) e['addressFormat.postalRegex'] = 'required'
    else if (testPostcode(f.postalRegex, 'x').error) e['addressFormat.postalRegex'] = 'regex'
    else if (f.postalExample && testPostcode(f.postalRegex, f.postalExample).valid === false) e['addressFormat.postalExample'] = 'example_mismatch'
  }
  if (i >= 3 && !(d.carriers ?? []).length) e.carriers = 'required'
  if (i >= 4) {
    if (!(Number(d.deMinimis?.amount) >= 0)) e['deMinimis.amount'] = 'number'
    if (!(Number(d.vatRate) >= 0 && Number(d.vatRate) <= 0.5)) e.vatRate = 'range'
  }
  return e
}
function next() {
  const e = check(step.value)
  errors.value = e
  if (Object.keys(e).length) {
    const s = Math.min(...Object.keys(e).map(STEP_OF))
    if (s < step.value) step.value = s
    requestAnimationFrame(() => document.querySelector('.cwz [aria-invalid="true"], .cwz .field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return
  }
  step.value++
  maxReached.value = Math.max(maxReached.value, step.value)
}
function back() { if (step.value > 0) step.value-- }
const canNavigate = i => !created.value && !!draft.value && i <= maxReached.value

async function activate() {
  const e = check(5)
  errors.value = e
  if (Object.keys(e).length) { step.value = Math.min(...Object.keys(e).map(STEP_OF)); return }
  saving.value = true
  try {
    const r = await createCountry(JSON.parse(JSON.stringify(draft.value)))
    created.value = r
    toast.success(t('admin.countries.wizard.activated', { name: tx(r.country.name) }))
    emit('done', r.country)
  } catch (err) {
    errors.value = err?.details ?? {}
    if (err?.details) { const s = Math.min(...Object.keys(err.details).map(STEP_OF)); if (Number.isFinite(s)) step.value = s }
    toast.error(errorText(err, 'admin'))
  } finally { saving.value = false }
}

async function close() {
  if (draft.value && !created.value) {
    const ok = await confirm({ title: t('admin.countries.wizard.discardTitle'), message: t('admin.countries.wizard.discardDesc'), confirmLabel: t('admin.countries.wizard.discard'), danger: true })
    if (!ok) return
  }
  emit('update:open', false)
}
function goIntl() { const code = created.value.country.code; emit('update:open', false); router.push({ name: 'intl-new', query: { origin: code } }) }

const svcNames = computed(() => (draft.value?.carriers ?? []).join(', '))
</script>

<template>
  <Modal :open="open" :title="t('admin.countries.wizard.title')" :subtitle="t('admin.countries.wizard.subtitle')" size="xl" @update:open="v => !v && close()">
    <div class="cwz">
      <Stepper v-model:current="step" :steps="steps" :max-reached="maxReached" :can-navigate="canNavigate" :aria-label="t('admin.countries.wizard.title')" />

      <!-- 0 country -->
      <section v-if="step === 0" class="stack-lg">
        <EmptyState v-if="!presets.length" icon="globe" :title="t('admin.countries.wizard.noPresets')" :description="t('admin.countries.wizard.noPresetsDesc')" compact />
        <template v-else>
          <p class="hint">{{ t('admin.countries.wizard.pickHint') }}</p>
          <div class="presets" role="radiogroup" :aria-label="t('admin.countries.wizard.steps.country')">
            <button v-for="p in presets" :key="p.code" type="button" role="radio" :aria-checked="picked === p.code" :class="['preset', { on: picked === p.code }]" @click="pick(p.code)">
              <Flag :code="p.code" :size="24" :title="tx(p.name)" />
              <span class="pname">{{ tx(p.name) }}</span>
              <span class="pmeta mono">{{ p.code }} · {{ p.currency }} · {{ p.units === 'metric' ? t('admin.countries.metric') : t('admin.countries.imperial') }}</span>
              <span class="pmeta">{{ t('admin.countries.wizard.point', { name: tx(p.originPoint?.name) || '-' }) }}</span>
            </button>
          </div>
          <div v-if="errors.code" class="field-error">{{ msg.code || t('admin.countries.wizard.pickRequired') }}</div>
          <div v-if="draft" class="callout"><Icon name="wand" :size="14" />{{ t('admin.countries.wizard.autofilled', { cur: draft.currency, units: draft.units === 'metric' ? t('admin.countries.metric') : t('admin.countries.imperial'), lang: draft.defaultLang.toUpperCase() }) }}</div>
        </template>
      </section>

      <!-- 1 defaults -->
      <section v-else-if="step === 1 && draft"><CountryForm :country="draft" section="general" :errors="msg" /></section>

      <!-- 2 address -->
      <section v-else-if="step === 2 && draft" class="stack-lg">
        <div class="callout neutral"><Icon name="info" :size="14" />{{ t('admin.countries.wizard.templateHint', { name: tx(draft.name) }) }}</div>
        <AddressFormatEditor v-model="draft.addressFormat" :errors="msg" />
        <div class="live">
          <div class="lbl">{{ t('admin.countries.wizard.livePreview') }}</div>
          <AddressForm v-model="previewAddr" :country="draft.code" :format="draft.addressFormat" :show-email="false" :show-residential="false" />
        </div>
      </section>

      <!-- 3 carriers -->
      <section v-else-if="step === 3 && draft"><CountryForm :country="draft" section="carriers" :errors="msg" /></section>

      <!-- 4 customs -->
      <section v-else-if="step === 4 && draft" class="stack-lg">
        <CountryForm :country="draft" section="customs" :errors="msg" />
        <div v-if="draft.originPoint" class="callout neutral"><Icon name="warehouse" :size="14" />{{ t('admin.countries.wizard.pointInfo', { name: tx(draft.originPoint.name), city: draft.originPoint.address?.city, flights: (draft.originPoint.flights ?? []).join(', ') }) }}</div>
      </section>

      <!-- 5 review -->
      <section v-else-if="draft" class="stack-lg">
        <div v-if="!created" class="review">
          <div class="rv-flag"><Flag :code="draft.code" :size="36" :title="tx(draft.name)" /></div>
          <dl class="kv">
            <dt>{{ t('admin.countries.country') }}</dt><dd>{{ tx(draft.name) }} ({{ draft.code }})</dd>
            <dt>{{ t('admin.countries.role') }}</dt><dd>{{ t('admin.countries.roles.' + draft.role) }}</dd>
            <dt>{{ t('admin.countries.currency') }}</dt><dd>{{ draft.currency }} ({{ draft.currencySymbol }}) · 1 {{ draft.currency }} = {{ fmt.moneyNative(draft.fxToUsd, 'USD', 2) }}</dd>
            <dt>{{ t('admin.countries.units') }}</dt><dd>{{ draft.units === 'metric' ? t('admin.countries.metric') : t('admin.countries.imperial') }} · {{ draft.defaultLang.toUpperCase() }}</dd>
            <dt>{{ t('admin.countries.addressFormat') }}</dt><dd>{{ draft.addressFormat.fields.map(f => tx(f.label)).join(' · ') }}</dd>
            <dt>{{ t('admin.countries.postalRegex') }}</dt><dd class="mono">{{ draft.addressFormat.postalRegex }} ({{ draft.addressFormat.postalExample }})</dd>
            <dt>{{ t('admin.countries.carriersTitle') }}</dt><dd class="mono small">{{ svcNames }}</dd>
            <dt>{{ t('admin.countries.deMinimis') }}</dt><dd><template v-if="draft.deMinimis.status === 'suspended'">{{ t('admin.countries.deMinimisSuspended') }}</template><template v-else>{{ fmt.number(draft.deMinimis.amount) }} {{ draft.deMinimis.currency }}</template> · {{ t('admin.countries.vat') }} {{ fmt.percent(draft.vatRate, 0) }}</dd>
            <dt>{{ t('admin.countries.prohibited') }}</dt><dd>{{ (draft.prohibited ?? []).map(p => tx(p.category)).join(', ') || '-' }}</dd>
          </dl>
        </div>
        <div v-else class="done">
          <Icon name="check-circle" :size="24" />
          <div>
            <strong>{{ t('admin.countries.wizard.doneTitle', { name: tx(created.country.name) }) }}</strong>
            <ul class="done-list">
              <li>{{ t('admin.countries.wizard.done1') }}</li>
              <li>{{ t('admin.countries.wizard.done2') }}</li>
              <li>{{ t('admin.countries.wizard.done3') }}</li>
            </ul>
            <button class="btn btn-primary btn-sm" @click="goIntl"><Icon name="plane" :size="13" />{{ t('admin.countries.wizard.tryIntl') }}</button>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <button v-if="step > 0 && !created" class="btn btn-ghost" @click="back"><Icon name="chevron-left" :size="13" />{{ t('common.back') }}</button>
      <span class="grow" />
      <button class="btn btn-ghost" @click="close">{{ created ? t('common.close') : t('common.cancel') }}</button>
      <button v-if="step < 5" class="btn btn-primary" :disabled="!draft" @click="next">{{ t('common.next') }}<Icon name="chevron-right" :size="13" /></button>
      <button v-else-if="!created" class="btn btn-primary" :disabled="saving" @click="activate"><Spinner v-if="saving" :size="14" /><Icon v-else name="bolt" :size="13" />{{ t('admin.countries.wizard.activate') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.cwz { display: flex; flex-direction: column; gap: 20px; min-height: 420px; }
.hint { font-size: 12.5px; color: var(--ink-3); margin: 0; }
.lbl { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.preset { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 14px; border: 1px solid var(--line-2); border-radius: 12px; background: var(--surface); text-align: left; cursor: pointer; }
.preset:hover { border-color: var(--ink-4); }
.preset.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.flag { font-size: 28px; line-height: 1; }
.pname { font-weight: 600; font-size: 14.5px; }
.pmeta { font-size: 11.5px; color: var(--ink-3); }
.live { padding: 14px; border: 1px solid var(--line-1); border-radius: 12px; background: var(--bg-2); }
.review { display: flex; gap: 20px; align-items: flex-start; }
.rv-flag { font-size: 44px; line-height: 1; }
.review .kv { flex: 1; }
.small { font-size: 12px; }
.done { display: flex; gap: 12px; padding: 16px; border-radius: 12px; background: oklch(0.96 0.04 155); color: oklch(0.38 0.1 155); }
.done-list { margin: 8px 0 12px; padding-left: 18px; color: var(--ink-2); font-size: 13px; }
.grow { flex: 1; }
@media (max-width: 860px) { .presets { grid-template-columns: repeat(2, minmax(0, 1fr)); } .review { flex-direction: column; } }
</style>
