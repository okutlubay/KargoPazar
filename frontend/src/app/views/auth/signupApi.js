/**
 * Onboarding wizard API (spec 5.2). There is no self-serve signup: /signup redirects to the
 * landing early-access form and the team opens accounts. The wizard runs on the signed-in account
 * (and the Plan screen reads user.onboardingAnswers).
 *
 * getOnboarding() -> { answers, progress, signup }
 *   `signup` is a legacy `signups` record linked from onboardingProgress.signupId (null otherwise).
 * saveOnboardingProgress({ step, maxReached, answers, chosenPlan }) -> progress   (user.onboardingProgress)
 * completeOnboarding({ answers, recommendation, chosenPlan, stores, topup }) -> onboardingAnswers
 *   Writes user.onboardingAnswers = { ...answers, recommendedPlan, chosenPlan, hub, services: [code],
 *   stores: [channel], topupAmount, completedAt, signup: { name, email, company } | null }
 *   and clears the progress. The demo company plan is NOT changed (the Plan screen shows the answers).
 */
import { request } from '../../api/client.js'
import { db } from '../../store/db.js'
import { audit, notify } from '../../store/events.js'

const nowIso = () => new Date().toISOString()
const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

export function getOnboarding() {
  return request('GET /v1/onboarding', () => {
    const user = db.doc('user')
    const progress = user.onboardingProgress ?? null
    const signup = progress?.signupId ? db.get('signups', progress.signupId) ?? null : null
    return { answers: plain(user.onboardingAnswers ?? null), progress: plain(progress), signup: plain(signup) }
  }, { minMs: 200, maxMs: 400 })
}

export function saveOnboardingProgress({ step = 0, maxReached = 0, answers = null, chosenPlan = null } = {}) {
  return request('PUT /v1/onboarding/progress', () => {
    const prev = db.doc('user').onboardingProgress ?? {}
    const progress = { ...prev, step, maxReached, answers: plain(answers), chosenPlan, updatedAt: nowIso() }
    db.patchDoc('user', { onboardingProgress: progress })
    return progress
  }, { minMs: 80, maxMs: 160 })
}

export function completeOnboarding({ answers, recommendation, chosenPlan, stores = [], topup = null } = {}) {
  return request('POST /v1/onboarding/complete', () => {
    const user = db.doc('user')
    const progress = user.onboardingProgress ?? {}
    const signup = progress.signupId ? db.get('signups', progress.signupId) : null
    const rec = plain(recommendation) ?? {}
    const saved = {
      ...plain(answers),
      recommendedPlan: rec.plan ?? null,
      chosenPlan: chosenPlan ?? rec.plan ?? null,
      scores: rec.scores ?? null,
      hub: rec.hub ?? null,
      services: (rec.services ?? []).map(s => s.code),
      stores: [...stores],
      topupAmount: topup,
      completedAt: nowIso(),
      signup: signup ? { name: signup.name, email: signup.email, company: signup.company } : null,
    }
    db.patchDoc('user', { onboardingAnswers: saved, onboardingProgress: null })
    audit('onboarding.complete', user.username, saved.chosenPlan)
    notify({
      type: 'success',
      title: { tr: 'Kurulum sihirbazı tamamlandı', en: 'Setup wizard completed' },
      body: { tr: 'Cevaplarınız ve plan öneriniz Plan ekranına kaydedildi.', en: 'Your answers and plan recommendation were saved to the Plan screen.' },
      link: '/plan',
    })
    return saved
  }, { minMs: 400, maxMs: 700 })
}
