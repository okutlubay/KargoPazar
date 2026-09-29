# Chart components (`src/app/components/charts/`)

Hand-written SVG/HTML charts. No chart library. Vue 3 `<script setup>`, plain JS.

```js
import LineChart from '@/app/components/charts/LineChart.vue'
```

## Common behaviour

- **Responsive**: every chart except `ProgressRing` measures its container with `ResizeObserver` and fills 100% of the parent width. Give the parent a width (grid cell, card). Height comes from the `height` prop. `GaugeScore`/`Donut` shrink below `size` when the container is narrower.
- **Colors**: all colors are CSS strings (`var(--accent)`, `oklch(...)`, `color-mix(...)`). Any `color` prop accepts any CSS color, token vars included. When omitted, series get the palette in `palette.js` (`SERIES_COLORS`: accent, teal, warning, magenta, success, slate, danger, olive, violet, orange).
- **Text**: components never contain user-visible copy. Labels come from props; generic words (no data, total, month labels, cumulative) come from the `charts` i18n namespace (`src/app/i18n/modules/charts.js`).
- **Formatting**: `*Format` props are functions `v => string`. Pass `fmt` helpers from `useI18n()`, e.g. `:y-format="v => fmt.money(v)"`, `:format="v => fmt.percent(v, 0)"`. Defaults use locale-aware number formatting.
- **Empty state**: with no usable data the chart renders a dashed box with `emptyText` (prop) or `t('charts.noData')`. 0 or 1 data points never throw.
- **Accessibility**: the figure has `role="img"` and an `aria-label` (override with `ariaLabel`). Legend items are `<button aria-pressed>`.
- **Tooltips**: styled like app cards (surface, line-1 border, shadow-md). Most charts expose a `#tooltip` slot to replace the default content.
- Internal helpers (do not use directly unless needed): `ChartTooltip.vue`, `ChartLegend.vue`, `utils.js`, `charts.css`.

## palette.js

```js
import { SERIES_COLORS, seriesColor, alpha, mix, heatColor, scoreColor, statusColor, STATUS_COLORS, TOKENS } from '@/app/components/charts/palette.js'
```

| export | description |
|---|---|
| `seriesColor(i, explicit?)` | explicit color or palette color `i` |
| `alpha(color, a)` | transparent tint, `a` 0..1 |
| `mix(a, b, t)` | mix two colors (t=0 gives a) |
| `heatColor(t)` | danger (0) -> warning (0.5) -> success (1) |
| `scoreColor(v, [lo, hi] = [70, 85])` | `< lo` danger, `< hi` warning, else success |
| `statusColor(status)` | keyword color, see `STATUS_COLORS` |

`STATUS_COLORS` keys: success tone `ok up success pass passed done completed operational`; warning `degraded warning partial slow`; accent `active running info`, `planned` (accent-2); danger `down fail failed error outage`; neutral `skipped` (ink-4), `none unknown empty` (line-2).

---

## LineChart.vue

Multi-series line chart with confidence bands, markers, shaded ranges, crosshair tooltip and toggleable legend.

| prop | type | default | notes |
|---|---|---|---|
| `series` | `Array<{ key, label, color?, points: [{ x, y }], dashed?, area?, width? }>` | `[]` | `x`: Date, ISO string or number. `y: null` breaks the line (gap). Points are sorted internally. |
| `bands` | `Array<{ key, label, color?, opacity?, points: [{ x, lo, hi }] }>` | `[]` | Filled area between `lo` and `hi`. Draw the wider band first (95% then 80%) so overlap gives two tones. Default color is palette[0]; default opacity 0.12 for the first band, 0.18 for others. |
| `markers` | `Array<{ x, label?, dashed? = true, color?, key? }>` | `[]` | Vertical line with label on top (e.g. "Bugün"). Skipped if outside the x domain. |
| `shadedRanges` | `Array<{ from, to, label?, color? = var(--warning), key? }>` | `[]` | Tinted vertical span (e.g. holiday season), clipped to domain. |
| `xType` | `'time' \| 'number'` | `'time'` | Time: nice day/week/month/year ticks, localized. Number: nice numeric ticks. |
| `height` | Number | `260` | plot height in px (legend is extra) |
| `yFormat` | `v => string` | locale number | y ticks and tooltip values |
| `xFormat` | `x => string` | localized date / number | tooltip title (and numeric x ticks). Receives a `Date` when `xType='time'`. |
| `xTickFormat` | `x => string` | auto | override x tick labels only |
| `yMin`, `yMax` | Number | auto | force y domain |
| `yZero` | Boolean | `true` | include 0 in y domain (set `false` for e.g. prices) |
| `xDomain` | `[from, to]` | data extent | force x domain |
| `curve` | `'monotone' \| 'linear'` | `'monotone'` | |
| `dots` | Boolean | `false` | draw a dot on every point (single-point series always get a dot) |
| `legend` | Boolean | `true` | shown when there are 2+ items (series + bands) |
| `grid` | Boolean | `true` | horizontal grid lines |
| `strokeWidth` | Number | `2` | |
| `ariaLabel`, `emptyText` | String | | |

Emits: `hover({ x, rows } | null)` (x is Date for time), `toggle(key, visible)`.
Slot `#tooltip="{ x, title, rows }"`; each row: `{ key, label, color, type: 'series' | 'band', value?, lo?, hi?, text }`.

Live usage (loss curve): push to the `points` array (`points.value = [...points.value, next]`), the chart re-renders; use `x-type="number"`. Hover uses rAF throttling + binary search, fine for 4 x 100+ points.

```vue
<LineChart
  :series="[{ key: 'act', label: t('forecast.actual'), points: hist },
            { key: 'fc', label: t('forecast.forecast'), points: fc, dashed: true }]"
  :bands="[{ key: 'b95', label: '95%', points: b95 }, { key: 'b80', label: '80%', points: b80 }]"
  :markers="[{ x: today, label: t('common.today') }]"
  :shaded-ranges="[{ from: '2025-11-24', to: '2025-12-15', label: t('forecast.holiday') }]"
  :y-format="v => fmt.number(v)" :height="300" />
```
Tip: start the forecast series and bands at the last actual point so the lines connect.

## BarChart.vue

| prop | type | default | notes |
|---|---|---|---|
| `categories` | `Array<string \| { key, label }>` | `[]` | |
| `series` | `Array<{ key, label, color?, values: number[] }>` | `[]` | `values[i]` matches `categories[i]`; null skips. Negative values supported. |
| `mode` | `'grouped' \| 'stacked'` | `'grouped'` | |
| `horizontal` | Boolean | `false` | categories on the y axis (long labels truncated with tooltip title) |
| `height` | Number | `240` vertical; horizontal: `categories * rowHeight + 30` | |
| `rowHeight` | Number | `28` | horizontal auto height |
| `valueFormat` | fn | locale number | tooltip + value labels |
| `axisFormat` | fn | `valueFormat` | value axis ticks |
| `categoryFormat` | fn | | map category to label |
| `showValues` | Boolean | `false` | grouped: each bar; stacked: stack total |
| `showTotal` | Boolean | `true` | "Toplam" row in stacked tooltip |
| `legend`, `grid` | Boolean | `true` | legend shown for 2+ series, click toggles |
| `maxBarWidth` | Number | `48` | |
| `ariaLabel`, `emptyText` | String | | |

Emits: `select({ index, category })` on click, `hover({ index, category } | null)`, `toggle(key, visible)`.
Slot `#tooltip="{ index, category, rows }"`, rows `{ key, label, color, value, text }`.

## Donut.vue

| prop | type | default | notes |
|---|---|---|---|
| `data` | `Array<{ key, label, value, color? }>` | `[]` | negative values treated as 0; empty state when total is 0 |
| `size` | Number | `180` | max diameter |
| `thickness` | Number | 15% of diameter | |
| `legend` | Boolean | `true` | list with percentages |
| `legendPosition` | `'auto' \| 'right' \| 'bottom'` | `'auto'` | auto stacks below when container < size + 190 px |
| `valueFormat` | fn | locale number | center total + legend values |
| `centerLabel` | String | `t('charts.total')` | |
| `centerValue` | String | formatted total | |
| `showValues` | Boolean | `false` | show raw values in legend next to % |

Hovering a slice or legend row highlights it and the center shows its % and label.
Emits: `select(item)`, `hover(item | null)` (original data objects).
Slot `#center="{ total, active }"` (`active`: `{ key, label, value, pct, color } | null`).

## Sparkline.vue

| prop | type | default |
|---|---|---|
| `data` | `number[]` (nulls = gaps) | `[]` |
| `color` | CSS color | `var(--accent)` |
| `height` | Number | `32` |
| `area` | Boolean (gradient fill) | `true` |
| `strokeWidth` | Number | `1.5` |
| `showLast` | Boolean (dot on last point) | `true` |
| `curve` | `'monotone' \| 'linear'` | `'monotone'` |
| `min`, `max` | Number | auto |
| `tooltip` | Boolean (hover dot + value) | `false` |
| `labels` | `string[]` shown above value in tooltip | `null` |
| `format` | fn | locale number |
| `ariaLabel` | String | |

Width fills the parent (give it a width). Empty data draws a faint baseline.

## HeatmapGrid.vue

| prop | type | default | notes |
|---|---|---|---|
| `rows` | `Array<string \| { key, label }>` | `[]` | e.g. carriers |
| `cols` | `Array<string \| { key, label }>` | `[]` | e.g. zones 2..8 |
| `values` | `(number \| null)[][]` | `[]` | `values[r][c]`; null = no data (hatched cell, "-") |
| `meta` | `any[][]` | `null` | `meta[r][c]`; numbers render as `t('charts.samples')` ("n = 34") in tooltip |
| `format` | fn | `fmt.percent(v, 0)` | cell text + tooltip |
| `metaFormat` | `m => string` | see above | |
| `domain` | `[min, max]` | data min/max | color scale domain (e.g. `[0.7, 1]`) |
| `reverse` | Boolean | `false` | high = danger |
| `cornerLabel` | String | | top-left header (e.g. "Taşıyıcı") |
| `colLabel` | String | | axis caption under the grid (e.g. "Zone") |
| `showValues` | Boolean | `true` | values hidden automatically below 420 px width |
| `legend` | Boolean | `true` | gradient bar with min/max |
| `cellHeight` | Number | `34` | |

Color scale: danger -> warning -> success (`heatColor`), softened 60% toward surface.
Emits: `select({ row, col, r, c, value, meta })`, `hover(same | null)`.
Slot `#tooltip="{ r, c, title, text, meta, color }"`.

## GaugeScore.vue

Semicircle gauge.

| prop | type | default |
|---|---|---|
| `value` | Number (null shows "-") | `null` |
| `min`, `max` | Number | `0`, `100` |
| `label` | String (under the number) | |
| `sublabel` | String (explanation under the gauge) | |
| `thresholds` | `[lo, hi]` | `[70, 85]` (danger / warning / success) |
| `size` | Number (max width px) | `200` |
| `thickness` | Number | 8% of width |
| `color` | CSS color (overrides threshold color) | |
| `format` | fn for the center number | integer |
| `showZones` | Boolean (faint colored zones on track) | `true` |
| `showScale` | Boolean (min/max labels) | `true` |
| `ariaLabel` | String | |

Animated arc on value change.

## ScatterChart.vue

For the optimizer simulator (x price, y days, bubble size reliability).

| prop | type | default | notes |
|---|---|---|---|
| `points` | `Array<{ key?, x, y, r?, label?, sublabel?, highlighted?, color? }>` | `[]` | `r` is a data value mapped to radius (area proportional) |
| `height` | Number | `280` | |
| `xFormat`, `yFormat`, `rFormat` | fn | locale number | axes + tooltip |
| `xLabel`, `yLabel`, `rLabel` | String | | axis titles and tooltip row labels (r row shown only if `rLabel`) |
| `rRange` | `[minPx, maxPx]` | `[4, 14]` | |
| `rDomain` | `[min, max]` | data extent | |
| `xZero`, `yZero` | Boolean | `false` | include 0 |
| `yInvert` | Boolean | `false` | smaller y at top |
| `color` | CSS color | `var(--accent)` | non highlighted fill (tinted) |
| `highlightColor` | CSS color | `var(--accent)` | highlighted points: solid + halo ring, drawn on top |
| `showLabels` | `'highlighted' \| 'all' \| 'none'` | `'highlighted'` | inline point labels |
| `ariaLabel`, `emptyText` | String | | |

Hover picks the nearest point (within 24 px). Positions animate when points move (slider changes).
Emits: `select(point)`, `hover(point | null)`. Slot `#tooltip="{ point }"`.

## Waterfall.vue

| prop | type | default | notes |
|---|---|---|---|
| `steps` | `Array<{ label, value?, type?: 'start' \| 'delta' \| 'end', color?, note? }>` | `[]` | `start`: absolute bar; `delta`: change from running total; `end`: absolute bar, `value` optional (defaults to running total). First step defaults to `start`, others to `delta`. |
| `format` | fn | locale number | axis, labels, tooltip. Deltas get a `+`/`-` sign automatically; pass an unsigned formatter. |
| `height` | Number | `240` | |
| `showValues` | Boolean | `true` | |
| `baseline` | `'auto' \| 'zero'` | `'auto'` | auto zooms the value axis so small deltas are readable; zero starts at 0 |
| `colors` | `{ start?, end?, up?, down? }` | slate, accent, success, danger | |

Dashed connectors join each bar to the next. Tooltip shows value, cumulative (`t('charts.cumulative')`) and optional `note`.
Emits: `hover(step | null)`. Slot `#tooltip="{ step, cumulative }"`.

## MiniBars.vue

Tiny bar strip (uptime 30 days, run history).

| prop | type | default | notes |
|---|---|---|---|
| `data` | `Array<{ value?, status?, label?, color?, tooltip? }>` | `[]` | If any item has `value`, bars are proportional (`min`..`max`); otherwise full-height boxes. Color: `color` > `statusColor(status)` > `color` prop. |
| `height` | Number | `28` | |
| `gap` | Number | `3` | |
| `max`, `min` | Number | data max, `0` | |
| `color` | CSS color | `var(--accent)` | |
| `format` | fn | locale number | tooltip value when no `tooltip` string |
| `radius` | Number | `2` | |
| `minBarHeight` | Number | `3` | |

Tooltip: `label` as title, then `tooltip` text or formatted value. Items with `value: null` (in value mode) render as empty boxes.
Emits: `select(item, index)`, `hover(item | null)`. Slot `#tooltip="{ item, index }"`.

## GanttStrip.vue

Horizontal month timeline (Ar-Ge 24-month plan).

| prop | type | default | notes |
|---|---|---|---|
| `months` | Number | `24` | |
| `bars` | `Array<{ key?, from, to, label?, color?, status?, tooltip? }>` | `[]` | `from`/`to` are 1-based inclusive months. Overlapping bars go to separate lanes automatically. `status: 'planned'` renders hatched; `'active'` has a subtle shine; `'done'` solid success. Color: `color` > `statusColor(status)` > accent. |
| `current` | Number | `null` | current month marker (dashed red line + label + highlighted tick) |
| `currentLabel` | String | `t('charts.current')` | |
| `showTicks` | Boolean | `true` | month ticks "Ay 1..24" / "M1..M24" (`t('charts.monthShort')`), thinned when narrow |
| `showLabels` | Boolean | `true` | bar labels drawn inside when they fit |
| `showGrid` | Boolean | `true` | alternating month columns |
| `rowHeight` | Number | `16` | per lane |
| `laneGap` | Number | `4` | |

Compact per-row use: `<GanttStrip :bars="[{ from: 3, to: 9, status: 'done' }]" :show-ticks="false" :row-height="8" />`.
Tooltip: label, month range (`t('charts.monthRange')`), `tooltip`.
Emits: `select(bar)`, `hover(bar | null)`. Slot `#tooltip="{ bar }"`.

## ProgressRing.vue

Fixed-size circular progress (not container-responsive; set `size`).

| prop | type | default |
|---|---|---|
| `value` | Number | `0` |
| `max` | Number | `100` |
| `size` | Number px | `64` |
| `thickness` | Number | 10% of size |
| `color` | CSS color | `var(--accent)` |
| `thresholds` | `[lo, hi]` to color by score instead of `color` | `null` |
| `label` | String center text override | percent (`fmt.percent`) when `max=100`, else number |
| `sublabel` | String under the ring | |
| `format` | fn for center text | |
| `ariaLabel` | String | |

Default slot `{ value, fraction }` replaces the center content.

## i18n keys (`charts.*`)

`noData`, `chart`, `total`, `samples` (`{n}`), `month` / `monthShort` (`{n}`), `monthRange` (`{from}`, `{to}`), `toggleSeries` (`{label}`), `range` (`{lo}`, `{hi}`), `cumulative`, `current`, `legendScale`.
