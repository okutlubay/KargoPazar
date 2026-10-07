<script setup>
// R&D work packages (spec 10.5): 4 work packages, 23 items, 24 month plan, demo links and presentation mode.
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Card from '@/app/components/Card.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Toggle from '@/app/components/Toggle.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import GanttStrip from '@/app/components/charts/GanttStrip.vue'
import ProgressRing from '@/app/components/charts/ProgressRing.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { listRoadmap } from '@/app/api/admin.js'
import { presentation, setPresentation, openItem } from '@/app/components/admin/presentation.js'
import { errorText } from '@/app/components/settings/util.js'

const { t, tx, fmt } = useI18n()
const route = useRoute()
const router = useRouter()

const loading = ref(true)
const failed = ref(false)
const items = ref([])
const expanded = ref(new Set(['IP1']))
const flash = ref('')

async function load() {
  loading.value = true
  failed.value = false
  try { items.value = await listRoadmap() } catch (e) { failed.value = true; toast.error(errorText(e, 'rnd')) } finally { loading.value = false }
}

const wps = computed(() => {
  const map = new Map()
  for (const it of items.value) {
    if (!map.has(it.wp)) map.set(it.wp, { wp: it.wp, label: it.wpLabel, name: it.wpName, months: it.wpMonths, items: [] })
    map.get(it.wp).items.push(it)
  }
  return [...map.values()].map(w => {
    const done = w.items.filter(i => i.state === 'done').length
    const pct = w.items.length ? Math.round(w.items.reduce((s, i) => s + (i.progress ?? (i.state === 'done' ? 100 : 0)), 0) / w.items.length) : 0
    return { ...w, done, pct }
  })
})
const doneCount = computed(() => items.value.filter(i => i.state === 'done').length)
const overallPct = computed(() => (items.value.length ? Math.round(items.value.reduce((s, i) => s + (i.progress ?? 0), 0) / items.value.length) : 0))
const projectBars = computed(() => wps.value.map(w => ({ key: w.wp, from: w.months[0], to: w.months[1], label: w.label, status: w.done === w.items.length ? 'done' : 'active', tooltip: `${tx(w.name)} · ${t('rnd.wpDone', { done: w.done, total: w.items.length })}` })))
const allOpen = computed(() => wps.value.length > 0 && wps.value.every(w => expanded.value.has(w.wp)))

function toggleWp(wp) {
  const s = new Set(expanded.value)
  s.has(wp) ? s.delete(wp) : s.add(wp)
  expanded.value = s
}
async function jumpWp(wp) {
  expanded.value = new Set([...expanded.value, wp])
  await nextTick()
  document.getElementById('wp-' + wp)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function toggleAll() {
  expanded.value = allOpen.value ? new Set() : new Set(wps.value.map(w => w.wp))
}

function show(item, i) {
  const link = item.demoLinks?.[i]
  if (!link) return
  if (presentation.on) openItem(router, item.id, i)
  else router.push(link.path)
}
function onPresentation(v) {
  setPresentation(v)
  if (v) toast.info(t('rnd.presentationOn'))
  else toast.info(t('rnd.presentationOff'))
}
function startTour() {
  setPresentation(true)
  const first = items.value[0]
  if (first) openItem(router, first.id, 0)
  toast.info(t('rnd.presentationOn'))
}

async function focusHash() {
  const id = String(route.hash || '').replace('#', '')
  if (!id) return
  const it = items.value.find(x => x.id === id)
  if (!it) return
  expanded.value = new Set([...expanded.value, it.wp])
  await nextTick()
  document.getElementById('rd-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flash.value = id
  setTimeout(() => { if (flash.value === id) flash.value = '' }, 2200)
}
watch(() => route.hash, () => { if (!loading.value) focusHash() })
onMounted(async () => { await load(); focusHash() })

const monthText = m => t('rnd.months', { from: m[0], to: m[1] })
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.adminRnd')" :subtitle="t('rnd.subtitle')">
      <template #actions>
        <Toggle :model-value="presentation.on" :label="t('rnd.presentation')" size="sm" @update:model-value="onPresentation" />
        <button class="btn btn-primary" :disabled="loading || !items.length" @click="startTour"><Icon name="play" :size="13" />{{ t('rnd.startTour') }}</button>
      </template>
    </PageHeader>

    <div v-if="presentation.on" class="callout mb"><Icon name="info" :size="14" />{{ t('rnd.presentationHint') }}</div>

    <template v-if="loading">
      <div class="grid-kpi mb"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="118" /></div>
      <Skeleton variant="rect" :height="140" class="mb" />
      <Skeleton :lines="10" />
    </template>

    <EmptyState v-else-if="failed" icon="alert" :title="t('common.errorGeneric')" :action-label="t('common.retry')" @action="load" />
    <EmptyState v-else-if="!items.length" icon="flag" :title="t('rnd.empty')" />

    <template v-else>
      <!-- summary -->
      <div class="summary mb" data-testid="rnd-summary">
        <div class="total">
          <div class="big num">{{ doneCount }}/{{ items.length }}</div>
          <div class="lbl">{{ t('rnd.completedItems') }}</div>
          <div class="sub">{{ t('rnd.overall', { pct: fmt.percent(overallPct / 100, 0) }) }}</div>
        </div>
        <div class="rings">
          <button v-for="w in wps" :key="w.wp" class="ring" :title="tx(w.name)" @click="jumpWp(w.wp)">
            <ProgressRing :value="w.pct" :size="64" color="var(--success)" :aria-label="`${w.label} ${w.pct}%`" />
            <span class="ring-l">{{ w.label }}</span>
            <span class="ring-s">{{ t('rnd.wpDone', { done: w.done, total: w.items.length }) }}</span>
          </button>
        </div>
      </div>

      <Card :title="t('rnd.calendarTitle')" :subtitle="t('rnd.calendarDesc')" class="mb" data-testid="rnd-gantt">
        <GanttStrip :bars="projectBars" :months="24" :row-height="20" />
      </Card>

      <div class="list-head">
        <div class="section-title">{{ t('rnd.packagesTitle') }}</div>
        <button class="btn btn-ghost btn-sm" @click="toggleAll"><Icon :name="allOpen ? 'chevron-up' : 'chevron-down'" :size="12" />{{ allOpen ? t('rnd.collapseAll') : t('rnd.expandAll') }}</button>
      </div>

      <section v-for="w in wps" :id="'wp-' + w.wp" :key="w.wp" class="wp">
        <button class="wp-head" :data-testid="'rnd-wp-' + w.wp" :aria-expanded="expanded.has(w.wp)" :aria-controls="'wpb-' + w.wp" @click="toggleWp(w.wp)">
          <span class="wp-badge mono">{{ w.label }}</span>
          <span class="wp-name">{{ tx(w.name) }}</span>
          <span class="wp-meta">{{ monthText(w.months) }} · {{ t('rnd.itemsN', { n: w.items.length }) }}</span>
          <span class="wp-prog"><span class="bar"><i :style="{ width: w.pct + '%' }" /></span>{{ t('rnd.wpDone', { done: w.done, total: w.items.length }) }}</span>
          <Icon :name="expanded.has(w.wp) ? 'chevron-up' : 'chevron-down'" :size="14" />
        </button>
        <div v-if="expanded.has(w.wp)" :id="'wpb-' + w.wp" class="wp-body">
          <article v-for="it in w.items" :id="'rd-' + it.id" :key="it.id" :class="['item', { flash: flash === it.id, active: presentation.on && presentation.itemId === it.id }]">
            <div class="it-no mono">{{ it.no }}</div>
            <div class="it-main">
              <div class="it-top">
                <h3 class="it-name">{{ tx(it.name) }}</h3>
                <StatusPill :status="it.state === 'done' ? 'completed' : 'running'" :label="it.state === 'done' ? t('rnd.completed') : t('rnd.inProgress')" size="sm" />
              </div>
              <div class="it-gantt">
                <GanttStrip :bars="[{ key: it.id, from: it.months[0], to: it.months[1], status: it.state === 'done' ? 'done' : 'active', label: monthText(it.months), tooltip: tx(it.name) }]" :months="24" :show-ticks="false" :show-labels="false" :row-height="8" />
                <span class="it-months">{{ monthText(it.months) }}</span>
              </div>
              <dl class="it-kv">
                <div><dt>{{ t('rnd.currentStatus') }}</dt><dd class="st">{{ tx(it.status) }}</dd></div>
                <div><dt>{{ t('rnd.demoScreens') }}</dt><dd>{{ tx(it.demoScreens) }}</dd></div>
                <div><dt>{{ t('rnd.acceptance') }}</dt><dd>{{ tx(it.acceptance) }}</dd></div>
              </dl>
            </div>
            <div class="it-links">
              <button v-for="(l, i) in it.demoLinks" :key="l.path + i" :data-testid="`rnd-show-${it.id}-${i}`" class="btn btn-soft btn-sm" :title="l.path" @click="show(it, i)">
                <Icon name="external" :size="13" /><span class="lt"><b>{{ t('rnd.showInDemo') }}</b><span class="lk">{{ tx(l.label) }}</span></span>
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mb { margin-bottom: 16px; }
.summary { display: flex; gap: 20px; align-items: stretch; flex-wrap: wrap; }
.total { flex: 0 0 220px; display: flex; flex-direction: column; justify-content: center; padding: 18px 22px; border-radius: var(--r-lg); background: var(--ink-1); color: var(--bg); }
.big { font-family: var(--font-display); font-size: 40px; font-weight: 600; line-height: 1.05; }
.total .lbl { font-weight: 500; margin-top: 4px; }
.total .sub { font-size: 12.5px; opacity: .7; margin-top: 2px; }
.rings { flex: 1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; min-width: 0; }
.ring { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 8px; border: 1px solid var(--line-1); border-radius: var(--r-lg); background: var(--surface); cursor: pointer; }
.ring:hover { border-color: var(--line-2); box-shadow: var(--shadow-sm, none); }
.ring-l { font-weight: 600; font-size: 13.5px; margin-top: 4px; }
.ring-s { font-size: 12px; color: var(--ink-3); }
.list-head { display: flex; align-items: center; justify-content: space-between; margin: 8px 0 10px; }
.wp { border: 1px solid var(--line-1); border-radius: var(--r-lg); background: var(--surface); margin-bottom: 12px; overflow: hidden; scroll-margin-top: 80px; }
.wp-head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: transparent; border: 0; text-align: left; cursor: pointer; flex-wrap: wrap; }
.wp-head:hover { background: var(--bg-2); }
.wp-badge { background: var(--accent); color: white; font-weight: 600; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
.wp-name { font-weight: 600; font-size: 15px; flex: 1; min-width: 200px; }
.wp-meta { font-size: 12.5px; color: var(--ink-3); }
.wp-prog { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.bar { width: 80px; height: 6px; border-radius: 99px; background: var(--bg-3); overflow: hidden; display: inline-block; }
.bar i { display: block; height: 100%; background: var(--success); border-radius: 99px; }
.wp-body { border-top: 1px solid var(--line-1); }
.item { display: grid; grid-template-columns: 34px minmax(0, 1fr) 240px; gap: 16px; padding: 16px 18px; border-top: 1px solid var(--line-1); scroll-margin-top: 100px; transition: background .4s; }
.item:first-child { border-top: 0; }
.item.flash { background: var(--accent-soft); }
.item.active { box-shadow: inset 3px 0 0 var(--accent); }
.it-no { width: 28px; height: 28px; border-radius: 8px; background: var(--bg-3); display: grid; place-items: center; font-size: 12px; color: var(--ink-2); font-weight: 600; }
.it-top { display: flex; align-items: flex-start; gap: 10px; justify-content: space-between; }
.it-name { margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.it-gantt { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: 10px; align-items: center; margin: 10px 0 8px; }
.it-months { font-size: 12px; color: var(--ink-3); text-align: right; }
.it-kv { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
.it-kv dt { font-size: 11.5px; color: var(--ink-4); text-transform: uppercase; letter-spacing: .04em; }
.it-kv dd { margin: 2px 0 0; font-size: 13px; color: var(--ink-2); }
.it-kv dd.st { color: var(--success); font-weight: 600; }
.it-links { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.it-links .btn { justify-content: flex-start; align-items: center; gap: 10px; height: auto; min-height: 34px; padding: 6px 12px; text-align: left; white-space: normal; }
.lt { display: flex; flex-direction: column; line-height: 1.25; }
.lt b { font-weight: 600; font-size: 12.5px; }
.lk { color: var(--ink-3); font-weight: 400; font-size: 12px; }
@media (max-width: 1100px) { .item { grid-template-columns: 34px minmax(0, 1fr); } .it-links { grid-column: 2; flex-direction: row; flex-wrap: wrap; } .it-kv { grid-template-columns: 1fr; } }
@media (max-width: 860px) { .rings { grid-template-columns: repeat(2, minmax(0, 1fr)); } .total { flex: 1 1 100%; } }
</style>
