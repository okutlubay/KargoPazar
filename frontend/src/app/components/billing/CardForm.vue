<script setup>
// New card form (spec 5.10): Luhn check, brand detection, expiry in the past rejected, CVC, holder, billing ZIP.
//   <CardForm ref="cf" v-model="card" :server-errors="errs" />   cf.value.validate() -> boolean
//   card = { number, exp: 'MM/YY', expMonth, expYear, cvc, holder, zip, save }
import { computed, ref, watch } from 'vue'
import CardBrand from './CardBrand.vue'
import { validateCard, cardBrand, TEST_CARDS } from '../../api/wallet.js'
import { fieldError } from './apiErrors.js'
import { t } from '../../i18n/index.js'
import { copyText } from '../CopyButton.vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  serverErrors: { type: Object, default: () => ({}) },
  showSave: { type: Boolean, default: true },
  showTestCards: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const touched = ref({})
const root = ref(null)
const c = computed(() => props.modelValue)
const brand = computed(() => cardBrand(c.value.number))

function set(k, v) { emit('update:modelValue', { ...props.modelValue, [k]: v }) }

function onNumber(e) {
  const d = e.target.value.replace(/\D/g, '').slice(0, 19)
  const groups = brand.value === 'amex' ? [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)] : d.match(/.{1,4}/g) ?? []
  const v = groups.filter(Boolean).join(' ')
  e.target.value = v
  set('number', v)
}
function onExp(e) {
  let d = e.target.value.replace(/\D/g, '').slice(0, 4)
  if (d.length === 1 && Number(d) > 1) d = '0' + d
  const v = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
  e.target.value = v
  const [m, y] = v.split('/')
  emit('update:modelValue', { ...props.modelValue, exp: v, expMonth: m ? Number(m) : null, expYear: y && y.length === 2 ? 2000 + Number(y) : null })
}
function onCvc(e) {
  const v = e.target.value.replace(/\D/g, '').slice(0, 4)
  e.target.value = v
  set('cvc', v)
}

const local = computed(() => validateCard({ number: c.value.number, expMonth: c.value.expMonth, expYear: c.value.expYear, cvc: c.value.cvc, holder: c.value.holder, zip: c.value.zip }).errors)
const err = computed(() => {
  const out = {}
  for (const k of ['number', 'exp', 'cvc', 'holder', 'zip']) {
    const code = props.serverErrors?.[k] || (touched.value[k] ? local.value[k] : null)
    out[k] = code ? fieldError(code) : ''
  }
  return out
})
watch(() => props.serverErrors, v => { for (const k of Object.keys(v ?? {})) touched.value[k] = true })

function blur(k) { touched.value = { ...touched.value, [k]: true } }

function validate() {
  touched.value = { number: true, exp: true, cvc: true, holder: true, zip: true }
  const first = ['number', 'exp', 'cvc', 'holder', 'zip'].find(k => local.value[k])
  if (first) {
    const el = root.value?.querySelector(`[data-field="${first}"]`)
    el?.focus()
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    return false
  }
  return true
}
function reset() { touched.value = {} }

async function useTest(kind) {
  const num = TEST_CARDS[kind].replace(/(\d{4})(?=\d)/g, '$1 ')
  const y = (new Date().getFullYear() + 3) % 100
  emit('update:modelValue', { ...props.modelValue, number: num, exp: `12/${y}`, expMonth: 12, expYear: 2000 + y, cvc: '123', holder: props.modelValue.holder || 'Anatolia Home & Craft', zip: props.modelValue.zip || '34415' })
  touched.value = {}
  await copyText(TEST_CARDS[kind])
}

defineExpose({ validate, reset, el: root })
</script>

<template>
  <div ref="root" class="card-form">
    <div class="f full">
      <label class="lbl" for="cf-number">{{ t('billing.card.number') }}</label>
      <div class="num-wrap">
        <input id="cf-number" data-field="number" class="input mono" :class="{ invalid: err.number }" inputmode="numeric" autocomplete="cc-number"
          :value="c.number" :disabled="disabled" placeholder="4242 4242 4242 4242" :aria-invalid="!!err.number" aria-describedby="cf-number-e"
          @input="onNumber" @blur="blur('number')" />
        <CardBrand class="brand" :brand="brand" size="sm" />
      </div>
      <div v-if="err.number" id="cf-number-e" class="field-error">{{ err.number }}</div>
    </div>
    <div class="row3">
      <div class="f">
        <label class="lbl" for="cf-exp">{{ t('billing.card.exp') }}</label>
        <input id="cf-exp" data-field="exp" class="input mono" :class="{ invalid: err.exp }" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY"
          :value="c.exp" :disabled="disabled" :aria-invalid="!!err.exp" @input="onExp" @blur="blur('exp')" />
        <div v-if="err.exp" class="field-error">{{ err.exp }}</div>
      </div>
      <div class="f">
        <label class="lbl" for="cf-cvc">CVC</label>
        <input id="cf-cvc" data-field="cvc" class="input mono" :class="{ invalid: err.cvc }" inputmode="numeric" autocomplete="cc-csc" :placeholder="brand === 'amex' ? '1234' : '123'"
          :value="c.cvc" :disabled="disabled" :aria-invalid="!!err.cvc" @input="onCvc" @blur="blur('cvc')" />
        <div v-if="err.cvc" class="field-error">{{ err.cvc }}</div>
      </div>
      <div class="f">
        <label class="lbl" for="cf-zip">{{ t('billing.card.zip') }}</label>
        <input id="cf-zip" data-field="zip" class="input" :class="{ invalid: err.zip }" autocomplete="postal-code" placeholder="34415"
          :value="c.zip" :disabled="disabled" :aria-invalid="!!err.zip" @input="set('zip', $event.target.value)" @blur="blur('zip')" />
        <div v-if="err.zip" class="field-error">{{ err.zip }}</div>
      </div>
    </div>
    <div class="f full">
      <label class="lbl" for="cf-holder">{{ t('billing.card.holder') }}</label>
      <input id="cf-holder" data-field="holder" class="input" :class="{ invalid: err.holder }" autocomplete="cc-name"
        :value="c.holder" :disabled="disabled" :aria-invalid="!!err.holder" @input="set('holder', $event.target.value)" @blur="blur('holder')" />
      <div v-if="err.holder" class="field-error">{{ err.holder }}</div>
    </div>
    <label v-if="showSave" class="checkbox">
      <input type="checkbox" :checked="c.save !== false" :disabled="disabled" @change="set('save', $event.target.checked)" />
      {{ t('billing.card.save') }}
    </label>
    <div v-if="showTestCards" class="tests">
      <div class="tests-title">{{ t('billing.card.testTitle') }}</div>
      <button type="button" class="test" :disabled="disabled" @click="useTest('success')">
        <span class="mono">4242 4242 4242 4242</span><span class="tag tag-success">{{ t('billing.card.testSuccess') }}</span>
      </button>
      <button type="button" class="test" :disabled="disabled" @click="useTest('declined')">
        <span class="mono">4000 0000 0000 0002</span><span class="tag tag-danger">{{ t('billing.card.testDeclined') }}</span>
      </button>
      <div class="tests-hint">{{ t('billing.card.testHint') }}</div>
    </div>
  </div>
</template>

<style scoped>
.card-form { display: flex; flex-direction: column; gap: 12px; }
.lbl { display: block; font-size: 12.5px; font-weight: 500; color: var(--ink-2); margin-bottom: 5px; }
.row3 { display: grid; grid-template-columns: 1fr 0.8fr 1fr; gap: 10px; }
.num-wrap { position: relative; }
.num-wrap .input { width: 100%; padding-right: 48px; }
.brand { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); }
.input { width: 100%; }
.mono { font-family: var(--font-mono); letter-spacing: .02em; }
.tests { background: var(--bg-2); border: 1px dashed var(--line-2); border-radius: var(--r-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.tests-title { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.test { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--surface); border: 1px solid var(--line-1); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; cursor: pointer; text-align: left; }
.test:hover { border-color: var(--line-strong); }
.tests-hint { font-size: 11.5px; color: var(--ink-3); }
@media (max-width: 520px) { .row3 { grid-template-columns: 1fr 1fr; } .row3 .f:last-child { grid-column: 1 / -1; } }
</style>
