# KargoPazar panel (`/app/`): developer conventions

Demo SaaS panel served from `/app/` (Vite multi-page entry `frontend/app/index.html`). No backend: seed JSON + localStorage behind a fake API layer.

Run: `cd frontend && npm run dev` then open `http://localhost:5173/app/`. Demo login: `demo / Demo123!`.

## Layout

```
src/shared/            pure modules shared with the landing page (rateEngine, carriers, countries, format)
src/app/
  main.js App.vue router.js nav.js app.css
  i18n/                index.js (t, tx, fmt), modules/*.js (one file per area, { tr: {...}, en: {...} })
  store/db.js          localStorage persistence (collections + documents)
  store/session.js     session, role preview (can()), plan gates (hasFeature())
  store/events.js      notify(), audit(), modelEvent()
  api/*.js             fake API: every read/write goes through request()
  ai/*.js              models (pure JS, trained in the browser)
  docs/*.js            jsPDF generators
  components/          UI kit (see components/README.md, components/charts/README.md)
  layouts/             AppShell, AuthLayout
  views/<area>/*.vue   screens (one folder per area)
  data/seed/*.json     deterministic seed (npm run seed)
```

## Rules

- JavaScript + Vue 3 `<script setup>`; no TypeScript, no new npm packages (allowed: vue-router, jsbarcode, qrcode, jspdf).
- **All user-visible text via i18n.** Add strings to your own module `src/app/i18n/modules/<area>.js` (`export default { tr: { <ns>: {...} }, en: { <ns>: {...} } }`), never to another area's file. Both languages always. Seed fields that are `{ tr, en }` objects are rendered with `tx(obj)`.
- **Never** use the forbidden brand words listed in the spec (Section 0.6), and never use the em dash (U+2014) or en dash (U+2013) in any string; empty cells show `-`.
- Formatting: `fmt.money(v)`, `fmt.dateTime(iso)`, `fmt.relative(iso)`, `fmt.weight(lb)`, `fmt.number(v, d)`, `fmt.percent(frac)`.
- **Data access only through `api/*`**, which wrap work in `request('METHOD /v1/path', fn, opts)` (300-900 ms latency, request log). Views never write to `db` directly. Reads for derived UI (badges, counts) may use `db.all()` reactively.
- `db.all(col)` returns the live reactive array; mutate only with `db.insert/update/remove/patchDoc/transaction`. Multi-collection writes use `await db.transaction(async () => { ... })`.
- New ids: `db.nextId('ORD'|'SHP'|'TXN'|'MNF'|'INV'|...)`.
- Side effects: `notify({ type, title: {tr,en}, link })`, `audit(action, target, detail)`, `modelEvent(module, kind, detail)`.
- Permissions: disable/lock actions with `can('shipments.create')` and show `t('common.noPermission')` as tooltip. Plan gates: `hasFeature('api')`.
- Overlays: `Modal`, `Drawer`, `confirm()` (components/confirm.js), `toast` (components/toast.js). Destructive actions require `confirm({ danger: true })`. Reversible actions offer toast "Geri al".
- Every list: loading skeleton, empty state, filtered-empty state with clear button. Every form: blur validation, scroll to first error, spinner + disabled submit, success toast.
- Page scaffold: `<div class="page"><PageHeader :title :subtitle><template #actions/></PageHeader> ... </div>`; helper classes in `app.css` (`.panel`, `.panel-head`, `.grid-2/3/4`, `.form-grid`, `.kv`, `.tag`, `.callout`, `.table-simple`).
- Keyboard: `Ctrl/Cmd+K` palette, `N` new shipment, `G O` orders, `G S` shipments, `/` focus list search, `Esc` closes top overlay.
- Routes are pre-declared in `router.js`; screen files live at `views/<path>.vue`.
