<template>
  <SectionLayout
    sectionId="contact"
    :eyebrow="t?.contact?.eyebrow"
    :title="t?.contact?.title"
    :subtitle="t?.contact?.sub"
  >
    <div class="contact-form">
      <form @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="email" class="field-label">{{ lang === 'tr' ? 'E-posta' : 'Email' }}</label>
          <input
            id="email"
            v-model="email"
            type="email"
            class="input"
            :placeholder="currentLang === 'tr' ? 'sizin@email.com' : 'your@email.com'"
            required
          />
        </div>
        <div class="form-group">
          <label for="message" class="field-label">{{ lang === 'tr' ? 'Mesaj' : 'Message' }}</label>
          <textarea
            id="message"
            v-model="message"
            class="input"
            style="resize: vertical; min-height: 120px; padding: 12px;"
            :placeholder="currentLang === 'tr' ? 'Mesajınız...' : 'Your message...'"
            required
          />
        </div>
        <button type="submit" class="btn btn-primary btn-lg">
          {{ currentLang === 'tr' ? 'Gönder' : 'Send' }}
          <Icons name="arrow" :size="14" />
        </button>
      </form>
    </div>
  </SectionLayout>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { t, currentLang } from '../i18n';
import SectionLayout from './SectionLayout.vue';
import Icons from './Icons.vue';

const email = ref('');
const message = ref('');
const lang = computed(() => currentLang.value);

const handleSubmit = () => {
  console.log('Form submitted:', { email: email.value, message: message.value });
  email.value = '';
  message.value = '';
  alert(lang.value === 'tr' ? 'Mesaj gönderildi!' : 'Message sent!');
};
</script>

<style scoped>
.contact-form {
  max-width: 480px;
  margin: 0 auto;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

textarea {
  font-family: inherit;
}
</style>
