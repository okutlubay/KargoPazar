// Steps 16-23 (İP3 second half and İP4).
export function extraSteps(h, { tid, capOf, quotesIdle }) {
  const { page, sleep } = h

  async function slider(sel, presses, key = 'ArrowRight') {
    const input = page.locator(`${sel} input[type=range]`).first()
    await h.point(input)
    await input.focus()
    for (let i = 0; i < presses; i++) { await page.keyboard.press(key); await sleep(260) }
  }

  return [
    {
      id: '16', no: 16, route: '/ai/pricing',
      async run() {
        const c = capOf('16')
        await c('recs')
        const exact = page.locator(tid('pricing-approve-NJ01|USPS-GA|near'))
        const btn = (await exact.count()) ? exact : page.locator('[data-testid^="pricing-approve-NJ01|"]').first()
        await btn.waitFor({ timeout: 15_000 })
        await h.point(btn)
        await h.idle(2500)
        await c('approve')
        await h.click(btn)
        await h.wait(tid('toast-success'), 15_000)
        await h.idle(2500)
        await h.nav('/shipments/new?orderId=ORD-10404')
        await c('ship')
        await h.wait(tid('shipment-next'))
        const hub = page.locator(tid('shipment-hub-NJ01'))
        if (await hub.isVisible().catch(() => false)) await h.click(hub)
        for (let i = 0; i < 3; i++) {
          await h.click(tid('shipment-next'))
          await h.settle(500)
          if (await page.locator(tid('quote-comparison')).isVisible().catch(() => false)) break
        }
        await quotesIdle()
        await c('badge')
        const badge = page.locator(tid('offer-badge-dynamic')).first()
        await badge.waitFor({ timeout: 15_000 })
        await h.scrollTo(badge)
        await h.point(badge)
        await h.idle(3000)
      },
    },
    {
      id: '17', no: 17, route: '/intl/tests',
      async run() {
        const c = capOf('17')
        await c('run')
        await h.click(tid('run-suite-SUITE-UK'))
        await h.wait(tid('test-progress'))
        await page.waitForSelector(`${tid('test-progress')}[data-running="false"]`, { timeout: 60_000 })
        await c('done')
        await h.idle(2000)
        await c('past')
        const row = page.locator(tid('run-row-RUN-001'))
        await h.scrollTo(row)
        await h.click(row)
        await h.wait(tid('run-failure'))
        await h.scrollTo(tid('run-failure'))
        await h.point(tid('run-failure'))
        await h.idle(3500)
        await c('pdf')
        await h.download(() => h.click(tid('run-drawer-report')))
        await h.idle(2500)
        await h.click(tid('drawer-close'))
      },
    },
    {
      id: '18', no: 18, route: '/ai/optimizer',
      async run() {
        const c = capOf('18')
        await c('slider')
        await h.wait(tid('optimizer-slider'))
        await h.settle(800)
        await slider(tid('optimizer-slider'), 8)
        await h.idle(1500)
        await slider(tid('optimizer-slider'), 12, 'ArrowLeft')
        await h.idle(1500)
        await c('batch')
        await h.click(tid('optimizer-run-batch'))
        await h.wait(tid('batch-precheck-next'), 20_000)
        await h.idle(2000)
        await c('optimize')
        await h.click(tid('batch-precheck-next'))
        await h.wait(tid('batch-opt-done'), 30_000)
        await c('savings')
        await h.point(tid('batch-opt-savings'))
        await h.idle(3000)
        await c('alts')
        const alt = page.locator(tid('batch-alternatives-toggle')).first()
        await h.scrollTo(alt)
        await h.click(alt)
        await h.idle(3000)
      },
    },
    {
      id: '19', no: 19, route: '/intl/new?origin=TR',
      async run() {
        const c = capOf('19')
        await c('new')
        await h.wait(tid('intl-origin-TR'))
        await h.click(tid('intl-origin-TR'))
        await h.click(tid('intl-fill-sample'))
        await h.idle(1200)
        await h.click(tid('intl-next'))
        await c('items')
        await h.wait(tid('intl-parcel-weight-0'))
        await h.type(tid('intl-parcel-weight-0'), '12')
        await h.select(tid('intl-item-product'), 'PIL-KLM-16')
        const panel = page.locator(tid('customs-info-panel')).first()
        if (await panel.isVisible({ timeout: 5000 }).catch(() => false)) { await h.scrollTo(panel); await h.point(panel); await h.idle(2500) }
        await h.click(tid('intl-next'))
        await h.wait(tid('intl-hub-NJ01'))
        await h.click(tid('intl-hub-NJ01'))
        await h.idle(1000)
        await h.click(tid('intl-next'))
        await h.settle(500)
        await h.idle(1200)
        await h.click(tid('intl-next'))
        await c('price')
        await h.wait(tid('intl-pay'))
        await h.settle(800)
        await h.idle(2500)
        await c('pay')
        await h.click(tid('intl-pay'))
        await page.waitForFunction(() => /#\/intl\/INT-/.test(location.hash), null, { timeout: 30_000 })
        await h.wait(tid('intl-advance'))
        await h.idle(1500)
        await c('advance')
        for (let i = 0; i < 6; i++) {
          const before = await page.locator(tid('intl-stage')).getAttribute('data-stage')
          await h.click(tid('intl-advance'))
          await page.waitForFunction(b => document.querySelector('[data-testid="intl-stage"]')?.dataset.stage !== b, before, { timeout: 20_000 })
          await h.settle(300)
          await h.idle(800)
        }
        await c('arrived')
        await h.idle(2500)
      },
    },
    {
      id: '20', no: 20, route: '/integrations/carrier-accounts',
      async run() {
        const c = capOf('20')
        await c('accounts')
        await h.wait(tid('carrier-connect-FDX'))
        await h.idle(1500)
        await c('connect')
        await h.click(tid('carrier-connect-FDX'))
        await h.type('[data-field=accountNumber]', '123456789')
        await h.type('[data-field=billingZip]', '07072')
        await h.type('[data-field=invoiceNumber]', '742901553')
        await h.type('[data-field=invoiceAmount]', '248.30')
        await h.click(tid('carrier-wizard-verify'))
        await page.waitForSelector(`${tid('carrier-wizard-next')}:not([disabled])`, { timeout: 20_000 })
        await c('connected')
        await h.idle(1500)
        await h.click(tid('carrier-wizard-next'))
        const fetch = page.locator(tid('carrier-wizard-fetch'))
        if (await fetch.isVisible({ timeout: 3000 }).catch(() => false)) {
          await h.click(fetch)
          await page.waitForSelector(`${tid('carrier-wizard-connect')}:not([disabled])`, { timeout: 20_000 })
          await h.idle(1500)
        }
        await h.click(tid('carrier-wizard-connect'))
        await h.wait(tid('carrier-wizard-finish'), 20_000)
        await h.idle(1500)
        await h.click(tid('carrier-wizard-finish'))
        await h.nav('/compare')
        await c('compare')
        await quotesIdle()
        await h.click(`${tid('compare-origin')} ${tid('seg-NJ01')}`)
        await h.type(tid('compare-zip'), '90210')
        await sleep(700)
        await quotesIdle()
        const own = page.locator('[data-testid="offer-card"][data-offer-key^="FDX"][data-offer-key$=":own"]').first()
        await own.waitFor({ timeout: 15_000 })
        await h.scrollTo(own)
        await h.point(own)
        await h.idle(2500)
        const own2 = page.locator(tid('filter-own')).first()
        if (await own2.isVisible().catch(() => false)) {
          await h.scrollTo(own2)
          await h.click(own2)
          await quotesIdle().catch(() => {})
          await h.idle(2500)
        }
      },
    },
    {
      id: '21', no: 21, route: '/ai/hs',
      async run() {
        const c = capOf('21')
        await c('hs')
        await h.type(tid('hs-test-title'), 'handwoven wool kilim pillow case 16x16')
        await h.click(tid('hs-test-run'))
        await h.wait(tid('hs-customs-link-5702.42'))
        await c('first')
        await h.idle(2500)
        await c('fix')
        await h.click(tid('hs-other'))
        await h.type(tid('hs-picker-search'), '6304.92')
        await h.click(tid('hs-picker-opt-6304.92'))
        await h.click(tid('hs-pick-save'))
        await c('retrain')
        await h.click(tid('hs-retrain-now'))
        await h.click(tid('training-start'))
        await h.wait(tid('hs-retest'), 30_000)
        await c('after')
        await h.scrollTo(tid('hs-retest'))
        await h.point(tid('hs-retest'))
        await h.idle(3000)
        await h.click(tid('training-close'))
        await c('center')
        const link = page.locator(tid('hs-customs-link-6304.92')).first()
        if (await link.isVisible().catch(() => false)) await h.click(link)
        else await h.nav('/customs/info?hs=6304.92')
        await h.wait(tid('customs-info-panel'))
        await c('panel')
        await h.scrollTo(tid('customs-info-panel'))
        const ddu = page.locator(tid('incoterm-DDU')).first()
        if (await ddu.isVisible().catch(() => false)) { await h.click(ddu); await h.idle(1500); await h.click(tid('incoterm-DDP')) }
        await h.idle(2000)
        await h.nav('/shipments/SHP-20526?tab=customs')
        await c('tab')
        await h.wait(tid('customs-tab'))
        await h.point(tid('customs-tab'))
        await h.idle(3000)
        await h.nav('/ai/customs-docs?intl=INT-3122')
        await c('docs')
        await h.wait(tid('tab-form'), 20_000)
        await h.settle(800)
        await h.click(tid('tab-form'))
        await h.idle(1500)
        await h.click(tid('tab-invoice'))
        await h.idle(1500)
        await h.download(() => h.click(tid('customs-docs-download-all')))
        await h.idle(2000)
      },
    },
    {
      id: '22', no: 22, route: '/shipments/SHP-20910',
      async run() {
        const c = capOf('22')
        await c('dummy')
        await h.wait(tid('shipment-dummy-create'))
        await h.click(tid('shipment-dummy-create'))
        await h.wait(tid('shipment-label-cards'))
        await h.scrollTo(tid('shipment-label-cards'))
        await h.idle(2500)
        await c('role')
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
        await sleep(500)
        await h.click(tid('user-menu-button'))
        await h.click(tid('user-menu-roles'))
        await h.click(tid('role-option-finance'))
        await h.wait(tid('role-preview-exit'))
        await h.nav('/shipments')
        await c('locked')
        await h.idle(3500)
        await h.click(tid('role-preview-exit'))
        await h.nav('/settings/rules')
        await c('rules')
        await h.wait(tid('rules-test-open'))
        await h.idle(1500)
        await c('test')
        await h.click(tid('rules-test-open'))
        await h.wait(tid('rules-test-summary'))
        await h.scrollTo(tid('rules-test-summary'))
        await h.point(tid('rules-test-summary'))
        await h.idle(3000)
      },
    },
    {
      id: '23', no: 23, session: 'admin', route: '/admin/countries',
      async run() {
        const c = capOf('23')
        await c('list')
        await h.wait(tid('countries-add-market'))
        await h.idle(2500)
        await c('wizard')
        await h.click(tid('countries-add-market'))
        await h.click(tid('country-preset-CA'))
        await h.idle(1200)
        for (let i = 0; i < 5; i++) { await h.click(tid('country-wizard-next')); await h.idle(900) }
        await h.click(tid('country-wizard-activate'))
        await h.wait(tid('country-wizard-done'), 20_000)
        await c('done')
        await h.idle(2500)
        await h.click(tid('country-wizard-close'))
        await h.idle(1500)
      },
    },
  ]
}
