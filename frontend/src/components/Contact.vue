<script setup>
import { ref, reactive, computed, inject, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'
import { createLead } from '../shared/publicApi.js'
import { PLATFORM_COMPANY as CO } from '../shared/company.js'

const { t, lang, f } = useI18n()
const legal = inject('kpzLegal', null)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DEFAULT_TOPIC = 'demo'
const telHref = 'tel:' + CO.phone.replace(/[^\d+]/g, '')
const mailHref = 'mailto:' + CO.email

// `website` is a honeypot: hidden from people, filled in by naive bots.
const form = reactive({ name: '', company: '', email: '', topic: DEFAULT_TOPIC, message: '', website: '' })
const touched = reactive({ name: false, email: false, message: false })
const sending = ref(false)
const sent = ref(null)
const sendError = ref(false)
const formEl = ref(null)
let alive = true
onUnmounted(() => { alive = false })

// ?topic=early_access (all early-access CTAs link to /?topic=early_access#contact) preselects the topic.
function topicFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('topic')
    return v && Object.prototype.hasOwnProperty.call(t.value.contact.topics, v) ? v : null
  } catch { return null }
}
onMounted(() => { const k = topicFromUrl(); if (k) form.topic = k })

const errors = computed(() => ({
  name: form.name.trim().length < 2 ? t.value.contact.errors.name : null,
  email: !EMAIL_RE.test(form.email.trim()) ? t.value.contact.errors.email : null,
  message: form.message.trim().length < 10 ? t.value.contact.errors.message : null,
}))
const show = (k) => touched[k] && errors.value[k]

async function submit() {
  Object.keys(touched).forEach((k) => { touched[k] = true })
  sendError.value = false
  const firstBad = ['name', 'email', 'message'].find((k) => errors.value[k])
  if (firstBad) {
    await nextTick()
    const el = formEl.value && formEl.value.querySelector(`[name="${firstBad}"]`)
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }) }
    return
  }
  const lead = {
    name: form.name.trim(),
    company: form.company.trim() || null,
    email: form.email.trim(),
    phone: null,
    topic: form.topic,
    message: form.message.trim(),
    lang: lang.value,
    privacyNoticeAck: true,
    website: form.website,
    source: 'landing',
    createdAt: new Date().toISOString(),
  }
  // Honeypot filled: pretend it worked, never call the API.
  if (form.website.trim()) {
    sent.value = { ...lead, id: '-' }
    return
  }
  sending.value = true
  try {
    const res = await createLead(lead)
    const id = res && res.id != null ? res.id : null
    if (alive) sent.value = { ...lead, id: id == null ? '-' : typeof id === 'number' ? `LEAD-${id}` : String(id) }
  } catch {
    // Keep the form as typed so the visitor can retry or use another channel.
    if (alive) sendError.value = true
  }
  if (alive) sending.value = false
}

function openKvkk(e) {
  if (legal && legal.open) { e.preventDefault(); legal.open('kvkk') }
}

function reset() {
  Object.assign(form, { name: '', company: '', email: '', topic: topicFromUrl() || DEFAULT_TOPIC, message: '', website: '' })
  Object.keys(touched).forEach((k) => { touched[k] = false })
  sendError.value = false
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
              <span class="ico-tile"><Icon name="mail" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">{{ CO.email }}</span>
                <span class="sub">{{ t.contact.companyMail }}</span>
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
            <div class="hp" aria-hidden="true">
              <label for="c-website">Website</label>
              <input id="c-website" v-model="form.website" name="website" type="text" tabindex="-1" autocomplete="off" />
            </div>
            <div v-if="sendError" class="send-error" role="alert">
              <div class="send-error-title"><Icon name="alert" :size="14" /> {{ t.contact.errors.sendTitle }}</div>
              <p class="send-error-text">{{ t.contact.errors.sendDesc }}</p>
              <div class="send-error-links">
                <a :href="telHref" class="alt-link">{{ t.contact.phoneLabel }} {{ CO.phone }}</a>
                <a :href="mailHref" class="alt-link"><Icon name="mail" :size="13" /> {{ CO.email }}</a>
              </div>
            </div>
            <button type="submit" class="btn btn-accent btn-lg submit" :disabled="sending">
              <span v-if="sending" class="spinner" aria-hidden="true" />
              {{ sending ? t.contact.sending : t.contact.send }}
              <Icon v-if="!sending" name="arrow" />
            </button>
            <p class="notice">
              {{ t.contact.noticePre }}<a href="/kvkk/" class="inline-link" @click="openKvkk">{{ t.contact.noticeLink }}</a>{{ t.contact.noticePost }}
            </p>
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

.form { position: relative; padding: 28px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.area { height: 110px; padding: 12px; resize: vertical; }
.input.invalid { border-color: var(--danger); }
.err { display: flex; align-items: center; gap: 5px; margin-top: 5px; font-size: 12px; color: var(--danger); }
/* Honeypot: off-screen (not display:none, which some bots skip). */
.hp { position: absolute; left: -10000px; top: auto; width: 1px; height: 1px; overflow: hidden; }
.send-error { padding: 12px 14px; border-radius: var(--r-md); background: oklch(0.96 0.03 25); border: 1px solid oklch(0.88 0.06 25); }
.send-error-title { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--danger); }
.send-error-text { margin: 4px 0 8px; font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
.send-error-links { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.alt-link { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 500; color: var(--accent-ink); text-decoration: underline; }
.notice { margin: 0; font-size: 12px; color: var(--ink-3); line-height: 1.5; }
.inline-link { color: var(--accent-ink); text-decoration: underline; }
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
