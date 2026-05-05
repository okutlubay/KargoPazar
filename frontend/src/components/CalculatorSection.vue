<script setup lang="ts">
import { ref, computed } from 'vue';
import { t, currentLang } from '../i18n';
import Icons from './Icons.vue';

const lang = computed(() => currentLang.value);

interface Carrier {
  code: string;
  name: string;
  baseRate: number;
  baseDays: number;
  reliability: number;
}

const COUNTRIES = [
  { code: 'TR', name: 'Türkiye', flag: '🇹🇷', origin: true },
  { code: 'US', name: 'Amerika', flag: '🇺🇸' },
  { code: 'DE', name: 'Almanya', flag: '🇩🇪' },
  { code: 'GB', name: 'Birleşik Krallık', flag: '🇬🇧' },
  { code: 'FR', name: 'Fransa', flag: '🇫🇷' },
  { code: 'NL', name: 'Hollanda', flag: '🇳🇱' },
  { code: 'AU', name: 'Avustralya', flag: '🇦🇺' },
  { code: 'CA', name: 'Kanada', flag: '🇨🇦' },
  { code: 'JP', name: 'Japonya', flag: '🇯🇵' },
  { code: 'AE', name: 'BAE', flag: '🇦🇪' },
];

const CARRIERS_BASE: Carrier[] = [
  { code: 'DHL', name: 'DHL Express', baseRate: 4.2, baseDays: 2, reliability: 98 },
  { code: 'FX', name: 'FedEx International', baseRate: 4.8, baseDays: 3, reliability: 97 },
  { code: 'UPS', name: 'UPS Worldwide', baseRate: 4.5, baseDays: 3, reliability: 96 },
  { code: 'AX', name: 'Aramex Global', baseRate: 3.0, baseDays: 5, reliability: 92 },
  { code: 'TNT', name: 'TNT Express', baseRate: 4.0, baseDays: 4, reliability: 94 },
  { code: 'PTT', name: 'PTT Yurtdışı', baseRate: 2.2, baseDays: 9, reliability: 88 },
  { code: 'USP', name: 'USPS Priority', baseRate: 2.8, baseDays: 7, reliability: 90 },
  { code: 'RM', name: "Royal Mail Int'l", baseRate: 3.2, baseDays: 6, reliability: 91 },
];

const to = ref('US');
const weight = ref(1.5);
const value = ref(120);
const type = ref('standard');
const sortBy = ref('ai');

const results = computed(() => {
  const dist = { US: 1.0, DE: 0.55, GB: 0.65, FR: 0.5, NL: 0.5, AU: 1.4, CA: 1.05, JP: 1.2, AE: 0.7 }[to.value] || 1;
  const speedMul = { economy: 0.7, standard: 1.0, express: 1.45 }[type.value as string] || 1;
  const dayMul = { economy: 1.4, standard: 1.0, express: 0.55 }[type.value as string] || 1;
  return CARRIERS_BASE.map(c => {
    const price = (c.baseRate * weight.value * dist * speedMul + 8) * (1 + (c.reliability - 90) * 0.005);
    const days = Math.max(1, Math.round(c.baseDays * dist * dayMul));
    const score = (100 - price * 0.6) + c.reliability * 0.4 - days * 0.8;
    return { ...c, price: +price.toFixed(2), days, score: +score.toFixed(1) };
  });
});

const sorted = computed(() => {
  const arr = [...results.value];
  if (sortBy.value === 'price') arr.sort((a, b) => a.price - b.price);
  else if (sortBy.value === 'speed') arr.sort((a, b) => a.days - b.days);
  else arr.sort((a, b) => b.score - a.score);
  return arr;
});

const aiPick = computed(() => sorted.value[0]);
</script>

<template>
  <section id="calc" class="section" style="background: var(--bg-2); border-top: 1px solid var(--line-1); border-bottom: 1px solid var(--line-1);">
    <div class="container">
      <div style="text-align: center; margin-bottom: 56px;">
        <div class="eyebrow">{{ t.calc.eyebrow }}</div>
        <h2 class="h-1" style="margin: 12px 0 16px;">{{ t.calc.title }}</h2>
        <p class="lede" style="margin: 0; max-width: 680px; margin-left: auto; margin-right: auto;">{{ t.calc.sub }}</p>
      </div>

      <div style="display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 24px; align-items: start;">
        <!-- Inputs -->
        <div class="card" style="padding: 24px;">
          <div class="row" style="margin-bottom: 18px; gap: 8px;">
            <span class="badge-ai">{{ lang === 'tr' ? 'Canlı' : 'Live' }}</span>
            <span style="font-size: 12.5px; color: var(--ink-3);">{{ lang === 'tr' ? 'Tahmini fiyatlar — anlık' : 'Estimated rates — live' }}</span>
          </div>

          <div class="col" style="gap: 14px;">
            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Kalkış' : 'From' }}</label>
              <div class="input row" style="gap: 10px; padding: 0 12px; color: var(--ink-2); cursor: not-allowed; background: var(--bg-2);">
                <span style="font-size: 18px;">🇹🇷</span>
                <span>{{ lang === 'tr' ? 'Türkiye' : 'Turkey' }}</span>
                <span class="mono" style="margin-left: auto; font-size: 11px; color: var(--ink-4);">{{ lang === 'tr' ? 'SABİT' : 'FIXED' }}</span>
              </div>
            </div>

            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Varış' : 'To' }}</label>
              <select class="select" v-model="to">
                <option v-for="c in COUNTRIES.filter(x => !x.origin)" :key="c.code" :value="c.code">{{ c.flag }} {{ c.name }}</option>
              </select>
            </div>

            <div class="row" style="gap: 10px;">
              <div style="flex: 1;">
                <label class="field-label">{{ lang === 'tr' ? 'Ağırlık (kg)' : 'Weight (kg)' }}</label>
                <input class="input" type="number" min="0.1" step="0.1" v-model.number="weight" />
              </div>
              <div style="flex: 1;">
                <label class="field-label">{{ lang === 'tr' ? 'Değer ($)' : 'Value ($)' }}</label>
                <input class="input" type="number" min="1" v-model.number="value" />
              </div>
            </div>

            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Hız' : 'Speed' }}</label>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden;">
                <button v-for="[k, l] in [['economy', lang === 'tr' ? 'Ekonomi' : 'Economy'], ['standard', lang === 'tr' ? 'Standart' : 'Standard'], ['express', lang === 'tr' ? 'Express' : 'Express']]" :key="k" @click="type = k as any" style="height: 38px; border: 0; font-weight: 500; font-size: 13.5px; cursor: pointer;" :style="{ background: type === k ? 'var(--ink-1)' : 'var(--surface)', color: type === k ? 'var(--bg)' : 'var(--ink-2)', fontWeight: type === k ? 600 : 500 }">{{ l }}</button>
              </div>
            </div>

            <div style="height: 1px; background: var(--line-1); margin: 8px 0;" />

            <div class="card-soft" style="padding: 14px; background: var(--accent-soft); border: 1px solid oklch(0.85 0.06 268);">
              <div class="row" style="gap: 8px; margin-bottom: 8px;">
                <span class="badge-ai">AI</span>
                <span style="font-size: 13px; font-weight: 600; color: var(--accent-ink);">{{ lang === 'tr' ? 'Önerimiz' : 'Our pick' }}: {{ aiPick.name }}</span>
              </div>
              <p style="margin: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.5;">
                {{ lang === 'tr' ? `${value}$ değerinde ${weight}kg paket için en iyi seçim. Tahmini teslim: ${aiPick.days} gün.` : `Best choice for ${weight}kg parcel at $${value}. ETA: ${aiPick.days} days.` }}
              </p>
            </div>
          </div>
        </div>

        <!-- Results -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="border: 1px solid var(--line-1); border-radius: 10px; overflow: hidden;">
            <div class="row mono" style="padding: 10px 14px; background: var(--bg-2); border-bottom: 1px solid var(--line-1); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3);">
              <div style="flex: 2;">{{ lang === 'tr' ? 'Taşıyıcı' : 'Carrier' }}</div>
              <div style="flex: 1;">{{ lang === 'tr' ? 'Süre' : 'Time' }}</div>
              <div style="flex: 1; text-align: right;">{{ lang === 'tr' ? 'Fiyat' : 'Price' }}</div>
            </div>
            <div v-for="(r, i) in sorted" :key="r.code" class="row" style="padding: 12px 14px; border-bottom: 1px solid var(--line-1); font-size: 13.5px;" :style="{ background: r.code === aiPick.code ? 'var(--accent-soft)' : 'white', borderBottom: i < sorted.length - 1 ? '1px solid var(--line-1)' : 'none' }">
              <div class="row" style="flex: 2; gap: 10px;">
                <span class="carrier-badge" :style="{ background: r.code === aiPick.code ? 'var(--accent)' : 'var(--ink-1)' }">{{ r.code }}</span>
                <span style="font-weight: 500;">{{ r.name }}</span>
              </div>
              <div style="flex: 1; color: var(--ink-2);">{{ r.days }}-{{ r.days + 1 }} {{ lang === 'tr' ? 'gün' : 'days' }}</div>
              <div class="mono" style="flex: 1; text-align: right; font-weight: 600;">${{ r.price.toFixed(2) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.carrier-badge {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
}
</style>
