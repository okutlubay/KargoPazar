<script setup>
// New carrier wizard (spec 10.1 / 9.5): basics, credentials, services, zone table,
// coverage, connection test (4 scenarios) and activation. Emits `done(carrier)`.
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import Stepper from '../Stepper.vue'
import FormField from '../FormField.vue'
import SegmentedControl from '../SegmentedControl.vue'
import Spinner from '../Spinner.vue'
import FileDrop from '../FileDrop.vue'
import ProgressBar from '../ProgressBar.vue'
import CarrierLogo from '../CarrierLogo.vue'
import Toggle from '../Toggle.vue'
import { US_STATES } from '../AddressForm.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import {
  ADAPTER_TEMPLATES, sampleCarrierDefinition, copyServicesFrom, parseZoneCsv, validateCarrierDefinition,
  addCarrier, testCarrierConnection, activateCarrier,
} from '../../api/carriers.js'
import { errorText, fieldText, downloadText } from '../settings/util.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'done'])
const { t, tx, fmt } = useI18n()
const router = useRouter()

const ZONES = [2, 3, 4, 5, 6, 7, 8]
const LEVELS = ['economy', 'standard', 'express']
const STATES = US_STATES.map(s => (Array.isArray(s) ? s[0] : s))
const REGIONS = {
  northeast: ['NY', 'NJ', 'PA', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME', 'DE', 'MD', 'DC'],
  southeast: ['VA', 'NC', 'SC', 'GA', 'FL', 'AL', 'TN', 'KY', 'WV', 'MS'],
  midwest: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS'],
  south: ['TX', 'OK', 'LA', 'AR', 'NM'],
  west: ['CA', 'OR', 'WA', 'NV', 'AZ', 'UT', 'CO', 'ID', 'MT', 'WY', 'AK', 'HI'],
}

const step = ref(0)
const maxReached = ref(0)
const def = reactive(blank())
const errors = ref({})
const created = ref(null)
const testState = reactive({ running: false, pct: 0, done: -1, results: null, passed: null })
const activating = ref(false)
const activated = ref(false)
const saving = ref(false)
const zoneSource = ref('manual')
const zoneService = ref(0)
const copyFrom = ref('UPS')
const csvErrors = ref([])
const creds = reactive({ endpoint: '', environment: 'sandbox' })

function blankService(i = 0) {
  return { code: i ? `SVC${i + 1}` : 'GROUND', name: '', level: 'standard', resFee: 0, base: Object.fromEntries(ZONES.map(z => [z, ''])), perLb: Object.fromEntries(ZONES.map(z => [z, ''])), transitDays: Object.fromEntries(ZONES.map(z => [z, ''])) }
}
function blank() {
  return { name: '', code: '', type: 'regional', adapterTemplate: 'REST-JSON', color: '#334155', ink: '#FFFFFF', fuelPct: 0.12, poBoxAllowed: false, credentials: { apiKey: '', apiSecret: '' }, services: [blankService()], coverage: [], originHubs: ['NJ01'], allStates: false }
}

watch(() => props.open, v => { if (v && activated.value) reset() })
function reset() {
  Object.assign(def, blank())
  step.value = 0; maxReached.value = 0; errors.value = {}; created.value = null; activated.value = false
  Object.assign(testState, { running: false, pct: 0, done: -1, results: null, passed: null })
  zoneSource.value = 'manual'; zoneService.value = 0; csvErrors.value = []
  Object.assign(creds, { endpoint: '', environment: 'sandbox' })
}

const codeTouched = ref(false)
watch(() => def.name, n => {
  if (codeTouched.value || created.value) return
  def.code = String(n).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
})

function fillSample() {
  const s = sampleCarrierDefinition()
  Object.assign(def, {
    ...s, allStates: false,
    services: s.services.map(x => ({ ...x, base: { ...x.base }, perLb: { ...x.perLb }, transitDays: { ...x.transitDays } })),
    coverage: [...s.coverage], originHubs: [...s.originHubs], credentials: { ...s.credentials },
  })
  creds.endpoint = 'https://api.sandbox.veho.example/v2'
  creds.environment = 'sandbox'
  codeTouched.value = true
  errors.value = {}
  maxReached.value = Math.max(maxReached.value, 4)
  toast.info(t('admin.wizard.sampleFilled'))
}

const steps = computed(() => ['basics', 'credentials', 'services', 'zones', 'coverage', 'test'].map((k, i) => ({ key: k, label: t('admin.wizard.steps.' + k), error: stepHasError(i) })))
function stepOf(k) {
  if (['name', 'code', 'type', 'adapterTemplate'].includes(k)) return 0
  if (k.startsWith('credentials')) return 1
  if (k === 'services' || /^services\.\d+\.name$/.test(k)) return 2
  if (/^services\.\d+\.zones$/.test(k)) return 3
  if (k === 'coverage') return 4
  return 5
}
function stepHasError(i) { return Object.keys(errors.value).some(k => stepOf(k) === i) }

function payload() {
  const p = JSON.parse(JSON.stringify(def))
  p.code = String(p.code).trim().toUpperCase()
  p.coverage = p.type === 'regional' ? p.coverage : p.allStates || p.type !== 'domestic' ? [] : p.coverage
  if (p.type !== 'regional') delete p.originHubs
  p.services = p.services.map(s => ({ ...s, code: String(s.code).toUpperCase(), resFee: Number(s.resFee) || 0 }))
  delete p.allStates
  return p
}

function validateStep(i) {
  const all = validateCarrierDefinition(payload()).errors
  errors.value = Object.fromEntries(Object.entries(all).filter(([k]) => stepOf(k) <= i))
  return !Object.keys(errors.value).length
}

function next() {
  if (!validateStep(step.value)) {
    requestAnimationFrame(() => document.querySelector('.cw [aria-invalid="true"], .cw .field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return
  }
  step.value++
  maxReached.value = Math.max(maxReached.value, step.value)
}
function back() { if (step.value > 0) step.value-- }
const canNavigate = i => !created.value && i <= maxReached.value

// services
function addService() { def.services.push(blankService(def.services.length)); zoneService.value = def.services.length - 1 }
function removeService(i) { def.services.splice(i, 1); zoneService.value = Math.min(zoneService.value, def.services.length - 1) }

// zones
const activeSvc = computed(() => def.services[zoneService.value] ?? null)
function fillRow(field) {
  const s = activeSvc.value
  const first = s[field][2]
  if (first === '' || first == null) return
  const step = field === 'transitDays' ? 1 : field === 'base' ? 0.6 : 0.12
  ZONES.forEach((z, i) => { if (i > 0 && (s[field][z] === '' || s[field][z] == null)) s[field][z] = field === 'transitDays' ? Math.min(8, Number(first) + Math.floor(i / 2)) : Math.round((Number(first) + step * i) * 100) / 100 })
}
async function doCopy() {
  const src = copyServicesFrom(copyFrom.value)
  if (!src.length) return
  const has = def.services.some(s => s.name)
  if (has) {
    def.services = def.services.map((s, i) => { const c = src[i % src.length]; return { ...s, base: { ...c.base }, perLb: { ...c.perLb }, transitDays: { ...c.transitDays }, resFee: c.resFee ?? s.resFee } })
  } else {
    def.services = src.map(c => ({ code: c.code, name: `${def.name || t('admin.wizard.newCarrier')} ${c.name.split(' ').slice(1).join(' ') || c.code}`.trim(), level: c.level ?? 'standard', resFee: c.resFee ?? 0, base: { ...c.base }, perLb: { ...c.perLb }, transitDays: { ...c.transitDays } }))
  }
  errors.value = {}
  toast.success(t('admin.wizard.copied', { carrier: db.get('carriers', copyFrom.value)?.name ?? copyFrom.value, n: def.services.length }))
}
function onCsv(f) {
  const r = parseZoneCsv(f.text)
  csvErrors.value = r.errors
  if (r.services.length) {
    def.services = r.services.map(s => ({ ...s, base: { ...s.base }, perLb: { ...s.perLb }, transitDays: { ...s.transitDays } }))
    zoneService.value = 0
    errors.value = {}
    toast.success(t('admin.wizard.csvLoaded', { n: r.services.length }))
  }
}
function csvTemplate() {
  const rows = ['service_code,service_name,level,zone,base,per_lb,transit_days,res_fee']
  for (const [code, name, level, base, per, days] of [['GROUND', 'Ground', 'standard', 7.2, 0.45, 2], ['EXPRESS', 'Express', 'express', 12.4, 0.9, 1]]) {
    ZONES.forEach((z, i) => rows.push([code, name, level, z, Math.round((base + i * 0.55) * 100) / 100, Math.round((per + i * 0.08) * 100) / 100, Math.min(6, days + Math.floor(i / 2)), 0].join(',')))
  }
  downloadText('carrier-zone-table-template.csv', rows.join('\n'), 'text/csv')
}
const donorCarriers = computed(() => db.all('carriers').filter(c => c.type !== 'international' && c.status === 'active'))

// coverage
function toggleState(s) {
  const i = def.coverage.indexOf(s)
  if (i >= 0) def.coverage.splice(i, 1)
  else def.coverage.push(s)
}
function addRegion(r) { for (const s of REGIONS[r]) if (!def.coverage.includes(s)) def.coverage.push(s) }
function toggleHub(h) {
  const i = def.originHubs.indexOf(h)
  if (i >= 0) { if (def.originHubs.length > 1) def.originHubs.splice(i, 1) } else def.originHubs.push(h)
}

// save + test + activate
async function saveAndTest() {
  if (!validateStep(4)) { step.value = [0, 1, 2, 3, 4].find(i => stepHasError(i)) ?? 0; return }
  try {
    if (!created.value) {
      saving.value = true
      created.value = await addCarrier(payload())
      saving.value = false
    }
    Object.assign(testState, { running: true, pct: 0, done: -1, results: null, passed: null })
    const r = await testCarrierConnection(created.value.code, { onProgress: (pct, i) => { testState.pct = pct; testState.done = i } })
    Object.assign(testState, { running: false, results: r.results, passed: r.passed })
    if (r.passed) toast.success(t('admin.wizard.testPassed'))
    else toast.error(t('admin.wizard.testFailed'))
  } catch (e) {
    saving.value = false
    testState.running = false
    if (e?.details) { errors.value = e.details; const s = [0, 1, 2, 3, 4].find(i => stepHasError(i)); if (s != null) step.value = s }
    toast.error(errorText(e, 'admin'))
  }
}
async function activate() {
  activating.value = true
  try {
    const c = await activateCarrier(created.value.code)
    activated.value = true
    created.value = c
    toast.success(t('admin.wizard.activated', { name: c.name }))
    emit('done', c)
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { activating.value = false }
}

async function close() {
  if (created.value && !activated.value) {
    const ok = await confirm({ title: t('admin.wizard.leaveTitle'), message: t('admin.wizard.leaveDesc', { name: created.value.name }), confirmLabel: t('admin.wizard.leave') })
    if (!ok) return
    emit('done', created.value)
    reset()
  } else if (!created.value && (def.name || def.services.some(s => s.name))) {
    const ok = await confirm({ title: t('admin.wizard.discardTitle'), message: t('admin.wizard.discardDesc'), confirmLabel: t('admin.wizard.discard'), danger: true })
    if (!ok) return
    reset()
  } else if (activated.value) reset()
  emit('update:open', false)
}
function goDetail() { const code = created.value.code; reset(); emit('update:open', false); router.push({ name: 'admin-carrier-detail', params: { code } }) }
function goShip() { reset(); emit('update:open', false); router.push({ name: 'shipment-new' }) }

const scenarioIds = ['auth', 'rates', 'label', 'tracking']
function scenarioStatus(i) {
  if (testState.results) return testState.results[i]?.status
  if (testState.running) return i <= testState.done ? 'checked' : i === testState.done + 1 ? 'running' : 'pending'
  return 'pending'
}
const err = k => (errors.value[k] ? fieldText(errors.value[k], 'admin') : '')
const endpointPh = computed(() => ({ 'REST-JSON': 'https://api.carrier.com/v1', 'SOAP-XML': 'https://ws.carrier.com/Service.svc?wsdl', 'CSV-SFTP': 'sftp://files.carrier.com:22/inbound' }[def.adapterTemplate]))
</script>

<template>
  <Modal :open="open" :title="t('admin.wizard.title')" :subtitle="t('admin.wizard.subtitle')" size="xl" :closable="true" @update:open="v => !v && close()">
    <div class="cw">
      <div class="cw-top">
        <Stepper v-model:current="step" :steps="steps" :max-reached="maxReached" :can-navigate="canNavigate" :aria-label="t('admin.wizard.title')" />
        <button v-if="!created" class="btn btn-soft btn-sm sample" @click="fillSample"><Icon name="wand" :size="13" />{{ t('admin.wizard.fillSample') }}</button>
      </div>

      <!-- 0 basics -->
      <section v-if="step === 0" class="stack-lg">
        <div class="form-grid">
          <FormField :label="t('admin.wizard.name')" required :error="err('name')" :value="def.name" v-slot="{ id, invalid }">
            <input :id="id" v-model="def.name" class="input" placeholder="Veho" :aria-invalid="invalid || !!err('name')" />
          </FormField>
          <FormField :label="t('admin.wizard.code')" required :hint="t('admin.wizard.codeHint')" :error="err('code')" :value="def.code" v-slot="{ id, invalid }">
            <input :id="id" v-model="def.code" class="input mono" maxlength="6" :aria-invalid="invalid || !!err('code')" @input="codeTouched = true; def.code = def.code.toUpperCase()" />
          </FormField>
        </div>
        <div>
          <div class="lbl">{{ t('admin.wizard.type') }}</div>
          <SegmentedControl v-model="def.type" :options="['domestic', 'regional', 'international'].map(v => ({ value: v, label: t('admin.types.' + v) }))" :aria-label="t('admin.wizard.type')" />
        </div>
        <div>
          <div class="lbl">{{ t('admin.wizard.template') }}</div>
          <div class="tpls" role="radiogroup" :aria-label="t('admin.wizard.template')">
            <label v-for="tp in ADAPTER_TEMPLATES" :key="tp" :class="['tpl', { on: def.adapterTemplate === tp }]">
              <input v-model="def.adapterTemplate" type="radio" :value="tp" name="tpl" />
              <span class="tpl-name mono">{{ tp }}</span>
              <span class="tpl-desc">{{ t('admin.adapter.templates.' + tp) }}</span>
              <span class="tpl-ex">{{ t('admin.wizard.templateEx.' + tp) }}</span>
            </label>
          </div>
        </div>
        <div class="form-grid">
          <div>
            <div class="lbl">{{ t('admin.wizard.brand') }}</div>
            <div class="brand">
              <input v-model="def.color" type="color" class="color" :aria-label="t('admin.wizard.color')" />
              <CarrierLogo :code="def.code || 'NEW'" :name="def.name" :color="def.color" :ink="def.ink" show-name :sub="t('admin.types.' + def.type)" :size="32" />
            </div>
          </div>
          <FormField :label="t('admin.wizard.fuel')" :hint="t('admin.wizard.fuelHint')" :value="def.fuelPct" v-slot="{ id }">
            <div class="suffix"><input :id="id" v-model.number="def.fuelPct" type="number" step="0.005" min="0" max="0.4" class="input num" /><span>{{ fmt.percent(def.fuelPct || 0) }}</span></div>
          </FormField>
        </div>
      </section>

      <!-- 1 credentials -->
      <section v-else-if="step === 1" class="stack-lg">
        <div class="callout neutral"><Icon name="key" :size="14" />{{ t('admin.wizard.credsInfo', { tpl: def.adapterTemplate }) }}</div>
        <div class="form-grid">
          <FormField :label="t('admin.wizard.apiKey')" required :error="err('credentials.apiKey')" :value="def.credentials.apiKey" v-slot="{ id, invalid }">
            <input :id="id" v-model="def.credentials.apiKey" class="input mono" autocomplete="off" :aria-invalid="invalid || !!err('credentials.apiKey')" />
          </FormField>
          <FormField :label="t('admin.wizard.apiSecret')" optional :value="def.credentials.apiSecret" v-slot="{ id }">
            <input :id="id" v-model="def.credentials.apiSecret" type="password" class="input mono" autocomplete="new-password" />
          </FormField>
          <FormField class="full" :label="t('admin.wizard.endpoint.' + def.adapterTemplate)" optional :value="creds.endpoint" v-slot="{ id }">
            <input :id="id" v-model="creds.endpoint" class="input mono" :placeholder="endpointPh" />
          </FormField>
        </div>
        <div>
          <div class="lbl">{{ t('admin.wizard.environment') }}</div>
          <SegmentedControl v-model="creds.environment" :options="[{ value: 'sandbox', label: t('admin.wizard.sandbox') }, { value: 'production', label: t('admin.wizard.production') }]" :aria-label="t('admin.wizard.environment')" />
        </div>
        <p class="hint">{{ t('admin.wizard.credsStored') }}</p>
      </section>

      <!-- 2 services -->
      <section v-else-if="step === 2" class="stack">
        <div class="sec-head">
          <div class="hint">{{ t('admin.wizard.servicesHint') }}</div>
          <button class="btn btn-ghost btn-sm" @click="addService"><Icon name="plus" :size="12" />{{ t('admin.wizard.addService') }}</button>
        </div>
        <div v-if="errors.services" class="callout danger">{{ err('services') }}</div>
        <div class="table-wrap">
          <table class="table-simple svc">
            <thead><tr><th>{{ t('admin.wizard.svcCode') }}</th><th>{{ t('admin.wizard.svcName') }}</th><th>{{ t('admin.wizard.svcLevel') }}</th><th>{{ t('admin.wizard.svcRes') }}</th><th /></tr></thead>
            <tbody>
              <tr v-for="(s, i) in def.services" :key="i">
                <td><input v-model="s.code" class="input mono sm" maxlength="10" :aria-label="t('admin.wizard.svcCode')" @input="s.code = s.code.toUpperCase()" /></td>
                <td>
                  <input v-model="s.name" class="input sm" :placeholder="(def.name || 'Carrier') + ' Ground'" :aria-label="t('admin.wizard.svcName')" :aria-invalid="!!errors['services.' + i + '.name']" />
                  <div v-if="errors['services.' + i + '.name']" class="field-error">{{ err('services.' + i + '.name') }}</div>
                </td>
                <td>
                  <select v-model="s.level" class="select sm" :aria-label="t('admin.wizard.svcLevel')">
                    <option v-for="l in LEVELS" :key="l" :value="l">{{ t('admin.levels.' + l) }}</option>
                  </select>
                </td>
                <td><input v-model.number="s.resFee" type="number" step="0.05" min="0" class="input num sm" :aria-label="t('admin.wizard.svcRes')" /></td>
                <td><button class="btn-icon" :disabled="def.services.length === 1" :aria-label="t('admin.wizard.removeService')" @click="removeService(i)"><Icon name="trash" :size="14" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 3 zones -->
      <section v-else-if="step === 3" class="stack">
        <SegmentedControl v-model="zoneSource" :options="[{ value: 'manual', label: t('admin.wizard.zoneManual') }, { value: 'csv', label: t('admin.wizard.zoneCsv') }, { value: 'copy', label: t('admin.wizard.zoneCopy') }]" size="sm" :aria-label="t('admin.wizard.steps.zones')" />
        <div v-if="zoneSource === 'csv'" class="src-box">
          <FileDrop accept=".csv" :title="t('admin.wizard.csvDrop')" :hint="t('admin.wizard.csvHint')" compact @file="onCsv" />
          <button class="btn-link" @click="csvTemplate"><Icon name="download" :size="12" />{{ t('admin.wizard.csvTemplate') }}</button>
          <div v-if="csvErrors.length" class="callout warn">
            <div>
              <strong>{{ t('admin.wizard.csvErrors', { n: csvErrors.length }) }}</strong>
              <div v-for="(e, i) in csvErrors.slice(0, 5)" :key="i" class="small">{{ t('admin.wizard.csvError.' + e.code, { row: e.row, column: e.column, service: e.service, zone: e.zone }) }}</div>
            </div>
          </div>
        </div>
        <div v-else-if="zoneSource === 'copy'" class="src-box row">
          <select v-model="copyFrom" class="select" :aria-label="t('admin.wizard.copyFrom')">
            <option v-for="c in donorCarriers" :key="c.code" :value="c.code">{{ c.name }} ({{ c.services.length }})</option>
          </select>
          <button class="btn btn-ghost" @click="doCopy"><Icon name="copy" :size="13" />{{ t('admin.wizard.copyBtn') }}</button>
          <span class="hint">{{ t('admin.wizard.copyHint') }}</span>
        </div>
        <div class="svc-tabs" role="tablist">
          <button v-for="(s, i) in def.services" :key="i" role="tab" :aria-selected="zoneService === i" :class="['stab', { on: zoneService === i, bad: errors['services.' + i + '.zones'] }]" @click="zoneService = i">
            {{ s.name || s.code }}
          </button>
        </div>
        <div v-if="activeSvc" class="table-wrap">
          <table class="table-simple zones">
            <thead>
              <tr><th /><th v-for="z in ZONES" :key="z" class="c">{{ t('admin.zone', { z }) }}</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="f in ['base', 'perLb', 'transitDays']" :key="f">
                <th class="rowh">{{ t('admin.wizard.zoneRow.' + f) }}</th>
                <td v-for="z in ZONES" :key="z"><input v-model="activeSvc[f][z]" type="number" :step="f === 'transitDays' ? 1 : 0.01" min="0" class="input num zc" :aria-label="t('admin.wizard.zoneRow.' + f) + ' ' + t('admin.zone', { z })" /></td>
                <td><button class="btn-link small" :title="t('admin.wizard.autofill')" @click="fillRow(f)">{{ t('admin.wizard.autofillShort') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="errors['services.' + zoneService + '.zones']" class="field-error">{{ err('services.' + zoneService + '.zones') }}</div>
      </section>

      <!-- 4 coverage -->
      <section v-else-if="step === 4" class="stack-lg">
        <template v-if="def.type === 'international'">
          <div class="callout neutral"><Icon name="globe" :size="14" />{{ t('admin.wizard.intlCoverage') }}</div>
        </template>
        <template v-else>
          <Toggle v-if="def.type === 'domestic'" v-model="def.allStates" :label="t('admin.wizard.allStates')" :description="t('admin.wizard.allStatesDesc')" />
          <div v-if="def.type === 'regional' || !def.allStates">
            <div class="sec-head">
              <div class="lbl">{{ t('admin.wizard.statesSelected', { n: def.coverage.length }) }}</div>
              <div class="regions">
                <button v-for="(v, k) in REGIONS" :key="k" class="btn btn-ghost btn-xs" @click="addRegion(k)">+ {{ t('admin.regions.' + k) }}</button>
                <button class="btn btn-ghost btn-xs" :disabled="!def.coverage.length" @click="def.coverage = []">{{ t('admin.wizard.clearStates') }}</button>
              </div>
            </div>
            <div :class="['states', { bad: errors.coverage }]">
              <button v-for="s in STATES" :key="s" :class="['st', { on: def.coverage.includes(s) }]" :aria-pressed="def.coverage.includes(s)" @click="toggleState(s)">{{ s }}</button>
            </div>
            <div v-if="errors.coverage" class="field-error">{{ err('coverage') }}</div>
          </div>
          <div v-if="def.type === 'regional'">
            <div class="lbl">{{ t('admin.wizard.originHubs') }}</div>
            <div class="regions">
              <button v-for="h in ['NJ01', 'LA01']" :key="h" :class="['st wide', { on: def.originHubs.includes(h) }]" :aria-pressed="def.originHubs.includes(h)" @click="toggleHub(h)">{{ h }}</button>
            </div>
          </div>
        </template>
        <Toggle v-model="def.poBoxAllowed" :label="t('admin.wizard.poBox')" />
      </section>

      <!-- 5 test -->
      <section v-else class="stack-lg">
        <div class="summary">
          <CarrierLogo :code="def.code || 'NEW'" :name="def.name" :color="def.color" :ink="def.ink" show-name :sub="`${t('admin.types.' + def.type)} · ${def.adapterTemplate}`" :size="36" />
          <dl class="kv">
            <dt>{{ t('admin.wizard.steps.services') }}</dt><dd>{{ def.services.map(s => s.name || s.code).join(', ') }}</dd>
            <dt>{{ t('admin.wizard.steps.coverage') }}</dt><dd>{{ def.type === 'international' ? t('admin.wizard.intlShort') : def.coverage.length && !(def.type === 'domestic' && def.allStates) ? t('admin.wizard.statesN', { n: def.coverage.length }) : t('admin.wizard.allUs') }}<template v-if="def.type === 'regional'"> · {{ def.originHubs.join(', ') }}</template></dd>
            <dt>{{ t('admin.wizard.fuel') }}</dt><dd>{{ fmt.percent(def.fuelPct || 0) }}</dd>
          </dl>
        </div>

        <div class="tests">
          <div class="tests-head">
            <strong>{{ t('admin.wizard.testTitle') }}</strong>
            <span class="hint">{{ t('admin.wizard.testDesc') }}</span>
          </div>
          <ProgressBar v-if="testState.running" :value="testState.pct" size="sm" />
          <ul class="scen">
            <li v-for="(id, i) in scenarioIds" :key="id" :class="scenarioStatus(i)">
              <span class="sic">
                <Spinner v-if="scenarioStatus(i) === 'running'" :size="13" />
                <Icon v-else-if="scenarioStatus(i) === 'passed' || scenarioStatus(i) === 'checked'" name="check-circle" :size="15" />
                <Icon v-else-if="scenarioStatus(i) === 'failed'" name="x-circle" :size="15" />
                <span v-else class="dot" />
              </span>
              <span class="sname">{{ t('core.carrierTests.' + id) }}</span>
              <span class="sdet">{{ testState.results ? tx(testState.results[i]?.detail) : t('admin.wizard.scenario.' + id) }}</span>
              <span class="sms mono">{{ testState.results ? t('common.ms', { n: testState.results[i].ms }) : '' }}</span>
            </li>
          </ul>
          <div v-if="testState.passed === true" class="callout"><Icon name="check-circle" :size="14" />{{ t('admin.wizard.testPassedLong') }}</div>
          <div v-if="testState.passed === false" class="callout danger"><Icon name="alert" :size="14" />{{ t('admin.wizard.testFailedLong') }}</div>
        </div>

        <div v-if="activated" class="done">
          <Icon name="check-circle" :size="22" />
          <div>
            <strong>{{ t('admin.wizard.activatedTitle', { name: created.name }) }}</strong>
            <p>{{ t('admin.wizard.activatedDesc') }}</p>
            <div class="row gap">
              <button class="btn btn-primary btn-sm" @click="goShip"><Icon name="plus" :size="13" />{{ t('admin.wizard.tryShipment') }}</button>
              <button class="btn btn-ghost btn-sm" @click="goDetail">{{ t('admin.wizard.openDetail') }}</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <button v-if="step > 0 && !created" class="btn btn-ghost" @click="back"><Icon name="chevron-left" :size="13" />{{ t('common.back') }}</button>
      <span class="grow" />
      <button class="btn btn-ghost" @click="close">{{ activated ? t('common.close') : t('common.cancel') }}</button>
      <button v-if="step < 5" class="btn btn-primary" @click="next">{{ t('common.next') }}<Icon name="chevron-right" :size="13" /></button>
      <template v-else-if="!activated">
        <button class="btn btn-ghost" :disabled="testState.running || saving" @click="saveAndTest">
          <Spinner v-if="testState.running || saving" :size="14" /><Icon v-else name="flask" :size="13" />{{ created ? t('admin.wizard.retest') : t('admin.wizard.saveAndTest') }}
        </button>
        <button class="btn btn-primary" :disabled="!testState.passed || activating" :title="!testState.passed ? t('core.errors.CARRIER_NOT_TESTED') : undefined" @click="activate">
          <Spinner v-if="activating" :size="14" /><Icon v-else name="bolt" :size="13" />{{ t('admin.wizard.activate') }}
        </button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.cw { display: flex; flex-direction: column; gap: 20px; min-height: 420px; }
.cw-top { display: flex; align-items: center; gap: 16px; }
.cw-top > :first-child { flex: 1; min-width: 0; }
.sample { flex: none; }
.lbl { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--ink-2); }
.hint { color: var(--ink-3); font-size: 12.5px; }
.small { font-size: 12px; }
.tpls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.tpl { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 10px; cursor: pointer; }
.tpl input { position: absolute; opacity: 0; }
.tpl.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tpl:focus-within { box-shadow: 0 0 0 3px var(--accent-soft); }
.tpl-name { font-weight: 600; font-size: 13px; }
.tpl-desc { font-size: 12.5px; color: var(--ink-2); }
.tpl-ex { font-size: 11.5px; color: var(--ink-4); }
.brand { display: flex; align-items: center; gap: 14px; }
.color { width: 42px; height: 38px; padding: 2px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); }
.suffix { display: flex; align-items: center; gap: 10px; }
.suffix .input { max-width: 140px; }
.suffix span { color: var(--ink-3); font-size: 13px; }
.sec-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.svc td { vertical-align: top; }
.input.sm, .select.sm { height: 32px; font-size: 13px; }
.svc .input.num { max-width: 100px; }
.src-box { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px dashed var(--line-2); border-radius: 10px; }
.src-box.row { flex-direction: row; align-items: center; flex-wrap: wrap; }
.src-box.row .select { max-width: 240px; }
.svc-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.stab { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--surface); font-size: 13px; }
.stab.on { background: var(--ink-1); color: var(--bg); border-color: var(--ink-1); }
.stab.bad { border-color: var(--danger); }
.zones th.c { text-align: center; }
.zones .rowh { font-weight: 500; color: var(--ink-2); white-space: nowrap; font-size: 12.5px; }
.zc { width: 74px; height: 32px; font-size: 13px; padding: 0 6px; text-align: right; }
.regions { display: flex; gap: 6px; flex-wrap: wrap; }
.states { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 5px; margin-top: 8px; }
.states.bad { outline: 1px solid var(--danger); outline-offset: 4px; border-radius: 6px; }
.st { height: 30px; border-radius: 7px; border: 1px solid var(--line-2); background: var(--surface); font-family: var(--font-mono); font-size: 12px; }
.st.wide { padding: 0 16px; }
.st.on { background: var(--accent); color: white; border-color: var(--accent); }
.summary { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; padding: 14px; background: var(--bg-2); border-radius: 12px; }
.summary .kv { flex: 1; min-width: 260px; }
.tests { display: flex; flex-direction: column; gap: 10px; }
.tests-head { display: flex; flex-direction: column; gap: 2px; }
.scen { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line-1); border-radius: 10px; }
.scen li { display: grid; grid-template-columns: 22px 150px minmax(0, 1fr) 70px; gap: 10px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line-1); font-size: 13px; }
.scen li:first-child { border-top: 0; }
.scen li.passed .sic, .scen li.checked .sic { color: var(--success); }
.scen li.failed .sic { color: var(--danger); }
.scen li.running { background: var(--accent-soft); }
.sname { font-weight: 500; }
.sdet { color: var(--ink-3); font-size: 12.5px; }
.sms { text-align: right; color: var(--ink-3); font-size: 12px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; background: var(--line-2); margin-left: 3px; }
.done { display: flex; gap: 12px; padding: 16px; border-radius: 12px; background: oklch(0.96 0.04 155); color: oklch(0.38 0.1 155); }
.done p { margin: 4px 0 10px; color: var(--ink-2); font-size: 13px; }
.row { display: flex; align-items: center; }
.gap { gap: 8px; }
.grow { flex: 1; }
@media (max-width: 860px) { .tpls { grid-template-columns: 1fr; } .cw-top { flex-direction: column; align-items: stretch; } .scen li { grid-template-columns: 22px 1fr; } .sdet, .sms { grid-column: 2; } }
</style>
