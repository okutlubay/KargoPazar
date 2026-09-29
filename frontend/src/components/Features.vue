<script setup>
import { useI18n } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t } = useI18n()
</script>

<template>
  <section id="product" class="section">
    <div class="container">
      <SectionHeader :eyebrow="t.features.eyebrow" :title="t.features.title" :sub="t.features.sub" />
      <div class="grid">
        <div v-for="(it, i) in t.features.items" :key="i" class="feature-card">
          <div class="head">
            <div class="icon-tile">
              <Icon :name="it.icon" :size="16" />
            </div>
            <span class="mono tag">{{ it.tag }}</span>
          </div>
          <h3 class="h-3">{{ it.title }}</h3>
          <p class="desc">{{ it.desc }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: 1px;
  background: var(--line-1);
  border: 1px solid var(--line-1);
  border-radius: 16px;
  overflow: hidden;
  margin-top: 56px;
}
.feature-card {
  background: var(--surface);
  padding: 32px 28px;
  min-height: 210px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: background 0.2s;
}
.feature-card:hover { background: var(--bg-2); }
.head { display: flex; align-items: center; justify-content: space-between; }
.icon-tile {
  width: 36px; height: 36px; border-radius: 8px;
  background: var(--accent-soft); color: var(--accent-ink);
  display: flex; align-items: center; justify-content: center;
}
.tag {
  font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-4); font-weight: 500;
}
.h-3 { margin: 0; }
.desc { margin: 0; font-size: 14.5px; color: var(--ink-2); line-height: 1.55; }
@media (max-width: 560px) {
  .feature-card { padding: 24px 20px; min-height: 0; }
}
</style>
