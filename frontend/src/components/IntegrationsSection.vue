<template>
  <SectionLayout
    sectionId="integrations"
    :eyebrow="t.value?.integrations?.eyebrow"
    :title="t.value?.integrations?.title"
    :subtitle="t.value?.integrations?.sub"
  >
    <div class="integration-card">
      <div class="integration-icon">
        <Icons name="bolt" :size="32" />
      </div>
      <h3 class="h-2">OAuth Entegrasyonu</h3>
      <p class="lede">Pazaryerlerinizle güvenli bağlantı kurun ve siparişler otomatik olarak akacak.</p>
    </div>
  </SectionLayout>
</template>

<script setup lang="ts">
import { t } from '../i18n';
import SectionLayout from './SectionLayout.vue';
import Icons from './Icons.vue';
</script>

<style scoped>
.integration-card {
  max-width: 680px;
  margin: 0 auto;
  padding: 48px;
  text-align: center;
  background: var(--bg-2);
  border: 1px solid var(--line-1);
  border-radius: var(--r-lg);
}

.integration-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  border-radius: var(--r-lg);
  color: var(--accent);
  margin: 0 auto 24px;
}
</style>
