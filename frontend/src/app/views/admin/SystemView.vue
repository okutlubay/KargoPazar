<script setup>
// System status (spec 10.4): service cards, 30 day uptime, deploy history, improvements,
// AWS cost trend and scaling events. The Panel card p95 is computed live from the request log.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Card from '@/app/components/Card.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Spinner from '@/app/components/Spinner.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import CarrierLogo from '@/app/components/CarrierLogo.vue'
import ChannelLogo from '@/app/components/ChannelLogo.vue'
import MiniBars from '@/app/components/charts/MiniBars.vue'
import BarChart from '@/app/components/charts/BarChart.vue'
import Sparkline from '@/app/components/charts/Sparkline.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { getSystemStatus } from '@/app/api/admin.js'
import { errorText } from '@/app/components/settings/util.js'

const { t, tx, fmt, locale } = useI18n()
const loading = ref(true)
const refreshing = ref(false)
const failed = ref(false)
const sys = ref(null)
let timer = null

async function load(manual = false) {
  if (manual) refreshing.value = true
  failed.value = false
  try {
    sys.value = await getSystemStatus()
    if (manual) toast.success(t('admin.system.refreshed'))
  } catch (e) {
    if (!sys.value) failed.value = true
    toast.error(errorText(e, 'admin'))
  } finally { loading.value = false; refreshing.value = false }
}
onMounted(() => { load(); timer = setInterval(() => load(), 30000) })
onBeforeUnmount(() => clearInterval(timer))

const ICONS = { api: 'server', panel: 'layers', db: 'database', worker: 'sync', carriers: 'truck', marketplaces: 'store' }
const services = computed(() => (sys.value?.services ?? []).map(s => {
  if (s.id !== 'panel') return s
  const p = sys.value.panel
  return { ...s, p95Ms: p.p95Ms, live: true }
}))
const overall = computed(() => {
  const list = services.value
  if (list.some(s => s.status === 'down')) return 'down'
  if (list.some(s => s.status === 'degraded')) return 'degraded'
  return 'operational'
})
const uptime = computed(() => (sys.value?.uptime30d ?? []).map(d => ({
  status: d.status,
  label: fmt.date(d.day),
  tooltip: t('admin.system.uptimeDay', { pct: fmt.percent(d.uptimePct / 100, 2) }) + (d.status !== 'up' ? ` · ${t('status.' + (d.status === 'degraded' ? 'degraded' : 'down'))}` : ''),
})))
const avgUptime = computed(() => {
  const l = sys.value?.uptime30d ?? []
  return l.length ? l.reduce((s, d) => s + d.uptimePct, 0) / l.length : null
})
const deploys = computed(() => [...(sys.value?.deploys ?? [])].sort((a, b) => new Date(b.at) - new Date(a.at)))
const costMonths = computed(() => {
  const now = new Date()
  return (sys.value?.awsCost ?? []).map(c => {
    const d = new Date(now.getFullYear(), now.getMonth() + c.monthOffset, 1)
    return { label: d.toLocaleDateString(locale.value === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }), usd: c.usd }
  })
})
const costDelta = computed(() => {
  const c = sys.value?.awsCost ?? []
  if (c.length < 2) return null
  return (c[c.length - 1].usd - c[0].usd) / c[0].usd
})

function duration(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return t('admin.system.duration', { m, s })
}
function unitText(v, unit) {
  if (unit === 's') return t('admin.system.units.s', { v: fmt.number(v, 1) })
  if (unit === 'ms') return t('admin.system.units.ms', { v: fmt.number(v) })
  if (unit === 'steps') return t('admin.system.units.steps', { v })
  return fmt.percent(v / 100, 0)
}
function improvePct(i) {
  if (i.unit === '%') return null
  return i.before ? (i.before - i.after) / i.before : null
}
function healthDot(s) { return s === 'up' ? 'ok' : s === 'degraded' ? 'slow' : s === 'none' ? 'none' : 'bad' }
const panelSpark = computed(() => (sys.value?.panel?.recent ?? []).map(r => r.ms))
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.adminSystem')" :subtitle="t('admin.system.subtitle')">
      <template #title-extra><span v-if="sys" class="tag">{{ t('admin.system.envTag') }}</span></template>
      <template #actions>
        <button class="btn btn-ghost" :disabled="refreshing || loading" @click="load(true)"><Spinner v-if="refreshing" :size="14" /><Icon v-else name="refresh" :size="14" />{{ t('common.refresh') }}</button>
      </template>
    </PageHeader>

    <template v-if="loading">
      <Skeleton variant="rect" :height="56" class="mb" />
      <div class="svc-grid mb"><Skeleton v-for="i in 6" :key="i" variant="rect" :height="150" /></div>
      <Skeleton :lines="8" />
    </template>
    <EmptyState v-else-if="failed" icon="server" :title="t('common.errorGeneric')" :action-label="t('common.retry')" @action="load(true)" />

    <template v-else-if="sys">
      <div :class="['banner', overall]">
        <span class="bdot" />
        <div>
          <strong>{{ t('admin.system.overall.' + overall) }}</strong>
          <span class="bsub">{{ t('admin.system.checkedAt') }} <DateTime :value="sys.checkedAt" mode="absolute" /> · {{ t('admin.system.version', { v: sys.currentVersion || '-' }) }}</span>
        </div>
      </div>

      <!-- services -->
      <div class="svc-grid mb">
        <article v-for="s in services" :key="s.id" class="svc">
          <header>
            <span class="ic"><Icon :name="ICONS[s.id] || 'server'" :size="16" /></span>
            <div class="sv-t">
              <strong>{{ tx(s.name) }}</strong>
              <span class="tech">{{ s.tech }} · {{ s.host }}</span>
            </div>
            <StatusPill :status="s.status" size="sm" />
          </header>
          <p class="det">{{ tx(s.detail) }}</p>
          <div class="metrics">
            <div><span class="ml">{{ t('admin.system.uptime') }}</span><span class="mv num">{{ fmt.percent(s.uptimePct / 100, 2) }}</span></div>
            <div>
              <span class="ml">{{ s.live ? t('admin.system.p95Live') : t('admin.system.p95') }}</span>
              <span class="mv num">{{ s.p95Ms != null ? t('common.ms', { n: s.p95Ms }) : '-' }}</span>
            </div>
            <div v-if="s.tasks"><span class="ml">{{ t('admin.system.tasks') }}</span><span class="mv num">{{ s.tasks }}</span></div>
            <div v-if="s.queueDepth != null"><span class="ml">{{ t('admin.system.queue') }}</span><span class="mv num">{{ s.queueDepth }}</span></div>
            <div v-if="s.live"><span class="ml">{{ t('admin.system.requests') }}</span><span class="mv num">{{ fmt.number(sys.panel.requests) }}</span></div>
          </div>
          <div v-if="s.live" class="live">
            <Sparkline :data="panelSpark" :height="30" tooltip :format="v => t('common.ms', { n: v })" :aria-label="t('admin.system.p95Live')" />
            <span class="note">{{ t('admin.system.liveNote', { n: sys.panel.requests, err: fmt.percent(sys.panel.errorRate, 1) }) }}</span>
          </div>
          <div v-else-if="s.id === 'carriers'" class="dots">
            <span v-for="a in sys.adapters" :key="a.carrier" class="dotrow" :title="`${a.name} · ${a.avgMs ? t('common.ms', { n: a.avgMs }) : '-'}`">
              <i :class="healthDot(a.status)" /><span class="mono">{{ a.carrier }}</span>
            </span>
          </div>
          <div v-else-if="s.id === 'marketplaces'" class="dots">
            <span v-for="c in sys.connectors" :key="c.id" class="dotrow" :title="c.name">
              <i :class="healthDot(c.status)" /><ChannelLogo :code="c.channel" :size="16" />
            </span>
          </div>
          <span class="corner">{{ s.live ? t('admin.system.liveBadge') : t('admin.system.demoEnv') }}</span>
        </article>
      </div>

      <!-- uptime -->
      <Card :title="t('admin.system.uptimeTitle')" :subtitle="t('admin.system.uptimeDesc', { pct: avgUptime != null ? fmt.percent(avgUptime / 100, 3) : '-' })" class="mb">
        <MiniBars :data="uptime" :height="34" />
        <div class="axis"><span>{{ t('admin.system.daysAgo', { n: 30 }) }}</span><span>{{ t('common.today') }}</span></div>
        <div v-if="sys.incidents?.length" class="incidents">
          <div v-for="(inc, i) in sys.incidents" :key="i" class="inc">
            <Icon name="alert" :size="14" />
            <span><DateTime :value="inc.day" mode="date" /> · {{ tx(inc.title) }}</span>
            <span class="muted">{{ t('admin.system.resolved') }} <DateTime :value="inc.resolvedAt" mode="absolute" /></span>
          </div>
        </div>
      </Card>

      <div class="grid-2 mb">
        <!-- adapters -->
        <Card :title="t('admin.system.adaptersTitle')" :subtitle="t('admin.system.adaptersDesc')" padding="none">
          <table class="table-simple">
            <thead><tr><th>{{ t('admin.carriers.carrier') }}</th><th>{{ t('common.status') }}</th><th class="r">{{ t('admin.system.avgMs') }}</th></tr></thead>
            <tbody>
              <tr v-for="a in sys.adapters" :key="a.carrier">
                <td><CarrierLogo :code="a.carrier" :name="a.name" :color="a.color" :ink="a.ink" show-name :size="22" /></td>
                <td><span class="health"><i :class="healthDot(a.status)" />{{ t('admin.system.health.' + a.status) }}</span></td>
                <td class="r num">{{ a.avgMs ? t('common.ms', { n: a.avgMs }) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <!-- improvements -->
        <Card :title="t('admin.system.improvementsTitle')" :subtitle="t('admin.system.improvementsDesc')">
          <div class="imps">
            <div v-for="i in sys.improvements" :key="i.id" class="imp">
              <div class="imp-t">
                <strong>{{ tx(i.title) }}</strong>
                <span v-if="improvePct(i) != null" class="tag tag-success">{{ t('admin.system.better', { pct: fmt.percent(improvePct(i), 0) }) }}</span>
                <span v-else class="tag tag-success">{{ t('admin.system.automated') }}</span>
              </div>
              <div class="ba">
                <span class="before">{{ t('admin.system.before') }} <b class="num">{{ unitText(i.before, i.unit) }}</b></span>
                <Icon name="arrow" :size="12" />
                <span class="after">{{ t('admin.system.after') }} <b class="num">{{ unitText(i.after, i.unit) }}</b></span>
              </div>
              <div class="imp-bar"><i class="b" :style="{ width: (i.unit === '%' ? 100 - i.after + 2 : 100) + '%' }" /><i class="a" :style="{ width: (i.unit === '%' ? i.after : Math.max(4, (i.after / i.before) * 100)) + '%' }" /></div>
              <p class="muted small">{{ tx(i.note) }}</p>
            </div>
          </div>
        </Card>
      </div>

      <!-- deploys -->
      <Card :title="t('admin.system.deploysTitle')" :subtitle="t('admin.system.deploysDesc', { n: deploys.length })" padding="none" class="mb" data-testid="deploy-history">
        <div class="table-wrap">
          <table class="table-simple deploys">
            <thead><tr><th>{{ t('admin.system.versionCol') }}</th><th>{{ t('admin.system.commit') }}</th><th>{{ t('admin.system.message') }}</th><th>{{ t('common.date') }}</th><th class="r">{{ t('admin.system.durationCol') }}</th><th>{{ t('common.status') }}</th></tr></thead>
            <tbody>
              <tr v-for="d in deploys" :key="d.version + d.commit" :class="{ current: d.current }">
                <td><strong class="mono">{{ d.version }}</strong> <span v-if="d.current" class="tag tag-accent">{{ t('admin.system.current') }}</span></td>
                <td class="mono small">{{ d.commit }}</td>
                <td class="msg">{{ d.message }}</td>
                <td class="nowrap"><DateTime :value="d.at" /></td>
                <td class="r num nowrap">{{ duration(d.durationSec) }}</td>
                <td><StatusPill :status="d.status" size="sm" /> <span class="muted small">{{ d.pipeline }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div class="grid-2">
        <Card :title="t('admin.system.costTitle')" :subtitle="t('admin.system.costDesc', { delta: costDelta != null ? fmt.percent(costDelta, 0) : '-' })">
          <BarChart :categories="costMonths.map(c => c.label)" :series="[{ key: 'usd', label: t('admin.system.costSeries'), values: costMonths.map(c => c.usd) }]" :value-format="v => fmt.money(v, 'USD', 0)" :height="220" :legend="false" />
        </Card>
        <Card :title="t('admin.system.scalingTitle')" :subtitle="t('admin.system.scalingDesc')" padding="none">
          <EmptyState v-if="!sys.scalingEvents?.length" compact icon="server" :title="t('admin.system.noScaling')" />
          <ul v-else class="events">
            <li v-for="(e, i) in sys.scalingEvents" :key="i">
              <span class="ev-ic"><Icon :name="e.to > e.from ? 'chevron-up' : 'chevron-down'" :size="14" /></span>
              <div>
                <strong>{{ t('admin.system.scaled', { service: tx(sys.services.find(s => s.id === e.service)?.name) || e.service, from: e.from, to: e.to }) }}</strong>
                <div class="muted small">{{ tx(e.reason) }} · <DateTime :value="e.at" /></div>
              </div>
            </li>
          </ul>
        </Card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mb { margin-bottom: 16px; }
.banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: var(--r-lg); margin-bottom: 16px; background: oklch(0.96 0.04 155); color: oklch(0.36 0.1 155); }
.banner.degraded { background: oklch(0.96 0.05 85); color: oklch(0.42 0.1 70); }
.banner.down { background: oklch(0.95 0.04 25); color: oklch(0.45 0.15 25); }
.bdot { width: 10px; height: 10px; border-radius: 99px; background: currentColor; box-shadow: 0 0 0 4px color-mix(in oklch, currentColor 20%, transparent); }
.banner strong { display: block; }
.bsub { font-size: 12.5px; opacity: .8; }
.svc-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.svc { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--line-1); border-radius: var(--r-lg); background: var(--surface); }
.svc header { display: flex; align-items: flex-start; gap: 10px; }
.ic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-ink); flex: none; }
.sv-t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tech { font-size: 12px; color: var(--ink-3); }
.det { margin: 0; font-size: 12.5px; color: var(--ink-2); }
.metrics { display: flex; gap: 18px; flex-wrap: wrap; }
.metrics > div { display: flex; flex-direction: column; }
.ml { font-size: 11.5px; color: var(--ink-4); }
.mv { font-weight: 600; font-size: 15px; }
.live { display: flex; flex-direction: column; gap: 4px; }
.note { font-size: 11.5px; color: var(--ink-3); }
.dots { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.dotrow { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; }
.dotrow i, .health i { width: 8px; height: 8px; border-radius: 99px; display: inline-block; background: var(--line-2); }
i.ok { background: var(--success); }
i.slow { background: var(--warning); }
i.bad { background: var(--danger); }
.health { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.corner { position: absolute; right: 12px; bottom: 10px; font-size: 10.5px; color: var(--ink-4); }
.axis { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--ink-4); margin-top: 6px; }
.incidents { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.inc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); }
.inc :deep(svg) { color: var(--warning); }
.muted { color: var(--ink-3); }
.small { font-size: 12px; }
.r { text-align: right; }
.nowrap { white-space: nowrap; }
.imps { display: flex; flex-direction: column; gap: 14px; }
.imp-t { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.ba { display: flex; align-items: center; gap: 10px; font-size: 13px; margin: 6px 0; color: var(--ink-2); flex-wrap: wrap; }
.before b { color: var(--ink-3); text-decoration: line-through; font-weight: 500; }
.after b { color: var(--success); }
.imp-bar { position: relative; height: 6px; border-radius: 99px; background: var(--bg-3); overflow: hidden; }
.imp-bar i { position: absolute; left: 0; top: 0; height: 100%; border-radius: 99px; }
.imp-bar i.b { background: color-mix(in oklch, var(--ink-4) 35%, transparent); }
.imp-bar i.a { background: var(--success); }
.imp p { margin: 4px 0 0; }
.deploys tr.current { background: var(--accent-soft); }
.msg { max-width: 420px; }
.events { list-style: none; margin: 0; padding: 0; }
.events li { display: flex; gap: 12px; padding: 14px 20px; border-top: 1px solid var(--line-1); }
.events li:first-child { border-top: 0; }
.ev-ic { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--bg-3); color: var(--ink-2); flex: none; }
@media (max-width: 1100px) { .svc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .svc-grid { grid-template-columns: 1fr; } }
</style>
