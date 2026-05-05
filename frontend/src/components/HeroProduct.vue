<template>
  <div class="hero-product">
    <div class="browser-header">
      <div class="traffic-lights">
        <span class="dot" style="background: #FF5F57;"></span>
        <span class="dot" style="background: #FEBC2E;"></span>
        <span class="dot" style="background: #28C840;"></span>
      </div>
      <div class="address-bar">app.kargopazaryeri.com / shipments / new</div>
      <div style="width: 60px;"></div>
    </div>

    <div class="browser-content">
      <aside class="sidebar">
        <div class="sidebar-title">OPERASYON</div>
        <div v-for="(item, idx) in menuItems" :key="idx" class="menu-item" :class="{ active: idx === 0 }">
          <div class="menu-label">{{ item.label }}</div>
          <div class="menu-value">{{ item.value }}</div>
        </div>
      </aside>

      <main class="main-content">
        <!-- Placeholder for dashboard preview -->
        <div class="placeholder-area">
          <div class="placeholder-icon">
            <Icons name="box" :size="32" />
          </div>
          <div class="placeholder-text">Dashboard Preview</div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icons from './Icons.vue';

const menuItems = [
  { label: 'Gönderiler', value: '324', active: true },
  { label: 'Siparişler', value: '1.2k' },
  { label: 'Pazaryerleri', value: '4' },
  { label: 'Faturalar', value: '—' },
  { label: 'Müşteriler', value: '892' },
];
</script>

<style scoped>
.hero-product {
  max-width: 1100px;
  margin: 0 auto;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--line-1);
  overflow: hidden;
}

.browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-2);
  gap: 12px;
}

.traffic-lights {
  display: flex;
  gap: 6px;
}

.dot {
  width: 11px;
  height: 11px;
  border-radius: 999px;
  display: inline-block;
}

.address-bar {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-3);
  padding: 4px 10px;
  background: var(--surface);
  border-radius: 6px;
  border: 1px solid var(--line-1);
  flex: 1;
  text-align: center;
}

.browser-content {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 460px;
}

.sidebar {
  border-right: 1px solid var(--line-1);
  padding: 16px;
  background: var(--bg-2);
}

.sidebar-title {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.menu-item {
  padding: 8px 10px;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-2);
  font-weight: 500;
  font-size: 13.5px;
  margin-bottom: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.menu-item.active {
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}

.menu-label {
  margin-bottom: 2px;
}

.menu-value {
  font-size: 11px;
  opacity: 0.7;
}

.main-content {
  padding: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--ink-3);
}

.placeholder-icon {
  opacity: 0.5;
}

.placeholder-text {
  font-size: 14px;
}
</style>
