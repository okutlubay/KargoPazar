<template>
  <SectionLayout
    sectionId="about"
    :eyebrow="t?.about?.eyebrow"
    :title="t?.about?.title"
  >
    <div class="about-content">
      <p>{{ t?.about.p1 }}</p>
      <p>{{ t?.about.p2 }}</p>
    </div>
  </SectionLayout>
</template>

<script setup lang="ts">
import { t } from '../i18n';
import SectionLayout from './SectionLayout.vue';
</script>

<style scoped>
.about-content {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.about-content p {
  font-size: clamp(16px, 1.1vw, 18px);
  line-height: 1.7;
  color: var(--ink-2);
}
</style>
