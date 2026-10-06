// Landing calculator: same offer rules as the panel (app/api/quotePros.js, pure) and the same
// pros / cons / comparison texts (app/i18n/modules/compare.js), without the app store.
import { offerFromQuote, annotateOffers, formatParams, aiSummary, compareMatrix, featuresOf, etaRange, rankOffers, DIRECT_EXPRESS, FIRST_MILE_DAYS, PACKAGE_RELIABILITY } from '../app/api/quotePros.js'
import compareMessages from '../app/i18n/modules/compare.js'
import { rateShop, firstMileQuote, zoneFor, round2 } from '../shared/rateEngine.js'
import { computeLandedCost } from '../shared/landedCost.js'
import ratesSeed from '../app/data/seed/hs_duty_rates.json'
import countriesSeed from '../app/data/seed/countries.json'
import hsCodesSeed from '../app/data/seed/hs_codes.json'
import fxSeed from '../app/data/seed/fx.json'
import hubsSeed from '../app/data/seed/hubs.json'

export { aiSummary, compareMatrix }

function msg(lang, path) {
  let cur = (compareMessages[lang] || compareMessages.en).compare
  for (const p of path.split('.')) cur = cur?.[p]
  return typeof cur === 'string' ? cur : path
}
const fill = (s, params) => s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m))

/** Rate engine quotes (landing data) -> annotated offers. */
export function landingOffers(quotes, { carriers = [], recommendedKey = null } = {}) {
  const offers = (quotes || []).map(q => offerFromQuote(q, { carriers, declaredValue: 0 }))
  return annotateOffers(offers, { recommendedKey })
}

export function itemText(it, lang) {
  return fill(msg(lang, `${it.sign === '+' ? 'pros' : 'cons'}.${it.code}`), formatParams(it.params, lang))
}
export function badgeText(b, lang) { return msg(lang, 'badges.' + b) }
export function rowText(key, lang) { return msg(lang, 'sheet.rows.' + key) }
export function groupText(key, lang) { return msg(lang, 'sheet.groups.' + key) }
export function trackingText(v, lang) { return msg(lang, 'sheet.tracking.' + v) }
export function yesNo(v, lang) { return msg(lang, v ? 'sheet.yes' : 'sheet.no') }
export function daysText(o, lang) {
  if (!o) return '-'
  return o.etaMinDays === o.etaMaxDays ? fill(msg(lang, 'card.daysOne'), { n: o.etaMaxDays }) : fill(msg(lang, 'card.days'), { min: o.etaMinDays, max: o.etaMaxDays })
}
export function summaryText(s, offers, lang) {
  const o = (offers || []).find(x => x.key === s.key)
  const pro = s.pro ? itemText(s.pro, lang) : ''
  return fill(msg(lang, 'summary.' + s.code), formatParams({ ...s.params, name: o ? o.title || o.serviceName : s.params?.name, pro: pro ? pro.charAt(0).toLocaleLowerCase(lang) + pro.slice(1) : '' }, lang))
}

export function legText(code, lang) { return msg(lang, 'legs.' + code) }
export function offerSubText(o, lang) {
  if (o.kind === 'package') return fill(msg(lang, 'card.packageSub'), { carrier: o.carrierName })
  if (o.kind === 'direct') return msg(lang, 'card.directSub')
  return o.carrierName
}

const LB_PER_KG = 2.20462
const LANDED_CTX = { rates: ratesSeed, countries: countriesSeed, fx: fxSeed.rates, hsCodes: hsCodesSeed }

/**
 * First mile origin (TR, GB, DE...) -> US ZIP: end-to-end packages (consolidated air via the origin
 * point x NJ01/LA01 x a few last mile services) plus DHL Express direct, each with legs
 * first_mile / customs / duty / last_mile (direct: shipping + duty). Same shape as the panel offers.
 *   opts = { origin, zip, state, pkg: {lengthIn, widthIn, heightIn, weightLb}, carriers, rateCards,
 *            hsCode = '6912.00', valueUsd = 100, plan = 'starter', perHub = 3 }
 * -> { offers (annotated), recommendedKey, dutyUsd }
 */
export function landingPackages(opts) {
  const { origin, zip, state, pkg, carriers = [], rateCards = null, hsCode = '6912.00', valueUsd = 100, plan = 'starter', perHub = 3 } = opts
  const now = new Date()
  const weightKg = round2((Number(pkg.weightLb) || 0) / LB_PER_KG)
  const cm3 = (Number(pkg.lengthIn) || 0) * (Number(pkg.widthIn) || 0) * (Number(pkg.heightIn) || 0) * 16.387064
  const duty = computeLandedCost({ hsCode, origin, dest: 'US', valueUsd: Number(valueUsd) || 0, incoterm: 'DDP' }, LANDED_CTX)
  const dutyUsd = round2(duty.totalUsd || 0)
  const point = hubsSeed.find((h) => h.country === origin && h.type === 'origin_point')
  const pointCode = point ? point.code : origin + '-CP'
  const fmDays = FIRST_MILE_DAYS[origin] || FIRST_MILE_DAYS.default

  // direct express (single leg + duty)
  const cfg = DIRECT_EXPRESS[origin] || DIRECT_EXPRESS.default
  const dhl = carriers.find((c) => c.code === cfg.carrier)
  let direct = null
  if (dhl && dhl.status !== 'inactive') {
    const volKg = cm3 / 5000
    const chargeableKg = Math.ceil(Math.max(weightKg, volKg, 0.5) * 2) / 2
    const legs = [{ code: 'shipping', amount: round2(cfg.base + cfg.perKg * chargeableKg) }, { code: 'duty', amount: dutyUsd, estimated: true }]
    const features = featuresOf(carriers, cfg.carrier, cfg.service)
    const svc = (dhl.services || []).find((x) => x.code === cfg.service)
    direct = {
      key: origin + ':' + cfg.carrier + '-' + cfg.service, kind: 'direct', carrierCode: cfg.carrier, carrierName: dhl.name,
      serviceCode: cfg.service, serviceName: svc ? svc.name : cfg.service, title: svc ? svc.name : cfg.service,
      origin, originPoint: null, hub: null, total: round2(legs.reduce((a, l) => a + l.amount, 0)), legs,
      etaMinDays: cfg.days[0], etaMaxDays: cfg.days[1], onTimePct: (dhl.onTimeByZone && dhl.onTimeByZone[zoneFor('NJ01', zip)]) || null,
      source: 'platform', features, ddp: !!features.ddpSupported, crossBorder: true, dutyUsd, declaredValue: Number(valueUsd) || 0, poBoxDest: false,
      actualLb: Number(pkg.weightLb) || 0, billableLb: round2(chargeableKg * LB_PER_KG),
      dimExtraLb: volKg > weightKg + 0.5 ? Math.round((volKg - weightKg) * LB_PER_KG) : 0,
      ownSavingsPct: null, consolidationDelay: null, selectable: true, aiScore: null, connectHint: null, raw: null,
    }
  }

  const offers = []
  for (const hub of ['NJ01', 'LA01']) {
    const fm = firstMileQuote({ origin, weightKg, parcels: 1, volumetricKg: round2(cm3 / 6000), destHub: hub, handover: 'dropoff', lastMile: 'store', rateCards, plan, now })
    const firstMile = round2(fm.pickup + fm.consolidation + fm.airFreight)
    const lm = rateShop({ carriers, hub, toZip: zip, toState: String(state || '').toUpperCase(), pkg, residential: true, declaredValue: 0, insured: false, plan, rateCards, now })
    const byPrice = [...lm].sort((a, b) => a.total - b.total)
    const fastest = [...lm].sort((a, b) => (a.etaDays || 99) - (b.etaDays || 99) || a.total - b.total)[0]
    const keep = new Set(byPrice.slice(0, Math.max(1, perHub - 1)).map((q) => q.key))
    if (fastest) keep.add(fastest.key)
    for (const q of lm.filter((x) => keep.has(x.key))) {
      const legs = [
        { code: 'first_mile', amount: firstMile },
        { code: 'customs', amount: fm.customsFee },
        { code: 'duty', amount: dutyUsd, estimated: true },
        { code: 'last_mile', amount: round2(q.total) },
      ]
      const [lmMin, lmMax] = etaRange(q.etaDays, q.onTimePct)
      const etaMinDays = fmDays[0] + lmMin
      const etaMaxDays = fmDays[1] + lmMax
      offers.push({
        key: origin + ':' + hub + ':' + q.key, kind: 'package', carrierCode: q.carrierCode, carrierName: q.carrierName,
        serviceCode: q.serviceCode, serviceName: q.serviceName, title: pointCode + ' > ' + hub + ' > ' + q.serviceName,
        origin, originPoint: pointCode, hub, total: round2(legs.reduce((a, l) => a + l.amount, 0)), legs, etaMinDays, etaMaxDays,
        onTimePct: q.onTimePct != null ? Math.round(q.onTimePct * PACKAGE_RELIABILITY * 1000) / 1000 : null,
        source: q.source, features: { ...featuresOf(carriers, q.carrierCode, q.serviceCode), cutoffTime: (point && point.cutoff) || '15:00', ddpSupported: true },
        ddp: true, crossBorder: true, dutyUsd, declaredValue: Number(valueUsd) || 0, poBoxDest: false,
        actualLb: q.actualLb, billableLb: q.billableLb, dimExtraLb: q.dimWeightLb > Math.ceil(q.actualLb) ? q.billableLb - Math.ceil(q.actualLb) : 0,
        ownSavingsPct: null,
        consolidationDelay: direct
          ? [Math.max(1, Math.min(etaMinDays - direct.etaMinDays, etaMaxDays - direct.etaMaxDays)), Math.max(1, etaMinDays - direct.etaMinDays, etaMaxDays - direct.etaMaxDays)]
          : null,
        selectable: true, aiScore: null, connectHint: null, raw: null,
      })
    }
  }
  if (direct) offers.push(direct)
  const recommendedKey = rankOffers(offers, 0.6)
  const ann = annotateOffers(offers, { recommendedKey })
  return { offers: ann.offers, recommendedKey, dutyUsd }
}
