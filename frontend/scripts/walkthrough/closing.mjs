// Project closing video (record-walkthrough.mjs --closing): the evaluation account signs in, creates a Türkiye -> US
// shipment step by step (AI address check, HS code from the catalog, customs estimate, compared offers, card top-up
// and payment), then shows the shipment list and a store integration. Captions and narration: closing-texts.json.
// setup() runs before the recording in an unrecorded context: the Çanakkale Teknopark origin point and two earlier
// shipments, so the lists are not empty.
import { tid } from './steps.mjs'

const POINT = { name: 'Çanakkale Teknopark', city: 'Çanakkale', district: 'Merkez', line1: 'ÇOMÜ Terzioğlu Yerleşkesi, Teknopark Binası', zip: '17100' }
const PRIOR = [
  { point: 'İstanbul', sku: 'TWL-PSH-01', to: { name: 'Olivia Bennett', line1: '849 Newbury St', line2: 'Apt 17F', city: 'Boston', state: 'MA', zip: '02118' } },
  { point: 'İzmir', sku: 'CER-MUG-12', to: { name: 'Daniel Brooks', line1: '19 Randolph St', line2: 'Apt 2B', city: 'Chicago', state: 'IL', zip: '60614' } },
]
const MAIN = { sku: 'RUG-KLM-35', search: 'kilim', to: { name: 'Sarah Mitchell', line1: '245 W 23rd St', line2: 'Apt 4B', city: 'New York', state: 'NY', zip: '10011' } }

const hubCard = (page, text) => page.locator('[data-testid^="shipment-hub-"]').filter({ hasText: text }).first()

export async function setup(h) {
  const { page, log } = h
  await h.go('/shipments/new')
  await h.wait(tid('origin-point-add'))
  // an earlier test point with a typo ("cumhuriyeet caddesi") would show up on the sender step
  const junk = hubCard(page, 'cumhuriyeet')
  if (await junk.count()) {
    await junk.locator('button.rm').click()
    await page.locator(`[role=dialog] ${tid('confirm-ok')}`).click()
    await junk.waitFor({ state: 'detached', timeout: 10_000 })
    log('  setup: test origin point removed')
  }
  if (!(await hubCard(page, POINT.name).count())) {
    await page.locator(tid('origin-point-add')).click()
    await page.locator(tid('origin-point-name')).fill(POINT.name)
    await page.locator(tid('origin-point-city')).fill(POINT.city)
    await page.locator(tid('origin-point-line1')).fill(POINT.line1)
    await page.locator('#origin-point-form input[inputmode="numeric"]').fill(POINT.zip)
    await page.locator(tid('origin-point-save')).click()
    await hubCard(page, POINT.name).waitFor({ timeout: 15_000 })
    log('  setup: origin point added')
  }
  const count = await shipmentCount(h)
  for (const s of PRIOR.slice(Math.min(count, PRIOR.length))) {
    await h.go('/shipments/new')
    await fastShipment(h, s)
    log(`  setup: shipment to ${s.to.city} created`)
  }
}

async function shipmentCount(h) {
  await h.go('/shipments')
  await h.settle(1500)
  return h.page.locator('table tbody tr').count()
}

/** Whole wizard without pauses (setup only). */
async function fastShipment(h, s) {
  const { page } = h
  await hubCard(page, s.point).click()
  await page.locator(tid('shipment-next')).click()
  await fillAddress(h, s.to, { fast: true })
  await waitAddressCheck(page)
  await page.locator(tid('shipment-next')).click()
  await pickProduct(h, s.sku, s.sku, { fast: true })
  await page.locator(tid('shipment-next')).click()
  await quotesIdle(h)
  await page.locator(tid('shipment-next')).click()
  await page.locator(tid('shipment-next')).click() // customs
  await page.locator(tid('shipment-pay')).waitFor()
  await h.sleep(1500)
  await page.locator(tid('shipment-pay')).click()
  if (await page.locator(tid('topup-pay')).isVisible({ timeout: 4000 }).catch(() => false)) {
    await fillCard(h, { fast: true })
    await page.locator(tid('topup-pay')).click()
    await page.locator(tid('topup-approve')).click({ timeout: 15_000 })
    await page.locator(tid('topup-close')).click({ timeout: 20_000 })
    await h.sleep(800)
    await page.locator(tid('shipment-pay')).click()
  }
  await page.locator(tid('shipment-success')).waitFor({ timeout: 30_000 })
}

const CARD = { '#cf-number': '4242 4242 4242 4242', '#cf-exp': '12/28', '#cf-cvc': '123', '#cf-zip': '17100', '#cf-holder': 'FATMANUR CEYHAN' }
async function fillCard(h, { fast = false } = {}) {
  if (!(await h.page.locator('#cf-number').isVisible().catch(() => false))) return // saved card selected
  for (const [sel, v] of Object.entries(CARD)) {
    if (fast) await h.page.locator(sel).fill(v)
    else await h.type(sel, v)
  }
}

async function fillAddress(h, to, { fast = false } = {}) {
  const { page } = h
  const f = sel => page.locator(`.kpz-address ${sel}`).first()
  const put = fast ? (sel, v) => f(sel).fill(v) : (sel, v) => h.type(f(sel), v)
  await put('input[autocomplete="name"]', to.name)
  await put('input[autocomplete="address-line1"]', to.line1)
  if (to.line2) await put('input[autocomplete="address-line2"]', to.line2)
  await put('input[autocomplete="address-level2"]', to.city)
  if (fast) await f('select[autocomplete="address-level1"]').selectOption(to.state)
  else await h.select(f('select[autocomplete="address-level1"]'), to.state)
  await put('input[autocomplete="postal-code"]', to.zip)
  await page.keyboard.press('Tab')
}

async function waitAddressCheck(page) {
  await page.locator('.af-validate.vs-done').waitFor({ timeout: 20_000 })
}

async function pickProduct(h, query, sku, { fast = false } = {}) {
  const { page } = h
  const search = page.locator(tid('contents-product-search')).first()
  if (fast) { await search.click(); await search.fill(query) } else await h.type(search, query)
  const hit = page.locator(tid('contents-hit-' + sku))
  await hit.waitFor({ timeout: 10_000 })
  if (fast) await hit.click()
  else { await h.point(hit); await h.sleep(700); await h.click(hit) }
  await h.sleep(600)
}

async function quotesIdle(h) {
  await h.page.locator(tid('offer-card')).first().waitFor({ state: 'visible', timeout: 25_000 })
  await h.page.waitForFunction(() => !document.querySelector('[data-testid="quote-comparison"].busy'), null, { timeout: 20_000 })
  await h.sleep(500)
}

export function buildSteps(h) {
  const { page, sleep } = h
  const capOf = id => key => h.caption(h.TEXTS.steps[id]?.captions?.[key] ?? key)
  const band = (left, center) => h.band({ left, center })
  const next = () => h.click(tid('shipment-next'), { delay: 400 })
  const top = async () => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(600) }
  const steps = []

  steps.push({
    id: 'login', session: 'none', ownBand: true,
    async run() {
      const c = capOf('login')
      await page.goto(`${h.BASE_URL}/app/#/login`, { waitUntil: 'domcontentloaded' })
      await page.locator(tid('login-identifier')).waitFor({ timeout: 20_000 })
      await h.card({ kicker: 'Proje Kapanışı', title: 'KargoPazar', sub: 'Türkiye\'den dünyaya e-ticaret gönderileri için tek platform' }, 3000)
      await band('Giriş', 'Sisteme giriş')
      await c('login')
      await h.type(tid('login-identifier'), h.DEMO_USER)
      await h.type(tid('login-password'), h.DEMO_PASSWORD)
      await h.click(tid('login-submit'), { delay: 0 })
      await page.waitForFunction(() => location.hash === '#/' || /#\/(\?|$)/.test(location.hash), null, { timeout: 30_000 })
      h.session = 'demo'
      await page.evaluate(() => {
        try {
          const s = localStorage.getItem('kpz_demo:session')
          if (s) { sessionStorage.setItem('kpz_demo:session', s); localStorage.removeItem('kpz_demo:session') }
        } catch {}
      })
      await h.settle(800)
    },
  })

  steps.push({
    id: 'overview', ownBand: true,
    async run() {
      const c = capOf('overview')
      await band('Panel', 'Genel Bakış')
      await c('panel')
      await h.idle(2500)
      await c('menu')
      const nav = page.locator('aside nav, .sidebar, nav').first()
      await h.point(nav)
      for (const y of [0.25, 0.45, 0.65, 0.8]) {
        const box = await nav.boundingBox()
        if (box) await h.moveTo(box.x + box.width / 2, box.y + box.height * y, 700)
        await sleep(600)
      }
      await h.idle(1500)
    },
  })

  steps.push({
    id: 'language', ownBand: true,
    async run() {
      const c = capOf('language')
      await band('Panel', 'Dil seçimi: Türkçe / İngilizce')
      await c('button')
      await h.point('button.lang')
      await sleep(1200)
      await h.click('button.lang', { delay: 600 })
      await c('en')
      await h.idle(4000)
      await h.click('button.lang', { delay: 600 })
      await c('tr')
      await h.idle(2000)
    },
  })

  steps.push({
    id: 'sender', ownBand: true,
    async run() {
      const c = capOf('sender')
      await band('Yeni gönderi · 1/6', 'Çıkış noktası: Çanakkale Teknopark')
      await h.go('/shipments/new')
      await c('wizard')
      await h.point('.stepper, [role=list], ol')
      await h.idle(1500)
      await c('point')
      await h.click(hubCard(page, POINT.name))
      await h.idle(2500)
      await c('route')
      await h.scrollTo('.callout.neutral')
      await h.point('.callout.neutral')
      await h.idle(2500)
      await next()
    },
  })

  steps.push({
    id: 'recipient', ownBand: true,
    async run() {
      const c = capOf('recipient')
      await band('Yeni gönderi · 2/6', 'Alıcı adresi ve yapay zeka doğrulaması')
      await c('typing')
      await fillAddress(h, MAIN.to)
      await c('checking')
      await h.scrollTo('.af-validate')
      await waitAddressCheck(page)
      await h.point('.af-validate')
      await c('verified')
      await h.idle(3500)
      await next()
    },
  })

  steps.push({
    id: 'package', ownBand: true,
    async run() {
      const c = capOf('package')
      await band('Yeni gönderi · 3/6', 'Paket, içerik ve HS kodu')
      await c('search')
      await h.scrollTo(tid('shipment-contents'), { block: 'start' })
      await pickProduct(h, MAIN.search, MAIN.sku)
      await c('hs')
      await h.point('input[id^="cs-h-"]')
      await h.idle(3000)
      await c('customs')
      const info = page.locator(tid('shipment-contents')).getByText(/Gümrük Bilgilendirme/).first()
      await h.scrollTo(info, { block: 'start' })
      await h.point(info)
      await h.idle(2500)
      await h.scrollBy(450)
      await h.idle(2500)
      await c('pkg')
      await top()
      await h.idle(1500)
      await next()
    },
  })

  steps.push({
    id: 'rates', ownBand: true,
    async run() {
      const c = capOf('rates')
      await band('Yeni gönderi · 4/6', 'Teklif karşılaştırma ve rota optimizasyonu')
      await quotesIdle(h)
      await c('offers')
      await h.point(page.locator(tid('offer-card')).first())
      await h.idle(2500)
      await c('route')
      await h.point('.ai-line')
      await h.idle(2500)
      await c('slider')
      const slider = page.locator('.slider-wrap input[type=range], .slider-wrap [role=slider]').first()
      await h.point(slider)
      const box = await slider.boundingBox()
      if (box) {
        await page.mouse.down()
        await h.moveTo(box.x + box.width * 0.85, box.y + box.height / 2, 900)
        await page.mouse.up()
        await sleep(1500)
        await h.moveTo(box.x + box.width * 0.4, box.y + box.height / 2, 900)
        await page.mouse.down(); await page.mouse.up()
        await sleep(1200)
      }
      await c('table')
      const sw = page.locator(`${tid('view-switcher')} [role=radio]`)
      if (await sw.count() > 1) {
        await h.click(sw.nth(1))
        await h.idle(3000)
        await h.click(sw.nth(0))
      }
      await c('choose')
      const pick = page.locator(tid('offer-card')).first().locator(tid('offer-choose'))
      if (await pick.count()) await h.click(pick)
      await h.idle(1500)
      await h.click(tid('shipment-next'), { delay: 400 })
    },
  })

  steps.push({
    id: 'customs', ownBand: true,
    async run() {
      const c = capOf('customs')
      await band('Yeni gönderi · 5/6', 'Gümrük beyanı')
      await c('auto')
      await h.idle(2000)
      await h.scrollBy(350)
      await h.idle(2500)
      await top()
      await next()
    },
  })

  steps.push({
    id: 'payment', ownBand: true,
    async run() {
      const c = capOf('payment')
      await band('Yeni gönderi · 6/6', 'Ödeme')
      await page.locator(tid('shipment-pay')).waitFor({ timeout: 20_000 })
      await c('breakdown')
      await h.point('.table-simple')
      await h.idle(3000)
      await c('topup')
      await h.click(tid('shipment-pay'), { delay: 800 })
      if (await page.locator(tid('topup-pay')).isVisible({ timeout: 5000 }).catch(() => false)) {
        await h.idle(1200)
        await c('card')
        const newCard = page.locator('input[name="tu-card"][value="new"]')
        if (await newCard.count()) await h.click(page.locator('label.cardopt').filter({ has: newCard }))
        await fillCard(h)
        await h.click(tid('topup-pay'))
        await c('3ds')
        await h.wait(tid('topup-approve'), 15_000)
        await h.idle(1800)
        await h.click(tid('topup-approve'))
        await h.wait(tid('topup-close'), 20_000)
        await c('loaded')
        await h.idle(1800)
        await h.click(tid('topup-close'))
        await sleep(800)
        await c('pay')
        await h.click(tid('shipment-pay'), { delay: 400 })
      }
      await h.wait(tid('shipment-success'), 30_000)
    },
  })

  steps.push({
    id: 'success', ownBand: true,
    async run() {
      const c = capOf('success')
      await band('Yeni gönderi', 'Gönderi oluşturuldu')
      await c('tracking')
      await h.point('.track-box')
      await h.idle(2500)
      await c('label')
      await h.point('.succ-label')
      await h.idle(3000)
    },
  })

  steps.push({
    id: 'lists', ownBand: true,
    async run() {
      const c = capOf('lists')
      await band('Panel', 'Gönderiler ve kullanıcı paneli')
      await h.go('/orders')
      await c('orders')
      await page.locator('table tbody tr').first().waitFor({ timeout: 15_000 })
      await h.point(page.locator('table tbody tr').first())
      await h.idle(1500)
      await h.point(page.locator('table tbody tr').nth(3))
      await h.idle(1500)
      await h.go('/shipments')
      await c('shipments')
      const row = page.locator('table tbody tr').first()
      await row.waitFor({ timeout: 15_000 })
      await h.point(row)
      await h.idle(2500)
      await h.point(page.locator('table tbody tr').last())
      await h.idle(2000)
      await c('overview')
      await h.go('/')
      await h.idle(2500)
      await h.scrollBy(450)
      await h.idle(2500)
      await top()
    },
  })

  steps.push({
    id: 'integration', ownBand: true,
    async run() {
      const c = capOf('integration')
      await band('Entegrasyon', 'Pazaryeri entegrasyonları')
      await h.go('/integrations/stores')
      await c('stores')
      await h.wait(tid('store-card-etsy'))
      for (const ch of ['woocommerce', 'etsy', 'amazon', 'shopify']) {
        const card = page.locator(tid('store-card-' + ch))
        if (await card.count()) { await h.point(card); await sleep(900) }
      }
      await h.click(tid('store-connect-shopify'))
      await c('url')
      await h.type('[role=dialog] .phase input.input', 'fenece.myshopify.com')
      await h.click(tid('connect-continue'))
      await c('consent')
      await h.wait(tid('connect-allow'))
      await h.idle(1500)
      await h.click(tid('connect-allow'))
      await h.wait(tid('connect-done'), 30_000)
      await c('done')
      await h.idle(3000)
      await h.click(tid('connect-finish'))
      await h.idle(1000)
    },
  })

  steps.push({
    id: 'close', ownBand: true,
    async run() {
      await h.caption('')
      await h.band(null)
      // the closing card stays on screen until the narration ends (the recorder holds the step)
      await h.overlay({ card: { kicker: 'KargoPazar', title: 'Türkiye\'den dünyaya, tek panelden', sub: 'İzlediğiniz için teşekkür ederiz' } })
      h.cardTimes.push(Date.now() - h.t0)
      await sleep(800)
    },
  })

  return steps
}
