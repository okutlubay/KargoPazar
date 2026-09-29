# KargoPazar panel (`/app/`): developer conventions

Demo SaaS panel served from `/app/` (Vite multi-page entry `frontend/app/index.html`). Data lives in MySQL behind the ASP.NET Core API in `backend/` (contract: `docs/BACKEND.md`); the business logic (rate engine, AI models, consistency chain) runs in the browser on an in-memory copy of the state.

Run: start the API on `http://localhost:5000` (see `docs/BACKEND.md`), then `cd frontend && npm run dev` and open `http://localhost:5173/app/`. The API base comes from `VITE_API_BASE_URL` (`.env.development` / `.env.production`). Demo login: `demo / Demo123!`.

## Layout

```
src/shared/            pure modules shared with the landing page (rateEngine, carriers, countries, format)
src/app/
  main.js App.vue router.js nav.js app.css
  i18n/                index.js (t, tx, fmt), modules/*.js (one file per area, { tr: {...}, en: {...} })
  store/db.js          API-backed data layer: in-memory state loaded with GET /api/state, write-behind batches
  store/session.js     session token, role preview (can()), plan gates (hasFeature())
  store/events.js      notify(), audit(), modelEvent()
  api/http.js          fetch wrapper for the backend (base URL, Bearer token, ApiError mapping, 401 redirect)
  api/*.js             API layer: every read/write goes through request()
  ai/*.js              models (pure JS, trained in the browser)
  docs/*.js            jsPDF generators
  components/          UI kit (see components/README.md, components/charts/README.md)
  layouts/             AppShell, AuthLayout
  views/<area>/*.vue   screens (one folder per area)
  data/seed/*.json     deterministic seed (npm run seed); loaded into MySQL by the backend, bundled copies only for
                       db.seed()/db.loadSeed() (forecast "new since seed", public track samples)
```

## Rules

- JavaScript + Vue 3 `<script setup>`; no TypeScript, no new npm packages (allowed: vue-router, jsbarcode, qrcode, jspdf).
- **All user-visible text via i18n.** Add strings to your own module `src/app/i18n/modules/<area>.js` (`export default { tr: { <ns>: {...} }, en: { <ns>: {...} } }`), never to another area's file. Both languages always. Seed fields that are `{ tr, en }` objects are rendered with `tx(obj)`.
- **Never** use the forbidden brand words listed in the spec (Section 0.6), and never use the em dash (U+2014) or en dash (U+2013) in any string; empty cells show `-`.
- Formatting: `fmt.money(v)`, `fmt.dateTime(iso)`, `fmt.relative(iso)`, `fmt.weight(lb)`, `fmt.number(v, d)`, `fmt.percent(frac)`.
- **Data layer.** `db.init()` runs after login (and at boot when a token is stored) and loads every collection with `GET /api/state`. Writes are applied synchronously in memory and persisted write-behind: each write marks its collection dirty, a ~200 ms timer (or the end of `db.transaction()`) diffs the dirty collections against the last saved snapshot and sends one `POST /api/state/batch` (`upsert` with `position` for new records, `delete`, `replaceCollection` for keyless or reordered lists, `setDoc` for documents). Everything inside one transaction goes in one batch, which the server applies atomically. One batch is in flight at a time; failures retry with backoff and the top bar shows the save state (`db.syncState`).
- `localStorage` / `sessionStorage` hold only UI preferences (language, sidebar, table columns, overview range), the session token and short lived flow state (login lock, flash messages, presentation mode). Never store data there.
- Public pages without a session use the public endpoints (`/api/public/track`, and on the landing `/api/public/pricing-config`, `/api/public/leads`).
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
