<script setup>
// Own carrier account connection wizard (spec 7.4): carrier -> account details -> verification
// -> negotiated rates (auto fetch or manual %) -> done ("you will now see two prices").
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import Stepper from '../Stepper.vue'
import FormField from '../FormField.vue'
import CarrierLogo from '../CarrierLogo.vue'
import SegmentedControl from '../SegmentedControl.vue'
import Spinner from '../Spinner.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { OWN_ACCOUNT_CARRIERS, ACCOUNT_FIELDS, validateAccountInput, verifyCarrierAccount, fetchNegotiatedRates, connectCarrierAccount } from '../../api/carriers.js'
import { errorMessage, fieldError } from './storeUtils.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  carrier: { type: String, default: null },
  available: { type: Array, default: () => OWN_ACCOUNT_CARRIERS },
})
const emit = defineEmits(['update:open', 'connected'])
const { t, fmt } = useI18n()
const router = useRouter()

const step = ref(0)
const maxReached = ref(0)
const code = ref(null)
const form = ref({})
const errs = ref({})
const showSecret = ref(false)
const verifying = ref(false)
const verifyError = ref('')
const verification = ref(null)
const ratesMode = ref('fetched')
const fetching = ref(false)
const fetched = ref(null)
const manualPct = ref('')
const manualErr = ref('')
const mode = ref('cheapest')
const connecting = ref(false)
const account = ref(null)
const fieldsRoot = ref(null)

const carrierName = c => db.get('carriers', c)?.name ?? c
const fields = computed(() => ACCOUNT_FIELDS[code.value] ?? [])
const steps = computed(() => [
  { key: 'carrier', label: t('integrations.wizard.steps.carrier') },
  { key: 'details', label: t('integrations.wizard.steps.details') },
  { key: 'verify', label: t('integrations.wizard.steps.verify'), error: !!verifyError.value && step.value === 2 },
  { key: 'rates', label: t('integrations.wizard.steps.rates') },
  { key: 'done', label: t('integrations.wizard.steps.done') },
])
const busy = computed(() => verifying.value || fetching.value || connecting.value)
const discount = computed(() => (ratesMode.value === 'fetched' ? fetched.value?.discountPct ?? null : manualValue()))

function manualValue() {
  const n = Number(String(manualPct.value).replace(',', '.'))
  return String(manualPct.value).trim() !== '' && Number.isFinite(n) ? n / 100 : null
}

function blankForm(c) {
  const f = {}
  for (const x of ACCOUNT_FIELDS[c] ?? []) f[x.id] = x.kind === 'country' ? 'US' : ''
  return f
}

function reset() {
  code.value = props.carrier && props.available.includes(props.carrier) ? props.carrier : null
  step.value = code.value ? 1 : 0
  maxReached.value = step.value
  form.value = blankForm(code.value)
  errs.value = {}
  showSecret.value = false
  verifying.value = false
  verifyError.value = ''
  verification.value = null
  ratesMode.value = 'fetched'
  fetched.value = null
  manualPct.value = ''
  manualErr.value = ''
  mode.value = 'cheapest'
  connecting.value = false
  account.value = null
}
watch(() => props.open, v => { if (v) reset() })

function go(i) {
  step.value = i
  maxReached.value = Math.max(maxReached.value, i)
}
function canNavigate(target) {
  if (busy.value || step.value === 4) return false
  if (target >= 3 && !verification.value) return false
  return target <= maxReached.value && target !== 2
}
function navigate(i) {
  if (i <= 1) { verification.value = null; verifyError.value = ''; maxReached.value = i }
  step.value = i
}

function pickCarrier(c) {
  if (!props.available.includes(c)) return
  if (code.value !== c) { form.value = blankForm(c); errs.value = {} }
  code.value = c
  go(1)
}

function validateField(id) {
  const v = validateAccountInput(code.value, form.value)
  errs.value = { ...errs.value, [id]: v.errors[id] ? fieldError(v.errors[id]) : '' }
}
function hintFor(f) {
  const k = `integrations.wizard.hints.${f.id}${f.length ? 'Len' : ''}`
  return t(k, { n: f.length ?? f.min ?? '' })
}

async function toVerify() {
  const v = validateAccountInput(code.value, form.value)
  if (!v.valid) {
    const e = {}
    for (const [k, c] of Object.entries(v.errors)) e[k] = fieldError(c)
    errs.value = e
    await nextTick()
    const first = fields.value.find(f => e[f.id])
    fieldsRoot.value?.querySelector(`[data-field="${first?.id}"]`)?.focus()
    return
  }
  go(2)
  runVerify()
}

async function runVerify() {
  verifying.value = true
  verifyError.value = ''
  verification.value = null
  try {
    verification.value = await verifyCarrierAccount(code.value, { ...form.value })
  } catch (e) {
    verifyError.value = errorMessage(e)
    if (e.details) {
      const fe = {}
      for (const [k, c] of Object.entries(e.details)) fe[k] = fieldError(c)
      errs.value = { ...errs.value, ...fe }
    }
  } finally {
    verifying.value = false
  }
}

async function fetchRates() {
  fetching.value = true
  try {
    fetched.value = await fetchNegotiatedRates(code.value, { ...form.value })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    fetching.value = false
  }
}

function validateManual() {
  const v = manualValue()
  if (String(manualPct.value).trim() === '') manualErr.value = t('common.validation.required')
  else if (v == null) manualErr.value = t('common.validation.number')
  else if (v < 0 || v > 0.6) manualErr.value = t('integrations.wizard.manualRange')
  else manualErr.value = ''
  return !manualErr.value
}

async function finish() {
  if (ratesMode.value === 'manual' && !validateManual()) return
  if (ratesMode.value === 'fetched' && !fetched.value) { toast.warning(t('integrations.wizard.fetchFirst')); return }
  connecting.value = true
  try {
    account.value = await connectCarrierAccount(code.value, {
      input: { ...form.value }, verificationToken: verification.value.verificationToken,
      discountPct: discount.value, ratesSource: ratesMode.value, mode: mode.value,
    })
    go(4)
    toast.success(t('integrations.wizard.connectedToast', { carrier: carrierName(code.value), masked: account.value.accountMasked }))
    emit('connected', account.value)
  } catch (e) {
    toast.error(errorMessage(e))
    if (e.code === 'NOT_VERIFIED') { verification.value = null; go(2); runVerify() }
  } finally {
    connecting.value = false
  }
}

const samples = computed(() => {
  if (!fetched.value?.samples?.length) return []
  const d = discount.value ?? fetched.value.discountPct
  const ratio = fetched.value.discountPct ? (1 - d) / (1 - fetched.value.discountPct) : 1
  return fetched.value.samples.map(s => {
    const own = ratesMode.value === 'manual' ? Math.round((s.own - 0.05) * ratio * 100) / 100 + 0.05 : s.own
    return { ...s, own, save: Math.max(0, s.platform - own) }
  })
})

function close() {
  if (busy.value) return
  emit('update:open', false)
}
function newShipment() {
  emit('update:open', false)
  router.push('/shipments/new')
}
const ratesOptions = computed(() => [{ value: 'fetched', label: t('integrations.wizard.fetchAuto') }, { value: 'manual', label: t('integrations.wizard.manual') }])
</script>

<template>
  <Modal :open="open" :title="t('integrations.wizard.title')" :subtitle="code ? carrierName(code) : t('integrations.wizard.subtitle')" size="lg" :closable="!busy" @update:open="v => !v && close()">
    <Stepper :steps="steps" :current="step" :max-reached="maxReached" :can-navigate="canNavigate" class="stepper" @navigate="navigate" />

    <!-- 1. Carrier -->
    <section v-if="step === 0" class="phase">
      <p class="lead">{{ t('integrations.wizard.pickCarrier') }}</p>
      <div class="carrier-grid">
        <button v-for="c in OWN_ACCOUNT_CARRIERS" :key="c" type="button" class="carrier-tile" :class="{ selected: code === c }" :disabled="!available.includes(c)" @click="pickCarrier(c)">
          <CarrierLogo :code="c" :size="36" />
          <span class="ct-name">{{ carrierName(c) }}</span>
          <span class="ct-sub">{{ available.includes(c) ? t('integrations.accounts.method.' + c) : t('integrations.wizard.alreadyConnected') }}</span>
        </button>
      </div>
    </section>

    <!-- 2. Account details -->
    <section v-else-if="step === 1" ref="fieldsRoot" class="phase">
      <div class="callout neutral"><Icon name="shield" :size="15" /><div>{{ t('integrations.wizard.detailsIntro.' + code) }}</div></div>
      <div class="form-grid">
        <FormField v-for="f in fields" :key="f.id" :label="t('core.carrierAccounts.fields.' + f.id)" :hint="hintFor(f)" :error="errs[f.id]" :value="form[f.id]" required :class="{ full: f.kind === 'secret' || fields.length === 1 }" v-slot="{ id, invalid, describedBy }">
          <select v-if="f.kind === 'country'" :id="id" v-model="form[f.id]" class="select" :data-field="f.id" :aria-invalid="invalid" @blur="validateField(f.id)">
            <option value="US">{{ t('integrations.wizard.countries.US') }}</option>
            <option value="CA">{{ t('integrations.wizard.countries.CA') }}</option>
            <option value="MX">{{ t('integrations.wizard.countries.MX') }}</option>
            <option value="GB">{{ t('integrations.wizard.countries.GB') }}</option>
          </select>
          <div v-else-if="f.kind === 'money'" class="affix">
            <span class="pre">$</span>
            <input :id="id" v-model="form[f.id]" class="input" :class="{ invalid }" :data-field="f.id" inputmode="decimal" placeholder="248.30" :aria-invalid="invalid" :aria-describedby="describedBy" @blur="validateField(f.id)" />
          </div>
          <div v-else-if="f.kind === 'secret'" class="affix">
            <input :id="id" v-model="form[f.id]" :type="showSecret ? 'text' : 'password'" class="input mono" :class="{ invalid }" :data-field="f.id" autocomplete="off" :aria-invalid="invalid" :aria-describedby="describedBy" @blur="validateField(f.id)" />
            <button type="button" class="post btn-icon" :aria-label="showSecret ? t('integrations.wizard.hide') : t('integrations.wizard.show')" @click="showSecret = !showSecret"><Icon :name="showSecret ? 'eye-off' : 'eye'" :size="14" /></button>
          </div>
          <input v-else :id="id" v-model="form[f.id]" class="input mono" :class="{ invalid }" :data-field="f.id" :inputmode="f.kind === 'digits' || f.kind === 'zip' ? 'numeric' : 'text'" :maxlength="f.length || (f.kind === 'zip' ? 10 : 40)" autocomplete="off" spellcheck="false" :placeholder="t('integrations.wizard.placeholders.' + code + '_' + f.id)" :aria-invalid="invalid" :aria-describedby="describedBy" @blur="validateField(f.id)" @keydown.enter.prevent="toVerify" />
        </FormField>
      </div>
      <p class="demo-hint"><Icon name="info" :size="12" /> {{ t('integrations.wizard.demoHint') }}</p>
    </section>

    <!-- 3. Verification -->
    <section v-else-if="step === 2" class="phase center">
      <template v-if="verifying">
        <div class="big-icon accent"><Spinner :size="22" /></div>
        <div class="phase-title">{{ t('integrations.wizard.verifying', { carrier: carrierName(code) }) }}</div>
        <p class="phase-desc">{{ t('integrations.wizard.verifyingDesc.' + code) }}</p>
      </template>
      <template v-else-if="verification">
        <div class="big-icon success"><Icon name="check-circle" :size="24" /></div>
        <div class="phase-title">{{ t('integrations.wizard.verified') }}</div>
        <p class="phase-desc">{{ t('integrations.wizard.verifiedDesc', { carrier: carrierName(code), masked: verification.accountMasked }) }}</p>
      </template>
      <template v-else-if="verifyError">
        <div class="big-icon danger"><Icon name="x-circle" :size="24" /></div>
        <div class="phase-title">{{ verifyError }}</div>
        <p class="phase-desc">{{ t('integrations.wizard.verifyFailedDesc', { carrier: carrierName(code) }) }}</p>
      </template>
    </section>

    <!-- 4. Negotiated rates -->
    <section v-else-if="step === 3" class="phase">
      <SegmentedControl v-model="ratesMode" :options="ratesOptions" block />
      <div v-if="ratesMode === 'fetched'" class="rates-box">
        <template v-if="!fetched">
          <p class="lead">{{ t('integrations.wizard.fetchDesc', { carrier: carrierName(code) }) }}</p>
          <button class="btn btn-accent btn-sm" :disabled="fetching" @click="fetchRates"><Spinner v-if="fetching" :size="13" /><Icon v-else name="download" :size="14" /> {{ fetching ? t('integrations.wizard.fetching') : t('integrations.wizard.fetchBtn') }}</button>
        </template>
        <template v-else>
          <div class="disc-row">
            <div><div class="disc-label">{{ t('integrations.wizard.discountFound') }}</div><div class="disc-value">{{ fmt.percent(fetched.discountPct, 0) }}</div></div>
            <button class="btn btn-ghost btn-xs" :disabled="fetching" @click="fetchRates"><Icon name="refresh" :size="12" /> {{ t('integrations.wizard.refetch') }}</button>
          </div>
        </template>
      </div>
      <div v-else class="rates-box">
        <FormField :label="t('integrations.wizard.manualLabel')" :hint="t('integrations.wizard.manualHint')" :error="manualErr" :value="manualPct" required v-slot="{ id, invalid, describedBy }">
          <div class="affix narrow">
            <input :id="id" v-model="manualPct" class="input" :class="{ invalid }" inputmode="decimal" placeholder="18" :aria-invalid="invalid" :aria-describedby="describedBy" @blur="validateManual" />
            <span class="post-text">%</span>
          </div>
        </FormField>
      </div>

      <div v-if="samples.length" class="table-wrap">
        <table class="table-simple">
          <thead><tr><th>{{ t('integrations.wizard.service') }}</th><th class="r">{{ t('integrations.wizard.platformPrice') }}</th><th class="r">{{ t('integrations.wizard.ownPrice') }}</th><th class="r">{{ t('integrations.wizard.saving') }}</th></tr></thead>
          <tbody>
            <tr v-for="s in samples" :key="s.service"><td>{{ s.serviceName }}</td><td class="r num">{{ fmt.money(s.platform) }}</td><td class="r num strong">{{ fmt.money(s.own) }}</td><td class="r num text-success">{{ fmt.money(s.save) }}</td></tr>
          </tbody>
        </table>
        <div class="sample-note">{{ t('integrations.wizard.sampleNote') }}</div>
      </div>

      <div class="mode-box">
        <div class="mode-title">{{ t('integrations.wizard.modeTitle') }}</div>
        <label class="radio"><input v-model="mode" type="radio" value="cheapest" /> <span><b>{{ t('core.carrierAccounts.modes.cheapest') }}</b> · {{ t('integrations.accounts.modeDesc.cheapest') }}</span></label>
        <label class="radio"><input v-model="mode" type="radio" value="always" /> <span><b>{{ t('core.carrierAccounts.modes.always') }}</b> · {{ t('integrations.accounts.modeDesc.always') }}</span></label>
      </div>
    </section>

    <!-- 5. Done -->
    <section v-else-if="step === 4" class="phase center">
      <div class="big-icon success"><Icon name="check-circle" :size="24" /></div>
      <div class="phase-title">{{ t('integrations.wizard.doneTitle', { carrier: carrierName(code) }) }}</div>
      <p class="phase-desc">{{ t('integrations.wizard.doneDesc', { carrier: carrierName(code) }) }}</p>
      <div class="done-kv">
        <span>{{ t('integrations.accounts.accountNo', { masked: account?.accountMasked }) }}</span>
        <span>{{ t('integrations.accounts.discount') }}: <b>{{ fmt.percent(account?.negotiatedDiscountPct ?? 0, 0) }}</b></span>
        <span>{{ t('core.carrierAccounts.modes.' + (account?.mode ?? 'cheapest')) }}</span>
      </div>
    </section>

    <template #footer>
      <template v-if="step === 0">
        <button class="btn btn-ghost btn-sm" @click="close">{{ t('common.cancel') }}</button>
      </template>
      <template v-else-if="step === 1">
        <button class="btn btn-ghost btn-sm" @click="navigate(0)">{{ t('common.back') }}</button>
        <button class="btn btn-primary btn-sm" @click="toVerify">{{ t('integrations.wizard.verifyBtn') }}</button>
      </template>
      <template v-else-if="step === 2">
        <button class="btn btn-ghost btn-sm" :disabled="verifying" @click="navigate(1)">{{ t('integrations.wizard.editDetails') }}</button>
        <button v-if="verifyError" class="btn btn-ghost btn-sm" @click="runVerify"><Icon name="refresh" :size="14" /> {{ t('common.retry') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="!verification" @click="go(3)">{{ t('common.next') }}</button>
      </template>
      <template v-else-if="step === 3">
        <button class="btn btn-ghost btn-sm" :disabled="connecting" @click="navigate(1)">{{ t('common.back') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="connecting || (ratesMode === 'fetched' && !fetched)" @click="finish"><Spinner v-if="connecting" :size="13" /> {{ t('integrations.wizard.connectBtn') }}</button>
      </template>
      <template v-else>
        <button class="btn btn-ghost btn-sm" @click="newShipment"><Icon name="plus" :size="14" /> {{ t('integrations.wizard.newShipment') }}</button>
        <button class="btn btn-primary btn-sm" @click="close">{{ t('common.finish') }}</button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.stepper { margin-bottom: 18px; }
.phase { display: flex; flex-direction: column; gap: 14px; }
.phase.center { align-items: center; text-align: center; padding: 14px 0 8px; min-height: 180px; justify-content: center; }
.lead { margin: 0; color: var(--ink-2); line-height: 1.55; }
.carrier-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.carrier-tile { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; align-items: center; text-align: left; padding: 14px; border: 1px solid var(--line-2); border-radius: 12px; background: var(--surface); cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.carrier-tile > :first-child { grid-row: span 2; }
.carrier-tile:hover:not(:disabled) { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.carrier-tile.selected { border-color: var(--accent); }
.carrier-tile:disabled { opacity: .55; cursor: not-allowed; background: var(--bg-2); }
.ct-name { font-weight: 600; }
.ct-sub { color: var(--ink-3); font-size: 12px; }
.affix { position: relative; display: flex; align-items: center; }
.affix .pre { position: absolute; left: 12px; color: var(--ink-3); font-size: 14px; }
.affix .pre + .input { padding-left: 26px; }
.affix .post { position: absolute; right: 4px; }
.affix .post-text { margin-left: 8px; color: var(--ink-3); }
.affix.narrow { max-width: 160px; }
.mono { font-family: var(--font-mono); font-size: 13px; }
.demo-hint { margin: 0; font-size: 12px; color: var(--ink-3); display: flex; gap: 6px; align-items: center; }
.big-icon { width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; }
.big-icon.accent { background: var(--accent-soft); color: var(--accent-ink); }
.big-icon.success { background: oklch(0.95 0.05 155); color: oklch(0.45 0.12 155); }
.big-icon.danger { background: oklch(0.95 0.04 25); color: var(--danger); }
.phase-title { font-family: var(--font-display); font-weight: 600; font-size: 18px; }
.phase-desc { color: var(--ink-2); margin: 0; max-width: 480px; line-height: 1.55; }
.rates-box { border: 1px solid var(--line-1); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.disc-row { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.disc-label { color: var(--ink-3); font-size: 12.5px; }
.disc-value { font-family: var(--font-display); font-size: 26px; font-weight: 600; color: var(--success); }
.r { text-align: right !important; }
.strong { font-weight: 600; }
.sample-note { font-size: 12px; color: var(--ink-3); margin-top: 6px; }
.mode-box { display: flex; flex-direction: column; gap: 8px; }
.mode-title { font-weight: 600; font-size: 13.5px; }
.radio { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; cursor: pointer; line-height: 1.45; }
.radio input { margin-top: 3px; accent-color: var(--accent); }
.done-kv { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 13px; color: var(--ink-2); padding: 10px 14px; background: var(--bg-2); border-radius: 10px; }
@media (max-width: 560px) { .carrier-grid { grid-template-columns: 1fr; } }
</style>
