<script setup>
// Daily hub summary (spec 5.9): accepted, pending, adjustments, carrier pickup schedule.
import { computed, ref, watch, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import KpiCard from '../../components/KpiCard.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import Skeleton from '../../components/Skeleton.vue'
import { dailySummary } from '../../api/ops.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({ hub: { type: String, required: true } })
const emit = defineEmits(['go'])
const s = ref(null)
const loading = ref(true)
const error = ref('')
async function load() {
  try { s.value = await dailySummary(props.hub) } catch (e) { error.value = errorText(e) } finally { loading.value = false }
}
onMounted(load)
watch(() => props.hub, () => { loading.value = true; s.value = null; load() })
defineExpose({ load })

const loadPct = computed(() => (s.value?.capacity ? Math.min(100, Math.round((s.value.load / s.value.capacity) * 100)) : 0))
const stateTone = { done: 'tag-success', next: 'tag-accent', upcoming: '', late: 'tag-danger' }
</script>

<template>
  <div class="stack">
    <div v-if="error" class="callout danger">{{ error }}</div>
    <div class="grid-kpi">
      <KpiCard :label="t('ops.summary.accepted')" :value="s?.accepted" icon="package-check" :loading="loading" tone="success" clickable @click="emit('go', 'intake')" />
      <KpiCard :label="t('ops.summary.pending')" :value="s?.pending" icon="scan" :loading="loading" tone="warning" clickable @click="emit('go', 'intake')" />
      <KpiCard :label="t('ops.summary.adjustments')" :value="s?.adjustments.count" icon="scale" :loading="loading" :hint="s ? t('ops.summary.adjustmentsHint', { amount: fmt.money(s.adjustments.amount) }) : ''" />
      <KpiCard :label="t('ops.summary.awaiting')" :value="s?.awaitingHandover" icon="truck" :loading="loading" clickable @click="emit('go', 'handover')" />
      <KpiCard :label="t('ops.summary.handed')" :value="s?.handedOver" icon="check-circle" :loading="loading" />
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><div class="panel-title">{{ t('ops.summary.pickups') }}</div><span class="panel-sub">{{ t('ops.summary.cutoff', { time: s?.cutoff ?? '16:00' }) }}</span></div>
        <div class="panel-pad">
          <Skeleton v-if="loading" :lines="5" />
          <ol v-else class="timeline">
            <li v-for="p in s.pickups" :key="p.carrier" :class="p.state">
              <span class="time num">{{ p.time }}</span>
              <span class="dot" />
              <CarrierLogo :code="p.carrier" :size="24" show-name />
              <span class="cnt">
                <template v-if="p.count">{{ t('ops.summary.waitingN', { n: p.count }) }}</template>
                <template v-else-if="p.handed">{{ t('ops.summary.handedN', { n: p.handed }) }}</template>
              </span>
              <span class="tag" :class="stateTone[p.state]">{{ t('ops.summary.state.' + p.state) }}</span>
            </li>
          </ol>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div class="panel-title">{{ t('ops.summary.capacity') }}</div></div>
        <div class="panel-pad">
          <Skeleton v-if="loading" :lines="3" />
          <template v-else>
            <div class="cap"><strong class="num">{{ fmt.number(s.load) }}</strong> / {{ fmt.number(s.capacity) }} <span class="muted">{{ t('ops.summary.parcelsToday') }}</span></div>
            <ProgressBar :value="loadPct" :tone="loadPct > 85 ? 'danger' : loadPct > 65 ? 'warning' : 'accent'" show-value />
            <p class="muted mt"><Icon name="info" :size="12" /> {{ t('ops.summary.capacityNote') }}</p>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.timeline li { display: grid; grid-template-columns: 48px 14px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px dashed var(--line-1); font-size: 13px; }
.timeline li:last-child { border-bottom: 0; }
.time { font-weight: 600; color: var(--ink-2); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--line-2); }
.done .dot { background: var(--success); }
.next .dot { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.late .dot { background: var(--danger); }
.cnt { font-size: 12px; color: var(--ink-3); }
.cap { font-size: 14px; margin-bottom: 10px; }
.cap strong { font-size: 22px; font-family: var(--font-display); }
.muted { color: var(--ink-3); font-size: 12.5px; }
.mt { margin-top: 10px; display: flex; gap: 4px; align-items: center; }
</style>
