<script setup>
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { t } from '../../i18n/index.js'
import { requestPasswordReset } from '../../api/auth.js'

const email = ref('')
const error = ref('')
const loading = ref(false)
const sent = ref(false)

function validate() {
  error.value = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? '' : t('common.validation.email')
  return !error.value
}

async function submit() {
  if (!validate()) return
  loading.value = true
  try {
    await requestPasswordReset(email.value.trim())
    sent.value = true
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <template v-if="!sent">
      <h1 class="title">{{ t('auth.forgot.title') }}</h1>
      <p class="sub">{{ t('auth.forgot.sub') }}</p>
      <form class="form" novalidate @submit.prevent="submit">
        <div>
          <label class="field-label" for="fg-email">{{ t('auth.forgot.email') }}</label>
          <input id="fg-email" v-model="email" type="email" :class="['input', { invalid: error }]" autofocus @blur="email && validate()" />
          <div v-if="error" class="field-error">{{ error }}</div>
        </div>
        <button type="submit" class="btn btn-primary btn-lg submit" :disabled="loading">{{ t('auth.forgot.submit') }}</button>
      </form>
    </template>
    <template v-else>
      <div class="sent-ic"><Icon name="mail" :size="20" /></div>
      <h1 class="title">{{ t('auth.forgot.sentTitle') }}</h1>
      <p class="sub">{{ t('auth.forgot.sentDesc', { email }) }}</p>
      <div class="callout neutral"><Icon name="info" :size="15" />{{ t('auth.forgot.demoNote') }}</div>
    </template>
    <p class="alt"><RouterLink :to="{ name: 'login' }" class="link">{{ t('auth.forgot.back') }}</RouterLink></p>
  </div>
</template>

<style scoped>
.title { font-family: var(--font-display); font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
.sub { color: var(--ink-3); margin: 6px 0 24px; }
.form { display: flex; flex-direction: column; gap: 16px; }
.submit { justify-content: center; width: 100%; }
.sent-ic { width: 44px; height: 44px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-ink); display: grid; place-items: center; margin-bottom: 16px; }
.alt { margin-top: 24px; font-size: 13.5px; text-align: center; }
</style>
