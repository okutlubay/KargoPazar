# App component library (`src/app/components`)

Vue 3 `<script setup>`, plain JS, no external libs. Import with the alias:

```js
import DataTable from '@/app/components/DataTable.vue'
import { validateAll, required, email } from '@/app/components/validation.js'
```

General rules
- All user-visible text comes from i18n. Component strings live in `i18n/modules/components.js` (`components.*`); common strings in `common.*`. Pass already translated strings to props (`:label="t('orders.title')"`).
- Every icon-only button has an `aria-label`; focus ring = `0 0 0 3px var(--accent-soft)`.
- Overlays (Modal, Drawer, toast, confirm, CommandPalette, PageHeader) are separate files by the lead; Popover and Dropdown register in `layers.js` so `Esc` closes the top-most layer first.
- `v-model:x` below means prop `x` + emit `update:x`.

---

## Data display

### DataTable.vue
Client-side sorted / paginated table. Below `cardBreakpoint` (860 px) rows render as cards (first visible column = card title, column with key `actions` or `isAction: true` goes to the card header right side, others as label/value list).

Props
| prop | type | default | notes |
|---|---|---|---|
| `columns` | Array | required | `[{ key, label, sortable?, align?: 'left'\|'right'\|'center', width?: number\|string, hideBelow?: 'md'\|'lg', visible?: true, hideable?: true, format?: (value,row)=>string, value?: row=>any, sortValue?: row=>any, nowrap?, hideOnCard?, className?, isAction? }`. `key` may be a dot path (`to.city`). `hideBelow: 'lg'` hides under 1280 px, `'md'` under 1024 px. |
| `rows` | Array | `[]` | |
| `rowKey` | String\|Function | `'id'` | |
| `loading` | Boolean | false | skeleton rows |
| `selectable` | Boolean | false | checkbox column |
| `v-model:selected` | Array | `[]` | array of row keys |
| `pageSizes` | Array | `[25,50,100]` | |
| `pageSize` | Number | first of pageSizes | initial |
| `paginate` | Boolean | true | |
| `defaultSort` | Object | null | `{ key, dir: 'asc'\|'desc' }`; header click cycles asc, desc, none |
| `emptyTitle` / `emptyDesc` / `emptyIcon` | String | `common.emptyTitle` / '' / `'box'` | unfiltered empty state |
| `emptyActionLabel` | String | '' | adds a button, emits `empty-action` |
| `filtered` | Boolean | false | when rows are empty shows "Bu filtrelerle sonuç yok" + "Filtreleri temizle" (emits `clear-filters`) |
| `stickyHeader` | Boolean | true | header sticks to the viewport at `top: var(--kpz-sticky-top, 0px)` (set this CSS var on a parent to the topbar height). Without `maxHeight` horizontal overflow is clipped, so use `hideBelow` for narrow screens. |
| `maxHeight` | Number\|String | null | table scrolls inside itself (header sticks inside) |
| `highlightKeys` | Array\|Set | `[]` | rows flash green briefly (e.g. newly synced) |
| `rowClass` | Function | null | `row => string\|object` |
| `clickable` | Boolean | true | pointer + `row-click`; Enter on a focused row also fires it |
| `storageKey` | String | '' | persists hidden columns + page size in `localStorage['kpz_demo:ui:table:<key>']` |
| `columnMenu` | Boolean | true | gear button in the last header cell to show/hide columns |
| `dense` | Boolean | false | tighter rows |
| `ariaLabel` | String | '' | |

Emits: `row-click(row, event)` (not fired when clicking buttons/links/inputs/elements with `data-no-row-click`), `sort({ key, dir })`, `update:selected(keys)`, `clear-filters`, `empty-action`, `page(n)`.

Slots
- `#cell-<key>="{ row, value, column }"` custom cell (used in both table and card mode).
- `#bulk="{ selected, clear }"` actions in the dark bulk bar shown while `selected.length > 0` (use `.btn .btn-ghost .btn-sm`; they are restyled for the dark bar). The bar also offers "Tüm N kaydı seç" and a clear button.
- `#empty` replaces the unfiltered empty state, `#empty-filtered` the filtered one.

Exposed: `page`, `pageSize`, `sort` (refs), `goToPage(n)`, `resetColumns()`.

```vue
<DataTable :columns="cols" :rows="filteredRows" :loading="loading" selectable v-model:selected="sel"
  :filtered="hasFilters" storage-key="orders" @clear-filters="clear" @row-click="openDrawer">
  <template #cell-status="{ value }"><StatusPill :status="value" /></template>
  <template #cell-actions="{ row }"><Dropdown :items="rowMenu(row)" /></template>
  <template #bulk="{ selected }"><button class="btn btn-ghost btn-sm" @click="bulkLabel(selected)">...</button></template>
</DataTable>
```

### FilterBar.vue
Search + filter chips + date range + "Filtreleri temizle". Pressing `/` anywhere (not typing in an input, no `aria-modal` dialog open) focuses the search of the most recently mounted FilterBar.

Props
- `v-model:search` String. Omit the prop entirely to hide the search box.
- `searchPlaceholder` String (default `common.searchPlaceholder`).
- `chips` Array `[{ key, label, icon?, multiple = true, options: [{ value, label, icon?, count? }] }]`.
- `v-model:filters` Object `{ [chip.key]: array (multiple) | value | null (single) }`.
- `v-model:range` Object `{ preset: 'last7'|'last30'|'last90'|'thisMonth'|'custom', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } | null`. Omit the prop to hide the date chip.
- `defaultRange` Object: value restored by clear; range counts as "active" only when its preset differs from it.
- `rangePresets` Array (default all five). `showClear` Boolean (true).

Emits: `update:search`, `update:filters`, `update:range`, `clear` (after clear-all).
Slots: `#chips` (extra chips after the built-in ones), `#actions` (right aligned buttons).
Exposed: `focusSearch()`, `clearAll()`.

Named exports (from `FilterBar.vue`): `presetRange(preset)`, `rangeBounds(range) -> { from: Date, to: Date } | null`, `inRange(iso, range) -> boolean` (null range = true), `toYmd(date)`.

```js
import FilterBar, { inRange } from '@/app/components/FilterBar.vue'
rows.filter(r => inRange(r.createdAt, range.value))
```

### StatusPill.vue
Props: `status` (code from `status.*`, required), `label` (override text), `size` `'md'|'sm'`, `tone` (override), `dot` (true).
Tones: success (delivered, completed, success, shipped, connected, active, approved, cleared, passed, paid, operational, live), warning (awaiting_shipment, on_hold, pending, warning, disputed, reviewing, suggested, due, degraded, pending_review, invited, returned, test), danger (exception, voided, cancelled, failed, error, rejected, down, revoked), info/accent (in_transit, out_for_delivery, label_created, labeled, created, handed_over, submitted, running), neutral (draft, inactive, disconnected, skipped, expired, waived, replaced, charged, unknown codes).
Named exports: `STATUS_TONES`, `statusTone(code)`.

### ScoreBadge.vue
Props: `score` (0-100, null shows "-"), `showLabel` (adds İyi/Orta/Zayıf), `label` (override), `size` `'sm'|'md'|'lg'`. >=85 green, 70-84 amber, <70 red. Named export `scoreTone(score)`.

### CarrierLogo.vue / ChannelLogo.vue
Square brand logo in the landing style.
- CarrierLogo props: `code` (FDX, UPS, USPS, DHLE, ONT, LSO, DHLX, EVRI or any admin-added code), `name`, `color`, `ink`, `label` (text inside square), `size` (28), `showName` (renders name next to square), `sub` (second line, e.g. service name). Resolution order: props, `db.get('carriers', code)`, `@/shared/carriers.js`, built-in fallback, hashed color.
- ChannelLogo props: same (`code`: shopify, etsy, amazon, ebay, woocommerce/woo, manual, api, csv). manual/api/csv render an icon.
- Named exports: `CARRIER_FALLBACK`, `initials()`, `hashColor()` (CarrierLogo), `CHANNELS` (ChannelLogo).

### Money.vue / Weight.vue / DateTime.vue
- Money: `value`, `currency` ('USD'), `digits` (2), `signed` (+ prefix), `colored` (green/red), `mono` (true).
- Weight: `lb` (stored lb), `units` ('imperial'|'metric', default user preference), `digits` (1), `mono`.
- DateTime: `value` (ISO/Date/ms), `mode`: `'relative'` (default, absolute in `title` tooltip) | `'absolute'` | `'date'` | `'short'`.

### KpiCard.vue
Props: `label` (required), `value` (preformatted string or number), `format` `'number'|'money'|'percent'|'weight'|fn`, `digits`, `delta` (fraction, 0.12 = +12%), `deltaLabel` ("önceki döneme göre"), `invert` (decrease is good), `sparkline` (number array, inline SVG), `icon`, `hint`, `loading` (skeleton), `clickable` (renders as button), `tone` ('accent'|'success'|'warning'|'danger').
Emits: `click` (only when `clickable`).

### AiInsightCard.vue
AI badge + title + description + "Uygula" + "Neden?" popover.
Props: `title`, `description`, `badge` (default "AI"), `actionLabel` (default "Uygula"), `actionIcon` ('wand'), `hideAction`, `applying` (spinner, disabled), `applied` (shows "Uygulandı", disabled), `reason` (String | [String] | [{ label, value?, weight? 0-1 }], weight draws a bar), `reasonTitle` (default "Modelin gerekçesi"), `confidence` (0-1), `meta` (small text top right), `compact`, `tone` ('accent'|'plain').
Emits: `apply`, `why` (popover opened).
Slots: default (rich description, replaces `description`), `#reason` (custom popover body), `#actions` (extra buttons).

### EmptyState.vue
Props: `icon` ('box'), `title`, `description`, `actionLabel`, `actionIcon`, `actionVariant` ('primary'|'accent'|'ghost'), `compact`. Emits `action`. Slot `#action` replaces the button.

### Skeleton.vue / Spinner.vue / ProgressBar.vue
- Skeleton: `variant` 'lines'|'rect'|'circle', `lines` (3), `width`, `height`, `radius` (numbers = px).
- Spinner: `size` (16), `label` (aria, default "Yükleniyor…"). Uses `currentColor`.
- ProgressBar: `value` 0-100, `label`, `showValue`, `indeterminate`, `tone` 'accent'|'success'|'warning'|'danger'|'ink', `size` 'sm'|'md'|'lg'.

### CodeBlock.vue
Dark code panel (ink-1 background) with JSON highlighting.
Props: `code` (String or Object/Array, objects are pretty printed), `language` 'json'|'shell'|'text', `lineNumbers`, `copyable` (true), `title` (header text, default language), `maxHeight` (420), `wrap`, `editable` + `v-model` (textarea, Tab inserts 2 spaces, shows "Geçersiz JSON" for json), `rows` (12).
Emits: `update:modelValue`, `valid(boolean)` (json editable only).
Named exports: `highlightJson(str) -> html`, `highlightShell(str)`.

### Card.vue
Section card. Props: `title`, `subtitle`, `icon`, `padding` 'none'|'sm'|'md'|'lg', `soft` (bg-2), `tag` ('section'). Slots: default, `#actions` (header right), `#header` (replaces title block), `#footer`.

---

## Navigation / controls

### Tabs.vue
Props: `tabs` `[{ key, label, count?, icon?, disabled? }]`, `v-model` (active key), `variant` 'underline'|'pill', `ariaLabel`. Counts render as small badges. Arrow keys move. Emits also `change(key)`.

### SegmentedControl.vue
Props: `options` `[{ value, label, icon?, disabled? }]`, `v-model`, `size` 'md'|'sm', `block` (full width), `ariaLabel`. Emits `change`.

### Stepper.vue
Props: `steps` `[{ key, label, description?, error?, optional? }]`, `v-model:current` (index), `orientation` 'horizontal'|'vertical', `canNavigate(targetIndex, currentIndex) -> bool` (default: completed steps are clickable), `maxReached` (index; visited steps ahead also clickable/done), `ariaLabel`.
Emits: `update:current(i)`, `navigate(i)`. Horizontal variant shows only the current label below 860 px.

### Toggle.vue
Props: `v-model` Boolean, `label`, `description`, `disabled`, `size` 'md'|'sm', `ariaLabel` (needed when no label). `role="switch"`. Emits `change`. Default slot = extra content under label.

### Slider.vue
Props: `v-model` Number, `min` (0), `max` (100), `step` (1), `label`, `leftLabel` / `rightLabel` (e.g. "Maliyet" / "Hız"), `showValue` (true), `format(v) -> string`, `disabled`. Emits `update:modelValue` (while dragging), `change` (on release).

### Popover.vue
Anchored panel teleported to `<body>` (never clipped), flips above when no room, closes on outside click and `Esc`.
Props: `v-model:open` (optional, uncontrolled if omitted), `placement` 'bottom-start'|'bottom-end'|'bottom'|'top-start'|'top-end'|'top', `width` (number px or CSS), `offset` (6), `closeOnContentClick`, `autoFocus`, `role` ('dialog'), `ariaLabel`, `panelClass`, `disabled`.
Slots: `#trigger="{ open, toggle, close, id }"` (bind `@click="toggle"`; `id` is the panel id for `aria-controls`), default `="{ close }"`.
Emits: `update:open`, `show`, `hide`. Exposed: `open()`, `close()`, `toggle()`, `reposition()`.

### Dropdown.vue
Menu for row "..." menus / user menu.
Props: `items` `[{ key, label, icon?, danger?, disabled?, hint?, shortcut?, divider?: true, header?: true, onClick?(item) }]`, `placement` ('bottom-end'), `width` (220), `icon` ('more', default trigger icon), `label` (visible trigger text, adds chevron), `ariaLabel` (default "Eylemler"), `size` 'sm'|'md', `disabled`.
Emits: `select(item)` (after `item.onClick`). Slots: `#trigger="{ toggle, open }"` (custom trigger; use `@click.stop="toggle"` inside tables), `#header` (above items), default (below items). Arrow keys / Home / End navigate; clicking the trigger does not fire DataTable `row-click`.

### CopyButton.vue
Props: `text` (required), `label` (visible label for variant button, default "Kopyala"), `variant` 'icon'|'button'|'dark' (for dark backgrounds), `size` 'xs'|'sm'|'md', `ariaLabel`. Shows check + "Kopyalandı" for 1.6 s. Emits `copied(text)`. Named export `copyText(text) -> Promise<boolean>`.

### FileDrop.vue
Drag & drop or click/Enter to browse.
Props: `accept` ('.csv', comma list of extensions or mime types), `maxSizeMb` (5), `title` (default `common.dropFile`), `hint`, `disabled`, `compact`.
Emits: `file({ name, text, size, type })`, `error(message)` (wrong type / too large), `clear`. Shows the selected file name with a remove button. Exposed: `clear()`, `browse()`.

---

## Forms

### FormField.vue
Wraps a label + control + hint/error, validates on blur (focus leaving the field).
Props: `label`, `hint`, `error` (external error, wins), `required` (red `*` + required rule), `optional` (shows "(isteğe bağlı)"), `rules` (array of `value => true | 'message'`), `value` (the value to validate, pass the same thing you `v-model`), `id` (auto if empty), `validateOn` 'blur'|'input'. After the first error it re-validates on every change.
Default slot props: `{ id, invalid, describedBy, validate }`; bind `:id="id" :aria-invalid="invalid" :aria-describedby="describedBy"` on the control. Slot `#labelRight` (e.g. a link next to the label).
Exposed: `validate() -> boolean`, `reset()`, `focus()`, `el`, `invalid`. Emits `validate(ok)`.

```vue
<FormField ref="emailF" :label="t('x.email')" required :rules="[email()]" :value="form.email" v-slot="{ id, invalid, describedBy }">
  <input :id="id" v-model="form.email" class="input" :aria-invalid="invalid" :aria-describedby="describedBy" />
</FormField>
```

### validation.js
- Rule factories (messages translated at validation time; empty values pass all but `required`): `required(msg?)`, `email(msg?)`, `min(n, msg?)`, `max(n, msg?)` (numeric), `minLength(n, msg?)`, `number(msg?)`, `pattern(re, i18nKey = 'common.validation.format', params?)` (string regex is case-insensitive).
- `runRules(rules, value) -> '' | message`.
- `validateAll(refs, { scroll = true }) -> boolean`: accepts an array / object map / template refs / v-for ref arrays of anything exposing `validate()` (FormField, AddressForm, PackageForm). Validates all, then scrolls to and focuses the first invalid one.

```js
async function submit() {
  if (!validateAll([nameF.value, emailF.value, addressForm.value])) return
  saving.value = true // disable button + Spinner, toast on success
}
```

### AddressForm.vue
Props
- `v-model` `{ name, company, line1, line2, city, state, zip, country, phone, email, residential }`.
- `country` (overrides `modelValue.country`; default 'US'; also written into the model).
  - US: city, state select (50 + DC, value = 2 letter code), ZIP `^\d{5}(-\d{4})?$`.
  - GB: town (`city`), county (`state`, optional), postcode (`zip`, case-insensitive regex, normalized on blur to "SW1A 1AA").
  - TR: il select of 81 provinces (`state` = province name), ilçe text (`city`), posta kodu 5 digits (`zip`).
  - DE: PLZ 5 digits (`zip`) before city.
  - Other: uses `format` prop `{ fields: [{ key, label: {tr,en}, required }], postalRegex, postalExample }` (country config shape from `@/shared/countries.js`); name/company/phone/email are always handled by the component. Without `format`: line1, line2, city, region, postcode.
- `validator` async `(address) => ({ score, issues: [{ code, label }], suggestion: {partial address} | null })`. Runs 400 ms (`debounce`) after address changes once line1 + (zip or city) exist; shows ScoreBadge, issue list and "Bunu mu demek istediniz? ..." with changed words highlighted and an "Uygula" button (merges suggestion into the model).
- `countries` `[{ code, name }]` shows a country select (changing it clears state/zip, emits `country-change`).
- `showPhone` / `showEmail` / `showResidential` / `showCompany` (all true), `requiredFields` (extra required keys, e.g. `['phone']`), `disabled`, `debounce` (400).
- Residential toggle: auto set from company (company present = business) until the user flips it.

Emits: `update:modelValue`, `apply-suggestion(suggestion)`, `validated(result|null)` (use it to warn when score < 70), `country-change(code)`.
Exposed: `validate() -> boolean` (no scroll), `focus()`, `el`, `revalidate()`, `result` (ref).
Named exports: `US_STATES`, `TR_PROVINCES`, `POSTAL`, `normalizeGbPostcode()`, `formatAddressLine(address)`.

### PackageForm.vue
Props: `v-model` `{ lengthIn, widthIn, heightIn, weightLb, preset }` (always stored in in / lb), `presets` (default Small 8x6x4, Medium 12x10x6, Large 18x14x8, Poly 10x13x1: `[{ key, label?, lengthIn, widthIn, heightIn }]`; label defaults to `components.package.presets.<key>`), `units` 'imperial' (in, lb + oz) | 'metric' (cm, kg), `dimDivisor` (139), `showPresets`, `showWeight`, `showSummary` (all true), `disabled`.
Typing a dimension sets `preset: 'custom'`. Summary shows actual / dimensional (`ceil(L*W*H/139)`) / billable (`max(dim, ceil(actual))`) and the sentence "Hacimsel ağırlık 6 lb > gerçek 3,2 lb, 6 lb üzerinden ücretlendirilir".
Exposed: `validate()`, `focus()`, `el`. Named exports: `DEFAULT_PRESETS`, `dimWeightLb(pkg, divisor)`, `billableWeightLb(pkg, divisor)`.
