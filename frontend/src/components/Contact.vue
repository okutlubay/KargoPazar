<script setup>
import { ref } from 'vue'
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, lang } = useI18n()
const sent = ref(false)

const submit = () => { sent.value = true }
</script>

<template>
  <section id="contact" class="section">
    <div class="container">
      <div class="layout">
        <div>
          <SectionHeader :eyebrow="t.contact.eyebrow" :title="t.contact.title" :sub="t.contact.sub" />
          <div class="col contacts">
            <div class="row contact-row">
              <span class="ico-tile"><Icon name="globe" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">hello@kargopazar.com</span>
                <span class="sub">{{ lang === 'tr' ? 'Genel iletişim' : 'General' }}</span>
              </div>
            </div>
            <div class="row contact-row">
              <span class="ico-tile"><Icon name="truck" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">ops@kargopazar.com</span>
                <span class="sub">{{ lang === 'tr' ? 'Entegrasyon & teknik destek' : 'Integration & support' }}</span>
              </div>
            </div>
            <div class="row contact-row">
              <span class="ico-tile"><Icon name="pin" /></span>
              <div class="col" style="gap: 1px">
                <span class="lbl">{{ lang === 'tr' ? 'Teknopark, Çanakkale' : 'Teknopark, Canakkale' }}</span>
                <span class="sub">{{ lang === 'tr' ? 'Ar-Ge Ofisi' : 'R&D Office' }}</span>
              </div>
            </div>
          </div>

          <div class="teknopark-card">
            <div class="row" style="gap: 8px; margin-bottom: 6px">
              <span class="badge-ai">TEKNOPARK</span>
              <span class="tp-title">{{ lang === 'tr' ? 'Ar-Ge Projesi' : 'R&D Project' }}</span>
            </div>
            <p class="tp-text">
              <template v-if="lang === 'tr'">
                Bu proje Teknopark bünyesinde Ar-Ge faaliyeti olarak yürütülmektedir. Yapay zeka modülleri ve uluslararası lojistik otomasyonu üzerine çalışıyoruz.
              </template>
              <template v-else>
                This project is conducted as an R&D activity under Teknopark, focusing on AI modules and international logistics automation.
              </template>
            </p>
          </div>
        </div>

        <form class="card form" @submit.prevent="submit">
          <div v-if="sent" class="sent-state">
            <span class="success-circle"><Icon name="check" :size="26" /></span>
            <h3 class="h-3" style="margin: 0">{{ lang === 'tr' ? 'Mesajınız iletildi' : 'Message sent' }}</h3>
            <p class="sent-sub">{{ lang === 'tr' ? '1 iş günü içinde dönüş yapacağız.' : "We'll respond within 1 business day." }}</p>
            <button type="button" class="btn btn-ghost btn-sm" @click="sent = false">{{ lang === 'tr' ? 'Yeni mesaj' : 'New message' }}</button>
          </div>
          <div v-else class="col" style="gap: 14px">
            <div class="row" style="gap: 12px">
              <div style="flex: 1">
                <label class="field-label">{{ lang === 'tr' ? 'Ad Soyad' : 'Full name' }}</label>
                <input class="input" :placeholder="lang === 'tr' ? 'Adınız' : 'Your name'" required />
              </div>
              <div style="flex: 1">
                <label class="field-label">{{ lang === 'tr' ? 'Şirket' : 'Company' }}</label>
                <input class="input" :placeholder="lang === 'tr' ? 'Mağaza adı' : 'Store name'" />
              </div>
            </div>
            <div>
              <label class="field-label">E-posta</label>
              <input class="input" type="email" placeholder="email@example.com" required />
            </div>
            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Konu' : 'Topic' }}</label>
              <select class="select">
                <option value="demo">{{ lang === 'tr' ? 'Demo talep et' : 'Request a demo' }}</option>
                <option value="pricing">{{ lang === 'tr' ? 'Fiyatlandırma' : 'Pricing' }}</option>
                <option value="integration">{{ lang === 'tr' ? 'Entegrasyon' : 'Integration' }}</option>
                <option value="partnership">{{ lang === 'tr' ? 'İş birliği' : 'Partnership' }}</option>
              </select>
            </div>
            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Mesajınız' : 'Message' }}</label>
              <textarea class="input area" :placeholder="lang === 'tr' ? 'Bize yazın...' : 'Tell us...'" />
            </div>
            <button type="submit" class="btn btn-accent btn-lg" style="margin-top: 6px">
              {{ lang === 'tr' ? 'Gönder' : 'Send message' }} <Icon name="arrow" />
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
  width: 40px; height: 40px; border-radius: 8px;
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
.area { height: 100px; padding: 12px; resize: vertical; }
.sent-state {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 40px 20px; gap: 14px;
}
.success-circle {
  width: 56px; height: 56px; border-radius: 999px;
  background: var(--success); color: white;
  display: flex; align-items: center; justify-content: center;
}
.sent-sub { margin: 0; font-size: 13px; color: var(--ink-3); }

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; gap: 32px; }
}
</style>
