<template>
  <div class="logo-cloud">
    <div class="container">
      <div class="logo-text">{{ t?.logos }}</div>
      <div class="logo-grid">
        <div v-for="logo in logos" :key="logo" class="logo-item">
          {{ logo }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '../i18n';

const logos = [
  'Etsy',
  'Shopify',
  'Amazon',
  'DHL',
  'FedEx',
  'UPS',
  'TNT',
  'Aras',
  'PTT Kargo',
  'YRT Lojistik',
];
</script>

<style scoped>
.logo-cloud {
  padding: 64px 0;
  background: var(--bg-2);
  border-top: 1px solid var(--line-1);
}

.logo-text {
  text-align: center;
  color: var(--ink-2);
  font-size: 14px;
  margin-bottom: 32px;
}

.logo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 24px;
  justify-items: center;
}

.logo-item {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 1px solid var(--line-1);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-2);
  text-align: center;
}
</style>
