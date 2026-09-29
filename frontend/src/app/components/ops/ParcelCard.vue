<script setup>
// Parcel intake card (spec 5.9): declared vs measured, scale reading, checks, accept.
//   <ParcelCard :parcel="lookupResult" @accepted="res => ..." @next="scanNext" />
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Spinner from '../Spinner.vue'
import CarrierLogo from '../CarrierLogo.vue'
import CopyButton from '../CopyButton.vue'
import DateTime from '../DateTime.vue'
import ScaleDrawing from '../billing/ScaleDrawing.vue'
import DiffCard from './DiffCard.vue'
import { readScale, previewAdjustment, acceptParcel, OPS_CHECKS } from '../../api/ops.js'
import { errorText } from '../billing/apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../toast.js'
import { db } from '../../store/db.js'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({ parcel: { type: Object, required: true } })
const emit = defineEmits(['accepted', 'next', 'close'])

const s = computed(() => props.parcel.shipment)
const declared = computed(() => props.parcel.declared)
const measured = ref({ weightLb: '', lengthIn: '', widthIn: '', heightIn: '' })
const reading = ref(false)
const readDone = ref(false)
const checks = ref(Object.fromEntries(OPS_CHECKS.map(k => [k, false])))
const accepting = ref(false)
const result = ref(null)
const fieldErr = ref({})
const allowed = computed(() => can('ops.manage'))

watch(() => props.parcel?.shipment?.id, () => {
  measured.value = { weightLb: '', lengthIn: String(declared.value.lengthIn ?? ''), widthIn: String(declared.value.widthIn ?? ''), heightIn: String(declared.value.heightIn ?? '') }
  readDone.value = false
  result.value = null
  fieldErr.value = {}
  checks.value = Object.fromEntries(OPS_CHECKS.map(k => [k, false]))
}, { immediate: true })

const service = computed(() => db.get('carriers', s.value.carrier)?.services?.find(x => x.code === s.value.service)?.name ?? s.value.service)

async function read() {
  reading.value = true
  try {
    const r = await readScale(s.value.id)
    measured.value = { weightLb: String(r.weightLb), lengthIn: String(r.lengthIn), widthIn: String(r.widthIn), heightIn: String(r.heightIn) }
    readDone.value = true
    fieldErr.value = {}
  } catch (e) { toast.error(errorText(e, ['ops.errors'])) } finally { reading.value = false }
}

const num = v => Number(String(v).replace(',', '.'))
const measuredNum = computed(() => ({ weightLb: num(measured.value.weightLb), lengthIn: num(measured.value.lengthIn), widthIn: num(measured.value.widthIn), heightIn: num(measured.value.heightIn) }))
const preview = computed(() => previewAdjustment(s.value.id, measuredNum.value))
const allChecked = computed(() => OPS_CHECKS.every(k => checks.value[k]))
function checkAll() { checks.value = Object.fromEntries(OPS_CHECKS.map(k => [k, true])) }

function validate() {
  const e = {}
  for (const k of ['weightLb', 'lengthIn', 'widthIn', 'heightIn']) if (!(measuredNum.value[k] > 0)) e[k] = t('ops.intake.fieldRequired')
  fieldErr.value = e
  const first = Object.keys(e)[0]
  if (first) document.getElementById('pc-' + first)?.focus()
  return !first
}

async function accept() {
  if (!validate()) return
  if (!allChecked.value) { toast.warning(t('ops.intake.checksNeeded')); return }
  accepting.value = true
  try {
    result.value = await acceptParcel(s.value.id, { measured: measuredNum.value, checks: { ...checks.value } })
    if (result.value.diff) toast.warning(t('ops.intake.acceptedDiff', { id: s.value.id, lb: result.value.diff.lb, amount: fmt.money(result.value.diff.amount) }))
    else toast.success(t('ops.intake.accepted', { id: s.value.id }))
    emit('accepted', result.value)
  } catch (e) {
    toast.error(errorText(e, ['ops.errors']))
  } finally { accepting.value = false }
}
const fmtDims = d => `${fmt.number(d.lengthIn, 0)} x ${fmt.number(d.widthIn, 0)} x ${fmt.number(d.heightIn, 0)} in`
</script>

<template>
  <article class="pc panel">
    <header class="pc-head">
      <CarrierLogo :code="s.carrier" :size="36" />
      <div class="pc-title">
        <div class="trk"><span class="mono">{{ s.trackingNo }}</span> <CopyButton :text="s.trackingNo" size="xs" /></div>
        <div class="sub">{{ s.id }} · {{ service }} · {{ t('ops.intake.createdAt') }} <DateTime :value="s.createdAt" /></div>
      </div>
      <button class="btn-icon" :aria-label="t('common.close')" @click="emit('close')"><Icon name="x" :size="14" /></button>
    </header>

    <div class="pc-body">
      <div class="left">
        <ScaleDrawing :measured="readDone || result || measured.weightLb ? measuredNum : { ...declared, weightLb: 0 }" :declared="declared" :hub="s.hub" :reading="reading" />
        <dl class="kv small">
          <dt>{{ t('ops.intake.recipient') }}</dt><dd>{{ s.to?.name }} · {{ s.to?.city }}, {{ s.to?.state }} {{ s.to?.zip }}</dd>
          <dt>{{ t('ops.intake.reference') }}</dt><dd>{{ s.reference || s.orderId || '-' }}</dd>
          <dt>{{ t('ops.intake.account') }}</dt><dd>{{ String(s.account).startsWith('own:') ? t('ops.intake.ownAccount') : t('ops.intake.platform') }}</dd>
        </dl>
      </div>

      <div class="right">
        <!-- already accepted -->
        <div v-if="parcel.alreadyReceived && !result" class="callout neutral"><Icon name="info" /> {{ t('ops.intake.alreadyReceived') }}</div>

        <template v-else-if="!result">
          <div class="measure">
            <div class="m-head">
              <div class="panel-title">{{ t('ops.intake.measure') }}</div>
              <button class="btn btn-soft btn-sm" :disabled="reading || accepting" @click="read"><Spinner v-if="reading" :size="12" /><Icon v-else name="scale" :size="14" /> {{ reading ? t('ops.intake.reading') : t('ops.intake.readScale') }}</button>
            </div>
            <table class="table-simple mt">
              <thead><tr><th></th><th>{{ t('ops.intake.declared') }}</th><th>{{ t('ops.intake.measured') }}</th></tr></thead>
              <tbody>
                <tr>
                  <td>{{ t('ops.intake.weight') }} (lb)</td>
                  <td class="num">{{ fmt.number(declared.weightLb, 1) }}</td>
                  <td><input id="pc-weightLb" v-model="measured.weightLb" class="input sm num" :class="{ invalid: fieldErr.weightLb }" inputmode="decimal" :aria-label="t('ops.intake.weight')" /></td>
                </tr>
                <tr>
                  <td>{{ t('ops.intake.dims') }} (in)</td>
                  <td class="num">{{ fmtDims(declared) }}</td>
                  <td class="dims">
                    <input id="pc-lengthIn" v-model="measured.lengthIn" class="input sm num" :class="{ invalid: fieldErr.lengthIn }" inputmode="decimal" aria-label="L" />
                    <input id="pc-widthIn" v-model="measured.widthIn" class="input sm num" :class="{ invalid: fieldErr.widthIn }" inputmode="decimal" aria-label="W" />
                    <input id="pc-heightIn" v-model="measured.heightIn" class="input sm num" :class="{ invalid: fieldErr.heightIn }" inputmode="decimal" aria-label="H" />
                  </td>
                </tr>
                <tr>
                  <td>{{ t('ops.intake.billable') }}</td>
                  <td class="num">{{ declared.billableLb }} lb</td>
                  <td class="num"><strong>{{ preview ? preview.measuredBillableLb + ' lb' : '-' }}</strong></td>
                </tr>
              </tbody>
            </table>
            <div v-if="Object.keys(fieldErr).length" class="field-error">{{ t('ops.intake.fieldRequired') }}</div>
            <p v-if="!readDone && !measured.weightLb" class="hint">{{ t('ops.intake.readHint') }}</p>
          </div>

          <DiffCard v-if="preview && preview.deltaLb > 0" :lb="preview.deltaLb" :amount="preview.delta" :wallet="preview.walletCharge" preview />
          <div v-else-if="preview" class="ok-line"><Icon name="check-circle" :size="14" /> {{ t('ops.intake.noDiff') }}</div>

          <fieldset class="checks">
            <legend>{{ t('ops.intake.checks') }} <button type="button" class="btn-link sm" @click="checkAll">{{ t('ops.intake.checkAll') }}</button></legend>
            <label v-for="k in OPS_CHECKS" :key="k" class="checkbox"><input v-model="checks[k]" type="checkbox" /> {{ t('ops.checks.' + k) }}</label>
          </fieldset>

          <div class="actions">
            <span v-if="!allowed" class="hint"><Icon name="lock" :size="12" /> {{ t('common.noPermission') }}</span>
            <button class="btn btn-accent" :disabled="accepting || !allowed" :title="!allChecked ? t('ops.intake.checksNeeded') : ''" @click="accept">
              <Spinner v-if="accepting" :size="14" /><Icon v-else name="package-check" :size="15" /> {{ t('ops.intake.accept') }}
            </button>
          </div>
        </template>

        <!-- accepted -->
        <div v-else class="done">
          <div class="done-head"><Icon name="check-circle" :size="20" /> {{ t('ops.intake.acceptedTitle') }}</div>
          <p class="sub">{{ t('ops.intake.acceptedDesc', { hub: s.hub }) }}</p>
          <DiffCard v-if="result.diff" :lb="result.diff.lb" :amount="result.diff.amount" :wallet="result.diff.walletCharge" :adjustment-id="result.adjustment?.id" :balance="result.balance" />
          <div v-else class="ok-line"><Icon name="check-circle" :size="14" /> {{ t('ops.intake.noDiff') }}</div>
          <div class="actions">
            <RouterLink :to="`/shipments/${s.id}`" class="btn btn-ghost btn-sm">{{ t('ops.intake.openShipment') }}</RouterLink>
            <button class="btn btn-primary" autofocus @click="emit('next')"><Icon name="scan" :size="14" /> {{ t('ops.intake.scanNext') }}</button>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.pc { overflow: hidden; }
.pc-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line-1); }
.pc-title { flex: 1; min-width: 0; }
.trk { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 600; }
.mono { font-family: var(--font-mono); }
.sub { font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
.pc-body { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 18px; padding: 18px; }
.left { display: flex; flex-direction: column; gap: 12px; }
.small { font-size: 12.5px; grid-template-columns: 100px 1fr; }
.right { display: flex; flex-direction: column; gap: 14px; }
.m-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mt { margin-top: 8px; }
.input.sm { height: 32px; width: 72px; padding: 0 8px; font-size: 13px; }
.dims { display: flex; gap: 4px; }
.dims .input.sm { width: 52px; }
.hint { font-size: 12px; color: var(--ink-3); margin: 6px 0 0; display: inline-flex; align-items: center; gap: 4px; }
.ok-line { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--success); }
.checks { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 10px 14px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.checks legend { font-size: 12.5px; font-weight: 600; color: var(--ink-2); padding: 0 4px; display: flex; gap: 8px; align-items: center; }
.btn-link.sm { font-size: 12px; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; }
.done-head { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--success); }
.done { display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 1100px) { .pc-body { grid-template-columns: 1fr; } }
</style>
