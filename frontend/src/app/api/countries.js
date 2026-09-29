/**
 * Country configuration API (spec 9.6). Countries live in the `countries` collection
 * (persisted as localStorage `kpz_demo:countries`, which the landing calculator also reads).
 *
 * Sync helpers (reactive, for forms in other screens)
 *   originCountries() -> active countries with role 'origin' | 'both'        (intl create origin select)
 *   countryByCode(code) -> country | undefined
 *   addressFormatFor(code) -> country.addressFormat | null                   (AddressForm `format` prop)
 *   testPostcode(regex, value) -> { valid: boolean|null, error: 'regex'|null }   (null = empty value)
 *   countryPresets() -> presets from shared/countries.js COUNTRY_PRESETS not yet configured,
 *     each merged with wizard defaults { role, carriers, prohibited, originPoint }
 *   availableServices() -> [{ key: 'DHLX-EXPRESS_WW', carrier, carrierName, service, serviceName, type }]
 *
 * Async (request())
 *   listCountries() -> Country[] & { stats: { intlShipments, originPoints: Hub[] } }
 *   getCountry(code) -> Country & stats
 *   saveCountry(code, patch) -> Country         VALIDATION { field: code }
 *   setCountryActive(code, active) -> Country   US_LOCKED for the destination market
 *   createCountry(def) -> { country, hub }      new market wizard: inserts the country (active, isNewMarket)
 *     and its consolidation point hub; COUNTRY_EXISTS when present. Usable immediately as origin.
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { audit, notify } from '../store/events.js'
import { COUNTRY_PRESETS } from '@/shared/countries.js'

const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

/** Wizard defaults per preset: consolidation point, restricted goods template. */
const PRESET_EXTRAS = {
  CA: {
    originPoint: { code: 'YYZ-CP', name: { tr: 'Toronto Konsolidasyon Noktası (YYZ)', en: 'Toronto Consolidation Point (YYZ)' }, address: { line1: '6500 Silver Dart Dr', line2: 'Cargo Bldg 3', city: 'Mississauga', state: 'ON', zip: 'L5P 1B2', country: 'CA' }, timezone: 'America/Toronto', airports: ['YYZ'], flights: ['AC 740 YYZ-JFK', 'AC 791 YYZ-LAX'] },
    prohibited: [
      { category: { tr: 'Kenevir ürünleri', en: 'Cannabis products' }, hsPrefixes: ['1211', '5302'] },
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
    ],
  },
  FR: {
    originPoint: { code: 'CDG-CP', name: { tr: 'Paris Konsolidasyon Noktası (CDG)', en: 'Paris Consolidation Point (CDG)' }, address: { line1: 'Zone de Fret 4', line2: 'Bâtiment 3420', city: 'Roissy-en-France', state: '', zip: '95700', country: 'FR' }, timezone: 'Europe/Paris', airports: ['CDG'], flights: ['AF 006 CDG-JFK', 'AF 066 CDG-LAX'] },
    prohibited: [
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
      { category: { tr: 'Parfüm ve alkol bazlı ürünler (sınırlı)', en: 'Perfume and alcohol based goods (restricted)' }, hsPrefixes: ['3303'] },
    ],
  },
  NL: {
    originPoint: { code: 'AMS-CP', name: { tr: 'Amsterdam Konsolidasyon Noktası (AMS)', en: 'Amsterdam Consolidation Point (AMS)' }, address: { line1: 'Pelikaanweg 2', line2: 'Cargo Area Schiphol', city: 'Schiphol', state: '', zip: '1118 DR', country: 'NL' }, timezone: 'Europe/Amsterdam', airports: ['AMS'], flights: ['KL 641 AMS-JFK', 'KL 601 AMS-LAX'] },
    prohibited: [
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
      { category: { tr: 'Canlı bitki ve çiçek soğanı', en: 'Live plants and flower bulbs' }, hsPrefixes: ['0601', '0602'] },
    ],
  },
  AU: {
    originPoint: { code: 'SYD-CP', name: { tr: 'Sidney Konsolidasyon Noktası (SYD)', en: 'Sydney Consolidation Point (SYD)' }, address: { line1: '1 Link Rd', line2: 'Freight Terminal', city: 'Mascot', state: 'NSW', zip: '2020', country: 'AU' }, timezone: 'Australia/Sydney', airports: ['SYD'], flights: ['QF 11 SYD-JFK', 'QF 11 SYD-LAX'] },
    prohibited: [
      { category: { tr: 'Tohum ve toprak içeren ürünler', en: 'Seeds and goods containing soil' }, hsPrefixes: ['1209', '2530'] },
      { category: { tr: 'Lityum piller (tek başına)', en: 'Loose lithium batteries' }, hsPrefixes: ['8506', '8507'] },
    ],
  },
}

function stats(code) {
  const intlShipments = db.all('intl_shipments').filter(s => (s.origin ?? s.originCountry ?? s.from?.country) === code).length
  const originPoints = db.all('hubs').filter(h => h.country === code && h.type !== 'us_hub').map(h => ({ code: h.code, name: h.name, type: h.type, active: h.active }))
  return { intlShipments, originPoints }
}

export function originCountries() {
  return db.all('countries').filter(c => c.active !== false && (c.role === 'origin' || c.role === 'both'))
}
export function countryByCode(code) { return db.get('countries', code) }
export function addressFormatFor(code) { return db.get('countries', code)?.addressFormat ?? null }

export function testPostcode(regex, value) {
  let re
  try { re = new RegExp(regex, 'i') } catch { return { valid: null, error: 'regex' } }
  const v = String(value ?? '').trim()
  if (!v) return { valid: null, error: null }
  return { valid: re.test(v.toUpperCase()), error: null }
}

export function availableServices() {
  const out = []
  for (const c of db.all('carriers')) {
    if (c.status !== 'active') continue
    for (const s of c.services ?? []) out.push({ key: `${c.code}-${s.code}`, carrier: c.code, carrierName: c.name, service: s.code, serviceName: s.name, type: c.type })
  }
  return out.sort((a, b) => (a.type === 'international' ? 0 : 1) - (b.type === 'international' ? 0 : 1))
}

export function countryPresets() {
  const have = new Set(db.all('countries').map(c => c.code))
  return COUNTRY_PRESETS.filter(p => !have.has(p.code)).map(p => ({
    ...plain(p),
    role: 'origin',
    carriers: ['DHLX-EXPRESS_WW'],
    prohibited: plain(PRESET_EXTRAS[p.code]?.prohibited ?? []),
    originPoint: plain(PRESET_EXTRAS[p.code]?.originPoint ?? null),
  }))
}

export function listCountries() {
  return request('GET /v1/admin/countries', () => db.all('countries').map(c => ({ ...plain(c), stats: stats(c.code) })), { minMs: 300, maxMs: 600 })
}

export function getCountry(code) {
  return request(`GET /v1/admin/countries/${code}`, () => {
    const c = db.get('countries', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Country not found', 404)
    return { ...plain(c), stats: stats(code) }
  }, { minMs: 200, maxMs: 400 })
}

function validateCountry(c, { isNew = false } = {}) {
  const errors = {}
  if (isNew) {
    if (!/^[A-Z]{2}$/.test(c.code ?? '')) errors.code = 'country'
    else if (db.get('countries', c.code)) errors.code = 'country_exists'
  }
  if (!String(c.name?.tr ?? '').trim()) errors['name.tr'] = 'required'
  if (!String(c.name?.en ?? '').trim()) errors['name.en'] = 'required'
  if (!/^[A-Z]{3}$/.test(c.currency ?? '')) errors.currency = 'currency'
  if (!String(c.currencySymbol ?? '').trim()) errors.currencySymbol = 'required'
  if (!(Number(c.fxToUsd) > 0)) errors.fxToUsd = 'positive'
  if (!['imperial', 'metric'].includes(c.units)) errors.units = 'required'
  if (!['tr', 'en'].includes(c.defaultLang)) errors.defaultLang = 'required'
  if (!['origin', 'destination', 'both'].includes(c.role)) errors.role = 'required'
  const f = c.addressFormat ?? {}
  if (!Array.isArray(f.fields) || !f.fields.length) errors['addressFormat.fields'] = 'required'
  else if (!f.fields.some(x => x.key === 'line1')) errors['addressFormat.fields'] = 'line1_required'
  try { new RegExp(f.postalRegex ?? '') } catch { errors['addressFormat.postalRegex'] = 'regex' }
  if (!String(f.postalRegex ?? '').trim()) errors['addressFormat.postalRegex'] = 'required'
  if (f.postalExample && !errors['addressFormat.postalRegex'] && !new RegExp(f.postalRegex, 'i').test(String(f.postalExample).toUpperCase())) errors['addressFormat.postalExample'] = 'example_mismatch'
  if (c.deMinimis && !(Number(c.deMinimis.amount) >= 0)) errors['deMinimis.amount'] = 'number'
  if (c.vatRate != null && !(Number(c.vatRate) >= 0 && Number(c.vatRate) <= 0.5)) errors.vatRate = 'range'
  if (!Array.isArray(c.carriers) || !c.carriers.length) errors.carriers = 'required'
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid country', 422, errors)
}

const EDITABLE = ['name', 'flag', 'role', 'currency', 'currencySymbol', 'fxToUsd', 'units', 'defaultLang', 'addressFormat', 'carriers', 'deMinimis', 'prohibited', 'vatRate']

export function saveCountry(code, patch) {
  return request(`PUT /v1/admin/countries/${code}`, () => {
    const c = db.get('countries', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Country not found', 404)
    const next = { ...plain(c) }
    for (const k of EDITABLE) if (k in patch) next[k] = plain(patch[k])
    next.currency = String(next.currency ?? '').toUpperCase()
    next.fxToUsd = Number(next.fxToUsd)
    next.vatRate = Number(next.vatRate ?? 0)
    if (next.deMinimis) next.deMinimis = { amount: Number(next.deMinimis.amount), currency: String(next.deMinimis.currency || next.currency).toUpperCase() }
    if (code === 'US') next.role = 'destination'
    validateCountry(next)
    const r = db.update('countries', code, next)
    audit('country.update', code, { tr: `Ülke yapılandırması güncellendi: ${next.name.tr}`, en: `Country configuration updated: ${next.name.en}` })
    return { ...plain(r), stats: stats(code) }
  })
}

export function setCountryActive(code, active) {
  return request(`PATCH /v1/admin/countries/${code}`, () => {
    const c = db.get('countries', code)
    if (!c) throw new ApiError('NOT_FOUND', 'Country not found', 404)
    if (code === 'US' && !active) throw new ApiError('US_LOCKED', 'The destination market cannot be disabled', 409)
    const r = db.update('countries', code, { active: !!active })
    for (const h of db.all('hubs').filter(x => x.country === code && x.type !== 'us_hub')) db.update('hubs', h.code, { active: !!active })
    audit(active ? 'country.activate' : 'country.deactivate', code, c.name)
    return { ...plain(r), stats: stats(code) }
  }, { minMs: 300, maxMs: 600 })
}

export function createCountry(def) {
  return request('POST /v1/admin/countries', async () => {
    const code = String(def.code ?? '').toUpperCase()
    if (db.get('countries', code)) throw new ApiError('COUNTRY_EXISTS', 'Country exists', 409, { code: 'country_exists' })
    const now = new Date().toISOString()
    const country = {
      code,
      name: plain(def.name),
      flag: def.flag ?? '',
      role: def.role ?? 'origin',
      currency: String(def.currency ?? '').toUpperCase(),
      currencySymbol: def.currencySymbol,
      fxToUsd: Number(def.fxToUsd),
      units: def.units,
      defaultLang: def.defaultLang,
      addressFormat: plain(def.addressFormat),
      carriers: plain(def.carriers ?? []),
      deMinimis: { amount: Number(def.deMinimis?.amount ?? 0), currency: String(def.deMinimis?.currency || def.currency).toUpperCase() },
      prohibited: plain(def.prohibited ?? []),
      vatRate: Number(def.vatRate ?? 0),
      active: true,
      launchedAt: now,
      isNewMarket: true,
      originPoints: [],
    }
    validateCountry(country, { isNew: true })
    let hub = null
    await db.transaction(() => {
      const op = def.originPoint
      if (op && op.code) {
        const hubCode = db.get('hubs', op.code) ? `${op.code}-${code}` : op.code
        hub = {
          code: hubCode, type: 'origin_point', country: code, name: plain(op.name),
          address: plain(op.address), timezone: op.timezone ?? 'UTC', cutoff: op.cutoff ?? '14:00',
          airports: plain(op.airports ?? []), flights: plain(op.flights ?? []),
          active: true, openedAt: now, isNewMarket: true,
        }
        db.insert('hubs', hub, { prepend: false })
        country.originPoints = [hubCode]
      }
      db.insert('countries', country, { prepend: false })
    })
    audit('country.create', code, { tr: `Yeni pazar etkinleştirildi: ${country.name.tr}`, en: `New market activated: ${country.name.en}` })
    notify({ type: 'success', title: { tr: `Yeni pazar etkin: ${country.name.tr}`, en: `New market active: ${country.name.en}` }, body: { tr: 'Uluslararası gönderi oluşturmada menşe olarak seçilebilir.', en: 'Can now be selected as origin when creating international shipments.' }, link: '/admin/countries' })
    return { country: { ...plain(country), stats: stats(code) }, hub: plain(hub) }
  }, { minMs: 600, maxMs: 900 })
}
