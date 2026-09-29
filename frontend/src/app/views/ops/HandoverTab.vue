<script setup>
// Carrier handover (spec 5.9): today's accepted parcels grouped by carrier, "mark handed over".
import { ref, watch, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Spinner from '../../components/Spinner.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import DateTime from '../../components/DateTime.vue'
import { handoverGroups, markHandedOver } from '../../api/ops.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { confirm } from '../../components/confirm.js'
import { toast } from '../../components/toast.js'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({ hub: { type: String, required: true } })
const emit = defineEmits(['changed', 'go-intake'])
const data = ref(null)
const loading = ref(true)
const error = ref('')
const busy = ref('')
const expanded = ref({})

async function load() {
  error.value = ''
  try { data.value = await handoverGroups(props.hub) } catch (e) { error.value = errorText(e, ['ops.errors']) } finally { loading.value = false }
}
onMounted(load)
watch(() => props.hub, () => { loading.value = true; data.value = null; load() })

async function handOver(g) {
  const ok = await confirm({
    title: t('ops.handover.confirmTitle', { carrier: g.carrierName, n: g.count }),
    message: g.unmanifested ? t('ops.handover.confirmNewManifest', { n: g.unmanifested }) : t('ops.handover.confirmDesc', { manifests: g.manifestIds.join(', ') }),
    confirmLabel: t('ops.handover.mark'),
  })
  if (!ok) return
  busy.value = g.carrier
  try {
    const r = await markHandedOver(props.hub, g.carrier)
    toast.success(t('ops.handover.done', { n: r.shipmentIds.length, carrier: g.carrierName, manifests: r.manifests.map(m => m.id).join(', ') }))
    await load()
    emit('changed')
  } catch (e) {
    toast.error(errorText(e, ['ops.errors']))
  } finally { busy.value = '' }
}
</script>

<template>
  <div class="stack">
    <div v-if="error" class="callout danger">{{ error }} <button class="btn-link" @click="load">{{ t('common.retry') }}</button></div>
    <div v-if="loading" class="grid-2"><Skeleton variant="rect" :height="140" /><Skeleton variant="rect" :height="140" /></div>
    <template v-else-if="data">
      <div class="panel-title">{{ t('ops.handover.pendingTitle') }}</div>
      <EmptyState v-if="!data.pending.length" class="panel" icon="truck" :title="t('ops.handover.emptyTitle')" :description="t('ops.handover.emptyDesc')" :action-label="t('ops.handover.goIntake')" action-icon="scan" @action="emit('go-intake')" />
      <div v-else class="groups">
        <section v-for="g in data.pending" :key="g.carrier" class="panel group">
          <header class="g-head">
            <CarrierLogo :code="g.carrier" :size="34" />
            <div class="g-title">
              <strong>{{ g.carrierName }}</strong>
              <div class="sub"><Icon name="clock" :size="12" /> {{ g.pickupTime ? t('ops.handover.pickupAt', { time: g.pickupTime }) : t('ops.handover.noPickup') }}</div>
            </div>
            <div class="g-stats">
              <div><span>{{ t('ops.handover.parcels') }}</span><strong class="num">{{ fmt.number(g.count) }}</strong></div>
              <div><span>{{ t('ops.handover.weight') }}</span><strong class="num">{{ fmt.weight(g.weightLb) }}</strong></div>
            </div>
          </header>
          <div class="g-body">
            <div class="mf">
              <span class="lbl">{{ t('ops.handover.manifests') }}</span>
              <RouterLink v-for="m in g.manifestIds" :key="m" :to="`/manifests/${m}`" class="tag tag-accent">{{ m }}</RouterLink>
              <span v-if="g.unmanifested" class="tag tag-warning">{{ t('ops.handover.unmanifested', { n: g.unmanifested }) }}</span>
            </div>
            <button class="btn-link sm" @click="expanded[g.carrier] = !expanded[g.carrier]">{{ expanded[g.carrier] ? t('ops.handover.hideList') : t('ops.handover.showList') }}</button>
            <table v-if="expanded[g.carrier]" class="table-simple">
              <tbody>
                <tr v-for="s in g.shipments" :key="s.id">
                  <td><RouterLink :to="`/shipments/${s.id}`" class="link mono">{{ s.id }}</RouterLink></td>
                  <td class="mono small">{{ s.trackingNo }}</td>
                  <td class="small">{{ s.to?.city }}, {{ s.to?.state }}</td>
                  <td class="num small r">{{ fmt.weight(s.measured?.weightLb ?? s.package?.weightLb) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="g-foot">
            <button class="btn btn-accent" :disabled="!!busy || !can('ops.manage')" :title="can('ops.manage') ? '' : t('common.noPermission')" @click="handOver(g)">
              <Spinner v-if="busy === g.carrier" :size="14" /><Icon v-else name="truck" :size="15" /> {{ t('ops.handover.mark') }}
            </button>
          </footer>
        </section>
      </div>

      <div class="panel-title mt">{{ t('ops.handover.todayTitle') }}</div>
      <div v-if="!data.handedToday.length" class="panel empty">{{ t('ops.handover.todayEmpty') }}</div>
      <div v-else class="panel">
        <table class="table-simple">
          <thead><tr><th>{{ t('ops.handover.carrier') }}</th><th>{{ t('ops.handover.parcels') }}</th><th>{{ t('ops.handover.handedAt') }}</th><th>{{ t('ops.handover.manifests') }}</th></tr></thead>
          <tbody>
            <tr v-for="g in data.handedToday" :key="g.carrier">
              <td><CarrierLogo :code="g.carrier" :size="22" show-name /></td>
              <td class="num">{{ fmt.number(g.count) }}</td>
              <td><DateTime :value="g.handedOverAt" mode="short" /></td>
              <td><RouterLink v-for="m in g.manifestIds" :key="m" :to="`/manifests/${m}`" class="link mono mr">{{ m }}</RouterLink></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.group { display: flex; flex-direction: column; }
.g-head { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line-1); }
.g-title { flex: 1; min-width: 0; }
.sub { font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.g-stats { display: flex; gap: 14px; }
.g-stats div { display: flex; flex-direction: column; align-items: flex-end; }
.g-stats span { font-size: 11px; color: var(--ink-3); }
.g-stats strong { font-size: 16px; }
.g-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.mf { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lbl { font-size: 12px; color: var(--ink-3); }
.g-foot { padding: 12px 16px; border-top: 1px solid var(--line-1); display: flex; justify-content: flex-end; background: var(--bg-2); border-radius: 0 0 var(--r-lg) var(--r-lg); }
.mono { font-family: var(--font-mono); font-size: 12px; }
.small { font-size: 12.5px; }
.r { text-align: right; }
.mt { margin-top: 10px; }
.mr { margin-right: 8px; }
.empty { padding: 16px 18px; color: var(--ink-3); font-size: 13px; }
.btn-link.sm { font-size: 12.5px; align-self: flex-start; }
</style>
