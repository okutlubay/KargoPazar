<script setup>
import { ref, reactive, computed, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import FormField from '../../components/FormField.vue'
import Modal from '../../components/Modal.vue'
import { validateAll, required, email as emailRule, minLength } from '../../components/validation.js'
import { toast } from '../../components/toast.js'
import { t } from '../../i18n/index.js'
import { signupStart, signupVerify, signupResend, passwordChecks } from './signupApi.js'

const router = useRouter()
const stage = ref('form') // form | verify
const form = reactive({ name: '', email: '', company: '', password: '', terms: false })
const showPw = ref(false)
const termsOpen = ref(false)
const loading = ref(false)
const serverErrors = reactive({})
const termsError = ref('')
const signupId = ref(null)

const nameF = ref(null)
const emailF = ref(null)
const companyF = ref(null)
const pwF = ref(null)

const checks = computed(() => passwordChecks(form.password))
const strength = computed(() => Object.values(checks.value).filter(Boolean).length)
const strengthLabel = computed(() => ['', t('signup.strength.weak'), t('signup.strength.weak'), t('signup.strength.fair'), t('signup.strength.strong')][strength.value])
const strongRule = v => (!v || Object.values(passwordChecks(v)).every(Boolean) ? true : t('signup.errors.weak'))

function clearServer(k) { delete serverErrors[k] }

async function submit() {
  termsError.value = form.terms ? '' : t('signup.errors.terms')
  const ok = validateAll([nameF.value, emailF.value, companyF.value, pwF.value])
  if (!ok || !form.terms) return
  loading.value = true
  try {
    const r = await signupStart({ ...form })
    signupId.value = r.signupId
    stage.value = 'verify'
    startCooldown()
    await nextTick()
    codeInput.value?.focus()
  } catch (e) {
    if (e.code === 'VALIDATION' && e.details) {
      for (const [k, v] of Object.entries(e.details)) serverErrors[k] = t('signup.errors.' + v)
    } else if (e.code === 'EMAIL_TAKEN') {
      serverErrors.email = t('signup.errors.taken')
    } else toast.error(t('common.errorGeneric'))
  } finally {
    loading.value = false
  }
}

function acceptTerms() {
  form.terms = true
  termsError.value = ''
  termsOpen.value = false
}

// ---- verification
const code = ref('')
const codeInput = ref(null)
const codeError = ref('')
const verifying = ref(false)
const cooldown = ref(0)
let cdTimer = null

function startCooldown() {
  cooldown.value = 30
  clearInterval(cdTimer)
  cdTimer = setInterval(() => { cooldown.value -= 1; if (cooldown.value <= 0) clearInterval(cdTimer) }, 1000)
}
onBeforeUnmount(() => clearInterval(cdTimer))

const digits = computed(() => {
  const d = code.value.replace(/\D/g, '').slice(0, 6)
  return Array.from({ length: 6 }, (_, i) => d[i] ?? '')
})
function onCode(e) {
  code.value = e.target.value.replace(/\D/g, '').slice(0, 6)
  codeError.value = ''
  if (code.value.length === 6) verify()
}
function fillCode() { code.value = '246810'; codeError.value = ''; verify() }

async function verify() {
  if (verifying.value) return
  if (code.value.length !== 6) { codeError.value = t('signup.verify.incomplete'); return }
  verifying.value = true
  try {
    await signupVerify(signupId.value, code.value)
    toast.success(t('signup.verify.success'))
    router.replace({ name: 'onboarding' })
  } catch (e) {
    codeError.value = e.code === 'INVALID_CODE' ? t('signup.verify.invalid') : t('common.errorGeneric')
    code.value = ''
    codeInput.value?.focus()
  } finally {
    verifying.value = false
  }
}

async function resend() {
  if (cooldown.value > 0) return
  try {
    await signupResend(signupId.value)
    toast.info(t('signup.verify.resent', { email: form.email }))
    startCooldown()
  } catch { toast.error(t('common.errorGeneric')) }
}

function backToForm() { stage.value = 'form'; code.value = ''; codeError.value = '' }
</script>

<template>
  <div class="signup">
    <template v-if="stage === 'form'">
      <h1 class="title">{{ t('signup.title') }}</h1>
      <p class="sub">{{ t('signup.sub') }}</p>

      <form class="form" novalidate @submit.prevent="submit">
        <FormField ref="nameF" :label="t('signup.fields.name')" required :rules="[minLength(3)]" :value="form.name" :error="serverErrors.name" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.name" class="input" autocomplete="name" :aria-invalid="invalid" :aria-describedby="describedBy" @input="clearServer('name')" />
        </FormField>
        <FormField ref="emailF" :label="t('signup.fields.email')" :hint="t('signup.fields.emailHint')" required :rules="[emailRule()]" :value="form.email" :error="serverErrors.email" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.email" type="email" class="input" autocomplete="email" :aria-invalid="invalid" :aria-describedby="describedBy" @input="clearServer('email')" />
        </FormField>
        <FormField ref="companyF" :label="t('signup.fields.company')" required :value="form.company" :error="serverErrors.company" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.company" class="input" autocomplete="organization" :aria-invalid="invalid" :aria-describedby="describedBy" @input="clearServer('company')" />
        </FormField>
        <FormField ref="pwF" :label="t('signup.fields.password')" required :rules="[strongRule]" :value="form.password" :error="serverErrors.password" v-slot="{ id, invalid, describedBy }">
          <div class="pw">
            <input :id="id" v-model="form.password" :type="showPw ? 'text' : 'password'" class="input" autocomplete="new-password" :aria-invalid="invalid" :aria-describedby="describedBy" @input="clearServer('password')" />
            <button type="button" class="btn-icon eye" :aria-label="showPw ? t('signup.hidePassword') : t('signup.showPassword')" @click="showPw = !showPw">
              <Icon :name="showPw ? 'eye-off' : 'eye'" :size="15" />
            </button>
          </div>
          <div class="meter" :class="'m' + strength" aria-hidden="true"><span v-for="i in 4" :key="i" :class="{ on: i <= strength }" /></div>
          <div class="meter-row">
            <span class="meter-label">{{ form.password ? strengthLabel : t('signup.strength.hint') }}</span>
          </div>
          <ul class="checks">
            <li v-for="k in ['length', 'upper', 'digit', 'symbol']" :key="k" :class="{ ok: checks[k] }">
              <Icon :name="checks[k] ? 'check' : 'minus'" :size="11" />{{ t('signup.checks.' + k) }}
            </li>
          </ul>
        </FormField>

        <div>
          <label class="checkbox">
            <input v-model="form.terms" type="checkbox" @change="termsError = ''" />
            <span>{{ t('signup.termsPrefix') }} <button type="button" class="btn-link" @click="termsOpen = true">{{ t('signup.termsLink') }}</button>{{ t('signup.termsSuffix') }}</span>
          </label>
          <div v-if="termsError" class="field-error" role="alert">{{ termsError }}</div>
        </div>

        <button type="submit" class="btn btn-primary btn-lg submit" :disabled="loading">
          <span v-if="loading" class="spin" />
          {{ t('signup.submit') }}
        </button>
      </form>

      <div class="note"><Icon name="info" :size="14" />{{ t('signup.demoNote') }}</div>
      <p class="alt">{{ t('signup.haveAccount') }} <RouterLink :to="{ name: 'login' }" class="link">{{ t('signup.login') }}</RouterLink></p>
    </template>

    <template v-else>
      <div class="mail-ic"><Icon name="mail" :size="20" /></div>
      <h1 class="title">{{ t('signup.verify.title') }}</h1>
      <p class="sub">{{ t('signup.verify.sub', { email: form.email }) }}</p>

      <form class="form" novalidate @submit.prevent="verify">
        <label class="field-label" for="sg-code">{{ t('signup.verify.code') }}</label>
        <div class="code-wrap" :class="{ invalid: codeError }" @click="codeInput?.focus()">
          <input id="sg-code" ref="codeInput" :value="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
            :aria-invalid="!!codeError" :aria-describedby="codeError ? 'sg-code-err' : undefined" @input="onCode" />
          <span v-for="(d, i) in digits" :key="i" class="box mono" :class="{ filled: d, cur: i === Math.min(code.length, 5) }">{{ d }}</span>
        </div>
        <div v-if="codeError" id="sg-code-err" class="field-error" role="alert">{{ codeError }}</div>
        <button type="submit" class="btn btn-primary btn-lg submit" :disabled="verifying">
          <span v-if="verifying" class="spin" />
          {{ t('signup.verify.submit') }}
        </button>
      </form>

      <div class="demo">
        <div>
          <div class="mono demo-label">{{ t('signup.verify.demoLabel') }}</div>
          <div class="mono creds">{{ t('signup.verify.demoCode') }}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="fillCode">{{ t('signup.verify.fill') }}</button>
      </div>

      <div class="verify-actions">
        <button type="button" class="btn-link" @click="backToForm"><Icon name="chevron-left" :size="12" />{{ t('signup.verify.changeEmail') }}</button>
        <button type="button" class="btn-link" :disabled="cooldown > 0" @click="resend">
          {{ cooldown > 0 ? t('signup.verify.resendIn', { n: cooldown }) : t('signup.verify.resend') }}
        </button>
      </div>
    </template>

    <Modal v-model:open="termsOpen" :title="t('signup.terms.title')" size="lg">
      <div class="terms">
        <p class="muted">{{ t('signup.terms.updated') }}</p>
        <template v-for="i in 6" :key="i">
          <h4>{{ t(`signup.terms.s${i}.h`) }}</h4>
          <p>{{ t(`signup.terms.s${i}.p`) }}</p>
        </template>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="termsOpen = false">{{ t('common.close') }}</button>
        <button class="btn btn-primary" @click="acceptTerms">{{ t('signup.terms.accept') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.title { font-family: var(--font-display); font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
.sub { color: var(--ink-3); margin: 6px 0 22px; }
.form { display: flex; flex-direction: column; gap: 14px; }
.pw { position: relative; }
.pw .input { padding-right: 42px; width: 100%; }
.eye { position: absolute; right: 4px; top: 3px; }
.meter { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 8px; }
.meter span { height: 4px; border-radius: 4px; background: var(--line-1); transition: background .2s; }
.meter.m1 span.on, .meter.m2 span.on { background: var(--danger); }
.meter.m3 span.on { background: var(--warning); }
.meter.m4 span.on { background: var(--success); }
.meter-row { display: flex; justify-content: space-between; margin-top: 4px; }
.meter-label { font-size: 12px; color: var(--ink-3); }
.checks { list-style: none; padding: 0; margin: 6px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 12px; font-size: 12px; color: var(--ink-3); }
.checks li { display: flex; align-items: center; gap: 5px; }
.checks li.ok { color: var(--success); }
.submit { justify-content: center; width: 100%; margin-top: 4px; }
.spin { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.note { display: flex; gap: 8px; align-items: flex-start; margin-top: 18px; padding: 10px 12px; border-radius: var(--r-md); background: var(--bg-3); color: var(--ink-2); font-size: 12.5px; line-height: 1.5; border: 1px solid var(--line-1); }
.alt { margin-top: 18px; font-size: 13.5px; color: var(--ink-3); text-align: center; }
.mail-ic { width: 44px; height: 44px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; margin-bottom: 14px; }
.code-wrap { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; cursor: text; }
.code-input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; font-size: 16px; }
.box { height: 52px; border: 1px solid var(--line-2); border-radius: 10px; display: grid; place-items: center; font-size: 22px; font-weight: 600; background: var(--surface); }
.box.filled { border-color: var(--line-strong); }
.code-wrap:focus-within .box.cur { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.code-wrap.invalid .box { border-color: var(--danger); }
.demo { margin-top: 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-3); border: 1px solid var(--line-1); }
.demo-label { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.creds { font-size: 13.5px; font-weight: 600; margin-top: 2px; }
.verify-actions { display: flex; justify-content: space-between; margin-top: 16px; font-size: 13px; gap: 10px; flex-wrap: wrap; }
.verify-actions .btn-link { display: inline-flex; align-items: center; gap: 4px; }
.verify-actions .btn-link:disabled { color: var(--ink-4); cursor: default; text-decoration: none; }
.terms h4 { margin: 16px 0 4px; font-size: 14px; }
.terms p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink-2); }
</style>
