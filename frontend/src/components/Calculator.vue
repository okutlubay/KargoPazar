<script setup>
import { ref, computed, watch, inject, onUnmounted } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, lang, f, money, num } = useI18n()
const pricing = inject('kpzPricing')

const origin = ref('NJ01')
const zip = ref('78701')
const weight = ref(2)
const dims = ref({ l: 10, w: 8, h: 4 })
const speed = ref('standard')
const sortBy = ref('ai')
const touched = ref({ zip: false, weight: false, dims: false })

const countryName = (c) => (c.name && (c.name[lang.value] || c.name.en)) || c.code
const fmOrigins = computed(() => pricing.originCountries())
const isFirstMile = computed(() => origin.value.startsWith('fm:'))
const fmCode = computed(() => (isFirstMile.value ? origin.value.slice(3) : null))
const fmCountry = computed(() => fmOrigins.value.find((c) => c.code === fmCode.value) || null)

// A market removed in the panel falls back to NJ01.
watch(fmOrigins, (list) => {
  if (isFirstMile.value && !list.some((c) => c.code === fmCode.value)) origin.value = 'NJ01'
})

// --- validation ---------------------------------------------------------
const zipInfo = computed(() => pricing.lookupZip(zip.value))
const zipError = computed(() => {
  if (zipInfo.value.status === 'format') return t.value.calc.errors.zipFormat
  if (zipInfo.value.status === 'unknown') return t.value.calc.errors.zipUnknown
  return null
})
const weightError = computed(() => {
  const w = Number(weight.value)
  return !Number.isFinite(w) || w < 0.1 || w > 150 ? t.value.calc.errors.weight : null
})
const dimsError = computed(() => {
  const ok = ['l', 'w', 'h'].every((k) => {
    const v = Number(dims.value[k])
    return Number.isFinite(v) && v >= 1 && v <= 108
  })
  return ok ? null : t.value.calc.errors.dims
})
const valid = computed(() => !zipError.value && !weightError.value && !dimsError.value)
const showZipError = computed(() => zipError.value && (touched.value.zip || String(zip.value).length >= 5))

const pkg = computed(() => ({
  lengthIn: Number(dims.value.l),
  widthIn: Number(dims.value.w),
  heightIn: Number(dims.value.h),
  weightLb: Number(weight.value),
}))

const onZipInput = (e) => {
  const v = String(e.target.value || '').replace(/\D/g, '').slice(0, 5)
  zip.value = v
  if (e.target.value !== v) e.target.value = v
}

// --- short "calculating" state so every change feels like a live request ---
const busy = ref(false)
let busyTimer = null
watch([origin, zip, weight, dims, speed], () => {
  busy.value = true
  clearTimeout(busyTimer)
  busyTimer = setTimeout(() => { busy.value = false }, 260)
}, { deep: true })
onUnmounted(() => clearTimeout(busyTimer))

// --- domestic quotes ------------------------------------------------------
const allQuotes = computed(() => {
  if (!valid.value || isFirstMile.value) return []
  return pricing.quoteDomestic({ hub: origin.value, zip: zipInfo.value.zip, state: zipInfo.value.state, pkg: pkg.value })
})
const quotes = computed(() => allQuotes.value.filter((q) => q.level === speed.value))
const ranked = computed(() => pricing.rankQuotes(quotes.value))
const aiPick = computed(() => (ranked.value.length ? ranked.value[0].quote : null))
const sorted = computed(() => {
  if (sortBy.value === 'ai') return ranked.value.map((r) => r.quote)
  const arr = [...quotes.value]
  if (sortBy.value === 'price') arr.sort((a, b) => a.total - b.total || a.etaDays - b.etaDays)
  else arr.sort((a, b) => a.etaDays - b.etaDays || a.total - b.total)
  return arr
})
const cheapest = computed(() => (quotes.value.length ? quotes.value.reduce((m, q) => (q.total < m.total ? q : m)) : null))
const fastest = computed(() => (quotes.value.length ? quotes.value.reduce((m, q) => (q.etaDays < m.etaDays || (q.etaDays === m.etaDays && q.total < m.total) ? q : m)) : null))

const hubSuggestion = computed(() => {
  if (!valid.value || isFirstMile.value) return null
  const best = pricing.bestHub(zipInfo.value.zip)
  if (best.hub === origin.value) return null
  return { hub: best.hub, zone: best.zone, current: best.zones[origin.value] }
})

// --- first mile -----------------------------------------------------------
const fmQuote = computed(() => {
  if (!valid.value || !isFirstMile.value) return null
  return pricing.quoteFirstMile({ origin: fmCode.value, zip: zipInfo.value.zip, state: zipInfo.value.state, pkg: pkg.value })
})

const speedOptions = computed(() => ['economy', 'standard', 'express'].map((k) => [k, t.value.calc.speeds[k]]))
const sortOptions = computed(() => ['ai', 'price', 'speed'].map((k) => [k, t.value.calc.sort[k]]))
const brand = (code) => pricing.carrierMeta(code)
const brandLabel = (code) => ({ FDX: 'FDX', UPS: 'UPS', USPS: 'USPS', DHLE: 'DHL', ONT: 'ONT', LSO: 'LSO' })[code] || code

const daysBarPct = (d) => Math.min(1, d / 8) * 100
const daysBarColor = (d) => (d <= 2 ? 'var(--success)' : d <= 4 ? 'var(--accent)' : 'var(--ink-3)')
</script>

<template>
  <section id="calc" class="section calc-section">
    <div class="container">
      <SectionHeader :eyebrow="t.calc.eyebrow" :title="t.calc.title" :sub="t.calc.sub" />

      <div class="layout">
        <!-- Inputs -->
        <form class="card inputs" novalidate @submit.prevent>
          <div class="row" style="margin-bottom: 18px; gap: 8px">
            <span class="badge-ai"><span class="live-dot" />{{ t.calc.live }}</span>
            <span class="hint">{{ t.calc.liveHint }}</span>
          </div>

          <div class="fields">
            <div>
              <label class="field-label" for="calc-origin">{{ t.calc.origin }}</label>
              <select id="calc-origin" v-model="origin" class="select">
                <optgroup :label="t.calc.groupHubs">
                  <option value="NJ01">{{ t.calc.originHub.NJ01 }}</option>
                  <option value="LA01">{{ t.calc.originHub.LA01 }}</option>
                </optgroup>
                <optgroup :label="t.calc.groupFm">
                  <option v-for="c in fmOrigins" :key="c.code" :value="'fm:' + c.code">
                    {{ f(t.calc.originFm, { name: countryName(c) }) }}{{ c.isNewMarket ? ' (' + t.calc.newMarket + ')' : '' }}
                  </option>
                </optgroup>
              </select>
            </div>

            <div>
              <label class="field-label" for="calc-zip">{{ t.calc.zip }}</label>
              <input
                id="calc-zip"
                class="input mono"
                :class="{ invalid: showZipError }"
                :value="zip"
                inputmode="numeric"
                autocomplete="postal-code"
                maxlength="5"
                :placeholder="t.calc.zipPh"
                :aria-invalid="!!showZipError"
                aria-describedby="calc-zip-help"
                @input="onZipInput"
                @blur="touched.zip = true"
              />
              <div id="calc-zip-help" class="help" aria-live="polite">
                <span v-if="showZipError" class="err"><Icon name="alert" :size="12" /> {{ zipError }}</span>
                <span v-else-if="zipInfo.status === 'city'" class="ok"><Icon name="pin" :size="12" /> {{ f(t.calc.zipFound, zipInfo) }}</span>
                <span v-else-if="zipInfo.status === 'state'" class="ok"><Icon name="pin" :size="12" /> {{ f(t.calc.zipStateOnly, zipInfo) }}</span>
              </div>
            </div>

            <div>
              <label class="field-label" for="calc-weight">{{ t.calc.weight }}</label>
              <input
                id="calc-weight"
                v-model.number="weight"
                class="input"
                :class="{ invalid: weightError && touched.weight }"
                type="number"
                min="0.1"
                max="150"
                step="0.1"
                :aria-invalid="!!weightError"
                @blur="touched.weight = true"
                @input="touched.weight = true"
              />
              <div v-if="weightError && touched.weight" class="help"><span class="err"><Icon name="alert" :size="12" /> {{ weightError }}</span></div>
            </div>

            <div>
              <label class="field-label">{{ t.calc.dims }}</label>
              <div class="dims">
                <input v-model.number="dims.l" class="input" :class="{ invalid: dimsError && touched.dims }" type="number" min="1" max="108" step="0.5" :aria-label="t.calc.dimL" :placeholder="t.calc.dimL" @input="touched.dims = true" @blur="touched.dims = true" />
                <span class="x">×</span>
                <input v-model.number="dims.w" class="input" :class="{ invalid: dimsError && touched.dims }" type="number" min="1" max="108" step="0.5" :aria-label="t.calc.dimW" :placeholder="t.calc.dimW" @input="touched.dims = true" @blur="touched.dims = true" />
                <span class="x">×</span>
                <input v-model.number="dims.h" class="input" :class="{ invalid: dimsError && touched.dims }" type="number" min="1" max="108" step="0.5" :aria-label="t.calc.dimH" :placeholder="t.calc.dimH" @input="touched.dims = true" @blur="touched.dims = true" />
              </div>
              <div v-if="dimsError && touched.dims" class="help"><span class="err"><Icon name="alert" :size="12" /> {{ dimsError }}</span></div>
            </div>

            <div>
              <label class="field-label">{{ t.calc.speed }}</label>
              <div :class="['seg', { disabled: isFirstMile }]" role="radiogroup" :aria-label="t.calc.speed">
                <button
                  v-for="[k, l] in speedOptions"
                  :key="k"
                  type="button"
                  role="radio"
                  :aria-checked="speed === k"
                  :disabled="isFirstMile"
                  :class="{ active: speed === k && !isFirstMile }"
                  @click="speed = k"
                >{{ l }}</button>
              </div>
              <div v-if="isFirstMile" class="help"><span class="muted-note">{{ t.calc.speedFmNote }}</span></div>
            </div>

            <div v-if="hubSuggestion" class="hub-hint">
              <Icon name="route" :size="14" />
              <span>{{ f(t.calc.hubHint, hubSuggestion) }}</span>
              <button type="button" class="btn btn-ghost btn-sm" @click="origin = hubSuggestion.hub">{{ f(t.calc.hubApply, hubSuggestion) }}</button>
            </div>

            <div class="hr" />

            <div v-if="aiPick && !isFirstMile" class="ai-pick">
              <div class="row" style="gap: 8px; margin-bottom: 8px">
                <span class="badge-ai">AI</span>
                <span class="ai-pick-name">{{ t.calc.aiPick }}: {{ aiPick.serviceName }}</span>
              </div>
              <p class="ai-pick-desc">{{ f(t.calc.aiDesc, { days: aiPick.etaDays }) }}</p>
            </div>
            <p class="engine-note">{{ t.calc.engineNote }}</p>
          </div>
        </form>

        <!-- Results -->
        <div class="card results" aria-live="polite">
          <!-- invalid input -->
          <div v-if="!valid" class="empty">
            <span class="empty-ico"><Icon name="info" :size="20" /></span>
            <div class="empty-title">{{ t.calc.invalidTitle }}</div>
            <p class="empty-desc">{{ t.calc.invalidDesc }}</p>
          </div>

          <!-- first mile: single line -->
          <template v-else-if="isFirstMile && fmQuote">
            <div class="results-head">
              <div class="row stats">
                <div class="stat">
                  <span class="mono lbl">{{ t.calc.fmTitle }}</span>
                  <span class="val">{{ money(fmQuote.total) }}</span>
                  <span class="sub">{{ f(t.calc.fmEta, { days: fmQuote.etaDays }) }}</span>
                </div>
              </div>
            </div>
            <div v-if="busy" class="skeletons"><div class="sk" /></div>
            <div v-else class="carrier-row fm-row">
              <div class="row fm-main">
                <span class="brand fm-brand"><Icon name="plane" :size="16" /></span>
                <div class="col" style="gap: 2px; min-width: 0">
                  <span class="brand-name">{{ t.calc.fmTitle }}</span>
                  <span class="reliability">{{ f(t.calc.fmSub, { origin: fmCountry ? countryName(fmCountry) : fmCode, hub: fmQuote.destHub }) }}</span>
                  <span class="breakdown mono">
                    <template v-for="(it, i) in fmQuote.items" :key="it.code">
                      <span v-if="i" class="sep">·</span>{{ t.calc.fmBreakdown[it.code] }} {{ money(it.amount) }}
                    </template>
                    <span class="sep">·</span>{{ f(t.calc.fmKg, { kg: num(fmQuote.chargeableKg, 1) }) }}
                  </span>
                </div>
              </div>
              <div class="row row-right">
                <span class="price">{{ money(fmQuote.total) }}</span>
                <a :href="APP_LINKS.signup" class="btn btn-sm pick-ai">{{ t.calc.select }}</a>
              </div>
            </div>
          </template>

          <!-- domestic -->
          <template v-else>
            <div class="results-head">
              <div class="row stats">
                <div class="stat">
                  <span class="mono lbl">{{ t.calc.cheapest }}</span>
                  <span class="val">{{ cheapest ? money(cheapest.total) : '-' }}</span>
                  <span class="sub">{{ cheapest ? cheapest.serviceName : '-' }}</span>
                </div>
                <div class="stat">
                  <span class="mono lbl">{{ t.calc.fastest }}</span>
                  <span class="val">{{ fastest ? f(fastest.etaDays === 1 ? t.common.day : t.common.days, { n: fastest.etaDays }) : '-' }}</span>
                  <span class="sub">{{ fastest ? fastest.serviceName : '-' }}</span>
                </div>
                <div class="stat">
                  <span class="mono lbl">{{ t.calc.results }}</span>
                  <span class="val">{{ quotes.length }}</span>
                  <span class="sub">{{ t.calc.servicesUnit }}</span>
                </div>
              </div>
              <div class="sort" role="group" :aria-label="t.calc.sortLabel">
                <button
                  v-for="[k, l] in sortOptions"
                  :key="k"
                  type="button"
                  :class="{ active: sortBy === k }"
                  :aria-pressed="sortBy === k"
                  @click="sortBy = k"
                >{{ l }}</button>
              </div>
            </div>

            <div v-if="busy" class="skeletons">
              <div v-for="i in Math.max(3, Math.min(quotes.length, 6))" :key="i" class="sk" />
            </div>
            <div v-else-if="!quotes.length" class="empty">
              <span class="empty-ico"><Icon name="filter" :size="20" /></span>
              <div class="empty-title">{{ t.calc.emptyTitle }}</div>
              <p class="empty-desc">{{ t.calc.emptyDesc }}</p>
              <button v-if="allQuotes.length" type="button" class="btn btn-ghost btn-sm" @click="speed = allQuotes[0].level">{{ t.calc.showAll }}</button>
            </div>
            <div v-else>
              <div
                v-for="q in sorted"
                :key="q.key"
                :class="['carrier-row', { isAI: aiPick && q.key === aiPick.key && sortBy === 'ai' }]"
              >
                <div class="row carrier-cell">
                  <span class="brand" :style="{ background: brand(q.carrierCode).color, color: brand(q.carrierCode).ink }">{{ brandLabel(q.carrierCode) }}</span>
                  <div class="col" style="gap: 2px; min-width: 0">
                    <span class="brand-name">{{ q.serviceName }}</span>
                    <span class="reliability">{{ f(t.calc.rowMeta, { zone: q.zone, lb: q.billableLb }) }}</span>
                  </div>
                </div>
                <div class="days-cell">
                  <div class="row" style="gap: 8px">
                    <span class="days-num">{{ f(q.etaDays === 1 ? t.common.day : t.common.days, { n: q.etaDays }) }}</span>
                    <div class="days-bar">
                      <div class="days-fill" :style="{ width: daysBarPct(q.etaDays) + '%', background: daysBarColor(q.etaDays) }" />
                    </div>
                  </div>
                </div>
                <div class="row row-right">
                  <span v-if="aiPick && q.key === aiPick.key" class="badge-ai ai-tag">{{ t.calc.aiBadge }}</span>
                  <span class="price">{{ money(q.total) }}</span>
                  <a :href="APP_LINKS.signup" :class="['btn', 'btn-sm', aiPick && q.key === aiPick.key ? 'pick-ai' : 'pick-default']">{{ t.calc.select }}</a>
                </div>
              </div>
            </div>
          </template>

          <div class="signup-bar">
            <div class="col" style="gap: 2px">
              <span class="signup-note">{{ t.calc.signupNote }}</span>
            </div>
            <a :href="APP_LINKS.signup" class="btn btn-accent">{{ t.calc.signupCta }} <Icon name="arrow" /></a>
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
.live-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--success); }
.fields { display: flex; flex-direction: column; gap: 14px; }
.input.invalid { border-color: var(--danger); }
.input.invalid:focus { box-shadow: 0 0 0 3px oklch(0.58 0.18 25 / 0.15); }
.help { min-height: 18px; margin-top: 5px; font-size: 12px; }
.help .err { color: var(--danger); display: inline-flex; align-items: center; gap: 5px; }
.help .ok { color: var(--ink-2); display: inline-flex; align-items: center; gap: 5px; }
.muted-note { color: var(--ink-3); }
.dims { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; gap: 6px; }
.dims .input { padding: 0 8px; text-align: center; }
.x { color: var(--ink-4); font-size: 13px; }
.seg {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden;
}
.seg button {
  height: 38px; border: 0; cursor: pointer;
  background: var(--surface); color: var(--ink-2);
  font-weight: 500; font-size: 13.5px;
}
.seg button + button { border-left: 1px solid var(--line-1); }
.seg button.active { background: var(--ink-1); color: var(--bg); font-weight: 600; }
.seg.disabled button { cursor: not-allowed; color: var(--ink-4); background: var(--bg-2); }
.hub-hint {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 12px; border-radius: var(--r-md);
  background: var(--bg-2); border: 1px dashed var(--line-2);
  font-size: 12.5px; color: var(--ink-2);
}
.hub-hint span { flex: 1; min-width: 160px; }
.hr { height: 1px; background: var(--line-1); margin: 4px 0; }
.ai-pick {
  padding: 14px; background: var(--accent-soft);
  border: 1px solid oklch(0.85 0.06 268); border-radius: var(--r-lg);
}
.ai-pick-name { font-size: 13px; font-weight: 600; color: var(--accent-ink); }
.ai-pick-desc { margin: 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
.engine-note { margin: 0; font-size: 11.5px; color: var(--ink-3); line-height: 1.5; }

.results { overflow: hidden; display: flex; flex-direction: column; }
.results-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 16px 20px; border-bottom: 1px solid var(--line-1);
}
.stats { gap: 24px; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.stat .lbl { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-4); }
.stat .val { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
.stat .sub { font-size: 11px; color: var(--ink-3); }
.sort {
  display: flex; align-items: center; gap: 4px;
  padding: 2px; background: var(--bg-2);
  border-radius: 8px; border: 1px solid var(--line-2);
}
.sort button {
  height: 26px; padding: 0 12px; border-radius: 6px; border: 0; cursor: pointer;
  font-size: 12px; font-weight: 600;
  background: transparent; color: var(--ink-2);
}
.sort button.active { background: var(--ink-1); color: var(--bg); }

.carrier-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; border-bottom: 1px solid var(--line-1);
  transition: background 0.15s;
}
.carrier-row.isAI { background: linear-gradient(to right, var(--accent-soft), transparent); }
.carrier-cell { gap: 12px; flex: 0 0 auto; width: 250px; min-width: 0; }
.days-cell { flex: 1; min-width: 0; }
.row-right { gap: 8px; flex: 0 0 auto; margin-left: auto; }
.brand {
  width: 36px; height: 36px; border-radius: 8px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em;
}
.fm-brand { background: var(--accent); color: white; }
.brand-name { font-size: 14px; font-weight: 600; }
.reliability { font-size: 11.5px; color: var(--ink-3); }
.fm-row { align-items: flex-start; }
.fm-main { gap: 12px; align-items: flex-start; flex: 1; min-width: 0; }
.breakdown { font-size: 11px; color: var(--ink-3); line-height: 1.6; margin-top: 4px; }
.sep { margin: 0 6px; color: var(--ink-4); }
.days-num { font-size: 14px; font-weight: 500; white-space: nowrap; }
.days-bar {
  flex: 1; max-width: 120px; height: 4px; border-radius: 999px;
  background: var(--line-1); position: relative; overflow: hidden;
}
.days-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; }
.ai-tag { height: 22px; font-size: 10px; }
.price {
  font-family: var(--font-display); font-size: 18px; font-weight: 600;
  min-width: 78px; text-align: right; white-space: nowrap;
}
.pick-default { background: var(--ink-1); color: white; }
.pick-ai { background: var(--accent); color: white; }

.skeletons { padding: 8px 20px; display: flex; flex-direction: column; gap: 10px; }
.sk {
  height: 52px; border-radius: 10px;
  background: linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%);
  background-size: 200% 100%; animation: shimmer 1s linear infinite;
}
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 48px 24px; }
.empty-ico { width: 44px; height: 44px; border-radius: 12px; background: var(--bg-3); color: var(--ink-2); display: flex; align-items: center; justify-content: center; }
.empty-title { font-weight: 600; font-size: 15px; }
.empty-desc { margin: 0; font-size: 13px; color: var(--ink-3); max-width: 360px; }

.signup-bar {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 16px 20px; margin-top: auto; background: var(--bg-2); border-top: 1px solid var(--line-1);
}
.signup-note { font-size: 12.5px; color: var(--ink-3); }

@media (max-width: 960px) {
  .layout { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .carrier-row { flex-wrap: wrap; padding: 14px 16px; }
  .carrier-cell { width: auto; flex: 1 1 100%; }
  .days-cell { flex: 1 1 auto; }
  .results-head { padding: 14px 16px; }
  .stats { gap: 16px; }
  .ai-tag { display: none; }
  .signup-bar .btn { width: 100%; justify-content: center; white-space: normal; height: auto; min-height: 40px; padding: 8px 14px; }
}
</style>
