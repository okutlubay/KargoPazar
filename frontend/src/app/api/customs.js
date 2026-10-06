/**
 * Customs document automation API (spec 6.6, used by 9.3).
 * Builds everything the customs documents need from an international first mile shipment
 * (intl_shipments): normalized customs descriptions, HS codes (item, catalog or HS model),
 * origin, totals, CN22/CN23 choice and country rule checks (de minimis, prohibited HS prefixes).
 * PDFs themselves are rendered by docs/customs.js (buildCustomsData + generators).
 *
 * Exported API (async ones go through request())
 *   listCustomsShipments({ search? }) -> [{ id, origin, originName, stage, customsStatus, sender, destHub,
 *       parcels, itemCount, declaredValueUsd, currency, declaredValueLocal, form, docsAttached, customsDocs,
 *       createdAt }]
 *   prepareCustomsDocs(intlId, { edits? }) -> CustomsDraft
 *       CustomsDraft = { shipment (raw intl record), items: [DraftItem], form: 'cn22'|'cn23', formReason,
 *         totals: { value, declared, weightKg, grossKg, qty }, checks: [Check], deMinimis: { threshold, currency,
 *         thresholdUsd, exceeded, country }, reference: [RefRow], stats: { fields, auto, corrected, rate },
 *         buildOpts (pass to docs buildCustomsData(shipment, buildOpts)) }
 *       DraftItem = { key, sku, title, description, descriptionSource: 'rule'|'template'|'user', normalization:
 *         [{ code, from, to }], hsCode, hsSource: 'item'|'catalog'|'model'|'user'|'none', hsConfidence, hsDesc,
 *         origin, originSource, qty, unitValue, totalValue, weightKg, edited: [field] }
 *       Check = { code, severity: 'success'|'info'|'warning'|'danger', country, params }
 *         codes: DE_MINIMIS_OK, DE_MINIMIS_EXCEEDED, DE_MINIMIS_SUSPENDED, PROHIBITED_IMPORT, PROHIBITED_EXPORT, HS_MISSING,
 *                HS_LOW_CONFIDENCE, ORIGIN_MISSING, VALUE_MISMATCH, VAGUE_DESCRIPTION, FORM_CN22, FORM_CN23,
 *                WEIGHT_OK, WEIGHT_MISMATCH
 *       RefRow = { code, name, role, threshold, currency, thresholdUsd, exceeded, vatRate }
 *       edits: { [itemKey]: { description?, hsCode?, origin? } } user corrections (re-runs the checks)
 *   prepareCustomsDocsSync(intlId, opts) -> same, no latency (loops / previews)
 *   normalizeDescription(title, { hsCode?, sku? }) -> { text, steps: [{ code, from, to }], template: boolean } (sync)
 *   attachCustomsDocs(intlId, { edits?, include? }) -> { shipment, documents: [CustomsDocument], stats }
 *       writes intl_shipments.customsDocs / customsDocsMeta and the 'customsDocuments' collection
 *   listCustomsDocuments({ intlId? }) -> [CustomsDocument] newest first
 *       CustomsDocument = { id, intlId, type: 'commercial_invoice'|'cn22'|'cn23', docNo, form, at, by, valueUsd,
 *         items, autoRate, corrected, source: 'automation' | 'seed' }
 *   listCatalogHs() -> products with HS status (see bottom of file)
 *   automationStats() -> { shipments, fields, autoFields, autoRate, hsBySource: {item, catalog, model, none},
 *       descNormalized, sets, correctedFields, correctionRate, cn22, cn23, deMinimisExceeded }
 */
import { request, ApiError } from './client.js'
import { db } from '../store/db.js'
import { session } from '../store/session.js'
import { audit, modelEvent } from '../store/events.js'
import { suggest as hsSuggest, describe as hsDescribe } from '../ai/hsModel.js'
import { deMinimisSuspended } from '@/shared/countries.js'

export const CN22_LIMIT_USD = 400
const REVIEW_PROB = 0.8
const HS_RE = /^\d{4}\.\d{2}$/
const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const r3 = v => Math.round((Number(v) || 0) * 1000) / 1000
const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const nowIso = () => new Date().toISOString()

function normHs(code) {
  const raw = String(code || '').trim()
  if (HS_RE.test(raw)) return raw
  const d = raw.replace(/\D/g, '')
  return d.length === 6 ? d.slice(0, 4) + '.' + d.slice(4) : null
}

// ---------------------------------------------------------------------------
// Description normalization: marketplace title -> customs language
// ---------------------------------------------------------------------------
// Customs documents are written in English (international practice), so the
// templates below are document content, not UI text.
const TEMPLATES = {
  '6912.00': { nouns: ['espresso cup', 'serving bowl', 'mug', 'cup', 'plate', 'bowl', 'vase', 'tile', 'saucer', 'teapot', 'pitcher', 'planter', 'tray'], prefix: 'Ceramic', material: 'stoneware', drink: true },
  '5702.42': { nouns: ['door mat', 'runner', 'kilim', 'rug', 'carpet', 'mat'], prefix: 'Woven', material: 'flat woven, not tufted' },
  '7418.10': { nouns: ['coffee pot', 'saucepan', 'serving tray', 'tray', 'mug', 'pot', 'pan', 'jug', 'bowl', 'cezve'], prefix: 'Copper', material: 'household article', drink: true },
  '0901.21': { nouns: ['coffee'], prefix: 'Roasted', material: 'ground, not decaffeinated' },
  '3401.11': { nouns: ['soap'], prefix: 'Toilet', material: 'bar form' },
  '6302.60': { nouns: ['peshtemal', 'bath towel', 'hand towel', 'towel'], prefix: 'Cotton', material: 'terry or woven fabric' },
  '7113.11': { nouns: ['necklace', 'ring', 'bracelet', 'earrings', 'pendant'], prefix: 'Silver', material: 'sterling silver 925' },
  '4202.31': { nouns: ['passport wallet', 'card holder', 'wallet'], prefix: 'Leather', material: 'outer surface of leather' },
  '6304.92': { nouns: ['pillow case', 'pillow cover', 'cushion cover', 'pillowcase'], head: 'Cushion cover', material: 'cotton, not knitted' },
  '4420.10': { nouns: ['figurine', 'ornament', 'statue', 'carving', 'bird'], prefix: 'Wooden', material: 'decorative, hand carved' },
  '7013.37': { nouns: ['tea glass', 'drinking glass', 'glasses', 'glass', 'tumbler'], head: 'Drinking glasses', material: 'glass, not crystal', drink: true },
  '3406.00': { nouns: ['taper candle', 'candles', 'candle'], head: 'Candles', material: 'wax' },
  '6117.10': { nouns: ['pashmina', 'shawl', 'scarf', 'stole'], prefix: 'Knitted', material: 'textile' },
  '9503.00': { nouns: ['stacking toy', 'amigurumi', 'bunny', 'doll', 'toy', 'plush'], head: 'Toy', material: 'for children' },
  '4911.91': { nouns: ['art print', 'poster', 'print'], head: 'Printed picture', material: 'paper' },
  '6109.10': { nouns: ['t-shirt', 'tshirt', 'tee', 'shirt'], head: 'T-shirt', material: 'cotton, knitted' },
  '1509.20': { nouns: ['olive oil'], head: 'Extra virgin olive oil', material: 'food product' },
  '1704.90': { nouns: ['turkish delight', 'lokum', 'candy', 'confectionery'], head: 'Sugar confectionery', material: 'Turkish delight, no cocoa' },
  '3304.99': { nouns: ['face cream', 'serum', 'cream', 'balm', 'lotion'], head: 'Skin care preparation', material: 'cosmetic' },
  '8306.29': { nouns: ['wall hanging', 'ornament', 'hamsa', 'figurine'], head: 'Decorative ornament', material: 'base metal' },
  '9405.21': { nouns: ['night light', 'table lamp', 'lamp', 'lantern'], head: 'Table lamp', material: 'electric, mosaic glass' },
  '6702.90': { nouns: ['bouquet', 'flowers', 'flower'], head: 'Artificial flowers', material: 'textile or plastic' },
  '7117.19': { nouns: ['earrings', 'bracelet', 'necklace', 'jewelry', 'jewellery'], head: 'Imitation jewelry', material: 'base metal, plated' },
  '4819.20': { nouns: ['gift box', 'box'], head: 'Folding carton box', material: 'paperboard' },
}

const FILLER = ['cute', 'beautiful', 'lovely', 'gorgeous', 'perfect', 'best', 'unique', 'amazing', 'trendy', 'boho', 'aesthetic', 'adorable', 'stunning', 'premium', 'luxury', 'soft', 'gift for her', 'gift for him', 'gift idea', 'great gift', 'must have', 'bestseller', 'sale', 'new']
const MATERIAL_WORDS = ['porcelain', 'stoneware', 'wool', 'cotton', 'silk', 'linen', 'leather', 'brass', 'copper', 'olive wood', 'wood', 'glass', 'beeswax', 'silver', 'gold plated']
const VAGUE = ['gift', 'gifts', 'items', 'item', 'stuff', 'goods', 'misc', 'miscellaneous', 'sample', 'samples', 'various', 'present']

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

function sizeFromText(text, tpl) {
  const t = text.toLowerCase()
  let m
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\b/))) {
    const ml = Number(m[1]) * 29.5735
    return { from: m[0], to: tpl?.drink ? `${Math.round(ml / 10) * 10} ml` : `${Math.round(Number(m[1]) * 28.35)} g` }
  }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(ft|in|")?/))) {
    const unit = m[3] === 'ft' ? 30.48 : 2.54
    return { from: m[0], to: `${Math.round(Number(m[1]) * unit)} x ${Math.round(Number(m[2]) * unit)} cm` }
  }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|")\b/))) return { from: m[0], to: `${Math.round(Number(m[1]) * 2.54)} cm` }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*lb\b/))) return { from: m[0], to: `${Math.round(Number(m[1]) * 453.6)} g` }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/))) return { from: m[0], to: `${m[1]} ${m[2] === 'l' ? 'L' : m[2]}` }
  if ((m = t.match(/\ba(\d)\b/))) return { from: m[0], to: `A${m[1]} size` }
  return null
}

function setFromText(text) {
  const t = text.toLowerCase()
  let m
  if ((m = t.match(/set of (\d+)/))) return { from: m[0], to: `set of ${m[1]}` }
  if ((m = t.match(/(\d+)\s*(?:pcs|pc|pieces|pk|pack)\b/))) return { from: m[0], to: `set of ${m[1]}` }
  if (/\bpair\b/.test(t)) return { from: 'pair', to: 'set of 2' }
  if (/\bduo\b/.test(t)) return { from: 'duo', to: 'set of 2' }
  return null
}

/**
 * Title -> customs description. Steps explain every change (abbreviation, filler removal,
 * unit conversion, HS template) so the screen can show why the text changed.
 */
export function normalizeDescription(title, { hsCode, sku } = {}) {
  const steps = []
  const original = String(title || '').trim()
  let s = original.toLowerCase()
  const abbr = [[/\bw\/o\b/g, 'without'], [/\bw\//g, 'with '], [/&/g, ' and '], [/\bpcs?\b/g, 'pieces'], [/\bhandwoven\b/g, 'hand woven'], [/\bhand made\b/g, 'handmade']]
  for (const [re, to] of abbr) {
    const m = s.match(re)
    if (m) { steps.push({ code: 'abbreviation', from: m[0].trim(), to: to.trim() }); s = s.replace(re, to) }
  }
  for (const f of FILLER) {
    const re = new RegExp(`\\b${f}\\b`, 'g')
    if (re.test(s)) { steps.push({ code: 'filler', from: f, to: '' }); s = s.replace(re, ' ') }
  }
  s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
  const code = normHs(hsCode)
  const tpl = code ? TEMPLATES[code] : null
  // size: title first, then the catalog product title (e.g. "12oz" of the catalog mug)
  let size = sizeFromText(original, tpl)
  if (!size && sku) {
    const p = db.find('products', x => x.sku === sku)
    const pt = p?.title && typeof p.title === 'object' ? p.title.en : p?.title
    if (pt) size = sizeFromText(pt, tpl)
  }
  if (size) steps.push({ code: 'unit', from: size.from.trim(), to: size.to })
  const set = setFromText(s)
  if (!tpl) {
    // no template: cleaned title, capitalized, HS description as qualifier when known
    const info = code ? hsDescribe(code) : null
    let text = cap(s.replace(/\b(set of \d+|\d+\s*pieces)\b/g, '').replace(/\s+/g, ' ').trim())
    if (info?.customsDesc) { text = `${text} (${info.customsDesc})`; steps.push({ code: 'hs_desc', from: '', to: info.customsDesc }) }
    return { text: text || original, steps, template: false }
  }
  const noun = tpl.nouns.find(n => s.includes(n)) || tpl.nouns[tpl.nouns.length - 1]
  const materials = MATERIAL_WORDS.filter(w => s.includes(w) && !(tpl.prefix || '').toLowerCase().includes(w))
  let head
  if (tpl.head) head = tpl.head
  else head = `${tpl.prefix} ${noun === 'cezve' ? 'coffee pot (cezve)' : noun}`
  const parts = [cap(head)]
  let material = tpl.material
  const extraMat = materials.filter(w => !material.includes(w) && !head.toLowerCase().includes(w))
  if (extraMat.length) material = `${extraMat.join(', ')}, ${material}`
  if (code === '6912.00' && s.includes('porcelain')) material = 'porcelain'
  parts.push(material)
  if (/\bhandmade|hand woven|hand carved|hand blown|hand painted\b/.test(s) && !material.includes('hand')) parts.push('handmade')
  if (/with handle/.test(s)) parts[0] += ' with handle'
  if (set) parts.push(set.to)
  if (size) parts.push(size.to)
  steps.push({ code: 'template', from: noun, to: parts[0] })
  return { text: parts.join(', '), steps, template: true }
}

// ---------------------------------------------------------------------------
// Draft preparation
// ---------------------------------------------------------------------------
function countries() { return db.all('countries') }
function country(code) { return countries().find(c => c.code === code) || null }
function countryName(code) {
  const c = country(code)
  return c ? c.name : { tr: code, en: code }
}
function productBySku(sku) { return sku ? db.find('products', p => p.sku === sku) : null }

function mergeItems(intl) {
  const map = new Map()
  for (const p of intl.parcels || []) {
    for (const it of p.items || []) {
      const k = it.sku || it.title
      const prev = map.get(k)
      if (prev) {
        prev.qty += Number(it.qty) || 0
        prev.weightKg += Number(it.weightKg) || 0
        prev.parcels.push(p.ref)
      } else {
        map.set(k, { key: k, sku: it.sku || '', title: it.title, qty: Number(it.qty) || 0, unitValue: Number(it.unitValueUsd) || 0, weightKg: Number(it.weightKg) || 0, hsCode: it.hsCode || null, origin: it.origin || null, parcels: [p.ref] })
      }
    }
  }
  return [...map.values()]
}

function thresholdUsd(dm) {
  if (!dm) return null
  const byCur = countries().find(c => c.currency === dm.currency)
  const fx = dm.currency === 'USD' ? 1 : (byCur?.fxToUsd ?? 1)
  return r2(dm.amount * fx)
}

function hsPrefixHit(code, list) {
  const digits = String(code || '').replace(/\D/g, '')
  for (const rule of list || []) {
    const hit = (rule.hsPrefixes || []).find(p => digits.startsWith(p))
    if (hit) return { rule, prefix: hit }
  }
  return null
}

function buildDraft(intl, { edits = {} } = {}) {
  const raw = mergeItems(intl)
  let fields = 0
  let auto = 0
  let corrected = 0
  const items = raw.map(it => {
    const e = edits[it.key] || {}
    const edited = []
    const p = productBySku(it.sku)
    // HS: item -> catalog -> model
    let hsCode = normHs(it.hsCode)
    let hsSource = hsCode ? 'item' : 'none'
    let hsConfidence = hsCode ? 1 : null
    if (!hsCode && normHs(p?.hsCode)) { hsCode = normHs(p.hsCode); hsSource = 'catalog'; hsConfidence = 1 }
    let hsTop = null
    if (!hsCode) {
      const r = hsSuggest(it.title, (p?.tags || []).join(' '))
      if (r.top?.length) { hsCode = r.top[0].code; hsSource = 'model'; hsConfidence = r.top[0].prob; hsTop = r.top }
    }
    if (e.hsCode && normHs(e.hsCode) && normHs(e.hsCode) !== hsCode) { hsCode = normHs(e.hsCode); hsSource = 'user'; hsConfidence = 1; edited.push('hsCode') }
    const norm = normalizeDescription(it.title, { hsCode, sku: it.sku })
    let description = norm.text
    let descriptionSource = norm.template ? 'template' : 'rule'
    if (e.description != null && String(e.description).trim() && String(e.description).trim() !== description) {
      description = String(e.description).trim(); descriptionSource = 'user'; edited.push('description')
    }
    let origin = it.origin || p?.origin || intl.origin || null
    let originSource = it.origin ? 'item' : p?.origin ? 'catalog' : intl.origin ? 'shipment' : 'none'
    if (e.origin && e.origin !== origin) { origin = String(e.origin).toUpperCase(); originSource = 'user'; edited.push('origin') }
    // field accounting: description, hsCode, origin, qty, unitValue, weight. A field counts as
    // auto-filled when the system produced it with enough confidence to need no review:
    // HS from the model needs >= 0.8 probability, descriptions need a matching HS template.
    const needsReview = (hsSource === 'model' && (hsConfidence ?? 0) < REVIEW_PROB ? 1 : 0) + (descriptionSource === 'rule' ? 1 : 0)
    const filled = [description, hsCode, origin, it.qty, it.unitValue, it.weightKg]
    fields += filled.length
    auto += Math.max(0, filled.filter(v => v != null && v !== '' && v !== 0).length - edited.length - needsReview)
    corrected += edited.length
    const info = hsCode ? hsDescribe(hsCode) : null
    return {
      key: it.key,
      sku: it.sku,
      title: it.title,
      description,
      descriptionSource,
      normalization: norm.steps,
      autoDescription: norm.text,
      hsCode,
      hsSource,
      hsConfidence,
      hsTop,
      hsDesc: info?.desc || null,
      origin,
      originSource,
      qty: it.qty,
      unitValue: r2(it.unitValue),
      totalValue: r2(it.unitValue * it.qty),
      weightKg: r3(it.weightKg),
      parcels: it.parcels,
      edited,
      needsReview: needsReview > 0,
    }
  })
  const value = r2(items.reduce((s, i) => s + i.totalValue, 0))
  const weightKg = r3(items.reduce((s, i) => s + i.weightKg, 0))
  const grossKg = Number(intl.totalWeightKg) || r2(weightKg * 1.08)
  const qty = items.reduce((s, i) => s + i.qty, 0)
  const declared = r2(intl.declaredValueUsd ?? value)
  const form = value <= CN22_LIMIT_USD ? 'cn22' : 'cn23'
  const dest = country('US')
  const orig = country(intl.origin)
  const dm = dest?.deMinimis || { status: 'suspended', amount: 800, currency: 'USD' }
  const dmUsd = thresholdUsd(dm)
  // suspended de minimis: no exemption, every shipment is declared and dutiable
  const dmSuspended = deMinimisSuspended(dm)
  const deMinimis = { country: 'US', status: dmSuspended ? 'suspended' : 'applied', suspended: dmSuspended, threshold: dm.amount, currency: dm.currency, thresholdUsd: dmUsd, exceeded: dmSuspended || value > dmUsd }
  // header fields: form, exporter, importer, contentType, totals
  fields += 5
  auto += 5

  const checks = []
  checks.push(dmSuspended
    ? { code: 'DE_MINIMIS_SUSPENDED', severity: 'warning', country: 'US', params: { value, threshold: dm.amount, currency: dm.currency } }
    : deMinimis.exceeded
    ? { code: 'DE_MINIMIS_EXCEEDED', severity: 'warning', country: 'US', params: { value, threshold: dm.amount, currency: dm.currency } }
    : { code: 'DE_MINIMIS_OK', severity: 'success', country: 'US', params: { value, threshold: dm.amount, currency: dm.currency } })
  checks.push(form === 'cn22'
    ? { code: 'FORM_CN22', severity: 'info', country: null, params: { value, limit: CN22_LIMIT_USD } }
    : { code: 'FORM_CN23', severity: 'info', country: null, params: { value, limit: CN22_LIMIT_USD } })
  for (const it of items) {
    if (!it.hsCode) checks.push({ code: 'HS_MISSING', severity: 'danger', country: null, params: { item: it.title } })
    else {
      const imp = hsPrefixHit(it.hsCode, dest?.prohibited)
      if (imp) checks.push({ code: 'PROHIBITED_IMPORT', severity: 'danger', country: 'US', params: { item: it.title, code: it.hsCode, category: imp.rule.category, prefix: imp.prefix } })
      const exp = hsPrefixHit(it.hsCode, orig?.prohibited)
      if (exp) checks.push({ code: 'PROHIBITED_EXPORT', severity: 'danger', country: intl.origin, params: { item: it.title, code: it.hsCode, category: exp.rule.category, prefix: exp.prefix } })
      if (it.hsSource === 'model' && it.hsConfidence != null && it.hsConfidence < 0.55) checks.push({ code: 'HS_LOW_CONFIDENCE', severity: 'warning', country: null, params: { item: it.title, code: it.hsCode, prob: it.hsConfidence } })
    }
    if (!it.origin) checks.push({ code: 'ORIGIN_MISSING', severity: 'warning', country: null, params: { item: it.title } })
    const words = it.description.toLowerCase().split(/[^a-z]+/).filter(Boolean)
    if (!words.length || (words.length <= 2 && words.every(w => VAGUE.includes(w)))) checks.push({ code: 'VAGUE_DESCRIPTION', severity: 'warning', country: null, params: { item: it.title } })
  }
  if (Math.abs(declared - value) > Math.max(1, declared * 0.01)) checks.push({ code: 'VALUE_MISMATCH', severity: 'warning', country: null, params: { declared, value } })
  checks.push(weightKg <= grossKg + 0.001
    ? { code: 'WEIGHT_OK', severity: 'success', country: null, params: { net: weightKg, gross: grossKg } }
    : { code: 'WEIGHT_MISMATCH', severity: 'warning', country: null, params: { net: weightKg, gross: grossKg } })
  if (!checks.some(c => c.code.startsWith('PROHIBITED'))) checks.push({ code: 'PROHIBITED_NONE', severity: 'success', country: 'US', params: { origin: intl.origin } })

  const reference = countries().filter(c => c.deMinimis).map(c => {
    const tUsd = thresholdUsd(c.deMinimis)
    const susp = deMinimisSuspended(c.deMinimis)
    return { code: c.code, name: c.name, flag: c.flag, role: c.role, status: susp ? 'suspended' : 'applied', suspended: susp, threshold: c.deMinimis.amount, currency: c.deMinimis.currency, thresholdUsd: tUsd, exceeded: susp || value > tUsd, vatRate: c.vatRate ?? 0, applies: c.code === 'US', isNewMarket: !!c.isNewMarket }
  })

  const buildItems = items.map(i => ({ sku: i.sku, description: i.description, hsCode: i.hsCode || '', origin: i.origin || '', qty: i.qty, unitValue: i.unitValue, totalValue: i.totalValue, weightKg: i.weightKg }))
  return {
    shipment: intl,
    id: intl.id,
    items,
    form,
    totals: { value, declared, weightKg, grossKg, qty, parcels: intl.parcelCount || intl.parcels?.length || 0 },
    deMinimis,
    checks,
    reference,
    originCountry: intl.origin,
    stats: { fields, auto: Math.max(0, auto), corrected, rate: fields ? r3(Math.max(0, auto) / fields) : 0 },
    buildOpts: { items: buildItems, deMinimis: { threshold: dm.amount, currency: dm.currency, suspended: dmSuspended, exceeded: deMinimis.exceeded } },
  }
}

function getIntl(id) {
  const s = db.get('intl_shipments', id)
  if (!s) throw new ApiError('NOT_FOUND', 'International shipment not found', 404)
  return s
}

export function prepareCustomsDocsSync(intlId, opts = {}) {
  return buildDraft(plain(getIntl(intlId)), opts)
}

export function prepareCustomsDocs(intlId, opts = {}) {
  return request('POST /v1/customs/documents/prepare', () => buildDraft(plain(getIntl(intlId)), opts), { minMs: 350, maxMs: 750 })
}

export function listCustomsShipments({ search } = {}) {
  return request('GET /v1/customs/shipments', () => {
    const q = String(search || '').trim().toLowerCase()
    return db.all('intl_shipments')
      .filter(s => !q || [s.id, s.sender?.company, s.sender?.name, s.mawb].some(v => String(v || '').toLowerCase().includes(q)))
      .map(s => {
        const items = mergeItems(s)
        const value = r2(items.reduce((a, i) => a + i.unitValue * i.qty, 0))
        return {
          id: s.id,
          origin: s.origin,
          originName: countryName(s.origin),
          stage: s.stage,
          customsStatus: s.customsStatus || null,
          sender: s.sender,
          destHub: s.destHub,
          parcels: s.parcelCount || s.parcels?.length || 0,
          itemCount: items.length,
          declaredValueUsd: s.declaredValueUsd ?? value,
          currency: s.currency,
          declaredValueLocal: s.declaredValueLocal,
          form: value <= CN22_LIMIT_USD ? 'cn22' : 'cn23',
          customsDocs: s.customsDocs || [],
          docsAttached: !!s.customsDocsMeta,
          docsMeta: s.customsDocsMeta || null,
          createdAt: s.createdAt,
        }
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }, { minMs: 300, maxMs: 700 })
}

export function attachCustomsDocs(intlId, { edits = {}, include = ['commercial_invoice', 'auto'] } = {}) {
  return request('POST /v1/customs/documents/attach', async () => {
    const intl = getIntl(intlId)
    const d = buildDraft(plain(intl), { edits })
    if (d.checks.some(c => c.severity === 'danger')) throw new ApiError('CHECKS_FAILED', 'Blocking customs checks', 422, { checks: d.checks.filter(c => c.severity === 'danger').map(c => c.code) })
    const types = include.map(k => (k === 'auto' ? d.form : k)).filter((k, i, a) => a.indexOf(k) === i)
    const at = nowIso()
    const by = session.user?.name ?? 'system'
    const docNo = 'CI-' + String(intl.id).replace(/^INT-/, '')
    const documents = []
    await db.transaction(async () => {
      for (const type of types) {
        const prefix = type === 'commercial_invoice' ? 'CI' : type.toUpperCase()
        const rec = {
          id: 'CDOC-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          intlId: intl.id,
          type,
          docNo: `${prefix}-${String(intl.id).replace(/^INT-/, '')}`,
          form: d.form,
          at,
          by,
          valueUsd: d.totals.value,
          items: d.items.length,
          autoRate: d.stats.rate,
          corrected: d.stats.corrected,
          fields: d.stats.fields,
          source: 'automation',
        }
        db.insert('customsDocuments', rec)
        documents.push(rec)
      }
      db.update('intl_shipments', intl.id, {
        customsDocs: types,
        customsDocsMeta: {
          attachedAt: at,
          by,
          form: d.form,
          docNo,
          valueUsd: d.totals.value,
          deMinimisExceeded: d.deMinimis.exceeded,
          autoRate: d.stats.rate,
          corrected: d.stats.corrected,
          items: d.items.map(i => ({ sku: i.sku, description: i.description, hsCode: i.hsCode, origin: i.origin, qty: i.qty, unitValue: i.unitValue, weightKg: i.weightKg, hsSource: i.hsSource, descriptionSource: i.descriptionSource })),
        },
      })
    })
    modelEvent('customs', 'predict', {
      tr: `${intl.id} için gümrük belgeleri üretildi ve iliştirildi (${types.map(x => x.toUpperCase().replace('COMMERCIAL_INVOICE', 'Ticari fatura')).join(', ')}), otomatik alan oranı %${Math.round(d.stats.rate * 100)}`,
      en: `Customs documents generated and attached to ${intl.id} (${types.map(x => x.toUpperCase().replace('COMMERCIAL_INVOICE', 'Commercial invoice')).join(', ')}), auto-filled fields ${Math.round(d.stats.rate * 100)}%`,
    })
    if (d.stats.corrected) {
      modelEvent('customs', 'feedback', {
        tr: `${intl.id}: kullanıcı ${d.stats.corrected} alanı düzeltti`,
        en: `${intl.id}: user corrected ${d.stats.corrected} fields`,
      })
    }
    audit('customs.docs.attach', intl.id, { tr: `${types.length} gümrük belgesi iliştirildi`, en: `${types.length} customs documents attached` })
    return { shipment: db.get('intl_shipments', intl.id), documents, stats: d.stats }
  }, { minMs: 500, maxMs: 900 })
}

export function listCustomsDocuments({ intlId } = {}) {
  return request('GET /v1/customs/documents', () => {
    const own = db.all('customsDocuments').filter(d => !intlId || d.intlId === intlId)
    const withOwn = new Set(db.all('customsDocuments').map(d => d.intlId + '|' + d.type))
    // documents generated before this session (seed): one record per listed type
    const seed = []
    for (const s of db.all('intl_shipments')) {
      if (intlId && s.id !== intlId) continue
      if (s.customsDocsMeta) continue
      for (const type of s.customsDocs || []) {
        if (withOwn.has(s.id + '|' + type)) continue
        const prefix = type === 'commercial_invoice' ? 'CI' : type.toUpperCase()
        seed.push({ id: `SEED-${s.id}-${type}`, intlId: s.id, type, docNo: `${prefix}-${String(s.id).replace(/^INT-/, '')}`, form: (s.customsDocs || []).includes('cn22') ? 'cn22' : 'cn23', at: s.createdAt, by: null, valueUsd: s.declaredValueUsd, items: null, autoRate: null, corrected: null, source: 'seed' })
      }
    }
    return [...own, ...seed].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, { minMs: 250, maxMs: 550 })
}

export function automationStats() {
  return request('GET /v1/customs/automation/stats', () => {
    const list = db.all('intl_shipments')
    let fields = 0
    let autoFields = 0
    let descNormalized = 0
    let itemsTotal = 0
    let cn22 = 0
    let cn23 = 0
    let dmExceeded = 0
    const hsBySource = { item: 0, catalog: 0, model: 0, none: 0, user: 0 }
    for (const s of list) {
      const d = buildDraft(plain(s))
      fields += d.stats.fields
      autoFields += d.stats.auto
      for (const i of d.items) {
        itemsTotal++
        hsBySource[i.hsSource] = (hsBySource[i.hsSource] || 0) + 1
        if (i.description.toLowerCase() !== String(i.title).toLowerCase()) descNormalized++
      }
      if (d.form === 'cn22') cn22++
      else cn23++
      if (d.deMinimis.exceeded) dmExceeded++
    }
    const sets = db.all('customsDocuments').reduce((m, d) => m.set(d.intlId + '|' + d.at, d), new Map())
    const setList = [...sets.values()]
    const setFields = setList.reduce((a, d) => a + (d.fields || 0), 0)
    const corrected = setList.reduce((a, d) => a + (d.corrected || 0), 0)
    return {
      shipments: list.length,
      items: itemsTotal,
      fields,
      autoFields,
      autoRate: fields ? r3(autoFields / fields) : 0,
      hsBySource,
      descNormalized,
      descNormalizedRate: itemsTotal ? r3(descNormalized / itemsTotal) : 0,
      sets: setList.length,
      setFields,
      correctedFields: corrected,
      correctionRate: setFields ? r3(corrected / setFields) : 0,
      cn22,
      cn23,
      deMinimisExceeded: dmExceeded,
    }
  }, { minMs: 300, maxMs: 650 })
}

/**
 * Product catalog with HS status (read only, used by the HS screen 6.5).
 * listCatalogHs() -> [{ sku, title, hsCode, hsStatus: 'confirmed'|'missing'|'ai_pending', hsSuggestion, origin, value, tags }]
 * Products without an HS code come first.
 */
export function listCatalogHs() {
  return request('GET /v1/catalog/products', () => db.all('products')
    .map(p => plain({ sku: p.sku, title: p.title, hsCode: p.hsCode || null, hsStatus: p.hsStatus || (p.hsCode ? 'confirmed' : 'missing'), hsSuggestion: p.hsSuggestion || null, origin: p.origin || null, value: p.value, tags: p.tags || [] }))
    .sort((a, b) => (a.hsCode ? 1 : 0) - (b.hsCode ? 1 : 0) || String(a.sku).localeCompare(String(b.sku))), { minMs: 250, maxMs: 550 })
}
