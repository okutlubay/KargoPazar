<script setup>
import { ref, computed } from 'vue'
import { useI18n } from '../i18n.js'
import SectionHeader from './SectionHeader.vue'

const { t, lang } = useI18n()

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
]

const CARRIERS_BASE = [
  { code: 'DHL', name: 'DHL Express', baseRate: 4.2, baseDays: 2, color: '#FFCC00', ink: '#1f1f1f', reliability: 98 },
  { code: 'FX', name: 'FedEx International', baseRate: 4.8, baseDays: 3, color: '#4D148C', ink: 'white', reliability: 97 },
  { code: 'UPS', name: 'UPS Worldwide', baseRate: 4.5, baseDays: 3, color: '#351C15', ink: '#FFB500', reliability: 96 },
  { code: 'AX', name: 'Aramex Global', baseRate: 3.0, baseDays: 5, color: '#E2231A', ink: 'white', reliability: 92 },
  { code: 'TNT', name: 'TNT Express', baseRate: 4.0, baseDays: 4, color: '#FF6600', ink: 'white', reliability: 94 },
  { code: 'PTT', name: 'PTT Yurtdışı', baseRate: 2.2, baseDays: 9, color: '#FFD400', ink: '#1f1f1f', reliability: 88 },
  { code: 'USP', name: 'USPS Priority', baseRate: 2.8, baseDays: 7, color: '#004B87', ink: 'white', reliability: 90 },
  { code: 'RM', name: "Royal Mail Int'l", baseRate: 3.2, baseDays: 6, color: '#E10A0A', ink: 'white', reliability: 91 },
]

const to = ref('US')
const weight = ref(1.5)
const value = ref(120)
const type = ref('standard')
const sortBy = ref('ai')

const destinations = computed(() => COUNTRIES.filter(c => !c.origin))

const results = computed(() => {
  const dist = ({ US: 1.0, DE: 0.55, GB: 0.65, FR: 0.5, NL: 0.5, AU: 1.4, CA: 1.05, JP: 1.2, AE: 0.7 })[to.value] || 1
  const speedMul = ({ economy: 0.7, standard: 1.0, express: 1.45 })[type.value]
  const dayMul = ({ economy: 1.4, standard: 1.0, express: 0.55 })[type.value]
  return CARRIERS_BASE.map(c => {
    const price = (c.baseRate * weight.value * dist * speedMul + 8) * (1 + (c.reliability - 90) * 0.005)
    const days = Math.max(1, Math.round(c.baseDays * dist * dayMul))
    const score = (100 - price * 0.6) + c.reliability * 0.4 - days * 0.8
    return { ...c, price: +price.toFixed(2), days, score: +score.toFixed(1) }
  })
})

const sorted = computed(() => {
  const arr = [...results.value]
  if (sortBy.value === 'price') arr.sort((a, b) => a.price - b.price)
  else if (sortBy.value === 'speed') arr.sort((a, b) => a.days - b.days)
  else arr.sort((a, b) => b.score - a.score)
  return arr
})

const cheapest = computed(() => results.value.reduce((m, c) => c.price < m.price ? c : m, results.value[0]))
const fastest = computed(() => results.value.reduce((m, c) => c.days < m.days ? c : m, results.value[0]))
const aiPick = computed(() => sorted.value[0])

const speedOptions = computed(() => [
  ['economy', lang.value === 'tr' ? 'Ekonomi' : 'Economy'],
  ['standard', lang.value === 'tr' ? 'Standart' : 'Standard'],
  ['express', 'Express'],
])

const sortOptions = computed(() => [
  ['ai', 'AI'],
  ['price', lang.value === 'tr' ? 'Fiyat' : 'Price'],
  ['speed', lang.value === 'tr' ? 'Hız' : 'Speed'],
])

const daysBarColor = (d) => {
  const pct = Math.min(1, d / 12)
  if (pct < 0.3) return 'var(--success)'
  if (pct < 0.6) return 'var(--accent)'
  return 'var(--ink-3)'
}
const daysBarPct = (d) => Math.min(1, d / 12) * 100
</script>

<template>
  <section id="calc" class="section calc-section">
    <div class="container">
      <SectionHeader :eyebrow="t.calc.eyebrow" :title="t.calc.title" :sub="t.calc.sub" />

      <div class="layout">
        <!-- Inputs -->
        <div class="card inputs">
          <div class="row" style="margin-bottom: 18px; gap: 8px">
            <span class="badge-ai">{{ lang === 'tr' ? 'Canlı' : 'Live' }}</span>
            <span class="hint">{{ lang === 'tr' ? 'Tahmini fiyatlar — anlık' : 'Estimated rates — live' }}</span>
          </div>

          <div class="fields">
            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Kalkış' : 'From' }}</label>
              <div class="input from-fixed">
                <span style="font-size: 18px">🇹🇷</span>
                <span>Türkiye</span>
                <span class="mono fixed-tag">{{ lang === 'tr' ? 'SABİT' : 'FIXED' }}</span>
              </div>
            </div>

            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Varış' : 'To' }}</label>
              <select class="select" v-model="to">
                <option v-for="c in destinations" :key="c.code" :value="c.code">{{ c.flag }} {{ c.name }}</option>
              </select>
            </div>

            <div class="row" style="gap: 10px">
              <div style="flex: 1">
                <label class="field-label">{{ lang === 'tr' ? 'Ağırlık (kg)' : 'Weight (kg)' }}</label>
                <input class="input" type="number" min="0.1" step="0.1" v-model.number="weight" />
              </div>
              <div style="flex: 1">
                <label class="field-label">{{ lang === 'tr' ? 'Değer ($)' : 'Value ($)' }}</label>
                <input class="input" type="number" min="1" v-model.number="value" />
              </div>
            </div>

            <div>
              <label class="field-label">{{ lang === 'tr' ? 'Hız' : 'Speed' }}</label>
              <div class="seg">
                <button
                  v-for="[k, l] in speedOptions"
                  :key="k"
                  :class="{ active: type === k }"
                  @click="type = k"
                >{{ l }}</button>
              </div>
            </div>

            <div class="hr" />

            <div class="ai-pick">
              <div class="row" style="gap: 8px; margin-bottom: 8px">
                <span class="badge-ai">AI</span>
                <span class="ai-pick-name">{{ lang === 'tr' ? 'Önerimiz' : 'Our pick' }}: {{ aiPick.name }}</span>
              </div>
              <p class="ai-pick-desc">
                <template v-if="lang === 'tr'">
                  {{ value }}$ değerinde {{ weight }}kg paket için fiyat/süre/güvenilirlik dengesinde en iyi seçim. Tahmini teslim: {{ aiPick.days }} gün.
                </template>
                <template v-else>
                  Best balance of price/speed/reliability for a {{ weight }}kg parcel valued at ${{ value }}. ETA: {{ aiPick.days }} days.
                </template>
              </p>
            </div>
          </div>
        </div>

        <!-- Results -->
        <div class="card results">
          <div class="results-head">
            <div class="row" style="gap: 16px">
              <div class="stat">
                <span class="mono lbl">{{ lang === 'tr' ? 'En ucuz' : 'Cheapest' }}</span>
                <span class="val">${{ cheapest.price.toFixed(2) }}</span>
                <span class="sub">{{ cheapest.name }}</span>
              </div>
              <div class="stat">
                <span class="mono lbl">{{ lang === 'tr' ? 'En hızlı' : 'Fastest' }}</span>
                <span class="val">{{ fastest.days }} {{ lang === 'tr' ? 'gün' : 'days' }}</span>
                <span class="sub">{{ fastest.name }}</span>
              </div>
              <div class="stat">
                <span class="mono lbl">{{ lang === 'tr' ? 'Sonuç' : 'Results' }}</span>
                <span class="val">{{ results.length }}</span>
                <span class="sub">{{ lang === 'tr' ? 'taşıyıcı' : 'carriers' }}</span>
              </div>
            </div>
            <div class="sort">
              <button
                v-for="[k, l] in sortOptions"
                :key="k"
                :class="{ active: sortBy === k }"
                @click="sortBy = k"
              >{{ l }}</button>
            </div>
          </div>

          <div>
            <div
              v-for="c in sorted"
              :key="c.code"
              :class="['carrier-row', { isAI: c.code === aiPick.code && sortBy === 'ai' }]"
            >
              <div class="row" style="gap: 12px; flex: 0 0 auto; width: 200px">
                <span class="brand" :style="{ background: c.color, color: c.ink }">{{ c.code }}</span>
                <div class="col" style="gap: 2px">
                  <span class="brand-name">{{ c.name }}</span>
                  <span class="reliability">{{ c.reliability }}% {{ lang === 'tr' ? 'güvenilirlik' : 'reliability' }}</span>
                </div>
              </div>
              <div style="flex: 1">
                <div class="row" style="gap: 8px">
                  <span class="days-num">{{ c.days }} {{ lang === 'tr' ? 'gün' : 'days' }}</span>
                  <div class="days-bar">
                    <div class="days-fill" :style="{ width: daysBarPct(c.days) + '%', background: daysBarColor(c.days) }" />
                  </div>
                </div>
              </div>
              <div class="row" style="gap: 8px; flex: 0 0 auto">
                <span v-if="c.code === aiPick.code && sortBy === 'ai'" class="badge-ai">AI ÖNERİ</span>
                <span class="price">${{ c.price.toFixed(2) }}</span>
                <button :class="['btn', 'btn-sm', c.code === aiPick.code && sortBy === 'ai' ? 'pick-ai' : 'pick-default']">
                  {{ lang === 'tr' ? 'Seç' : 'Select' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calc-section { background: var(--bg-2); border-top: 1px solid var(--line-1); border-bottom: 1px solid var(--line-1); }
.layout {
  margin-top: 56px;
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 24px;
  align-items: start;
}
.inputs { padding: 24px; }
.hint { font-size: 12.5px; color: var(--ink-3); }
.fields { display: flex; flex-direction: column; gap: 14px; }
.from-fixed {
  display: flex; align-items: center; gap: 10px;
  padding: 0 12px; color: var(--ink-2); cursor: not-allowed; background: var(--bg-2);
}
.fixed-tag { margin-left: auto; font-size: 11px; color: var(--ink-4); }
.seg {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden;
}
.seg button {
  height: 38px; border: 0;
  background: var(--surface); color: var(--ink-2);
  font-weight: 500; font-size: 13.5px;
}
.seg button.active { background: var(--ink-1); color: var(--bg); font-weight: 600; }
.hr { height: 1px; background: var(--line-1); margin: 8px 0; }
.ai-pick {
  padding: 14px; background: var(--accent-soft);
  border: 1px solid oklch(0.85 0.06 268); border-radius: var(--r-lg);
}
.ai-pick-name { font-size: 13px; font-weight: 600; color: var(--accent-ink); }
.ai-pick-desc { margin: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }

.results { overflow: hidden; }
.results-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--line-1);
}
.stat { display: flex; flex-direction: column; gap: 1px; }
.stat .lbl { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-4); }
.stat .val { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
.stat .sub { font-size: 11px; color: var(--ink-3); }
.sort {
  display: flex; align-items: center; gap: 4px;
  padding: 2px; background: var(--bg-2);
  border-radius: 8px; border: 1px solid var(--line-2);
}
.sort button {
  height: 26px; padding: 0 12px; border-radius: 6px; border: 0;
  font-size: 12px; font-weight: 600;
  background: transparent; color: var(--ink-2);
}
.sort button.active { background: var(--ink-1); color: var(--bg); }

.carrier-row {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 20px; border-bottom: 1px solid var(--line-1);
  transition: background 0.15s;
}
.carrier-row.isAI { background: linear-gradient(to right, var(--accent-soft), transparent); }
.brand {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
}
.brand-name { font-size: 14px; font-weight: 600; }
.reliability { font-size: 11.5px; color: var(--ink-3); }
.days-num { font-size: 14px; font-weight: 500; }
.days-bar {
  flex: 1; max-width: 120px; height: 4px; border-radius: 999px;
  background: var(--line-1); position: relative; overflow: hidden;
}
.days-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  border-radius: 999px;
}
.price {
  font-family: var(--font-display); font-size: 18px; font-weight: 600;
  min-width: 70px; text-align: right;
}
.pick-default { background: var(--ink-1); color: white; }
.pick-ai { background: var(--accent); color: white; }
</style>
