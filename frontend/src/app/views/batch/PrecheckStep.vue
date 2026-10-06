<script setup>
// Batch step 1, pre-check (spec 5.7): address score < 70, missing packages, missing HS codes (international).
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Spinner from '../../components/Spinner.vue'
import ScoreBadge from '../../components/ScoreBadge.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import { applyAddressSuggestion, undoAddressSuggestion, estimatePackages } from '../../api/orders.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { hasKey } from '../../components/billing/apiErrors.js'
import { can } from '../../store/session.js'
import { toast } from '../../components/toast.js'
import { t, fmt } from '../../i18n/index.js'

const props = defineProps({
  orders: { type: Array, required: true }, // eligible orders (awaiting_shipment)
  skipped: { type: Array, default: () => [] }, // [{ order, reason }] not eligible (held, labeled, cancelled)
  excluded: { type: Array, required: true }, // v-model:excluded order ids
})
const emit = defineEmits(['update:excluded', 'refresh'])

const busy = ref('')
const lowScore = computed(() => props.orders.filter(o => (o.addressCheck?.score ?? 100) < 70))
const noPackage = computed(() => props.orders.filter(o => !o.package))
const intlMissingHs = computed(() => props.orders.filter(o => (o.shipTo?.country ?? 'US') !== 'US' && (o.items ?? []).some(i => !i.hsCode)))
const isExcluded = id => props.excluded.includes(id)
function setExcluded(id, v) {
  const s = new Set(props.excluded)
  v ? s.add(id) : s.delete(id)
  emit('update:excluded', [...s])
}
const issueLabel = o => {
  const code = o.addressCheck?.issueType ?? o.addressCheck?.issues?.[0]?.code
  return code && hasKey('batch.issues.' + code) ? t('batch.issues.' + code) : (code ?? '-')
}
const suggestion = o => {
  const p = o.addressCheck?.suggestion?.patch
  return p ? Object.values(p).join(', ') : null
}

async function applyFix(o) {
  busy.value = o.id
  try {
    const r = await applyAddressSuggestion(o.id)
    const score = r.order.addressCheck.score
    if (score >= 70) setExcluded(o.id, false)
    emit('refresh')
    toast.success(t('batch.pre.fixed', { id: o.id, before: o.addressCheck.score, after: score }), {
      action: { label: t('common.undo'), onClick: async () => { await undoAddressSuggestion(r.undo); setExcluded(o.id, true); emit('refresh') } },
    })
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = '' }
}
async function applyAll() {
  const list = lowScore.value.filter(o => o.addressCheck?.suggestion?.patch)
  if (!list.length) return
  busy.value = 'all'
  let fixed = 0
  const undos = []
  try {
    for (const o of list) {
      try {
        const r = await applyAddressSuggestion(o.id)
        undos.push({ id: o.id, undo: r.undo })
        if (r.order.addressCheck.score >= 70) { setExcluded(o.id, false); fixed++ }
      } catch {}
    }
    emit('refresh')
    toast.success(t('batch.pre.fixedAll', { n: fixed, total: list.length }), {
      action: { label: t('common.undo'), onClick: async () => { for (const u of undos) { await undoAddressSuggestion(u.undo); setExcluded(u.id, true) } emit('refresh') } },
    })
  } finally { busy.value = '' }
}
async function estimate() {
  busy.value = 'pkg'
  try {
    const r = await estimatePackages(noPackage.value.map(o => o.id))
    emit('refresh')
    toast.success(t('batch.pre.estimated', { n: r.length }))
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = '' }
}
const fmtPkg = p => `${fmt.dimsDual(p)} · ${fmt.weightDual(p.weightLb)}`
const excludedLow = computed(() => lowScore.value.filter(o => isExcluded(o.id)).length)
</script>

<template>
  <div class="pre">
    <!-- address -->
    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title"><Icon :name="lowScore.length ? 'alert' : 'check-circle'" :size="15" :class="lowScore.length ? 'warn' : 'ok'" /> {{ t('batch.pre.addressTitle') }}</div>
          <div class="panel-sub">{{ lowScore.length ? t('batch.pre.addressSummary', { n: lowScore.length, excluded: excludedLow }) : t('batch.pre.addressOk') }}</div>
        </div>
        <button v-if="lowScore.some(o => o.addressCheck?.suggestion?.patch)" class="btn btn-soft btn-sm" :disabled="!!busy || !can('orders.manage')" @click="applyAll">
          <Spinner v-if="busy === 'all'" :size="12" /><Icon v-else name="wand" :size="13" /> {{ t('batch.pre.applyAll') }}
        </button>
      </div>
      <div v-if="lowScore.length" class="table-wrap">
        <table class="table-simple">
          <thead><tr><th>{{ t('batch.col.order') }}</th><th>{{ t('batch.col.recipient') }}</th><th>{{ t('batch.col.score') }}</th><th>{{ t('batch.pre.issue') }}</th><th>{{ t('batch.pre.suggestion') }}</th><th class="r">{{ t('batch.pre.decision') }}</th></tr></thead>
          <tbody>
            <tr v-for="o in lowScore" :key="o.id" :class="{ dim: isExcluded(o.id) }">
              <td><div class="oid"><ChannelLogo :code="o.channel" :size="18" /><RouterLink :to="`/orders/${o.id}`" class="link mono">{{ o.id }}</RouterLink></div></td>
              <td>{{ o.shipTo?.name }}<div class="muted">{{ o.shipTo?.line1 }} {{ o.shipTo?.line2 }}, {{ o.shipTo?.city }}, {{ o.shipTo?.state }} {{ o.shipTo?.zip }}</div></td>
              <td><ScoreBadge :score="o.addressCheck?.score" size="sm" /></td>
              <td class="small">{{ issueLabel(o) }}</td>
              <td class="small">
                <template v-if="suggestion(o)"><span class="sug">{{ suggestion(o) }}</span>
                  <button class="btn btn-ghost btn-xs" :disabled="!!busy || !can('orders.manage')" @click="applyFix(o)"><Spinner v-if="busy === o.id" :size="11" /> {{ t('common.apply') }}</button>
                </template>
                <span v-else class="muted">{{ t('batch.pre.noSuggestion') }}</span>
              </td>
              <td class="r">
                <label class="checkbox small"><input type="checkbox" :checked="!isExcluded(o.id)" @change="setExcluded(o.id, !$event.target.checked)" /> {{ t('batch.pre.includeAnyway') }}</label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- packages -->
    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title"><Icon :name="noPackage.length ? 'alert' : 'check-circle'" :size="15" :class="noPackage.length ? 'warn' : 'ok'" /> {{ t('batch.pre.pkgTitle') }}</div>
          <div class="panel-sub">{{ noPackage.length ? t('batch.pre.pkgSummary', { n: noPackage.length }) : t('batch.pre.pkgOk') }}</div>
        </div>
        <button v-if="noPackage.length" class="btn btn-soft btn-sm" :disabled="!!busy || !can('orders.manage')" @click="estimate">
          <Spinner v-if="busy === 'pkg'" :size="12" /><Icon v-else name="scale" :size="13" /> {{ t('batch.pre.estimate') }}
        </button>
      </div>
      <div v-if="noPackage.length" class="chips">
        <span v-for="o in noPackage" :key="o.id" class="tag"><span class="mono">{{ o.id }}</span> · {{ t('batch.pre.itemsN', { n: (o.items ?? []).reduce((s, i) => s + (i.qty || 1), 0) }) }}</span>
      </div>
      <div v-else-if="orders.some(o => o.packageEstimated)" class="chips">
        <span v-for="o in orders.filter(x => x.packageEstimated)" :key="o.id" class="tag tag-accent"><span class="mono">{{ o.id }}</span> · {{ fmtPkg(o.package) }}</span>
      </div>
    </section>

    <!-- HS -->
    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title"><Icon :name="intlMissingHs.length ? 'alert' : 'check-circle'" :size="15" :class="intlMissingHs.length ? 'warn' : 'ok'" /> {{ t('batch.pre.hsTitle') }}</div>
          <div class="panel-sub">{{ intlMissingHs.length ? t('batch.pre.hsSummary', { n: intlMissingHs.length }) : t('batch.pre.hsOk') }}</div>
        </div>
        <RouterLink v-if="intlMissingHs.length" to="/ai/hs" class="btn btn-soft btn-sm"><Icon name="tag" :size="13" /> {{ t('batch.pre.hsFix') }}</RouterLink>
      </div>
    </section>

    <!-- skipped -->
    <section v-if="skipped.length" class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title"><Icon name="info" :size="15" /> {{ t('batch.pre.skippedTitle') }}</div>
          <div class="panel-sub">{{ t('batch.pre.skippedDesc', { n: skipped.length }) }}</div>
        </div>
      </div>
      <div class="chips">
        <span v-for="s in skipped" :key="s.order.id" class="tag"><RouterLink :to="`/orders/${s.order.id}`" class="mono">{{ s.order.id }}</RouterLink> · {{ t('status.' + s.order.status) }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pre { display: flex; flex-direction: column; gap: 14px; }
.panel-title { display: flex; align-items: center; gap: 6px; }
.warn { color: oklch(0.6 0.14 70); }
.ok { color: var(--success); }
.oid { display: flex; align-items: center; gap: 6px; }
.mono { font-family: var(--font-mono); font-size: 12.5px; }
.muted { color: var(--ink-3); font-size: 12px; }
.small { font-size: 12.5px; }
.sug { background: oklch(0.95 0.05 155); color: oklch(0.38 0.1 155); padding: 1px 6px; border-radius: 4px; margin-right: 6px; }
.r { text-align: right; }
tr.dim td { opacity: .6; }
tr.dim td:last-child { opacity: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 20px 16px; }
</style>
