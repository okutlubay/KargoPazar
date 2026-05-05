<template>
  <SectionLayout
    sectionId="ai"
    :eyebrow="t.value?.ai?.eyebrow"
    :title="t.value?.ai?.title"
    :subtitle="t.value?.ai?.sub"
  >
    <div class="ai-models">
      <div v-for="(model, idx) in models" :key="idx" class="model-card">
        <div class="model-number">{{ String(idx + 1).padStart(2, '0') }}</div>
        <h3 class="h-3">{{ model.title }}</h3>
        <p class="muted">{{ model.description }}</p>
      </div>
    </div>
  </SectionLayout>
</template>

<script setup lang="ts">
import { t } from '../i18n';
import SectionLayout from './SectionLayout.vue';

const models = [
  { title: 'Adres Normalleştirme', description: 'Adresleri standartlaştırır ve hataları düzeltir.' },
  { title: 'Gümrük Kodlaması', description: 'HS kodlarını otomatik olarak atanır.' },
  { title: 'Fiyatlandırma', description: 'En uygun tarifeler önerir.' },
  { title: 'Rota Seçimi', description: 'Hız ve maliyet optimizasyonu yapar.' },
  { title: 'Kargo Optimizasyonu', description: 'Paket boyutlarını minimize eder.' },
  { title: 'Gümrük Tahmini', description: 'Gümrük ücretlerini ön hesaplar.' },
  { title: 'Teslimat Tahmini', description: 'Kesin teslimat tarihlerini tahmin eder.' },
];
</script>

<style scoped>
.ai-models {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.model-card {
  padding: 24px;
  background: var(--surface);
  border: 1px solid var(--line-1);
  border-radius: var(--r-lg);
}

.model-number {
  font-family: var(--font-mono);
  font-size: 24px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 12px;
}
</style>
