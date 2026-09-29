<script setup>
// "Manifest oluştur" (spec 5.8): type, hub, carrier, date -> unmanifested labels of that day -> create.
// Air cargo: destination hub, origin, flight -> first mile shipments waiting at the origin point.
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../../components/Modal.vue'
import Spinner from '../../components/Spinner.vue'
import Skeleton from '../../components/Skeleton.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import DateTime from '../../components/DateTime.vue'
import { toYmd } from '../../components/FilterBar.vue'
import { manifestCandidates, createManifest, airOrigins } from '../../api/manifests.js'
import { US_HUB_CODES } from '../../api/ops.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../../components/toast.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const props = defineProps({ open: { type: Boolean, default: false }, preset: { type: Object, default: null } })
const emit = defineEmits(['update:open', 'created'])

const type = ref('carrier')
const hub = ref('NJ01')
const carrier = ref('')
const date = ref(toYmd(new Date()))
const origin = ref('')
const flight = ref('')
const items = ref([])
const otherDates = ref([])
const flights = ref([])
const selected = ref([])
const loading = ref(false)
const creating = ref(false)
const error = ref('')
const fieldErr = ref({})

const hubCarriers = computed(() => (db.all('hubs').find(h => h.code === hub.value)?.carrierPickups ?? []).map(p => p.carrier))
const origins = computed(() => airOrigins(hub.value))

watch(() => props.open, v => {
  if (!v) return
  error.value = ''
  fieldErr.value = {}
  type.value = props.preset?.type ?? 'carrier'
  hub.value = props.preset?.hub ?? db.doc('user')?.company?.defaultHub ?? 'NJ01'
  carrier.value = props.preset?.carrier ?? hubCarriers.value[0] ?? 'UPS'
  date.value = toYmd(new Date())
  origin.value = ''
  flight.value = ''
  load()
}, { immediate: true })

watch(hub, () => {
  if (!hubCarriers.value.includes(carrier.value)) carrier.value = hubCarriers.value[0] ?? ''
  if (!origins.value.some(o => o.country === origin.value)) origin.value = ''
})
watch(origin, () => { flight.value = '' })
watch([type, hub, carrier, date, origin], () => { if (props.open) load() })

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    if (type.value === 'air_customs') {
      if (!origin.value) origin.value = origins.value[0]?.country ?? ''
      const r = await manifestCandidates({ type: 'air_customs', hub: hub.value, origin: origin.value })
      if (my !== seq) return
      items.value = r.items
      flights.value = r.flights
      if (!flights.value.includes(flight.value)) flight.value = flights.value[0] ?? ''
      otherDates.value = []
    } else {
      const r = await manifestCandidates({ type: 'carrier', hub: hub.value, carrier: carrier.value, date: date.value })
      if (my !== seq) return
      items.value = r.items
      otherDates.value = r.otherDates
    }
    selected.value = items.value.map(i => i.id)
  } catch (e) {
    if (my === seq) error.value = errorText(e, ['manifests.errors'])
  } finally { if (my === seq) loading.value = false }
}

const allOn = computed(() => items.value.length && selected.value.length === items.value.length)
function toggleAll() { selected.value = allOn.value ? [] : items.value.map(i => i.id) }
function toggle(id) { selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id] }

const selItems = computed(() => items.value.filter(i => selected.value.includes(i.id)))
const totals = computed(() => type.value === 'air_customs'
  ? { n: selItems.value.length, parcels: selItems.value.reduce((s, i) => s + (i.parcelCount || 0), 0), kg: selItems.value.reduce((s, i) => s + (i.totalWeightKg || 0), 0), value: selItems.value.reduce((s, i) => s + (i.declaredValueUsd || 0), 0) }
  : { n: selItems.value.length, lb: selItems.value.reduce((s, i) => s + (i.package?.weightLb || 0), 0) })
const missingHs = computed(() => type.value === 'air_customs' ? selItems.value.filter(i => (i.parcels ?? []).some(p => (p.items ?? []).some(x => !x.hsCode))).map(i => i.id) : [])

const svcName = s => db.get('carriers', s.carrier)?.services?.find(x => x.code === s.service)?.name ?? s.service
const originName = code => db.get('countries', code)?.name ? tx(db.get('countries', code).name) : code
const fmtDay = ymd => fmt.date(new Date(ymd + 'T12:00:00').toISOString())

async function submit() {
  const e = {}
  if (type.value === 'carrier' && !carrier.value) e.carrier = t('common.validation.required')
  if (type.value === 'air_customs' && !origin.value) e.origin = t('common.validation.required')
  if (type.value === 'air_customs' && !flight.value) e.flight = t('common.validation.required')
  fieldErr.value = e
  if (Object.keys(e).length) return
  if (!selected.value.length) { error.value = t('manifests.create.noneSelected'); return }
  creating.value = true
  try {
    const m = type.value === 'air_customs'
      ? await createManifest({ type: 'air_customs', hub: hub.value, origin: origin.value, flight: flight.value, intlIds: selected.value })
      : await createManifest({ type: 'carrier', hub: hub.value, carrier: carrier.value, date: date.value, shipmentIds: selected.value })
    toast.success(t('manifests.create.done', { id: m.id, n: m.parcels }))
    emit('created', m)
    emit('update:open', false)
  } catch (err) {
    error.value = errorText(err, ['manifests.errors'])
  } finally { creating.value = false }
}
</script>

<template>
  <Modal :open="open" :title="t('manifests.create.title')" :subtitle="t('manifests.create.subtitle')" size="lg" :closable="!creating" @update:open="v => emit('update:open', v)">
    <div class="cm">
      <SegmentedControl v-model="type" block :options="[{ value: 'carrier', label: t('manifests.types.carrier'), icon: 'truck' }, { value: 'air_customs', label: t('manifests.types.air_customs'), icon: 'plane' }]" />
      <div class="filters">
        <label class="fld">
          <span>{{ type === 'air_customs' ? t('manifests.create.destHub') : t('manifests.create.hub') }}</span>
          <select v-model="hub" class="select"><option v-for="h in US_HUB_CODES" :key="h" :value="h">{{ h }}</option></select>
        </label>
        <template v-if="type === 'carrier'">
          <label class="fld">
            <span>{{ t('manifests.create.carrier') }}</span>
            <select v-model="carrier" class="select" :class="{ invalid: fieldErr.carrier }">
              <option v-for="c in hubCarriers" :key="c" :value="c">{{ db.get('carriers', c)?.name ?? c }}</option>
            </select>
          </label>
          <label class="fld">
            <span>{{ t('manifests.create.date') }}</span>
            <input v-model="date" type="date" class="input" :max="toYmd(new Date())" />
          </label>
        </template>
        <template v-else>
          <label class="fld">
            <span>{{ t('manifests.create.origin') }}</span>
            <select v-model="origin" class="select" :class="{ invalid: fieldErr.origin }">
              <option v-for="o in origins" :key="o.country" :value="o.country">{{ originName(o.country) }} · {{ tx(o.name) }}</option>
            </select>
          </label>
          <label class="fld">
            <span>{{ t('manifests.create.flight') }}</span>
            <select v-model="flight" class="select" :class="{ invalid: fieldErr.flight }" :disabled="!flights.length">
              <option v-for="f in flights" :key="f" :value="f">{{ f }}</option>
            </select>
          </label>
        </template>
      </div>
      <p v-if="type === 'carrier'" class="hint">{{ carrier === 'USPS' ? t('manifests.create.scanFormHint') : t('manifests.create.eodHint') }}</p>
      <p v-else class="hint">{{ t('manifests.create.airHint') }}</p>

      <div class="list-head">
        <label v-if="items.length" class="checkbox"><input type="checkbox" :checked="allOn" @change="toggleAll" /> {{ t('manifests.create.selectAll', { n: items.length }) }}</label>
        <span v-else class="panel-sub">{{ t('manifests.create.candidates') }}</span>
        <span class="sel">{{ t('manifests.create.selected', { n: selected.length }) }}</span>
      </div>
      <div class="list">
        <Skeleton v-if="loading" :lines="5" class="pad" />
        <div v-else-if="!items.length" class="empty">
          <Icon name="box" :size="22" />
          <div>
            <strong>{{ type === 'air_customs' ? t('manifests.create.emptyAir') : t('manifests.create.emptyCarrier', { date: fmtDay(date) }) }}</strong>
            <div v-if="otherDates.length" class="others">{{ t('manifests.create.otherDates') }}
              <button v-for="d in otherDates.slice(0, 5)" :key="d.date" class="tag chip" @click="date = d.date">{{ fmtDay(d.date) }} ({{ d.count }})</button>
            </div>
          </div>
        </div>
        <template v-else-if="type === 'carrier'">
          <label v-for="s in items" :key="s.id" class="item">
            <input type="checkbox" :checked="selected.includes(s.id)" @change="toggle(s.id)" />
            <CarrierLogo :code="s.carrier" :size="22" />
            <span class="mono id">{{ s.id }}</span>
            <span class="mono trk">{{ s.trackingNo }}</span>
            <span class="svc">{{ svcName(s) }}</span>
            <span class="to">{{ s.to?.city }}, {{ s.to?.state }}</span>
            <span class="num w">{{ fmt.weight(s.package?.weightLb) }}</span>
            <span class="when"><DateTime :value="s.createdAt" mode="short" /></span>
          </label>
        </template>
        <template v-else>
          <label v-for="s in items" :key="s.id" class="item air">
            <input type="checkbox" :checked="selected.includes(s.id)" @change="toggle(s.id)" />
            <span class="mono id">{{ s.id }}</span>
            <span class="to">{{ s.sender?.company || s.sender?.name }}</span>
            <span class="tag">{{ t('manifests.stages.' + s.stage) }}</span>
            <span class="num">{{ t('manifests.create.parcelsN', { n: s.parcelCount }) }}</span>
            <span class="num w">{{ fmt.number(s.totalWeightKg, 1) }} kg</span>
            <span class="num w">{{ fmt.money(s.declaredValueUsd) }}</span>
          </label>
        </template>
      </div>
      <div v-if="missingHs.length" class="callout warn"><Icon name="alert" /> {{ t('manifests.create.missingHs', { ids: missingHs.join(', ') }) }} <RouterLink to="/customs" class="link">{{ t('manifests.create.fixHs') }}</RouterLink></div>
      <div v-if="selected.length" class="totals">
        <template v-if="type === 'air_customs'">{{ t('manifests.create.totalsAir', { n: totals.n, parcels: totals.parcels, kg: fmt.number(totals.kg, 1), value: fmt.money(totals.value) }) }}</template>
        <template v-else>{{ t('manifests.create.totalsCarrier', { n: totals.n, weight: fmt.weight(totals.lb) }) }}</template>
      </div>
      <div v-if="error" class="callout danger" role="alert">{{ error }}</div>
    </div>
    <template #footer>
      <button class="btn btn-ghost" :disabled="creating" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="creating || loading || !selected.length || !can('shipments.create')" @click="submit">
        <Spinner v-if="creating" :size="14" /> {{ t('manifests.create.submit', { n: selected.length }) }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.cm { display: flex; flex-direction: column; gap: 12px; }
.filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink-2); }
.select, .input { width: 100%; }
.hint { margin: 0; font-size: 12px; color: var(--ink-3); }
.list-head { display: flex; justify-content: space-between; align-items: center; }
.sel { font-size: 12.5px; color: var(--ink-3); }
.list { border: 1px solid var(--line-1); border-radius: var(--r-md); max-height: 320px; overflow-y: auto; }
.pad { padding: 12px; }
.item { display: grid; grid-template-columns: 18px 24px 90px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 60px 110px; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line-1); font-size: 12.5px; cursor: pointer; }
.item:last-child { border-bottom: 0; }
.item.air { grid-template-columns: 18px 80px minmax(0, 1.5fr) auto 80px 70px 90px; }
.item:hover { background: var(--bg-2); }
.item input { accent-color: var(--accent); }
.mono { font-family: var(--font-mono); font-size: 12px; }
.trk, .svc, .to { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w { text-align: right; color: var(--ink-2); }
.when { color: var(--ink-3); font-size: 11.5px; text-align: right; }
.empty { display: flex; gap: 12px; align-items: flex-start; padding: 18px; color: var(--ink-3); font-size: 13px; }
.empty strong { color: var(--ink-2); font-weight: 500; }
.others { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.chip { cursor: pointer; border: 0; }
.chip:hover { background: var(--accent-soft); color: var(--accent-ink); }
.totals { font-size: 13px; color: var(--ink-2); font-weight: 500; }
@media (max-width: 760px) {
  .filters { grid-template-columns: 1fr; }
  .item { grid-template-columns: 18px 24px 1fr 1fr; }
  .item .svc, .item .when, .item .trk { display: none; }
}
</style>
