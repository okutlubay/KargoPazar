<script setup>
import { shallowRef, provide, onMounted, onUnmounted } from 'vue'
import { provideI18n } from './i18n.js'
import { rateShop, zoneFor, firstMileQuote, round2 } from './shared/rateEngine.js'
import carriersSeed from './app/data/seed/carriers.json'
import rateCardsSeed from './app/data/seed/rate_cards.json'
import countriesSeed from './app/data/seed/countries.json'
import userSeed from './app/data/seed/user.json'
import zipCitySeed from './app/data/seed/zip_city.json'
import zip3StateSeed from './app/data/seed/zip3_state.json'
import Nav from './components/Nav.vue'
import Hero from './components/Hero.vue'
import Features from './components/Features.vue'
import Calculator from './components/Calculator.vue'
import Integrations from './components/Integrations.vue'
import AISection from './components/AISection.vue'
import Dashboard from './components/Dashboard.vue'
import About from './components/About.vue'
import Contact from './components/Contact.vue'
import CTABand from './components/CTABand.vue'
import Footer from './components/Footer.vue'
import LegalModal from './components/LegalModal.vue'

provideI18n()

// ---------------------------------------------------------------------------
// Pricing context shared by Hero, Calculator and Dashboard.
// Reads the demo app's localStorage copies (kpz_demo:<name>) when they exist,
// so tariff, carrier and country changes made in the panel show up here too;
// otherwise the seed JSON is used. Same engine as the app: src/shared/rateEngine.js
// ---------------------------------------------------------------------------
const NS = 'kpz_demo'
const LB_PER_KG = 2.20462
const CM3_PER_IN3 = 16.387064

function isRelDate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.daysAgo !== 'number') return false
  return Object.keys(v).every((k) => k === 'daysAgo' || k === 'hour' || k === 'minute')
}
// Same conversion the app's db layer applies to seed files at load time.
function resolveDates(value, now = Date.now()) {
  if (Array.isArray(value)) return value.map((v) => resolveDates(v, now))
  if (value && typeof value === 'object') {
    if (isRelDate(value)) {
      const d = new Date(now)
      d.setDate(d.getDate() - value.daysAgo)
      d.setHours(value.hour ?? 9, value.minute ?? 0, 0, 0)
      return d.toISOString()
    }
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveDates(v, now)
    return out
  }
  return value
}
function readStored(name) {
  try {
    const raw = localStorage.getItem(`${NS}:${name}`)
    return raw == null ? undefined : JSON.parse(raw)
  } catch { return undefined }
}
function load(name, seed) {
  const stored = readStored(name)
  if (stored !== undefined && stored !== null) return { value: stored, stored: true }
  return { value: resolveDates(JSON.parse(JSON.stringify(seed))), stored: false }
}
function loadAll() {
  const carriers = load('carriers', carriersSeed)
  const rateCards = load('rate_cards', rateCardsSeed)
  const countries = load('countries', countriesSeed)
  const user = load('user', userSeed)
  return {
    carriers: carriers.value,
    rateCards: rateCards.value,
    countries: countries.value,
    user: user.value,
    fromStorage: carriers.stored || rateCards.stored || countries.stored,
  }
}

const data = shallowRef(loadAll())
const refresh = () => { data.value = loadAll() }
const onStorage = (e) => { if (!e.key || e.key.startsWith(NS + ':')) refresh() }
const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
onMounted(() => {
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
  document.removeEventListener('visibilitychange', onVisible)
})

const zipMap = new Map()
for (const z of zipCitySeed) {
  if (!zipMap.has(z.zip) || z.primary) zipMap.set(z.zip, z)
}

/** -> { status: 'format'|'unknown'|'city'|'state', zip, city?, state? } */
function lookupZip(zip) {
  const v = String(zip || '').trim()
  if (!/^\d{5}$/.test(v)) return { status: 'format', zip: v }
  const hit = zipMap.get(v)
  if (hit) return { status: 'city', zip: v, city: hit.city, state: hit.state }
  const st = zip3StateSeed[v.slice(0, 3)]
  if (st) return { status: 'state', zip: v, state: st }
  return { status: 'unknown', zip: v }
}

/** US domestic rate shop with the Starter plan (landing visitors have no account). */
function quoteDomestic({ hub, zip, state, pkg, plan = 'starter', customerId = null, residential = true }) {
  const d = data.value
  return rateShop({
    carriers: d.carriers,
    hub,
    toZip: zip,
    toState: String(state || '').toUpperCase(),
    pkg,
    residential,
    declaredValue: 0,
    plan,
    rateCards: d.rateCards,
    customerId,
    now: new Date(),
  })
}

/** Closer US hub for a ZIP (lower zone wins, NJ01 on ties). */
function bestHub(zip) {
  const nj = zoneFor('NJ01', zip)
  const la = zoneFor('LA01', zip)
  return la < nj ? { hub: 'LA01', zone: la, zones: { NJ01: nj, LA01: la } } : { hub: 'NJ01', zone: nj, zones: { NJ01: nj, LA01: la } }
}

/** First mile (GB/TR/DE...) + US last mile, one parcel, Starter plan. */
function quoteFirstMile({ origin, zip, state, pkg }) {
  const d = data.value
  const { hub } = bestHub(zip)
  const weightKg = round2((Number(pkg.weightLb) || 0) / LB_PER_KG)
  const volumetricKg = round2(((Number(pkg.lengthIn) || 0) * (Number(pkg.widthIn) || 0) * (Number(pkg.heightIn) || 0) * CM3_PER_IN3) / 5000)
  const q = firstMileQuote({
    origin,
    weightKg,
    parcels: 1,
    volumetricKg,
    destHub: hub,
    handover: 'dropoff',
    lastMile: 'direct',
    toZip: zip,
    toState: String(state || '').toUpperCase(),
    pkg,
    carriers: d.carriers,
    rateCards: d.rateCards,
    plan: 'starter',
    now: new Date(),
  })
  return { ...q, destHub: hub }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
/**
 * AI ranking for the landing (same weighting as the app optimizer:
 * cost w, speed (1-w)*0.6, reliability 0.3). Reliability comes from the
 * carrier's zone on-time table because visitors have no shipment history.
 */
function rankQuotes(quotes, weight = 0.6) {
  if (!quotes || !quotes.length) return []
  const carriers = data.value.carriers
  const totals = quotes.map((q) => q.total)
  const etas = quotes.map((q) => q.etaDays || 5)
  const minC = Math.min(...totals), maxC = Math.max(...totals)
  const minE = Math.min(...etas), maxE = Math.max(...etas)
  const w = { cost: weight, speed: (1 - weight) * 0.6, reliability: 0.3 }
  return quotes
    .map((q) => {
      const c = carriers.find((x) => x.code === q.carrierCode)
      const relRaw = (c && c.onTimeByZone && c.onTimeByZone[q.zone]) || 0.9
      const cost = maxC > minC ? (maxC - q.total) / (maxC - minC) : 1
      const speed = maxE > minE ? (maxE - (q.etaDays || 5)) / (maxE - minE) : 1
      const rel = clamp((relRaw - 0.8) / 0.2, 0, 1)
      return { quote: q, score: w.cost * cost + w.speed * speed + w.reliability * rel }
    })
    .sort((a, b) => b.score - a.score || a.quote.total - b.quote.total)
}

function carrierMeta(code) {
  return data.value.carriers.find((c) => c.code === code) || { code, name: code, color: '#1f2230', ink: '#ffffff' }
}

/** Active origin countries (seed GB/TR/DE plus markets added in Admin > Countries). */
function originCountries() {
  return (data.value.countries || []).filter((c) => c.active !== false && c.code !== 'US' && (c.role === 'origin' || c.role === 'both'))
}

provide('kpzPricing', { data, refresh, lookupZip, quoteDomestic, quoteFirstMile, bestHub, rankQuotes, carrierMeta, originCountries })

// Legal pages open as modals (Footer, Contact consent link).
const legal = shallowRef(null)
provide('kpzLegal', { open: (k) => { legal.value = k } })
</script>

<template>
  <Nav />
  <main>
    <Hero />
    <Features />
    <Calculator />
    <Integrations />
    <AISection />
    <Dashboard />
    <About />
    <Contact />
    <CTABand />
  </main>
  <Footer />
  <LegalModal v-if="legal" :doc="legal" @close="legal = null" />
</template>
