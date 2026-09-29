<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import RouteMap from './RouteMap.vue'

const { t } = useI18n()
const titleLines = computed(() => t.value.ai.title.split('\n'))
</script>

<template>
  <section id="ai" class="ai-section">
    <div class="grid-bg" />
    <div class="glow" />

    <div class="container inner">
      <div class="layout">
        <div class="left">
          <div class="eyebrow accent">{{ t.ai.eyebrow }}</div>
          <h2 class="h-1 light-title">
            <template v-for="(line, i) in titleLines" :key="i">
              {{ line }}<br v-if="i < titleLines.length - 1" />
            </template>
          </h2>
          <p class="lede sub">{{ t.ai.sub }}</p>
          <RouteMap />
        </div>

        <div class="right">
          <div class="row table-head">
            <span class="mono">{{ t.ai.colModule }}</span>
            <span class="mono">{{ t.ai.colIo }}</span>
          </div>
          <div
            v-for="(m, i) in t.ai.modules"
            :key="m.code"
            class="module fade-up"
            :style="{ animationDelay: `${i * 0.06}s` }"
          >
            <div class="row" style="gap: 12px; align-items: flex-start">
              <span class="mono code">{{ m.code }}</span>
              <div class="col" style="flex: 1; gap: 3px; min-width: 0">
                <span class="m-name">{{ m.name }}</span>
                <span class="m-desc">{{ m.desc }}</span>
              </div>
            </div>
            <div class="io mono">
              <span class="io-in">{{ m.input }}</span>
              <span class="io-arrow" aria-hidden="true">→</span>
              <span class="io-out">{{ m.output }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-section {
  padding: 96px 0;
  position: relative;
  overflow: hidden;
  background: var(--ink-1);
  color: var(--bg);
}
.grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 64px 64px;
  -webkit-mask-image: radial-gradient(ellipse 80% 80% at 30% 50%, black 30%, transparent 75%);
          mask-image: radial-gradient(ellipse 80% 80% at 30% 50%, black 30%, transparent 75%);
}
.glow {
  position: absolute; top: -100px; right: -100px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, oklch(0.55 0.18 268 / 0.4), transparent 60%);
}
.inner { position: relative; z-index: 1; }
.layout { display: grid; grid-template-columns: 1.05fr 1fr; gap: 48px; align-items: start; }
.left { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.eyebrow.accent { color: oklch(0.78 0.10 268); }
.light-title { margin: 0; color: var(--bg); }
.sub { margin: 0; color: oklch(0.78 0.01 265); }

.right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.table-head {
  justify-content: space-between;
  padding: 0 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.table-head span {
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: oklch(0.65 0.01 265);
}
.module {
  padding: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.025);
  display: flex; flex-direction: column; gap: 10px;
}
.code {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  padding: 3px 7px; border-radius: 4px;
  background: var(--accent); color: white;
  flex: 0 0 auto; min-width: 46px; text-align: center; margin-top: 1px;
}
.m-name { font-size: 14px; font-weight: 600; color: var(--bg); }
.m-desc { font-size: 12.5px; color: oklch(0.72 0.008 265); line-height: 1.45; }
.io {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px;
  margin-left: 58px; font-size: 11px;
}
.io-in, .io-out {
  padding: 3px 8px; border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.io-in { color: oklch(0.8 0.01 265); }
.io-out { color: oklch(0.88 0.09 268); border-color: oklch(0.6 0.12 268 / 0.5); background: oklch(0.52 0.18 268 / 0.18); }
.io-arrow { color: oklch(0.7 0.1 268); }

@media (max-width: 960px) {
  .ai-section { padding: 72px 0; }
  .layout { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .io { margin-left: 0; }
}
</style>
