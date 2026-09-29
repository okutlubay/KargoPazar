<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Modal from '../Modal.vue'
import FormField from '../FormField.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import Toggle from '../Toggle.vue'
import CopyButton from '../CopyButton.vue'
import DateTime from '../DateTime.vue'
import { validateAll, minLength } from '../validation.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { changePassword } from '../../api/auth.js'
import { getSettings, passwordStrength, startTwoFactor, confirmTwoFactor, disableTwoFactor, currentTotp, revokeSession, revokeOtherSessions } from '../../api/settings.js'
import { errorText, downloadText } from './util.js'

const { t } = useI18n()
const loading = ref(true)
const s = ref(null)

async function load() {
  try { s.value = await getSettings() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

// ---- password
const pw = reactive({ current: '', next: '', confirm: '' })
const pwFields = ref([])
const pwSaving = ref(false)
const pwError = ref('')
const show = ref(false)
const strength = computed(() => passwordStrength(pw.next))
const strengthLabel = computed(() => t('settings.security.strength.' + ['veryWeak', 'weak', 'fair', 'good', 'strong'][strength.value.score]))
const strengthTone = computed(() => ['danger', 'danger', 'warning', 'success', 'success'][strength.value.score])
const strongEnough = v => !v || passwordStrength(v).score >= 2 || t('settings.security.tooWeak')
const matches = v => !v || v === pw.next || t('settings.security.mismatch')
const differs = v => !v || v !== pw.current || t('settings.security.sameAsOld')

async function submitPassword() {
  pwError.value = ''
  if (!validateAll(pwFields.value.filter(Boolean))) return
  pwSaving.value = true
  try {
    await changePassword(pw.current, pw.next)
    Object.assign(pw, { current: '', next: '', confirm: '' })
    pwFields.value.forEach(f => f?.reset?.())
    toast.success(t('settings.security.passwordChanged'))
  } catch (e) {
    pwError.value = e?.code === 'WRONG_PASSWORD' ? t('settings.security.wrongPassword') : errorText(e)
    if (e?.code === 'WRONG_PASSWORD') pwFields.value[0]?.focus?.()
  } finally { pwSaving.value = false }
}

// ---- 2FA
const setupOpen = ref(false)
const setup = ref(null)
const qr = ref('')
const code = ref('')
const codeError = ref('')
const verifying = ref(false)
const recovery = ref(null)
const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const secondsLeft = computed(() => 30 - Math.floor((now.value / 1000) % 30))
const demoCode = computed(() => { void now.value; return setup.value ? currentTotp(setup.value.secret) : '' })
const secretGroups = computed(() => (setup.value?.secret ?? '').match(/.{1,4}/g)?.join(' ') ?? '')

async function onToggle2fa(v) {
  if (v) {
    try {
      recovery.value = null; code.value = ''; codeError.value = ''
      setup.value = await startTwoFactor()
      qr.value = await QRCode.toDataURL(setup.value.otpauth, { margin: 1, width: 188, color: { dark: '#1b1d29', light: '#ffffff' } })
      setupOpen.value = true
    } catch (e) { toast.error(errorText(e)) }
  } else {
    disableOpen.value = true
    disablePw.value = ''
    disableError.value = ''
  }
}

async function verify() {
  codeError.value = ''
  const c = code.value.replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) { codeError.value = t('settings.security.codeFormat'); return }
  verifying.value = true
  try {
    const r = await confirmTwoFactor(setup.value.secret, c)
    recovery.value = r.recoveryCodes
    await load()
    toast.success(t('settings.security.twoFactorOn'))
  } catch (e) {
    codeError.value = e?.code === 'INVALID_CODE' ? t('settings.security.codeInvalid') : errorText(e)
  } finally { verifying.value = false }
}
function onCodeInput(e) { code.value = e.target.value.replace(/\D/g, '').slice(0, 6); codeError.value = '' }
function downloadCodes() {
  downloadText('kargopazar-recovery-codes.txt', `${t('settings.security.recoveryTitle')}\n\n${recovery.value.join('\n')}\n`, 'text/plain')
}
function closeSetup() { setupOpen.value = false; setup.value = null }

const disableOpen = ref(false)
const disablePw = ref('')
const disableError = ref('')
const disabling = ref(false)
async function doDisable() {
  disableError.value = ''
  if (!disablePw.value) { disableError.value = t('common.validation.required'); return }
  disabling.value = true
  try {
    await disableTwoFactor(disablePw.value)
    disableOpen.value = false
    await load()
    toast.success(t('settings.security.twoFactorOff'))
  } catch (e) {
    disableError.value = e?.code === 'WRONG_PASSWORD' ? t('settings.security.wrongPassword') : errorText(e)
  } finally { disabling.value = false }
}

// ---- sessions
const revoking = ref(null)
async function revoke(sess) {
  const ok = await confirm({ title: t('settings.security.revokeTitle'), message: t('settings.security.revokeDesc', { device: sess.device }), confirmLabel: t('settings.security.revoke'), danger: true })
  if (!ok) return
  revoking.value = sess.id
  try { s.value.sessions = await revokeSession(sess.id); toast.success(t('settings.security.revoked')) } catch (e) { toast.error(errorText(e)) } finally { revoking.value = null }
}
async function revokeAll() {
  const ok = await confirm({ title: t('settings.security.revokeAllTitle'), message: t('settings.security.revokeAllDesc'), confirmLabel: t('settings.security.revokeAll'), danger: true })
  if (!ok) return
  revoking.value = 'all'
  try { s.value.sessions = await revokeOtherSessions(); toast.success(t('settings.security.revokedAll')) } catch (e) { toast.error(errorText(e)) } finally { revoking.value = null }
}
const others = computed(() => (s.value?.sessions ?? []).filter(x => !x.current).length)
</script>

<template>
  <div class="stack-lg">
    <Card :title="t('settings.security.passwordTitle')" :subtitle="t('settings.security.passwordDesc')">
      <form class="pwform" novalidate @submit.prevent="submitPassword">
        <FormField :ref="el => (pwFields[0] = el)" :label="t('settings.security.current')" required :value="pw.current" :error="pwError" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="pw.current" :type="show ? 'text' : 'password'" class="input" autocomplete="current-password" :aria-invalid="invalid" :aria-describedby="describedBy" @input="pwError = ''" />
        </FormField>
        <FormField :ref="el => (pwFields[1] = el)" :label="t('settings.security.new')" required :rules="[minLength(8), strongEnough, differs]" :value="pw.next" v-slot="{ id, invalid, describedBy }">
          <div class="pw-wrap">
            <input :id="id" v-model="pw.next" :type="show ? 'text' : 'password'" class="input" autocomplete="new-password" :aria-invalid="invalid" :aria-describedby="describedBy" />
            <button type="button" class="btn-icon eye" :aria-label="show ? t('settings.security.hide') : t('settings.security.show')" @click="show = !show"><Icon :name="show ? 'eye-off' : 'eye'" :size="14" /></button>
          </div>
        </FormField>
        <div v-if="pw.next" class="meter" aria-live="polite">
          <div class="bars"><span v-for="i in 4" :key="i" :class="['bar', i <= strength.score ? strengthTone : '']" /></div>
          <div class="meter-row">
            <span :class="['sl', 'text-' + strengthTone]">{{ strengthLabel }}</span>
            <ul class="checks">
              <li v-for="(ok, k) in strength.checks" :key="k" :class="{ ok }"><Icon :name="ok ? 'check' : 'x'" :size="11" />{{ t('settings.security.checks.' + k) }}</li>
            </ul>
          </div>
        </div>
        <FormField :ref="el => (pwFields[2] = el)" :label="t('settings.security.confirm')" required :rules="[matches]" :value="pw.confirm" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="pw.confirm" :type="show ? 'text' : 'password'" class="input" autocomplete="new-password" :aria-invalid="invalid" :aria-describedby="describedBy" />
        </FormField>
        <div class="row-end">
          <span class="hint">{{ t('settings.security.demoHint') }}</span>
          <button type="submit" class="btn btn-primary" :disabled="pwSaving"><Spinner v-if="pwSaving" :size="14" />{{ t('settings.security.change') }}</button>
        </div>
      </form>
    </Card>

    <Card :title="t('settings.security.twoFactorTitle')" :subtitle="t('settings.security.twoFactorDesc')">
      <div v-if="loading"><Skeleton :lines="2" /></div>
      <div v-else class="tf">
        <div class="tf-ic"><Icon name="shield" :size="18" /></div>
        <div class="tf-body">
          <div class="tf-state">
            <strong>{{ s.twoFactorEnabled ? t('settings.security.enabled') : t('settings.security.disabled') }}</strong>
            <span v-if="s.twoFactorEnabled && s.twoFactorEnabledAt" class="hint"> · <DateTime :value="s.twoFactorEnabledAt" /></span>
          </div>
          <div class="hint">{{ s.twoFactorEnabled ? t('settings.security.enabledHint') : t('settings.security.disabledHint') }}</div>
        </div>
        <Toggle :model-value="s.twoFactorEnabled" :aria-label="t('settings.security.twoFactorTitle')" @update:model-value="onToggle2fa" />
      </div>
    </Card>

    <Card :title="t('settings.security.sessionsTitle')" :subtitle="t('settings.security.sessionsDesc')" padding="none">
      <template #actions>
        <button class="btn btn-ghost btn-sm" :disabled="!others || revoking" @click="revokeAll"><Spinner v-if="revoking === 'all'" :size="12" />{{ t('settings.security.revokeAll') }}</button>
      </template>
      <div v-if="loading" class="pad"><Skeleton :lines="3" /></div>
      <ul v-else class="sessions">
        <li v-for="x in s.sessions" :key="x.id" class="sess">
          <span class="dev"><Icon :name="x.device.includes('iPhone') ? 'user' : 'server'" :size="15" /></span>
          <div class="sess-main">
            <div class="sess-dev">{{ x.device }} <span v-if="x.current" class="tag tag-success">{{ t('settings.security.thisDevice') }}</span></div>
            <div class="hint">{{ x.location }} · <span class="mono">{{ x.ip }}</span> · <DateTime :value="x.lastActiveAt" /></div>
          </div>
          <button v-if="!x.current" class="btn btn-ghost btn-sm" :disabled="!!revoking" @click="revoke(x)"><Spinner v-if="revoking === x.id" :size="12" />{{ t('settings.security.revoke') }}</button>
        </li>
      </ul>
    </Card>

    <Modal :open="setupOpen" :title="recovery ? t('settings.security.recoveryTitle') : t('settings.security.setupTitle')" size="md" @update:open="v => !v && closeSetup()">
      <div v-if="!recovery && setup" class="setup">
        <ol class="steps">
          <li>{{ t('settings.security.step1') }}</li>
          <li>{{ t('settings.security.step2') }}</li>
        </ol>
        <div class="qr-row">
          <img :src="qr" :alt="t('settings.security.qrAlt')" width="188" height="188" class="qr" />
          <div class="secret">
            <div class="hint">{{ t('settings.security.manualKey') }}</div>
            <div class="key mono">{{ secretGroups }}</div>
            <CopyButton :text="setup.secret" variant="button" size="sm" />
            <div class="demo-code">
              <div class="hint">{{ t('settings.security.demoCode') }}</div>
              <div class="dc mono">{{ demoCode.slice(0, 3) }} {{ demoCode.slice(3) }}</div>
              <div class="hint">{{ t('settings.security.expires', { n: secondsLeft }) }}</div>
            </div>
          </div>
        </div>
        <FormField :label="t('settings.security.codeLabel')" :error="codeError" :value="code" v-slot="{ id, invalid, describedBy }">
          <input :id="id" :value="code" class="input code-input mono" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" :aria-invalid="invalid" :aria-describedby="describedBy" @input="onCodeInput" @keydown.enter.prevent="verify" />
        </FormField>
      </div>
      <div v-else-if="recovery" class="stack">
        <div class="callout">{{ t('settings.security.recoveryDesc') }}</div>
        <div class="codes mono"><span v-for="c in recovery" :key="c">{{ c }}</span></div>
        <div class="row-end gap">
          <CopyButton :text="recovery.join('\n')" variant="button" size="sm" />
          <button class="btn btn-ghost btn-sm" @click="downloadCodes"><Icon name="download" :size="13" />{{ t('common.download') }}</button>
        </div>
      </div>
      <template #footer>
        <template v-if="!recovery">
          <button class="btn btn-ghost" @click="closeSetup">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="verifying || code.length !== 6" @click="verify"><Spinner v-if="verifying" :size="14" />{{ t('settings.security.verify') }}</button>
        </template>
        <button v-else class="btn btn-primary" @click="closeSetup">{{ t('common.finish') }}</button>
      </template>
    </Modal>

    <Modal v-model:open="disableOpen" :title="t('settings.security.disableTitle')" size="sm">
      <div class="stack">
        <p class="hint">{{ t('settings.security.disableDesc') }}</p>
        <FormField :label="t('settings.security.current')" :error="disableError" :value="disablePw" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="disablePw" type="password" class="input" autocomplete="current-password" :aria-invalid="invalid" :aria-describedby="describedBy" @keydown.enter.prevent="doDisable" />
        </FormField>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="disableOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" :disabled="disabling" @click="doDisable"><Spinner v-if="disabling" :size="14" />{{ t('settings.security.disable') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.pwform { display: flex; flex-direction: column; gap: 14px; max-width: 460px; }
.pw-wrap { position: relative; }
.pw-wrap .input { width: 100%; padding-right: 40px; }
.eye { position: absolute; right: 3px; top: 3px; }
.meter { display: flex; flex-direction: column; gap: 6px; margin-top: -4px; }
.bars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.bar { height: 4px; border-radius: 99px; background: var(--line-1); }
.bar.danger { background: var(--danger); } .bar.warning { background: var(--warning); } .bar.success { background: var(--success); }
.meter-row { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
.sl { font-size: 12.5px; font-weight: 600; }
.checks { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--ink-4); }
.checks li { display: inline-flex; gap: 4px; align-items: center; }
.checks li.ok { color: var(--success); }
.row-end { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex-wrap: wrap; }
.row-end .hint { margin-right: auto; }
.gap { gap: 8px; }
.hint { color: var(--ink-3); font-size: 12.5px; }
.tf { display: flex; align-items: center; gap: 14px; }
.tf-ic { width: 38px; height: 38px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-ink); display: grid; place-items: center; flex: none; }
.tf-body { flex: 1; min-width: 0; }
.pad { padding: 18px 20px; }
.sessions { list-style: none; margin: 0; padding: 0; }
.sess { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--line-1); }
.sess:first-child { border-top: 0; }
.dev { width: 34px; height: 34px; border-radius: 9px; background: var(--bg-2); display: grid; place-items: center; color: var(--ink-3); flex: none; }
.sess-main { flex: 1; min-width: 0; }
.sess-dev { font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.setup { display: flex; flex-direction: column; gap: 16px; }
.steps { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 13.5px; line-height: 1.6; }
.qr-row { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.qr { border: 1px solid var(--line-1); border-radius: 10px; padding: 6px; background: white; }
.secret { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; flex: 1; min-width: 180px; }
.key { font-size: 14px; letter-spacing: .06em; background: var(--bg-2); padding: 6px 10px; border-radius: 7px; }
.demo-code { margin-top: 8px; padding: 10px 12px; border: 1px dashed var(--line-2); border-radius: 8px; background: oklch(0.97 0.04 95); }
.dc { font-size: 22px; font-weight: 600; letter-spacing: .12em; }
.code-input { font-size: 20px; letter-spacing: .4em; text-align: center; max-width: 220px; }
.codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px; padding: 14px; background: var(--bg-2); border-radius: 10px; font-size: 14px; }
</style>
