/**
 * Carrier, service, zone and tariff defaults shared by the landing page,
 * the demo app and the seed generator (`scripts/generate-seed.mjs`).
 *
 * The seed generator writes CARRIERS to `src/app/data/seed/carriers.json`
 * and the tariff blocks to `rate_cards.json`. At runtime the app reads the
 * (possibly user modified) copies loaded from the backend API and passes them to
 * `rateEngine.js`; the landing calculator can fall back to these defaults.
 *
 * Carrier shape:
 *   { code, name, type: 'domestic'|'regional'|'international', color, ink,
 *     status: 'active'|'inactive', coverage: null | ['CA', ...],
 *     originHubs?: ['LA01'] (omitted = every hub), poBoxAllowed, fuelPct,
 *     addressCorrectionFee, onTimeByZone {2..8}, volumeTiers [{weeklyVolume, discountPct}],
 *     adapterVersion, adapterTemplate, connectedSince, apiHealth {avgMs}, supportedOps[],
 *     services: [{ code, name, level: 'economy'|'standard'|'express',
 *                  base {2..8}, perLb {2..8}, resFee, transitDays {2..8},
 *                  residentialOnly?, commercialOnly?,
 *                  signatureIncluded, saturdayDelivery, poBoxAllowed,
 *                  trackingGranularity: 'basic'|'detailed'|'realtime',
 *                  insuranceIncludedUpTo (USD, 0 = none), claimsWindowDays,
 *                  cutoffTime 'HH:MM' (hub drop cut-off), ddpSupported, returnLabelSupported }] }
 *   Service feature fields come from SERVICE_FEATURES below.
 *
 * Only plain JS here (no Vue, no alias imports) so Node can import it too.
 */

export const ZONES = [2, 3, 4, 5, 6, 7, 8]

/** helper: [z2..z8] -> {2:..,8:..} */
export function zoneMap(arr) {
  const o = {}
  ZONES.forEach((z, i) => {
    o[z] = Array.isArray(arr) ? arr[i] : arr
  })
  return o
}

/** zoneTable[hub][first digit of destination ZIP] -> zone 2..8 */
export const ZONE_TABLE = {
  NJ01: [2, 2, 3, 4, 5, 6, 6, 7, 8, 8],
  LA01: [8, 8, 8, 7, 7, 6, 5, 5, 4, 2],
}

/**
 * Refinements on top of the first digit table (ZIP3 ranges, inclusive).
 * Alaska and Hawaii are always zone 8; Oregon / Washington are zone 4 from LA01.
 */
export const ZONE_OVERRIDES = [
  { from: 967, to: 968, zone: 8 },
  { from: 995, to: 999, zone: 8 },
  { hub: 'LA01', from: 970, to: 994, zone: 4 },
]

export const US_HUBS = ['NJ01', 'LA01']

export const WEST_STATES = ['CA', 'OR', 'WA', 'NV', 'AZ', 'UT', 'CO', 'ID', 'NM', 'TX']
export const LSO_STATES = ['TX', 'OK', 'LA', 'AR', 'NM']

const ALL_OPS = ['rates', 'label', 'void', 'track', 'manifest', 'address', 'pickup']

export const CARRIERS = [
  {
    code: 'FDX',
    name: 'FedEx',
    type: 'domestic',
    color: '#4D148C',
    ink: '#FFFFFF',
    status: 'active',
    coverage: null,
    poBoxAllowed: false,
    fuelPct: 0.155,
    addressCorrectionFee: 24.0,
    onTimeByZone: zoneMap([0.97, 0.965, 0.96, 0.955, 0.95, 0.94, 0.93]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 50, discountPct: 0.03 },
      { weeklyVolume: 150, discountPct: 0.06 },
      { weeklyVolume: 300, discountPct: 0.09 },
    ],
    adapterVersion: '2.6.1',
    adapterTemplate: 'REST-JSON',
    apiHealth: { avgMs: 412 },
    supportedOps: ALL_OPS,
    services: [
      {
        code: 'GROUND', name: 'FedEx Ground', level: 'standard', commercialOnly: true,
        base: zoneMap([9.25, 9.7, 10.3, 10.85, 11.55, 12.25, 13.75]),
        perLb: zoneMap([0.55, 0.68, 0.82, 0.98, 1.18, 1.38, 1.62]),
        resFee: 0, transitDays: zoneMap([1, 2, 3, 3, 4, 5, 5]),
      },
      {
        code: 'HOME', name: 'FedEx Home Delivery', level: 'standard', residentialOnly: true,
        base: zoneMap([9.6, 10.05, 10.65, 11.2, 11.95, 12.65, 14.2]),
        perLb: zoneMap([0.55, 0.68, 0.82, 0.98, 1.18, 1.38, 1.62]),
        resFee: 2.6, transitDays: zoneMap([1, 2, 3, 3, 4, 5, 5]),
      },
      {
        code: '2DAY', name: 'FedEx 2Day', level: 'express',
        base: zoneMap([19.4, 21.1, 23.3, 25.2, 27.6, 29.9, 32.8]),
        perLb: zoneMap([1.35, 1.7, 2.1, 2.55, 2.95, 3.4, 3.85]),
        resFee: 4.95, transitDays: zoneMap(2),
      },
      {
        code: 'STD_ON', name: 'FedEx Standard Overnight', level: 'express',
        base: zoneMap([37.9, 43.6, 50.2, 56.4, 61.8, 66.9, 72.5]),
        perLb: zoneMap([2.4, 3.05, 3.8, 4.55, 5.2, 5.85, 6.5]),
        resFee: 4.95, transitDays: zoneMap(1),
      },
    ],
  },
  {
    code: 'UPS',
    name: 'UPS',
    type: 'domestic',
    color: '#351C15',
    ink: '#FFB500',
    status: 'active',
    coverage: null,
    poBoxAllowed: false,
    fuelPct: 0.15,
    addressCorrectionFee: 23.0,
    onTimeByZone: zoneMap([0.975, 0.97, 0.965, 0.955, 0.95, 0.945, 0.935]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 60, discountPct: 0.035 },
      { weeklyVolume: 150, discountPct: 0.065 },
      { weeklyVolume: 300, discountPct: 0.095 },
    ],
    adapterVersion: '3.1.0',
    adapterTemplate: 'REST-JSON',
    apiHealth: { avgMs: 388 },
    supportedOps: ALL_OPS,
    services: [
      {
        code: 'GROUND', name: 'UPS Ground', level: 'standard',
        base: zoneMap([9.45, 9.85, 10.4, 10.95, 11.6, 12.3, 13.9]),
        perLb: zoneMap([0.55, 0.66, 0.8, 0.96, 1.15, 1.35, 1.6]),
        resFee: 3.4, transitDays: zoneMap([1, 2, 3, 3, 4, 5, 5]),
      },
      {
        code: '3DS', name: 'UPS 3 Day Select', level: 'standard',
        base: zoneMap([14.2, 16.1, 17.9, 19.8, 21.4, 23.1, 25.3]),
        perLb: zoneMap([0.95, 1.2, 1.45, 1.75, 2.05, 2.35, 2.7]),
        resFee: 4.8, transitDays: zoneMap(3),
      },
      {
        code: '2DA', name: 'UPS 2nd Day Air', level: 'express',
        base: zoneMap([18.9, 20.7, 22.8, 24.7, 27.1, 29.4, 32.3]),
        perLb: zoneMap([1.3, 1.65, 2.05, 2.5, 2.9, 3.35, 3.8]),
        resFee: 4.8, transitDays: zoneMap(2),
      },
      {
        code: 'NDAS', name: 'UPS Next Day Air Saver', level: 'express',
        base: zoneMap([35.6, 41.2, 47.7, 53.9, 59.1, 64.2, 69.8]),
        perLb: zoneMap([2.3, 2.95, 3.7, 4.45, 5.1, 5.75, 6.4]),
        resFee: 4.8, transitDays: zoneMap(1),
      },
    ],
  },
  {
    code: 'USPS',
    name: 'USPS',
    type: 'domestic',
    color: '#004B87',
    ink: '#FFFFFF',
    status: 'active',
    coverage: null,
    poBoxAllowed: true,
    fuelPct: 0.12,
    addressCorrectionFee: 0,
    onTimeByZone: zoneMap([0.955, 0.945, 0.935, 0.925, 0.915, 0.905, 0.89]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 75, discountPct: 0.02 },
      { weeklyVolume: 200, discountPct: 0.045 },
      { weeklyVolume: 400, discountPct: 0.07 },
    ],
    adapterVersion: '2.2.4',
    adapterTemplate: 'REST-JSON',
    apiHealth: { avgMs: 521 },
    supportedOps: ['rates', 'label', 'void', 'track', 'manifest', 'address', 'pickup'],
    services: [
      {
        code: 'GA', name: 'USPS Ground Advantage', level: 'economy',
        base: zoneMap([6.95, 7.15, 7.5, 8.05, 8.85, 9.55, 10.45]),
        perLb: zoneMap([0.4, 0.52, 0.68, 0.95, 1.25, 1.6, 1.95]),
        resFee: 0, transitDays: zoneMap([2, 3, 3, 4, 4, 5, 5]),
      },
      {
        code: 'PM', name: 'USPS Priority Mail', level: 'standard',
        base: zoneMap([8.45, 8.8, 9.3, 10.2, 11.4, 12.6, 13.9]),
        perLb: zoneMap([0.85, 1.05, 1.4, 1.85, 2.35, 2.85, 3.3]),
        resFee: 0, transitDays: zoneMap([1, 2, 2, 3, 3, 3, 3]),
      },
      {
        code: 'PME', name: 'USPS Priority Mail Express', level: 'express',
        base: zoneMap([27.4, 29.8, 32.6, 35.9, 38.7, 41.3, 44.8]),
        perLb: zoneMap([1.6, 2.1, 2.8, 3.6, 4.3, 5.0, 5.7]),
        resFee: 0, transitDays: zoneMap([1, 1, 2, 2, 2, 2, 2]),
      },
    ],
  },
  {
    code: 'DHLE',
    name: 'DHL eCommerce',
    type: 'domestic',
    color: '#FFCC00',
    ink: '#D40511',
    status: 'active',
    coverage: null,
    poBoxAllowed: true,
    fuelPct: 0.13,
    addressCorrectionFee: 0,
    onTimeByZone: zoneMap([0.94, 0.93, 0.92, 0.91, 0.9, 0.89, 0.875]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 40, discountPct: 0.04 },
      { weeklyVolume: 120, discountPct: 0.07 },
      { weeklyVolume: 250, discountPct: 0.1 },
    ],
    adapterVersion: '1.8.0',
    adapterTemplate: 'REST-JSON',
    apiHealth: { avgMs: 604 },
    supportedOps: ['rates', 'label', 'void', 'track', 'manifest', 'pickup'],
    services: [
      {
        code: 'EXP', name: 'DHL eCommerce Parcel Expedited', level: 'standard',
        base: zoneMap([6.4, 6.7, 7.1, 7.7, 8.35, 9.1, 9.9]),
        perLb: zoneMap([0.45, 0.58, 0.75, 1.0, 1.3, 1.63, 1.95]),
        resFee: 0, transitDays: zoneMap([2, 3, 3, 4, 4, 5, 5]),
      },
      {
        code: 'GND', name: 'DHL eCommerce Parcel Ground', level: 'economy',
        base: zoneMap([5.6, 5.85, 6.2, 6.75, 7.35, 8.05, 8.8]),
        perLb: zoneMap([0.4, 0.5, 0.66, 0.88, 1.15, 1.45, 1.75]),
        resFee: 0, transitDays: zoneMap([3, 4, 5, 5, 6, 7, 7]),
      },
    ],
  },
  {
    code: 'ONT',
    name: 'OnTrac',
    type: 'regional',
    color: '#F26F21',
    ink: '#FFFFFF',
    status: 'active',
    coverage: WEST_STATES,
    originHubs: ['LA01'],
    poBoxAllowed: false,
    fuelPct: 0.14,
    addressCorrectionFee: 18.0,
    onTimeByZone: zoneMap([0.965, 0.96, 0.95, 0.94, 0.93, 0.92, 0.91]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 30, discountPct: 0.04 },
      { weeklyVolume: 100, discountPct: 0.08 },
    ],
    adapterVersion: '1.4.2',
    adapterTemplate: 'REST-JSON',
    apiHealth: { avgMs: 455 },
    supportedOps: ['rates', 'label', 'void', 'track', 'manifest'],
    services: [
      {
        code: 'GROUND', name: 'OnTrac Ground', level: 'standard',
        base: zoneMap([7.2, 7.55, 7.95, 8.5, 9.1, 9.8, 10.6]),
        perLb: zoneMap([0.45, 0.56, 0.7, 0.88, 1.05, 1.25, 1.5]),
        resFee: 1.95, transitDays: zoneMap([1, 1, 2, 2, 3, 3, 3]),
      },
    ],
  },
  {
    code: 'LSO',
    name: 'LSO',
    type: 'regional',
    color: '#00558C',
    ink: '#FFFFFF',
    status: 'active',
    coverage: LSO_STATES,
    originHubs: ['LA01'],
    poBoxAllowed: false,
    fuelPct: 0.135,
    addressCorrectionFee: 15.0,
    onTimeByZone: zoneMap([0.96, 0.955, 0.945, 0.935, 0.925, 0.915, 0.9]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 25, discountPct: 0.04 },
      { weeklyVolume: 80, discountPct: 0.07 },
    ],
    adapterVersion: '1.1.3',
    adapterTemplate: 'SOAP-XML',
    apiHealth: { avgMs: 689 },
    supportedOps: ['rates', 'label', 'void', 'track', 'pickup'],
    services: [
      {
        code: 'GROUND', name: 'LSO Ground', level: 'standard',
        base: zoneMap([7.0, 7.35, 7.8, 8.4, 9.05, 9.75, 10.5]),
        perLb: zoneMap([0.45, 0.56, 0.7, 0.88, 1.05, 1.25, 1.5]),
        resFee: 2.25, transitDays: zoneMap([1, 1, 2, 2, 3, 3, 3]),
      },
      {
        code: 'PND', name: 'LSO Priority Next Day', level: 'express',
        base: zoneMap([15.8, 17.9, 20.1, 22.4, 24.6, 26.8, 29.1]),
        perLb: zoneMap([1.1, 1.4, 1.75, 2.1, 2.45, 2.8, 3.15]),
        resFee: 2.25, transitDays: zoneMap(1),
      },
    ],
  },
  {
    code: 'DHLX',
    name: 'DHL Express',
    type: 'international',
    color: '#FFCC00',
    ink: '#D40511',
    status: 'active',
    coverage: null,
    poBoxAllowed: false,
    fuelPct: 0.16,
    addressCorrectionFee: 20.0,
    onTimeByZone: zoneMap([0.97, 0.97, 0.965, 0.96, 0.96, 0.955, 0.95]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 100, discountPct: 0.05 },
      { weeklyVolume: 400, discountPct: 0.1 },
    ],
    adapterVersion: '2.0.5',
    adapterTemplate: 'REST-JSON',
    apiHealth: { avgMs: 472 },
    supportedOps: ['rates', 'label', 'void', 'track', 'manifest', 'pickup'],
    services: [
      {
        code: 'EXPRESS_WW', name: 'DHL Express Worldwide', level: 'express',
        base: zoneMap([42.5, 46.0, 49.5, 53.0, 56.5, 60.0, 64.0]),
        perLb: zoneMap([4.1, 4.4, 4.7, 5.0, 5.3, 5.6, 5.9]),
        resFee: 0, transitDays: zoneMap([2, 2, 3, 3, 3, 4, 4]),
      },
    ],
  },
  {
    code: 'EVRI',
    name: 'Evri',
    type: 'international',
    color: '#0A3B85',
    ink: '#FFFFFF',
    status: 'active',
    coverage: null,
    poBoxAllowed: false,
    fuelPct: 0.12,
    addressCorrectionFee: 0,
    onTimeByZone: zoneMap([0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95]),
    volumeTiers: [
      { weeklyVolume: 0, discountPct: 0 },
      { weeklyVolume: 50, discountPct: 0.05 },
    ],
    adapterVersion: '1.2.0',
    adapterTemplate: 'CSV-SFTP',
    apiHealth: { avgMs: 733 },
    supportedOps: ['rates', 'label', 'track', 'pickup'],
    services: [
      {
        code: 'UK_COLLECT', name: 'Evri UK Collection & Consolidation', level: 'economy',
        base: zoneMap(4.1), perLb: zoneMap(0.35),
        resFee: 0, transitDays: zoneMap(2),
      },
    ],
  },
]

/**
 * Per service features (shown in service comparisons). Demo values modelled on the carriers'
 * published service terms; the project owner should verify them.
 *   [signatureIncluded, saturdayDelivery, poBoxAllowed, trackingGranularity,
 *    insuranceIncludedUpTo (USD), claimsWindowDays, cutoffTime, ddpSupported, returnLabelSupported]
 */
export const SERVICE_FEATURES = {
  'FDX-GROUND': [false, false, false, 'detailed', 100, 60, '17:45', false, true],
  'FDX-HOME': [false, true, false, 'detailed', 100, 60, '17:45', false, true],
  'FDX-2DAY': [false, false, false, 'detailed', 100, 60, '17:45', false, true],
  'FDX-STD_ON': [false, false, false, 'realtime', 100, 60, '17:45', false, true],
  'UPS-GROUND': [false, false, false, 'detailed', 100, 60, '17:30', false, true],
  'UPS-3DS': [false, false, false, 'detailed', 100, 60, '17:30', false, true],
  'UPS-2DA': [false, false, false, 'detailed', 100, 60, '17:30', false, true],
  'UPS-NDAS': [false, false, false, 'realtime', 100, 60, '17:30', false, true],
  'USPS-GA': [false, true, true, 'basic', 100, 60, '18:00', false, true],
  'USPS-PM': [false, true, true, 'detailed', 100, 60, '18:00', false, true],
  'USPS-PME': [true, true, true, 'detailed', 100, 60, '18:00', false, true],
  'DHLE-EXP': [false, false, true, 'detailed', 0, 30, '16:45', false, true],
  'DHLE-GND': [false, false, true, 'basic', 0, 30, '16:45', false, false],
  'ONT-GROUND': [false, true, false, 'detailed', 100, 30, '18:00', false, false],
  'LSO-GROUND': [false, false, false, 'detailed', 100, 30, '16:30', false, true],
  'LSO-PND': [true, false, false, 'realtime', 100, 30, '16:30', false, true],
  'DHLX-EXPRESS_WW': [true, false, false, 'realtime', 0, 30, '15:00', true, true],
  'EVRI-UK_COLLECT': [false, false, false, 'basic', 0, 28, '12:00', false, false],
}
const FEATURE_KEYS = ['signatureIncluded', 'saturdayDelivery', 'poBoxAllowed', 'trackingGranularity', 'insuranceIncludedUpTo', 'claimsWindowDays', 'cutoffTime', 'ddpSupported', 'returnLabelSupported']
for (const c of CARRIERS) {
  for (const sv of c.services) {
    const row = SERVICE_FEATURES[`${c.code}-${sv.code}`]
    if (row) FEATURE_KEYS.forEach((k, i) => { sv[k] = row[i] })
  }
}

/**
 * Platform tariff defaults (Admin > Rate cards). `markup` per plan is applied on
 * top of the carrier cost. Landing calculator uses `starter`.
 */
export const PLATFORM_RATES = {
  markup: { starter: 0.28, professional: 0.2, enterprise: 0.14 },
  minLabelFee: 0.35,
  ownAccountFee: 0.05,
  insurance: { per100: 1.1, freeUpTo: 100 },
  marginRange: { min: 0.12, max: 0.28 },
  marketCapMultiplier: 1.05,
  dynamicValidityDays: 7,
  autoApproveBelowPct: 0.03,
}

/**
 * First mile tariff (origin country -> US hub). Amounts are USD sell prices.
 * airPerKg is per chargeable kg (max(actual, volumetric cm3/6000)).
 */
export const FIRST_MILE_TARIFF = {
  GB: {
    pickupPerParcel: 3.9, dropoffPerParcel: 0, consolidationPerParcel: 1.35,
    airPerKg: { NJ01: 4.2, LA01: 5.4 }, minAirKg: 1,
  },
  TR: {
    pickupPerParcel: 2.6, dropoffPerParcel: 0, consolidationPerParcel: 1.1,
    airPerKg: { NJ01: 3.9, LA01: 4.8 }, minAirKg: 1,
  },
  DE: {
    pickupPerParcel: 3.6, dropoffPerParcel: 0, consolidationPerParcel: 1.3,
    airPerKg: { NJ01: 4.4, LA01: 5.6 }, minAirKg: 1,
  },
  default: {
    pickupPerParcel: 4.2, dropoffPerParcel: 0, consolidationPerParcel: 1.5,
    airPerKg: { NJ01: 5.2, LA01: 5.9 }, minAirKg: 1,
  },
  customs: { perShipment: 18.0, perParcel: 0.35, singleParcelFee: 1.85 },
  lastMile: {
    store: { perParcel: 0.6 },
    direct: { carrier: 'USPS', service: 'GA', fallbackPerParcel: 7.9 },
  },
}

export const PLANS = [
  {
    id: 'starter',
    name: { tr: 'Başlangıç', en: 'Starter' },
    monthlyFee: 0,
    markupPct: 0.28,
    limits: { stores: 2, users: 1, apiAccess: false },
    features: [
      { tr: 'Panelden manuel etiket', en: 'Manual labels from the panel' },
      { tr: '2 mağaza bağlantısı', en: '2 store connections' },
      { tr: 'E-posta desteği', en: 'Email support' },
    ],
  },
  {
    id: 'professional',
    name: { tr: 'Profesyonel', en: 'Professional' },
    monthlyFee: 49,
    markupPct: 0.2,
    limits: { stores: null, users: 3, apiAccess: true },
    features: [
      { tr: 'API erişimi', en: 'API access' },
      { tr: 'Sınırsız mağaza', en: 'Unlimited stores' },
      { tr: 'Toplu işlemler', en: 'Batch processing' },
      { tr: "Webhook'lar", en: 'Webhooks' },
    ],
  },
  {
    id: 'enterprise',
    name: { tr: 'Kurumsal', en: 'Enterprise' },
    monthlyFee: 199,
    markupPct: 0.14,
    limits: { stores: null, users: null, apiAccess: true },
    features: [
      { tr: 'Çoklu kullanıcı ve roller', en: 'Multiple users and roles' },
      { tr: 'Özel tarife kartı', en: 'Custom rate card' },
      { tr: 'Müşteri gönderi kuralları', en: 'Shipping rules' },
      { tr: 'İlk mil ve gümrük hizmetleri', en: 'First mile and customs services' },
      { tr: 'Özel destek', en: 'Dedicated support' },
    ],
  },
]

export function findCarrier(carriers, code) {
  return (carriers || CARRIERS).find((c) => c.code === code) || null
}

export function findService(carrier, code) {
  if (!carrier) return null
  return (carrier.services || []).find((s) => s.code === code) || null
}

/** "UPS-GROUND" style id used in rules, countries and lanes. */
export function serviceKey(carrierCode, serviceCode) {
  return `${carrierCode}-${serviceCode}`
}
