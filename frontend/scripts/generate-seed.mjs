#!/usr/bin/env node
/**
 * KargoPazar demo seed generator (deterministic, seed = 20261001).
 *
 *   cd frontend && npm run seed
 *
 * Writes JSON files to src/app/data/seed/. Running it twice produces
 * byte-identical output. Every datetime is stored relative to the day the
 * demo is opened: { "daysAgo": 3, "hour": 14, "minute": 5 } (negative
 * daysAgo = future). The app db layer converts these objects to ISO strings
 * at load time. Localized strings are { "tr": "...", "en": "..." }.
 *
 * Prices are computed with src/shared/rateEngine.js so the app and the seed agree.
 */
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mulberry32, hashSeed, randInt, randFloat, pick, weightedPick, normal, shuffle, chance } from '../src/app/ai/prng.js'
import { CARRIERS, PLATFORM_RATES, FIRST_MILE_TARIFF, PLANS, WEST_STATES, LSO_STATES, ZONE_TABLE, findCarrier } from '../src/shared/carriers.js'
import { COUNTRIES } from '../src/shared/countries.js'
import { quoteService, zoneFor, zoneGroup, laneKey, billableWeight, round2, firstMileQuote, toDate } from '../src/shared/rateEngine.js'
import { CITY_DATA, APARTMENT_ZIPS, ZIP3_STATE, STREET_SUFFIXES } from './seed-reference.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../src/app/data/seed')
const SEED = 20261001

// ---------------------------------------------------------------------------
// Clock. Generation happens against a fixed virtual "now" (a Thursday, 09:00).
// Everything is exported relative to that day, so the demo looks current on
// whatever day it is opened.
// ---------------------------------------------------------------------------
const NOW = new Date(2026, 9, 1, 9, 0, 0, 0)
const DAY = 86400000
const MIN = 60000

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function rel(daysAgo, hour = 0, minute = 0) {
  return { daysAgo, hour, minute }
}
function relOf(date) {
  const daysAgo = Math.round((startOfDay(NOW) - startOfDay(date)) / DAY)
  return { daysAgo, hour: date.getHours(), minute: date.getMinutes() }
}
function dateOf(r) {
  return toDate(r, NOW)
}
function atDay(daysAgo, hour = 0, minute = 0) {
  return dateOf(rel(daysAgo, hour, minute))
}
function addMin(d, m) {
  return new Date(d.getTime() + m * MIN)
}
function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY)
}

// Independent deterministic streams per section.
function stream(name) {
  const r = mulberry32((SEED ^ hashSeed(name)) >>> 0)
  return {
    next: r,
    int: (a, b) => randInt(r, a, b),
    float: (a, b, d) => randFloat(r, a, b, d),
    pick: (arr) => pick(r, arr),
    w: (items, weights) => weightedPick(r, items, weights),
    normal: (m, s) => normal(r, m, s),
    shuffle: (arr) => shuffle(r, arr),
    chance: (p) => chance(r, p),
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('SEED ASSERTION FAILED: ' + msg)
    process.exit(1)
  }
}

function L(tr, en) {
  return { tr, en }
}

function pad(n, w) {
  return String(n).padStart(w, '0')
}

function digits(r, n) {
  let s = ''
  for (let i = 0; i < n; i++) s += r.int(0, 9)
  return s
}

/** Largest remainder split of an integer total across shares (object). */
function splitInt(total, shares) {
  const keys = Object.keys(shares)
  const sum = keys.reduce((s, k) => s + shares[k], 0)
  const raw = keys.map((k) => (total * shares[k]) / sum)
  const floor = raw.map(Math.floor)
  let rest = total - floor.reduce((s, v) => s + v, 0)
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; k < rest; k++) floor[order[k][1]]++
  const o = {}
  keys.forEach((k, i) => (o[k] = floor[i]))
  return o
}

// ---------------------------------------------------------------------------
// Reference data: cities, ZIPs, streets
// ---------------------------------------------------------------------------
const CITIES = CITY_DATA.map(([city, state, zips, streets, weight]) => ({ city, state, zips, streets, weight: weight || 1 }))
const APT = new Set(APARTMENT_ZIPS)
const ZIP_INDEX = new Map()
for (const c of CITIES) for (const z of c.zips) ZIP_INDEX.set(z, c)

for (const c of CITIES) {
  for (const z of c.zips) {
    assert(ZIP3_STATE[z.slice(0, 3)] === c.state, `zip3 table mismatch for ${z} ${c.city} ${c.state} (got ${ZIP3_STATE[z.slice(0, 3)]})`)
  }
}

const STATE_WEIGHT = { CA: 16, NY: 14, TX: 11, FL: 9, IL: 6, WA: 6, MA: 5, NJ: 5, PA: 5, GA: 4, CO: 4, AZ: 3, OR: 3 }
const REGION_OF = {
  Northeast: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC'],
  Southeast: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN', 'KY', 'AR', 'LA'],
  Midwest: ['OH', 'IN', 'IL', 'MI', 'WI', 'MN', 'IA', 'MO', 'KS', 'NE', 'SD', 'ND'],
  Southwest: ['TX', 'OK', 'NM', 'AZ'],
  West: ['CA', 'NV', 'UT', 'CO', 'WY', 'ID', 'MT', 'OR', 'WA', 'AK', 'HI'],
}
function regionOf(state) {
  for (const [r, list] of Object.entries(REGION_OF)) if (list.includes(state)) return r
  return 'Northeast'
}
// Seed customers' destination cities: weighted by state then by city weight.
const DEST_CITIES = CITIES.filter((c) => !['Carlstadt', 'Secaucus', 'Carson'].includes(c.city))
function pickCity(r) {
  const weights = DEST_CITIES.map((c) => ((STATE_WEIGHT[c.state] || 0.8) * c.weight) / DEST_CITIES.filter((x) => x.state === c.state).length)
  return r.w(DEST_CITIES, weights)
}

const FIRST = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Logan', 'Amelia', 'James', 'Harper', 'Benjamin', 'Evelyn', 'Elijah', 'Abigail', 'Oliver', 'Emily', 'Jacob', 'Ella', 'Aiden', 'Madison', 'Carter', 'Scarlett', 'Jayden', 'Grace', 'Wyatt', 'Chloe', 'Owen', 'Lily', 'Caleb', 'Aria', 'Nathan', 'Zoey', 'Isaac', 'Nora', 'Hunter', 'Hannah', 'Priya', 'Arjun', 'Mei', 'Wei', 'Hiroshi', 'Yuki', 'Sofia', 'Mateo', 'Camila', 'Diego', 'Valentina', 'Santiago', 'Lucia', 'Aaliyah', 'Malik', 'Imani', 'Andre', 'Keisha', 'Jamal', 'Fatima', 'Omar', 'Layla', 'Yusuf', 'Leila', 'Daniel', 'Rachel', 'Samuel', 'Naomi', 'Ari', 'Tessa', 'Colin', 'Bridget', 'Declan', 'Siobhan', 'Anika', 'Rohan', 'Kavya', 'Minh', 'Linh', 'Jin', 'Tomas', 'Ingrid', 'Freya', 'Nikolai', 'Anya', 'Elena', 'Marco', 'Giulia', 'Pierre', 'Camille', 'Hugo', 'Ruth', 'Gideon', 'Maren', 'Theo', 'Esme', 'Rafael', 'Nadia', 'Kofi', 'Ama', 'Sienna', 'Beckett', 'Juniper', 'Silas', 'Wren', 'Ann']
const LAST = ['Anderson', 'Brooks', 'Carter', 'Diaz', 'Edwards', 'Foster', 'Garcia', 'Hughes', 'Iverson', 'Jenkins', 'Kim', 'Lopez', 'Morales', 'Nguyen', 'Ortiz', 'Patel', 'Quinn', 'Reyes', 'Sullivan', 'Underwood', 'Vasquez', 'Walsh', 'Xu', 'Young', 'Zimmerman', 'Bennett', 'Chavez', 'Dawson', 'Ellis', 'Fleming', 'Gutierrez', 'Hale', 'Ibarra', 'Jensen', 'Kowalski', 'Lindqvist', 'Mendoza', 'Novak', 'OBrien', 'Park', 'Ramirez', 'Schultz', 'Tran', 'Vogel', 'Whitaker', 'Yamamoto', 'Abbott', 'Barrett', 'Caldwell', 'Dunn', 'Espinoza', 'Greer', 'Holloway', 'Ingram', 'Jacobs', 'Keller', 'Lawson', 'Mercer', 'Nash', 'Okafor', 'Pruitt', 'Rosales', 'Sato', 'Tanaka', 'Valdez', 'Weaver', 'Adeyemi', 'Bishop', 'Coleman', 'Delgado', 'Farrell', 'Gallagher', 'Hernandez', 'Kaplan', 'Levy', 'Moreno', 'Nakamura', 'Olsen', 'Petrov', 'Rahman', 'Singh', 'Torres', 'Vance', 'Wolfe', 'Chen', 'Das', 'Haddad', 'Mensah', 'Brewer', 'Castillo', 'Donovan', 'Fairbanks', 'Hollis', 'Kerr', 'Lund', 'Marsh', 'Pena', 'Rowe', 'Sandoval', 'Tate', 'Voss', 'Yoder']
const NAME_BLOCK = new Set(['Chloe Kim', 'Nathan Chen', 'Andre Young', 'Grace Park', 'Emma Walsh', 'Ann Brewer'])
const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'proton.me', 'hotmail.com']
const AREA = { NY: ['212', '718', '917', '646'], CA: ['213', '415', '619', '310', '510', '408', '916'], TX: ['512', '713', '214', '210', '817'], FL: ['305', '407', '813', '904', '954'], IL: ['312', '773', '847'], WA: ['206', '253', '509', '425'], MA: ['617', '857', '508'], NJ: ['201', '973', '609', '551'], PA: ['215', '267', '412', '717'], GA: ['404', '470', '912', '706'], CO: ['303', '720', '719'], AZ: ['602', '480', '520', '928'], OR: ['503', '971', '541'] }
const COMPANY_NAMES = ['Blue Heron Studio', 'Maple & Thread', 'Juniper Home Goods', 'Cedar Loft Interiors', 'Northwind Florals', 'Harbor Lane Cafe', 'Oak & Olive Market', 'Riverstone Design Co.', 'Sunday Pottery Club', 'Brightside Dental', 'Kettle & Crumb Bakery', 'Fern Street Yoga', 'Little Atlas Books', 'Copperline Architects', 'Meadowbrook Gifts']

function personName(r) {
  for (;;) {
    const n = `${r.pick(FIRST)} ${r.pick(LAST)}`
    if (!NAME_BLOCK.has(n)) return n.replace('OBrien', "O'Brien")
  }
}
function emailFor(r, name) {
  const [f, l] = name.toLowerCase().replace(/[^a-z ]/g, '').split(' ')
  const style = r.int(0, 3)
  const local = style === 0 ? `${f}.${l}` : style === 1 ? `${f}${l}${r.int(1, 99)}` : style === 2 ? `${f[0]}${l}` : `${f}_${l}${r.int(80, 99)}`
  return `${local}@${r.pick(EMAIL_DOMAINS)}`
}
function phoneFor(r, state) {
  const ac = r.pick(AREA[state] || ['202', '312', '469', '615', '704', '919', '314', '317', '801', '505', '702'])
  return `+1 (${ac}) 555-${pad(r.int(100, 199), 4)}`
}
function unitStr(r) {
  const kind = r.w(['Apt', 'Unit', 'Suite', '#'], [6, 2, 1, 1])
  const n = r.int(1, 28)
  const letter = r.w(['', 'A', 'B', 'C', 'D', 'F', 'R'], [4, 2, 2, 2, 1, 1, 1])
  return kind === '#' ? `#${n}${letter}` : `${kind} ${n}${letter}`
}
function houseNumber(r) {
  return String(r.w([() => r.int(1, 99), () => r.int(100, 999), () => r.int(1000, 4999), () => r.int(5000, 12999)], [1, 4, 4, 1])())
}

/** A clean, deliverable US address. */
function goodAddress(r, city, { residential = true, name, company = '' } = {}) {
  const c = city || pickCity(r)
  const zip = r.pick(c.zips)
  const street = r.pick(c.streets)
  const apt = APT.has(zip)
  const line2 = apt ? (r.chance(0.94) ? unitStr(r) : '') : r.chance(0.07) ? unitStr(r) : ''
  return {
    name: name || personName(r),
    company: residential ? '' : company || r.pick(COMPANY_NAMES),
    line1: `${houseNumber(r)} ${street}`,
    line2,
    city: c.city,
    state: c.state,
    zip,
    country: 'US',
    residential,
  }
}

// ---- address problems ------------------------------------------------------
const KEYBOARD_NEAR = { a: 'sq', b: 'vn', c: 'xv', d: 'sf', e: 'wr', f: 'dg', g: 'fh', h: 'gj', i: 'uo', k: 'jl', l: 'k', m: 'n', n: 'bm', o: 'ip', p: 'o', r: 'et', s: 'ad', t: 'ry', u: 'yi', v: 'cb', w: 'qe', y: 'tu' }
function typoWord(r, w) {
  for (let tries = 0; tries < 20; tries++) {
    const op = r.int(0, 3)
    const i = r.int(1, w.length - 2)
    let out
    if (op === 0) out = w.slice(0, i) + w.slice(i + 1)
    else if (op === 1) out = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)
    else if (op === 2) {
      const ch = w[i].toLowerCase()
      const near = KEYBOARD_NEAR[ch]
      if (!near) continue
      out = w.slice(0, i) + near[r.int(0, near.length - 1)] + w.slice(i + 1)
    } else out = w.slice(0, i) + w[i] + w.slice(i)
    if (out !== w) return out
  }
  return w.slice(0, -1)
}
function typoStreet(r, city) {
  const candidates = city.streets.filter((s) => s.split(' ').some((p) => /^[A-Za-z]{5,}$/.test(p)))
  const street = r.pick(candidates.length ? candidates : city.streets)
  const parts = street.split(' ')
  const idx = parts.findIndex((p) => /^[A-Za-z]{5,}$/.test(p))
  const j = idx < 0 ? 0 : idx
  parts[j] = typoWord(r, parts[j])
  const typo = parts.join(' ')
  return { street, typo }
}
const UNUSED_ZIP3 = ['001', '002', '003', '004', '213', '269', '343', '345', '348', '353', '419', '428', '429', '517', '518', '519', '529', '533', '536', '552', '568', '578', '579', '589', '621', '632', '642', '643', '659', '663', '682', '694', '695', '696', '697', '698', '699', '715', '732', '742', '817', '818', '819', '839', '848', '849', '854', '858', '861', '862', '866', '867', '868', '869', '876', '886', '887', '888', '892', '896', '899', '909', '929', '987']
const NEIGHBOR_STATE = { CA: 'NV', NY: 'NJ', TX: 'OK', FL: 'GA', IL: 'IN', WA: 'OR', MA: 'CT', NJ: 'NY', PA: 'OH', GA: 'SC', CO: 'UT', AZ: 'NM', OR: 'WA', MI: 'OH', OH: 'PA', MN: 'WI', WI: 'MN', NC: 'SC', TN: 'KY', VA: 'MD', DC: 'MD', MD: 'VA', NV: 'CA', UT: 'CO', NM: 'AZ', OK: 'TX', LA: 'MS', AR: 'MO', MO: 'KS', KS: 'MO', IN: 'IL', KY: 'TN', SC: 'NC', AL: 'GA', HI: 'CA', AK: 'WA', CT: 'RI', RI: 'MA', VT: 'NH', NH: 'VT', ME: 'NH', ID: 'MT', MT: 'ID', NE: 'IA', IA: 'NE', WY: 'CO', ND: 'SD', SD: 'ND', DE: 'PA', MS: 'AL', WV: 'VA' }

/**
 * Create a problem address of the given issue type starting from a good one.
 * Returns { address, correction, carrier? }.
 */
function breakAddress(r, type, base, city) {
  const a = { ...base }
  let correction = null
  let carrier = null
  if (type === 'missing_unit') {
    // must be an apartment ZIP
    correction = { line2: a.line2 || unitStr(r) }
    a.line2 = ''
  } else if (type === 'zip_city_mismatch') {
    const others = CITIES.filter((c) => c.state === a.state && c.city !== a.city)
    const other = r.pick(others)
    correction = { zip: a.zip }
    a.zip = r.pick(other.zips)
  } else if (type === 'state_mismatch') {
    correction = { state: a.state }
    a.state = NEIGHBOR_STATE[a.state] || 'NY'
  } else if (type === 'typo_street') {
    const num = a.line1.split(' ')[0]
    const { street, typo } = typoStreet(r, city)
    correction = { line1: `${num} ${street}` }
    a.line1 = `${num} ${typo}`
  } else if (type === 'po_box_restricted') {
    const box = r.int(100, 9899)
    correction = { carrier: 'USPS', service: 'GA' }
    a.line1 = r.pick([`PO Box ${box}`, `P.O. Box ${box}`, `PO BOX ${box}`])
    a.line2 = ''
    carrier = r.pick(['UPS', 'UPS', 'FDX', 'ONT', 'LSO'])
  } else if (type === 'incomplete_street') {
    correction = { line1: a.line1 }
    const parts = a.line1.split(' ')
    const variant = r.int(0, 2)
    if (variant === 0) a.line1 = parts.slice(1).join(' ')
    else if (variant === 1) a.line1 = parts[0]
    else a.line1 = parts.slice(1, -1).join(' ') || parts[1]
  } else if (type === 'invalid_zip') {
    correction = { zip: a.zip }
    const v = r.int(0, 3)
    if (v === 0) a.zip = a.zip.slice(0, 4)
    else if (v === 1) a.zip = a.zip + r.int(0, 9)
    else if (v === 2) a.zip = r.pick(UNUSED_ZIP3) + digits(r, 2)
    else a.zip = '00000'
  }
  return { address: a, correction, carrier }
}

// ---------------------------------------------------------------------------
// Products, HS codes
// ---------------------------------------------------------------------------
const HS_CODES = [
  { code: '6912.00', desc: L('Seramik sofra ve mutfak eşyası', 'Ceramic tableware and kitchenware'), customsDesc: 'Ceramic tableware, stoneware' },
  { code: '5702.42', desc: L('Dokuma halı ve kilim (sentetik/yün, havsız)', 'Woven carpets and kilims, flat woven'), customsDesc: 'Woven rug, flat woven, not tufted' },
  { code: '7418.10', desc: L('Bakır mutfak ve sofra eşyası', 'Copper kitchen and table articles'), customsDesc: 'Copper kitchenware, household' },
  { code: '0901.21', desc: L('Kavrulmuş kahve (kafeinli)', 'Roasted coffee, not decaffeinated'), customsDesc: 'Roasted coffee, ground' },
  { code: '3401.11', desc: L('Tuvalet sabunu (kalıp)', 'Toilet soap in bars'), customsDesc: 'Soap bars for toilet use' },
  { code: '6302.60', desc: L('Pamuklu havlu (havlu kumaştan)', 'Cotton toilet and kitchen towels (terry)'), customsDesc: 'Cotton towels, terry fabric' },
  { code: '7113.11', desc: L('Gümüş mücevherat', 'Jewellery of silver'), customsDesc: 'Sterling silver jewelry' },
  { code: '4202.31', desc: L('Deri cüzdan ve cep eşyası', 'Leather wallets and pocket articles'), customsDesc: 'Leather wallet, pocket article' },
  { code: '6304.92', desc: L('Pamuklu dekoratif ürün (yastık kılıfı)', 'Cotton furnishing articles (cushion covers)'), customsDesc: 'Cushion cover, cotton, not knitted' },
  { code: '4420.10', desc: L('Ahşap biblo ve süs eşyası', 'Wooden statuettes and ornaments'), customsDesc: 'Wooden statuette, decorative' },
  { code: '7013.37', desc: L('Cam bardak ve içecek kapları', 'Glass drinking glasses'), customsDesc: 'Drinking glasses, glass' },
  { code: '3406.00', desc: L('Mum ve benzeri ürünler', 'Candles, tapers and similar'), customsDesc: 'Candles, wax' },
  { code: '6117.10', desc: L('Şal, eşarp ve atkı (örme)', 'Shawls, scarves and mufflers, knitted'), customsDesc: 'Knitted shawl or scarf' },
  { code: '9503.00', desc: L('Oyuncaklar', 'Toys'), customsDesc: 'Toy, for children' },
  { code: '4911.91', desc: L('Baskı, resim ve fotoğraflar', 'Printed pictures and photographs'), customsDesc: 'Printed picture, art print' },
  { code: '6109.10', desc: L('Pamuklu tişört (örme)', 'Cotton T-shirts, knitted'), customsDesc: 'T-shirt, cotton, knitted' },
  { code: '1509.20', desc: L('Sızma zeytinyağı', 'Extra virgin olive oil'), customsDesc: 'Extra virgin olive oil' },
  { code: '1704.90', desc: L('Şekerli mamuller (lokum, şekerleme)', 'Sugar confectionery (Turkish delight)'), customsDesc: 'Sugar confectionery, no cocoa' },
  { code: '3304.99', desc: L('Cilt bakım ve güzellik ürünleri', 'Skin care and beauty preparations'), customsDesc: 'Skin care preparation' },
  { code: '8306.29', desc: L('Metal süs eşyası', 'Ornaments of base metal'), customsDesc: 'Decorative ornament, base metal' },
  { code: '9405.21', desc: L('Elektrikli masa lambası (LED)', 'Electric table lamps (LED)'), customsDesc: 'Table lamp, electric, LED' },
  { code: '6702.90', desc: L('Yapay çiçek ve yapraklar', 'Artificial flowers and foliage'), customsDesc: 'Artificial flowers, textile or plastic' },
  { code: '7117.19', desc: L('Bijuteri (adi metal)', 'Imitation jewellery of base metal'), customsDesc: 'Imitation jewelry, base metal' },
  { code: '4819.20', desc: L('Karton kutu ve ambalaj', 'Folding cartons and boxes of paperboard'), customsDesc: 'Folding paperboard boxes' },
]

// [sku, en, tr, weightLb, [L,W,H], valueUsd, hsCode|null, origin, tags]
const PRODUCT_DEFS = [
  ['CER-MUG-12', 'Handmade Ceramic Mug 12oz', 'El yapımı seramik kupa 12oz', 0.9, [6, 6, 6], 28, '6912.00', 'TR', ['ceramic', 'bestseller']],
  ['CER-BWL-08', 'Stoneware Serving Bowl 8in', 'Taş hamur servis kasesi 8in', 1.6, [9, 9, 5], 42, '6912.00', 'TR', ['ceramic']],
  ['CER-PLT-IZN', 'Iznik Pattern Ceramic Plate 10in', 'İznik desenli çini tabak 10in', 1.4, [11, 11, 3], 56, '6912.00', 'TR', ['ceramic', 'fragile']],
  ['RUG-KLM-35', 'Handwoven Kilim Rug 3x5 ft', 'El dokuma kilim halı 3x5 ft', 4.8, [16, 10, 6], 189, '5702.42', 'TR', ['rug', 'bestseller']],
  ['RUG-RUN-26', 'Wool Runner Rug 2x6 ft', 'Yün koridor halısı 2x6 ft', 3.9, [14, 10, 6], 149, '5702.42', 'TR', ['rug']],
  ['RUG-FLT-46', 'Flatweave Anatolian Rug 4x6 ft', 'Anadolu düz dokuma halı 4x6 ft', 6.4, [18, 12, 7], 245, '5702.42', 'TR', ['rug', 'high-value']],
  ['COP-CZV-S', 'Copper Turkish Coffee Pot (Cezve)', 'Bakır cezve', 0.8, [8, 5, 5], 34, '7418.10', 'TR', ['copper', 'bestseller']],
  ['COP-TRY-14', 'Hammered Copper Serving Tray 14in', 'Dövme bakır servis tepsisi 14in', 2.1, [15, 15, 2], 68, '7418.10', 'TR', ['copper']],
  ['COP-MUG-MM', 'Copper Moscow Mule Mug', 'Bakır Moscow Mule kupası', 0.7, [6, 5, 5], 26, '7418.10', 'TR', ['copper']],
  ['COF-TRK-250', 'Turkish Coffee Finely Ground 250g', 'Türk kahvesi 250g', 0.6, [6, 4, 3], 14, '0901.21', 'TR', ['coffee', 'food']],
  ['COF-SET-GFT', 'Turkish Coffee Gift Set (2 cups + cezve)', 'Türk kahvesi seti (2 fincan + cezve)', 2.2, [12, 10, 6], 64, null, 'TR', ['coffee', 'gift']],
  ['SOP-OLV-3', 'Olive Oil Soap Bar Set of 3', 'Zeytinyağlı sabun seti (3 adet)', 0.9, [7, 4, 3], 18, '3401.11', 'TR', ['soap', 'bestseller']],
  ['SOP-LRL-1', 'Laurel Soap Traditional Bar', 'Defne sabunu', 0.4, [4, 3, 2], 9, '3401.11', 'TR', ['soap']],
  ['SOP-GML-2', 'Goat Milk Soap Duo', 'Keçi sütlü sabun ikili set', 0.6, [6, 4, 2], 15, '3401.11', 'TR', ['soap']],
  ['TWL-PSH-01', 'Turkish Cotton Peshtemal Towel', 'Pamuklu peştemal havlu', 1.1, [10, 8, 3], 32, '6302.60', 'TR', ['towel', 'bestseller']],
  ['TWL-LIN-2', 'Linen Hand Towel Set of 2', 'Keten el havlusu seti (2 adet)', 0.8, [9, 7, 2], 29, '6302.60', 'TR', ['towel']],
  ['TWL-WFL-BT', 'Waffle Weave Bath Towel', 'Waffle dokuma banyo havlusu', 1.5, [12, 10, 4], 38, '6302.60', 'TR', ['towel']],
  ['SLV-NKL-EYE', 'Sterling Silver Evil Eye Necklace', 'Gümüş nazar boncuklu kolye', 0.2, [5, 4, 1], 58, '7113.11', 'TR', ['jewelry', 'bestseller']],
  ['SLV-EAR-FLG', 'Silver Filigree Earrings', 'Gümüş telkari küpe', 0.1, [4, 3, 1], 46, '7113.11', 'TR', ['jewelry']],
  ['SLV-RNG-925', '925 Silver Signet Ring', '925 ayar gümüş yüzük', 0.1, [3, 3, 2], 72, '7113.11', 'TR', ['jewelry']],
  ['LTH-WLT-BF', 'Leather Bifold Wallet', 'Deri cüzdan (katlanır)', 0.3, [6, 4, 1], 48, '4202.31', 'TR', ['leather', 'bestseller']],
  ['LTH-CRD-SL', 'Slim Leather Card Holder', 'İnce deri kartlık', 0.2, [5, 4, 1], 29, '4202.31', 'TR', ['leather']],
  ['LTH-PSP-01', 'Leather Passport Wallet', 'Deri pasaport kılıfı', 0.3, [7, 5, 1], 39, null, 'TR', ['leather']],
  ['PIL-KLM-16', 'Kilim Pillow Cover 16x16', 'Kilim yastık kılıfı 16x16', 0.5, [9, 7, 2], 36, '6304.92', 'TR', ['textile', 'bestseller']],
  ['PIL-EMB-18', 'Embroidered Cushion Cover 18x18', 'Nakışlı kırlent kılıfı 18x18', 0.5, [10, 8, 2], 34, '6304.92', 'TR', ['textile']],
  ['PIL-SUZ-20', 'Suzani Pillow Case 20x20', 'Suzani yastık kılıfı 20x20', 0.6, [11, 9, 2], 42, '6304.92', 'TR', ['textile']],
  ['WOD-BRD-01', 'Hand Carved Wooden Bird Figurine', 'El oyması ahşap kuş biblo', 0.4, [6, 4, 4], 24, '4420.10', 'TR', ['wood']],
  ['WOD-ORN-OL', 'Olive Wood Ornament Set of 4', 'Zeytin ağacı süs seti (4 adet)', 0.5, [8, 6, 2], 27, null, 'TR', ['wood', 'gift']],
  ['GLS-TEA-6', 'Turkish Tea Glass Set of 6', 'Türk çay bardağı seti (6 adet)', 2.4, [12, 8, 5], 44, '7013.37', 'TR', ['glass', 'fragile']],
  ['GLS-BLW-4', 'Hand Blown Drinking Glasses Set of 4', 'El üfleme su bardağı seti (4 adet)', 2.0, [10, 10, 5], 52, '7013.37', 'TR', ['glass', 'fragile']],
  ['CND-SOY-8', 'Soy Wax Scented Candle 8oz', 'Soya mumu kokulu mum 8oz', 1.0, [5, 5, 5], 24, '3406.00', 'TR', ['candle']],
  ['CND-BEE-TP', 'Beeswax Taper Candles Pair', 'Balmumu uzun mum (çift)', 0.5, [12, 3, 2], 18, '3406.00', 'TR', ['candle']],
  ['SHL-SLK-01', 'Silk Blend Shawl', 'İpek karışımlı şal', 0.4, [9, 7, 2], 54, '6117.10', 'TR', ['textile']],
  ['SHL-PSH-02', 'Soft Pashmina Scarf', 'Yumuşak paşmina atkı', 0.5, [9, 7, 2], 38, '6117.10', 'TR', ['textile']],
  ['TOY-STK-WD', 'Wooden Stacking Toy', 'Ahşap istif oyuncağı', 1.2, [8, 6, 6], 32, '9503.00', 'TR', ['toy']],
  ['TOY-AMG-BN', 'Crochet Amigurumi Bunny', 'Tığ işi amigurumi tavşan', 0.3, [8, 5, 4], 28, null, 'TR', ['toy', 'handmade']],
  ['PRT-IST-A3', 'Istanbul Skyline Art Print A3', 'İstanbul silüeti sanat baskısı A3', 0.4, [18, 3, 3], 26, '4911.91', 'TR', ['print']],
  ['PRT-BOT-11', 'Botanical Poster 11x14', 'Botanik poster 11x14', 0.3, [16, 3, 3], 22, '4911.91', 'TR', ['print']],
  ['TSH-ORG-M', 'Organic Cotton T-Shirt', 'Organik pamuk tişört', 0.4, [10, 8, 1], 29, '6109.10', 'TR', ['apparel']],
  ['TSH-GRP-L', 'Evil Eye Graphic Tee Unisex', 'Nazar baskılı unisex tişört', 0.4, [10, 8, 1], 27, '6109.10', 'TR', ['apparel']],
  ['OIL-EVO-500', 'Extra Virgin Olive Oil 500ml', 'Sızma zeytinyağı 500ml', 2.3, [10, 4, 4], 24, '1509.20', 'TR', ['food', 'liquid']],
  ['OIL-EHV-1L', 'Early Harvest Olive Oil 1L Tin', 'Erken hasat zeytinyağı 1L teneke', 2.9, [9, 5, 4], 38, '1509.20', 'TR', ['food', 'liquid']],
  ['SWT-LKM-500', 'Turkish Delight Assorted Box 500g', 'Karışık lokum kutusu 500g', 1.4, [9, 7, 3], 22, '1704.90', 'TR', ['food', 'bestseller']],
  ['SWT-PST-LK', 'Pistachio Turkish Delight 1 lb', 'Fıstıklı lokum 1 lb', 1.2, [8, 6, 3], 26, null, 'TR', ['food']],
  ['SKN-RSE-50', 'Rose Face Cream 50ml', 'Gül yüz kremi 50ml', 0.4, [4, 4, 3], 32, '3304.99', 'TR', ['beauty']],
  ['SKN-ARG-30', 'Argan Oil Face Serum 30ml', 'Argan yağı serum 30ml', 0.3, [4, 3, 3], 28, '3304.99', 'TR', ['beauty']],
  ['MTL-HMS-BR', 'Brass Hamsa Wall Hanging', 'Pirinç hamsa duvar süsü', 0.9, [10, 7, 2], 36, '8306.29', 'TR', ['decor']],
  ['MTL-EYE-OR', 'Metal Evil Eye Ornament', 'Metal nazarlık süs', 0.3, [6, 4, 1], 16, '8306.29', 'TR', ['decor']],
  ['LMP-MSC-TB', 'Mosaic Glass Table Lamp', 'Mozaik cam masa lambası', 4.2, [12, 12, 14], 98, '9405.21', 'TR', ['lamp', 'fragile']],
  ['LMP-OTT-SM', 'Ottoman Mosaic Night Light', 'Osmanlı mozaik gece lambası', 2.6, [10, 10, 10], 64, null, 'TR', ['lamp', 'fragile']],
  ['FLW-EUC-3', 'Artificial Eucalyptus Stems Set of 3', 'Yapay okaliptüs dalı (3 adet)', 0.6, [24, 6, 3], 21, '6702.90', 'TR', ['decor']],
  ['FLW-OLV-BR', 'Faux Olive Branch 30in', 'Yapay zeytin dalı 30in', 0.7, [30, 6, 3], 26, '6702.90', 'TR', ['decor']],
  ['BJT-BRC-BD', 'Beaded Evil Eye Bracelet', 'Nazar boncuklu bileklik', 0.1, [4, 3, 1], 14, '7117.19', 'TR', ['jewelry']],
  ['BJT-HOP-GP', 'Gold Plated Hoop Earrings', 'Altın kaplama halka küpe', 0.1, [4, 3, 1], 22, '7117.19', 'TR', ['jewelry']],
  ['BJT-NKL-LY', 'Layered Coin Necklace', 'Katmanlı madalyon kolye', 0.2, [5, 4, 1], 26, null, 'TR', ['jewelry']],
  ['BOX-KRF-10', 'Kraft Gift Boxes 10 pcs', 'Kraft hediye kutusu (10 adet)', 1.8, [12, 9, 4], 19, '4819.20', 'TR', ['packaging']],
  ['BOX-RGD-SET', 'Rigid Gift Box Set of 3', 'Sert karton hediye kutusu seti (3 adet)', 1.4, [11, 9, 5], 24, '4819.20', 'TR', ['packaging']],
  ['CER-ESP-2', 'Espresso Cup Pair with Saucers', 'Espresso fincan seti (2 adet)', 1.1, [8, 6, 4], 36, null, 'TR', ['ceramic', 'gift']],
  ['COP-PAN-SM', 'Tin Lined Copper Saucepan Small', 'Kalaylı bakır sos tenceresi', 2.5, [12, 7, 5], 79, '7418.10', 'TR', ['copper']],
  ['RUG-MAT-23', 'Kilim Door Mat 2x3 ft', 'Kilim kapı paspası 2x3 ft', 2.1, [12, 9, 5], 69, '5702.42', 'TR', ['rug']],
]

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
const files = {}
function out(name, data) {
  files[name] = data
}

// ===========================================================================
// 1. Static / reference seeds
// ===========================================================================
const CUSTOMER_ID = 'CUS-001'
// The demo customer is a Turkish company (HQ in Istanbul) selling to US buyers. It has no US
// entity: US sender addresses are "c/o" the KargoPazar hubs where its stock is kept.
const COMPANY = 'Anatolia Home & Craft'
const LEGAL_NAME = 'Anadolu Ev ve El Sanatları Tic. Ltd. Şti.'
const COMPANY_PHONE = '+90 212 555 01 48'
const HQ_ADDRESS = {
  name: COMPANY, company: LEGAL_NAME,
  line1: 'Emniyet Evleri Mah. Eski Büyükdere Cad. No: 14 Kat: 3', line2: '',
  district: 'Kâğıthane', city: 'İstanbul', state: 'İstanbul', zip: '34415', country: 'TR', phone: COMPANY_PHONE,
}
const HUBS = {
  NJ01: { line1: '600 Meadowlands Pkwy', line2: 'Dock 4', city: 'Secaucus', state: 'NJ', zip: '07094' },
  LA01: { line1: '1100 E Dominguez St', line2: 'Bldg B', city: 'Carson', state: 'CA', zip: '90746' },
}
const CO_NAME = (hub) => `${COMPANY} c/o KargoPazar ${hub}`
const SENDER_US = Object.fromEntries(['NJ01', 'LA01'].map((h) => [h, { name: CO_NAME(h), ...HUBS[h], country: 'US' }]))

// UK pilot customer (owns every GB origin first mile shipment)
const UK_CUSTOMER_ID = 'CUS-010'
const UK_CUSTOMER = 'Cotswold Candle Co.'

out('user', {
  id: 'USR-001',
  username: 'demo',
  password: 'Demo123!',
  name: 'Demo Kullanıcı',
  email: 'demo@kargopazar.com',
  phone: '+90 532 555 01 48',
  role: 'owner',
  isPlatformAdmin: false,
  customerId: CUSTOMER_ID,
  timezone: 'Europe/Istanbul',
  createdAt: rel(212, 10, 12),
  lastLoginAt: rel(1, 17, 42),
  twoFactorEnabled: false,
  company: {
    name: COMPANY,
    legalName: LEGAL_NAME,
    taxId: '0680527391',
    taxOffice: 'Kağıthane Vergi Dairesi',
    country: 'TR',
    phone: COMPANY_PHONE,
    plan: 'enterprise',
    planSince: rel(210, 9, 0),
    defaultHub: 'NJ01',
    hqAddress: HQ_ADDRESS,
    senderAddress: SENDER_US.NJ01,
    senderAddresses: SENDER_US,
  },
  preferences: { lang: 'tr', units: 'metric', currency: 'TRY', optimizerWeight: 0.6, dateFormat: 'locale' },
  onboardingAnswers: null,
  sessions: [
    { id: 'SES-01', device: 'Chrome · Windows', location: 'İstanbul, TR', ip: '203.0.113.24', lastActiveAt: rel(0, 8, 55), current: true },
    { id: 'SES-02', device: 'Safari · iPhone', location: 'İstanbul, TR', ip: '198.51.100.71', lastActiveAt: rel(2, 21, 10), current: false },
    { id: 'SES-03', device: 'Firefox · macOS', location: 'İzmir, TR', ip: '192.0.2.145', lastActiveAt: rel(9, 11, 3), current: false },
  ],
})

const ROLE_PERMS = {
  owner: ['orders.manage', 'shipments.create', 'shipments.void', 'batch.run', 'ops.manage', 'billing.view', 'billing.topup', 'integrations.manage', 'api.manage', 'settings.manage', 'team.manage', 'rules.manage', 'ai.manage', 'admin.platform', 'reports.view'],
  admin: ['orders.manage', 'shipments.create', 'shipments.void', 'batch.run', 'ops.manage', 'billing.view', 'billing.topup', 'integrations.manage', 'api.manage', 'settings.manage', 'team.manage', 'rules.manage', 'ai.manage', 'reports.view'],
  operations: ['orders.manage', 'shipments.create', 'shipments.void', 'batch.run', 'ops.manage', 'reports.view'],
  finance: ['billing.view', 'billing.topup', 'reports.view'],
  readonly: ['reports.view'],
}
out('roles', {
  permissions: [
    { id: 'orders.manage', label: L('Siparişleri yönet', 'Manage orders') },
    { id: 'shipments.create', label: L('Gönderi ve etiket oluştur', 'Create shipments and labels') },
    { id: 'shipments.void', label: L('Etiket iptal et', 'Void labels') },
    { id: 'batch.run', label: L('Toplu işlem çalıştır', 'Run batch jobs') },
    { id: 'ops.manage', label: L('Operasyon merkezi işlemleri', 'Operations hub actions') },
    { id: 'billing.view', label: L('Cüzdan ve faturaları görüntüle', 'View wallet and invoices') },
    { id: 'billing.topup', label: L('Bakiye yükle', 'Top up balance') },
    { id: 'integrations.manage', label: L('Entegrasyonları yönet', 'Manage integrations') },
    { id: 'api.manage', label: L("API anahtarları ve webhook'lar", 'API keys and webhooks') },
    { id: 'settings.manage', label: L('Ayarları değiştir', 'Change settings') },
    { id: 'team.manage', label: L('Ekibi yönet', 'Manage team') },
    { id: 'rules.manage', label: L('Gönderi kurallarını yönet', 'Manage shipping rules') },
    { id: 'ai.manage', label: L('AI modellerini yönet', 'Manage AI models') },
    { id: 'reports.view', label: L('Raporları görüntüle', 'View reports') },
    { id: 'admin.platform', label: L('Platform yönetimi', 'Platform administration') },
  ],
  roles: [
    { id: 'owner', name: L('Sahip', 'Owner'), permissions: ROLE_PERMS.owner },
    { id: 'admin', name: L('Yönetici', 'Admin'), permissions: ROLE_PERMS.admin },
    { id: 'operations', name: L('Operasyon', 'Operations'), permissions: ROLE_PERMS.operations },
    { id: 'finance', name: L('Finans', 'Finance'), permissions: ROLE_PERMS.finance },
    { id: 'readonly', name: L('Salt okunur', 'Read only'), permissions: ROLE_PERMS.readonly },
  ],
})

out('team', [
  { id: 'USR-001', name: 'Demo Kullanıcı', email: 'demo@kargopazar.com', role: 'owner', status: 'active', initials: 'DK', joinedAt: rel(212, 10, 12), lastActiveAt: rel(0, 8, 55) },
  { id: 'USR-002', name: 'Elif Aydın', email: 'elif.aydin@anatoliahome.com', role: 'admin', status: 'active', initials: 'EA', joinedAt: rel(205, 14, 30), lastActiveAt: rel(0, 8, 21) },
  { id: 'USR-003', name: 'Burak Şahin', email: 'burak.sahin@anatoliahome.com', role: 'operations', status: 'active', initials: 'BŞ', joinedAt: rel(190, 9, 45), lastActiveAt: rel(1, 16, 48) },
  { id: 'USR-004', name: 'Selin Koç', email: 'selin.koc@anatoliahome.com', role: 'finance', status: 'active', initials: 'SK', joinedAt: rel(160, 11, 5), lastActiveAt: rel(2, 10, 14) },
  { id: 'USR-005', name: 'Deniz Yılmaz', email: 'deniz.yilmaz@anatoliahome.com', role: 'readonly', status: 'active', initials: 'DY', joinedAt: rel(74, 15, 20), lastActiveAt: rel(6, 13, 37) },
])

out('hubs', [
  {
    code: 'NJ01', type: 'us_hub', country: 'US', name: L('New Jersey Operasyon Merkezi', 'New Jersey Operations Hub'),
    address: { ...HUBS.NJ01, country: 'US' }, timezone: 'America/New_York', cutoff: '16:00', capacityDaily: 400, todayLoad: 238,
    carrierPickups: [{ carrier: 'UPS', time: '17:30' }, { carrier: 'FDX', time: '17:45' }, { carrier: 'USPS', time: '18:00' }, { carrier: 'DHLE', time: '16:45' }],
    active: true, openedAt: rel(560),
  },
  {
    code: 'LA01', type: 'us_hub', country: 'US', name: L('Los Angeles Operasyon Merkezi', 'Los Angeles Operations Hub'),
    address: { ...HUBS.LA01, country: 'US' }, timezone: 'America/Los_Angeles', cutoff: '16:00', capacityDaily: 250, todayLoad: 131,
    carrierPickups: [{ carrier: 'UPS', time: '17:00' }, { carrier: 'FDX', time: '17:15' }, { carrier: 'USPS', time: '17:30' }, { carrier: 'ONT', time: '18:00' }, { carrier: 'LSO', time: '16:30' }, { carrier: 'DHLE', time: '16:15' }],
    active: true, openedAt: rel(380),
  },
  {
    code: 'LHR-CP', type: 'origin_point', country: 'GB', name: L('London Konsolidasyon Noktası (LHR)', 'London Consolidation Point (LHR)'),
    address: { line1: 'Unit 7, Heathrow Logistics Park', line2: 'Bath Road', city: 'Hounslow', state: 'Greater London', zip: 'TW6 2AA', country: 'GB' },
    timezone: 'Europe/London', cutoff: '14:00', airports: ['LHR'], flights: ['BA 177 LHR-JFK', 'BA 283 LHR-LAX'], active: true, openedAt: rel(330),
  },
  {
    code: 'EVRI-NET', type: 'origin_network', country: 'GB', name: L('Evri toplama ağı', 'Evri collection network'),
    address: null, timezone: 'Europe/London', cutoff: '12:00', partnerCarrier: 'EVRI', active: true, openedAt: rel(330),
  },
  {
    code: 'IST-CP', type: 'origin_point', country: 'TR', name: L('İstanbul Konsolidasyon Noktası (IST)', 'Istanbul Consolidation Point (IST)'),
    address: { line1: 'Tayakadın Mah. Terminal Cad. No:12', line2: 'İGA Kargo Şehri B Blok', city: 'Arnavutköy', state: 'İstanbul', zip: '34283', country: 'TR' },
    timezone: 'Europe/Istanbul', cutoff: '15:00', airports: ['IST'], flights: ['TK 001 IST-JFK', 'TK 009 IST-LAX'], active: true, openedAt: rel(300),
  },
  {
    code: 'FRA-CP', type: 'origin_point', country: 'DE', name: L('Frankfurt Konsolidasyon Noktası (FRA)', 'Frankfurt Consolidation Point (FRA)'),
    address: { line1: 'Cargo City Süd, Gebäude 579', line2: '', city: 'Frankfurt am Main', state: 'Hessen', zip: '60549', country: 'DE' },
    timezone: 'Europe/Berlin', cutoff: '14:00', airports: ['FRA'], flights: ['LH 400 FRA-JFK'], active: true, openedAt: rel(21), isNewMarket: true,
  },
])

const CONNECTED = { FDX: 540, UPS: 560, USPS: 575, DHLE: 470, ONT: 300, LSO: 250, DHLX: 200, EVRI: 180 }
out('carriers', CARRIERS.map((c) => ({ ...c, connectedSince: rel(CONNECTED[c.code], 10, 0) })))

const LAUNCHED = { US: 560, GB: 330, TR: 300, DE: 21 }
out('countries', COUNTRIES.map((c) => ({ ...c, launchedAt: rel(LAUNCHED[c.code], 9, 0) })))

out('box_presets', [
  { id: 'BOX-S', name: L('Küçük kutu', 'Small box'), type: 'box', lengthIn: 8, widthIn: 6, heightIn: 4, tareLb: 0.3, isDefault: false },
  { id: 'BOX-M', name: L('Orta kutu', 'Medium box'), type: 'box', lengthIn: 12, widthIn: 10, heightIn: 6, tareLb: 0.6, isDefault: true },
  { id: 'BOX-L', name: L('Büyük kutu', 'Large box'), type: 'box', lengthIn: 18, widthIn: 14, heightIn: 8, tareLb: 1.1, isDefault: false },
  { id: 'POLY', name: L('Poşet (poly mailer)', 'Poly mailer'), type: 'poly', lengthIn: 14, widthIn: 11, heightIn: 2, tareLb: 0.1, isDefault: false },
])
const BOX = { S: [8, 6, 4, 0.3], M: [12, 10, 6, 0.6], L: [18, 14, 8, 1.1], POLY: [14, 11, 2, 0.1] }

out('hs_codes', HS_CODES)

// Duty / tax table per (HS code, destination). Plausible demo values (MFN style base rates), to be
// verified by the project owner. Rates are fractions. originSurcharges: additional duty by origin
// (US: extra tariff on TR origin goods). Sales tax is not collected at the US border (salesTaxRate 0).
{
  // [hs, US, GB, DE, TR]
  const BASE = [
    ['6912.00', 0.098, 0.06, 0.09, 0.08], ['5702.42', 0.027, 0.08, 0.08, 0.08], ['7418.10', 0.03, 0.02, 0.03, 0.03],
    ['0901.21', 0, 0.06, 0.075, 0.2], ['3401.11', 0, 0, 0, 0.06], ['6302.60', 0.091, 0.12, 0.12, 0.12],
    ['7113.11', 0.05, 0.02, 0.025, 0.025], ['4202.31', 0.08, 0.02, 0.03, 0.03], ['6304.92', 0.063, 0.12, 0.12, 0.12],
    ['4420.10', 0.032, 0, 0, 0], ['7013.37', 0.072, 0.1, 0.11, 0.11], ['3406.00', 0, 0, 0, 0],
    ['6117.10', 0.096, 0.12, 0.12, 0.12], ['9503.00', 0, 0, 0, 0.047], ['4911.91', 0, 0, 0, 0],
    ['6109.10', 0.165, 0.12, 0.12, 0.12], ['1509.20', 0.002, 0.15, 0.2, 0.5], ['1704.90', 0.056, 0.08, 0.09, 0.3],
    ['3304.99', 0, 0, 0, 0], ['8306.29', 0, 0, 0, 0.027], ['9405.21', 0.039, 0.02, 0.027, 0.04],
    ['6702.90', 0.17, 0.04, 0.047, 0.047], ['7117.19', 0.11, 0.02, 0.04, 0.04], ['4819.20', 0, 0, 0, 0],
  ]
  assert(BASE.length === HS_CODES.length && BASE.every(([hs]) => HS_CODES.some((h) => h.code === hs)), 'duty table covers every HS code')
  const DEST = {
    US: { currency: 'USD', salesTaxRate: 0, originSurcharges: { TR: 0.15 }, fees: { fixed: 0, pct: 0.003464, min: 2.69, max: 651.5, label: L('Gümrük işlem ücreti (MPF)', 'Merchandise Processing Fee (MPF)') }, note: L('ABD satış vergisi sınırda tahsil edilmez; eyalet satış vergisi pazaryeri tarafından alınır.', 'US sales tax is not collected at the border; state sales tax is collected by the marketplace.') },
    GB: { currency: 'GBP', salesTaxRate: 0.2, originSurcharges: {}, fees: { fixed: 11, pct: 0, min: 11, max: 11, label: L('Taşıyıcı gümrük işlem ücreti', 'Carrier customs handling fee') }, note: null },
    DE: { currency: 'EUR', salesTaxRate: 0.19, originSurcharges: {}, fees: { fixed: 6, pct: 0, min: 6, max: 6, label: L('Gümrük beyan ücreti', 'Customs clearance fee') }, note: null },
    TR: { currency: 'TRY', salesTaxRate: 0.2, originSurcharges: {}, fees: { fixed: 300, pct: 0, min: 300, max: 300, label: L('Gümrük işlem ve antrepo ücreti', 'Customs processing and bonded warehouse fee') }, note: null },
  }
  const rows = []
  for (const [hs, ...rates] of BASE) {
    ;['US', 'GB', 'DE', 'TR'].forEach((dest, k) => {
      const d = DEST[dest]
      rows.push({ id: `${hs}-${dest}`, hsCode: hs, dest, baseRate: rates[k], originSurcharges: { ...d.originSurcharges }, salesTaxRate: d.salesTaxRate, fees: { ...d.fees }, currency: d.currency, note: d.note, updatedAt: rel(5, 9, 0) })
    })
  }
  out('hs_duty_rates', rows)
}

// Exchange rates (units of currency per 1 USD), a fixed demo snapshot, no live FX service.
out('fx', { base: 'USD', date: '2026-10-01', rates: { USD: 1, TRY: 41.6, EUR: 0.85, GBP: 0.74 }, source: 'demo' })
out('zip3_state', ZIP3_STATE)
out(
  'zip_city',
  CITIES.flatMap((c) => c.zips.map((zip, i) => ({ zip, city: c.city, state: c.state, primary: i === 0 }))).sort((a, b) => a.zip.localeCompare(b.zip)),
)
{
  const known = {}
  for (const c of CITIES) known[`${c.city}|${c.state}`] = c.streets
  out('streets', { apartmentZips: APARTMENT_ZIPS.slice().sort(), suffixes: STREET_SUFFIXES, knownStreets: known })
}

// Products without a confirmed code carry the HS model's suggestion (hsStatus 'ai_pending' is the
// app's "suggested, waiting for approval" state; see api/ai.js approveHsSuggestions).
const HS_SUGGESTED = {
  'COF-SET-GFT': [['6912.00', 0.71], ['0901.21', 0.18], ['7418.10', 0.06]],
  'LTH-PSP-01': [['4202.31', 0.88], ['4911.91', 0.05], ['6117.10', 0.03]],
  'WOD-ORN-OL': [['4420.10', 0.83], ['8306.29', 0.09], ['1509.20', 0.04]],
  'TOY-AMG-BN': [['9503.00', 0.79], ['6304.92', 0.1], ['6117.10', 0.05]],
  'SWT-PST-LK': [['1704.90', 0.91], ['0901.21', 0.04], ['1509.20', 0.02]],
  'LMP-OTT-SM': [['9405.21', 0.86], ['7013.37', 0.08], ['8306.29', 0.03]],
  'BJT-NKL-LY': [['7117.19', 0.64], ['7113.11', 0.29], ['8306.29', 0.04]],
  'CER-ESP-2': [['6912.00', 0.9], ['7013.37', 0.05], ['7418.10', 0.02]],
}
const HS_BY_CODE = Object.fromEntries(HS_CODES.map((h) => [h.code, h]))
const PRODUCTS = PRODUCT_DEFS.map(([sku, en, tr, weightLb, dims, value, hsCode, origin, tags], i) => {
  const sug = HS_SUGGESTED[sku]
  return {
    sku,
    title: L(tr, en),
    weightLb,
    dims: { lengthIn: dims[0], widthIn: dims[1], heightIn: dims[2] },
    value,
    currency: 'USD',
    hsCode: hsCode || sug[0][0],
    hsStatus: hsCode ? 'confirmed' : 'ai_pending',
    hsSuggestion: hsCode ? null : {
      code: sug[0][0], prob: sug[0][1], lowConfidence: sug[0][1] < 0.55,
      top: sug.map(([code, prob]) => ({ code, prob, desc: HS_BY_CODE[code].desc, customsDesc: HS_BY_CODE[code].customsDesc })),
      topWords: [], at: rel(2, 10, 15), modelVersion: 'hs-nb v1.2',
    },
    origin,
    tags,
    inventoryHubs: i % 5 === 0 || tags.includes('bestseller') ? ['NJ01', 'LA01'] : ['NJ01'],
    createdAt: rel(200 - i * 2, 11, (i * 7) % 60),
  }
})
assert(PRODUCTS.length === 60, 'products must be 60')
assert(PRODUCTS.every((p) => p.hsCode && p.origin === 'TR'), 'every product has an HS code and TR origin')
assert(PRODUCTS.filter((p) => p.hsStatus === 'ai_pending').length === 8, 'eight products with a suggested HS code')
out('products', PRODUCTS)
const PROD = Object.fromEntries(PRODUCTS.map((p) => [p.sku, p]))

// ===========================================================================
// 2. Rate context (rate cards, own carrier accounts)
// ===========================================================================
const RATE_CARDS = {
  platform: { ...PLATFORM_RATES },
  plans: PLANS,
  customerCards: [
    {
      id: 'RC-C-001',
      customerId: CUSTOMER_ID,
      name: 'Anatolia Home özel anlaşması',
      lines: [
        { carrier: 'UPS', service: 'GROUND', markupPct: 0.09 },
        { carrier: 'USPS', service: 'GA', markupPct: 0.1 },
      ],
      validFrom: rel(95, 0, 0),
      validUntil: rel(-270, 23, 59),
      status: 'approved',
      approvedBy: 'Elif Aydın',
      createdAt: rel(97, 15, 40),
      note: L('Yıllık hacim taahhüdü karşılığında 12 aylık özel fiyat', '12 month special pricing against an annual volume commitment'),
    },
  ],
  carrierAgreements: CARRIERS.map((c, i) => ({
    carrier: c.code,
    signedAt: rel(CONNECTED[c.code] + 20, 11, 0),
    validUntil: rel(-(365 - (i * 23) % 120), 23, 59),
    baseDiscountPct: [0.34, 0.36, 0.18, 0.22, 0.28, 0.25, 0.3, 0.2][i],
    tiers: c.volumeTiers,
    activeTierDiscountPct: 0,
    fuelRule: c.code === 'USPS'
      ? L('Sabit %12 yakıt ve işlem ek ücreti, çeyreklik güncellenir', 'Flat 12% fuel and handling surcharge, updated quarterly')
      : L(`Haftalık yakıt endeksine bağlı, şu an %${Math.round(c.fuelPct * 1000) / 10}`, `Indexed to the weekly fuel index, currently ${Math.round(c.fuelPct * 1000) / 10}%`),
    status: 'active',
  })),
  dynamicOverrides: [],
  firstMile: FIRST_MILE_TARIFF,
}
out('rate_cards', RATE_CARDS)

const UPS_ACCOUNT = {
  id: 'CA-UPS-01', carrier: 'UPS', status: 'connected', accountNumber: 'R8W4X82', accountMasked: '••••82', billingZip: '07094', country: 'US',
  negotiatedDiscountPct: 0.18, verifiedAt: rel(100, 14, 22), connectedAt: rel(100, 14, 20), mode: 'cheapest', ratesSource: 'fetched',
}
out('carrier_accounts', [
  UPS_ACCOUNT,
  { id: 'CA-FDX', carrier: 'FDX', status: 'not_connected' },
  { id: 'CA-USPS', carrier: 'USPS', status: 'not_connected' },
  { id: 'CA-DHLE', carrier: 'DHLE', status: 'not_connected' },
])
const UPS_CONNECTED_AT = dateOf(UPS_ACCOUNT.connectedAt)

function quote(carrier, service, hub, to, pkg, value, date, own = false) {
  return quoteService({
    carriers: CARRIERS, carrier, service, hub, toZip: to.zip, toState: to.state, pkg,
    residential: to.residential !== false, declaredValue: value, plan: 'enterprise', rateCards: RATE_CARDS,
    customerId: CUSTOMER_ID, carrierAccount: own ? UPS_ACCOUNT : null, dynamicOverrides: [], now: date, refDate: NOW,
  })
}

// ===========================================================================
// 3. Shipments (420) and orders (140)
// ===========================================================================
const rs = stream('shipments')
const N_SHIP = 420
const FIRST_SHP = 20930 - N_SHIP + 1 // 20511

// ---- dates ----------------------------------------------------------------
function weekdayFactor(d) {
  const wd = atDay(d).getDay()
  return [0.25, 1.1, 1.05, 1.0, 1.0, 0.9, 0.4][wd]
}
const RECENT = [4, 9, 8, 8, 1, 2, 6] // daysAgo 0..6 (Thu..Fri) = 38
const perDay = new Array(120).fill(0)
RECENT.forEach((n, d) => (perDay[d] = n))
{
  const shares = {}
  for (let d = 8; d < 120; d++) shares[d] = (1 + (1.4 * (119 - d)) / 111) * weekdayFactor(d)
  const alloc = splitInt(N_SHIP - 38, shares)
  for (const [d, n] of Object.entries(alloc)) perDay[Number(d)] = n
}
const shipDates = []
for (let d = 119; d >= 0; d--) {
  const times = []
  for (let k = 0; k < perDay[d]; k++) {
    if (d === 0) times.push(rs.int(6 * 60, 8 * 60 + 50))
    else times.push(rs.w([rs.int(8 * 60, 11 * 60 + 59), rs.int(12 * 60, 15 * 60 + 59), rs.int(16 * 60, 19 * 60 + 30)], [4, 5, 2]))
  }
  times.sort((a, b) => a - b)
  for (const t of times) shipDates.push(atDay(d, Math.floor(t / 60), t % 60))
}
assert(shipDates.length === N_SHIP, 'shipment date count')

// ---- helpers --------------------------------------------------------------
const BESTSELLERS = PRODUCTS.filter((p) => p.tags.includes('bestseller'))
function pickItems(r) {
  const n = r.w([1, 2, 3], [62, 28, 10])
  const items = []
  const used = new Set()
  for (let i = 0; i < n; i++) {
    let p
    do p = r.chance(0.45) ? r.pick(BESTSELLERS) : r.pick(PRODUCTS)
    while (used.has(p.sku))
    used.add(p.sku)
    const qty = r.w([1, 2, 3], [80, 15, 5])
    items.push({ sku: p.sku, title: p.title.en, qty, unitPrice: p.value, weightLb: p.weightLb, hsCode: p.hsCode })
  }
  return items
}
function packageFor(r, items) {
  const w = items.reduce((s, it) => s + it.weightLb * it.qty, 0)
  const vol = items.reduce((s, it) => {
    const d = PROD[it.sku].dims
    return s + d.lengthIn * d.widthIn * d.heightIn * it.qty
  }, 0)
  const soft = items.every((it) => ['textile', 'apparel'].some((t) => PROD[it.sku].tags.includes(t)))
  let box
  if (soft && vol < 400) box = BOX.POLY
  else if (items.length === 1 && items[0].qty === 1) {
    const d = PROD[items[0].sku].dims
    return { lengthIn: d.lengthIn + 1, widthIn: d.widthIn + 1, heightIn: d.heightIn + 1, weightLb: Math.round((w + 0.3 + r.float(0, 0.2)) * 10) / 10 }
  } else if (vol < 150) box = BOX.S
  else if (vol < 600) box = BOX.M
  else box = BOX.L
  return { lengthIn: box[0], widthIn: box[1], heightIn: box[2], weightLb: Math.round((w + box[3] + r.float(0, 0.2)) * 10) / 10 }
}
function isWest(to) {
  return WEST_STATES.includes(to.state) || ['NV', 'OR', 'WA', 'ID', 'MT', 'WY', 'HI', 'AK', 'UT'].includes(to.state)
}
function hubFor(r, to) {
  if (to.state === 'TX') return r.chance(0.5) ? 'LA01' : 'NJ01'
  return isWest(to) ? (r.chance(0.84) ? 'LA01' : 'NJ01') : r.chance(0.95) ? 'NJ01' : 'LA01'
}
const CARRIER_W = { USPS: 30, UPS: 27, FDX: 18, DHLE: 13, ONT: 16, LSO: 12 }
const SERVICE_W = {
  FDX: { GROUND: 0.8, HOME: 0.8, '2DAY': 0.15, STD_ON: 0.03 },
  UPS: { GROUND: 0.72, '3DS': 0.1, '2DA': 0.13, NDAS: 0.05 },
  USPS: { GA: 0.6, PM: 0.33, PME: 0.07 },
  DHLE: { EXP: 0.45, GND: 0.55 },
  ONT: { GROUND: 1 },
  LSO: { GROUND: 0.85, PND: 0.15 },
}
function eligibleFor(hub, to) {
  const out = []
  for (const c of CARRIERS) {
    if (c.type === 'international') continue
    if (c.coverage && !c.coverage.includes(to.state)) continue
    if (c.originHubs && !c.originHubs.includes(hub)) continue
    for (const s of c.services) {
      if (s.residentialOnly && to.residential === false) continue
      if (s.commercialOnly && to.residential !== false) continue
      out.push([c.code, s.code])
    }
  }
  return out
}
function chooseService(r, hub, to) {
  const el = eligibleFor(hub, to)
  const carriers = [...new Set(el.map((e) => e[0]))]
  const carrier = r.w(carriers, carriers.map((c) => CARRIER_W[c] || 5))
  const services = el.filter((e) => e[0] === carrier).map((e) => e[1])
  const service = r.w(services, services.map((s) => SERVICE_W[carrier]?.[s] ?? 0.1))
  return { carrier, service }
}
function trackingNo(r, carrier, service, own) {
  switch (carrier) {
    case 'FDX': return '7' + digits(r, 11)
    case 'UPS': {
      const sc = { GROUND: '03', '3DS': '12', '2DA': '02', NDAS: '13' }[service] || '03'
      return '1Z' + (own ? 'R8W482' : 'A7K294') + sc + digits(r, 8)
    }
    case 'USPS': return ({ GA: '9400', PM: '9405', PME: '9470' }[service] || '9400') + digits(r, 18)
    case 'DHLE': return 'GM' + digits(r, 18)
    case 'ONT': return 'D' + digits(r, 14)
    case 'LSO': return 'L' + digits(r, 10)
    default: return digits(r, 12)
  }
}
const ROUTES = {
  NJ01: {
    Northeast: ['Edison, NJ'], Southeast: ['Edison, NJ', 'Richmond, VA', 'Atlanta, GA'], Midwest: ['Harrisburg, PA', 'Columbus, OH', 'Chicago, IL'],
    Southwest: ['Harrisburg, PA', 'Memphis, TN', 'Dallas, TX'], West: ['Harrisburg, PA', 'Kansas City, MO', 'Denver, CO', 'Salt Lake City, UT'],
  },
  LA01: {
    West: ['Ontario, CA'], Southwest: ['Ontario, CA', 'Phoenix, AZ', 'Dallas, TX'], Midwest: ['Ontario, CA', 'Denver, CO', 'Kansas City, MO', 'Chicago, IL'],
    Southeast: ['Ontario, CA', 'Dallas, TX', 'Atlanta, GA'], Northeast: ['Ontario, CA', 'Kansas City, MO', 'Columbus, OH', 'Edison, NJ'],
  },
}
const HUB_LOC = { NJ01: 'Secaucus, NJ', LA01: 'Carson, CA' }
const NOW_LIMIT = NOW.getTime()

function ev(date, code, loc, extra) {
  const e = { at: relOf(date), code, loc }
  if (extra) Object.assign(e, extra)
  return e
}

function buildEvents(r, s, fate) {
  const created = s._date
  const events = [ev(created, 'label_created', HUB_LOC[s.hub])]
  if (fate === 'voided') {
    const v = addMin(created, r.int(40, 20 * 60))
    events.push(ev(v, 'voided', HUB_LOC[s.hub]))
    return { events, status: 'voided' }
  }
  if (s._awaitingDropoff) return { events, status: 'label_created' }
  // hub acceptance
  // the seller brings the parcel to the hub 1-2 days after printing the label
  let recv = atDay(daysBetween(created, NOW) - r.w([1, 2], [3, 2]), r.int(8, 15), r.int(0, 59))
  if (recv <= created) recv = addMin(created, 90)
  const pickup = new Date(recv)
  if (recv.getHours() >= 17) pickup.setDate(pickup.getDate() + 1)
  pickup.setHours(17, r.int(30, 59), 0, 0)
  const late = r.chance(1 - (findCarrier(CARRIERS, s.carrier).onTimeByZone[s.zone] || 0.95)) ? r.int(1, 2) : 0
  const transit = s._etaDays + late
  const delivDay = startOfDay(pickup)
  delivDay.setDate(delivDay.getDate() + transit)
  if (delivDay.getDay() === 0 && s.carrier !== 'USPS') delivDay.setDate(delivDay.getDate() + 1)
  s._late = late > 0
  s._deliveryDay = delivDay
  const plan = [ev(recv, 'hub_received', HUB_LOC[s.hub]), ev(pickup, 'picked_up', HUB_LOC[s.hub])]
  const stations = ROUTES[s.hub][regionOf(s.to.state)]
  const spanDays = Math.max(1, daysBetween(pickup, delivDay))
  stations.forEach((st, i) => {
    const t = new Date(pickup)
    if (i === 0) t.setHours(pickup.getHours() + 3, r.int(0, 59))
    else {
      t.setDate(t.getDate() + Math.min(spanDays - 1, Math.round((i * spanDays) / stations.length)))
      t.setHours(r.int(1, 22), r.int(0, 59))
      if (t <= pickup) t.setTime(pickup.getTime() + (i + 3) * 3600000)
    }
    plan.push(ev(t, i === 0 ? 'departed' : 'in_transit', st))
  })
  const destLoc = `${s.to.city}, ${s.to.state}`
  const arr = new Date(delivDay)
  arr.setHours(r.int(3, 5), r.int(0, 59))
  const ofd = new Date(delivDay)
  ofd.setHours(7, r.int(25, 55))
  const del = new Date(delivDay)
  del.setHours(r.int(10, 18), r.int(0, 59))
  plan.push(ev(arr, 'arrived', destLoc), ev(ofd, 'out_for_delivery', destLoc))
  if (fate === 'exception_open' || fate === 'exception_resolved' || fate === 'returned') {
    const exc = new Date(delivDay)
    exc.setHours(r.int(12, 17), r.int(0, 59))
    const detail = fate === 'returned' ? 'delivery_attempted' : r.chance(0.5) ? 'address_correction' : 'delivery_attempted'
    plan.push(ev(exc, 'exception', destLoc, { detail }))
    if (fate === 'exception_resolved') {
      const o2 = addMin(ofd, 24 * 60 + r.int(0, 20))
      const d2 = addMin(del, 24 * 60)
      plan.push(ev(o2, 'out_for_delivery', destLoc), ev(d2, 'delivered', destLoc))
    } else if (fate === 'returned') {
      const e2 = addMin(exc, 24 * 60 + r.int(-60, 60))
      plan.push(ev(e2, 'exception', destLoc, { detail: 'delivery_attempted' }))
      const ret = addMin(exc, (5 * 24 + r.int(0, 6)) * 60)
      plan.push(ev(ret, 'returned', HUB_LOC[s.hub], { detail: 'return_to_sender' }))
    }
  } else plan.push(ev(del, 'delivered', destLoc))
  const past = plan.filter((e) => dateOf(e.at).getTime() <= NOW_LIMIT)
  plan.sort((a, b) => dateOf(a.at) - dateOf(b.at))
  past.sort((a, b) => dateOf(a.at) - dateOf(b.at))
  events.push(...past)
  const last = events[events.length - 1].code
  const status = { label_created: 'label_created', hub_received: 'in_transit', picked_up: 'in_transit', departed: 'in_transit', in_transit: 'in_transit', arrived: 'in_transit', out_for_delivery: 'out_for_delivery', delivered: 'delivered', exception: 'exception', returned: 'returned' }[last]
  if (last === 'delivered') s._deliveredAt = dateOf(events[events.length - 1].at)
  return { events, status }
}

// ---- special fates ----------------------------------------------------------
const IDX_20877 = 20877 - FIRST_SHP
const dAgo = shipDates.map((d) => daysBetween(d, NOW))
assert(dAgo[IDX_20877] >= 5, 'SHP-20877 must be old enough to be measured at a hub')
const fate = new Array(N_SHIP).fill(null)
function chooseFate(name, n, lo, hi) {
  const cands = rs.shuffle([...Array(N_SHIP).keys()].filter((i) => dAgo[i] >= lo && dAgo[i] <= hi && !fate[i] && i !== IDX_20877))
  for (let k = 0; k < n; k++) fate[cands[k]] = name
}
chooseFate('voided', 6, 4, 45)
chooseFate('returned', 4, 22, 80)
chooseFate('exception_open', 5, 7, 12)
chooseFate('exception_resolved', 5, 10, 45)

// aiPick chosen for exactly 64% (269 of 420)
const AI_CHOSEN = rs.shuffle([...Array(N_SHIP).keys()].map((i) => i < 269))

// ---- two fulfilment flows -----------------------------------------------------
// 'stock': goods were sent in bulk from Türkiye to a US hub (intl stock shipment, see firstMileRef)
//          and the last mile label is printed at NJ01/LA01.
// 'direct': the parcel goes from Istanbul straight to the US buyer with DHL Express (DDP); `hub`
//          is the US gateway region used for zoning. ~15% of shipments, all at least 3 days old.
const rf = stream('flow')
const DIRECT = new Set()
{
  const cands = rf.shuffle([...Array(N_SHIP).keys()].filter((i) => i !== IDX_20877 && !fate[i] && dAgo[i] >= 3))
  // a few recent ones so that direct shipments are also visible in transit
  for (const i of cands.filter((i) => dAgo[i] <= 4).slice(0, 3)) DIRECT.add(i)
  for (const i of cands) if (DIRECT.size < Math.round(N_SHIP * 0.15)) DIRECT.add(i)
}
const DHL_GATEWAY = { NJ01: 'Cincinnati, OH', LA01: 'Los Angeles, CA' }
function makeDirect(s, date, to, pkg, value) {
  const q = quote('DHLX', 'EXPRESS_WW', s.hub, to, pkg, value, date)
  assert(q, `DHL Express quote failed for ${s.id}`)
  Object.assign(s, {
    flow: 'direct',
    origin: 'TR',
    incoterm: 'DDP',
    carrier: 'DHLX',
    service: 'EXPRESS_WW',
    account: 'platform',
    trackingNo: String(rf.int(1, 9)) + digits(rf, 9),
    from: { ...HQ_ADDRESS },
    billableLb: q.billableLb,
    dimWeightLb: q.dimWeightLb,
    zone: q.zone,
    cost: q.cost,
    price: q.sellPrice,
    insurance: q.insurance,
    total: q.total,
    walletCharge: q.walletCharge,
    pricing: { base: q.base, fuel: q.fuel, residential: q.residential, markupPct: q.markupPct, source: q.source, cardId: q.cardId || null, platformFee: q.platformFee },
    firstMileRef: null,
    _etaDays: q.etaDays + 1,
    _awaitingDropoff: false,
  })
  if (s.aiPick.chosen) {
    s.aiPick = {
      chosen: true, reasonCode: 'speed',
      reason: L(`Stokta olmayan ürün: İstanbul'dan doğrudan DHL Express ile gümrüklü teslim (DDP), ${q.etaDays + 1} gün`, `Item not stocked in the US: shipped direct from Istanbul with DHL Express, duties paid (DDP), ${q.etaDays + 1} days`),
      savingsVsDefault: 0, suggested: 'DHLX-EXPRESS_WW',
    }
  }
  // events: Istanbul pickup, IST departure, US gateway (customs), delivery
  const created = date
  const pickup = new Date(created)
  if (created.getHours() >= 16) pickup.setDate(pickup.getDate() + 1)
  pickup.setHours(17, rf.int(0, 50), 0, 0)
  const dep = new Date(pickup)
  dep.setHours(pickup.getHours() + 5, rf.int(0, 59))
  const gw = new Date(dep)
  gw.setHours(gw.getHours() + rf.int(16, 22), rf.int(0, 59))
  const delivDay = startOfDay(pickup)
  delivDay.setDate(delivDay.getDate() + s._etaDays)
  if (delivDay.getDay() === 0) delivDay.setDate(delivDay.getDate() + 1)
  if (delivDay <= gw) delivDay.setTime(startOfDay(gw).getTime() + DAY)
  const destLoc = `${s.to.city}, ${s.to.state}`
  const arr = new Date(delivDay)
  arr.setHours(rf.int(3, 5), rf.int(0, 59))
  const ofd = new Date(delivDay)
  ofd.setHours(8, rf.int(0, 40))
  const del = new Date(delivDay)
  del.setHours(rf.int(10, 17), rf.int(0, 59))
  const plan = [
    ev(created, 'label_created', 'İstanbul, TR'),
    ev(pickup, 'picked_up', 'İstanbul, TR'),
    ev(dep, 'departed', 'İstanbul, TR'),
    ev(gw, 'in_transit', DHL_GATEWAY[s.hub], { detail: 'customs_cleared' }),
    ev(arr, 'arrived', destLoc),
    ev(ofd, 'out_for_delivery', destLoc),
    ev(del, 'delivered', destLoc),
  ]
  s.events = plan.filter((e) => dateOf(e.at).getTime() <= NOW_LIMIT)
  const last = s.events[s.events.length - 1].code
  s.status = { label_created: 'label_created', picked_up: 'in_transit', departed: 'in_transit', in_transit: 'in_transit', arrived: 'in_transit', out_for_delivery: 'out_for_delivery', delivered: 'delivered' }[last]
  s.deliveredAt = last === 'delivered' ? relOf(del) : null
  const etaDate = new Date(created)
  etaDate.setDate(etaDate.getDate() + 1 + s._etaDays)
  s.eta = relOf(new Date(etaDate.getFullYear(), etaDate.getMonth(), etaDate.getDate(), 20, 0))
  s._late = false
}

// ---- SHP-20877: search a configuration where the reweigh delta is exactly +$4.20
function find20877(date) {
  const svc = [['UPS', 'GROUND'], ['USPS', 'GA'], ['FDX', 'HOME'], ['USPS', 'PM'], ['DHLE', 'EXP']]
  const weights = [1.4, 2.3, 3.2, 1.8, 2.6, 4.1, 5.3]
  for (const c of DEST_CITIES.filter((x) => x.weight >= 0.5)) {
    for (const [carrier, service] of svc) {
      const to = { zip: c.zips[0], state: c.state, city: c.city, residential: true }
      const hub = isWest(to) ? 'LA01' : 'NJ01'
      for (const w of weights) {
        const pkgD = { lengthIn: 8, widthIn: 6, heightIn: 4, weightLb: w }
        const pkgM = { ...pkgD, weightLb: Math.round((w + 1.9) * 10) / 10 }
        const a = quote(carrier, service, hub, to, pkgD, 60, date)
        const b = quote(carrier, service, hub, to, pkgM, 60, date)
        if (!a || !b) continue
        if (round2(b.total - a.total) === 4.2 && b.billableLb - a.billableLb === 2) return { city: c, carrier, service, hub, pkgD, pkgM }
      }
    }
  }
  return null
}
const S20877 = find20877(shipDates[IDX_20877])
assert(S20877, 'no configuration found for SHP-20877 delta +4.20')

// ---- build shipments --------------------------------------------------------
const CHANNEL_W = { shopify: 33, etsy: 27, amazon: 16, ebay: 10, manual: 8, api: 6 }
const shipments = []
for (let i = 0; i < N_SHIP; i++) {
  const date = shipDates[i]
  const d = dAgo[i]
  let city, carrier, service, hub, pkg, items, to
  if (i === IDX_20877) {
    city = S20877.city
    to = goodAddress(rs, city, { residential: true })
    to.zip = city.zips[0]
    if (!APT.has(to.zip)) to.line2 = ''
    hub = S20877.hub
    ;({ carrier, service } = S20877)
    items = [{ sku: 'RUG-MAT-23', title: PROD['RUG-MAT-23'].title.en, qty: 1, unitPrice: 60, weightLb: S20877.pkgD.weightLb, hsCode: '5702.42' }]
    pkg = S20877.pkgD
  } else {
    city = pickCity(rs)
    to = goodAddress(rs, city, { residential: rs.chance(0.86) })
    hub = hubFor(rs, to)
    items = pickItems(rs)
    pkg = packageFor(rs, items)
    ;({ carrier, service } = chooseService(rs, hub, to))
  }
  const value = i === IDX_20877 ? 60 : items.reduce((s2, it) => s2 + it.unitPrice * it.qty, 0)
  const own = carrier === 'UPS' && date > UPS_CONNECTED_AT && i !== IDX_20877 && rs.chance(0.4)
  const q = quote(carrier, service, hub, to, pkg, value, date, own)
  assert(q, `quote failed for ${carrier}-${service} ${hub} ${to.zip}`)
  const id = `SHP-${FIRST_SHP + i}`
  const s = {
    id,
    orderId: null,
    channel: null,
    reference: null,
    createdAt: relOf(date),
    hub,
    carrier,
    service,
    account: own ? `own:${UPS_ACCOUNT.id}` : 'platform',
    trackingNo: trackingNo(rs, carrier, service, own),
    flow: 'stock',
    origin: 'US',
    firstMileRef: null,
    from: { name: CO_NAME(hub), company: COMPANY, ...HUBS[hub], country: 'US' },
    to,
    package: pkg,
    declaredValue: value,
    billableLb: q.billableLb,
    dimWeightLb: q.dimWeightLb,
    zone: q.zone,
    cost: q.source === 'own' ? q.carrierCharge : q.cost,
    price: q.sellPrice,
    insurance: q.insurance,
    total: q.total,
    walletCharge: q.walletCharge,
    pricing: { base: q.base, fuel: q.fuel, residential: q.residential, markupPct: q.markupPct, source: q.source, cardId: q.cardId || null, platformFee: q.platformFee },
    status: null,
    eta: null,
    deliveredAt: null,
    events: [],
    labelFormat: '4x6',
    isDummy: false,
    manifestId: null,
    reweighAdjustmentId: null,
    aiPick: null,
    _date: date,
    _items: items,
    _etaDays: q.etaDays,
    _awaitingDropoff: d <= 2 || (d === 3 && rs.chance(0.5)),
  }
  if (i === IDX_20877) s._awaitingDropoff = false
  // AI pick
  const chosen = AI_CHOSEN[i]
  const def = quote('UPS', 'GROUND', 'NJ01', to, pkg, value, date)
  const diff = def ? round2(def.total - q.total) : 0
  if (chosen) {
    const p = Math.round((findCarrier(CARRIERS, carrier).onTimeByZone[q.zone] || 0.95) * 100)
    const svcName = findCarrier(CARRIERS, carrier).services.find((x) => x.code === service).name
    let reasonCode = 'lowest_cost'
    let reason = L(`Bu hat için en düşük maliyetli uygun servis, zamanında teslim oranı %${p}`, `Lowest cost eligible service on this lane, ${p}% on-time`)
    if (own) {
      reasonCode = 'own_account'
      reason = L('Kendi UPS hesabınızın anlaşmalı tarifesi platform tarifesinden daha uygun', 'Your own UPS account rate beats the platform rate')
    } else if (carrier === 'ONT' || carrier === 'LSO') {
      reasonCode = 'regional'
      reason = L(`Bölgesel taşıyıcı ${svcName}: bu eyalette daha hızlı ve daha ucuz`, `Regional carrier ${svcName}: faster and cheaper in this state`)
    } else if ((SERVICE_W[carrier] && ['2DAY', 'STD_ON', '2DA', 'NDAS', 'PME', 'PND'].includes(service))) {
      reasonCode = 'speed'
      reason = L(`Teslim hedefi için en uygun fiyatlı hızlı servis (${q.etaDays} gün)`, `Best priced fast service for the delivery target (${q.etaDays} days)`)
    } else if (p >= 96) {
      reasonCode = 'reliability'
      reason = L(`Zone ${q.zone} için yüksek zamanında teslim oranı (%${p}) ve rekabetçi fiyat`, `High on-time rate for zone ${q.zone} (${p}%) at a competitive price`)
    }
    const savings = diff >= 0.4 && diff <= 6.8 ? diff : rs.float(0.4, 6.8, 2)
    s.aiPick = { chosen: true, reasonCode, reason, savingsVsDefault: savings, suggested: q.key }
  } else {
    s.aiPick = {
      chosen: false, reasonCode: 'user_override',
      reason: L('Kullanıcı AI önerisi yerine farklı bir servis seçti', 'User selected a different service than the AI suggestion'),
      savingsVsDefault: 0, suggested: rs.pick(['USPS-GA', 'DHLE-EXP', 'UPS-GROUND', 'FDX-HOME', 'USPS-PM']),
    }
  }
  const b = buildEvents(rs, s, fate[i])
  s.events = b.events
  s.status = b.status
  const etaDate = new Date(date)
  etaDate.setDate(etaDate.getDate() + 1 + q.etaDays)
  s.eta = relOf(new Date(etaDate.getFullYear(), etaDate.getMonth(), etaDate.getDate(), 20, 0))
  s.deliveredAt = s._deliveredAt ? relOf(s._deliveredAt) : null
  if (DIRECT.has(i)) makeDirect(s, date, to, pkg, value)
  shipments.push(s)
}
assert(shipments[IDX_20877].status !== 'label_created' && shipments[IDX_20877].status !== 'voided', 'SHP-20877 status')
assert(shipments[N_SHIP - 1].id === 'SHP-20930', 'last shipment id')

// scale readings for label_created shipments (ops hub, spec 5.9): every 4th is noticeably heavier
{
  let k = 0
  for (const s of shipments) {
    if (s.status !== 'label_created') continue
    const heavy = k % 4 === 1
    const w = s.package.weightLb
    const reading = heavy ? Math.round((w + rs.float(1.6, 3.4)) * 10) / 10 : Math.max(0.1, Math.round((w - rs.float(0, 0.08)) * 10) / 10)
    s.scaleReading = { weightLb: reading, lengthIn: s.package.lengthIn, widthIn: s.package.widthIn, heightIn: s.package.heightIn, differs: heavy }
    k++
  }
}

// ---- link orders ------------------------------------------------------------
const ro = stream('orders')
const labelCreated = shipments.filter((s) => s.status === 'label_created')
assert(labelCreated.length >= 20, `need at least 20 label_created shipments, got ${labelCreated.length}`)
const labeledShips = ro.shuffle(labelCreated).slice(0, 20)
const deliveredPool = shipments.filter((s) => s.status === 'delivered' && dAgo[shipments.indexOf(s)] >= 6 && dAgo[shipments.indexOf(s)] <= 25 && s.id !== 'SHP-20877')
const deliveredShips = ro.shuffle(deliveredPool).slice(0, 8)
const takenSet = new Set([...labeledShips, ...deliveredShips].map((s) => s.id))
const shippedPool = shipments
  .filter((s) => ['in_transit', 'out_for_delivery', 'exception', 'delivered'].includes(s.status) && !takenSet.has(s.id))
  .sort((a, b) => b._date - a._date)
const shippedShips = shippedPool.slice(0, 50)
assert(shippedShips.length === 50 && deliveredShips.length === 8, 'order-linked shipment pools')

const orderDrafts = []
function addDraft(status, props) {
  orderDrafts.push({ status, ...props })
}
for (const s of labeledShips) addDraft('labeled', { ship: s })
for (const s of shippedShips) addDraft('shipped', { ship: s })
for (const s of deliveredShips) addDraft('delivered', { ship: s })

// awaiting 52: 9 problem (3 missing unit, 3 zip/city, 2 typo, 1 PO Box + UPS), 6 medium, 37 clean
const historyCandidates = [...shippedShips, ...deliveredShips].filter((s) => APT.has(s.to.zip) && s.to.line2)
assert(historyCandidates.length >= 3, 'need 3 apartment history orders')
const historyShips = ro.shuffle(historyCandidates).slice(0, 3)
const AWAIT_PROBLEMS = ['missing_unit', 'missing_unit', 'missing_unit', 'zip_city_mismatch', 'zip_city_mismatch', 'zip_city_mismatch', 'typo_street', 'typo_street', 'po_box_restricted']
AWAIT_PROBLEMS.forEach((t, k) => addDraft('awaiting_shipment', { problem: t, history: t === 'missing_unit' ? historyShips[k] : null, planted: t === 'zip_city_mismatch' && k === 3 }))
for (let k = 0; k < 6; k++) addDraft('awaiting_shipment', { medium: k % 2 === 0 ? 'case_anomaly' : 'unrecognized_suffix' })
for (let k = 0; k < 37; k++) addDraft('awaiting_shipment', { noPackage: k < 8 })
const HOLD_PROBLEMS = ['state_mismatch', 'incomplete_street', 'invalid_zip', 'missing_unit', 'zip_city_mismatch', 'typo_street']
for (const t of HOLD_PROBLEMS) addDraft('on_hold', { problem: t })
for (let k = 0; k < 4; k++) addDraft('cancelled', {})
assert(orderDrafts.length === 140, 'order draft count')

const PROBLEM_SCORE = { missing_unit: [48, 64], zip_city_mismatch: [38, 58], typo_street: [52, 66], po_box_restricted: [30, 45], state_mismatch: [25, 40], incomplete_street: [20, 45], invalid_zip: [10, 30] }
const ISSUE_FIELD = { missing_unit: 'line2', zip_city_mismatch: 'zip', typo_street: 'line1', po_box_restricted: 'line1', state_mismatch: 'state', incomplete_street: 'line1', invalid_zip: 'zip', case_anomaly: 'line1', unrecognized_suffix: 'line1' }
const ISSUE_SEV = { missing_unit: 'warning', typo_street: 'warning', case_anomaly: 'info', unrecognized_suffix: 'info' }
function issueObj(code) {
  return { code, field: ISSUE_FIELD[code], severity: ISSUE_SEV[code] || 'error' }
}
const MULTI_CITY_STATES = [...new Set(DEST_CITIES.map((c) => c.state))].filter((st) => DEST_CITIES.filter((c) => c.state === st).length >= 2)

for (const dr of orderDrafts) {
  let date
  let shipTo
  let items
  let pkg
  let addressCheck
  let customer
  let extra = {}
  if (dr.ship) {
    const s = dr.ship
    date = addMin(s._date, -ro.int(25, 20 * 60))
    shipTo = { ...s.to }
    items = s._items
    pkg = { ...s.package }
    customer = { name: s.to.name, email: emailFor(ro, s.to.name), phone: phoneFor(ro, s.to.state) }
    addressCheck = { score: ro.int(86, 99), issues: [], issueType: null, suggestion: null }
  } else {
    const d = dr.status === 'awaiting_shipment' ? ro.w([0, 1, 2, 3, 4], [3, 4, 3, 2, 1]) : dr.status === 'on_hold' ? ro.int(1, 8) : ro.int(3, 20)
    date = d === 0 ? atDay(0, ro.int(6, 8), ro.int(0, 59)) : atDay(d, ro.int(7, 21), ro.int(0, 59))
    items = pickItems(ro)
    pkg = dr.noPackage ? null : packageFor(ro, items)
    if (dr.problem) {
      let city
      if (dr.history) {
        const h = dr.history
        shipTo = { ...h.to }
        city = ZIP_INDEX.get(h.to.zip)
      } else {
        const pool = dr.problem === 'missing_unit' ? DEST_CITIES.filter((c) => c.zips.some((z) => APT.has(z)))
          : dr.problem === 'zip_city_mismatch' ? DEST_CITIES.filter((c) => MULTI_CITY_STATES.includes(c.state) && c.weight >= 0.8)
          : dr.problem === 'typo_street' ? DEST_CITIES.filter((c) => c.weight >= 1)
          : DEST_CITIES
        city = ro.pick(pool)
        shipTo = goodAddress(ro, city, { residential: true })
        if (dr.problem === 'missing_unit') {
          shipTo.zip = ro.pick(city.zips.filter((z) => APT.has(z)))
          shipTo.line2 = shipTo.line2 || unitStr(ro)
        }
      }
      if (dr.planted) {
        city = CITIES.find((c) => c.city === 'San Francisco')
        shipTo = { ...goodAddress(ro, city, { residential: true }), line1: '1450 Market St', line2: 'Apt 4B', zip: '94103' }
      }
      const br = breakAddress(ro, dr.problem, shipTo, city)
      if (dr.planted) br.address.zip = '94607'
      shipTo = br.address
      const [lo, hi] = PROBLEM_SCORE[dr.problem]
      const issues = [issueObj(dr.problem)]
      if (dr.problem === 'zip_city_mismatch') issues.push({ code: 'zip_city_lookup', field: 'city', severity: 'warning' })
      if (dr.problem === 'typo_street') issues.push({ code: 'unknown_street_token', field: 'line1', severity: 'info' })
      let suggestion = null
      if (dr.problem === 'missing_unit') {
        suggestion = dr.history ? { patch: { line2: dr.history.to.line2 }, source: 'history', sourceOrderId: null, _hist: dr.history.id, confidence: 0.91 } : null
      } else if (dr.problem === 'po_box_restricted') {
        suggestion = { patch: {}, carrier: 'USPS', service: 'GA', source: 'carrier_rule', confidence: 0.97 }
        extra.requestedCarrier = 'UPS'
        extra.requestedService = 'GROUND'
      } else if (br.correction) {
        const src = { zip_city_mismatch: 'zip_city', typo_street: 'street_match', state_mismatch: 'zip3_state', invalid_zip: 'zip_city', incomplete_street: 'history' }[dr.problem]
        suggestion = dr.problem === 'incomplete_street' ? null : { patch: br.correction, source: src, confidence: ro.float(0.78, 0.95, 2) }
      }
      addressCheck = { score: ro.int(lo, hi), issues, issueType: dr.problem, suggestion }
      if (dr.status === 'on_hold') extra.holdReason = L('Adres doğrulaması başarısız, düzeltme bekleniyor', 'Address validation failed, waiting for correction')
      customer = dr.history
        ? { name: dr.history.to.name, email: null, phone: null, _histShip: dr.history }
        : { name: shipTo.name, email: emailFor(ro, shipTo.name), phone: phoneFor(ro, shipTo.state) }
    } else {
      const city = pickCity(ro)
      shipTo = goodAddress(ro, city, { residential: ro.chance(0.86) })
      customer = { name: shipTo.name, email: emailFor(ro, shipTo.name), phone: phoneFor(ro, shipTo.state) }
      if (dr.medium === 'case_anomaly') {
        const fixed = shipTo.line1
        shipTo.line1 = fixed.toLowerCase()
        shipTo.city = ro.chance(0.5) ? shipTo.city.toUpperCase() : shipTo.city
        addressCheck = { score: ro.int(74, 84), issues: [issueObj('case_anomaly')], issueType: 'case_anomaly', suggestion: { patch: { line1: fixed, city: city.city }, source: 'normalize', confidence: 0.88 } }
      } else if (dr.medium === 'unrecognized_suffix') {
        const parts = shipTo.line1.split(' ')
        const fixed = shipTo.line1
        const hasSuffix = STREET_SUFFIXES.includes(parts[parts.length - 1])
        if (hasSuffix && parts.length > 2) shipTo.line1 = parts.slice(0, -1).join(' ')
        addressCheck = { score: ro.int(71, 82), issues: [issueObj('unrecognized_suffix')], issueType: 'unrecognized_suffix', suggestion: hasSuffix && parts.length > 2 ? { patch: { line1: fixed }, source: 'street_match', confidence: 0.82 } : null }
      } else {
        addressCheck = { score: ro.int(86, 99), issues: [], issueType: null, suggestion: null }
      }
    }
  }
  dr._date = date
  dr.shipTo = shipTo
  dr.items = items
  dr.pkg = pkg
  dr.addressCheck = addressCheck
  dr.customer = customer
  dr.extra = extra
}

// ids and channels (sorted by createdAt)
orderDrafts.sort((a, b) => a._date - b._date)
const CHANNELS = ro.shuffle([
  ...Array(46).fill('shopify'), ...Array(38).fill('etsy'), ...Array(22).fill('amazon'),
  ...Array(14).fill('ebay'), ...Array(12).fill('manual'), ...Array(8).fill('api'),
])
const chanSeq = { shopify: 5120, manual: 1040 }
function channelOrderNo(r, ch) {
  if (ch === 'shopify') return `#${chanSeq.shopify++}`
  if (ch === 'etsy') return String(3180000000 + r.int(0, 99999999))
  if (ch === 'amazon') return `11${r.int(1, 4)}-${digits(r, 7)}-${digits(r, 7)}`
  if (ch === 'ebay') return `${r.int(10, 27)}-${digits(r, 5)}-${digits(r, 5)}`
  if (ch === 'manual') return `MAN-${chanSeq.manual++}`
  if (ch === 'woocommerce') return `WC-${r.int(2000, 2999)}`
  return `ext_${[...Array(8)].map(() => '0123456789abcdef'[r.int(0, 15)]).join('')}`
}
const TAGS = [[], [], [], ['gift'], ['repeat-customer'], ['fragile'], ['priority'], ['wholesale'], ['gift', 'repeat-customer']]
const orders = orderDrafts.map((dr, k) => {
  const id = `ORD-${10343 + k}`
  const channel = CHANNELS[k]
  dr.id = id
  dr.channel = channel
  const total = round2(dr.items.reduce((s, it) => s + it.unitPrice * it.qty, 0))
  const o = {
    id,
    channel,
    channelOrderNo: channelOrderNo(ro, channel),
    createdAt: relOf(dr._date),
    customer: { name: dr.customer.name, email: dr.customer.email, phone: dr.customer.phone },
    shipTo: dr.shipTo,
    items: dr.items,
    package: dr.pkg,
    total,
    currency: 'USD',
    status: dr.status,
    addressCheck: { ...dr.addressCheck, checkedAt: relOf(addMin(dr._date, ro.int(1, 4))), modelVersion: 'addr-ml v1.3' },
    shipmentId: dr.ship ? dr.ship.id : null,
    tags: dr.status === 'on_hold' ? ['address-hold'] : ro.pick(TAGS).slice(),
    ...dr.extra,
  }
  if (dr.status === 'cancelled') {
    o.cancelledAt = relOf(addMin(dr._date, ro.int(60, 30 * 60)))
    o.cancelReason = ro.pick([L('Müşteri iptal etti', 'Cancelled by customer'), L('Stokta yok', 'Out of stock'), L('Ödeme iade edildi', 'Payment refunded')])
  }
  if (dr.ship) {
    dr.ship.orderId = id
    dr.ship.channel = channel
    dr.ship.reference = o.channelOrderNo
    if (['shopify', 'etsy', 'amazon', 'ebay'].includes(channel) && dr.status !== 'labeled') {
      o.trackingSyncedAt = relOf(addMin(dr.ship._date, 2 + ro.int(0, 10)))
    }
  }
  return o
})
// resolve history links (missing unit suggestions + same customer contact)
for (const o of orders) {
  const dr = orderDrafts.find((x) => x.id === o.id)
  if (dr.customer._histShip) {
    const hist = orders.find((x) => x.shipmentId === dr.customer._histShip.id)
    o.customer.email = hist.customer.email
    o.customer.phone = hist.customer.phone
    if (o.addressCheck.suggestion) {
      o.addressCheck.suggestion.sourceOrderId = hist.id
      delete o.addressCheck.suggestion._hist
    }
  }
  if (o.addressCheck.suggestion && o.addressCheck.suggestion._hist) delete o.addressCheck.suggestion._hist
}
// unlinked shipments: channel + reference
for (const s of shipments) {
  if (s.orderId) continue
  s.channel = rs.w(CHANNEL_W)
  s.reference = channelOrderNo(rs, s.channel)
}

// ---- adjustments (18) ---------------------------------------------------------
const ra = stream('adjustments')
const adjustments = []
{
  const s77 = shipments[IDX_20877]
  const cands = ra.shuffle(
    shipments.filter((s, i) => i !== IDX_20877 && dAgo[i] >= 5 && dAgo[i] <= 110 && ['delivered', 'in_transit', 'out_for_delivery'].includes(s.status) && s.pricing.source !== 'own' && !fate[i] &&
      ['GROUND', 'HOME', 'GA', 'PM', 'EXP', 'GND', '3DS'].includes(s.service)),
  ).slice(0, 17)
  const list = [s77, ...cands].sort((a, b) => a._date - b._date)
  const statuses = ra.shuffle(['charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'charged', 'disputed', 'disputed', 'waived', 'waived', 'waived'])
  let si = 0
  list.forEach((s, k) => {
    const id = `ADJ-${1001 + k}`
    const recv = s.events.find((e) => e.code === 'hub_received')
    const measuredAt = recv ? dateOf(recv.at) : addMin(s._date, 600)
    let measured
    if (s.id === 'SHP-20877') measured = { ...S20877.pkgM }
    else if (ra.chance(0.65)) measured = { ...s.package, weightLb: Math.round((s.package.weightLb + ra.float(1.1, 3.4)) * 10) / 10 }
    else measured = { ...s.package, lengthIn: s.package.lengthIn + 3, widthIn: s.package.widthIn + 2, heightIn: s.package.heightIn + 2, weightLb: Math.round((s.package.weightLb + ra.float(0.1, 0.6)) * 10) / 10 }
    const own = s.pricing.source === 'own'
    const nq = quote(s.carrier, s.service, s.hub, s.to, measured, s.declaredValue, s._date, own)
    let delta = round2(nq.total - s.total)
    if (delta <= 0) {
      measured.weightLb = Math.round((measured.weightLb + 2) * 10) / 10
      delta = round2(quote(s.carrier, s.service, s.hub, s.to, measured, s.declaredValue, s._date, own).total - s.total)
    }
    const status = s.id === 'SHP-20877' ? 'charged' : statuses[si++]
    const deadline = addMin(measuredAt, 30 * 24 * 60)
    const a = {
      id,
      shipmentId: s.id,
      orderId: s.orderId,
      carrier: s.carrier,
      service: s.service,
      measuredAt: relOf(measuredAt),
      measuredAtHub: s.hub,
      declared: { weightLb: s.package.weightLb, dims: { lengthIn: s.package.lengthIn, widthIn: s.package.widthIn, heightIn: s.package.heightIn }, billableLb: s.billableLb },
      measured: { weightLb: measured.weightLb, dims: { lengthIn: measured.lengthIn, widthIn: measured.widthIn, heightIn: measured.heightIn }, billableLb: nq.billableLb },
      originalPrice: s.total,
      newPrice: round2(s.total + delta),
      delta,
      status,
      disputeDeadline: relOf(deadline),
      photoPlaceholder: `scale-${(k % 6) + 1}`,
    }
    if (status === 'disputed') {
      a.dispute = { reason: 'measurement_error', note: L('Paket beyan edilen ölçülerle gönderildi, tartı fotoğrafı talep ediyoruz', 'The parcel was shipped with the declared dimensions, we request the scale photo'), openedAt: relOf(addMin(measuredAt, ra.int(600, 3000))), state: 'in_review' }
    }
    if (status === 'waived') a.waivedReason = L('Pilot müşteri toleransı kapsamında feragat edildi', 'Waived under the pilot customer tolerance')
    s.reweighAdjustmentId = id
    s._adj = a
    adjustments.push(a)
  })
  const a77 = adjustments.find((x) => x.shipmentId === 'SHP-20877')
  assert(a77 && a77.delta === 4.2 && a77.measured.billableLb - a77.declared.billableLb === 2, 'SHP-20877 adjustment must be +4.20 / +2 lb')
}
assert(adjustments.length === 18, 'adjustments count')
out('adjustments', adjustments)

// ---- manifests (carrier, 18) --------------------------------------------------
const manifestDrafts = []
{
  const groups = new Map()
  shipments.forEach((s, i) => {
    if (dAgo[i] < 1 || dAgo[i] > 30) return
    if (['label_created', 'voided'].includes(s.status) || s.flow === 'direct') return
    const pick = s.events.find((e) => e.code === 'picked_up')
    if (!pick) return
    const key = `${s.hub}|${s.carrier}|${pick.at.daysAgo}`
    if (!groups.has(key)) groups.set(key, { hub: s.hub, carrier: s.carrier, pickup: dateOf(pick.at), items: [] })
    groups.get(key).items.push(s)
  })
  const sorted = [...groups.values()].sort((a, b) => b.items.length - a.items.length || b.pickup - a.pickup || a.carrier.localeCompare(b.carrier)).slice(0, 18)
  for (const g of sorted) {
    const created = new Date(g.pickup)
    created.setHours(16, 10 + manifestDrafts.length, 0, 0)
    manifestDrafts.push({ type: 'carrier', ...g, date: created })
  }
}

// ===========================================================================
// 4. International first mile shipments (26) + air customs manifests (6)
// ===========================================================================
const ri = stream('intl')
const STAGES = ['created', 'origin_received', 'consolidation', 'in_flight', 'us_customs', 'customs_cleared', 'at_us_hub', 'last_mile_labeled', 'out_for_delivery', 'completed']
// TR origin first mile shipments are bulk stock replenishments of the demo company (shipped from its
// Istanbul HQ via the Istanbul consolidation point). GB origin ones belong to the UK pilot customer.
const TR_SENDER = { name: 'Burak Şahin', company: LEGAL_NAME, line1: HQ_ADDRESS.line1, line2: '', district: HQ_ADDRESS.district, city: HQ_ADDRESS.city, state: HQ_ADDRESS.state, zip: HQ_ADDRESS.zip, phone: COMPANY_PHONE }
const GB_SENDER = { name: 'George Pennington', company: UK_CUSTOMER, line1: '22 High Street', line2: '', city: 'Chipping Norton', state: 'Oxfordshire', zip: 'OX7 5AD', phone: '+44 1608 555 014' }
// The UK pilot customer's own catalogue (not part of the demo company's products.json)
const UK_PRODUCTS = [
  ['CCC-CND-LAV', 'Cotswold Lavender Jar Candle 9oz', 'Cotswold lavanta kavanoz mum 9oz', 1.1, 18, '3406.00'],
  ['CCC-CND-TPR', 'Beeswax Taper Candles Pair', 'Balmumu uzun mum (çift)', 0.5, 14, '3406.00'],
  ['CCC-CND-TIN', 'Travel Tin Candle Set of 3', 'Seyahat teneke mum seti (3 adet)', 0.9, 22, '3406.00'],
  ['CCC-SOP-GML', 'Goat Milk Soap Duo', 'Keçi sütlü sabun ikili set', 0.6, 12, '3401.11'],
  ['CCC-SKN-BLM', 'Hand Balm with Shea 50ml', 'Shea yağlı el balmı 50ml', 0.3, 16, '3304.99'],
  ['CCC-PRT-BOT', 'Botanical Poster 11x14', 'Botanik poster 11x14', 0.3, 15, '4911.91'],
  ['CCC-SHL-WOL', 'Soft Wool Scarf', 'Yumuşak yün atkı', 0.5, 30, '6117.10'],
  ['CCC-BOX-GFT', 'Candle Gift Box Set of 3', 'Mum hediye kutusu seti (3 adet)', 1.4, 9, '4819.20'],
].map(([sku, en, tr, weightLb, value, hsCode]) => ({ sku, title: L(tr, en), weightLb, value, hsCode, origin: 'GB' }))
const FLIGHTS = {
  'TR|NJ01': { flight: 'TK 001 IST-JFK', route: 'IST-JFK', prefix: '235' },
  'TR|LA01': { flight: 'TK 009 IST-LAX', route: 'IST-LAX', prefix: '235' },
  'GB|NJ01': { flight: 'BA 177 LHR-JFK', route: 'LHR-JFK', prefix: '125' },
  'GB|LA01': { flight: 'BA 283 LHR-LAX', route: 'LHR-LAX', prefix: '125' },
}
const intl = []
{
  // Six consolidated flights (= six air customs manifests); T = days since departure.
  const FLIGHT_PLAN = [
    { origin: 'GB', destHub: 'NJ01', T: 38.2, stages: ['completed', 'completed', 'completed'] },
    { origin: 'TR', destHub: 'NJ01', T: 96.2, stages: ['completed', 'completed', 'completed'] },
    { origin: 'TR', destHub: 'LA01', T: 58.3, stages: ['completed', 'completed', 'completed'] },
    { origin: 'GB', destHub: 'LA01', T: 5.2, stages: ['out_for_delivery', 'out_for_delivery', 'last_mile_labeled', 'at_us_hub'] },
    { origin: 'TR', destHub: 'NJ01', T: 3.1, stages: ['at_us_hub', 'customs_cleared', 'customs_cleared', 'us_customs'] },
    { origin: 'TR', destHub: 'NJ01', T: 0.62, stages: ['us_customs', 'us_customs', 'in_flight', 'in_flight'] },
  ]
  const UNFLOWN = [['GB', 'consolidation'], ['GB', 'consolidation'], ['GB', 'origin_received'], ['GB', 'created'], ['TR', 'origin_received']]
  const H = 60
  const drafts = []
  FLIGHT_PLAN.forEach((f) => {
    const tf = addMin(NOW, -Math.round(f.T * 24 * 60))
    f.at = tf
    f.mawb = `${FLIGHTS[`${f.origin}|${f.destHub}`].prefix}-${digits(ri, 8)}`
    f.stages.forEach((stage) => {
      const idx = STAGES.indexOf(stage)
      const times = []
      const created = addMin(tf, -ri.int(70, 120) * H)
      times[0] = created
      times[1] = addMin(created, ri.int(8, 26) * H)
      times[2] = addMin(tf, -ri.int(10, 24) * H)
      if (times[2] <= times[1]) times[2] = addMin(times[1], 6 * H)
      times[3] = tf
      times[4] = addMin(tf, ri.int(10, 13) * H)
      times[5] = addMin(times[4], ri.int(8, 26) * H)
      times[6] = addMin(times[5], ri.int(5, 10) * H)
      times[7] = addMin(times[6], ri.int(3, 7) * H)
      times[8] = addMin(times[7], ri.int(12, 20) * H)
      times[9] = addMin(times[8], ri.int(26, 70) * H)
      const hist = []
      for (let si = 0; si <= idx; si++) {
        let t = times[si]
        if (t.getTime() > NOW_LIMIT) t = addMin(NOW, -(idx - si + 1) * ri.int(15, 40))
        hist.push(t)
      }
      drafts.push({ origin: f.origin, destHub: f.destHub, stage, times: hist, flight: f })
    })
  })
  UNFLOWN.forEach(([origin, stage]) => {
    const idx = STAGES.indexOf(stage)
    const created = addMin(NOW, -ri.int(8 + idx * 20, 30 + idx * 30) * H)
    const hist = [created]
    for (let si = 1; si <= idx; si++) {
      let t = addMin(hist[si - 1], ri.int(8, 20) * H)
      if (t.getTime() > NOW_LIMIT) t = addMin(NOW, -ri.int(20, 90))
      hist.push(t)
    }
    drafts.push({ origin, destHub: ri.chance(0.7) ? 'NJ01' : 'LA01', stage, times: hist, flight: null })
  })
  drafts.sort((a, b) => a.times[0] - b.times[0])
  drafts.forEach((dr, k) => {
    const id = `INT-${3101 + k}`
    const origin = dr.origin
    const currency = origin === 'GB' ? 'GBP' : 'TRY'
    const fx = origin === 'GB' ? 1.27 : 0.024
    const destHub = dr.destHub
    const handover = origin === 'GB' ? ri.w(['pickup', 'dropoff'], [6, 4]) : ri.w(['pickup', 'dropoff'], [4, 6])
    const originPoint = origin === 'GB' ? (handover === 'pickup' ? 'EVRI-NET' : 'LHR-CP') : 'IST-CP'
    const stock = origin === 'TR'
    const nParcels = stock ? ri.w([4, 6, 8, 10], [2, 3, 3, 2]) : ri.w([1, 2, 3, 4, 6, 8], [2, 3, 3, 2, 1, 1])
    const prodPool = stock ? PRODUCTS.filter((p) => p.inventoryHubs.includes(destHub)) : UK_PRODUCTS
    const parcels = []
    for (let p = 0; p < nParcels; p++) {
      const nItems = stock ? ri.int(1, 2) : ri.int(1, 3)
      const itemsP = []
      const used = new Set()
      for (let j = 0; j < nItems; j++) {
        let prod
        do prod = ri.pick(prodPool)
        while (used.has(prod.sku) && used.size < prodPool.length)
        used.add(prod.sku)
        const qty = stock ? ri.int(8, 30) : ri.int(2, 12)
        const unitUsd = Math.round(prod.value * 0.45 * 100) / 100
        const unitLocal = Math.round((unitUsd / fx) * 100) / 100
        itemsP.push({ sku: prod.sku, title: prod.title.en, qty, unitValueLocal: unitLocal, currency, unitValueUsd: unitUsd, hsCode: prod.hsCode, origin: prod.origin, weightKg: Math.round(prod.weightLb * 0.4536 * qty * 100) / 100 })
      }
      const wKg = Math.round((itemsP.reduce((s, it) => s + it.weightKg, 0) + 0.6) * 10) / 10
      parcels.push({ ref: `${id}-P${p + 1}`, lengthCm: ri.pick([40, 45, 50, 60]), widthCm: ri.pick([30, 35, 40]), heightCm: ri.pick([20, 25, 30, 35]), weightKg: wKg, items: itemsP })
    }
    const totalKg = Math.round(parcels.reduce((s, p) => s + p.weightKg, 0) * 10) / 10
    const volKg = Math.round(parcels.reduce((s, p) => s + (p.lengthCm * p.widthCm * p.heightCm) / 6000, 0) * 10) / 10
    const valueLocal = round2(parcels.reduce((s, p) => s + p.items.reduce((t, it) => t + it.unitValueLocal * it.qty, 0), 0))
    const valueUsd = round2(parcels.reduce((s, p) => s + p.items.reduce((t, it) => t + it.unitValueUsd * it.qty, 0), 0))
    const lmDraw = ri.w(['store', 'direct'], [6, 4])
    const lastMile = stock ? 'store' : lmDraw
    const fmq = firstMileQuote({ origin, weightKg: totalKg, volumetricKg: volKg, parcels: nParcels, destHub, handover, lastMile, rateCards: RATE_CARDS })
    const stageIdx = STAGES.indexOf(dr.stage)
    const history = dr.times.map((t, si) => ({ stage: STAGES[si], at: relOf(t) }))
    const fl = FLIGHTS[`${origin}|${destHub}`]
    const sender = origin === 'GB' ? GB_SENDER : TR_SENDER
    const created = dr.times[0]
    const s = {
      id,
      customerId: stock ? CUSTOMER_ID : UK_CUSTOMER_ID,
      purpose: stock || lastMile === 'store' ? 'stock' : 'direct',
      origin,
      originPoint,
      handover,
      sender: { ...sender, country: origin },
      destHub,
      lastMile,
      parcels,
      parcelCount: nParcels,
      totalWeightKg: totalKg,
      volumetricKg: volKg,
      declaredValueLocal: valueLocal,
      currency,
      declaredValueUsd: valueUsd,
      fxRate: fx,
      contentType: 'merchandise',
      stage: dr.stage,
      stageHistory: history,
      createdAt: relOf(created),
      eta: relOf(addMin(created, (fmq.etaDays + 1) * 24 * 60)),
      mawb: dr.flight ? dr.flight.mawb : null,
      flight: dr.flight ? fl.flight : null,
      route: fl.route,
      manifestId: null,
      customsStatus: stageIdx < 4 ? 'pending' : stageIdx === 4 ? 'submitted' : 'cleared',
      customsDocs: ['commercial_invoice', valueUsd > 400 ? 'cn23' : 'cn22'],
      dummyLabel: { ref: `KPZ-TMP-${digits(ri, 6)}`, createdAt: relOf(addMin(created, 20)), status: stageIdx >= 7 ? 'replaced' : 'active' },
      lastMileLabelCount: stageIdx >= 7 && lastMile === 'direct' ? nParcels * ri.int(3, 8) : 0,
      price: { pickup: fmq.pickup, consolidation: fmq.consolidation, airFreight: fmq.airFreight, customsFee: fmq.customsFee, lastMile: fmq.lastMile, total: fmq.total, chargeableKg: fmq.chargeableKg, airRatePerKg: fmq.airRatePerKg },
      completedAt: dr.stage === 'completed' ? history[history.length - 1].at : null,
      _flight: dr.flight,
    }
    intl.push(s)
  })
  // one shipment waiting for extra documents at US customs
  const docs = intl.find((x) => x.stage === 'us_customs')
  docs.customsStatus = 'docs_requested'
  docs.customsRequest = {
    at: docs.stageHistory[docs.stageHistory.length - 1].at,
    docs: [L('Tekstil menşe beyanı', 'Textile declaration of origin'), L('Ürün kompozisyon belgesi (%100 pamuk)', 'Product composition statement (100% cotton)')],
    note: L('CBP ek belge talep etti, 48 saat içinde yüklenmeli', 'CBP requested additional documents, upload within 48 hours'),
  }
  for (const f of FLIGHT_PLAN) {
    const members = intl.filter((x) => x._flight === f)
    const fl = FLIGHTS[`${f.origin}|${f.destHub}`]
    manifestDrafts.push({ type: 'air_customs', intl: members, date: addMin(f.at, -180), mawb: f.mawb, flight: fl.flight, route: fl.route, origin: f.origin, destHub: f.destHub })
  }
  for (const x of intl) delete x._flight
}
assert(intl.length === 26 && intl.filter((x) => x.origin === 'GB').length === 11 && intl.filter((x) => x.stage === 'completed').length === 9, 'intl counts')

// ---- manifest ids ---------------------------------------------------------------
manifestDrafts.sort((a, b) => a.date - b.date)
assert(manifestDrafts.length === 24, `manifests must be 24, got ${manifestDrafts.length}`)
const manifests = manifestDrafts.map((m, k) => {
  const id = `MNF-${pad(388 + k, 4)}`
  const age = daysBetween(m.date, NOW)
  if (m.type === 'carrier') {
    for (const s of m.items) s.manifestId = id
    const weight = round2(m.items.reduce((s, x) => s + x.package.weightLb, 0))
    return {
      id, type: 'carrier', hub: m.hub, carrier: m.carrier,
      formType: m.carrier === 'USPS' ? 'usps_scan_form' : 'end_of_day',
      createdAt: relOf(m.date), status: age >= 1 ? 'handed_over' : 'created',
      handedOverAt: age >= 1 ? relOf(addMin(m.date, 95)) : null,
      shipmentIds: m.items.map((s) => s.id),
      totals: { parcels: m.items.length, weightLb: weight },
    }
  }
  for (const x of m.intl) x.manifestId = id
  const allCleared = m.intl.every((x) => STAGES.indexOf(x.stage) >= 5)
  const anySubmitted = m.intl.some((x) => STAGES.indexOf(x.stage) >= 4)
  return {
    id, type: 'air_customs', hub: m.destHub, origin: m.origin, mawb: m.mawb, flight: m.flight, route: m.route,
    createdAt: relOf(m.date), status: allCleared ? 'customs_cleared' : anySubmitted ? 'customs_submitted' : 'created',
    hawbs: m.intl.map((x, j) => ({
      hawb: `KPH${digits(ri, 7)}`,
      intlShipmentId: x.id,
      shipper: x.sender.company,
      consignee: `${x.customerId === UK_CUSTOMER_ID ? UK_CUSTOMER : COMPANY} c/o KargoPazar ${x.destHub}`,
      contents: [...new Set(x.parcels.flatMap((p) => p.items.map((it) => it.title)))].slice(0, 3).join(', '),
      hsCodes: [...new Set(x.parcels.flatMap((p) => p.items.map((it) => it.hsCode).filter(Boolean)))],
      valueUsd: x.declaredValueUsd,
      origin: x.origin,
      weightKg: x.totalWeightKg,
      parcels: x.parcelCount,
    })),
    totals: {
      parcels: m.intl.reduce((s, x) => s + x.parcelCount, 0),
      weightKg: round2(m.intl.reduce((s, x) => s + x.totalWeightKg, 0)),
      valueUsd: round2(m.intl.reduce((s, x) => s + x.declaredValueUsd, 0)),
    },
  }
})
const M409 = manifests.find((m) => m.id === 'MNF-0409')
assert(manifests[manifests.length - 1].id === 'MNF-0411' && M409, 'manifest id range')
out('manifests', manifests)
out('intl_shipments', intl)

// ---- stock flow links, per hub stock, order flow ---------------------------------
{
  const ON_THE_WAY = (x) => STAGES.indexOf(x.stage) < STAGES.indexOf('at_us_hub')
  const trStock = intl.filter((x) => x.origin === 'TR' && x.purpose === 'stock')
  assert(trStock.filter((x) => ON_THE_WAY(x) && dateOf(x.eta) > NOW).length >= 2, 'at least two TR stock shipments on the way with a future ETA')
  const skusOf = (x) => new Set(x.parcels.flatMap((p) => p.items.map((it) => it.sku)))
  const completed = trStock.filter((x) => x.stage === 'completed').map((x) => ({ x, at: dateOf(x.completedAt), skus: skusOf(x) }))
  // firstMileRef: the completed stock shipment (same hub) that brought the goods; prefer one that
  // arrived before the label and contains one of the shipped SKUs.
  for (const s of shipments) {
    if (s.flow !== 'stock') continue
    const pool = completed.filter((c) => c.x.destHub === s.hub)
    assert(pool.length, `no completed TR stock shipment for ${s.hub}`)
    const before = pool.filter((c) => c.at <= s._date)
    const cand = before.length ? before : pool
    const skus = s._items.map((it) => it.sku)
    const withSku = cand.filter((c) => skus.some((k) => c.skus.has(k)))
    const list = (withSku.length ? withSku : cand).slice().sort((a, b) => (before.length ? b.at - a.at : a.at - b.at))
    s.firstMileRef = list[0].x.id
  }
  // per hub stock = weekly sales (last 4 weeks, stock flow) x weeks of cover. A few SKUs are sold
  // out at both hubs while a replenishment is on the way (inTransit is derived from intl_shipments).
  const rk = stream('stock')
  const since = atDay(28)
  const sold = {}
  for (const s of shipments) {
    if (s.flow !== 'stock' || s.status === 'voided' || s._date < since) continue
    for (const it of s._items) sold[`${it.sku}|${s.hub}`] = (sold[`${it.sku}|${s.hub}`] || 0) + it.qty
  }
  const transitNJ = [...new Set(trStock.filter((x) => ON_THE_WAY(x) && x.destHub === 'NJ01').flatMap((x) => [...skusOf(x)]))].sort()
  const soldOut = new Set(transitNJ.filter((k) => !PROD[k].inventoryHubs.includes('LA01') && !PROD[k].tags.includes('bestseller')).slice(0, 2))
  assert(soldOut.size === 2, 'two sold out SKUs with replenishment on the way')
  const COVER = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16]
  for (const p of PRODUCTS) {
    const stockByHub = {}
    for (const hub of ['NJ01', 'LA01']) {
      const weekly = (sold[`${p.sku}|${hub}`] || 0) / 4
      const cover = rk.pick(COVER)
      const floor = rk.int(3, 12)
      let n = weekly > 0 ? Math.max(floor, Math.round(weekly * cover)) : rk.int(4, 24)
      if (!p.inventoryHubs.includes(hub) || soldOut.has(p.sku)) n = 0
      stockByHub[hub] = n
    }
    const createdAt = p.createdAt
    delete p.createdAt
    p.stock = stockByHub
    p.createdAt = createdAt
  }
  for (const o of orders) {
    const s = o.shipmentId ? shipments.find((x) => x.id === o.shipmentId) : null
    o.flow = s ? s.flow : o.items.some((it) => PROD[it.sku] && PROD[it.sku].stock.NJ01 + PROD[it.sku].stock.LA01 === 0) ? 'direct' : 'stock'
  }
}

// ===========================================================================
// 5. Wallet (90 transactions, sum = balance 1248.60)
// ===========================================================================
const BALANCE = 1248.6
const SVC_NAME = Object.fromEntries(CARRIERS.flatMap((c) => c.services.map((s) => [`${c.code}-${s.code}`, s.name])))
function buildWallet() {
  const byNewest = shipments.slice().sort((a, b) => b._date - a._date)
  const fees = [2, 32, 62, 92].map((d) => atDay(d, 0, 5))
  const manualTopup = atDay(3, 10, 14)
  for (let n = 40; n <= 110; n++) for (const M of [1000, 750, 1250, 1500, 500]) {
    const incl = byNewest.slice(0, n)
    const start = incl[incl.length - 1]._date
    const evs = []
    for (const s of incl) {
      const nm = SVC_NAME[`${s.carrier}-${s.service}`]
      const own = s.pricing.source === 'own'
      evs.push({ at: s._date, type: 'label', amount: -s.walletCharge, shipmentId: s.id, description: L(`Etiket · ${nm}${own ? ' (kendi hesap, platform ücreti)' : ''}`, `Label · ${nm}${own ? ' (own account, platform fee)' : ''}`) })
      if (s.status === 'voided') {
        const v = s.events.find((e) => e.code === 'voided')
        evs.push({ at: dateOf(v.at), type: 'refund', amount: s.walletCharge, shipmentId: s.id, description: L(`İptal iadesi · ${s.id}`, `Void refund · ${s.id}`) })
      }
    }
    for (const a of adjustments) {
      const at = dateOf(a.measuredAt)
      if (at < start || a.status === 'waived') continue
      const dl = round2(a.measured.billableLb - a.declared.billableLb)
      evs.push({ at, type: 'adjustment', amount: -a.delta, shipmentId: a.shipmentId, adjustmentId: a.id, description: L(`Ağırlık düzeltmesi · ${a.shipmentId} (+${dl} lb)`, `Weight adjustment · ${a.shipmentId} (+${dl} lb)`) })
    }
    for (const f of fees) if (f >= start) evs.push({ at: f, type: 'plan_fee', amount: -199, description: L('Aylık plan ücreti · Kurumsal', 'Monthly plan fee · Enterprise') })
    if (manualTopup >= start) evs.push({ at: manualTopup, type: 'topup', amount: M, method: 'card_4242', description: L('Bakiye yükleme · Visa •••• 4242', 'Top up · Visa •••• 4242') })
    evs.sort((a, b) => a.at - b.at || (a.type === 'label' ? 1 : -1))
    const sumEv = round2(evs.reduce((s, e) => s + e.amount, 0))
    for (let k = 1; k <= 15; k++) {
      const X = round2(BALANCE - sumEv - 500 * k)
      if (X < 100) break
      let bal = X
      let tops = 0
      const outList = []
      let ok = true
      for (const e of evs) {
        bal = round2(bal + e.amount)
        outList.push({ ...e, balanceAfter: bal })
        if (bal < 0) ok = false
        if (e.amount < 0 && bal < 200) {
          tops++
          bal = round2(bal + 500)
          outList.push({ at: addMin(e.at, 1), type: 'topup', amount: 500, method: 'auto', description: L('Otomatik yükleme · Visa •••• 4242', 'Auto top up · Visa •••• 4242'), balanceAfter: bal })
        }
      }
      if (!ok || tops !== k) continue
      if (1 + outList.length !== 90) continue
      const opening = { at: addMin(start, -1), type: 'opening', amount: X, balanceAfter: X, description: L('Devreden bakiye', 'Balance carried forward') }
      return [opening, ...outList]
    }
  }
  return null
}
const walletTx = buildWallet()
assert(walletTx, 'could not build a 90 transaction wallet history')
const MANUAL_TOPUP = walletTx.find((t) => t.method === 'card_4242').amount
const MANUAL_TXT = '$' + MANUAL_TOPUP.toLocaleString('en-US')
const walletList = walletTx.map((t, k) => {
  const o = { id: `TXN-${7622 + k}`, at: relOf(t.at), type: t.type, amount: round2(t.amount), balanceAfter: t.balanceAfter, description: t.description, status: 'completed' }
  if (t.shipmentId) o.shipmentId = t.shipmentId
  if (t.adjustmentId) o.adjustmentId = t.adjustmentId
  if (t.method) o.method = t.method
  return o
})
{
  const sumCents = walletList.reduce((s, t) => s + Math.round(t.amount * 100), 0)
  assert(walletList.length === 90, 'wallet must have 90 transactions')
  assert(sumCents === Math.round(BALANCE * 100), `wallet transactions sum ${sumCents / 100} != ${BALANCE}`)
  assert(walletList[walletList.length - 1].balanceAfter === BALANCE, 'last balanceAfter must equal balance')
  assert(walletList[89].id === 'TXN-7711', 'last TXN id')
  assert(walletList.some((t) => t.adjustmentId && t.shipmentId === 'SHP-20877' && t.amount === -4.2), 'SHP-20877 adjustment tx')
}
out('wallet', {
  balance: BALANCE,
  currency: 'USD',
  autoTopup: { enabled: true, threshold: 200, amount: 500, cardId: 'card_4242' },
  cards: [
    { id: 'card_4242', brand: 'visa', last4: '4242', expMonth: 9, expYear: 2028, holder: 'Anatolia Home & Craft', billingZip: '34415', isDefault: true, addedAt: rel(209, 11, 30) },
    { id: 'card_5100', brand: 'mastercard', last4: '5100', expMonth: 3, expYear: 2027, holder: 'Elif Aydin', billingZip: '34394', isDefault: false, addedAt: rel(120, 16, 2) },
  ],
  transactions: walletList,
})

// ===========================================================================
// 6. Invoices (last 6 months)
// ===========================================================================
{
  const inv = []
  const p4 = shipments.filter((s, i) => dAgo[i] >= 92 && dAgo[i] <= 121)
  const invBase = p4.length
  const invAvgPrice = p4.reduce((s, x) => s + x.price, 0) / p4.length
  const invAvgIns = p4.reduce((s, x) => s + x.insurance, 0) / p4.length
  for (let k = 6; k >= 1; k--) {
    const endD = 2 + 30 * (k - 1)
    const startD = endD + 29
    const inP = shipments.filter((s, i) => dAgo[i] >= endD && dAgo[i] <= startD)
    const covered = endD <= 119
    const est = covered ? null : Math.round(invBase * 0.86 ** (k - 4))
    const labels = covered ? inP.length : est
    const labelAmt = covered ? round2(inP.reduce((s, x) => s + x.price, 0)) : round2(est * invAvgPrice)
    const ins = covered ? round2(inP.reduce((s, x) => s + x.insurance, 0)) : round2(est * invAvgIns)
    const adjs = adjustments.filter((a) => {
      const d = daysBetween(dateOf(a.measuredAt), NOW)
      return d >= endD && d <= startD && a.status !== 'waived'
    })
    const voids = inP.filter((s) => s.status === 'voided')
    const lines = [
      { code: 'labels', desc: L('Kargo etiketleri', 'Shipping labels'), qty: labels, amount: labelAmt },
      { code: 'insurance', desc: L('Kargo sigortası', 'Shipping insurance'), qty: covered ? inP.filter((s) => s.insurance > 0).length : Math.round(est * 0.2), amount: ins },
      { code: 'adjustments', desc: L('Ağırlık düzeltmeleri', 'Weight adjustments'), qty: adjs.length, amount: round2(adjs.reduce((s, a) => s + a.delta, 0)) },
      { code: 'refunds', desc: L('İptal iadeleri', 'Void refunds'), qty: voids.length, amount: -round2(voids.reduce((s, x) => s + x.total, 0)) },
      { code: 'plan_fee', desc: L('Kurumsal plan aylık ücreti', 'Enterprise plan monthly fee'), qty: 1, amount: 199 },
    ]
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0))
    inv.push({
      id: `INV-2026-${pad(97 - k + 1, 4)}`,
      periodStart: rel(startD, 0, 0),
      periodEnd: rel(endD, 23, 59),
      issuedAt: rel(endD - 1, 6, 0),
      dueAt: rel(endD - 1, 6, 0),
      status: 'paid',
      paidFrom: 'wallet',
      currency: 'USD',
      lines,
      subtotal,
      tax: 0,
      total: subtotal,
      estimated: !covered,
    })
  }
  assert(inv[inv.length - 1].id === 'INV-2026-0097' && inv[0].id === 'INV-2026-0092', 'invoice ids')
  out('invoices', inv)
}

// ===========================================================================
// 7. Weekly history (78 weeks, spec 3.8 formula)
// ===========================================================================
{
  const rh = stream('history')
  const rows = []
  const holidayBoost = (date) => {
    const md = date.getMonth() * 100 + date.getDate()
    if (md >= 1020 && md <= 1026) return 0.45 // Nov 20-26
    if (md >= 1027 && md <= 1103) return 0.7 // Nov 27 - Dec 3
    if (md >= 1104 && md <= 1110) return 0.55 // Dec 4-10
    if (md >= 1111 && md <= 1117) return 0.3
    if (md >= 1118 && md <= 1124) return 0.12
    if (md >= 1125 && md <= 1131) return -0.12
    if (date.getMonth() === 0) return -0.18
    return 0
  }
  for (let w = 0; w < 78; w++) {
    const daysAgo = 10 + (77 - w) * 7
    const ws = atDay(daysAgo)
    const trend = 55 + 0.9 * w
    const seasonal = 1 + 0.28 * Math.sin((2 * Math.PI * (w - 6)) / 52) + holidayBoost(ws)
    const noise = 1 + rh.normal(0, 0.07)
    const total = Math.round(trend * seasonal * noise)
    const f = w / 77
    const nj = 0.64 - 0.04 * f
    rows.push({
      weekStart: rel(daysAgo, 0, 0),
      weekIndex: w,
      total,
      byHub: splitInt(total, { NJ01: nj, LA01: 1 - nj }),
      byCarrier: splitInt(total, { USPS: 0.31 - 0.02 * f, UPS: 0.26 + 0.03 * f, FDX: 0.19 - 0.02 * f, DHLE: 0.13, ONT: 0.07 + 0.01 * f, LSO: 0.04 }),
      byRegion: splitInt(total, { Northeast: 0.31 - 0.02 * f, Southeast: 0.2, Midwest: 0.14, Southwest: 0.12 + 0.01 * f, West: 0.23 + 0.01 * f }),
      byChannel: splitInt(total, { shopify: 0.35 - 0.02 * f, etsy: 0.29 - 0.03 * f, amazon: 0.15 + 0.01 * f, ebay: 0.1, manual: 0.09 - 0.02 * f, api: 0.02 + 0.06 * f }),
    })
  }
  out('history_weekly', rows)
}

// ===========================================================================
// 8. Labeled addresses (400: 70% deliverable, 30% problem)
// ===========================================================================
{
  const rl = stream('addresses')
  const recs = []
  const types = ['missing_unit', 'zip_city_mismatch', 'state_mismatch', 'typo_street', 'po_box_restricted', 'incomplete_street', 'invalid_zip']
  const counts = [18, 18, 17, 17, 17, 17, 16]
  const problems = types.flatMap((t, i) => Array(counts[i]).fill(t))
  const good = []
  for (let k = 0; k < 280; k++) good.push(k < 18 ? 'po_box_usps' : k < 34 ? 'case_ok' : k < 44 ? 'no_unit_house' : 'normal')
  const all = rl.shuffle([...problems, ...good])
  all.forEach((kind, k) => {
    let city = pickCity(rl)
    let carrier = rl.w(['USPS', 'UPS', 'FDX', 'DHLE', 'ONT', 'LSO'], [30, 27, 18, 13, 6, 3])
    let a
    let label = 1
    let issueType = null
    let correction = null
    if (kind === 'missing_unit') {
      city = rl.pick(DEST_CITIES.filter((c) => c.zips.some((z) => APT.has(z))))
      a = goodAddress(rl, city)
      a.zip = rl.pick(city.zips.filter((z) => APT.has(z)))
      a.line2 = a.line2 || unitStr(rl)
    } else if (kind === 'zip_city_mismatch') {
      city = rl.pick(DEST_CITIES.filter((c) => MULTI_CITY_STATES.includes(c.state)))
      a = goodAddress(rl, city)
    } else if (kind === 'no_unit_house') {
      city = rl.pick(DEST_CITIES.filter((c) => c.zips.some((z) => !APT.has(z))))
      a = goodAddress(rl, city)
      a.zip = rl.pick(city.zips.filter((z) => !APT.has(z)))
      a.line2 = ''
    } else a = goodAddress(rl, city, { residential: rl.chance(0.85) })
    if (types.includes(kind)) {
      const br = breakAddress(rl, kind, a, city)
      a = br.address
      correction = br.correction
      if (br.carrier) carrier = br.carrier
      label = 0
      issueType = kind
    } else if (kind === 'po_box_usps') {
      a.line1 = `PO Box ${rl.int(100, 9899)}`
      a.line2 = ''
      carrier = rl.w(['USPS', 'DHLE'], [4, 1])
    } else if (kind === 'case_ok') {
      a.line1 = rl.chance(0.5) ? a.line1.toUpperCase() : a.line1.toLowerCase()
      if (rl.chance(0.5)) a.city = a.city.toUpperCase()
    }
    if (carrier === 'ONT' && !WEST_STATES.includes(a.state)) carrier = 'UPS'
    if (carrier === 'LSO' && !LSO_STATES.includes(a.state)) carrier = 'FDX'
    delete a.residential
    recs.push({ id: `ADR-${pad(k + 1, 4)}`, address: a, carrier, label, labelName: label ? 'deliverable' : 'problem', issueType, correction })
  })
  assert(recs.length === 400 && recs.filter((r) => r.label === 1).length === 280, 'labeled addresses 400 / 280')
  out('addresses_labeled', recs)
}

// ===========================================================================
// 9. HS training set (360 titles, 24 codes x 15)
// ===========================================================================
const HS_VOCAB = {
  '6912.00': { n: ['coffee mug', 'mug', 'tea cup', 'bowl', 'serving bowl', 'dinner plate', 'plate', 'platter', 'cup and saucer', 'teapot', 'dessert plate', 'espresso cups'], a: ['handmade', 'ceramic', 'stoneware', 'pottery', 'hand painted', 'glazed', 'speckled', 'porcelain', 'rustic', 'iznik pattern'], m: ['12oz', '10 inch', 'set of 2', 'set of 4', 'dishwasher safe', 'microwave safe', 'gift for her', 'blue', 'white'] },
  '5702.42': { n: ['rug', 'area rug', 'runner rug', 'kilim rug', 'flatweave rug', 'carpet', 'floor rug', 'hallway runner', 'kilim', 'kilim runner'], a: ['handwoven', 'wool', 'kilim', 'handwoven wool', 'wool kilim', 'vintage', 'turkish', 'boho', 'flat weave', 'anatolian', 'hand woven', 'tribal'], m: ['3x5', '2x6', '4x6 ft', '5x8', 'living room', 'geometric', 'natural dyes', 'handwoven', 'pure wool'] },
  '7418.10': { n: ['coffee pot', 'cezve', 'serving tray', 'moscow mule mug', 'saucepan', 'ibrik', 'pitcher', 'ladle', 'pot'], a: ['copper', 'hammered copper', 'handmade', 'solid copper', 'tin lined', 'turkish', 'engraved'], m: ['small', '16oz', 'for stovetop', 'traditional', 'gift'] },
  '0901.21': { n: ['coffee', 'ground coffee', 'coffee beans', 'turkish coffee', 'espresso roast', 'coffee pack'], a: ['roasted', 'fresh roasted', 'finely ground', 'dark roast', 'medium roast', 'cardamom', 'arabica'], m: ['250g', '500g', '1 lb', 'vacuum pack', '8.8 oz'] },
  '3401.11': { n: ['soap', 'soap bar', 'bar soap', 'soap set', 'hand soap bar', 'bath soap'], a: ['olive oil', 'handmade', 'natural', 'laurel', 'goat milk', 'organic', 'cold process', 'lavender'], m: ['set of 3', '4 oz', 'vegan', 'unscented', 'gift set'] },
  '6302.60': { n: ['towel', 'bath towel', 'hand towel', 'beach towel', 'peshtemal', 'kitchen towel', 'tea towel', 'washcloth'], a: ['turkish cotton', 'cotton', 'terry', 'waffle', 'linen blend', 'organic cotton', 'fringed'], m: ['set of 2', 'oversized', 'quick dry', 'striped', '100% cotton'] },
  '7113.11': { n: ['necklace', 'ring', 'earrings', 'bracelet', 'pendant', 'charm', 'anklet'], a: ['sterling silver', '925 silver', 'silver', 'filigree', 'evil eye', 'handmade silver', 'oxidized silver'], m: ['for women', 'dainty', 'minimalist', 'adjustable', 'gift'] },
  '4202.31': { n: ['wallet', 'bifold wallet', 'card holder', 'passport wallet', 'coin purse', 'money clip wallet', 'cardholder'], a: ['leather', 'genuine leather', 'full grain leather', 'handmade leather', 'slim', 'vegetable tanned'], m: ['for men', 'rfid', 'personalized', 'brown', 'minimalist'] },
  '6304.92': { n: ['pillow cover', 'cushion cover', 'throw pillow cover', 'cushion cover', 'lumbar pillow cover', 'pillow sham', 'cushion covers', 'throw pillow sham'], a: ['decorative', 'embroidered', 'suzani', 'cotton', 'boho', 'velvet', 'printed', 'linen look', 'handmade'], m: ['18x18', '20x20', '12x20', 'with zipper', 'set of 2', 'for sofa', '24x24'] },
  '4420.10': { n: ['figurine', 'ornament', 'statue', 'sculpture', 'carving', 'bird figurine', 'decor piece'], a: ['wooden', 'olive wood', 'hand carved', 'wood', 'carved', 'walnut'], m: ['small', 'rustic', 'shelf decor', 'handmade', 'christmas'] },
  '7013.37': { n: ['tea glasses', 'drinking glass', 'tumbler', 'glass cups', 'water glasses', 'juice glass'], a: ['turkish', 'hand blown', 'glass', 'crystal clear', 'gold rim', 'etched'], m: ['set of 6', 'set of 4', '8oz', 'with saucers', 'vintage style'] },
  '3406.00': { n: ['candle', 'scented candle', 'taper candles', 'pillar candle', 'tealight candles', 'jar candle'], a: ['soy wax', 'beeswax', 'hand poured', 'natural', 'lavender', 'vanilla'], m: ['8oz', 'pair', 'set of 12', 'long burning', 'gift'] },
  '6117.10': { n: ['shawl', 'scarf', 'pashmina', 'wrap', 'stole', 'neck scarf'], a: ['silk blend', 'cotton', 'knitted', 'wool blend', 'soft', 'lightweight', 'oversized'], m: ['for women', 'paisley', 'winter', 'fringed', 'gift'] },
  '9503.00': { n: ['toy', 'stacking toy', 'plush toy', 'rattle', 'puzzle', 'doll', 'teddy bear', 'amigurumi'], a: ['wooden', 'crochet', 'handmade', 'montessori', 'educational', 'knitted', 'baby'], m: ['for toddlers', 'organic', 'gift', '3+ years', 'animal'] },
  '4911.91': { n: ['art print', 'poster', 'wall art', 'print', 'photo print', 'illustration print', 'map print'], a: ['botanical', 'vintage', 'istanbul', 'minimalist', 'abstract', 'giclee'], m: ['11x14', 'a3', '8x10', 'unframed', 'home decor'] },
  '6109.10': { n: ['t-shirt', 'tee', 'tshirt', 'graphic tee', 'crew neck tee', 'shirt'], a: ['cotton', 'organic cotton', 'unisex', 'printed', 'vintage wash', '100% cotton'], m: ['short sleeve', 'size m', 'size l', 'oversized', 'gift'] },
  '1509.20': { n: ['olive oil', 'extra virgin olive oil', 'evoo', 'cooking oil', 'olive oil tin'], a: ['extra virgin', 'cold pressed', 'early harvest', 'organic', 'aegean', 'first press'], m: ['500ml', '1l', '750 ml', 'bottle', 'tin'] },
  '1704.90': { n: ['turkish delight', 'lokum', 'candy', 'sweets', 'nougat', 'fruit jelly candy', 'halva'], a: ['assorted', 'pistachio', 'rose', 'handmade', 'traditional', 'hazelnut'], m: ['gift box', '500g', '1 lb', 'box of 24', 'sampler'] },
  '3304.99': { n: ['face cream', 'serum', 'moisturizer', 'body butter', 'face oil', 'lip balm', 'night cream'], a: ['rose', 'argan', 'natural', 'organic', 'hydrating', 'anti aging', 'vitamin c'], m: ['50ml', '1 oz', 'for dry skin', 'vegan', 'travel size'] },
  '8306.29': { n: ['wall hanging', 'ornament', 'decor', 'bell', 'hamsa', 'figurine', 'wall decor'], a: ['brass', 'metal', 'hammered brass', 'iron', 'bronze finish', 'evil eye'], m: ['home decor', 'handmade', 'small', 'protection', 'vintage'] },
  '9405.21': { n: ['table lamp', 'desk lamp', 'bedside lamp', 'mosaic lamp', 'night light', 'lamp'], a: ['mosaic', 'turkish', 'led', 'ottoman', 'glass', 'handmade'], m: ['with bulb', 'usb', 'colorful', 'boho', 'rechargeable'] },
  '6702.90': { n: ['artificial flowers', 'faux stem', 'fake plant', 'silk flowers', 'faux branch', 'flower bouquet', 'dried look stems'], a: ['artificial', 'faux', 'silk', 'realistic', 'eucalyptus', 'olive'], m: ['set of 3', '24 inch', 'for vase', 'wedding decor', 'greenery'] },
  '7117.19': { n: ['bracelet', 'earrings', 'necklace', 'hoop earrings', 'choker', 'anklet', 'statement necklace'], a: ['beaded', 'gold plated', 'fashion', 'costume', 'brass', 'boho', 'crystal'], m: ['for women', 'layered', 'adjustable', 'set', 'gift'] },
  '4819.20': { n: ['gift box', 'boxes', 'mailer box', 'packaging box', 'shipping box', 'box set'], a: ['kraft', 'folding', 'cardboard', 'paperboard', 'white', 'rigid'], m: ['10 pcs', 'set of 20', 'small', 'with lid', 'bulk'] },
}
export const HARD_HS_TITLE = 'handwoven wool kilim pillow case 16x16'
{
  const rt = stream('hs')
  const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase())
  const rows = []
  const seen = new Set()
  for (const code of Object.keys(HS_VOCAB)) {
    const v = HS_VOCAB[code]
    let made = 0
    let guard = 0
    while (made < 15 && guard++ < 500) {
      const adjs = rt.shuffle(v.a).slice(0, rt.w([1, 2], [6, 4]))
      const noun = rt.pick(v.n)
      const mods = rt.chance(0.7) ? rt.shuffle(v.m).slice(0, rt.w([1, 2], [7, 3])) : []
      let t = [...adjs, noun, ...mods].join(' ')
      if (rt.chance(0.14)) t = t.replace('set of ', 'set/').replace(' with ', ' w/ ').replace(' inch', 'in').replace('for women', '4 women')
      if (rt.chance(0.15)) {
        const words = t.split(' ')
        const idx = words.map((w, i) => [w, i]).filter(([w]) => /^[a-z]{5,}$/.test(w))
        if (idx.length) {
          const [w, i] = rt.pick(idx)
          words[i] = typoWord(rt, w)
          t = words.join(' ')
        }
      }
      t = rt.chance(0.45) ? titleCase(t) : t.toLowerCase()
      const key = t.toLowerCase()
      if (seen.has(key) || key === HARD_HS_TITLE) continue
      seen.add(key)
      rows.push({ id: `HST-${pad(rows.length + 1, 4)}`, title: t, hsCode: code, source: rt.w(['catalog', 'customs_history', 'marketplace'], [4, 3, 3]) })
      made++
    }
    assert(made === 15, `hs vocab for ${code} too small`)
  }
  out('hs_training', rt.shuffle(rows).map((r, i) => ({ ...r, id: `HST-${pad(i + 1, 4)}` })))
}

// ===========================================================================
// 10. Pricing recommendations (initial; the app recomputes)
// ===========================================================================
{
  const rp = stream('pricing')
  const LANE_SVCS = [['UPS', 'GROUND'], ['UPS', '2DA'], ['FDX', 'HOME'], ['FDX', 'GROUND'], ['USPS', 'GA'], ['USPS', 'PM'], ['DHLE', 'EXP']]
  const REP_ZONE = { near: [3, 4, 2], mid: [5, 6], far: [7, 8] }
  const refPackage = { lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: 2 }
  const lanes = []
  const last56 = shipments.filter((s, i) => dAgo[i] < 56 && s.status !== 'voided')
  for (const hub of ['NJ01', 'LA01']) {
    for (const [carrier, service] of LANE_SVCS) {
      for (const group of ['near', 'mid', 'far']) {
        const allZips = CITIES.flatMap((c) => c.zips.map((z) => ({ z, c })))
        const zone = REP_ZONE[group].find((zn) => allZips.some(({ z }) => zoneFor(hub, z) === zn))
        const cityZip = allZips.find(({ z }) => zoneFor(hub, z) === zone)
        const to = { zip: cityZip.z, state: cityZip.c.state, residential: service !== 'GROUND' || carrier !== 'FDX' }
        const q = quote(carrier, service, hub, to, refPackage, 50, NOW)
        const lane = laneKey(hub, carrier, service, zone)
        const vol = last56.filter((s) => s.hub === hub && s.carrier === carrier && s.service === service && zoneGroup(s.zone) === group).length
        const baselineVolume = Math.round((vol / 8) * 10) / 10
        const growth = rp.float(1.02, 1.42, 2)
        const forecast4w = Math.round(Math.max(0.5, baselineVolume) * 4 * growth * 10) / 10
        const marketRef = round2(q.total * rp.float(0.95, 1.12))
        const minM = 0.12
        const maxM = 0.28
        const demandFactor = Math.min(1.5, Math.max(0.7, forecast4w / 4 / Math.max(0.5, baselineVolume)))
        const targetMargin = maxM + (minM - maxM) * ((demandFactor - 0.7) / 0.8)
        let price = q.cost * (1 + targetMargin)
        price = Math.min(price, marketRef * 1.05)
        price = Math.max(price, q.cost * (1 + minM))
        price = round2(price)
        lanes.push({
          lane, hub, carrier, service, zoneGroup: group, refZone: zone, refZip: to.zip,
          baselineVolume, forecast4w, cost: q.cost, currentPrice: q.sellPrice, marketRef,
          recommendedPrice: price, range: [round2(price * 0.96), round2(price * 1.04)],
          changePct: Math.round((price / q.sellPrice - 1) * 1000) / 1000, status: 'none',
        })
      }
    }
  }
  const byVol = lanes.slice().sort((a, b) => b.baselineVolume - a.baselineVolume || a.lane.localeCompare(b.lane))
  byVol.slice(0, 6).forEach((l) => (l.status = 'proposed'))
  byVol[6].status = 'rejected'
  byVol[6].rejectedReason = L('Pazar payı hedefi nedeniyle mevcut fiyat korunuyor', 'Current price kept for market share target')
  byVol[7].status = 'expired'
  out('pricing_recs', { generatedAt: rel(0, 6, 30), modelVersion: 'price-ai v1.2', forecastVersion: 'forecast v2.1', refPackage, marginRange: { min: 0.12, max: 0.28 }, lanes })
}

// ===========================================================================
// 11. Stores, rules, API keys, webhooks, sync logs
// ===========================================================================
const ORDERS_BY_ID = Object.fromEntries(orders.map((o) => [o.id, o]))
function orders30(ch) {
  return orders.filter((o) => o.channel === ch && dateOf(o.createdAt) >= atDay(30)).length
}
const STATUS_MAP = {
  shopify: [['unfulfilled', 'awaiting_shipment'], ['partially_fulfilled', 'awaiting_shipment'], ['fulfilled', 'shipped'], ['cancelled', 'cancelled']],
  etsy: [['paid', 'awaiting_shipment'], ['shipped', 'shipped'], ['completed', 'delivered'], ['canceled', 'cancelled']],
  amazon: [['Unshipped', 'awaiting_shipment'], ['PartiallyShipped', 'awaiting_shipment'], ['Shipped', 'shipped'], ['Canceled', 'cancelled']],
  ebay: [['NOT_STARTED', 'awaiting_shipment'], ['IN_PROGRESS', 'labeled'], ['FULFILLED', 'shipped'], ['CANCELLED', 'cancelled']],
  woocommerce: [['processing', 'awaiting_shipment'], ['on-hold', 'on_hold'], ['completed', 'shipped'], ['cancelled', 'cancelled']],
}
const storeSettings = (ch) => ({
  autoPull: ch !== 'woocommerce', frequency: ch === 'amazon' ? '1h' : '15m', writeBackTracking: true,
  statusMap: STATUS_MAP[ch].map(([external, internal]) => ({ external, internal })), skuMap: [],
})
out('stores', [
  { id: 'ST-SHOPIFY', channel: 'shopify', name: 'Anatolia Home', shopDomain: 'anatolia-home.myshopify.com', status: 'connected', connectedAt: rel(205, 13, 12), lastSyncAt: rel(0, 8, 45), orders30d: orders30('shopify'), scopes: ['read_orders', 'read_products', 'write_fulfillments'], settings: storeSettings('shopify') },
  { id: 'ST-ETSY', channel: 'etsy', name: 'AnatoliaHomeCraft', shopName: 'AnatoliaHomeCraft', status: 'connected', connectedAt: rel(203, 10, 40), lastSyncAt: rel(0, 8, 40), orders30d: orders30('etsy'), scopes: ['transactions_r', 'listings_r', 'shops_r'], settings: storeSettings('etsy') },
  { id: 'ST-AMAZON', channel: 'amazon', name: 'Anatolia Home (Amazon US)', sellerId: 'A2K8QZ4M7T1XWP', marketplace: 'US', status: 'connected', connectedAt: rel(150, 9, 5), lastSyncAt: rel(0, 8, 0), orders30d: orders30('amazon'), scopes: ['orders', 'feeds', 'listings'], settings: storeSettings('amazon') },
  { id: 'ST-EBAY', channel: 'ebay', name: 'anatolia_home', username: 'anatolia_home', status: 'connected', connectedAt: rel(120, 15, 30), lastSyncAt: rel(0, 8, 30), orders30d: orders30('ebay'), scopes: ['sell.fulfillment', 'sell.inventory.readonly'], settings: storeSettings('ebay') },
  { id: 'ST-WOO', channel: 'woocommerce', name: null, siteUrl: null, status: 'not_connected', connectedAt: null, lastSyncAt: null, orders30d: 0, scopes: [], settings: storeSettings('woocommerce') },
])

out('rules', [
  {
    id: 'RUL-001', priority: 1, active: true, name: L('Değer > $250 ise sigorta ve imza', 'Value > $250: insurance and signature'),
    conditions: [{ field: 'declaredValue', op: 'gt', value: 250 }], actions: [{ type: 'add_insurance' }, { type: 'require_signature' }],
    createdAt: rel(150, 11, 0), updatedAt: rel(40, 16, 20), lastTriggeredAt: rel(1, 14, 5), triggerCount: shipments.filter((s) => s.declaredValue > 250).length,
  },
  {
    id: 'RUL-002', priority: 2, active: true, name: L('HI ve AK için USPS Priority', 'USPS Priority for HI and AK'),
    conditions: [{ field: 'destState', op: 'in', value: ['HI', 'AK'] }], actions: [{ type: 'force_service', carrier: 'USPS', service: 'PM' }],
    createdAt: rel(148, 11, 20), updatedAt: rel(148, 11, 20), lastTriggeredAt: rel(9, 10, 44), triggerCount: shipments.filter((s) => ['HI', 'AK'].includes(s.to.state)).length,
  },
  {
    id: 'RUL-003', priority: 3, active: true, name: L('Amazon siparişleri için 2 gün içinde teslim eden en ucuz servis', 'Amazon orders: cheapest service delivering within 2 days'),
    conditions: [{ field: 'channel', op: 'eq', value: 'amazon' }], actions: [{ type: 'max_transit_days', value: 2 }, { type: 'select_strategy', value: 'cheapest' }],
    createdAt: rel(140, 9, 10), updatedAt: rel(60, 12, 0), lastTriggeredAt: rel(0, 7, 12), triggerCount: orders.filter((o) => o.channel === 'amazon').length,
  },
  {
    id: 'RUL-004', priority: 4, active: true, name: L("Batı eyaletleri LA01'den", 'Western states ship from LA01'),
    conditions: [{ field: 'destState', op: 'in', value: ['CA', 'OR', 'WA', 'NV', 'AZ', 'UT', 'CO', 'ID', 'NM', 'HI', 'AK'] }], actions: [{ type: 'assign_hub', hub: 'LA01' }],
    createdAt: rel(130, 15, 45), updatedAt: rel(130, 15, 45), lastTriggeredAt: rel(0, 8, 2), triggerCount: shipments.filter((s) => s.hub === 'LA01').length,
  },
])

out('api_keys', [
  { id: 'KEY-001', name: 'ERP integration', env: 'live', prefix: 'kp_live_7Hq2', last4: '9f3a', masked: 'kp_live_7Hq2••••••••••••••••9f3a', scopes: ['orders:read', 'orders:write', 'shipments:write', 'rates:read', 'tracking:read'], createdAt: rel(96, 10, 12), lastUsedAt: rel(0, 8, 51), createdBy: 'Elif Aydın', status: 'active' },
  { id: 'KEY-002', name: 'Staging tests', env: 'test', prefix: 'kp_test_Lm81', last4: 'c07e', masked: 'kp_test_Lm81••••••••••••••••c07e', scopes: ['rates:read', 'shipments:write', 'tracking:read', 'webhooks:manage'], createdAt: rel(61, 14, 3), lastUsedAt: rel(3, 17, 29), createdBy: 'Demo Kullanıcı', status: 'active' },
])

{
  const rwh = stream('webhooks')
  const endpoints = [
    { id: 'WH-01', url: 'https://hooks.anatoliahome.com/kargopazar', events: ['shipment.created', 'shipment.delivered', 'tracking.updated'], status: 'active', secretMasked: 'whsec_••••3f9a', createdAt: rel(95, 11, 0), lastDeliveryAt: null },
    { id: 'WH-02', url: 'https://erp.anatoliahome.com/api/shipping-events', events: ['adjustment.created', 'order.imported', 'shipment.created'], status: 'active', secretMasked: 'whsec_••••81bd', createdAt: rel(58, 9, 40), lastDeliveryAt: null },
  ]
  const recentShips = shipments.filter((s, i) => dAgo[i] <= 12).sort((a, b) => a._date - b._date)
  const deliveries = []
  for (let k = 0; k < 30; k++) {
    const s = recentShips[Math.floor((k * recentShips.length) / 30)]
    const ep = k % 3 === 2 ? endpoints[1] : endpoints[0]
    const event = ep.id === 'WH-01' ? rwh.w(['shipment.created', 'tracking.updated', 'shipment.delivered'], [4, 4, 2]) : rwh.w(['shipment.created', 'order.imported', 'adjustment.created'], [5, 4, 1])
    const fail = [7, 19, 26].includes(k)
    const at = addMin(s._date, rwh.int(1, 90))
    deliveries.push({
      id: `DLV-${pad(4101 + k, 5)}`, endpointId: ep.id, event, at: relOf(at > NOW ? addMin(NOW, -5) : at),
      status: fail ? 500 : 200, attempts: fail ? 3 : 1, durationMs: fail ? rwh.int(4800, 5100) : rwh.int(80, 420), result: fail ? 'failed' : 'delivered',
      payload: { id: `evt_${digits(rwh, 10)}`, type: event, data: { shipmentId: s.id, trackingNo: s.trackingNo, carrier: s.carrier, status: s.status } },
    })
  }
  for (const ep of endpoints) {
    const last = deliveries.filter((d) => d.endpointId === ep.id).pop()
    ep.lastDeliveryAt = last ? last.at : null
  }
  out('webhooks', { endpoints, deliveries })
}

{
  const rsl = stream('sync')
  const logs = []
  const mk = ['shopify', 'etsy', 'amazon', 'ebay']
  const pushed = orders.filter((o) => o.trackingSyncedAt).sort((a, b) => dateOf(a.trackingSyncedAt) - dateOf(b.trackingSyncedAt))
  for (const o of pushed) {
    const s = shipments.find((x) => x.id === o.shipmentId)
    logs.push({ at: dateOf(o.trackingSyncedAt), store: o.channel, op: 'tracking_push', result: 'success', orderId: o.id, trackingNo: s.trackingNo, detail: L(`Takip no ${o.channel === 'shopify' ? 'Shopify' : o.channel === 'etsy' ? 'Etsy' : o.channel === 'amazon' ? 'Amazon' : 'eBay'}'a yazıldı: ${s.trackingNo}`, `Tracking number written to ${o.channel === 'shopify' ? 'Shopify' : o.channel === 'etsy' ? 'Etsy' : o.channel === 'amazon' ? 'Amazon' : 'eBay'}: ${s.trackingNo}`) })
  }
  const mkName = { shopify: 'Shopify', etsy: 'Etsy', amazon: 'Amazon', ebay: 'eBay' }
  while (logs.length < 71) {
    const d = rsl.int(0, 10)
    const at = d === 0 ? atDay(0, rsl.int(6, 8), rsl.int(0, 59)) : atDay(d, rsl.int(7, 22), rsl.int(0, 59))
    const store = rsl.pick(mk)
    const op = rsl.w(['order_pull', 'status_update', 'inventory'], [6, 3, 2])
    const n = rsl.w([0, 1, 2, 3], [3, 4, 2, 1])
    const detail = op === 'order_pull' ? L(`${mkName[store]}: ${n} yeni sipariş çekildi`, `${mkName[store]}: ${n} new orders pulled`)
      : op === 'status_update' ? L(`${mkName[store]}: ${rsl.int(1, 6)} sipariş durumu güncellendi`, `${mkName[store]}: ${rsl.int(1, 6)} order statuses updated`)
      : L(`${mkName[store]}: ${rsl.int(4, 40)} SKU stok bilgisi eşitlendi`, `${mkName[store]}: stock synced for ${rsl.int(4, 40)} SKUs`)
    logs.push({ at, store, op, result: 'success', detail })
  }
  const warn = [
    { store: 'ebay', op: 'tracking_push', detail: L('eBay: API rate limit, 60 sn sonra yeniden denendi, başarılı', 'eBay: API rate limit, retried after 60 s, succeeded') },
    { store: 'shopify', op: 'order_pull', detail: L('Shopify: 1 siparişte telefon alanı boş, sipariş yine de alındı', 'Shopify: phone missing on 1 order, order imported anyway') },
    { store: 'amazon', op: 'order_pull', detail: L('Amazon: yanıt süresi 8,2 sn, zaman aşımı eşiğine yakın', 'Amazon: response took 8.2 s, close to the timeout threshold') },
    { store: 'etsy', op: 'inventory', detail: L('Etsy: 2 SKU eşleşmedi, SKU eşleme tablosunu kontrol edin', 'Etsy: 2 SKUs not matched, check the SKU mapping table') },
    { store: 'ebay', op: 'status_update', detail: L('eBay: 1 sipariş zaten kapatılmış, güncelleme atlandı', 'eBay: 1 order already closed, update skipped') },
    { store: 'shopify', op: 'tracking_push', detail: L('Shopify: fulfillment zaten mevcut, takip no güncellendi', 'Shopify: fulfillment already existed, tracking number updated') },
  ]
  warn.forEach((w, k) => logs.push({ at: atDay(1 + k, 10 + k, 5 * k), result: 'warning', ...w }))
  const errShip = shipments.filter((s) => s.orderId && s.status === 'label_created')
  const errs = [
    { store: 'ebay', op: 'tracking_push', detail: L('eBay: API rate limit (429), takip no yazılamadı', 'eBay: API rate limit (429), tracking number not written'), orderId: errShip[0]?.orderId, trackingNo: errShip[0]?.trackingNo },
    { store: 'amazon', op: 'order_pull', detail: L('Amazon: SP-API erişim belirteci süresi doldu (401)', 'Amazon: SP-API access token expired (401)') },
    { store: 'etsy', op: 'status_update', detail: L('Etsy: sipariş kaydı bulunamadı (404), durum güncellenemedi', 'Etsy: receipt not found (404), status not updated') },
  ]
  errs.forEach((e, k) => logs.push({ at: atDay(k === 0 ? 0 : k, k === 0 ? 7 : 15, 20 + k), result: 'error', retryable: true, attempts: 1, ...e }))
  logs.sort((a, b) => a.at - b.at)
  assert(logs.length === 80, `sync logs must be 80, got ${logs.length}`)
  out('sync_logs', logs.map((l, k) => ({ id: `SYN-${pad(k + 1, 4)}`, ...l, at: relOf(l.at) })))
}

// ===========================================================================
// 12. Integration test suites (spec 9.4) and 2 past runs
// ===========================================================================
{
  const S = (id, tr, en, steps, expTr, expEn, engine, input) => ({ id, name: L(tr, en), steps: steps.map(([a, b]) => L(a, b)), expected: L(expTr, expEn), engine, input: input || null })
  const uk = [
    S('UK-01', 'Evri toplama talebi oluşturma', 'Create Evri collection request', [['Toplama adresini gir', 'Enter collection address'], ['Evri adaptörüne talep gönder', 'Send request to Evri adapter'], ['Toplama referansını kaydet', 'Store collection reference']], 'Toplama referansı döner', 'Collection reference returned', 'carrier_adapter', { carrier: 'EVRI', op: 'pickup' }),
    S('UK-02', 'UK posta kodu doğrulama', 'UK postcode validation', [['Küçük harfli posta kodu gir (sw1a 1aa)', 'Enter lower case postcode (sw1a 1aa)'], ['Normalize et', 'Normalize'], ['Regex ile doğrula', 'Validate with regex']], "Posta kodu 'SW1A 1AA' olarak normalize edilir ve geçerli sayılır", "Postcode normalized to 'SW1A 1AA' and accepted", 'postcode', { country: 'GB', value: 'sw1a 1aa', expect: 'SW1A 1AA' }),
    S('UK-03', 'Konsolidasyon kabul olayı', 'Consolidation receipt event', [['LHR noktasında koli okut', 'Scan parcel at LHR point'], ['Aşama olayını üret', 'Emit stage event']], "Gönderi 'Konsolidasyon' aşamasına geçer", "Shipment moves to 'Consolidation' stage", 'intl_stage', { from: 'origin_received', to: 'consolidation' }),
    S('UK-04', 'DHL Express hava ayağı etiketi', 'DHL Express air leg label', [['MAWB bilgisi ile etiket iste', 'Request label with MAWB data'], ['PDF etiketi al', 'Receive PDF label']], '10 haneli DHL Express takip numarası döner', '10 digit DHL Express tracking number returned', 'carrier_adapter', { carrier: 'DHLX', op: 'label' }),
    S('UK-05', 'Takip olay eşleme (DHL olay kodları)', 'Tracking event mapping (DHL event codes)', [['PU, PL, DF, AR, WC, CC olaylarını gönder', 'Send PU, PL, DF, AR, WC, CC events'], ['KargoPazar aşamalarına eşle', 'Map to KargoPazar stages']], 'Tüm olay kodları bir aşamaya eşlenir', 'Every event code maps to a stage', 'event_map', { codes: ['PU', 'PL', 'DF', 'AR', 'WC', 'CC'] }),
    S('UK-06', 'Ticari fatura veri aktarımı', 'Commercial invoice data transfer', [['Kalemleri ve HS kodlarını topla', 'Collect items and HS codes'], ['Fatura verisini üret', 'Build invoice data']], 'Fatura toplamı kalem toplamına eşit', 'Invoice total equals item total', 'docs', { doc: 'commercial_invoice' }),
    S('UK-07', 'CN23 üretimi', 'CN23 generation', [['Değeri 400 USD üstü gönderi seç', 'Pick shipment above USD 400'], ['CN23 PDF üret', 'Generate CN23 PDF']], 'CN23 seçilir ve PDF oluşur', 'CN23 selected and PDF generated', 'docs', { doc: 'cn23' }),
    S('UK-08', 'ABD gümrük manifest satırı üretimi', 'US customs manifest line generation', [['HAWB satırını oluştur', 'Build HAWB line'], ['Zorunlu alanları kontrol et', 'Check mandatory fields']], 'Satırda alıcı, içerik, HS, değer ve menşe dolu', 'Line has consignee, contents, HS, value and origin', 'manifest', null),
    S('UK-09', 'Uçtan uca aşama ilerlemesi', 'End to end stage progression', [['Gönderi oluştur', 'Create shipment'], ['10 aşamayı sırayla ilerlet', 'Advance through the 10 stages'], ['Son mil etiketlerini kontrol et', 'Check last mile labels']], "Gönderi 'Tamamlandı' aşamasına ulaşır", "Shipment reaches 'Completed'", 'intl_stage', { from: 'created', to: 'completed' }),
  ]
  const tr = [
    S('TR-01', 'İstanbul teslim noktası kabulü', 'Istanbul drop off point intake', [['IST noktasında koli okut', 'Scan parcel at IST point'], ['Kabul olayını üret', 'Emit intake event']], "Gönderi 'Menşe teslim noktasında kabul' aşamasına geçer", "Shipment moves to 'Received at origin point'", 'intl_stage', { from: 'created', to: 'origin_received' }),
    S('TR-02', 'TR adres formatı (il/ilçe) doğrulama', 'TR address format (province/district) validation', [['İl ve ilçe seç', 'Select province and district'], ['Zorunlu alanları doğrula', 'Validate mandatory fields']], 'Eksik ilçe alanı hata verir, tam adres geçer', 'Missing district fails, complete address passes', 'address_format', { country: 'TR' }),
    S('TR-03', 'TR posta kodu doğrulama', 'TR postal code validation', [['34394 gir', 'Enter 34394'], ['Regex ile doğrula', 'Validate with regex']], 'Beş haneli posta kodu kabul edilir', 'Five digit postal code accepted', 'postcode', { country: 'TR', value: '34394', expect: '34394' }),
    S('TR-04', 'TRY → USD değer dönüşümü', 'TRY to USD value conversion', [['12.500 TRY beyan değeri gir', 'Enter declared value 12,500 TRY'], ['Demo kuru ile çevir', 'Convert with demo rate']], 'Sonuç 2 ondalığa yuvarlanır: 300,00 USD', 'Result rounded to 2 decimals: USD 300.00', 'fx', { amount: 12500, currency: 'TRY', expect: 300 }),
    S('TR-05', 'IST-JFK MAWB eşleme', 'IST-JFK MAWB mapping', [['TK 001 uçuşuna MAWB ata', 'Assign MAWB to flight TK 001'], ['HAWB listesini bağla', 'Link HAWB list']], "MAWB '235-' önekiyle başlar ve tüm HAWB'lar bağlanır", "MAWB starts with '235-' and all HAWBs are linked", 'manifest', { route: 'IST-JFK' }),
    S('TR-06', 'DHL Express hava ayağı etiketi (IST)', 'DHL Express air leg label (IST)', [['Etiket iste', 'Request label'], ['PDF etiketi al', 'Receive PDF label']], 'Takip numarası ve PDF döner', 'Tracking number and PDF returned', 'carrier_adapter', { carrier: 'DHLX', op: 'label' }),
    S('TR-07', 'CN23 üretimi (TR menşe)', 'CN23 generation (TR origin)', [['Kalemleri seç', 'Select items'], ['CN23 üret', 'Generate CN23']], 'Menşe TR ve HS kodları belgede yer alır', 'Origin TR and HS codes appear on the document', 'docs', { doc: 'cn23' }),
    S('TR-08', 'ABD gümrük manifest satırı (TR)', 'US customs manifest line (TR)', [['HAWB satırını oluştur', 'Build HAWB line']], 'Zorunlu alanların tamamı dolu', 'All mandatory fields present', 'manifest', null),
    S('TR-09', 'Uçtan uca aşama ilerlemesi (TR)', 'End to end stage progression (TR)', [['Gönderi oluştur', 'Create shipment'], ['Aşamaları ilerlet', 'Advance stages']], "'Tamamlandı' aşamasına ulaşılır, geçici etiket 'Değiştirildi' olur", "Reaches 'Completed', temporary label becomes 'Replaced'", 'intl_stage', { from: 'created', to: 'completed' }),
  ]
  const us = CARRIERS.flatMap((c, i) => [
    S(`US-${pad(i * 2 + 1, 2)}`, `${c.name} etiket oluşturma`, `${c.name} label creation`, [['Fiyat al', 'Get rate'], ['Etiket oluştur', 'Create label'], ['Takip no formatını doğrula', 'Validate tracking number format']], 'Taşıyıcı formatında takip numarası döner', 'Tracking number in carrier format returned', 'rate_label', { carrier: c.code, service: c.services[0].code }),
    S(`US-${pad(i * 2 + 2, 2)}`, `${c.name} etiket iptali`, `${c.name} label void`, [['Etiket oluştur', 'Create label'], ['İptal et', 'Void'], ['İade kaydını kontrol et', 'Check refund record']], "Etiket 'İptal' durumuna geçer ve iade kaydı oluşur", "Label becomes 'Voided' and a refund record is created", 'void', { carrier: c.code }),
  ])
  const mkt = ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce'].flatMap((m, i) => {
    const nm = { shopify: 'Shopify', etsy: 'Etsy', amazon: 'Amazon', ebay: 'eBay', woocommerce: 'WooCommerce' }[m]
    return [
      S(`MP-${pad(i * 2 + 1, 2)}`, `${nm} sipariş çekme`, `${nm} order pull`, [['Bağlantıyı doğrula', 'Verify connection'], ['Yeni siparişleri çek', 'Pull new orders'], ['Adres doğrulamadan geçir', 'Run address validation']], 'Siparişler adres skoru ile listeye eklenir', 'Orders are added with an address score', 'sync', { channel: m, op: 'order_pull' }),
      S(`MP-${pad(i * 2 + 2, 2)}`, `${nm} takip no geri yazma`, `${nm} tracking write back`, [['Etiket oluştur', 'Create label'], ['Takip numarasını gönder', 'Push tracking number'], ['Senkron kaydını kontrol et', 'Check sync log']], 'Senkron kaydına başarılı satır düşer', 'A success line is written to the sync log', 'sync', { channel: m, op: 'tracking_push' }),
    ]
  })
  const suites = [
    { id: 'SUITE-UK', name: L('Uluslararası ilk mil (UK)', 'International first mile (UK)'), category: 'international', scenarios: uk },
    { id: 'SUITE-TR', name: L('Uluslararası ilk mil (TR)', 'International first mile (TR)'), category: 'international', scenarios: tr },
    { id: 'SUITE-US', name: L('ABD iç hat taşıyıcıları', 'US domestic carriers'), category: 'carriers', scenarios: us },
    { id: 'SUITE-MP', name: L('Pazaryerleri', 'Marketplaces'), category: 'marketplaces', scenarios: mkt },
  ]
  assert(uk.length === 9 && tr.length === 9 && us.length === 16 && mkt.length === 10, 'test suite sizes')
  const rtst = stream('tests')
  const allSc = suites.flatMap((s) => s.scenarios)
  const fails = {
    'UK-02': { error: L("Beklenen 'SW1A 1AA', alınan 'sw1a 1aa'", "Expected 'SW1A 1AA', got 'sw1a 1aa'"), fixNote: L('UK posta kodu küçük harf girişinde normalize edilmiyordu; doğrulamadan önce büyük harfe çevirme ve boşluk düzeltme eklendi', 'UK postcode was not normalized for lower case input; upper casing and space normalization added before validation') },
    'UK-05': { error: L("DHL olay kodu 'WC' için eşleme bulunamadı", "No mapping found for DHL event code 'WC'"), fixNote: L("'WC' (With delivery courier) olayı 'Teslimatta' aşamasına eşlendi", "'WC' (With delivery courier) event mapped to the 'Out for delivery' stage") },
    'TR-04': { error: L('Beklenen 300,00, alınan 300,0048', 'Expected 300.00, got 300.0048'), fixNote: L('Kur dönüşümünde 4 ondalık yerine 2 ondalığa yuvarlama uygulandı', 'Currency conversion now rounds to 2 decimals instead of 4') },
  }
  const run1 = allSc.map((sc) => fails[sc.id]
    ? { scenarioId: sc.id, result: 'failed', durationMs: rtst.int(220, 620), error: fails[sc.id].error, fixNote: fails[sc.id].fixNote, fixedIn: 'v0.9.2' }
    : { scenarioId: sc.id, result: 'passed', durationMs: rtst.int(200, 600) })
  const run2 = allSc.map((sc) => ({ scenarioId: sc.id, result: 'passed', durationMs: rtst.int(200, 600) }))
  for (const sc of allSc) {
    sc.lastResult = 'passed'
    sc.lastDurationMs = run2.find((r) => r.scenarioId === sc.id).durationMs
  }
  const runs = [
    { id: 'RUN-001', startedAt: rel(44, 14, 10), finishedAt: rel(44, 14, 26), env: 'staging', version: 'v0.9.1', suiteIds: suites.map((s) => s.id), triggeredBy: 'Burak Şahin', results: run1, passed: run1.filter((r) => r.result === 'passed').length, failed: 3, skipped: 0, passRate: Math.round((run1.filter((r) => r.result === 'passed').length / run1.length) * 1000) / 1000 },
    { id: 'RUN-002', startedAt: rel(37, 10, 2), finishedAt: rel(37, 10, 18), env: 'staging', version: 'v0.9.2', suiteIds: suites.map((s) => s.id), triggeredBy: 'Burak Şahin', results: run2, passed: run2.length, failed: 0, skipped: 0, passRate: 1 },
  ]
  out('test_suites', { suites, runs })
}

// ===========================================================================
// 13. Notifications, system, roadmap, customers, audit log, batches
// ===========================================================================
{
  const awaitingLow = orders.filter((o) => o.status === 'awaiting_shipment' && o.addressCheck.score < 70).length
  assert(awaitingLow === 9, `awaiting orders with score < 70 must be 9, got ${awaitingLow}`)
  const a77 = adjustments.find((a) => a.shipmentId === 'SHP-20877')
  const labelVoided = shipments.filter((s) => s.status === 'voided').sort((a, b) => b._date - a._date)[0]
  const autoTop = walletList.filter((t) => t.method === 'auto').pop()
  const N = (id, at, read, type, title, body, link) => ({ id, at, read, type, title, body, link })
  out('notifications', [
    N('NTF-012', rel(0, 8, 41), false, 'address', L(`${awaitingLow} siparişte adres sorunu tespit edildi`, `Address issues detected on ${awaitingLow} orders`), L('Bekleyen siparişlerin adres skoru 70 altında. Önerilen düzeltmeleri inceleyin.', 'Awaiting orders have an address score below 70. Review the suggested corrections.'), '/orders?addressScore=lt70'),
    N('NTF-011', a77.measuredAt, false, 'adjustment', L('Ağırlık düzeltmesi: SHP-20877 (+$4.20)', 'Weight adjustment: SHP-20877 (+$4.20)'), L(`${a77.measuredAtHub} merkezinde ölçülen ağırlık beyan edilenden 2 lb fazla.`, `Weight measured at ${a77.measuredAtHub} is 2 lb above the declared weight.`), '/billing?tab=adjustments'),
    N('NTF-010', rel(0, 6, 35), false, 'forecast', L('Talep tahmini güncellendi: tatil sezonunda hacim zirvesi bekleniyor', 'Demand forecast updated: a holiday season volume peak is expected'), L('Tatil sezonu öncesi hacim artıyor. LA01 kapasitesini kontrol edin.', 'Volume is rising ahead of the holiday season. Check LA01 capacity.'), '/ai/forecast'),
    N('NTF-009', rel(0, 6, 31), false, 'pricing', L('Dinamik fiyat önerisi onay bekliyor (6 hat)', 'Dynamic price recommendations awaiting approval (6 lanes)'), L('Talep tahmini güncellendi, 6 hat için yeni fiyat önerildi.', 'Forecast updated, new prices proposed for 6 lanes.'), '/ai/pricing'),
    N('NTF-008', rel(1, 9, 0), false, 'integration', L('WooCommerce mağazanızı bağlamadınız', 'You have not connected your WooCommerce store'), L('WooCommerce siparişlerini otomatik almak için mağazanızı bağlayın.', 'Connect your store to import WooCommerce orders automatically.'), '/integrations/stores'),
    N('NTF-007', M409.createdAt, true, 'manifest', L(`Manifest ${M409.id} oluşturuldu`, `Manifest ${M409.id} created`), M409.type === 'carrier' ? L(`${M409.hub} · ${M409.carrier} · ${M409.totals.parcels} paket`, `${M409.hub} · ${M409.carrier} · ${M409.totals.parcels} parcels`) : L(`${M409.flight} · ${M409.totals.parcels} koli`, `${M409.flight} · ${M409.totals.parcels} parcels`), `/manifests/${M409.id}`),
    N('NTF-006', autoTop.at, true, 'wallet', L('Cüzdan otomatik yüklendi: $500', 'Wallet auto top up: $500'), L('Bakiye $200 altına düştüğü için Visa •••• 4242 kartından yükleme yapıldı.', 'Balance fell below $200, Visa •••• 4242 was charged.'), '/billing'),
    N('NTF-005', relOf(addMin(dateOf(labelVoided.events[1].at), 2)), true, 'refund', L(`Etiket iptal edildi: ${labelVoided.id}`, `Label voided: ${labelVoided.id}`), L('İade tutarı cüzdanınıza eklendi.', 'The refund was added to your wallet.'), `/shipments/${labelVoided.id}`),
    N('NTF-004', rel(3, 10, 15), true, 'wallet', L(`Bakiye yüklendi: ${MANUAL_TXT}`, `Balance topped up: ${MANUAL_TXT}`), L('Visa •••• 4242 ile manuel yükleme tamamlandı.', 'Manual top up with Visa •••• 4242 completed.'), '/billing'),
    N('NTF-003', rel(6, 12, 0), true, 'system', L('KargoPazar v1.0.0 yayında', 'KargoPazar v1.0.0 released'), L('Ülke yapılandırması ve Almanya pazarı etkinleştirildi.', 'Country configuration and the Germany market are live.'), '/admin/system'),
    N('NTF-002', rel(21, 9, 30), true, 'country', L('Yeni pazar: Almanya etkinleştirildi', 'New market: Germany activated'), L('Frankfurt konsolidasyon noktası ilk mil gönderilerine açıldı.', 'Frankfurt consolidation point is open for first mile shipments.'), '/admin/countries'),
    N('NTF-001', rel(37, 10, 19), true, 'tests', L('Entegrasyon testi koşusu tamamlandı: 44/44', 'Integration test run completed: 44/44'), L('RUN-002 (v0.9.2) tüm senaryolardan geçti.', 'RUN-002 (v0.9.2) passed all scenarios.'), '/intl/tests'),
  ])
}

{
  const rsys = stream('system')
  const deploys = [
    ['v0.6.0', 'feat(api): rates and shipments endpoints', 410], ['v0.6.1', 'fix(labels): USPS label barcode spacing', 388],
    ['v0.7.0', 'feat(ai): address validation model v1.0', 352], ['v0.7.1', 'perf(orders): paginate order list query', 331],
    ['v0.7.2', 'feat(ops): hub intake and scale integration', 300], ['v0.8.0', 'feat(integrations): Etsy and Shopify connectors', 262],
    ['v0.8.1', 'feat(billing): prepaid wallet and auto top up', 231], ['v0.8.2', 'feat(integrations): Amazon, eBay and WooCommerce', 198],
    ['v0.9.0', 'feat(ai): demand forecast and dynamic pricing', 160], ['v0.9.1', 'feat(intl): UK and TR first mile flows', 58],
    ['v0.9.2', 'fix(intl): normalize UK postcodes, map DHL WC event, FX rounding', 40], ['v0.9.3', 'feat(carriers): OnTrac and LSO adapters', 30],
    ['v0.9.4', 'feat(intl): customs document automation and HS model', 22], ['v0.9.5', 'feat(accounts): customer carrier accounts and custom rate cards', 14],
    ['v1.0.0', 'release: country configuration and Germany launch', 6],
  ].map(([version, message, d], k) => ({ version, commit: [...Array(7)].map(() => '0123456789abcdef'[rsys.int(0, 15)]).join(''), message, at: rel(d, rsys.int(10, 18), rsys.int(0, 59)), durationSec: rsys.int(160, 420), status: 'success', pipeline: 'GitHub Actions', current: k === 14 }))
  const uptime = []
  for (let d = 29; d >= 0; d--) uptime.push({ day: rel(d, 0, 0), status: d === 17 ? 'degraded' : 'up', uptimePct: d === 17 ? 99.62 : round2(99.95 + rsys.float(0, 0.05)) })
  out('system', {
    environment: 'demo',
    services: [
      { id: 'api', name: L('API', 'API'), tech: 'ASP.NET Core 8', host: 'AWS ECS Fargate', detail: L('3 görev, otomatik ölçekleme', '3 tasks, auto scaling'), status: 'operational', uptimePct: 99.97, p95Ms: 182, tasks: 3 },
      { id: 'panel', name: L('Panel', 'Panel'), tech: 'Vue 3', host: 'AWS Amplify', detail: L('Statik dağıtım, CDN', 'Static hosting, CDN'), status: 'operational', uptimePct: 99.99, p95Ms: null, liveFromRequestLog: true },
      { id: 'db', name: L('Veritabanı', 'Database'), tech: 'MySQL 8', host: 'Amazon RDS', detail: L('Multi-AZ, günlük yedek', 'Multi-AZ, daily backups'), status: 'operational', uptimePct: 99.98, p95Ms: 24 },
      { id: 'worker', name: L('Kuyruk / Worker', 'Queue / Worker'), tech: '.NET Worker + SQS', host: 'AWS ECS Fargate', detail: L('Etiket ve senkron işleri', 'Label and sync jobs'), status: 'operational', uptimePct: 99.95, p95Ms: 640, queueDepth: 3 },
      { id: 'carriers', name: L('Taşıyıcı adaptörleri', 'Carrier adapters'), tech: 'Adapter SDK', host: 'AWS ECS Fargate', detail: L('8 adaptör', '8 adapters'), status: 'operational', uptimePct: 99.91, p95Ms: 690, adapters: CARRIERS.map((c) => ({ carrier: c.code, status: 'up', avgMs: c.apiHealth.avgMs })) },
      { id: 'marketplaces', name: L('Pazaryeri bağlayıcıları', 'Marketplace connectors'), tech: 'OAuth + Webhooks', host: 'AWS Lambda', detail: L('5 bağlayıcı', '5 connectors'), status: 'operational', uptimePct: 99.93, p95Ms: 410, connectors: ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce'] },
    ],
    uptime30d: uptime,
    incidents: [{ day: rel(17, 0, 0), service: 'carriers', title: L('USPS adaptöründe 38 dk yavaşlama', 'USPS adapter slowdown for 38 min'), resolvedAt: rel(17, 15, 12) }],
    deploys,
    improvements: [
      { id: 'IMP-1', title: L('Panel ilk yükleme süresi', 'Panel first load time'), before: 3.8, after: 1.4, unit: 's', note: L('Kod bölme ve önbellek', 'Code splitting and caching') },
      { id: 'IMP-2', title: L('Sipariş listesi yanıt süresi', 'Order list response time'), before: 1200, after: 180, unit: 'ms', note: L('Sayfalama ve indeks', 'Pagination and indexes') },
      { id: 'IMP-3', title: L('Etiket iptal süreci adım sayısı', 'Label void steps'), before: 5, after: 2, unit: 'steps', note: L('Tek onay diyaloğu, otomatik iade', 'Single confirm dialog, automatic refund') },
      { id: 'IMP-4', title: L('Ağırlık farkı faturalama', 'Weight difference billing'), before: 0, after: 100, unit: '%', note: L('Elle faturalamadan tam otomasyona', 'From manual billing to full automation') },
    ],
    awsCost: [...Array(12)].map((_, k) => ({ monthOffset: k - 11, usd: Math.round(620 + k * 58 + rsys.float(-30, 30)) })),
    scalingEvents: [
      { at: rel(41, 11, 5), service: 'api', from: 2, to: 3, reason: L('CPU %70 üzerinde 10 dk', 'CPU above 70% for 10 min') },
      { at: rel(12, 18, 40), service: 'worker', from: 1, to: 2, reason: L('Toplu etiket kuyruğu 500 iş üstünde', 'Batch label queue above 500 jobs') },
      { at: rel(12, 20, 5), service: 'worker', from: 2, to: 1, reason: L('Kuyruk boşaldı', 'Queue drained') },
    ],
  })
}

{
  const WP = {
    IP1: { name: L('Temel API ve entegrasyonların başlangıcı', 'Core API and start of integrations'), months: [1, 9] },
    IP2: { name: L('E-pazaryeri entegrasyonları ve iş modeli optimizasyonu', 'Marketplace integrations and business model optimization'), months: [7, 15] },
    IP3: { name: L('Genişleme ve yeni kargo firmalarıyla entegrasyon', 'Expansion and integration with new carriers'), months: [13, 20] },
    IP4: { name: L('Uluslararası genişleme ve özelleştirme seçenekleri', 'International expansion and customization options'), months: [18, 24] },
  }
  const lk = (tr, en, path) => ({ label: L(tr, en), path })
  const done = L('TAMAMLANDI', 'COMPLETED')
  const items = [
    [1, 'IP1', 'Proje planlaması ve yol haritasının detaylandırılması', 'Detailed project planning and roadmap', [1, 2], [lk('Ar-Ge İş Paketleri', 'R&D Work Packages', '/admin/rnd')], 'Yönetim > Ar-Ge İş Paketleri; Landing > Hakkımızda', 'Admin > R&D Work Packages; Landing > About', '23 kalem, Gantt, sunum modu çalışıyor', '23 items, Gantt chart and presentation mode work'],
    [2, 'IP1', 'Temel API altyapısının tasarımı ve geliştirilmesi', 'Design and development of the core API infrastructure', [2, 5], [lk("API ve Webhook'lar", 'API and Webhooks', '/integrations/api')], "API ve Webhook'lar (dokümantasyon, konsol, anahtarlar, istek log'u)", 'API and Webhooks (docs, console, keys, request log)', "Konsoldan /v1/rates ve /v1/shipments gerçek sonuç döndürüyor; panel işlemleri istek log'unda görünüyor", 'The console returns real results for /v1/rates and /v1/shipments; panel actions appear in the request log'],
    [3, 'IP1', 'Yapay zeka modüllerinin tasarımına başlama', 'Starting the design of the AI modules', [3, 5], [lk('AI Merkezi mimari şeması', 'AI Hub architecture diagram', '/ai')], 'AI Merkezi ana sayfa mimari şeması', 'AI Hub home architecture diagram', '6 modül, girdi/çıktı, bağımlılık okları', '6 modules, inputs/outputs, dependency arrows'],
    [4, 'IP1', 'İlk kargo firmaları ile API entegrasyon testleri', 'API integration tests with the first carriers', [4, 6], [lk('Entegrasyon Testleri', 'Integration Tests', '/intl/tests'), lk('Taşıyıcılar', 'Carriers', '/admin/carriers')], 'Entegrasyon Testleri > ABD iç hat seti; Yönetim > Taşıyıcılar', 'Integration Tests > US domestic suite; Admin > Carriers', '16 senaryo koşup geçiyor', '16 scenarios run and pass'],
    [5, 'IP1', 'Adres doğrulama AI modülü entegrasyonu ve testleri', 'Address validation AI module integration and tests', [5, 8], [lk('Adres Doğrulama', 'Address Validation', '/ai/address'), lk('Siparişler', 'Orders', '/orders'), lk('Gönderi oluştur', 'Create shipment', '/shipments/new')], 'AI Merkezi > Adres Doğrulama; Siparişler skor sütunu; Gönderi oluştur adım 2', 'AI Hub > Address Validation; Orders score column; Create shipment step 2', 'Model tarayıcıda eğitiliyor, metrikler hesaplanıyor, kural vs ML karşılaştırması var, düzeltme uygulanabiliyor', 'The model trains in the browser, metrics are computed, rules vs ML comparison exists, corrections can be applied'],
    [6, 'IP1', 'Sistem altyapısının kurulumu ve optimizasyonu', 'System infrastructure setup and optimization', [2, 6], [lk('Sistem Durumu', 'System Status', '/admin/system')], 'Yönetim > Sistem Durumu', 'Admin > System Status', 'Servis kartları, dağıtım geçmişi, maliyet trendi', 'Service cards, deployment history, cost trend'],
    [7, 'IP1', 'Entegrasyonların tamamlanması ve pilot testler', 'Completing integrations and pilot tests', [6, 9], [lk('Operasyon Merkezi', 'Operations Hub', '/ops'), lk('Müşteriler', 'Customers', '/admin/customers')], 'Operasyon Merkezi (NJ01/LA01); Yönetim > Müşteriler', 'Operations Hub (NJ01/LA01); Admin > Customers', 'Paket kabul, ölçüm, taşıyıcıya teslim uçtan uca çalışıyor', 'Parcel intake, measurement and carrier handover work end to end'],
    [8, 'IP1', 'Test sonuçlarına göre sistem iyileştirmeleri', 'System improvements based on test results', [7, 9], [lk('Ağırlık düzeltmeleri', 'Weight adjustments', '/billing'), lk('Gönderiler', 'Shipments', '/shipments'), lk('İyileştirmeler', 'Improvements', '/admin/system')], 'Cüzdan > Ağırlık düzeltmeleri; Gönderiler > Etiket iptali; Sistem Durumu > İyileştirmeler', 'Wallet > Weight adjustments; Shipments > Label void; System Status > Improvements', 'Ağırlık farkı otomatik faturalanıyor, iptal iadesi cüzdana dönüyor', 'Weight differences are billed automatically, void refunds return to the wallet'],
    [9, 'IP1', 'AI destekli talep tahmini modülünün entegrasyonu', 'Integration of the AI demand forecasting module', [6, 9], [lk('Talep Tahmini', 'Demand Forecast', '/ai/forecast'), lk('Genel Bakış', 'Overview', '/')], 'AI Merkezi > Talep Tahmini; Genel Bakış içgörü kartı', 'AI Hub > Demand Forecast; Overview insight card', '12 haftalık tahmin, güven bandı, MAPE, veri yeterlilik skoru, kırılımlar, yeniden eğitim', '12 week forecast, confidence band, MAPE, data sufficiency score, breakdowns, retraining'],
    [10, 'IP2', 'Etsy, Shopify entegrasyonu', 'Etsy and Shopify integration', [7, 10], [lk('Pazaryerleri', 'Marketplaces', '/integrations/stores'), lk('Siparişler', 'Orders', '/orders')], 'Entegrasyonlar > Pazaryerleri; Siparişler', 'Integrations > Marketplaces; Orders', 'Senkron yeni sipariş getiriyor, takip no geri yazılıyor', 'Sync brings new orders, tracking numbers are written back'],
    [11, 'IP2', 'Kargo firmaları ile müzakere', 'Negotiations with carriers', [8, 12], [lk('Tarife Kartları', 'Rate Cards', '/admin/rate-cards')], 'Yönetim > Tarife Kartları > Taşıyıcı anlaşmaları ve platform tarifesi', 'Admin > Rate Cards > Carrier agreements and platform tariff', 'Kademe ve markup değişikliği fiyatlara yansıyor', 'Tier and markup changes are reflected in prices'],
    [12, 'IP2', 'Pazaryeri entegrasyonları (Amazon, eBay, WooCommerce)', 'Marketplace integrations (Amazon, eBay, WooCommerce)', [9, 13], [lk('Pazaryerleri', 'Marketplaces', '/integrations/stores')], 'Entegrasyonlar > Pazaryerleri', 'Integrations > Marketplaces', 'WooCommerce canlı bağlanıyor ve 12 sipariş geliyor; Amazon/eBay siparişleri listede', 'WooCommerce connects live and 12 orders arrive; Amazon/eBay orders are listed'],
    [13, 'IP2', 'Kullanıcı deneyimi ve AI modüllerinin optimizasyonu', 'User experience and AI module optimization', [10, 15], [lk('Plan önerisi', 'Plan recommendation', '/plan'), lk('Cüzdan', 'Wallet', '/billing'), lk('AI Merkezi', 'AI Hub', '/ai'), lk('Teklif Karşılaştır', 'Compare Quotes', '/compare'), lk('ABD stok durumu', 'US stock status', '/')], 'Kayıt + kurulum sihirbazı; Cüzdan; Plan önerisi; TR/EN; AI Merkezi', 'Sign up + onboarding wizard; Wallet; Plan recommendation; TR/EN; AI Hub', 'Sihirbaz uçtan uca, cüzdan yükleme, öneri gerekçeli', 'Wizard works end to end, wallet top up, recommendation with reasoning'],
    [14, 'IP2', 'Pazarlama ve müşteri kazanım stratejileri', 'Marketing and customer acquisition strategies', [11, 15], [lk('Plan', 'Plan', '/plan')], 'Landing; Kayıt; Plan', 'Landing; Sign up; Plan', 'Landing Excel ile tutarlı, 3 plan', 'Landing consistent with the work plan, 3 plans'],
    [15, 'IP3', 'Entegre edilen kargo firmalarının artırılması', 'Increasing the number of integrated carriers', [13, 17], [lk('Taşıyıcılar', 'Carriers', '/admin/carriers')], 'Yönetim > Taşıyıcılar (8 taşıyıcı, adaptör şeması, yeni taşıyıcı sihirbazı)', 'Admin > Carriers (8 carriers, adapter diagram, new carrier wizard)', 'Sihirbazla eklenen taşıyıcı fiyat listesinde görünüyor', 'A carrier added with the wizard appears in the rate list'],
    [16, 'IP3', 'AI ile dinamik fiyatlandırma', 'Dynamic pricing with AI', [14, 19], [lk('Dinamik Fiyatlandırma', 'Dynamic Pricing', '/ai/pricing'), lk('Tarife Kartları', 'Rate Cards', '/admin/rate-cards'), lk('Teklif Karşılaştır', 'Compare Quotes', '/compare')], 'AI Merkezi > Dinamik Fiyatlandırma; Tarife Kartları', 'AI Hub > Dynamic Pricing; Rate Cards', 'Öneri tahmine bağlı değişiyor, onaylanan fiyat gönderi fiyatına yansıyor', 'Recommendations follow the forecast, approved prices are applied to shipment prices'],
    [17, 'IP3', 'Uluslararası entegrasyon testleri', 'International integration tests', [16, 20], [lk('Entegrasyon Testleri', 'Integration Tests', '/intl/tests')], 'Uluslararası > Entegrasyon Testleri', 'International > Integration Tests', 'UK ve TR setleri koşuyor, geçmiş koşuda kalan senaryolar ve düzeltmeler, PDF rapor', 'UK and TR suites run, failed scenarios and fixes from past runs, PDF report'],
    [18, 'IP3', 'AI ile rota optimizasyonu (revize kapsam)', 'Route optimization with AI (revised scope)', [15, 20], [lk('Taşıyıcı Optimizasyonu', 'Carrier Optimization', '/ai/optimizer'), lk('Toplu İşlemler', 'Batch', '/batch'), lk('Teklif Karşılaştır', 'Compare Quotes', '/compare')], 'AI Merkezi > Taşıyıcı Optimizasyonu; Toplu İşlemler', 'AI Hub > Carrier Optimization; Batch', 'Simülatör, ısı haritası, toplu optimizasyon tasarrufu', 'Simulator, heat map, batch optimization savings'],
    [19, 'IP4', 'Uluslararası pazarlarda faaliyet ve yerel entegrasyonlar', 'Operating in international markets and local integrations', [18, 22], [lk('İlk Mil Gönderileri', 'First Mile Shipments', '/intl'), lk('Yeni ilk mil gönderisi', 'New first mile shipment', '/intl/new'), lk('ABD stok durumu', 'US stock status', '/'), lk('Gümrük Bilgi Merkezi', 'Customs Information Center', '/customs/info')], 'Uluslararası > İlk Mil Gönderileri + oluşturma', 'International > First Mile Shipments + creation', 'UK/TR menşeli gönderi oluşturulup aşamalar ilerletilebiliyor, son mil etiketleri oluşuyor', 'UK/TR origin shipments can be created and advanced through stages, last mile labels are created'],
    [20, 'IP4', 'Müşterilerin kendi kargo hesapları', "Customers' own carrier accounts", [19, 22], [lk('Taşıyıcı Hesaplarım', 'My Carrier Accounts', '/integrations/carrier-accounts'), lk('Gönderi oluştur', 'Create shipment', '/shipments/new'), lk('Kendi hesap gönderileri', 'Own account shipments', '/billing'), lk('Teklif Karşılaştır', 'Compare Quotes', '/compare')], 'Entegrasyonlar > Taşıyıcı Hesaplarım; Gönderi oluştur adım 4; Cüzdan > Kendi hesap gönderileri', 'Integrations > My Carrier Accounts; Create shipment step 4; Wallet > Own account shipments', 'FedEx hesabı canlı bağlanıyor, fiyatlar yan yana, etiket seçilen hesaptan', 'A FedEx account connects live, prices side by side, label from the selected account'],
    [21, 'IP4', 'Uluslararası gümrük ve lojistik için AI', 'AI for international customs and logistics', [19, 24], [lk('HS Kodu Önerisi', 'HS Code Suggestion', '/ai/hs'), lk('Gümrük Belgeleri', 'Customs Documents', '/ai/customs-docs'), lk('Gümrük Bilgi Merkezi', 'Customs Information Center', '/customs/info'), lk('Gönderi detayı: Gümrük sekmesi', 'Shipment detail: Customs tab', '/shipments/SHP-20526?tab=customs'), lk('İlk mil gönderisi: Gümrük sekmesi', 'First mile shipment: Customs tab', '/intl/INT-3101?tab=customs'), lk('Gümrük', 'Customs', '/customs')], 'AI Merkezi > HS Kodu Önerisi ve Gümrük Belgeleri; Gümrük; Manifestler', 'AI Hub > HS Code Suggestion and Customs Documents; Customs; Manifests', 'Top-3 öneri, düzelt + yeniden eğit sonrası doğru kod, CN22/CN23/fatura/manifest PDF', 'Top 3 suggestions, correct code after fix + retrain, CN22/CN23/invoice/manifest PDF'],
    [22, 'IP4', 'Özelleşmiş müşteri çözümleri', 'Specialized customer solutions', [20, 24], [lk('Geçici etiket', 'Temporary label', '/shipments'), lk('Ekip ve Roller', 'Team and Roles', '/settings/team'), lk('Gönderi Kuralları', 'Shipping Rules', '/settings/rules')], 'Gönderi detayı > Geçici etiket; Ayarlar > Ekip ve Roller; Gönderi Kuralları; Tarife Kartları > Müşteriye özel', 'Shipment detail > Temporary label; Settings > Team and Roles; Shipping Rules; Rate Cards > Customer specific', 'Dummy label PDF, rol önizleme, kural tetikleniyor, özel tarife uygulanıyor', 'Dummy label PDF, role preview, rules trigger, custom rate card applied'],
    [23, 'IP4', 'Ülke bazlı kullanım kapsamı ve yeni pazarlar', 'Country based coverage and new markets', [21, 24], [lk('Ülke Yapılandırması', 'Country Configuration', '/admin/countries')], 'Yönetim > Ülke Yapılandırması', 'Admin > Country Configuration', 'DE hazır, sihirbazla yeni ülke eklenip menşe olarak seçilebiliyor', 'DE is ready, a new country can be added with the wizard and selected as origin'],
  ].map(([no, wp, tr, en, months, demoLinks, scrTr, scrEn, accTr, accEn]) => ({
    id: `RD-${pad(no, 2)}`,
    no,
    wp,
    wpLabel: wp.replace('IP', 'İP'),
    wpName: WP[wp].name,
    wpMonths: WP[wp].months,
    name: L(tr, en),
    status: no === 9 || no === 16 ? L('TAMAMLANDI (temel sürüm)', 'COMPLETED (basic version)') : no === 18 ? L('TAMAMLANDI (revize kapsamla)', 'COMPLETED (with revised scope)') : done,
    state: 'done',
    progress: 100,
    months,
    demoScreens: L(scrTr, scrEn),
    demoLinks,
    acceptance: L(accTr, accEn),
  }))
  assert(items.length === 23, 'roadmap must have 23 items')
  out('roadmap', items)
}

{
  const rc = stream('customers')
  const demoDaily = []
  for (let d = 29; d >= 0; d--) demoDaily.push(shipments.filter((s, i) => dAgo[i] === d).length)
  const defs = [
    [CUSTOMER_ID, COMPANY, 'enterprise', ['shopify', 'etsy', 'amazon', 'ebay'], 'NJ01', 212, 'active', 'TR'],
    ['CUS-002', 'Bosphorus Textiles Inc.', 'professional', ['shopify', 'amazon'], 'NJ01', 190, 'active', 'US'],
    ['CUS-003', 'Cappadocia Ceramics LLC', 'professional', ['etsy'], 'NJ01', 176, 'active', 'US'],
    ['CUS-004', 'Lavender Lane Soap Co.', 'starter', ['etsy', 'shopify'], 'LA01', 164, 'active', 'US'],
    ['CUS-005', 'Hudson Valley Leatherworks', 'professional', ['shopify', 'ebay'], 'NJ01', 150, 'active', 'US'],
    ['CUS-006', 'Pacific Loom Studio', 'professional', ['shopify', 'etsy', 'amazon'], 'LA01', 141, 'active', 'US'],
    ['CUS-007', 'Aegean Olive Co.', 'enterprise', ['amazon', 'shopify'], 'NJ01', 128, 'active', 'TR'],
    ['CUS-008', 'Thistle & Tweed Ltd', 'professional', ['etsy', 'shopify'], 'NJ01', 96, 'active', 'GB'],
    ['CUS-009', 'Brooklyn Brass Goods', 'starter', ['etsy'], 'NJ01', 80, 'active', 'US'],
    [UK_CUSTOMER_ID, UK_CUSTOMER, 'starter', ['shopify', 'etsy'], 'NJ01', 62, 'pilot', 'GB'],
    ['CUS-011', 'Golden Horn Jewelry', 'professional', ['etsy', 'ebay'], 'NJ01', 41, 'pilot', 'TR'],
    ['CUS-012', 'Evergreen Paper Co.', 'starter', ['woocommerce'], 'LA01', 18, 'onboarding', 'US'],
  ]
  out('customers', defs.map(([id, name, plan, channels, hub, since, status, country], k) => {
    const scale = k === 0 ? 1 : rc.float(0.2, 1.6)
    const last30d = k === 0 ? demoDaily : demoDaily.map((v) => Math.max(0, Math.round(v * scale + rc.normal(0, 1))))
    return { id, name, plan, channels, hub, country, pilotStartedAt: rel(since, 10, 0), status, monthlyVolume: last30d.reduce((s, v) => s + v, 0), last30d, isDemo: k === 0 }
  }))
}

{
  const rau = stream('audit')
  const team = files.team
  const actor = (id) => {
    const m = team.find((t) => t.id === id)
    return { id: m.id, name: m.name, role: m.role }
  }
  const entries = []
  const recent = shipments.filter((s, i) => dAgo[i] <= 20)
  rau.shuffle(recent).slice(0, 20).forEach((s) => entries.push({ at: s._date, actor: actor(rau.pick(['USR-001', 'USR-003', 'USR-003', 'USR-002'])), action: 'shipment.create', target: { type: 'shipment', id: s.id }, summary: L(`Etiket oluşturuldu: ${s.id} (${s.carrier})`, `Label created: ${s.id} (${s.carrier})`), source: s.channel === 'api' ? 'api' : 'panel' }))
  shipments.filter((s) => s.status === 'voided').forEach((s) => entries.push({ at: dateOf(s.events[1].at), actor: actor('USR-003'), action: 'shipment.void', target: { type: 'shipment', id: s.id }, summary: L(`Etiket iptal edildi: ${s.id}`, `Label voided: ${s.id}`), source: 'panel' }))
  adjustments.filter((a) => a.dispute).forEach((a) => entries.push({ at: dateOf(a.dispute.openedAt), actor: actor('USR-004'), action: 'adjustment.dispute', target: { type: 'adjustment', id: a.id }, summary: L(`Ağırlık düzeltmesine itiraz edildi: ${a.id}`, `Weight adjustment disputed: ${a.id}`), source: 'panel' }))
  const fixed = [
    [100, 14, 20, 'USR-002', 'carrier_account.connect', 'carrier_account', 'CA-UPS-01', 'UPS hesabı bağlandı (••••82)', 'UPS account connected (••••82)'],
    [96, 10, 12, 'USR-002', 'api_key.create', 'api_key', 'KEY-001', 'API anahtarı oluşturuldu: ERP integration', 'API key created: ERP integration'],
    [61, 14, 3, 'USR-001', 'api_key.create', 'api_key', 'KEY-002', 'API anahtarı oluşturuldu: Staging tests', 'API key created: Staging tests'],
    [95, 11, 0, 'USR-002', 'webhook.create', 'webhook', 'WH-01', 'Webhook eklendi', 'Webhook added'],
    [58, 9, 40, 'USR-002', 'webhook.create', 'webhook', 'WH-02', 'Webhook eklendi', 'Webhook added'],
    [40, 16, 20, 'USR-001', 'rule.update', 'rule', 'RUL-001', 'Kural güncellendi: Değer > $250 ise sigorta ve imza', 'Rule updated: Value > $250: insurance and signature'],
    [60, 12, 0, 'USR-002', 'rule.update', 'rule', 'RUL-003', 'Kural güncellendi: Amazon 2 gün', 'Rule updated: Amazon 2 days'],
    [74, 15, 20, 'USR-001', 'team.invite', 'user', 'USR-005', 'Ekip üyesi davet edildi: Deniz Yılmaz (Salt okunur)', 'Team member invited: Deniz Yılmaz (Read only)'],
    [97, 15, 40, 'USR-002', 'rate_card.create', 'rate_card', 'RC-C-001', 'Özel tarife oluşturuldu: Anatolia Home özel anlaşması', 'Custom rate card created: Anatolia Home special agreement'],
    [3, 10, 14, 'USR-004', 'wallet.topup', 'wallet', 'card_4242', `Bakiye yüklendi: ${MANUAL_TXT}`, `Balance topped up: ${MANUAL_TXT}`],
    [120, 15, 30, 'USR-001', 'store.connect', 'store', 'ST-EBAY', 'eBay mağazası bağlandı', 'eBay store connected'],
    [150, 9, 5, 'USR-001', 'store.connect', 'store', 'ST-AMAZON', 'Amazon mağazası bağlandı', 'Amazon store connected'],
    [21, 9, 25, 'USR-001', 'country.activate', 'country', 'DE', 'Yeni pazar etkinleştirildi: Almanya', 'New market activated: Germany'],
    [1, 17, 42, 'USR-001', 'auth.login', 'session', 'SES-01', 'Oturum açıldı', 'Signed in'],
  ]
  for (const [d, h, m, uid, action, type, id, tr, en] of fixed) entries.push({ at: atDay(d, h, m), actor: actor(uid), action, target: { type, id }, summary: L(tr, en), source: 'panel' })
  entries.sort((a, b) => a.at - b.at)
  const trimmed = entries.slice(-40)
  assert(trimmed.length === 40, `audit log must have 40 entries, got ${entries.length}`)
  const ips = ['203.0.113.24', '198.51.100.71', '203.0.113.88', '192.0.2.145']
  out('audit_log', trimmed.map((e, k) => ({ id: `AUD-${pad(k + 1, 5)}`, ...e, at: relOf(e.at), ip: rau.pick(ips) })))
}

{
  const pickList = (d0) => {
    for (const off of [0, 1, -1, 2, -2, 3]) {
      const l = shipments.filter((s, i) => dAgo[i] === d0 + off && s.aiPick.chosen && s.status !== 'voided' && s.flow !== 'direct')
      if (l.length >= 3) return l
    }
    return []
  }
  const batches = [26, 19, 12, 5].map((d, k) => {
    const list = pickList(d)
    const totalCost = round2(list.reduce((s, x) => s + x.total, 0))
    const savings = round2(list.reduce((s, x) => s + x.aiPick.savingsVsDefault, 0))
    const at = list.length ? addMin(list[0]._date, -3) : atDay(d, 10, 0)
    return {
      id: `BAT-${pad(21 + k, 4)}`, at: relOf(at), createdBy: k % 2 ? 'Burak Şahin' : 'Demo Kullanıcı',
      orderCount: list.length, labelCount: list.length, failed: 0, shipmentIds: list.map((s) => s.id),
      hubs: { NJ01: list.filter((s) => s.hub === 'NJ01').length, LA01: list.filter((s) => s.hub === 'LA01').length },
      totalCost, defaultCost: round2(totalCost + savings), savings, savingsPct: totalCost ? Math.round((savings / (totalCost + savings)) * 1000) / 1000 : 0,
      avgEtaDays: list.length ? Math.round((list.reduce((s, x) => s + x._etaDays, 0) / list.length) * 10) / 10 : 0,
    }
  })
  assert(batches.every((b) => b.orderCount > 0), 'batches must not be empty')
  out('batches', batches)
}

// ===========================================================================
// 14. Final checks, cleanup and write
// ===========================================================================
{
  const cnt = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {})
  const ch = cnt(orders, 'channel')
  const st = cnt(orders, 'status')
  assert(ch.shopify === 46 && ch.etsy === 38 && ch.amazon === 22 && ch.ebay === 14 && ch.manual === 12 && ch.api === 8, 'order channel distribution ' + JSON.stringify(ch))
  assert(st.awaiting_shipment === 52 && st.on_hold === 6 && st.labeled === 20 && st.shipped === 50 && st.cancelled === 4 && st.delivered === 8, 'order status distribution ' + JSON.stringify(st))
  assert(orders[orders.length - 1].id === 'ORD-10482', 'last order id')
  assert(shipments.filter((s, i) => dAgo[i] <= 6).length === 38, 'shipments in last 7 days')
  assert(shipments.filter((s) => s.aiPick.chosen).length === 269, '64% aiPick chosen')
  for (const o of orders) {
    if (o.shipmentId) {
      const s = shipments.find((x) => x.id === o.shipmentId)
      assert(s && s.orderId === o.id, 'order/shipment link ' + o.id)
    }
  }
}
for (const s of shipments) for (const k of Object.keys(s)) if (k.startsWith('_')) delete s[k]
out('shipments', shipments)
out('orders', orders)
out('counters', {
  ORD: 10482, SHP: 20930, TXN: 7711, MNF: 411, INV: 97, INV_YEAR: 2026, ADJ: 1000 + adjustments.length, INT: 3100 + intl.length,
  BAT: 24, NTF: 12, AUD: 40, KEY: 2, WH: 2, DLV: 4130, SYN: 80, RUL: 4, RUN: 2, RC: 1, ADR: 400, HST: 360,
  formats: {
    ORD: 'ORD-{n}', SHP: 'SHP-{n}', TXN: 'TXN-{n}', MNF: 'MNF-{n:4}', INV: 'INV-{year}-{n:4}', ADJ: 'ADJ-{n}', INT: 'INT-{n}',
    BAT: 'BAT-{n:4}', NTF: 'NTF-{n:3}', AUD: 'AUD-{n:5}', KEY: 'KEY-{n:3}', WH: 'WH-{n:2}', DLV: 'DLV-{n:5}', SYN: 'SYN-{n:4}', RUL: 'RUL-{n:3}', RUN: 'RUN-{n:3}',
  },
})

const DASH_RE = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']')
function serialize(data) {
  if (Array.isArray(data)) return '[\n' + data.map((x) => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n'
  return JSON.stringify(data, null, 2) + '\n'
}
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(path.join(OUT, f))
let bytes = 0
for (const name of Object.keys(files).sort()) {
  const text = serialize(files[name])
  assert(!DASH_RE.test(text), `dash characters found in ${name}.json`)
  writeFileSync(path.join(OUT, `${name}.json`), text)
  bytes += Buffer.byteLength(text)
}
console.log(`seed: ${Object.keys(files).length} files, ${(bytes / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), OUT)}`)
