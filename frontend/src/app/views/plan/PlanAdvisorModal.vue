<script setup>
// "Size uygun planı bulalım" (spec 5.11): setup wizard steps 1-3 in a modal, rule based recommendation.
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '../../components/Modal.vue'
import Stepper from '../../components/Stepper.vue'
import Spinner from '../../components/Spinner.vue'
import OnboardingQuestions from '../auth/OnboardingQuestions.vue'
import { emptyAnswers, advisePlan } from '../auth/planAdvisor.js'
import { saveAdvisorResult } from '../../api/plan.js'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { db } from '../../store/db.js'
import { t } from '../../i18n/index.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'saved', 'choose'])

const step = ref(0)
const maxReached = ref(0)
const answers = ref(emptyAnswers())
const chosen = ref(null)
const q = ref(null)
const saving = ref(false)

watch(() => props.open, v => {
  if (!v) return
  step.value = 0
  maxReached.value = 0
  const prev = db.doc('user')?.onboardingAnswers
  const base = emptyAnswers()
  answers.value = prev ? Object.fromEntries(Object.keys(base).map(k => [k, prev[k] ?? base[k]])) : base
  chosen.value = null
}, { immediate: true })

const steps = computed(() => [
  { key: 'business', label: t('plan.advisor.steps.business') },
  { key: 'needs', label: t('plan.advisor.steps.needs') },
  { key: 'result', label: t('plan.advisor.steps.result') },
])

function next() {
  if (!q.value?.validate()) return
  step.value = Math.min(2, step.value + 1)
  maxReached.value = Math.max(maxReached.value, step.value)
}
function back() { step.value = Math.max(0, step.value - 1) }

async function save(andChoose = false) {
  saving.value = true
  try {
    const rec = advisePlan(answers.value)
    const saved = await saveAdvisorResult({ answers: answers.value, recommendation: rec, chosenPlan: chosen.value ?? rec.plan })
    toast.success(t('plan.advisor.saved'))
    emit('saved', saved)
    emit('update:open', false)
    if (andChoose) emit('choose', chosen.value ?? rec.plan)
  } catch (e) {
    toast.error(errorText(e))
  } finally { saving.value = false }
}
const currentPlan = () => db.doc('user')?.company?.plan
</script>

<template>
  <Modal :open="open" :title="t('plan.advisor.title')" :subtitle="t('plan.advisor.subtitle')" size="lg" :closable="!saving" @update:open="v => emit('update:open', v)">
    <div class="adv">
      <Stepper v-model:current="step" :steps="steps" :max-reached="maxReached" />
      <OnboardingQuestions ref="q" v-model="answers" v-model:plan="chosen" :step="step" compact />
    </div>
    <template #footer>
      <button v-if="step > 0" class="btn btn-ghost" :disabled="saving" @click="back"><Icon name="chevron-left" :size="14" /> {{ t('common.back') }}</button>
      <span class="spacer" />
      <template v-if="step < 2">
        <button class="btn btn-ghost" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" @click="next">{{ step === 1 ? t('plan.advisor.seeResult') : t('common.next') }} <Icon name="chevron-right" :size="14" /></button>
      </template>
      <template v-else>
        <button class="btn btn-ghost" :disabled="saving" @click="save(false)"><Spinner v-if="saving" :size="14" /> {{ t('plan.advisor.save') }}</button>
        <button v-if="(chosen ?? advisePlan(answers).plan) !== currentPlan()" class="btn btn-accent" :disabled="saving" @click="save(true)">{{ t('plan.advisor.saveAndSwitch') }}</button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.adv { display: flex; flex-direction: column; gap: 18px; }
.spacer { flex: 1; }
</style>
