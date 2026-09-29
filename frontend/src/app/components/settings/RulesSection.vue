<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import Toggle from '../Toggle.vue'
import Dropdown from '../Dropdown.vue'
import EmptyState from '../EmptyState.vue'
import DateTime from '../DateTime.vue'
import SegmentedControl from '../SegmentedControl.vue'
import RuleEditor from './RuleEditor.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { can, hasFeature } from '../../store/session.js'
import { listRules, removeRule, restoreRule, setRuleActive, reorderRules, testRules, matchCondition } from '../../store/rules.js'
import { errorText } from './util.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const loading = ref(true)
const rules = ref([])
const locked = computed(() => !can('rules.manage'))
const gated = computed(() => !hasFeature('rules'))

async function load() {
  try { rules.value = await listRules() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

// ---- editor
const editorOpen = ref(false)
const editing = ref(null)
function openEditor(r = null, duplicate = false) {
  if (r && duplicate) editing.value = { ...JSON.parse(JSON.stringify(r)), id: null, name: { tr: `${r.name.tr} (${t('settings.rules.copySuffix')})`, en: `${r.name.en} (${t('settings.rules.copySuffixEn')})` } }
  else editing.value = r ? JSON.parse(JSON.stringify(r)) : null
  editorOpen.value = true
}
async function onSaved() { await load(); if (result.value) runTest() }

// ---- active / delete / order
const busy = ref(null)
async function toggleActive(r, v) {
  busy.value = r.id
  try {
    await setRuleActive(r.id, v)
    r.active = v
    toast.info(v ? t('settings.rules.enabled', { name: tx(r.name) }) : t('settings.rules.disabled', { name: tx(r.name) }), { action: { label: t('common.undo'), onClick: async () => { await setRuleActive(r.id, !v); await load() } } })
    if (result.value) runTest()
  } catch (e) { toast.error(errorText(e)) } finally { busy.value = null }
}
async function remove(r) {
  const ok = await confirm({ title: t('settings.rules.deleteTitle'), message: t('settings.rules.deleteDesc', { name: tx(r.name) }), confirmLabel: t('common.delete'), danger: true })
  if (!ok) return
  try {
    const { removed } = await removeRule(r.id)
    await load()
    const ids = rules.value.map(x => x.id)
    toast.info(t('settings.rules.deleted'), {
      action: { label: t('common.undo'), onClick: async () => { await restoreRule(removed); const order = [...ids]; order.splice(Math.max(0, (removed.priority ?? 1) - 1), 0, removed.id); await reorderRules(order); await load() } },
    })
    if (result.value) runTest()
  } catch (e) { toast.error(errorText(e)) }
}
async function persistOrder(list, announce = true) {
  const before = rules.value.map(r => r.id)
  rules.value = list.map((r, i) => ({ ...r, priority: i + 1 }))
  try {
    await reorderRules(list.map(r => r.id))
    if (announce) toast.info(t('settings.rules.reordered'), { action: { label: t('common.undo'), onClick: async () => { await reorderRules(before); await load() } } })
    if (result.value) runTest()
  } catch (e) { toast.error(errorText(e)); await load() }
}
function move(r, dir) {
  const list = [...rules.value]
  const i = list.findIndex(x => x.id === r.id)
  const j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  persistOrder(list)
}

// drag & drop
const dragId = ref(null)
const overId = ref(null)
function onDragStart(e, r) {
  if (locked.value) { e.preventDefault(); return }
  dragId.value = r.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', r.id)
}
function onDragOver(e, r) { if (dragId.value) { e.preventDefault(); overId.value = r.id } }
function onDrop(e, r) {
  e.preventDefault()
  const from = rules.value.findIndex(x => x.id === dragId.value)
  const to = rules.value.findIndex(x => x.id === r.id)
  dragId.value = null; overId.value = null
  if (from < 0 || to < 0 || from === to) return
  const list = [...rules.value]
  const [m] = list.splice(from, 1)
  list.splice(to, 0, m)
  persistOrder(list)
}
function onDragEnd() { dragId.value = null; overId.value = null }

function menu(r, i) {
  return [
    { key: 'edit', label: t('common.edit'), icon: 'edit', disabled: locked.value, onClick: () => openEditor(r) },
    { key: 'dup', label: t('settings.rules.duplicate'), icon: 'copy', disabled: locked.value, onClick: () => openEditor(r, true) },
    { key: 'up', label: t('settings.rules.moveUp'), icon: 'chevron-up', disabled: locked.value || i === 0, onClick: () => move(r, -1) },
    { key: 'down', label: t('settings.rules.moveDown'), icon: 'chevron-down', disabled: locked.value || i === rules.value.length - 1, onClick: () => move(r, 1) },
    { key: 'd', divider: true },
    { key: 'del', label: t('common.delete'), icon: 'trash', danger: true, disabled: locked.value, onClick: () => remove(r) },
  ]
}

function condText(c) {
  const v = Array.isArray(c.value) ? c.value.join(', ') : c.field === 'channel' ? t('settings.rules.channels.' + c.value) : c.field === 'declaredValue' ? fmt.money(Number(c.value)) : c.value
  return `${t('core.rules.fields.' + c.field)} ${t('core.rules.ops.' + c.op)} ${v}`
}
function actText(a) {
  const carrier = a.carrier ? db.get('carriers', a.carrier) : null
  const svc = carrier && a.service ? carrier.services.find(s => s.code === a.service)?.name : null
  const p = a.type === 'force_service' ? svc ?? `${a.carrier} ${a.service}`
    : ['force_carrier', 'exclude_carrier'].includes(a.type) ? carrier?.name ?? a.carrier
    : a.type === 'assign_hub' ? a.hub
    : a.type === 'max_transit_days' ? t('settings.rules.daysN', { n: a.value })
    : a.type === 'select_strategy' ? t('core.rules.strategies.' + a.value)
    : a.type === 'add_tag' ? a.tag : ''
  return t('core.rules.actions.' + a.type) + (p ? `: ${p}` : '')
}

// ---- tester
const testerRef = ref(null)
const mode = ref('preset')
const PRESETS = [
  { key: 'highValue', ctx: { destState: 'NY', destCountry: 'US', declaredValue: 400, weightLb: 3, channel: 'shopify', skus: [] } },
  { key: 'hawaii', ctx: { destState: 'HI', destCountry: 'US', declaredValue: 60, weightLb: 2, channel: 'etsy', skus: [] } },
  { key: 'amazon', ctx: { destState: 'IL', destCountry: 'US', declaredValue: 85, weightLb: 1.5, channel: 'amazon', skus: [] } },
  { key: 'west', ctx: { destState: 'WA', destCountry: 'US', declaredValue: 120, weightLb: 4, channel: 'shopify', skus: [] } },
]
const preset = ref('highValue')
const orderId = ref('')
const custom = reactive({ destState: 'CA', destCountry: 'US', declaredValue: 300, weightLb: 5, channel: 'etsy', skus: '' })
const testing = ref(false)
const result = ref(null)
const sampleOrders = computed(() => db.all('orders').filter(o => ['awaiting_shipment', 'on_hold'].includes(o.status)).slice(0, 60))
if (!orderId.value && sampleOrders.value.length) orderId.value = sampleOrders.value[0].id

const modeOptions = computed(() => [
  { value: 'preset', label: t('settings.rules.tester.modePreset') },
  { value: 'order', label: t('settings.rules.tester.modeOrder') },
  { value: 'custom', label: t('settings.rules.tester.modeCustom') },
])

async function runTest(scroll = false) {
  testing.value = true
  try {
    let sample
    if (mode.value === 'order') sample = orderId.value
    else if (mode.value === 'preset') sample = { ...PRESETS.find(p => p.key === preset.value).ctx }
    else sample = { ...custom, destState: custom.destState.toUpperCase(), declaredValue: Number(custom.declaredValue) || 0, weightLb: Number(custom.weightLb) || 0, skus: custom.skus.split(',').map(s => s.trim()).filter(Boolean) }
    result.value = await testRules(sample)
    if (scroll) { await nextTick(); testerRef.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  } catch (e) { toast.error(errorText(e)) } finally { testing.value = false }
}
function openTester() { runTest(true) }

const matchedIds = computed(() => new Set((result.value?.matched ?? []).map(m => m.id)))
const evaluation = computed(() => {
  if (!result.value) return []
  const ctx = result.value.ctx
  return rules.value.map(r => ({
    rule: r,
    matched: matchedIds.value.has(r.id),
    conds: (r.conditions ?? []).map(c => ({ text: condText(c), ok: matchCondition(c, ctx) })),
  }))
})
const effectRows = computed(() => {
  const e = result.value?.effects
  if (!e) return []
  const out = []
  const n = x => tx(x.ruleName)
  if (e.insurance) out.push({ k: 'insurance', text: t('settings.rules.effects.insurance'), rule: n(e.insurance) })
  if (e.signature) out.push({ k: 'signature', text: t('settings.rules.effects.signature'), rule: n(e.signature) })
  if (e.forceService) out.push({ k: 'force', text: t('settings.rules.effects.forceService', { service: actText({ type: 'force_service', carrier: e.forceService.carrier, service: e.forceService.service }).split(': ')[1] }), rule: n(e.forceService) })
  if (e.forceCarrier) out.push({ k: 'forceC', text: t('settings.rules.effects.forceCarrier', { carrier: e.forceCarrier.carrier }), rule: n(e.forceCarrier) })
  for (const x of e.excludeCarriers ?? []) out.push({ k: 'ex' + x.carrier, text: t('settings.rules.effects.exclude', { carrier: x.carrier }), rule: n(x) })
  if (e.hub) out.push({ k: 'hub', text: t('settings.rules.effects.hub', { hub: e.hub.hub }), rule: n(e.hub) })
  if (e.maxTransitDays) out.push({ k: 'max', text: t('settings.rules.effects.maxTransit', { n: e.maxTransitDays.value }), rule: n(e.maxTransitDays) })
  if (e.strategy) out.push({ k: 'strat', text: t('settings.rules.effects.strategy', { s: t('core.rules.strategies.' + e.strategy.value) }), rule: n(e.strategy) })
  for (const x of e.tags ?? []) out.push({ k: 'tag' + x.tag, text: t('settings.rules.effects.tag', { tag: x.tag }), rule: tx(rules.value.find(r => r.id === x.ruleId)?.name) })
  if (e.hold) out.push({ k: 'hold', text: t('settings.rules.effects.hold'), rule: n(e.hold) })
  return out
})
const ctxChips = computed(() => {
  const c = result.value?.ctx
  if (!c) return []
  return [
    [t('core.rules.fields.destState'), c.destState || '-'],
    [t('core.rules.fields.destCountry'), c.destCountry],
    [t('core.rules.fields.declaredValue'), fmt.money(c.declaredValue)],
    [t('core.rules.fields.weightLb'), fmt.number(c.weightLb, 1) + ' lb'],
    [t('core.rules.fields.channel'), t('settings.rules.channels.' + c.channel)],
    [t('core.rules.fields.sku'), (c.skus ?? []).join(', ') || '-'],
  ]
})
</script>

<template>
  <div class="stack-lg">
    <div v-if="gated" class="callout warn">
      <Icon name="lock" :size="14" />
      <span>{{ t('settings.rules.gated') }} <RouterLink :to="{ name: 'plan' }" class="link">{{ t('common.upgrade') }}</RouterLink></span>
    </div>
    <Card :title="t('settings.rules.title')" :subtitle="t('settings.rules.desc')" padding="none">
      <template #actions>
        <button class="btn btn-ghost btn-sm" :disabled="!rules.length || testing" @click="openTester"><Icon name="flask" :size="13" />{{ t('settings.rules.test') }}</button>
        <button class="btn btn-primary btn-sm" :disabled="locked || gated" :title="locked ? t('common.noPermission') : gated ? t('common.upgradeRequired') : undefined" @click="openEditor()"><Icon name="plus" :size="13" />{{ t('settings.rules.new') }}</button>
      </template>
      <div v-if="loading" class="pad"><Skeleton :lines="6" /></div>
      <EmptyState v-else-if="!rules.length" icon="route" :title="t('settings.rules.emptyTitle')" :description="t('settings.rules.emptyDesc')" :action-label="locked ? '' : t('settings.rules.new')" @action="openEditor()" />
      <ol v-else class="rules" :aria-label="t('settings.rules.title')">
        <li
          v-for="(r, i) in rules" :key="r.id"
          :class="['rule', { off: !r.active, dragging: dragId === r.id, over: overId === r.id && dragId !== r.id, hit: matchedIds.has(r.id) }]"
          :draggable="!locked"
          @dragstart="onDragStart($event, r)" @dragover="onDragOver($event, r)" @drop="onDrop($event, r)" @dragend="onDragEnd"
        >
          <span class="grip" :title="t('settings.rules.dragHint')" aria-hidden="true"><Icon name="grip" :size="14" /></span>
          <span class="prio mono" :aria-label="t('settings.rules.priority')">{{ i + 1 }}</span>
          <div class="rmain">
            <div class="rname">
              <strong>{{ tx(r.name) }}</strong>
              <span v-if="matchedIds.has(r.id)" class="tag tag-success"><Icon name="check" :size="11" />{{ t('settings.rules.tester.triggered') }}</span>
              <span v-if="!r.active" class="tag">{{ t('status.inactive') }}</span>
            </div>
            <div class="rline">
              <span class="lbl mono">{{ t('settings.rules.if') }}</span>
              <template v-if="r.conditions?.length">
                <template v-for="(c, ci) in r.conditions" :key="ci">
                  <span v-if="ci > 0" class="and">{{ t('core.rules.and') }}</span>
                  <span class="chip">{{ condText(c) }}</span>
                </template>
              </template>
              <span v-else class="chip">{{ t('core.rules.always') }}</span>
            </div>
            <div class="rline">
              <span class="lbl mono">{{ t('settings.rules.then') }}</span>
              <span v-for="(a, ai) in r.actions" :key="ai" class="chip act">{{ actText(a) }}</span>
            </div>
            <div class="rmeta">
              {{ t('settings.rules.triggers', { n: fmt.number(r.triggerCount ?? 0) }) }}
              <template v-if="r.lastTriggeredAt"> · {{ t('settings.rules.lastTriggered') }} <DateTime :value="r.lastTriggeredAt" /></template>
            </div>
          </div>
          <div class="rside">
            <Toggle :model-value="r.active" size="sm" :disabled="locked || busy === r.id" :aria-label="t('settings.rules.activeAria', { name: tx(r.name) })" @update:model-value="v => toggleActive(r, v)" />
            <Dropdown :items="menu(r, i)" size="sm" />
          </div>
        </li>
      </ol>
      <template v-if="rules.length" #footer>
        <div class="foot">
          <Icon name="info" :size="13" />
          <span>{{ t('settings.rules.orderHint') }}</span>
          <button class="btn-link" @click="router.push({ name: 'shipment-new' })">{{ t('settings.rules.tryInShipment') }}</button>
        </div>
      </template>
    </Card>

    <Card ref="testerRef" :title="t('settings.rules.tester.title')" :subtitle="t('settings.rules.tester.desc')">
      <div class="tester">
        <div class="tconf">
          <SegmentedControl v-model="mode" :options="modeOptions" size="sm" :aria-label="t('settings.rules.tester.title')" />
          <div v-if="mode === 'preset'" class="presets">
            <label v-for="p in PRESETS" :key="p.key" :class="['pp', { on: preset === p.key }]">
              <input v-model="preset" type="radio" :value="p.key" name="rule-preset" />
              <span class="ppt">{{ t('settings.rules.tester.presets.' + p.key) }}</span>
              <span class="pps">{{ p.ctx.destState }} · {{ fmt.money(p.ctx.declaredValue) }} · {{ t('settings.rules.channels.' + p.ctx.channel) }}</span>
            </label>
          </div>
          <div v-else-if="mode === 'order'" class="stack">
            <label class="lblx" for="rt-order">{{ t('settings.rules.tester.order') }}</label>
            <select id="rt-order" v-model="orderId" class="select">
              <option v-for="o in sampleOrders" :key="o.id" :value="o.id">{{ o.id }} · {{ o.shipTo?.city }}, {{ o.shipTo?.state }} · {{ t('settings.rules.channels.' + o.channel) }}</option>
            </select>
          </div>
          <div v-else class="cgrid">
            <label>{{ t('core.rules.fields.destState') }}<input v-model="custom.destState" class="input" maxlength="2" /></label>
            <label>{{ t('core.rules.fields.destCountry') }}<input v-model="custom.destCountry" class="input" maxlength="2" /></label>
            <label>{{ t('core.rules.fields.declaredValue') }}<input v-model="custom.declaredValue" type="number" class="input num" /></label>
            <label>{{ t('core.rules.fields.weightLb') }}<input v-model="custom.weightLb" type="number" step="0.1" class="input num" /></label>
            <label>{{ t('core.rules.fields.channel') }}
              <select v-model="custom.channel" class="select"><option v-for="c in ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce', 'manual', 'api']" :key="c" :value="c">{{ t('settings.rules.channels.' + c) }}</option></select>
            </label>
            <label>{{ t('core.rules.fields.sku') }}<input v-model="custom.skus" class="input" :placeholder="t('settings.rules.editor.listPh')" /></label>
          </div>
          <button class="btn btn-accent run" :disabled="testing || (mode === 'order' && !orderId)" @click="runTest(false)"><Spinner v-if="testing" :size="14" /><Icon v-else name="play" :size="13" />{{ t('settings.rules.test') }}</button>
        </div>

        <div class="tres" aria-live="polite">
          <div v-if="!result && !testing" class="empty-res">
            <Icon name="flask" :size="20" />
            <span>{{ t('settings.rules.tester.idle') }}</span>
          </div>
          <div v-else-if="testing && !result"><Skeleton :lines="5" /></div>
          <template v-else-if="result">
            <div class="ctx">
              <span v-for="c in ctxChips" :key="c[0]" class="kvchip"><span>{{ c[0] }}</span><b>{{ c[1] }}</b></span>
            </div>
            <div :class="['summary', result.matched.length ? 'ok' : 'none']">
              <Icon :name="result.matched.length ? 'check-circle' : 'info'" :size="15" />
              {{ result.matched.length ? t('settings.rules.tester.matchedN', { n: result.matched.length }) : t('settings.rules.tester.noneMatched') }}
            </div>
            <ul class="evals">
              <li v-for="ev in evaluation" :key="ev.rule.id" :class="{ hit: ev.matched, off: !ev.rule.active }">
                <div class="evh">
                  <Icon :name="ev.matched ? 'check-circle' : ev.rule.active ? 'x-circle' : 'minus'" :size="14" />
                  <strong>{{ tx(ev.rule.name) }}</strong>
                  <span v-if="!ev.rule.active" class="hint">{{ t('settings.rules.tester.skippedInactive') }}</span>
                </div>
                <div class="evc">
                  <span v-for="(c, i) in ev.conds" :key="i" :class="['cc', c.ok ? 'y' : 'n']">{{ c.ok ? '✓' : '✗' }} {{ c.text }}</span>
                  <span v-if="!ev.conds.length" class="cc y">✓ {{ t('core.rules.always') }}</span>
                </div>
              </li>
            </ul>
            <div v-if="effectRows.length" class="effects">
              <div class="eh">{{ t('settings.rules.tester.effects') }}</div>
              <div v-for="e in effectRows" :key="e.k" class="er"><span>{{ e.text }}</span><span class="hint">{{ e.rule }}</span></div>
            </div>
          </template>
        </div>
      </div>
    </Card>

    <RuleEditor v-model:open="editorOpen" :rule="editing" @saved="onSaved" />
  </div>
</template>

<style scoped>
.pad { padding: 18px 20px; }
.rules { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.rule { display: grid; grid-template-columns: 18px 28px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 12px 14px; border: 1px solid var(--line-1); border-radius: 12px; background: var(--surface); transition: box-shadow .15s, border-color .15s, opacity .15s; }
.rule:hover { border-color: var(--line-2); }
.rule.off { background: var(--bg-2); }
.rule.off .rmain { opacity: .65; }
.rule.dragging { opacity: .45; }
.rule.over { border-color: var(--accent); box-shadow: 0 -3px 0 var(--accent); }
.rule.hit { border-color: var(--success); box-shadow: 0 0 0 3px oklch(0.95 0.05 155); }
.grip { color: var(--ink-4); cursor: grab; padding-top: 5px; }
.prio { width: 24px; height: 24px; border-radius: 7px; background: var(--bg-3); display: grid; place-items: center; font-size: 12px; font-weight: 600; }
.rmain { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.rname { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rline { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.lbl { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-4); width: 38px; }
.and { font-size: 11.5px; color: var(--ink-3); }
.chip { font-size: 12px; padding: 2px 8px; border-radius: 6px; background: var(--bg-2); border: 1px solid var(--line-1); }
.chip.act { background: var(--accent-soft); color: var(--accent-ink); border-color: transparent; }
.rmeta { font-size: 12px; color: var(--ink-3); }
.rside { display: flex; align-items: center; gap: 6px; }
.foot { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); flex-wrap: wrap; }
.foot .btn-link { margin-left: auto; font-size: 12.5px; }
.tester { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 20px; }
.tconf { display: flex; flex-direction: column; gap: 12px; }
.presets { display: flex; flex-direction: column; gap: 6px; }
.pp { display: flex; flex-direction: column; padding: 8px 12px; border: 1px solid var(--line-2); border-radius: 9px; cursor: pointer; position: relative; }
.pp input { position: absolute; opacity: 0; }
.pp.on { border-color: var(--accent); background: var(--accent-soft); }
.pp:focus-within { box-shadow: 0 0 0 3px var(--accent-soft); }
.ppt { font-weight: 500; font-size: 13px; }
.pps { font-size: 12px; color: var(--ink-3); }
.lblx { font-size: 13px; font-weight: 500; }
.cgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cgrid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-3); }
.run { align-self: flex-start; }
.tres { min-width: 0; border-left: 1px solid var(--line-1); padding-left: 20px; display: flex; flex-direction: column; gap: 12px; }
.empty-res { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 180px; color: var(--ink-3); font-size: 13px; text-align: center; }
.ctx { display: flex; flex-wrap: wrap; gap: 6px; }
.kvchip { display: inline-flex; gap: 6px; font-size: 12px; padding: 3px 8px; border-radius: 6px; background: var(--bg-2); }
.kvchip span { color: var(--ink-3); }
.summary { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13.5px; }
.summary.ok { color: var(--success); }
.summary.none { color: var(--ink-3); }
.evals { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.evals li { padding: 8px 10px; border-radius: 9px; border: 1px solid var(--line-1); }
.evals li.hit { border-color: oklch(0.85 0.08 155); background: oklch(0.97 0.03 155); }
.evals li.off { opacity: .6; }
.evh { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.evals li.hit .evh { color: oklch(0.42 0.1 155); }
.evc { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; padding-left: 20px; }
.cc { font-size: 11.5px; }
.cc.y { color: oklch(0.45 0.1 155); }
.cc.n { color: var(--danger); }
.effects { border-top: 1px solid var(--line-1); padding-top: 10px; }
.eh { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.er { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 4px 0; }
.hint { color: var(--ink-3); font-size: 12px; }
@media (max-width: 1024px) {
  .tester { grid-template-columns: 1fr; }
  .tres { border-left: 0; padding-left: 0; border-top: 1px solid var(--line-1); padding-top: 14px; }
}
@media (max-width: 560px) { .rule { grid-template-columns: 24px minmax(0, 1fr); } .grip { display: none; } .rside { grid-column: 2; } }
</style>
