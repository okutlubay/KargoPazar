/**
 * Seeded pseudo random number generator (mulberry32) and helpers.
 *
 * Pure JavaScript, no dependencies: used by the browser app (AI models,
 * order sync generator) and by `scripts/generate-seed.mjs` under Node.
 *
 *   const rng = mulberry32(20261001)
 *   rng()                        // float in [0, 1)
 *   randInt(rng, 1, 6)           // integer in [1, 6] (inclusive)
 *   randFloat(rng, 0.4, 6.8, 2)  // float in [0.4, 6.8], rounded to 2 decimals
 *   pick(rng, ['a', 'b'])        // one element
 *   weightedPick(rng, ['a', 'b'], [3, 1])       // weights array
 *   weightedPick(rng, { a: 3, b: 1 })           // object map value -> weight
 *   weightedPick(rng, [['a', 3], ['b', 1]])     // pairs
 *   normal(rng, 0, 0.07)         // Box-Muller gaussian
 *   shuffle(rng, arr)            // new shuffled array (Fisher-Yates)
 *   chance(rng, 0.25)            // boolean
 */

export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash a string into a 32-bit seed (FNV-1a). Handy for per-entity deterministic streams. */
export function hashSeed(str) {
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}

export function randFloat(rng, min, max, decimals) {
  const v = min + rng() * (max - min)
  if (decimals == null) return v
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

export function chance(rng, p) {
  return rng() < p
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

export function weightedPick(rng, items, weights) {
  let values
  let ws
  if (Array.isArray(items)) {
    if (Array.isArray(weights)) {
      values = items
      ws = weights
    } else if (items.length && Array.isArray(items[0])) {
      values = items.map((p) => p[0])
      ws = items.map((p) => p[1])
    } else {
      values = items
      ws = items.map(() => 1)
    }
  } else {
    values = Object.keys(items)
    ws = values.map((k) => items[k])
  }
  const total = ws.reduce((s, w) => s + w, 0)
  let r = rng() * total
  for (let i = 0; i < values.length; i++) {
    r -= ws[i]
    if (r < 0) return values[i]
  }
  return values[values.length - 1]
}

export function normal(rng, mean = 0, sd = 1) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return mean + z * sd
}

export function shuffle(rng, arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

/** Convenience wrapper: createRng(seed).int(1, 6), .pick(arr) ... */
export function createRng(seed) {
  const rng = mulberry32(seed)
  return {
    next: rng,
    float: (min = 0, max = 1, d) => randFloat(rng, min, max, d),
    int: (min, max) => randInt(rng, min, max),
    pick: (arr) => pick(rng, arr),
    weighted: (items, weights) => weightedPick(rng, items, weights),
    normal: (m, s) => normal(rng, m, s),
    shuffle: (arr) => shuffle(rng, arr),
    chance: (p) => chance(rng, p),
  }
}
