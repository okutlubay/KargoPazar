/**
 * Public (no session) backend endpoints used by the landing page (docs/BACKEND.md).
 *
 *   getPricingConfig() -> { carriers, rateCards: { platform, plans, firstMile, carrierAgreements }, countries, zipCity }
 *   createLead({ name, email, company, phone, message, ... }) -> { id }
 *
 * Both reject on network errors, timeouts and non 2xx responses so callers can fall back
 * to the bundled seed data (landing never breaks when the API is down).
 * Plain JS (no Vue) so it stays tiny in the landing bundle.
 */
export const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')

async function call(method, path, body, timeout = 6000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text().catch(() => '')
    let data = null
    if (text) { try { data = JSON.parse(text) } catch { data = null } }
    if (!res.ok) {
      const err = new Error(data?.message || `HTTP ${res.status}`)
      err.code = data?.code || `HTTP_${res.status}`
      err.status = res.status
      throw err
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

export const getPricingConfig = () => call('GET', '/public/pricing-config')
export const createLead = (lead) => call('POST', '/public/leads', lead, 10000)
