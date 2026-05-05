<template>
  <SectionLayout
    sectionId="product"
    :eyebrow="t.value?.features?.eyebrow"
    :title="t.value?.features?.title"
    :subtitle="t.value?.features?.sub"
  >
    <div class="features-grid">
      <div v-for="(feature, idx) in features" :key="idx" class="feature-card">
        <div class="feature-icon">
          <Icons :name="feature.icon" :size="24" />
        </div>
        <h3 class="h-3">{{ feature.title }}</h3>
        <p class="muted">{{ feature.description }}</p>
      </div>
    </div>
  </SectionLayout>
</template>

<script setup lang="ts">
import { t } from '../i18n';
import SectionLayout from './SectionLayout.vue';
import Icons from './Icons.vue';

const features = [
  {
    icon: 'search',
    title: 'Anlık Karşılaştırma',
    description: 'Siparişler gelir gelmez 30+ taşıyıcı arasından en iyi fiyatı bulun.',
  },
  {
    icon: 'truck',
    title: 'Etiket & Belge',
    description: 'Kargo etiketi ve gümrük formları otomatik olarak hazırlanır.',
  },
  {
    icon: 'globe',
    title: 'Uluslararası',
    description: '100+ ülkeye güvenli ve hızlı gönderim için optimize edilmiş.',
  },
  {
    icon: 'lock',
    title: 'Güvenlik',
    description: 'Banka seviyesinde şifreleme ve OAuth entegrasyonu.',
  },
];
</script>

<style scoped>
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 32px;
}

.feature-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 32px;
  background: var(--surface);
  border: 1px solid var(--line-1);
  border-radius: var(--r-lg);
  transition: all 0.3s ease;
}

.feature-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
}

.feature-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  border-radius: var(--r-md);
  color: var(--accent);
}
</style>
