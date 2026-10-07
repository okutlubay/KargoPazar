<script setup>
// Steps 1-3 of the setup wizard (spec 5.2), reusable by the Plan screen ("Size uygun planı bulalım").
//   <OnboardingQuestions :step="0|1|2" v-model="answers" v-model:plan="chosenPlan" ref="q" />
//   q.value.validate() -> boolean (current step)
// Step 2 shows the rule based recommendation from planAdvisor.js with "Neden?" popovers;
// the user can pick another plan (v-model:plan).
import { computed, ref, nextTick } from 'vue'
import Icon from '@/components/Icon.vue'
import ChannelLogo from '../../components/ChannelLogo.vue'
import CarrierLogo from '../../components/CarrierLogo.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import WhyPopover from '../../components/shipments/WhyPopover.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import {
  advisePlan, VOLUME_OPTIONS, CHANNEL_OPTIONS, ORIGIN_OPTIONS, DESTINATION_OPTIONS,
  PRIORITY_OPTIONS, OWN_CARRIER_OPTIONS, PLAN_ORDER,
} from './planAdvisor.js'

const props = defineProps({
  step: { type: Number, default: 0 },
  modelValue: { type: Object, required: true },
  plan: { type: String, default: null },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'update:plan'])

const a = computed(() => props.modelValue)
const errors = ref({})

// `pending` keeps edits made in the same tick (before the parent re-renders) from overwriting each other.
let pending = null
const cur = () => pending ?? props.modelValue
function set(key, value) {
  pending = { ...cur(), [key]: value }
  emit('update:modelValue', pending)
  nextTick(() => { pending = null })
  if (errors.value[key]) errors.value = { ...errors.value, [key]: '' }
}
function toggleIn(key, value) {
  const arr = new Set(cur()[key] ?? [])
  arr.has(value) ? arr.delete(value) : arr.add(value)
  set(key, [...arr])
}

// ---- priorities (drag & drop + keyboard buttons)
const priorities = computed(() => {
  const p = (a.value.priorities ?? []).filter(x => PRIORITY_OPTIONS.includes(x))
  return [...p, ...PRIORITY_OPTIONS.filter(x => !p.includes(x))]
})
const dragIndex = ref(-1)
const overIndex = ref(-1)
function move(from, to) {
  if (to < 0 || to >= priorities.value.length || from === to) return
  const next = [...priorities.value]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  set('priorities', next)
}
function onDragStart(i, e) { dragIndex.value = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }
function onDragOver(i) { overIndex.value = i }
function onDrop(i) { if (dragIndex.value >= 0) move(dragIndex.value, i); dragIndex.value = -1; overIndex.value = -1 }
function onDragEnd() { dragIndex.value = -1; overIndex.value = -1 }

// ---- recommendation
const rec = computed(() => advisePlan(a.value))
const chosen = computed(() => props.plan ?? rec.value.plan)
const planInfo = computed(() => Object.fromEntries((db.doc('rate_cards')?.plans ?? []).map(p => [p.id, p])))
function planPrice(p) {
  const i = planInfo.value[p]
  if (!i) return ''
  return t('signup.onb.planPrice', { fee: fmt.money(i.monthlyFee, 'USD', 0), pct: fmt.percent(i.markupPct, 0) })
}
const PLAN_FEATURES = {
  starter: ['f1', 'f2', 'f3'],
  professional: ['f1', 'f2', 'f3', 'f4'],
  enterprise: ['f1', 'f2', 'f3', 'f4'],
}

function validate() {
  const e = {}
  if (props.step === 0) {
    if (!a.value.volume) e.volume = t('signup.onb.errors.volume')
    if (!(a.value.channels ?? []).length) e.channels = t('signup.onb.errors.channels')
    if (!a.value.origin) e.origin = t('signup.onb.errors.origin')
  }
  if (props.step === 1) {
    if (a.value.ownAccount && !(a.value.ownCarriers ?? []).length) e.ownCarriers = t('signup.onb.errors.ownCarriers')
  }
  errors.value = e
  if (Object.keys(e).length) {
    requestAnimationFrame(() => document.querySelector('.oq .q-err')?.closest('.q-block')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    return false
  }
  return true
}

defineExpose({ validate, recommendation: rec })
</script>

<template>
  <div class="oq" :class="{ compact }">
    <!-- Step 1: business -->
    <template v-if="step === 0">
      <section class="q-block">
        <h3 class="q-title">{{ t('signup.onb.q.volume') }}</h3>
        <div class="opts opts-4" role="radiogroup" :aria-label="t('signup.onb.q.volume')">
          <button v-for="v in VOLUME_OPTIONS" :key="v" type="button" role="radio" :data-testid="'onb-volume-' + v" :aria-checked="a.volume === v" class="opt" :class="{ on: a.volume === v }" @click="set('volume', v)">
            <span class="opt-main mono">{{ t('signup.onb.volume.' + v) }}</span>
            <span class="opt-sub">{{ t('signup.onb.volumeSub.' + v) }}</span>
          </button>
        </div>
        <div v-if="errors.volume" class="field-error q-err" role="alert">{{ errors.volume }}</div>
      </section>

      <section class="q-block">
        <h3 class="q-title">{{ t('signup.onb.q.channels') }} <span class="muted small">{{ t('signup.onb.multi') }}</span></h3>
        <div class="opts opts-3">
          <button v-for="c in CHANNEL_OPTIONS" :key="c" type="button" :data-testid="'onb-channel-' + c" class="opt opt-row" :aria-pressed="(a.channels ?? []).includes(c)" :class="{ on: (a.channels ?? []).includes(c) }" @click="toggleIn('channels', c)">
            <ChannelLogo :code="c" :size="26" />
            <span class="opt-main">{{ t('signup.onb.channels.' + c) }}</span>
            <Icon v-if="(a.channels ?? []).includes(c)" name="check" :size="14" class="opt-check" />
          </button>
        </div>
        <div v-if="errors.channels" class="field-error q-err" role="alert">{{ errors.channels }}</div>
      </section>

      <section class="q-block">
        <h3 class="q-title">{{ t('signup.onb.q.origin') }}</h3>
        <div class="opts opts-2" role="radiogroup" :aria-label="t('signup.onb.q.origin')">
          <button v-for="o in ORIGIN_OPTIONS" :key="o" type="button" role="radio" :data-testid="'onb-origin-' + o" :aria-checked="a.origin === o" class="opt opt-row" :class="{ on: a.origin === o }" @click="set('origin', o)">
            <span class="opt-ic"><Icon :name="o === 'tr_stock' ? 'warehouse' : o === 'tr_mixed' ? 'layers' : o === 'us_warehouse' ? 'box' : 'plane'" :size="15" /></span>
            <span class="opt-text"><span class="opt-main">{{ t('signup.onb.origin.' + o) }}</span><span class="opt-sub">{{ t('signup.onb.originSub.' + o) }}</span></span>
          </button>
        </div>
        <div v-if="errors.origin" class="field-error q-err" role="alert">{{ errors.origin }}</div>
      </section>

      <section class="q-block">
        <h3 class="q-title">{{ t('signup.onb.q.destinations') }}</h3>
        <SegmentedControl :model-value="a.destinations ?? 'nationwide'" :options="DESTINATION_OPTIONS.map(d => ({ value: d, label: t('signup.onb.dest.' + d) }))" :aria-label="t('signup.onb.q.destinations')" @update:model-value="v => set('destinations', v)" />
      </section>
    </template>

    <!-- Step 2: needs -->
    <template v-else-if="step === 1">
      <section class="q-block">
        <h3 class="q-title">{{ t('signup.onb.q.priorities') }}</h3>
        <p class="q-hint">{{ t('signup.onb.prioritiesHint') }}</p>
        <ol class="prio" :aria-label="t('signup.onb.q.priorities')">
          <li v-for="(p, i) in priorities" :key="p" class="prio-item" :class="{ dragging: dragIndex === i, over: overIndex === i && dragIndex !== i }"
            draggable="true" @dragstart="onDragStart(i, $event)" @dragover.prevent="onDragOver(i)" @drop.prevent="onDrop(i)" @dragend="onDragEnd">
            <span class="grip" aria-hidden="true"><Icon name="grip" :size="14" /></span>
            <span class="rank mono">{{ i + 1 }}</span>
            <span class="prio-text"><span class="opt-main">{{ t('signup.onb.prio.' + p) }}</span><span class="opt-sub">{{ t('signup.onb.prioSub.' + p) }}</span></span>
            <span class="prio-btns">
              <button type="button" class="btn-icon sm" :disabled="i === 0" :aria-label="t('signup.onb.moveUp', { item: t('signup.onb.prio.' + p) })" @click="move(i, i - 1)"><Icon name="chevron-up" :size="13" /></button>
              <button type="button" class="btn-icon sm" :disabled="i === priorities.length - 1" :aria-label="t('signup.onb.moveDown', { item: t('signup.onb.prio.' + p) })" @click="move(i, i + 1)"><Icon name="chevron-down" :size="13" /></button>
            </span>
          </li>
        </ol>
      </section>

      <section class="q-block">
        <h3 class="q-title">{{ t('signup.onb.q.ownAccount') }}</h3>
        <SegmentedControl :model-value="a.ownAccount ? 'yes' : 'no'" :options="[{ value: 'no', label: t('common.no') }, { value: 'yes', label: t('common.yes') }]" :aria-label="t('signup.onb.q.ownAccount')" @update:model-value="v => set('ownAccount', v === 'yes')" />
        <div v-if="a.ownAccount" class="opts opts-4 own">
          <button v-for="c in OWN_CARRIER_OPTIONS" :key="c" type="button" class="opt opt-row" :aria-pressed="(a.ownCarriers ?? []).includes(c)" :class="{ on: (a.ownCarriers ?? []).includes(c) }" @click="toggleIn('ownCarriers', c)">
            <CarrierLogo :code="c" :size="24" show-name />
            <Icon v-if="(a.ownCarriers ?? []).includes(c)" name="check" :size="14" class="opt-check" />
          </button>
        </div>
        <div v-if="errors.ownCarriers" class="field-error q-err" role="alert">{{ errors.ownCarriers }}</div>
      </section>
    </template>

    <!-- Step 3: recommendation -->
    <template v-else>
      <div class="rec-head">
        <span class="badge-ai"><Icon name="spark" :size="10" />AI</span>
        <span>{{ t('signup.onb.recIntro') }}</span>
        <span class="muted small mono">{{ t('signup.onb.confidence', { n: Math.round(rec.confidence * 100) }) }}</span>
      </div>
      <div class="plans">
        <button v-for="p in PLAN_ORDER" :key="p" type="button" :data-testid="'onb-plan-' + p" class="plan" :class="{ on: chosen === p, rec: rec.plan === p }" :aria-pressed="chosen === p" @click="emit('update:plan', p)">
          <div class="plan-top">
            <span class="plan-name">{{ t('signup.onb.plans.' + p + '.name') }}</span>
            <span v-if="rec.plan === p" class="tag tag-accent"><Icon name="spark" :size="10" />{{ t('signup.onb.recommended') }}</span>
          </div>
          <div class="plan-price mono">{{ planPrice(p) }}</div>
          <div class="plan-score">
            <div class="bar"><span :style="{ width: rec.scores[p] + '%' }" /></div>
            <span class="mono small">{{ rec.scores[p] }}</span>
          </div>
          <ul class="plan-feat">
            <li v-for="f in PLAN_FEATURES[p]" :key="f"><Icon name="check" :size="11" />{{ t('signup.onb.plans.' + p + '.' + f) }}</li>
          </ul>
          <span v-if="chosen === p" class="plan-sel"><Icon name="check-circle" :size="14" />{{ t('signup.onb.selected') }}</span>
        </button>
      </div>
      <div class="rec-why">
        <WhyPopover :title="t('signup.onb.whyPlan')" :items="rec.reasons.plan.map(r => tx(r))" :width="360" placement="bottom-start" :label="t('signup.onb.whyPlanBtn')" />
        <span v-if="chosen !== rec.plan" class="muted small">{{ t('signup.onb.overridden') }}</span>
      </div>

      <div class="rec-grid">
        <div class="rec-card">
          <div class="rec-card-head">
            <span class="opt-ic"><Icon name="warehouse" :size="15" /></span>
            <div class="grow">
              <div class="small muted">{{ t('signup.onb.hubTitle') }}</div>
              <div class="opt-main">{{ rec.hub }} · {{ t('signup.onb.hubNames.' + rec.hub) }}</div>
            </div>
            <WhyPopover :title="t('signup.onb.hubTitle')" :items="[tx(rec.reasons.hub)]" />
          </div>
        </div>
        <div v-for="s in rec.services" :key="s.code" class="rec-card">
          <div class="rec-card-head">
            <span class="opt-ic ai"><Icon name="spark" :size="13" /></span>
            <div class="grow">
              <div class="small muted">{{ t('signup.onb.serviceTitle') }}</div>
              <div class="opt-main">{{ tx(s.title) }}</div>
            </div>
            <WhyPopover :title="tx(s.title)" :items="[tx(s.reason)]" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.oq { display: flex; flex-direction: column; gap: 22px; }
.q-title { margin: 0 0 10px; font-size: 14.5px; font-weight: 600; font-family: var(--font-display); display: flex; align-items: baseline; gap: 8px; }
.q-hint { margin: -4px 0 10px; color: var(--ink-3); font-size: 13px; }
.small { font-size: 12px; }
.opts { display: grid; gap: 8px; }
.opts-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.opts-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.opts-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.own { margin-top: 12px; }
.opt { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 14px; border-radius: var(--r-md); border: 1px solid var(--line-2); background: var(--surface); text-align: left; cursor: pointer; transition: border-color .15s, box-shadow .15s, background .15s; color: var(--ink-1); }
.opt:hover { border-color: var(--line-strong); }
.opt.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); background: color-mix(in oklch, var(--accent-soft) 45%, var(--surface)); }
.opt-row { flex-direction: row; align-items: center; gap: 10px; }
.opt-main { font-weight: 600; font-size: 13.5px; }
.opt-sub { color: var(--ink-3); font-size: 12px; line-height: 1.4; }
.opt-text { display: flex; flex-direction: column; gap: 2px; }
.opt-check { margin-left: auto; color: var(--accent); }
.opt-ic { width: 30px; height: 30px; border-radius: 8px; background: var(--bg-3); display: grid; place-items: center; color: var(--ink-2); flex: none; }
.opt-ic.ai { background: var(--accent-soft); color: var(--accent); }
.prio { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.prio-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line-2); border-radius: var(--r-md); background: var(--surface); cursor: grab; transition: box-shadow .15s, border-color .15s, opacity .15s; }
.prio-item.dragging { opacity: .45; }
.prio-item.over { border-color: var(--accent); box-shadow: 0 -3px 0 var(--accent) inset; }
.grip { color: var(--ink-4); display: grid; }
.rank { width: 22px; height: 22px; border-radius: 6px; background: var(--ink-1); color: white; display: grid; place-items: center; font-size: 11.5px; font-weight: 600; flex: none; }
.prio-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.prio-btns { display: flex; gap: 2px; }
.btn-icon.sm { width: 26px; height: 26px; }
.btn-icon:disabled { opacity: .35; cursor: default; }
.rec-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13.5px; color: var(--ink-2); }
.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.plan { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: var(--r-lg); border: 1px solid var(--line-2); background: var(--surface); text-align: left; cursor: pointer; color: var(--ink-1); transition: border-color .15s, box-shadow .15s; }
.plan:hover { border-color: var(--line-strong); }
.plan.rec { border-style: dashed; border-color: var(--accent-2); }
.plan.on { border-style: solid; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.plan-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
.plan-name { font-family: var(--font-display); font-weight: 600; font-size: 15px; }
.plan-price { font-size: 13px; color: var(--ink-2); }
.plan-score { display: flex; align-items: center; gap: 8px; }
.plan-score .bar { flex: 1; height: 5px; border-radius: 5px; background: var(--bg-3); overflow: hidden; }
.plan-score .bar span { display: block; height: 100%; background: var(--accent); border-radius: 5px; transition: width .3s; }
.plan-feat { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink-2); }
.plan-feat li { display: flex; gap: 6px; align-items: flex-start; }
.plan-feat :deep(svg) { margin-top: 3px; color: var(--success); flex: none; }
.plan-sel { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--accent); }
.rec-why { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: -8px; }
.rec-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.rec-card { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px 14px; background: var(--bg); }
.rec-card-head { display: flex; align-items: center; gap: 10px; }
.grow { flex: 1; min-width: 0; }
.compact .opts-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.compact .plans, .compact .rec-grid { grid-template-columns: 1fr; }
@media (max-width: 860px) {
  .opts-4, .opts-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .opts-2, .plans, .rec-grid { grid-template-columns: 1fr; }
}
</style>
