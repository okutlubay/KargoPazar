/**
 * Shipping rules engine (spec 8.7). Rule = conditions (all must match, AND) + actions.
 * Used by rate shopping (api/rates.js), shipment creation (api/shipments.js) and batch.
 *
 * ---------------------------------------------------------------------------
 * API summary
 * ---------------------------------------------------------------------------
 * RULE_FIELDS            [{ id, type: 'state'|'number'|'enum'|'text'|'country', ops: [...], unit? }]
 * RULE_OPS               ['eq','ne','in','not_in','gt','gte','lt','lte','contains']
 * RULE_ACTIONS           [{ id, params: ['carrier'|'service'|'hub'|'value'|'tag'] }]
 *   labels: t('core.rules.fields.<id>'), t('core.rules.ops.<op>'), t('core.rules.actions.<id>')
 *
 * buildRuleContext({ order?, to?, pkg?, declaredValue?, channel?, items? })
 *   -> { destState, destCountry, declaredValue, weightLb, channel, skus: [], productTags: [] }
 *   (product tags are looked up from the `products` collection by SKU)
 *
 * evaluate(ctx, { rules? }) -> { matched: [{ rule, actions }], effects }
 *   rules default: active rules from db 'rules', sorted by priority.
 *   effects = {
 *     forceService: { carrier, service, ruleId, ruleName } | null,
 *     forceCarrier: { carrier, ruleId, ruleName } | null,
 *     excludeCarriers: [{ carrier, ruleId, ruleName }],
 *     insurance: { ruleId, ruleName } | null        (insurance forced on and locked)
 *     signature: { ruleId, ruleName } | null
 *     hub: { hub, ruleId, ruleName } | null          (first matching rule wins)
 *     tags: [{ tag, ruleId }],
 *     hold: { ruleId, ruleName } | null,
 *     maxTransitDays: { value, ruleId, ruleName } | null,
 *     strategy: { value: 'cheapest'|'fastest', ruleId, ruleName } | null,
 *     ruleNames: [{tr,en}]                           (names of matched rules, in priority order)
 *   }
 *   Conflicts: the higher priority (lower number) rule wins for single-valued effects.
 *
 * applyEffectsToQuotes(quotes, effects) -> { quotes, forcedKey, notes: [{code, ruleName, ...}] }
 *   Removes excluded carriers, keeps only the forced service/carrier, and filters by
 *   maxTransitDays. If a filter would leave nothing, it is skipped and a note is added.
 *
 * matchCondition(cond, ctx) -> boolean
 * describeRule(rule, t, tx) -> string   (human readable one-liner for lists)
 *
 * Rules CRUD (wrapped in request(), for Settings > Shipping rules):
 *   listRules() -> Rule[] sorted by priority
 *   saveRule(rule) -> Rule                (insert when no id / unknown id; validates)
 *   removeRule(id) -> { removed: Rule }   restoreRule(rule) -> Rule   (undo)
 *   setRuleActive(id, active) -> Rule
 *   reorderRules(ids) -> Rule[]           (priority = index + 1)
 *   testRules(sample) -> { ctx, matched: [{ id, name, actions }], effects }
 *     sample: an order id, an order object, or a raw context.
 *   recordTriggers(ruleIds) -> void       (bumps triggerCount / lastTriggeredAt; called by shipments)
 *
 * Rule shape: { id, priority, active, name: {tr,en}, conditions: [{ field, op, value }],
 *   actions: [{ type, carrier?, service?, hub?, value?, tag? }], createdAt, updatedAt,
 *   lastTriggeredAt, triggerCount }
 */
import { db } from './db.js'
import { audit } from './events.js'
import { request, ApiError } from '../api/client.js'

export const RULE_OPS = ['eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains']

export const RULE_FIELDS = [
  { id: 'destState', type: 'state', ops: ['eq', 'ne', 'in', 'not_in'] },
  { id: 'declaredValue', type: 'number', unit: 'USD', ops: ['gt', 'gte', 'lt', 'lte', 'eq'] },
  { id: 'weightLb', type: 'number', unit: 'lb', ops: ['gt', 'gte', 'lt', 'lte', 'eq'] },
  { id: 'channel', type: 'enum', options: ['shopify', 'etsy', 'amazon', 'ebay', 'woocommerce', 'manual', 'api'], ops: ['eq', 'ne', 'in', 'not_in'] },
  { id: 'sku', type: 'text', ops: ['eq', 'in', 'contains'] },
  { id: 'productTag', type: 'text', ops: ['eq', 'in', 'contains'] },
  { id: 'destCountry', type: 'country', ops: ['eq', 'ne', 'in', 'not_in'] },
]

export const RULE_ACTIONS = [
  { id: 'force_service', params: ['carrier', 'service'] },
  { id: 'force_carrier', params: ['carrier'] },
  { id: 'exclude_carrier', params: ['carrier'] },
  { id: 'add_insurance', params: [] },
  { id: 'require_signature', params: [] },
  { id: 'assign_hub', params: ['hub'] },
  { id: 'add_tag', params: ['tag'] },
  { id: 'hold', params: [] },
  { id: 'max_transit_days', params: ['value'] },
  { id: 'select_strategy', params: ['value'] },
]

const FIELD_ALIASES = { weight: 'weightLb', state: 'destState', country: 'destCountry', value: 'declaredValue', tag: 'productTag' }

function asList(v) {
  if (Array.isArray(v)) return v
  if (v == null || v === '') return []
  return String(v).split(',').map(s => s.trim()).filter(Boolean)
}

function norm(v) { return typeof v === 'string' ? v.trim().toLowerCase() : v }

export function buildRuleContext({ order = null, to = null, pkg = null, declaredValue = null, channel = null, items = null } = {}) {
  const addr = to ?? order?.shipTo ?? {}
  const its = items ?? order?.items ?? []
  const p = pkg ?? order?.package ?? null
  const value = declaredValue ?? (its.length ? its.reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.qty) || 1), 0) : order?.total ?? 0)
  const skus = its.map(i => i.sku).filter(Boolean)
  const products = db.all('products')
  const productTags = [...new Set(skus.flatMap(sku => products.find(p2 => p2.sku === sku)?.tags ?? []))]
  const weightLb = p?.weightLb != null ? Number(p.weightLb) : its.reduce((s, i) => s + (Number(i.weightLb) || 0) * (Number(i.qty) || 1), 0)
  return {
    destState: (addr.state || '').toUpperCase(),
    destCountry: (addr.country || 'US').toUpperCase(),
    declaredValue: Number(value) || 0,
    weightLb: Math.round((Number(weightLb) || 0) * 100) / 100,
    channel: channel ?? order?.channel ?? 'manual',
    skus,
    productTags,
  }
}

function ctxValues(field, ctx) {
  const f = FIELD_ALIASES[field] ?? field
  if (f === 'sku') return ctx.skus ?? []
  if (f === 'productTag') return ctx.productTags ?? []
  return [ctx[f]]
}

export function matchCondition(cond, ctx) {
  if (!cond || !cond.field) return true
  const values = ctxValues(cond.field, ctx)
  const op = cond.op ?? 'eq'
  const target = cond.value
  const test = v => {
    switch (op) {
      case 'eq': return norm(v) == norm(target) // eslint-disable-line eqeqeq
      case 'ne': return norm(v) != norm(target) // eslint-disable-line eqeqeq
      case 'in': return asList(target).map(norm).includes(norm(v))
      case 'not_in': return !asList(target).map(norm).includes(norm(v))
      case 'gt': return Number(v) > Number(target)
      case 'gte': return Number(v) >= Number(target)
      case 'lt': return Number(v) < Number(target)
      case 'lte': return Number(v) <= Number(target)
      case 'contains': return String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase())
      default: return false
    }
  }
  // Multi-valued fields (sku, productTag): negative ops need every value to pass, positive ops any.
  if (values.length === 0) return op === 'ne' || op === 'not_in'
  if (op === 'ne' || op === 'not_in') return values.every(test)
  return values.some(test)
}

function activeRules() {
  return [...db.all('rules')].filter(r => r.active !== false).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
}

function emptyEffects() {
  return {
    forceService: null, forceCarrier: null, excludeCarriers: [], insurance: null, signature: null,
    hub: null, tags: [], hold: null, maxTransitDays: null, strategy: null, ruleNames: [],
  }
}

export function evaluate(ctx, { rules } = {}) {
  const list = rules ?? activeRules()
  const matched = []
  const effects = emptyEffects()
  for (const rule of list) {
    if (rule.active === false) continue
    const conds = rule.conditions ?? []
    if (!conds.every(c => matchCondition(c, ctx))) continue
    const actions = rule.actions ?? []
    matched.push({ rule, actions })
    effects.ruleNames.push(rule.name)
    const src = { ruleId: rule.id, ruleName: rule.name }
    for (const a of actions) {
      switch (a.type) {
        case 'force_service': if (!effects.forceService) effects.forceService = { carrier: a.carrier, service: a.service, ...src }; break
        case 'force_carrier': if (!effects.forceCarrier) effects.forceCarrier = { carrier: a.carrier, ...src }; break
        case 'exclude_carrier': effects.excludeCarriers.push({ carrier: a.carrier, ...src }); break
        case 'add_insurance': if (!effects.insurance) effects.insurance = src; break
        case 'require_signature': if (!effects.signature) effects.signature = src; break
        case 'assign_hub': if (!effects.hub) effects.hub = { hub: a.hub, ...src }; break
        case 'add_tag': if (a.tag ?? a.value) effects.tags.push({ tag: a.tag ?? a.value, ruleId: rule.id }); break
        case 'hold': if (!effects.hold) effects.hold = src; break
        case 'max_transit_days': if (!effects.maxTransitDays) effects.maxTransitDays = { value: Number(a.value), ...src }; break
        case 'select_strategy': if (!effects.strategy) effects.strategy = { value: a.value, ...src }; break
        default: break
      }
    }
  }
  return { matched, effects }
}

export function applyEffectsToQuotes(quotes, effects) {
  let list = [...quotes]
  const notes = []
  let forcedKey = null
  if (!effects) return { quotes: list, forcedKey, notes }
  if (effects.excludeCarriers.length) {
    const ex = new Set(effects.excludeCarriers.map(e => e.carrier))
    const next = list.filter(q => !ex.has(q.carrierCode))
    if (next.length) {
      for (const e of effects.excludeCarriers) notes.push({ code: 'excluded', carrier: e.carrier, ruleName: e.ruleName })
      list = next
    } else notes.push({ code: 'exclude_skipped', ruleName: effects.excludeCarriers[0].ruleName })
  }
  if (effects.forceService) {
    const f = effects.forceService
    const next = list.filter(q => q.carrierCode === f.carrier && q.serviceCode === f.service)
    if (next.length) {
      list = next
      forcedKey = (next.find(q => q.source !== 'own') ?? next[0]).key
      notes.push({ code: 'forced_service', carrier: f.carrier, service: f.service, ruleName: f.ruleName })
    } else notes.push({ code: 'forced_unavailable', carrier: f.carrier, service: f.service, ruleName: f.ruleName })
  } else if (effects.forceCarrier) {
    const f = effects.forceCarrier
    const next = list.filter(q => q.carrierCode === f.carrier)
    if (next.length) { list = next; notes.push({ code: 'forced_carrier', carrier: f.carrier, ruleName: f.ruleName }) } else notes.push({ code: 'forced_unavailable', carrier: f.carrier, ruleName: f.ruleName })
  }
  if (effects.maxTransitDays && !forcedKey) {
    const m = effects.maxTransitDays
    const next = list.filter(q => q.etaDays != null && q.etaDays <= m.value)
    if (next.length) { list = next; notes.push({ code: 'max_transit', value: m.value, ruleName: m.ruleName }) } else notes.push({ code: 'max_transit_skipped', value: m.value, ruleName: m.ruleName })
  }
  return { quotes: list, forcedKey, notes }
}

export function describeRule(rule, t, tx) {
  const conds = (rule.conditions ?? []).map(c => {
    const v = Array.isArray(c.value) ? c.value.join(', ') : c.value
    return `${t('core.rules.fields.' + (FIELD_ALIASES[c.field] ?? c.field))} ${t('core.rules.ops.' + c.op)} ${v}`
  }).join(` ${t('core.rules.and')} `)
  const acts = (rule.actions ?? []).map(a => {
    const p = [a.carrier, a.service, a.hub, a.tag, a.value].filter(x => x != null && x !== '').join(' ')
    return t('core.rules.actions.' + a.type) + (p ? ` (${p})` : '')
  }).join(', ')
  return `${tx(rule.name)}: ${conds || t('core.rules.always')} > ${acts}`
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function sorted() { return [...db.all('rules')].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)) }

function validateRule(rule) {
  const errors = {}
  if (!rule.name || (!rule.name.tr && !rule.name.en && typeof rule.name !== 'string')) errors.name = 'required'
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) errors.actions = 'required'
  for (const c of rule.conditions ?? []) {
    const f = RULE_FIELDS.find(x => x.id === (FIELD_ALIASES[c.field] ?? c.field))
    if (!f) errors.conditions = 'invalid_field'
    else if (!RULE_OPS.includes(c.op)) errors.conditions = 'invalid_op'
    else if (c.value == null || c.value === '' || (Array.isArray(c.value) && !c.value.length)) errors.conditions = 'value_required'
    else if (f.type === 'number' && !Number.isFinite(Number(c.value))) errors.conditions = 'number'
  }
  for (const a of rule.actions ?? []) {
    const def = RULE_ACTIONS.find(x => x.id === a.type)
    if (!def) { errors.actions = 'invalid_action'; continue }
    for (const p of def.params) if (a[p] == null || a[p] === '') errors.actions = 'param_required'
  }
  if (Object.keys(errors).length) throw new ApiError('VALIDATION', 'Invalid rule', 422, errors)
}

export function listRules() {
  return request('GET /v1/rules', () => sorted(), { minMs: 250, maxMs: 500 })
}

export function saveRule(input) {
  return request(input.id ? `PUT /v1/rules/${input.id}` : 'POST /v1/rules', () => {
    const rule = { ...input, name: typeof input.name === 'string' ? { tr: input.name, en: input.name } : input.name }
    validateRule(rule)
    const now = new Date().toISOString()
    if (rule.id && db.get('rules', rule.id)) {
      const { id, createdAt, triggerCount, lastTriggeredAt, ...patch } = rule
      const r = db.update('rules', id, { ...patch, updatedAt: now })
      audit('rule.update', id, r.name)
      return r
    }
    const n = db.nextId('RUL').split('-')[1]
    const id = `RUL-${String(n).padStart(3, '0')}`
    const r = db.insert('rules', {
      id, priority: sorted().length + 1, active: true, conditions: [], actions: [],
      ...rule, id, createdAt: now, updatedAt: now, lastTriggeredAt: null, triggerCount: 0,
    }, { prepend: false })
    audit('rule.create', id, r.name)
    return r
  })
}

export function removeRule(id) {
  return request(`DELETE /v1/rules/${id}`, () => {
    const r = db.remove('rules', id)
    if (!r) throw new ApiError('NOT_FOUND', 'Rule not found', 404)
    audit('rule.delete', id, r.name)
    return { removed: r }
  })
}

export function restoreRule(rule) {
  return request('POST /v1/rules', () => {
    if (!db.get('rules', rule.id)) db.insert('rules', rule, { prepend: false })
    audit('rule.restore', rule.id, rule.name)
    return db.get('rules', rule.id)
  }, { minMs: 150, maxMs: 300 })
}

export function setRuleActive(id, active) {
  return request(`PATCH /v1/rules/${id}`, () => {
    if (!db.get('rules', id)) throw new ApiError('NOT_FOUND', 'Rule not found', 404)
    const r = db.update('rules', id, { active: !!active, updatedAt: new Date().toISOString() })
    audit(active ? 'rule.enable' : 'rule.disable', id, r.name)
    return r
  }, { minMs: 200, maxMs: 400 })
}

export function reorderRules(ids) {
  return request('POST /v1/rules/reorder', async () => {
    await db.transaction(() => {
      ids.forEach((id, i) => { if (db.get('rules', id)) db.update('rules', id, { priority: i + 1 }) })
    })
    audit('rule.reorder', null, ids.join(', '))
    return sorted()
  }, { minMs: 200, maxMs: 400 })
}

export function testRules(sample) {
  return request('POST /v1/rules/test', () => {
    let ctx
    if (typeof sample === 'string') {
      const order = db.get('orders', sample)
      if (!order) throw new ApiError('NOT_FOUND', 'Order not found', 404)
      ctx = buildRuleContext({ order })
    } else if (sample && (sample.shipTo || sample.items)) ctx = buildRuleContext({ order: sample })
    else ctx = { skus: [], productTags: [], destCountry: 'US', ...sample }
    const { matched, effects } = evaluate(ctx)
    return { ctx, matched: matched.map(m => ({ id: m.rule.id, name: m.rule.name, actions: m.actions })), effects }
  }, { minMs: 250, maxMs: 500 })
}

/** Called by shipment creation when rules were applied (no latency, inside a transaction). */
export function recordTriggers(ruleIds) {
  const now = new Date().toISOString()
  for (const id of new Set(ruleIds)) {
    if (db.get('rules', id)) db.update('rules', id, r => ({ triggerCount: (r.triggerCount ?? 0) + 1, lastTriggeredAt: now }))
  }
}
