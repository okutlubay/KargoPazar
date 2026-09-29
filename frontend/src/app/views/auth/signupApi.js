/**
 * Self service signup + onboarding wizard API (spec 5.2).
 * Lives next to the auth views because it is only used by the signup / onboarding flow
 * (and by the Plan screen, which reads user.onboardingAnswers).
 *
 * signupStart({ name, email, company, password }) -> { signupId, email }     POST /v1/signup
 *   errors: VALIDATION (details {field: code}), EMAIL_TAKEN (demo@kargopazar.com)
 * signupResend(signupId) -> { sent: true }
 * signupVerify(signupId, code) -> { username, name }                         POST /v1/signup/verify
 *   code 246810 (demo). INVALID_CODE otherwise. On success a demo session starts: the signup never
 *   creates a new company, the wizard continues on the demo account (spec 5.2 "Önemli").
 * getOnboarding() -> { answers, progress, signup }
 * saveOnboardingProgress({ step, maxReached, answers, chosenPlan }) -> progress   (user.onboardingProgress)
 * completeOnboarding({ answers, recommendation, chosenPlan, stores, topup }) -> onboardingAnswers
 *   Writes user.onboardingAnswers = { ...answers, recommendedPlan, chosenPlan, hub, services: [code],
 *   stores: [channel], topupAmount, completedAt, signup: { name, email, company } | null }
 *   and clears the progress. The demo company plan is NOT changed (the Plan screen shows the answers).
 */
import { request, ApiError } from '../../api/client.js'
import { db } from '../../store/db.js'
import { startSession } from '../../store/session.js'
import { audit, notify } from '../../store/events.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEMO_CODE = '246810'
const nowIso = () => new Date().toISOString()
const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

export function passwordChecks(pw) {
  const s = String(pw ?? '')
  return { length: s.length >= 8, upper: /[A-ZÇĞİÖŞÜ]/.test(s), digit: /\d/.test(s), symbol: /[^A-Za-z0-9ÇĞİÖŞÜçğıöşü\s]/.test(s) }
}

export function signupStart(input = {}) {
  return request('POST /v1/signup', () => {
    const e = {}
    const name = String(input.name ?? '').trim()
    const email = String(input.email ?? '').trim().toLowerCase()
    const company = String(input.company ?? '').trim()
    if (name.length < 3) e.name = name ? 'min_length' : 'required'
    if (!email) e.email = 'required'
    else if (!EMAIL_RE.test(email)) e.email = 'email'
    if (!company) e.company = 'required'
    const pc = passwordChecks(input.password)
    if (!Object.values(pc).every(Boolean)) e.password = 'weak'
    if (!input.terms) e.terms = 'required'
    if (Object.keys(e).length) throw new ApiError('VALIDATION', 'Invalid signup', 422, e)
    if (email === String(db.doc('user')?.email ?? '').toLowerCase()) throw new ApiError('EMAIL_TAKEN', 'Email already registered', 409, { email: 'taken' })
    const id = 'SGN-' + Date.now().toString(36).toUpperCase()
    db.insert('signups', { id, at: nowIso(), name, email, company, verified: false, attempts: 0 })
    audit('signup.start', id, email)
    return { signupId: id, email }
  }, { minMs: 600, maxMs: 1000 })
}

export function signupResend(signupId) {
  return request('POST /v1/signup/resend', () => {
    if (!db.get('signups', signupId)) throw new ApiError('NOT_FOUND', 'Signup not found', 404)
    return { sent: true }
  }, { minMs: 400, maxMs: 700 })
}

export function signupVerify(signupId, code) {
  return request('POST /v1/signup/verify', () => {
    const s = db.get('signups', signupId)
    if (!s) throw new ApiError('NOT_FOUND', 'Signup not found', 404)
    const c = String(code ?? '').replace(/\D/g, '')
    if (c !== DEMO_CODE) {
      db.update('signups', signupId, { attempts: (s.attempts ?? 0) + 1 })
      throw new ApiError('INVALID_CODE', 'Invalid verification code', 422, { code: 'invalid' })
    }
    db.update('signups', signupId, { verified: true, verifiedAt: nowIso() })
    const user = db.doc('user')
    // Continue on the demo account (no new company is created).
    db.patchDoc('user', { onboardingProgress: { step: 0, maxReached: 0, answers: null, chosenPlan: null, signupId, startedAt: nowIso() } })
    startSession(user.username, false)
    audit('signup.verify', signupId, s.email)
    return { username: user.username, name: user.name }
  }, { minMs: 500, maxMs: 900 })
}

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
