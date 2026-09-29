/**
 * Country configuration defaults (spec 9.6). The seed generator writes
 * COUNTRIES to `src/app/data/seed/countries.json`; the app edits the
 * stored copy in the backend (Admin > Country configuration) and the "new market"
 * wizard starts from COUNTRY_PRESETS.
 *
 * Shape: { code, name{tr,en}, flag, role: 'destination'|'origin'|'both',
 *   currency, currencySymbol, fxToUsd, units: 'imperial'|'metric', defaultLang,
 *   addressFormat: { fields: [{ key, label{tr,en}, required }], postalRegex, postalExample, postalLabel{tr,en} },
 *   carriers: ['UPS-GROUND', ...], deMinimis: { amount, currency },
 *   prohibited: [{ category{tr,en}, hsPrefixes[] }], vatRate, active, launchedAt, isNewMarket, originPoints[] }
 * `launchedAt` is filled in by the seed generator with a relative date object.
 */

const F = {
  name: { key: 'name', label: { tr: 'Ad Soyad', en: 'Full name' }, required: true },
  company: { key: 'company', label: { tr: 'Şirket', en: 'Company' }, required: false },
  line1: { key: 'line1', label: { tr: 'Adres satırı 1', en: 'Address line 1' }, required: true },
  line2: { key: 'line2', label: { tr: 'Adres satırı 2', en: 'Address line 2' }, required: false },
  city: { key: 'city', label: { tr: 'Şehir', en: 'City' }, required: true },
  state: { key: 'state', label: { tr: 'Eyalet', en: 'State' }, required: true },
  zip: { key: 'zip', label: { tr: 'ZIP kodu', en: 'ZIP code' }, required: true },
  postcode: { key: 'zip', label: { tr: 'Posta kodu', en: 'Postcode' }, required: true },
  county: { key: 'state', label: { tr: 'İlçe / County', en: 'County' }, required: false },
  province: { key: 'state', label: { tr: 'İl', en: 'Province' }, required: true },
  district: { key: 'district', label: { tr: 'İlçe', en: 'District' }, required: true },
  phone: { key: 'phone', label: { tr: 'Telefon', en: 'Phone' }, required: false },
}

const US_DOMESTIC_SERVICES = [
  'FDX-GROUND', 'FDX-HOME', 'FDX-2DAY', 'FDX-STD_ON',
  'UPS-GROUND', 'UPS-3DS', 'UPS-2DA', 'UPS-NDAS',
  'USPS-GA', 'USPS-PM', 'USPS-PME',
  'DHLE-EXP', 'DHLE-GND', 'ONT-GROUND', 'LSO-GROUND', 'LSO-PND',
]

export const COUNTRIES = [
  {
    code: 'US',
    name: { tr: 'Amerika Birleşik Devletleri', en: 'United States' },
    flag: '🇺🇸',
    role: 'destination',
    currency: 'USD',
    currencySymbol: '$',
    fxToUsd: 1,
    units: 'imperial',
    defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.city, F.state, F.zip, F.phone],
      postalRegex: '^\\d{5}(-\\d{4})?$',
      postalExample: '78701',
      postalLabel: { tr: 'ZIP kodu', en: 'ZIP code' },
    },
    carriers: US_DOMESTIC_SERVICES,
    deMinimis: { amount: 800, currency: 'USD' },
    prohibited: [
      { category: { tr: 'Taze meyve ve sebze', en: 'Fresh fruit and vegetables' }, hsPrefixes: ['07', '08'] },
      { category: { tr: 'Et ve et ürünleri', en: 'Meat and meat products' }, hsPrefixes: ['02', '16'] },
      { category: { tr: 'Alkollü içecekler (lisanssız)', en: 'Alcoholic beverages (unlicensed)' }, hsPrefixes: ['2203', '2204', '2208'] },
      { category: { tr: 'Tütün ürünleri', en: 'Tobacco products' }, hsPrefixes: ['24'] },
      { category: { tr: 'Yanıcı sıvılar ve aerosoller', en: 'Flammable liquids and aerosols' }, hsPrefixes: ['2710', '3605'] },
    ],
    vatRate: 0,
    active: true,
    isNewMarket: false,
    originPoints: [],
  },
  {
    code: 'GB',
    name: { tr: 'Birleşik Krallık', en: 'United Kingdom' },
    flag: '🇬🇧',
    role: 'origin',
    currency: 'GBP',
    currencySymbol: '£',
    fxToUsd: 1.27,
    units: 'metric',
    defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.city, F.county, F.postcode, F.phone],
      postalRegex: '^[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}$',
      postalExample: 'SW1A 1AA',
      postalLabel: { tr: 'Posta kodu', en: 'Postcode' },
    },
    carriers: ['EVRI-UK_COLLECT', 'DHLX-EXPRESS_WW'],
    deMinimis: { amount: 135, currency: 'GBP' },
    prohibited: [
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
      { category: { tr: 'Aerosoller', en: 'Aerosols' }, hsPrefixes: ['3605'] },
      { category: { tr: 'Et ve süt ürünleri', en: 'Meat and dairy products' }, hsPrefixes: ['02', '04'] },
    ],
    vatRate: 0.2,
    active: true,
    isNewMarket: false,
    originPoints: ['LHR-CP', 'EVRI-NET'],
  },
  {
    code: 'TR',
    name: { tr: 'Türkiye', en: 'Türkiye' },
    flag: '🇹🇷',
    role: 'origin',
    currency: 'TRY',
    currencySymbol: '₺',
    fxToUsd: 0.024,
    units: 'metric',
    defaultLang: 'tr',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.district, F.province, F.postcode, F.phone],
      postalRegex: '^\\d{5}$',
      postalExample: '34394',
      postalLabel: { tr: 'Posta kodu', en: 'Postal code' },
    },
    carriers: ['DHLX-EXPRESS_WW'],
    deMinimis: { amount: 150, currency: 'EUR' },
    prohibited: [
      { category: { tr: 'Antika ve kültür varlıkları', en: 'Antiques and cultural property' }, hsPrefixes: ['9705', '9706'] },
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
      { category: { tr: 'Tarım ürünleri (fitosaniter belgesiz)', en: 'Agricultural goods without phytosanitary certificate' }, hsPrefixes: ['06', '07', '08', '12'] },
    ],
    vatRate: 0.2,
    active: true,
    isNewMarket: false,
    originPoints: ['IST-CP'],
  },
  {
    code: 'DE',
    name: { tr: 'Almanya', en: 'Germany' },
    flag: '🇩🇪',
    role: 'origin',
    currency: 'EUR',
    currencySymbol: '€',
    fxToUsd: 1.08,
    units: 'metric',
    defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.postcode, F.city, F.phone],
      postalRegex: '^\\d{5}$',
      postalExample: '60311',
      postalLabel: { tr: 'Posta kodu (PLZ)', en: 'Postcode (PLZ)' },
    },
    carriers: ['DHLX-EXPRESS_WW'],
    deMinimis: { amount: 150, currency: 'EUR' },
    prohibited: [
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
      { category: { tr: 'Aerosoller', en: 'Aerosols' }, hsPrefixes: ['3605'] },
    ],
    vatRate: 0.19,
    active: true,
    isNewMarket: true,
    originPoints: ['FRA-CP'],
  },
]

/** Ready-made templates for the "Add new market" wizard. */
export const COUNTRY_PRESETS = [
  {
    code: 'CA', name: { tr: 'Kanada', en: 'Canada' }, flag: '🇨🇦', currency: 'CAD', currencySymbol: 'C$',
    fxToUsd: 0.73, units: 'metric', defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.city, { ...F.province, label: { tr: 'Eyalet', en: 'Province' } }, F.postcode, F.phone],
      postalRegex: '^[A-Z]\\d[A-Z] ?\\d[A-Z]\\d$', postalExample: 'M5V 2T6',
      postalLabel: { tr: 'Posta kodu', en: 'Postal code' },
    },
    deMinimis: { amount: 150, currency: 'CAD' }, vatRate: 0.05,
  },
  {
    code: 'FR', name: { tr: 'Fransa', en: 'France' }, flag: '🇫🇷', currency: 'EUR', currencySymbol: '€',
    fxToUsd: 1.08, units: 'metric', defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.postcode, F.city, F.phone],
      postalRegex: '^\\d{5}$', postalExample: '75008', postalLabel: { tr: 'Posta kodu', en: 'Postcode' },
    },
    deMinimis: { amount: 150, currency: 'EUR' }, vatRate: 0.2,
  },
  {
    code: 'NL', name: { tr: 'Hollanda', en: 'Netherlands' }, flag: '🇳🇱', currency: 'EUR', currencySymbol: '€',
    fxToUsd: 1.08, units: 'metric', defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.postcode, F.city, F.phone],
      postalRegex: '^\\d{4} ?[A-Z]{2}$', postalExample: '1012 AB', postalLabel: { tr: 'Posta kodu', en: 'Postcode' },
    },
    deMinimis: { amount: 150, currency: 'EUR' }, vatRate: 0.21,
  },
  {
    code: 'AU', name: { tr: 'Avustralya', en: 'Australia' }, flag: '🇦🇺', currency: 'AUD', currencySymbol: 'A$',
    fxToUsd: 0.66, units: 'metric', defaultLang: 'en',
    addressFormat: {
      fields: [F.name, F.company, F.line1, F.line2, F.city, { ...F.state, label: { tr: 'Eyalet', en: 'State' } }, F.postcode, F.phone],
      postalRegex: '^\\d{4}$', postalExample: '2000', postalLabel: { tr: 'Posta kodu', en: 'Postcode' },
    },
    deMinimis: { amount: 1000, currency: 'AUD' }, vatRate: 0.1,
  },
]

export function findCountry(countries, code) {
  return (countries || COUNTRIES).find((c) => c.code === code) || null
}

/** Convert an amount in `currency` to USD with the (demo) rate from the country list. */
export function toUsd(amount, currency, countries) {
  if (currency === 'USD') return Math.round(amount * 100) / 100
  const c = (countries || COUNTRIES).find((x) => x.currency === currency) ||
    COUNTRY_PRESETS.find((x) => x.currency === currency)
  const rate = c ? c.fxToUsd : 1
  return Math.round(amount * rate * 100) / 100
}

/** Validate a postcode against a country's regex (case-insensitive, trimmed, normalized upper case). */
export function validatePostcode(country, value) {
  if (!country || !country.addressFormat) return true
  const v = String(value || '').trim().toUpperCase()
  return new RegExp(country.addressFormat.postalRegex).test(v)
}
