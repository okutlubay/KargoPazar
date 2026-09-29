<script setup>
import { ref, reactive, computed, inject, nextTick, onUnmounted } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, lang, f } = useI18n()
const legal = inject('kpzLegal')

const LEADS_KEY = 'kpz_demo:leads'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const form = reactive({ name: '', company: '', email: '', topic: 'demo', message: '', consent: false })
const touched = reactive({ name: false, email: false, message: false, consent: false })
const sending = ref(false)
const sent = ref(null)
const saveError = ref(false)
const formEl = ref(null)
let timer = null
onUnmounted(() => clearTimeout(timer))

const errors = computed(() => ({
  name: form.name.trim().length < 2 ? t.value.contact.errors.name : null,
  email: !EMAIL_RE.test(form.email.trim()) ? t.value.contact.errors.email : null,
  message: form.message.trim().length < 10 ? t.value.contact.errors.message : null,
  consent: !form.consent ? t.value.contact.errors.consent : null,
}))
const show = (k) => touched[k] && errors.value[k]

function readLeads() {
  try {
    const v = JSON.parse(localStorage.getItem(LEADS_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

async function submit() {
  Object.keys(touched).forEach((k) => { touched[k] = true })
  saveError.value = false
  const firstBad = ['name', 'email', 'message', 'consent'].find((k) => errors.value[k])
  if (firstBad) {
    await nextTick()
    const el = formEl.value && formEl.value.querySelector(`[name="${firstBad}"]`)
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }) }
    return
  }
  sending.value = true
  timer = setTimeout(() => {
    try {
      const leads = readLeads()
      const n = leads.length + 1
      const lead = {
        id: `LEAD-${String(1000 + n)}`,
        name: form.name.trim(),
        company: form.company.trim() || null,
        email: form.email.trim(),
        topic: form.topic,
        message: form.message.trim(),
        lang: lang.value,
        consent: true,
        source: 'landing',
        createdAt: new Date().toISOString(),
      }
      leads.push(lead)
      localStorage.setItem(LEADS_KEY, JSON.stringify(leads))
      sent.value = lead
    } catch {
      saveError.value = true
    }
    sending.value = false
  }, 700)
}

function reset() {
  Object.assign(form, { name: '', company: '', email: '', topic: 'demo', message: '', consent: false })
  Object.keys(touched).forEach((k) => { touched[k] = false })
  sent.value = null
}
</script>

<template>
  <section id="contact" class="section">
    <div class="container">
      <div class="layout">
        <div>
          <SectionHeader :eyebrow="t.contact.eyebrow" :title="t.contact.title" :sub="t.contact.sub" />
          <div class="col contacts">
            <div class="row contact-row">
              <span class="ico-tile"><Icon name="mail" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">hello@kargopazar.com</span>
                <span class="sub">{{ t.contact.general }}</span>
              </div>
            </div>
            <div class="row contact-row">
              <span class="ico-tile"><Icon name="truck" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">ops@kargopazar.com</span>
                <span class="sub">{{ t.contact.support }}</span>
              </div>
            </div>
            <div class="row contact-row">
              <span class="ico-tile"><Icon name="pin" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">{{ t.contact.office }}</span>
                <span class="sub">{{ t.contact.officeSub }}</span>
              </div>
            </div>
          </div>

          <div class="teknopark-card">
            <div class="row" style="gap: 8px; margin-bottom: 6px">
              <span class="badge-ai">TEKNOPARK</span>
              <span class="tp-title">{{ t.contact.tpTitle }}</span>
            </div>
            <p class="tp-text">{{ t.contact.tpText }}</p>
          </div>
        </div>

        <form ref="formEl" class="card form" novalidate @submit.prevent="submit">
          <div v-if="sent" class="sent-state" role="status">
            <span class="success-circle"><Icon name="check" :size="26" /></span>
            <h3 class="h-3" style="margin: 0">{{ t.contact.sentTitle }}</h3>
            <p class="sent-sub">{{ f(t.contact.sentDesc, { ref: sent.id, email: sent.email }) }}</p>
            <button type="button" class="btn btn-ghost btn-sm" @click="reset">{{ t.contact.newMessage }}</button>
          </div>
          <div v-else class="col" style="gap: 14px">
            <div class="two">
              <div>
                <label class="field-label" for="c-name">{{ t.contact.name }} *</label>
                <input id="c-name" v-model="form.name" name="name" class="input" :class="{ invalid: show('name') }" :placeholder="t.contact.namePh" autocomplete="name" :aria-invalid="!!show('name')" @blur="touched.name = true" />
                <div v-if="show('name')" class="err"><Icon name="alert" :size="12" /> {{ errors.name }}</div>
              </div>
              <div>
                <label class="field-label" for="c-company">{{ t.contact.company }}</label>
                <input id="c-company" v-model="form.company" name="company" class="input" :placeholder="t.contact.companyPh" autocomplete="organization" />
              </div>
            </div>
            <div>
              <label class="field-label" for="c-email">{{ t.contact.email }} *</label>
              <input id="c-email" v-model="form.email" name="email" class="input" :class="{ invalid: show('email') }" type="email" :placeholder="t.contact.emailPh" autocomplete="email" :aria-invalid="!!show('email')" @blur="touched.email = true" />
              <div v-if="show('email')" class="err"><Icon name="alert" :size="12" /> {{ errors.email }}</div>
            </div>
            <div>
              <label class="field-label" for="c-topic">{{ t.contact.topic }}</label>
              <select id="c-topic" v-model="form.topic" name="topic" class="select">
                <option v-for="(l, k) in t.contact.topics" :key="k" :value="k">{{ l }}</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="c-message">{{ t.contact.message }} *</label>
              <textarea id="c-message" v-model="form.message" name="message" class="input area" :class="{ invalid: show('message') }" :placeholder="t.contact.messagePh" :aria-invalid="!!show('message')" @blur="touched.message = true" />
              <div v-if="show('message')" class="err"><Icon name="alert" :size="12" /> {{ errors.message }}</div>
            </div>
            <div>
              <label class="consent">
                <input v-model="form.consent" name="consent" type="checkbox" @change="touched.consent = true" />
                <span>
                  {{ t.contact.consent }}
                  <button type="button" class="inline-link" @click="legal.open('kvkk')">{{ t.contact.consentLink }}</button>
                </span>
              </label>
              <div v-if="show('consent')" class="err"><Icon name="alert" :size="12" /> {{ errors.consent }}</div>
            </div>
            <div v-if="saveError" class="err box"><Icon name="alert" :size="13" /> {{ t.contact.errors.save }}</div>
            <button type="submit" class="btn btn-accent btn-lg submit" :disabled="sending">
              <span v-if="sending" class="spinner" aria-hidden="true" />
              {{ sending ? t.contact.sending : t.contact.send }}
              <Icon v-if="!sending" name="arrow" />
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: start; }
.contacts { gap: 16px; margin-top: 28px; }
.contact-row { gap: 14px; }
.ico-tile {
  width: 40px; height: 40px; border-radius: 8px; flex: 0 0 auto;
  background: var(--bg-3); color: var(--ink-1);
  display: flex; align-items: center; justify-content: center;
}
.lbl { font-size: 14.5px; font-weight: 500; }
.sub { font-size: 12px; color: var(--ink-3); }

.teknopark-card {
  margin-top: 28px; padding: 18px;
  border-radius: 10px;
  background: var(--accent-soft);
  border: 1px solid oklch(0.85 0.06 268);
}
.tp-title { font-size: 13px; font-weight: 600; color: var(--accent-ink); }
.tp-text { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.5; }

.form { padding: 28px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.area { height: 110px; padding: 12px; resize: vertical; }
.input.invalid { border-color: var(--danger); }
.err { display: flex; align-items: center; gap: 5px; margin-top: 5px; font-size: 12px; color: var(--danger); }
.err.box { margin: 0; padding: 10px 12px; border-radius: var(--r-md); background: oklch(0.96 0.03 25); }
.consent { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: var(--ink-2); line-height: 1.45; cursor: pointer; }
.consent input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--accent); flex: 0 0 auto; }
.inline-link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
.submit { margin-top: 6px; justify-content: center; }
.submit:disabled { opacity: 0.75; cursor: progress; transform: none; }
.spinner {
  width: 15px; height: 15px; border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: white;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.sent-state {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 40px 20px; gap: 14px;
}
.success-circle {
  width: 56px; height: 56px; border-radius: 999px;
  background: var(--success); color: white;
  display: flex; align-items: center; justify-content: center;
}
.sent-sub { margin: 0; font-size: 13.5px; color: var(--ink-2); max-width: 360px; line-height: 1.5; }

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; gap: 32px; }
}
@media (max-width: 520px) {
  .two { grid-template-columns: 1fr; }
  .form { padding: 20px; }
}
</style>
