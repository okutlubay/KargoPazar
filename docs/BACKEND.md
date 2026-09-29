# KargoPazar backend ve veritabanı

Panel (`frontend/`, `/app/`) tüm verisini ASP.NET Core 8 API (`backend/`) üzerinden MySQL'de saklar. Landing sayfası herkese açık uçlarla fiyat yapılandırmasını okur.

```
KargoPazar/
  frontend/                 Vue 3 + Vite: landing (/) ve panel (/app/)
  backend/                  ASP.NET Core 8 Web API (KargoPazar.csproj, App Runner, port 8080)
  database/                 MySQL 8 scriptleri (000 veritabanı, 001 şema, 002 seed: üretilmiş)
  setup-database.bat        scriptleri sırayla çalıştırır (AWS RDS MySQL için), bkz. database/README.md
  tests/                    KargoPazar.RoundTrip (MySQL'siz tutarlılık testi) + verify-api-roundtrip.mjs (canlı API)
  KargoPazar.sln
```

## Mimari

- İş mantığı (fiyat motoru, AI modelleri, tutarlılık zinciri) panelin `api/*` katmanında çalışmaya devam eder. Veri katmanı (`frontend/src/app/store/db.js`) açılışta tüm durumu `GET /api/state` ile yükler, yazmaları bellekte uygular ve kısa gecikmeyle `POST /api/state/batch` ile MySQL'e gönderir. Bir `db.transaction()` içindeki tüm yazmalar tek batch ve tek veritabanı transaction'ı olarak gider.
- Şema hibrittir: her ana varlık kendi tablosunda, sorgulanan alanlar tipli ve indeksli kolonlarda, iç içe detaylar `data` kolonunda (tam kayıt, bkz. Şema). Kullanıcı ve cüzdan gerçek ilişkisel tablolardır (`users`, `companies`, `wallets`, `wallet_transactions`); şifre BCrypt ile saklanır, API asla şifre döndürmez.
- Tarihler seed'de göreli (`{daysAgo, hour, minute}`) saklanır; seed yüklenirken (ilk açılış, `002_SeedData.sql` üretimi, "Demo verisini sıfırla") o anki tarihe göre mutlak tarihe çevrilir (`db.js` `resolveDates()` kuralı; yerel saat dilimi `Seed:TimeZone`, varsayılan `Europe/Istanbul`).
- Demo verisi tüm ziyaretçiler arasında paylaşılır (tek demo hesabı). "Demo verisini sıfırla" herkes için sıfırlar.

## API sözleşmesi (base: `VITE_API_BASE_URL`, ör. `https://api.kargopazar.com/api`)

Tüm yanıtlar JSON, camelCase. Hatalar: `{ "code": "SNAKE_OR_UPPER_CODE", "message": "..." }` + uygun HTTP durum kodu. Kimlik doğrulama: `Authorization: Bearer <jwt>` (eksik veya süresi dolmuş: `401 {code:"UNAUTHORIZED"}`).

| Metot | Yol | Auth | Açıklama |
|---|---|---|---|
| GET | `/healthz`, `/health` (base dışında, kökte) | - | Sağlık kontrolü, `200 {status:"ok"}` (veritabanına dokunmaz) |
| POST | `/api/auth/login` | - | `{identifier, password}` (kullanıcı adı veya e-posta, büyük / küçük harf duyarsız) → `{token, expiresAt, user}`; hatalı: `401 {code:"INVALID_CREDENTIALS"}`; IP başına hız sınırı (5 dakikada 10 deneme, X-Forwarded-For): `429 {code:"LOCKED"}` + `Retry-After` başlığı (saniye, CORS'ta expose edilir) |
| GET | `/api/auth/me` | ✓ | `{user}` |
| POST | `/api/auth/verify-password` | ✓ | `{password}` → `204`; yanlış: `400 {code:"WRONG_PASSWORD"}`. Hassas işlemler öncesi yeniden doğrulama; login hız sınırına sayılmaz |
| POST | `/api/auth/change-password` | ✓ | `{current, next}` → `204`; yanlış mevcut şifre: `400 {code:"WRONG_PASSWORD"}`; zayıf şifre (8 karakterden kısa veya büyük harf / küçük harf / rakam / sembol gruplarından ikiden az; paneldeki `passwordStrength` skor ≥ 2 ile aynı eşik): `400 {code:"WEAK_PASSWORD"}` |
| GET | `/api/state` | ✓ | `{ seedVersion, collections: { <name>: [kayıtlar] \| {doküman} } }` (tüm koleksiyonlar; `user` dokümanı şifresiz) |
| POST | `/api/state/batch` | ✓ | `{ ops: [...] }` → tek transaction; `{ applied }`. Op'lar aşağıda |
| POST | `/api/state/reset` | ✓ | Tüm veriyi seed'den yeniden yükler (şifre `Demo123!`'e döner) → `204` |
| GET | `/api/state/export` | ✓ | `{ version, seedVersion, exportedAt, data: {...} }` (`version` = `seedVersion`, eski panel export'ları için) |
| POST | `/api/state/import` | ✓ | Export formatı (`{seedVersion?, exportedAt?, data}`; `version` yok sayılır) → tüm veriyi değiştirir → `204`. Mevcut şifre korunur; `data.user` yoksa mevcut kullanıcı dokümanı korunur. `data` nesne değilse `400 {code:"INVALID_EXPORT"}` |
| GET | `/api/public/pricing-config` | - | `{ carriers, rateCards: {platform, plans, firstMile, carrierAgreements}, countries, zipCity }` (landing hesaplayıcısı; `Cache-Control: public, max-age=60`) |
| GET | `/api/public/track?q=...` | - | Virgülle ayrılmış takip no / sipariş no; `[{query, found, shipment}]` (herkese açık takip sayfası; müşteri e-postası gibi kişisel alanlar çıkarılır). Ayrıntı aşağıda |
| POST | `/api/public/leads` | - | `{name, email, company, phone, message, ...}` → `201 {id}` (landing iletişim formu). Ayrıntı aşağıda |

### Batch op'ları

```json
{ "op": "upsert",  "collection": "orders", "id": "ORD-10483", "data": { ...tam kayıt... }, "position": "first" | "last" }
{ "op": "delete",  "collection": "orders", "id": "ORD-10483" }
{ "op": "setDoc",  "collection": "wallet", "data": { ...tam doküman... } }
{ "op": "replaceCollection", "collection": "rules", "data": [ ...tüm kayıtlar, sırayla... ] }
```

- `position` yalnızca yeni kayıtta anlamlıdır (`first`: listenin başına, `last`: sonuna; verilmezse `first`, `db.insert` varsayılanı gibi); mevcut kayıt güncellenirken sırası korunur. `GET /api/state` kayıtları bu sırayla döndürür.
- Op'lar idempotenttir (yeniden denemeler ve sekme kapanırken keepalive ile gelen tekrar batch'ler güvenlidir): olmayan kaydı `delete` etmek no-op'tur, var olan kayda `upsert` sırasını değiştirmez. Hatalı bir op tüm batch'i geri alır: `400 {code, message: "ops[i] (...): ..."}` (`INVALID_OP`, `VALIDATION`, `MISSING_ID`).
- Kayıt anahtarı `id`, yoksa `code` alanıdır. Anahtarsız koleksiyonlar (ör. `zip_city`, `history_weekly`) yalnızca `replaceCollection` ile yazılır (`upsert` / `delete` → `400 INVALID_OP`). `products` tablosunun doğal anahtarı `sku`'dur; panel `products`'ı anahtarsız görüp `replaceCollection` ile yazar. `replaceCollection` içinde eksik veya tekrarlanan anahtarlar kaydı değiştirmeden sentetik bir anahtarla saklanır (JS dizisindeki gibi ilk eşleşme geçerlidir).
- Tanınmayan koleksiyon adları genel `app_records` tablosunda saklanır (panelin çalışma anında oluşturduğu `requestLog`, `drafts`, `modelEvents`, `addressFeedback`, `hsFeedback` gibi koleksiyonlar dahil); tanınmayan dokümanlar `app_documents` tablosunda.
- `setDoc` ile `user` yazılırken `password` alanı yok sayılır (şifre yalnızca `change-password` ile değişir). `user` → `users` + `companies`; `wallet` gömülü `transactions` dizisiyle gelir → `wallets` + `wallet_transactions` (değişen / yeni işlemler yazılır, kaldırılanlar silinir, sıra korunur).
- İstek gövdesi sınırı 50 MB (`/api/state/batch`, `/api/state/import`).

### Public uçlar

- **track**: `q` virgül, boşluk veya noktalı virgülle ayrılmış en çok 25 değer. Eşleşme sırası paneldeki `trackLookup` ile aynı: takip no veya gönderi id; yoksa sipariş id / `channelOrderNo` (siparişin en yeni gönderisi); yoksa `reference`. `test: true` gönderiler hariç. `shipment` saklanan gönderi şeklidir (events, from / to, carrier, service, status, eta, reference, orderId ...), ancak her seviyedeki `email` / `phone`, alıcının `to.name`, `to.company`, `to.line1`, `to.line2` alanları ve iç maliyet alanları (`cost`, `pricing`, `walletCharge`, `account`, `scaleReading`) çıkarılır; `carrierName` / `serviceName` eklenir. Boş sorgu: `400 {code:"VALIDATION"}`. IP başına dakikada 120 istek.
- **leads**: `name` ve geçerli `email` zorunlu; `company`, `phone` (null olabilir), `message` isteğe bağlı. Bilinmeyen alanlar (topic, lang, consent, source, createdAt ...) kabul edilir; gövdenin tamamı `leads.data` kolonunda saklanır. `201 {id}` sayısal id döner. IP başına 10 dakikada 10 istek (`429 {code:"RATE_LIMITED"}`).

## Ortam değişkenleri (App Runner)

| Değişken | Örnek |
|---|---|
| `ConnectionStrings__Default` | `Server=<rds-endpoint>;Port=3306;Database=kargopazar;User=kargopazar_app;Password=<şifre>;SslMode=Required;` |
| `Jwt__SigningKey` | en az 32 karakter rastgele değer |
| `Jwt__Issuer` / `Jwt__Audience` | `kargopazar-api` / `kargopazar-panel` |
| `Cors__AllowedOrigins__0..n` | `https://www.kargopazar.com`, `https://kargopazar.com`, Amplify alan adı (hiç verilmezse Production'da yalnızca kargopazar.com ve www) |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Db__ServerVersion` (isteğe bağlı) | `8.0.36-mysql` (AutoDetect yerine; açılışta DB'ye bağlanmaz) |
| `Jwt__ExpiryHours` (isteğe bağlı) | `12` |
| `Seed__TimeZone` (isteğe bağlı) | `Europe/Istanbul`: göreli seed tarihlerinin çevrildiği saat dilimi |

`ConnectionStrings__Default` ve `Jwt__SigningKey` zorunludur; yoksa API açılmaz (Production için kodda yedek anahtar yoktur; `appsettings.json` yalnızca boş yer tutucular içerir). Tam liste: `backend/.env.example`.

## Şema

Ayrıntılar: `database/README.md`. Özet: `users`, `companies`, `wallets`, `wallet_transactions` ilişkisel; her koleksiyon (`backend/Data/collections.json`) kendi tablosunda: anahtar (`id` / `code` / `sku`, anahtarsızlarda `seq`), `sort_order`, tipli indeksli kolonlar, `data`, `created_at`, `updated_at`. Belgeler `app_documents`, çalışma anı koleksiyonları `app_records`, landing formu `leads`, meta (`seed_version`, `seeded_at`) `app_meta` tablosunda. `data` kolonları `LONGTEXT` + `CHECK (JSON_VALID(data))`: MySQL `JSON` tipi nesne anahtarlarını yeniden sıraladığı için; böylece kayıtlar anahtar sırası ve sayı biçimi korunarak birebir döner.

Seed tek kaynaktır: `frontend/src/app/data/seed/*.json` API'ye gömülü kaynak (embedded resource) olarak bağlanır; bu yüzden Docker build context'i repo köküdür (`docker build -f backend/Dockerfile .`). `seedVersion` = `Seed:Version` (`2026.10.2`), seed anında `app_meta` tablosuna yazılır.

## Yerel çalıştırma

1. Bir MySQL 8'e `setup-database.bat localhost 3306 root <şifre>` (veya `database/README.md` içindeki mysql komutları).
2. `backend/appsettings.Development.json` içindeki bağlantı cümlesini (`CHANGE_ME_LOCAL`) kendi şifrenizle değiştirin veya `ConnectionStrings__Default` ortam değişkenini verin.
3. `dotnet run --project backend` → `http://localhost:5000` (Swagger: `/swagger`, yalnızca Development). Boş veritabanı açılışta otomatik seed edilir.
4. Panel: `frontend/.env.local` içinde `VITE_API_BASE_URL=http://localhost:5000/api`, sonra `npm run dev`.

Testler: `dotnet run --project tests/KargoPazar.RoundTrip` (MySQL gerektirmez; SQLite in-memory ile seed → DB → `GET /api/state` birebir karşılaştırma, batch op'ları, auth, reset, export / import, public uçlar, üretilmiş `002_SeedData.sql` ve şema dosyası kontrolü). Canlı API ve gerçek MySQL için: `node tests/verify-api-roundtrip.mjs --base=http://localhost:5000/api --reset` (demo verisini sıfırlar).

## Dağıtım (ECR + App Runner)

`.github/workflows/backend-ecr.yml`: `main` dalına `backend/**`, `database/**` veya `frontend/src/app/data/seed/**` değişikliği push edildiğinde (veya elle `workflow_dispatch`) imajı üretir ve ECR `kargopazar-api` deposuna `:latest` ve `:<commit-sha>` etiketleriyle gönderir. Gerekli GitHub secret'ları: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (ECR push yetkili IAM kullanıcısı), `ECR_REGISTRY` (`<hesap>.dkr.ecr.us-east-1.amazonaws.com`). App Runner servisi ECR `kargopazar-api:latest` kaynağıyla ve **otomatik dağıtım açık** olarak kurulur; her `:latest` push'u yeni sürümü yayına alır. App Runner ayarları: port `8080`, sağlık kontrolü HTTP `/healthz`, yukarıdaki ortam değişkenleri; RDS özel ağdaysa VPC connector.
