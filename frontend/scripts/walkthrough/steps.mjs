// Walkthrough steps (Excel order). Each step starts from a known route (full page load), so a failure in one
// step does not cascade. `session` picks the signed-in account: 'demo' (seller panel) or 'admin' (Yönetim).
// Captions come from texts.json (Turkish video content, not app UI).
export const tid = id => `[data-testid="${id}"]`

export function buildSteps(h) {
  const { page, sleep } = h
  const T = (k, v) => h.caption(v ? fill(k, v) : k)
  const capOf = id => key => h.caption(h.TEXTS.steps[id]?.captions?.[key] ?? key)

  /** Waits until the "busy" quote list is idle (compare screen and step 4 of shipments). */
  async function quotesIdle() {
    await page.locator(tid('offer-card')).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForFunction(() => !document.querySelector('[data-testid="quote-comparison"].busy'), null, { timeout: 20_000 })
    await sleep(500)
  }

  const steps = []

  // ------------------------------------------------------------------------------------------------- Opening
  steps.push({
    id: 'open', session: 'none', ownBand: true,
    async run() {
      const c = capOf('open')
      await page.goto(h.BASE_URL + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      await h.band({ left: 'Açılış', center: 'KargoPazar: ABD\'ye satan e-ticaret satıcıları için tek panel' })
      await c('landing')
      await h.idle(3000)
      await c('currency')
      await h.select(tid('landing-currency'), 'TRY')
      await h.idle(1200)
      await c('calc')
      await h.scrollTo('#calc', { block: 'start' })
      await h.select('#calc-origin', 'fm:TR')
      await h.type('#calc-zip', '90210')
      await page.locator(tid('landing-offer-card')).first().waitFor({ state: 'visible', timeout: 15_000 })
      await sleep(800)
      await c('offers')
      await h.point(page.locator(tid('landing-offer-card')).first())
      await h.idle(2500)
      const checks = page.locator(tid('landing-compare-checkbox'))
      if (await checks.count() >= 2) {
        await h.click(checks.nth(0))
        await h.click(checks.nth(1))
        await h.idle(1200)
      }
      await c('customs')
      const toggle = page.locator(tid('landing-customs-toggle')).first()
      if (await toggle.isVisible().catch(() => false)) {
        await h.click(toggle)
        await h.scrollTo(tid('landing-customs-box'))
        await h.idle(3000)
      }
      await c('demo')
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await sleep(1200)
      await h.click(tid('hero-demo'), { delay: 0 })
      await page.waitForURL(/\/app\//, { timeout: 20_000 })
      await page.locator(tid('login-identifier')).waitFor({ timeout: 20_000 })
      await h.band({ left: 'Açılış', center: 'Canlı demo: panel girişi' })
      await c('login')
      await h.type(tid('login-identifier'), 'demo')
      await h.type(tid('login-password'), 'Demo123!')
      await h.click(tid('login-submit'), { delay: 0 })
      await page.waitForFunction(() => /#\/(\?|$)/.test(location.hash) || location.hash === '#/', null, { timeout: 30_000 })
      h.session = 'demo'
      // keep the session in this tab only (the recorder swaps tokens for admin screens)
      await page.evaluate(() => {
        try {
          const s = localStorage.getItem('kpz_demo:session')
          if (s) { sessionStorage.setItem('kpz_demo:session', s); localStorage.removeItem('kpz_demo:session') }
        } catch {}
      })
      await h.settle(800)
      await h.band({ left: 'Açılış', center: 'Genel Bakış' })
      await c('overview')
      await h.scrollTo(tid('overview-us-stock-card'))
      await h.point(tid('overview-us-stock-card'))
      await h.idle(3500)
      await c('marketplace')
      await h.scrollTo(tid('marketplace-summary'))
      await h.point(tid('marketplace-summary'))
      await h.idle(3000)
    },
  })

  // ------------------------------------------------------------------------------------------------- Compare
  steps.push({
    id: 'compare', route: '/compare',
    async run() {
      const c = capOf('compare')
      await c('form')
      await quotesIdle()
      await h.click(`${tid('compare-origin')} [role=radio] >> nth=0`)
      await h.type(tid('compare-zip'), '90210')
      await h.type(tid('compare-weight'), '2')
      await h.type(tid('compare-value'), '60')
      await sleep(700)
      await quotesIdle()
      await c('offers')
      await h.point(page.locator(tid('offer-card')).first())
      await h.idle(2500)
      await c('select')
      const cards = page.locator(tid('offer-card'))
      for (let i = 0; i < 3; i++) await h.click(cards.nth(i).locator(tid('compare-checkbox')))
      await h.scrollTo(tid('compare-bar'))
      await h.click(tid('compare-open'))
      await h.wait(tid('compare-sheet'))
      await c('sheet')
      await h.idle(4000)
      await c('ai')
      await h.scrollTo(tid('ai-summary'))
      await h.point(tid('ai-summary'))
      await h.idle(3500)
      await h.click(tid('drawer-close'))
      await c('chart')
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await sleep(600)
      await h.click(`${tid('view-switcher')} [role=radio] >> nth=2`)
      await h.wait(tid('offer-chart'))
      await h.scrollTo(tid('offer-chart'))
      await h.point(tid('offer-chart'))
      await h.idle(2500)
    },
  })

  // ------------------------------------------------------------------------------------------------- İP1
  steps.push({
    id: '1', no: 1, session: 'admin', route: '/admin/rnd', presentation: false,
    async run() {
      const c = capOf('1')
      await h.wait(tid('rnd-summary'))
      await c('summary')
      await h.point(tid('rnd-summary'))
      await h.idle(2500)
      await c('gantt')
      await h.point(tid('rnd-gantt'))
      await h.idle(3000)
      await c('toggle')
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await sleep(500)
      const sw = page.getByRole('switch', { name: 'Sunum modu' })
      if ((await sw.getAttribute('aria-checked')) !== 'true') await h.click(sw)
      await h.idle(2000)
      await c('list')
      await h.scrollTo('#rd-RD-01')
      await h.point('#rd-RD-01')
      await h.idle(2500)
      await h.scrollBy(500)
    },
  })

  steps.push({
    id: '2', no: 2, route: '/integrations/api?tab=console&endpoint=rates',
    async run() {
      const c = capOf('2')
      await c('console')
      await h.wait(tid('api-console-endpoint'))
      await page.waitForFunction(() => !document.querySelector('.res-col .skeleton, [data-testid="api-console-send"][disabled]'), null, { timeout: 10_000 }).catch(() => {})
      await h.select(tid('api-console-endpoint'), 'rates')
      await h.idle(1500)
      await c('send')
      await h.click(tid('api-console-send'))
      await h.wait(tid('api-console-status'))
      await c('response')
      await h.point(tid('api-console-status'))
      await h.scrollBy(300)
      await h.idle(3000)
      await c('log')
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await sleep(500)
      await h.click(tid('tab-logs'))
      await h.settle(800)
      await h.idle(3000)
    },
  })

  steps.push({
    id: '3', no: 3, route: '/ai',
    async run() {
      const c = capOf('3')
      await c('hub')
      await h.idle(2000)
      await c('diagram')
      await h.scrollTo(tid('ai-arch-diagram'))
      await h.idle(1500)
      await c('hover')
      for (const m of ['address', 'forecast', 'pricing', 'optimizer', 'hs']) {
        const n = page.locator(tid('arch-mod-' + m))
        if (await n.count()) { await h.point(n); await h.idle(1800) }
      }
    },
  })

  steps.push({
    id: '4', no: 4, route: '/intl/tests',
    async run() {
      const c = capOf('4')
      await c('suites')
      await h.wait(tid('run-suite-SUITE-US'))
      await h.point(tid('suite-SUITE-US'))
      await h.idle(1500)
      await c('run')
      await h.click(tid('run-suite-SUITE-US'))
      await h.wait(tid('test-progress'))
      await c('log')
      await page.waitForSelector(`${tid('test-progress')}[data-running="false"]`, { timeout: 60_000 })
      await c('done')
      await h.point(tid('test-progress'))
      await h.idle(2500)
    },
  })

  steps.push({
    id: '5', no: 5, route: '/orders?addressScore=lt70',
    async run() {
      const c = capOf('5')
      await c('list')
      await h.idle(2500)
      await h.nav('/orders/ORD-10402')
      await c('order')
      await h.wait(tid('order-apply-suggestion'))
      await h.point(tid('order-address-score'))
      await h.idle(2500)
      await c('apply')
      await h.click(tid('order-apply-suggestion'))
      await page.locator(tid('order-apply-suggestion')).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
      await c('score')
      await h.point(tid('order-address-score'))
      await h.idle(3000)
      await h.nav('/ai/address')
      await c('compare')
      await h.wait(tid('ai-address-compare'))
      await h.scrollTo(tid('ai-address-compare'))
      await h.point(tid('ai-address-compare'))
      await h.idle(3000)
    },
  })

  steps.push({
    id: '6', no: 6, session: 'admin', route: '/admin/system',
    async run() {
      const c = capOf('6')
      await c('services')
      await h.settle(800)
      await h.point('article.svc >> nth=0')
      await h.idle(3000)
      await c('improve')
      await h.scrollBy(700)
      await h.idle(2500)
      await c('deploys')
      await h.scrollTo(tid('deploy-history'))
      await h.point(tid('deploy-history'))
      await h.idle(3000)
    },
  })

  steps.push({
    id: '7', no: 7, route: '/ops?hub=NJ01&tab=intake',
    async run() {
      const c = capOf('7')
      await c('hub')
      await h.wait(tid('ops-sample-scan'))
      await h.idle(1500)
      await c('scan')
      await h.click(tid('ops-sample-scan'))
      await h.wait(tid('ops-parcel-card'))
      await h.idle(1200)
      await c('scale')
      await h.click(tid('ops-read-scale'))
      await page.waitForFunction(() => !document.querySelector('[data-testid="ops-read-scale"][disabled]'), null, { timeout: 15_000 })
      await h.idle(1200)
      await c('accept')
      await h.click(tid('ops-check-all'))
      await h.click(tid('ops-accept'))
      await h.wait(tid('ops-accepted'))
      await h.idle(2000)
      await c('handover')
      await h.click(tid('tab-handover'))
      await h.settle(800)
      const mark = page.locator('[data-testid^="handover-mark-"]').first()
      await mark.waitFor({ timeout: 15_000 })
      await h.scrollTo(mark)
      await h.idle(1500)
      await h.click(mark)
      await h.click(`[role=dialog] ${tid('confirm-ok')}`)
      await c('handed')
      await h.idle(2500)
    },
  })

  steps.push({
    id: '8', no: 8, route: '/ops?hub=NJ01&tab=intake',
    async run() {
      const c = capOf('8')
      await c('scan')
      await h.wait(tid('ops-scan-input'))
      await h.type(tid('ops-scan-input'), '1ZA7K2941370440534')
      await page.keyboard.press('Enter')
      await h.wait(tid('ops-parcel-card'))
      await h.click(tid('ops-read-scale'))
      await h.wait(tid('ops-diff'))
      await c('diff')
      await h.point(tid('ops-diff'))
      await h.idle(2500)
      await h.click(tid('ops-check-all'))
      await h.click(tid('ops-accept'))
      await h.wait(tid('ops-accepted'))
      await c('charged')
      await h.idle(2500)
      await h.nav('/billing?tab=adjustments')
      await c('adjust')
      await h.idle(3500)
      await h.nav('/shipments/SHP-20919')
      await c('void')
      await h.click(tid('shipment-void'))
      await h.click(`[role=dialog] ${tid('confirm-ok')}`)
      await page.locator(tid('shipment-void')).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
      await c('refund')
      await h.idle(2500)
      await h.nav('/billing')
      await h.idle(2500)
    },
  })

  steps.push({
    id: '9', no: 9, route: '/ai/forecast',
    async run() {
      const c = capOf('9')
      await c('chart')
      await h.wait(`${tid('forecast-chart')} svg`)
      await h.point(tid('forecast-chart'))
      await h.idle(3500)
      await c('kpi')
      await h.scrollTo(tid('forecast-kpis'))
      await h.point(tid('forecast-kpis'))
      await h.idle(2500)
      await c('suff')
      await h.point(tid('forecast-sufficiency'))
      await h.idle(2500)
      await c('stockout')
      const plan = page.locator('[data-testid^="forecast-stockout-plan-"]').first()
      if (await plan.count()) { await h.scrollTo(plan); await h.point(plan) }
      await h.idle(3000)
    },
  })

  steps.push({
    id: '10', no: 10, route: '/orders',
    async run() {
      const c = capOf('10')
      await c('sync')
      await h.click(tid('orders-sync'))
      await h.wait(tid('sync-result'), 30_000)
      await c('result')
      await h.idle(3500)
      await h.click(tid('sync-close'))
      await c('filter')
      await h.click(tid('filter-chip-channel'))
      await h.click(tid('filter-opt-channel-etsy'))
      await page.keyboard.press('Escape')
      await h.settle(600)
      await h.idle(2500)
    },
  })

  // ------------------------------------------------------------------------------------------------- İP2
  steps.push({
    id: '11', no: 11, session: 'admin', route: '/admin/rate-cards?tab=agreements',
    async run() {
      const c = capOf('11')
      await c('agreements')
      const card = page.locator('[data-testid^="rate-agreement-"]').first()
      await card.waitFor({ timeout: 15_000 })
      await h.point(card)
      await h.idle(3000)
      await h.scrollBy(500)
      await h.idle(1500)
      await c('platform')
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await sleep(600)
      await h.click(tid('tab-platform'))
      await h.settle(600)
      await h.idle(3500)
    },
  })

  steps.push({
    id: '12', no: 12, route: '/integrations/stores',
    async run() {
      const c = capOf('12')
      await c('stores')
      await h.wait(tid('store-card-amazon'))
      await h.point(tid('store-card-amazon'))
      await h.idle(1500)
      await h.point(tid('store-card-ebay'))
      await h.idle(1500)
      await h.scrollTo(tid('store-connect-woocommerce'))
      await h.click(tid('store-connect-woocommerce'))
      await c('url')
      await h.type(tid('connect-site-url'), 'https://shop.anatoliahome.com')
      await h.click(tid('connect-continue'))
      await c('consent')
      await h.wait(tid('connect-allow'))
      await h.idle(2000)
      await h.click(tid('connect-allow'))
      await c('apikey')
      await h.wait(tid('connect-done'), 30_000)
      await c('done')
      await h.idle(4000)
      await h.click(tid('connect-finish'))
      await h.idle(1000)
    },
  })

  steps.push({
    id: '13', no: 13, route: '/onboarding',
    async run() {
      const c = capOf('13')
      await c('step1')
      await h.wait(tid('onb-continue'))
      const vol = page.locator('[data-testid^="onb-volume-"]').nth(1)
      await h.click(vol)
      await h.click(tid('onb-channel-etsy'))
      if ((await page.locator(tid('onb-channel-shopify')).getAttribute('aria-pressed')) !== 'true') await h.click(tid('onb-channel-shopify'))
      await h.click(tid('onb-origin-tr_mixed'))
      await h.idle(1200)
      await h.click(tid('onb-continue'))
      await c('step2')
      await h.idle(2500)
      await h.click(tid('onb-continue'))
      await c('step3')
      await h.wait('[data-testid^="onb-plan-"]')
      await h.point('[data-testid^="onb-plan-"] >> nth=1')
      await h.idle(3500)
      await h.go('/billing')
      await c('topup')
      await h.click(tid('billing-topup'))
      await h.click(tid('topup-amount-2500'))
      await h.idle(1200)
      await h.click(tid('topup-pay'))
      await c('3ds')
      await h.wait(tid('topup-approve'))
      await h.idle(2000)
      await h.click(tid('topup-approve'))
      await h.wait(tid('topup-close'), 20_000)
      await c('done')
      await h.idle(2500)
      await h.click(tid('topup-close'))
    },
  })

  steps.push({
    id: '14', no: 14,
    async run() {
      const c = capOf('14')
      await page.goto(h.BASE_URL + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      await c('landing')
      await h.idle(3500)
      await c('features')
      for (let i = 0; i < 3; i++) { await h.scrollBy(650); await h.idle(1200) }
      await c('plans')
      await h.go('/plan')
      await h.wait('[data-testid^="plan-card-"]')
      for (const p of ['starter', 'professional', 'enterprise']) {
        const card = page.locator(tid('plan-card-' + p))
        if (await card.count()) { await h.point(card); await h.idle(1500) }
      }
    },
  })

  // ------------------------------------------------------------------------------------------------- İP3
  steps.push({
    id: '15', no: 15, session: 'admin', route: '/admin/carriers',
    async run() {
      const c = capOf('15')
      await c('list')
      await h.wait(tid('carrier-add'))
      await h.idle(2500)
      await c('wizard')
      await h.click(tid('carrier-add'))
      await h.wait(tid('carrier-fill-sample'))
      await c('sample')
      await h.click(tid('carrier-fill-sample'))
      await h.idle(1500)
      for (let i = 0; i < 5; i++) { await h.click(tid('carrier-next')); await h.idle(700) }
      await c('test')
      await h.click(tid('carrier-save-test'))
      await h.wait(tid('carrier-test-passed'), 30_000)
      await h.idle(1500)
      await h.click(tid('carrier-activate'))
      await h.wait(tid('carrier-activated'), 20_000)
      await c('active')
      await h.idle(2500)
      await h.click(tid('carrier-close'))
      await h.idle(1500)
    },
  })

  for (const s of extraSteps(h, { tid, capOf, quotesIdle })) steps.push(s)

  // ------------------------------------------------------------------------------------------------- Closing
  steps.push({
    id: 'close', session: 'admin', route: '/admin/rnd',
    async run() {
      const c = capOf('close')
      await h.wait(tid('rnd-summary'))
      await c('summary')
      await h.point(tid('rnd-summary'))
      await h.idle(3000)
      await h.point(tid('rnd-gantt'))
      await h.idle(2000)
      await c('thanks')
    },
  })
  return steps
}

function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') }

// Steps 16-23 are defined in steps-ip34.mjs to keep this file readable.
import { extraSteps } from './steps-ip34.mjs'
