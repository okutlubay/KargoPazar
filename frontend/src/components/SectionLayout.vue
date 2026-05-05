<template>
  <section :id="sectionId" class="section">
    <div class="container">
      <div class="section-header">
        <span class="eyebrow">{{ eyebrow }}</span>
        <h2 class="h-1">{{ title }}</h2>
        <p class="lede" v-if="subtitle">{{ subtitle }}</p>
      </div>
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
interface Props {
  sectionId: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
}

defineProps<Props>();
</script>

<style scoped>
.section {
  padding: 96px 0;
  position: relative;
}

.section-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  margin-bottom: 64px;
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}

@media (max-width: 860px) {
  .section {
    padding: 72px 0;
  }
}
</style>
