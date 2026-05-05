<template>
  <div class="lang-toggle">
    <button
      v-for="langCode in ['tr', 'en']"
      :key="langCode"
      :class="['lang-btn', { active: lang === langCode }]"
      @click="setLang(langCode as 'tr' | 'en')"
    >
      {{ langCode }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { currentLang, setLang } from '../i18n';

const lang = computed(() => currentLang.value);
</script>

<style scoped>
.lang-toggle {
  display: flex;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  padding: 2px;
  background: var(--surface);
  gap: 0;
  height: 32px;
}

.lang-btn {
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-family: var(--font-mono);
  background: transparent;
  color: var(--ink-3);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.lang-btn.active {
  background: var(--ink-1);
  color: var(--bg);
}
</style>
