// Chart palette built on the design tokens in src/styles.css.
// Every value is a CSS color string (var() or oklch()/color-mix()), so it must be
// applied through `style` bindings (fill/stroke/background), never as a raw attribute.

/** Categorical series colors, in order. Hues chosen to sit next to --accent. */
export const SERIES_COLORS = [
  'var(--accent)',
  'oklch(0.66 0.11 200)',   // teal
  'var(--warning)',
  'oklch(0.60 0.16 330)',   // magenta
  'var(--success)',
  'oklch(0.55 0.03 265)',   // slate
  'var(--danger)',
  'oklch(0.70 0.12 120)',   // olive
  'oklch(0.62 0.14 295)',   // violet
  'oklch(0.66 0.13 45)',    // orange
]

export function seriesColor(index, explicit) {
  if (explicit) return explicit
  return SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length]
}

/** Transparent tint of any CSS color: alpha(color, 0.2). */
export function alpha(color, a) {
  const pct = Math.round(Math.max(0, Math.min(1, a)) * 100)
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

/** Mix two CSS colors: mix(a, b, t) with t=0 -> a, t=1 -> b. */
export function mix(a, b, t) {
  const pct = Math.round(Math.max(0, Math.min(1, t)) * 100)
  return `color-mix(in oklch, ${b} ${pct}%, ${a})`
}

/** Diverging danger -> warning -> success scale, t in 0..1. */
export function heatColor(t) {
  if (t == null || Number.isNaN(t)) return 'var(--bg-3)'
  const v = Math.max(0, Math.min(1, t))
  if (v <= 0.5) return mix('var(--danger)', 'var(--warning)', v / 0.5)
  return mix('var(--warning)', 'var(--success)', (v - 0.5) / 0.5)
}

/** Score color by thresholds [low, high]: < low danger, < high warning, else success. */
export function scoreColor(value, thresholds = [70, 85]) {
  if (value == null || Number.isNaN(value)) return 'var(--ink-4)'
  if (value < thresholds[0]) return 'var(--danger)'
  if (value < thresholds[1]) return 'var(--warning)'
  return 'var(--success)'
}

/** Status keyword -> color (MiniBars, GanttStrip). Unknown keys fall back to --line-2. */
export const STATUS_COLORS = {
  ok: 'var(--success)', up: 'var(--success)', success: 'var(--success)', pass: 'var(--success)',
  passed: 'var(--success)', done: 'var(--success)', completed: 'var(--success)', operational: 'var(--success)',
  degraded: 'var(--warning)', warning: 'var(--warning)', partial: 'var(--warning)', slow: 'var(--warning)',
  active: 'var(--accent)', running: 'var(--accent)', info: 'var(--accent)', planned: 'var(--accent-2)',
  down: 'var(--danger)', fail: 'var(--danger)', failed: 'var(--danger)', error: 'var(--danger)',
  outage: 'var(--danger)',
  skipped: 'var(--ink-4)', none: 'var(--line-2)', unknown: 'var(--line-2)', empty: 'var(--line-2)',
}

export function statusColor(status) {
  return STATUS_COLORS[status] || 'var(--line-2)'
}

export const TOKENS = {
  ink1: 'var(--ink-1)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)', ink4: 'var(--ink-4)',
  line1: 'var(--line-1)', line2: 'var(--line-2)', grid: 'var(--line-1)',
  accent: 'var(--accent)', accentSoft: 'var(--accent-soft)',
  success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
  surface: 'var(--surface)', bg2: 'var(--bg-2)', bg3: 'var(--bg-3)',
}
