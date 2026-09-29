<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { t } from '../../i18n/index.js'
import { login, lockRemaining } from '../../api/auth.js'
import { toast } from '../../components/toast.js'

const route = useRoute()
const router = useRouter()

const identifier = ref('')
const password = ref('')
const remember = ref(true)
const showPw = ref(false)
const loading = ref(false)
const error = ref('')
const lockLeft = ref(0)
let timer = null

const locked = computed(() => lockLeft.value > 0)

function tick() {
  lockLeft.value = Math.ceil(lockRemaining() / 1000)
  if (lockLeft.value > 0) error.value = t('auth.login.locked', { n: lockLeft.value })
  else if (error.value && error.value !== t('auth.login.invalid')) error.value = ''
}

function fillDemo() {
  identifier.value = 'demo'
  password.value = 'Demo123!'
  error.value = ''
}

async function submit() {
  if (locked.value || loading.value) return
  error.value = ''
  loading.value = true
  try {
    const u = await login(identifier.value, password.value, remember.value)
    toast.success(t('auth.login.welcome', { name: u.name }))
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (e) {
    if (e.code === 'LOCKED') tick()
    else error.value = t('auth.login.invalid')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (route.query.demo === '1') fillDemo()
  tick()
  timer = setInterval(tick, 1000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="login">
    <h1 class="title">{{ t('auth.login.title') }}</h1>
    <p class="sub">{{ t('auth.login.sub') }}</p>

    <form class="form" novalidate @submit.prevent="submit">
      <div v-if="error" class="callout danger" role="alert"><Icon name="alert" :size="15" />{{ error }}</div>
      <div>
        <label class="field-label" for="lg-id">{{ t('auth.login.identifier') }}</label>
        <input id="lg-id" v-model="identifier" class="input" autocomplete="username" autofocus required />
      </div>
      <div>
        <div class="spread">
          <label class="field-label" for="lg-pw">{{ t('auth.login.password') }}</label>
          <RouterLink :to="{ name: 'forgot' }" class="small-link">{{ t('auth.login.forgot') }}</RouterLink>
        </div>
        <div class="pw">
          <input id="lg-pw" v-model="password" :type="showPw ? 'text' : 'password'" class="input" autocomplete="current-password" required />
          <button type="button" class="btn-icon eye" :aria-label="showPw ? t('auth.login.hidePassword') : t('auth.login.showPassword')" @click="showPw = !showPw">
            <Icon :name="showPw ? 'eye-off' : 'eye'" :size="15" />
          </button>
        </div>
      </div>
      <label class="checkbox"><input v-model="remember" type="checkbox" />{{ t('auth.login.remember') }}</label>
      <button type="submit" class="btn btn-primary btn-lg submit" :disabled="loading || locked">
        <span v-if="loading" class="spin" />
        {{ t('auth.login.submit') }}
      </button>
    </form>

    <div class="demo">
      <div>
        <div class="mono demo-label">{{ t('auth.login.demoBox') }}</div>
        <div class="mono creds">demo / Demo123!</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" @click="fillDemo">{{ t('auth.login.demoFill') }}</button>
    </div>

    <p class="alt">{{ t('auth.login.noAccount') }} <RouterLink :to="{ name: 'signup' }" class="link">{{ t('auth.login.signup') }}</RouterLink></p>
  </div>
</template>

<style scoped>
.title { font-family: var(--font-display); font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
.sub { color: var(--ink-3); margin: 6px 0 24px; }
.form { display: flex; flex-direction: column; gap: 16px; }
.small-link { font-size: 12.5px; color: var(--accent); margin-bottom: 6px; }
.pw { position: relative; }
.pw .input { padding-right: 42px; }
.eye { position: absolute; right: 4px; top: 3px; }
.submit { justify-content: center; width: 100%; }
.spin { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.demo { margin-top: 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-md); background: var(--bg-3); border: 1px solid var(--line-1); }
.demo-label { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.creds { font-size: 13.5px; font-weight: 600; margin-top: 2px; }
.alt { margin-top: 20px; font-size: 13.5px; color: var(--ink-3); text-align: center; }
</style>
