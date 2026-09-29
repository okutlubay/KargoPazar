<script setup>
import Icon from '@/components/Icon.vue'
import Wordmark from '@/components/Wordmark.vue'
import { t, locale, setLocale } from '../i18n/index.js'

const points = [
  { icon: 'layers', key: 'p1' },
  { icon: 'spark', key: 'p2' },
  { icon: 'warehouse', key: 'p3' },
]
</script>

<template>
  <div class="auth">
    <section class="form-side">
      <div class="top">
        <a href="/" class="brand"><Wordmark /></a>
        <button class="lang mono" :aria-label="t('shell.language')" @click="setLocale(locale === 'tr' ? 'en' : 'tr')">
          <span :class="{ on: locale === 'tr' }">TR</span> / <span :class="{ on: locale === 'en' }">EN</span>
        </button>
      </div>
      <div class="form-wrap"><RouterView /></div>
      <div class="foot mono">© 2026 KargoPazar · {{ t('auth.side.teknopark') }}</div>
    </section>

    <section class="visual-side">
      <div class="grid-bg" />
      <div class="visual">
        <div class="frame">
          <div class="bar">
            <span class="d r" /><span class="d y" /><span class="d g" />
            <span class="mono url">kargopazar.com/app/#/shipments/new</span>
          </div>
          <div class="frame-body">
            <div class="mono lbl">{{ t('auth.side.frameTitle') }}</div>
            <div v-for="(r, i) in [['UPS', 'UPS Ground', '9.84', true], ['USPS', 'Ground Advantage', '8.91', false], ['FDX', 'FedEx Home Delivery', '10.62', false]]" :key="i" :class="['rrow', { rec: r[3] }]">
              <span class="logo mono">{{ r[0] }}</span>
              <span class="rname">{{ r[1] }}</span>
              <span v-if="r[3]" class="badge-ai"><Icon name="spark" :size="10" />{{ t('common.aiPick') }}</span>
              <span class="price mono">${{ r[2] }}</span>
            </div>
          </div>
        </div>
        <ul class="points">
          <li v-for="p in points" :key="p.key">
            <span class="pic"><Icon :name="p.icon" :size="15" /></span>
            <div>
              <div class="pt">{{ t(`auth.side.${p.key}`) }}</div>
              <div class="pd">{{ t(`auth.side.${p.key}d`) }}</div>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.auth { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); min-height: 100vh; background: var(--bg); }
.form-side { display: flex; flex-direction: column; padding: 28px 40px; }
.top { display: flex; justify-content: space-between; align-items: center; }
.lang { border: 1px solid var(--line-2); background: var(--surface); border-radius: 8px; height: 30px; padding: 0 10px; font-size: 11.5px; color: var(--ink-4); }
.lang .on { color: var(--ink-1); font-weight: 600; }
.form-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 0; }
.form-wrap > :deep(*) { width: 100%; max-width: 400px; }
.foot { font-size: 11px; color: var(--ink-4); }
.visual-side { position: relative; overflow: hidden; background: var(--bg-3); border-left: 1px solid var(--line-1); display: flex; align-items: center; justify-content: center; padding: 40px; }
.grid-bg { position: absolute; inset: 0; background-image: linear-gradient(var(--line-1) 1px, transparent 1px), linear-gradient(90deg, var(--line-1) 1px, transparent 1px); background-size: 32px 32px; mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%); }
.visual { position: relative; width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 28px; }
.frame { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.bar { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--line-1); background: var(--bg-2); }
.d { width: 9px; height: 9px; border-radius: 999px; } .r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
.url { margin-left: 10px; font-size: 11px; color: var(--ink-3); }
.frame-body { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.lbl { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 2px; }
.rrow { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: 10px; font-size: 13px; }
.rrow.rec { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.logo { width: 34px; height: 24px; border-radius: 6px; background: var(--ink-1); color: var(--bg); font-size: 10px; display: grid; place-items: center; font-weight: 600; }
.rname { flex: 1; font-weight: 500; }
.price { font-weight: 600; }
.points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
.points li { display: flex; gap: 12px; }
.pic { flex: none; width: 32px; height: 32px; border-radius: 9px; background: var(--surface); border: 1px solid var(--line-1); display: grid; place-items: center; color: var(--accent-ink); }
.pt { font-weight: 600; font-size: 14.5px; }
.pd { font-size: 13.5px; color: var(--ink-3); }
@media (max-width: 960px) {
  .auth { grid-template-columns: 1fr; }
  .visual-side { display: none; }
  .form-side { padding: 20px; }
}
</style>
