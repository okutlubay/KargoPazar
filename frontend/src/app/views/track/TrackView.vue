<script setup>
// Public tracking page (spec 5.13): no session, no sidebar. /track/:trackingNo? (comma separated for several).
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Wordmark from '@/components/Wordmark.vue'
import Spinner from '../../components/Spinner.vue'
import Skeleton from '../../components/Skeleton.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import CopyButton from '../../components/CopyButton.vue'
import { trackLookup } from '../../api/shipments.js'
import { errorText, hasKey } from '../../components/billing/apiErrors.js'
import { isAuthenticated } from '../../store/session.js'
import { db } from '../../store/db.js'
import { t, fmt, locale, setLocale } from '../../i18n/index.js'

const route = useRoute()
const router = useRouter()
const query = ref('')
const results = ref([])
const loading = ref(false)
const error = ref('')
const searched = ref(false)

const STEP_KEYS = ['label', 'hub', 'transit', 'out', 'delivered']
const STATUS_HEAD = { label_created: 'label', in_transit: 'transit', out_for_delivery: 'out', delivered: 'delivered', exception: 'exception', returned: 'returned', voided: 'voided' }

async function run(q) {
  const v = String(q ?? '').trim()
  error.value = ''
  if (!v) { results.value = []; searched.value = false; return }
  loading.value = true
  searched.value = true
  try { results.value = await trackLookup(v) } catch (e) { error.value = errorText(e, ['track.errors']); results.value = [] } finally { loading.value = false }
}
watch(() => route.params.trackingNo, v => {
  const q = decodeURIComponent(String(v ?? ''))
  query.value = q.replace(/,/g, ', ')
  run(q)
}, { immediate: true })

function submit() {
  const tokens = query.value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)
  if (!tokens.length) { error.value = t('track.errors.empty'); return }
  const path = tokens.join(',')
  if (route.params.trackingNo === path) run(path)
  else router.push({ name: 'track', params: { trackingNo: path } })
}
async function sample() {
  // Without a session there is no in-memory data: pick the samples from the bundled seed.
  const list = db.ready ? db.all('shipments') : ((await db.loadSeed('shipments').catch(() => [])) ?? [])
  const s = list.find(x => x.status === 'in_transit' && !x.test) ?? list[0]
  const d = list.find(x => x.status === 'delivered' && !x.test)
  query.value = [s?.trackingNo, d?.trackingNo].filter(Boolean).join(', ')
  submit()
}

const found = computed(() => results.value.filter(r => r.found))
const missing = computed(() => results.value.filter(r => !r.found))
const eventLabel = code => (hasKey(`core.events.${code}`) ? t(`core.events.${code}`) : code)
const headKey = r => (['label_created', 'in_transit'].includes(r.status) ? STEP_KEYS[Math.min(r.step, 2)] : STATUS_HEAD[r.status] ?? 'transit')
const shareUrl = r => `${location.origin}${location.pathname}#/track/${r.trackingNo}`
function toggleLang() { setLocale(locale.value === 'tr' ? 'en' : 'tr') }
</script>

<template>
  <div class="track">
    <header class="top">
      <RouterLink :to="{ name: 'track' }" class="brand" :aria-label="t('track.title')"><Wordmark /></RouterLink>
      <div class="top-right">
        <button class="btn btn-ghost btn-sm" :aria-label="t('track.language')" @click="toggleLang">{{ locale === 'tr' ? 'EN' : 'TR' }}</button>
        <RouterLink v-if="isAuthenticated()" to="/" class="btn btn-ghost btn-sm">{{ t('track.backToPanel') }}</RouterLink>
      </div>
    </header>

    <main class="main">
      <section class="hero">
        <h1>{{ t('track.title') }}</h1>
        <p>{{ t('track.subtitle') }}</p>
        <form class="search" role="search" @submit.prevent="submit">
          <Icon name="search" :size="18" class="s-ic" />
          <input v-model="query" class="input s-in" :placeholder="t('track.placeholder')" :aria-label="t('track.placeholder')" autocomplete="off" spellcheck="false" @input="error = ''" />
          <button class="btn btn-accent" type="submit" :disabled="loading"><Spinner v-if="loading" :size="14" /> {{ t('track.search') }}</button>
        </form>
        <div class="hint">{{ t('track.hint') }} <button type="button" class="btn-link" @click="sample">{{ t('track.sample') }}</button></div>
        <div v-if="error" class="callout danger err" role="alert">{{ error }}</div>
      </section>

      <div v-if="loading" class="results"><Skeleton variant="rect" :height="260" /></div>
      <div v-else class="results">
        <article v-for="r in found" :key="r.result.trackingNo + r.query" class="card">
          <header class="c-head" :class="'h-' + headKey(r.result)">
            <div class="c-status">
              <span class="eyebrow">{{ t('track.status') }}</span>
              <h2>{{ t('track.head.' + headKey(r.result)) }}</h2>
              <p v-if="r.result.status === 'delivered' && r.result.deliveredAt">{{ t('track.deliveredOn', { date: fmt.dateTime(r.result.deliveredAt) }) }}</p>
              <p v-else-if="r.result.eta && !['voided', 'returned'].includes(r.result.status)">{{ t('track.eta', { date: fmt.date(r.result.eta) }) }}</p>
            </div>
            <CarrierLogo :code="r.result.carrier" :size="40" />
          </header>
          <div class="c-body">
            <div class="meta">
              <div><span>{{ t('track.trackingNo') }}</span><strong class="mono">{{ r.result.trackingNo }} <CopyButton :text="r.result.trackingNo" size="xs" /></strong></div>
              <div><span>{{ t('track.service') }}</span><strong>{{ String(r.result.serviceName ?? '').startsWith(r.result.carrierName) ? r.result.serviceName : [r.result.carrierName, r.result.serviceName].filter(Boolean).join(' · ') }}</strong></div>
              <div><span>{{ t('track.route') }}</span><strong>{{ r.result.origin.city }}, {{ r.result.origin.state }} <Icon name="arrow" :size="12" /> {{ r.result.destination.city }}, {{ r.result.destination.state }}</strong></div>
              <div v-if="r.result.orderRef"><span>{{ t('track.order') }}</span><strong class="mono">{{ r.result.orderRef }}</strong></div>
            </div>

            <ol v-if="!['voided'].includes(r.result.status)" class="progress" :aria-label="t('track.progress')">
              <li v-for="(k, i) in STEP_KEYS" :key="k" :class="{ done: i <= r.result.step, current: i === r.result.step, bad: r.result.status === 'exception' && i === r.result.step }">
                <span class="dot"><Icon v-if="i < r.result.step || r.result.step === 4" name="check" :size="11" /></span>
                <span class="lbl">{{ t('core.trackingSteps')[i] }}</span>
              </li>
            </ol>
            <div v-if="r.result.status === 'exception'" class="callout warn"><Icon name="alert" /> {{ t('track.exceptionNote') }}</div>
            <div v-if="r.result.status === 'voided'" class="callout neutral">{{ t('track.voidedNote') }}</div>

            <h3 class="ev-title">{{ t('track.events') }}</h3>
            <ol class="events">
              <li v-for="(e, i) in r.result.events" :key="i" :class="{ first: i === 0 }">
                <span class="e-dot" />
                <div class="e-main">
                  <strong>{{ eventLabel(e.code) }}</strong>
                  <span class="e-loc">{{ e.loc }}</span>
                </div>
                <time class="e-at">{{ fmt.dateTime(e.at) }}</time>
              </li>
            </ol>
          </div>
          <footer class="c-foot">
            <CopyButton :text="shareUrl(r.result)" variant="button" :label="t('track.copyLink')" size="sm" />
          </footer>
        </article>

        <article v-for="r in missing" :key="'x' + r.query" class="card notfound">
          <Icon name="search" :size="20" />
          <div>
            <strong>{{ t('track.notFound', { q: r.query }) }}</strong>
            <p>{{ t('track.notFoundDesc') }}</p>
          </div>
        </article>

        <section v-if="!searched" class="intro">
          <div class="feat"><Icon name="radar" :size="18" /><div><strong>{{ t('track.f1') }}</strong><p>{{ t('track.f1d') }}</p></div></div>
          <div class="feat"><Icon name="layers" :size="18" /><div><strong>{{ t('track.f2') }}</strong><p>{{ t('track.f2d') }}</p></div></div>
          <div class="feat"><Icon name="link" :size="18" /><div><strong>{{ t('track.f3') }}</strong><p>{{ t('track.f3d') }}</p></div></div>
        </section>
      </div>
    </main>

    <footer class="powered">{{ t('track.powered') }} <strong>KargoPazar</strong></footer>
  </div>
</template>

<style scoped>
.track { min-height: 100vh; background: var(--bg-2); display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: center; padding: 16px 28px; background: var(--surface); border-bottom: 1px solid var(--line-1); }
.brand { display: inline-flex; }
.top-right { display: flex; gap: 8px; }
.main { flex: 1; width: 100%; max-width: 820px; margin: 0 auto; padding: 36px 20px 40px; }
.hero { text-align: center; }
.hero h1 { font-family: var(--font-display); font-size: 30px; letter-spacing: -0.02em; margin: 0 0 6px; }
.hero p { color: var(--ink-2); margin: 0 0 20px; }
.search { display: flex; gap: 8px; align-items: center; background: var(--surface); padding: 8px 8px 8px 14px; border: 1px solid var(--line-2); border-radius: var(--r-lg); box-shadow: var(--shadow-md); }
.s-ic { color: var(--ink-3); }
.s-in { flex: 1; border: 0; box-shadow: none; height: 42px; font-size: 15px; min-width: 0; }
.s-in:focus { box-shadow: none; }
.hint { margin-top: 10px; font-size: 12.5px; color: var(--ink-3); }
.err { margin-top: 12px; text-align: left; }
.results { margin-top: 28px; display: flex; flex-direction: column; gap: 18px; }
.card { background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-xl, 16px); box-shadow: var(--shadow-sm); overflow: hidden; }
.c-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 24px; background: var(--accent-soft); color: var(--accent-ink); }
.h-delivered { background: oklch(0.95 0.05 155); color: oklch(0.38 0.1 155); }
.h-exception { background: oklch(0.96 0.06 80); color: oklch(0.42 0.1 70); }
.h-voided, .h-returned { background: var(--bg-3); color: var(--ink-2); }
.eyebrow { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .8; }
.c-status h2 { margin: 2px 0; font-family: var(--font-display); font-size: 24px; letter-spacing: -0.01em; }
.c-status p { margin: 0; font-size: 13.5px; }
.c-body { padding: 20px 24px; }
.meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
.meta div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.meta span { font-size: 12px; color: var(--ink-3); }
.meta strong { font-size: 13.5px; font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mono { font-family: var(--font-mono); }
.progress { list-style: none; padding: 0; margin: 24px 0 8px; display: grid; grid-template-columns: repeat(5, 1fr); position: relative; }
.progress li { display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; font-size: 12px; color: var(--ink-3); text-align: center; }
.progress li::before { content: ''; position: absolute; top: 10px; left: -50%; width: 100%; height: 3px; background: var(--line-2); z-index: 0; }
.progress li:first-child::before { display: none; }
.progress li.done::before { background: var(--success); }
.dot { width: 22px; height: 22px; border-radius: 50%; background: var(--surface); border: 2px solid var(--line-2); display: grid; place-items: center; z-index: 1; color: white; }
.done .dot { background: var(--success); border-color: var(--success); }
.current .dot { box-shadow: 0 0 0 5px oklch(0.95 0.05 155); }
.bad .dot { background: var(--warning); border-color: var(--warning); box-shadow: 0 0 0 5px oklch(0.96 0.06 80); }
.done .lbl { color: var(--ink-1); font-weight: 500; }
.ev-title { font-size: 14px; font-family: var(--font-display); margin: 22px 0 8px; }
.events { list-style: none; margin: 0; padding: 0; }
.events li { display: grid; grid-template-columns: 14px 1fr auto; gap: 12px; align-items: baseline; padding: 9px 0; border-bottom: 1px solid var(--line-1); position: relative; }
.events li:last-child { border-bottom: 0; }
.e-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--line-strong); align-self: center; }
.first .e-dot { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.e-main { display: flex; flex-direction: column; font-size: 13.5px; }
.e-loc { font-size: 12.5px; color: var(--ink-3); }
.e-at { font-size: 12.5px; color: var(--ink-3); white-space: nowrap; }
.c-foot { padding: 12px 24px; border-top: 1px solid var(--line-1); background: var(--bg-2); display: flex; justify-content: flex-end; }
.notfound { display: flex; gap: 14px; align-items: flex-start; padding: 18px 22px; color: var(--ink-3); }
.notfound strong { color: var(--ink-1); }
.notfound p { margin: 2px 0 0; font-size: 13px; }
.intro { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.feat { display: flex; gap: 10px; align-items: flex-start; background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-lg); padding: 14px; color: var(--accent); }
.feat strong { color: var(--ink-1); font-size: 13.5px; }
.feat p { margin: 2px 0 0; color: var(--ink-3); font-size: 12.5px; }
.powered { text-align: center; padding: 22px; font-size: 12.5px; color: var(--ink-3); }
@media (max-width: 640px) {
  .top { padding: 12px 16px; }
  .meta { grid-template-columns: 1fr; }
  .intro { grid-template-columns: 1fr; }
  .progress .lbl { font-size: 10.5px; }
  .events li { grid-template-columns: 14px 1fr; }
  .e-at { grid-column: 2; }
  .search .btn { padding: 0 12px; }
}
</style>
