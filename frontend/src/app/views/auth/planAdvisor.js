/**
 * Plan and service advisor (spec 5.2 step 3, 5.11 "Size uygun planı bulalım").
 * PURE: no Vue, no db. Same answers always give the same recommendation.
 *
 *   import { advisePlan, emptyAnswers, PLAN_ORDER } from '@/app/views/auth/planAdvisor.js'
 *   const rec = advisePlan(answers)
 *
 * answers = {
 *   volume: '0-100' | '100-500' | '500-2000' | '2000+',          monthly shipments
 *   channels: ['shopify','etsy','amazon','ebay','woocommerce','api'],
 *   origin: 'tr_stock' | 'tr_direct' | 'tr_mixed' | 'us_warehouse', where products ship from
 *           (target audience: sellers in Türkiye selling to US buyers; legacy 'tr' = 'tr_stock',
 *            'uk' and 'hub_dropoff' are still understood)
 *   destinations: 'east' | 'west' | 'nationwide',                  where most customers are
 *   priorities: ['cost','speed','tracking','customs','api'],        most important first
 *   ownAccount: boolean, ownCarriers: ['UPS','FDX','USPS','DHLE'],
 *   users?: number                                                 team size (optional)
 * }
 *
 * advisePlan(answers) -> {
 *   plan: 'starter'|'professional'|'enterprise',
 *   scores: { starter, professional, enterprise },                 0..100 rule based score
 *   confidence: 0..1,
 *   hub: 'NJ01'|'LA01',
 *   services: [{ code, title: {tr,en}, reason: {tr,en}, link }],
 *   reasons: { plan: [{tr,en}], hub: {tr,en} },
 * }
 * All texts are bilingual objects; render them with tx().
 */

export const PLAN_ORDER = ['starter', 'professional', 'enterprise']
export const VOLUME_OPTIONS = ['0-100', '100-500', '500-2000', '2000+']
export const CHANNEL_OPTIONS = ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce', 'api']
export const ORIGIN_OPTIONS = ['tr_stock', 'tr_direct', 'tr_mixed', 'us_warehouse']
const LEGACY_ORIGIN = { tr: 'tr_stock' }
export const DESTINATION_OPTIONS = ['east', 'west', 'nationwide']
export const PRIORITY_OPTIONS = ['cost', 'speed', 'tracking', 'customs', 'api']
export const OWN_CARRIER_OPTIONS = ['UPS', 'FDX', 'USPS', 'DHLE']

const CHANNEL_NAMES = { shopify: 'Shopify', etsy: 'Etsy', amazon: 'Amazon', ebay: 'eBay', woocommerce: 'WooCommerce', api: 'API' }
const CARRIER_NAMES = { UPS: 'UPS', FDX: 'FedEx', USPS: 'USPS', DHLE: 'DHL eCommerce' }
const PLAN_NAMES = {
  starter: { tr: 'Başlangıç', en: 'Starter' },
  professional: { tr: 'Profesyonel', en: 'Professional' },
  enterprise: { tr: 'Kurumsal', en: 'Enterprise' },
}

export function emptyAnswers() {
  return {
    volume: null,
    channels: [],
    origin: null,
    destinations: 'nationwide',
    priorities: [...PRIORITY_OPTIONS],
    ownAccount: false,
    ownCarriers: [],
  }
}

/** Weight of a priority by its rank: first = 1, fifth = 0.2. */
function rankWeight(priorities, key) {
  const list = Array.isArray(priorities) && priorities.length ? priorities : PRIORITY_OPTIONS
  const i = list.indexOf(key)
  return i < 0 ? 0 : (list.length - i) / list.length
}

const bi = (tr, en) => ({ tr, en })
const list = (arr, lang) => {
  if (arr.length <= 1) return arr.join('')
  const last = arr[arr.length - 1]
  return `${arr.slice(0, -1).join(', ')} ${lang === 'tr' ? 've' : 'and'} ${last}`
}

export function advisePlan(input = {}) {
  const a = { ...emptyAnswers(), ...(input || {}) }
  if (LEGACY_ORIGIN[a.origin]) a.origin = LEGACY_ORIGIN[a.origin]
  const trOrigin = typeof a.origin === 'string' && a.origin.startsWith('tr_')
  const trStock = a.origin === 'tr_stock' || a.origin === 'tr_mixed'
  const trDirect = a.origin === 'tr_direct' || a.origin === 'tr_mixed'
  const channels = Array.isArray(a.channels) ? a.channels.filter(c => CHANNEL_OPTIONS.includes(c)) : []
  const storeChannels = channels.filter(c => c !== 'api')
  const vIdx = Math.max(0, VOLUME_OPTIONS.indexOf(a.volume))
  const intlOrigin = a.origin === 'uk' || trOrigin
  const wApi = rankWeight(a.priorities, 'api')
  const wCustoms = rankWeight(a.priorities, 'customs')
  const wCost = rankWeight(a.priorities, 'cost')
  const wSpeed = rankWeight(a.priorities, 'speed')
  const wTrack = rankWeight(a.priorities, 'tracking')
  const ownCarriers = a.ownAccount ? (a.ownCarriers ?? []).filter(c => OWN_CARRIER_OPTIONS.includes(c)) : []

  // ---- rule based plan score
  const s = { starter: 40, professional: 30, enterprise: 20 }
  const planReasons = []
  // volume
  s.starter += [30, 5, -25, -40][vIdx]
  s.professional += [0, 25, 20, 5][vIdx]
  s.enterprise += [-10, 0, 20, 40][vIdx]
  if (a.volume) {
    const vt = { '0-100': ['ayda 100 gönderiye kadar', 'up to 100 shipments a month'], '100-500': ['ayda 100-500 gönderi', '100-500 shipments a month'], '500-2000': ['ayda 500-2.000 gönderi', '500-2,000 shipments a month'], '2000+': ['ayda 2.000+ gönderi', '2,000+ shipments a month'] }[a.volume]
    planReasons.push(bi(`Hacim: ${vt[0]}. ${vIdx >= 2 ? 'Bu hacimde toplu işlemler ve özel tarife kartı fark yaratır.' : vIdx === 1 ? 'Toplu etiket ve otomatik senkron zaman kazandırır.' : 'Panelden manuel etiket yeterli olur.'}`,
      `Volume: ${vt[1]}. ${vIdx >= 2 ? 'At this volume batch jobs and a custom rate card make a difference.' : vIdx === 1 ? 'Batch labels and automatic sync save time.' : 'Manual labels from the panel are enough.'}`))
  }
  // channels (starter includes 2 stores)
  if (storeChannels.length > 2) {
    s.starter -= 30; s.professional += 15; s.enterprise += 5
    planReasons.push(bi(`${storeChannels.length} satış kanalı seçtiniz; Başlangıç planı 2 mağaza ile sınırlı.`, `You selected ${storeChannels.length} sales channels; Starter is limited to 2 stores.`))
  }
  if (channels.includes('api') || wApi >= 0.8) {
    s.starter -= 25; s.professional += 20; s.enterprise += 8
    planReasons.push(bi('Kendi siteniz veya API önceliğiniz var: API erişimi ve webhook\'lar Profesyonel ile başlar.', 'You need your own site or API: API access and webhooks start with Professional.'))
  }
  if (intlOrigin || wCustoms >= 0.8) {
    s.enterprise += 30; s.professional -= 5; s.starter -= 15
    const why = a.origin === 'tr_stock'
      ? bi('Türkiye\'den ABD merkezlerine (NJ01/LA01) toplu stok gönderiyorsunuz: ilk mil taşıma, ABD gümrüğü ve merkez stoğu Kurumsal planda.', 'You ship bulk stock from Türkiye to the US hubs (NJ01/LA01): first-mile freight, US customs and hub inventory are in Enterprise.')
      : a.origin === 'tr_direct'
        ? bi('Siparişleri Türkiye\'den doğrudan ABD\'deki alıcıya gönderiyorsunuz: ilk mil, ABD gümrüğü ve son mil etiketi Kurumsal planda.', 'You ship orders from Türkiye straight to US buyers: first mile, US customs and the last-mile label are in Enterprise.')
        : a.origin === 'tr_mixed'
          ? bi('Hem ABD merkezlerinde stok tutuyor hem Türkiye\'den doğrudan gönderiyorsunuz: iki akış da (ilk mil + gümrük) Kurumsal planda.', 'You keep stock at the US hubs and also ship directly from Türkiye: both flows (first mile + customs) are in Enterprise.')
          : intlOrigin
            ? bi('Ürünleriniz Birleşik Krallık\'tan çıkıyor: ilk mil ve gümrük hizmetleri Kurumsal planda.', 'Your products ship from the United Kingdom: first mile and customs services are in Enterprise.')
            : bi('Gümrük desteği önceliğiniz: ilk mil ve gümrük hizmetleri Kurumsal planda.', 'Customs support is a priority: first mile and customs services are in Enterprise.')
    planReasons.push(why)
  }
  if (ownCarriers.length) {
    s.professional += 5; s.enterprise += 5
  }
  if ((a.users ?? 1) > 3) {
    s.enterprise += 20
    planReasons.push(bi('Birden fazla kullanıcı ve rol için Kurumsal plan gerekir.', 'Several users and roles need the Enterprise plan.'))
  }
  if (wCost >= 0.8 && vIdx >= 2) {
    s.enterprise += 8
    planReasons.push(bi('Maliyet önceliğiniz yüksek: Kurumsal planda müşteriye özel tarife kartı tanımlanır.', 'Cost is your top priority: Enterprise gets a customer specific rate card.'))
  }
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)))
  const scores = { starter: clamp(s.starter), professional: clamp(s.professional), enterprise: clamp(s.enterprise) }
  const sorted = [...PLAN_ORDER].sort((x, y) => scores[y] - scores[x] || PLAN_ORDER.indexOf(y) - PLAN_ORDER.indexOf(x))
  const plan = sorted[0]
  const margin = scores[sorted[0]] - scores[sorted[1]]
  const confidence = Math.round(Math.min(0.97, 0.55 + margin / 80) * 100) / 100
  if (!planReasons.length) planReasons.push(bi('Cevaplarınıza göre en dengeli plan bu.', 'Based on your answers this is the most balanced plan.'))
  planReasons.unshift(bi(`Önerilen plan: ${PLAN_NAMES[plan].tr} (skor ${scores[plan]}/100).`, `Recommended plan: ${PLAN_NAMES[plan].en} (score ${scores[plan]}/100).`))

  // ---- hub
  let hub = 'NJ01'
  let hubReason
  if (trStock && a.destinations === 'west') {
    hub = 'LA01'
    hubReason = bi('Alıcılarınızın çoğu batı eyaletlerinde: stoğunuzu İstanbul-LAX hava hattıyla LA01\'de tutmak son milde 1-3 zone kazandırır.', 'Most buyers are in western states: keeping stock at LA01 via the Istanbul-LAX air lane saves 1-3 zones on the last mile.')
  } else if (trStock) {
    hub = 'NJ01'
    hubReason = bi('İstanbul çıkışlı hava kargo JFK\'ye iner; stok NJ01\'de tutulur, batıdaki talep artınca stoğun bir kısmı LA01\'e bölünebilir.', 'Air freight from Istanbul lands at JFK; stock is kept at NJ01 and part of it can be split to LA01 as western demand grows.')
  } else if (trOrigin) {
    hub = 'NJ01'
    hubReason = bi('Türkiye\'den doğrudan gönderiler JFK\'de ABD gümrüğünden geçer; son mil etiketi NJ01\'de basılıp taşıyıcıya verilir.', 'Direct shipments from Türkiye clear US customs at JFK; the last-mile label is printed and handed to the carrier at NJ01.')
  } else if (intlOrigin) {
    hub = 'NJ01'
    hubReason = bi('Londra çıkışlı hava kargo JFK/EWR\'ye iner; konsolidasyon ve gümrük NJ01\'de yapılır.', 'Air freight from London lands at JFK/EWR; consolidation and customs happen at NJ01.')
  } else if (a.destinations === 'west') {
    hub = 'LA01'
    hubReason = bi('Müşterilerinizin çoğu batı eyaletlerinde: LA01 çıkışlı gönderiler 1-3 zone daha yakın, OnTrac ve LSO seçenekleri açılır.', 'Most customers are in western states: LA01 is 1-3 zones closer and unlocks OnTrac and LSO.')
  } else if (a.destinations === 'east') {
    hub = 'NJ01'
    hubReason = bi('Müşterilerinizin çoğu doğu eyaletlerinde: NJ01 çıkışlı gönderiler zone 2-4 aralığında kalır.', 'Most customers are in eastern states: shipments from NJ01 stay in zones 2-4.')
  } else {
    hub = 'NJ01'
    hubReason = bi('Varışlar ABD geneline dağılıyor: NJ01 varsayılan merkez, batı siparişleri optimizer tarafından LA01\'e yönlendirilir.', 'Destinations are nationwide: NJ01 is the default hub, the optimizer routes western orders to LA01.')
  }

  // ---- services
  const services = []
  if (trStock) services.push({ code: 'first_mile_tr', title: bi(`Türkiye'den ${hub} stoğuna ilk mil`, `First mile from Türkiye to ${hub} stock`), reason: bi('İstanbul teslim noktası, hava kargo ve ABD gümrüğü; ürünler merkez stoğuna girer, siparişler ABD içinden 1-5 günde teslim edilir.', 'Istanbul drop-off point, air freight and US customs; goods enter hub stock and orders are delivered from inside the US in 1-5 days.'), link: '/intl/new' })
  if (trDirect) services.push({ code: 'direct_tr', title: bi('Türkiye\'den alıcıya doğrudan gönderi', 'Direct shipping from Türkiye to the buyer'), reason: bi('Sipariş başına koli: hava kargo, ABD gümrüğü ve son mil etiketi tek akışta; stok tutmanız gerekmez.', 'One parcel per order: air freight, US customs and the last-mile label in one flow; no stock to hold.'), link: '/intl/new' })
  if (trStock) services.push({ code: 'stock_forecast', title: bi('Talep tahminiyle stok planlama', 'Stock planning with the demand forecast'), reason: bi('Merkez stoğu tükenmeden önce hangi ürünlerden kaç adet gönderileceği önerilir.', 'Suggests which products and how many units to ship before hub stock runs out.'), link: '/ai/forecast' })
  if (a.origin === 'uk') services.push({ code: 'first_mile_uk', title: bi('Birleşik Krallık\'tan ilk mil (Evri toplama) + NJ01', 'First mile from the UK (Evri collection) + NJ01'), reason: bi('Evri toplama, Londra konsolidasyonu ve DHL Express hava ayağı.', 'Evri collection, London consolidation and a DHL Express air leg.'), link: '/intl/new' })
  if (intlOrigin || wCustoms >= 0.8) services.push({ code: 'customs_ai', title: bi('AI destekli HS kodu ve gümrük belgeleri', 'AI assisted HS codes and customs documents'), reason: bi('Ürün başlığından HS kodu önerisi, CN22/CN23 ve ticari fatura otomatik.', 'HS code suggestions from product titles, CN22/CN23 and commercial invoice generated automatically.'), link: '/ai/hs' })
  if (a.origin === 'hub_dropoff') services.push({ code: 'hub_dropoff', title: bi(`${hub} merkezine teslim ve ölçüm`, `Drop-off and measurement at ${hub}`), reason: bi('Paketleriniz merkezde kabul edilir, tartılır ve aynı gün taşıyıcıya teslim edilir.', 'Parcels are received, weighed and handed to the carrier the same day.'), link: '/ops' })
  for (const c of ownCarriers) services.push({ code: `own_${c.toLowerCase()}`, title: bi(`Kendi ${CARRIER_NAMES[c]} hesabınızı bağlayın`, `Connect your own ${CARRIER_NAMES[c]} account`), reason: bi('Anlaşmalı fiyatlarınız platform tarifesiyle yan yana gösterilir, ucuz olan seçilir.', 'Your negotiated rates are shown next to the platform tariff and the cheaper one wins.'), link: '/integrations/carrier-accounts' })
  if (storeChannels.length) services.push({ code: 'store_sync', title: bi(`${list(storeChannels.map(c => CHANNEL_NAMES[c]), 'tr')} mağaza senkronu`, `${list(storeChannels.map(c => CHANNEL_NAMES[c]), 'en')} store sync`), reason: bi('Siparişler otomatik çekilir, takip numarası pazaryerine geri yazılır.', 'Orders are pulled automatically and tracking numbers are written back.'), link: '/integrations/stores' })
  if (wCost >= 0.6 || wSpeed >= 0.6) services.push({ code: 'optimizer', title: bi('AI taşıyıcı optimizasyonu', 'AI carrier optimization'), reason: wCost >= wSpeed ? bi('Maliyet önceliğinize göre en ucuz uygun servis seçilir, varsayılana göre tasarruf gösterilir.', 'The cheapest eligible service is picked for your cost priority, with savings vs the default.') : bi('Hız önceliğinize göre teslim süresi ağırlığı yükseltilir.', 'The delivery speed weight is raised for your speed priority.'), link: '/ai/optimizer' })
  if (wTrack >= 0.8) services.push({ code: 'tracking_page', title: bi('Markalı takip sayfası', 'Branded tracking page'), reason: bi('Alıcılarınızla paylaşabileceğiniz oturumsuz takip sayfası.', 'A public tracking page you can share with your buyers.'), link: '/track' })
  if (plan !== 'starter' && (channels.includes('api') || wApi >= 0.6)) services.push({ code: 'api', title: bi('REST API ve webhook\'lar', 'REST API and webhooks'), reason: bi('Kendi sitenizden fiyat sorgusu, etiket ve takip olayları.', 'Rate quotes, labels and tracking events from your own site.'), link: '/integrations/api' })

  return { plan, scores, confidence, hub, services, reasons: { plan: planReasons, hub: hubReason } }
}

export function planName(plan) { return PLAN_NAMES[plan] ?? PLAN_NAMES.starter }
