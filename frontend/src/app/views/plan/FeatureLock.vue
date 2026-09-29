<script setup>
// Plan feature gate (spec 5.11): shows an upgrade call when the current plan lacks `feature`.
//   <FeatureLock feature="batch"> ...screen... </FeatureLock>
// Usable by any screen whose route has meta.feature (batch, api, webhooks, intl, customs, team, rules, customRates).
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { hasFeature, session, PLAN_FEATURES } from '../../store/session.js'
import { db } from '../../store/db.js'
import { t, tx, fmt } from '../../i18n/index.js'

const props = defineProps({ feature: { type: String, required: true }, title: { type: String, default: '' } })
const router = useRouter()
const allowed = computed(() => hasFeature(props.feature))
const minPlan = computed(() => ['starter', 'professional', 'enterprise'].find(p => (PLAN_FEATURES[p] ?? []).includes(props.feature)) ?? 'enterprise')
const planRec = computed(() => (db.doc('rate_cards')?.plans ?? []).find(p => p.id === minPlan.value))
const current = computed(() => (db.doc('rate_cards')?.plans ?? []).find(p => p.id === session.plan))
</script>

<template>
  <slot v-if="allowed" />
  <div v-else class="page">
    <div class="lock panel">
      <div class="ic"><Icon name="lock" :size="26" /></div>
      <h2>{{ title || t('plan.lock.title', { feature: t('plan.features.' + feature) }) }}</h2>
      <p>{{ t('plan.lock.desc', { current: tx(current?.name), plan: tx(planRec?.name) }) }}</p>
      <div class="price" v-if="planRec">{{ t('plan.lock.price', { plan: tx(planRec.name), fee: fmt.money(planRec.monthlyFee, 'USD', 0) }) }}</div>
      <div class="acts">
        <button class="btn btn-accent" @click="router.push({ path: '/plan', query: { upgrade: minPlan } })"><Icon name="star" :size="14" /> {{ t('plan.lock.cta', { plan: tx(planRec?.name) }) }}</button>
        <button class="btn btn-ghost" @click="router.push('/')">{{ t('common.goHome') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lock { max-width: 560px; margin: 60px auto; padding: 36px 32px; text-align: center; }
.ic { width: 60px; height: 60px; margin: 0 auto 14px; border-radius: 16px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
h2 { font-family: var(--font-display); font-size: 21px; margin: 0 0 8px; }
p { color: var(--ink-2); margin: 0 0 12px; line-height: 1.5; }
.price { font-size: 13px; color: var(--ink-3); margin-bottom: 18px; }
.acts { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
</style>
