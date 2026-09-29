<script setup>
// Schematic horizontal first mile route (spec 9.1): origin flag -> consolidation -> plane ->
// US flag (customs) -> US hub -> last mile. Nodes up to the current stage are highlighted.
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Flag from './Flag.vue'
import { useI18n } from '@/app/i18n/index.js'
import { STAGES } from '@/app/api/intl.js'

const props = defineProps({
  record: { type: Object, required: true },
  compact: { type: Boolean, default: false },
})
const { t } = useI18n()

const idx = computed(() => STAGES.indexOf(props.record.stage))
const port = computed(() => (props.record.route || '').split('-')[1] || (props.record.destHub === 'LA01' ? 'LAX' : 'JFK'))
const fromPort = computed(() => (props.record.route || '').split('-')[0] || props.record.consolidationCode || props.record.originPoint)

const nodes = computed(() => {
  const r = props.record
  const n = r.lastMileLabelCount || 0
  return [
    { key: 'origin', at: 0, flag: r.origin, title: t('intl.route.origin'), sub: r.sender?.city || r.origin },
    { key: 'consolidation', at: 1, icon: 'warehouse', title: t('intl.route.consolidation'), sub: r.consolidationCode || r.originPoint },
    { key: 'flight', at: 3, icon: 'plane', title: t('intl.route.flight'), sub: r.flight ? r.flight.split(' ').slice(0, 2).join(' ') : fromPort.value + '-' + port.value },
    { key: 'customs', at: 4, flag: 'US', title: t('intl.route.customs'), sub: port.value },
    { key: 'hub', at: 6, icon: 'warehouse', title: t('intl.route.hub'), sub: r.destHub },
    { key: 'lastmile', at: 7, icon: r.lastMile === 'store' ? 'box' : 'truck', title: t('intl.route.lastMile'), sub: r.lastMile === 'store' ? t('intl.route.stored') : (n ? t('intl.route.labels', { n }) : t('intl.route.direct')) },
  ]
})

function state(node, i) {
  const next = nodes.value[i + 1]
  if (idx.value >= 9) return 'done'
  if (idx.value < node.at) return 'todo'
  if (!next || idx.value < next.at) return 'current'
  return 'done'
}
function segFill(i) {
  // fraction of the connector between node i and i+1
  const a = nodes.value[i].at, b = nodes.value[i + 1].at
  if (idx.value >= b) return 1
  if (idx.value < a) return 0
  return Math.max(0.15, (idx.value - a + 0.5) / (b - a + 0.5))
}
</script>

<template>
  <div class="kpz-route" :class="{ compact }" role="img" :aria-label="t('intl.route.aria', { stage: t('intl.stages.' + record.stage) })">
    <template v-for="(node, i) in nodes" :key="node.key">
      <div class="node" :class="state(node, i)" :title="compact ? node.title + ': ' + node.sub : ''">
        <span class="dot">
          <Flag v-if="node.flag" :code="node.flag" :size="compact ? 9 : 12" />
          <Icon v-else :name="node.icon" :size="compact ? 11 : 14" />
        </span>
        <span v-if="!compact" class="lbl">
          <span class="t">{{ node.title }}</span>
          <span class="s">{{ node.sub || '-' }}</span>
        </span>
      </div>
      <div v-if="i < nodes.length - 1" class="seg" :class="{ air: node.key === 'consolidation' || node.key === 'flight' }">
        <span class="fill" :style="{ width: (segFill(i) * 100) + '%' }" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.kpz-route { display: flex; align-items: flex-start; width: 100%; min-width: 0; }
.node { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 0 0 auto; width: 76px; text-align: center; }
.dot { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--bg-3); color: var(--ink-4); border: 1.5px solid var(--line-2); transition: all .2s; }
.node.done .dot { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-2); }
.node.current .dot { background: var(--accent); color: #fff; border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.lbl { display: flex; flex-direction: column; gap: 1px; min-width: 0; max-width: 100%; }
.lbl .t { font-size: 11.5px; font-weight: 600; color: var(--ink-2); }
.node.todo .lbl .t { color: var(--ink-3); font-weight: 500; }
.lbl .s { font-size: 11px; color: var(--ink-3); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seg { flex: 1 1 auto; height: 2px; background: var(--line-2); margin-top: 16px; position: relative; min-width: 10px; border-radius: 2px; overflow: hidden; }
.seg.air { background: repeating-linear-gradient(90deg, var(--line-2) 0 5px, transparent 5px 9px); }
.seg .fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); transition: width .3s; }
.compact { align-items: center; }
.compact .node { width: auto; }
.compact .dot { width: 20px; height: 20px; border-width: 1px; }
.compact .node.current .dot { box-shadow: 0 0 0 2px var(--accent-soft); }
.compact .seg { margin-top: 0; min-width: 6px; }
@media (max-width: 860px) {
  .kpz-route:not(.compact) .node { width: 52px; }
  .kpz-route:not(.compact) .lbl .s { display: none; }
  .kpz-route:not(.compact) .lbl .t { font-size: 10.5px; }
}
@media (max-width: 560px) {
  .kpz-route:not(.compact) .node { width: auto; }
  .kpz-route:not(.compact) .lbl { display: none; }
  .kpz-route:not(.compact) .dot { width: 28px; height: 28px; }
  .kpz-route:not(.compact) .seg { margin-top: 13px; min-width: 4px; }
}
</style>
