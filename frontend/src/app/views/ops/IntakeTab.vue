<script setup>
// Parcel intake (spec 5.9): scan input (Enter), sample scan, parcel card, queue and recent intake.
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import Icon from '@/components/Icon.vue'
import Spinner from '../../components/Spinner.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import DateTime from '../../components/DateTime.vue'
import Money from '../../components/Money.vue'
import ParcelCard from '../../components/ops/ParcelCard.vue'
import { lookupParcel, nextSampleScan, intakeQueue, recentIntake } from '../../api/ops.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { t, fmt } from '../../i18n/index.js'
import Weight from '../../components/Weight.vue'

const props = defineProps({ hub: { type: String, required: true } })
const emit = defineEmits(['switch-hub', 'changed'])

const code = ref('')
const input = ref(null)
const scanning = ref(false)
const parcel = ref(null)
const scanError = ref(null)
const queue = ref([])
const recent = ref([])
const loadingLists = ref(true)

async function loadLists() {
  try {
    const [q, r] = await Promise.all([intakeQueue(props.hub), recentIntake(props.hub)])
    queue.value = q
    recent.value = r
  } finally { loadingLists.value = false }
}
onMounted(() => { loadLists(); focusInput() })
watch(() => props.hub, () => { parcel.value = null; scanError.value = null; code.value = ''; loadingLists.value = true; loadLists(); focusInput() })

function focusInput() { nextTick(() => input.value?.focus()) }

async function scan(value = code.value) {
  const c = String(value ?? '').trim()
  scanError.value = null
  if (!c) { scanError.value = { text: t('ops.errors.SCAN_EMPTY') }; focusInput(); return }
  scanning.value = true
  try {
    parcel.value = await lookupParcel(props.hub, c)
    code.value = ''
  } catch (e) {
    parcel.value = null
    scanError.value = { code: e.code, text: errorText(e, ['ops.errors'], { hub: e.details?.hub }), hub: e.details?.hub, shipmentId: e.details?.shipmentId }
  } finally {
    scanning.value = false
    if (!parcel.value) focusInput()
  }
}

function sample() {
  const next = nextSampleScan(props.hub, parcel.value ? [parcel.value.shipment.id] : [])
  if (!next) { scanError.value = { text: t('ops.intake.queueEmpty') }; return }
  code.value = next
  scan(next)
}

function onAccepted() { loadLists(); emit('changed') }
function scanNext() { parcel.value = null; focusInput() }
const svc = s => s.service
</script>

<template>
  <div class="intake">
    <div class="main">
      <section class="panel scanbox">
        <form class="scan" @submit.prevent="scan()">
          <Icon name="scan" :size="20" class="scan-ic" />
          <input ref="input" v-model="code" class="input scan-in mono" :placeholder="t('ops.intake.scanPh')" autocomplete="off" spellcheck="false" :aria-label="t('ops.intake.scanPh')" :disabled="scanning" />
          <button class="btn btn-primary" type="submit" :disabled="scanning"><Spinner v-if="scanning" :size="14" /> {{ t('ops.intake.process') }}</button>
          <button class="btn btn-ghost" type="button" :disabled="scanning" @click="sample"><Icon name="play" :size="13" /> {{ t('ops.intake.sample') }}</button>
        </form>
        <p class="scan-hint">{{ t('ops.intake.scanHint') }}</p>
        <div v-if="scanError" class="callout" :class="scanError.code === 'WRONG_HUB' ? 'warn' : 'danger'" role="alert">
          <Icon name="alert" />
          <div>
            {{ scanError.text }}
            <button v-if="scanError.code === 'WRONG_HUB'" class="btn-link" @click="emit('switch-hub', scanError.hub)">{{ t('ops.intake.switchHub', { hub: scanError.hub }) }}</button>
            <RouterLink v-else-if="scanError.shipmentId" :to="`/shipments/${scanError.shipmentId}`" class="link">{{ scanError.shipmentId }}</RouterLink>
          </div>
        </div>
      </section>

      <ParcelCard v-if="parcel" :key="parcel.shipment.id" :parcel="parcel" @accepted="onAccepted" @next="scanNext" @close="scanNext" />
      <section v-else class="panel placeholder">
        <EmptyState icon="scan" :title="t('ops.intake.waitingTitle')" :description="t('ops.intake.waitingDesc', { n: queue.length })" :action-label="queue.length ? t('ops.intake.sample') : ''" action-icon="play" compact @action="sample" />
      </section>
    </div>

    <aside class="side">
      <section class="panel">
        <div class="panel-head"><div class="panel-title">{{ t('ops.intake.queue') }}</div><span class="tag">{{ fmt.number(queue.length) }}</span></div>
        <Skeleton v-if="loadingLists" :lines="4" class="pad" />
        <div v-else-if="!queue.length" class="empty">{{ t('ops.intake.queueEmpty') }}</div>
        <ul v-else class="list">
          <li v-for="s in queue.slice(0, 8)" :key="s.id">
            <button class="row" @click="code = s.trackingNo; scan(s.trackingNo)">
              <CarrierLogo :code="s.carrier" :size="22" />
              <span class="mono trk">{{ s.trackingNo }}</span>
              <span class="when"><DateTime :value="s.createdAt" /></span>
            </button>
          </li>
          <li v-if="queue.length > 8" class="more">{{ t('ops.intake.more', { n: queue.length - 8 }) }}</li>
        </ul>
      </section>
      <section class="panel">
        <div class="panel-head"><div class="panel-title">{{ t('ops.intake.recent') }}</div></div>
        <Skeleton v-if="loadingLists" :lines="3" class="pad" />
        <div v-else-if="!recent.length" class="empty">{{ t('ops.intake.recentEmpty') }}</div>
        <ul v-else class="list">
          <li v-for="r in recent" :key="r.shipmentId" class="rrow">
            <CarrierLogo :code="r.carrier" :size="22" />
            <RouterLink :to="`/shipments/${r.shipmentId}`" class="link mono">{{ r.shipmentId }}</RouterLink>
            <span class="num w"><Weight :lb="r.weightLb" :mono="false" /></span>
            <span v-if="r.delta" class="tag tag-warning">+<Money :value="r.delta" :mono="false" /></span>
            <span v-else class="tag tag-success"><Icon name="check" :size="11" /></span>
          </li>
        </ul>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.intake { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.scanbox { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.scan { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.scan-ic { color: var(--ink-3); }
.scan-in { flex: 1; min-width: 220px; height: 44px; font-size: 15px; }
.mono { font-family: var(--font-mono); }
.scan-hint { margin: 0; font-size: 12px; color: var(--ink-3); }
.placeholder { padding: 12px; }
.side { display: flex; flex-direction: column; gap: 16px; }
.pad { padding: 14px 18px; }
.empty { padding: 14px 18px; color: var(--ink-3); font-size: 13px; }
.list { list-style: none; margin: 0; padding: 6px 8px 10px; }
.row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 0; background: transparent; border-radius: 8px; cursor: pointer; text-align: left; font-size: 12.5px; }
.row:hover { background: var(--bg-2); }
.trk { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { color: var(--ink-3); font-size: 11.5px; white-space: nowrap; }
.more { font-size: 12px; color: var(--ink-3); padding: 4px 10px; }
.rrow { display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 12.5px; }
.rrow .w { margin-left: auto; color: var(--ink-3); }
@media (max-width: 1100px) { .intake { grid-template-columns: 1fr; } }
</style>
