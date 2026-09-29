# KargoPazar veritabanı (MySQL 8 / AWS RDS)

| Dosya | Ne yapar |
|---|---|
| `000_CreateDatabase.sql` | `kargopazar` veritabanını (utf8mb4 / utf8mb4_0900_ai_ci) ve uygulama kullanıcısı `kargopazar_app`'i oluşturur (yalnızca SELECT/INSERT/UPDATE/DELETE). |
| `001_InitialSchema.sql` | Tüm tablolar (InnoDB). `CREATE TABLE IF NOT EXISTS`, tekrar çalıştırılabilir. |
| `002_SeedData.sql` | **Üretilmiş** demo verisi (`generate-seed-sql.mjs`). İsteğe bağlı, aşağıya bakın. |
| `generate-seed-sql.mjs` | `frontend/src/app/data/seed/*.json` dosyalarından `002_SeedData.sql` üretir. |
| `../setup-database.bat` | 000, 001 ve (isteğe bağlı) 002'yi sırayla çalıştırır. |

## AWS RDS'te kurulum

1. **RDS MySQL 8.0** örneği oluşturun (ör. `db.t4g.micro`). App Runner'ın erişebilmesi için güvenlik grubunda 3306'yı App Runner VPC connector'ının güvenlik grubuna (veya herkese açık uç kullanıyorsanız ilgili IP'lere) açın. Kurulumu yapacağınız makinenin IP'sini de geçici olarak ekleyin.
2. `000_CreateDatabase.sql` içindeki `CHANGE_ME_STRONG_PASSWORD` değerini güçlü bir şifreyle değiştirin (dosyayı commit etmeyin ya da değiştirdikten sonra geri alın).
3. Scriptleri **master kullanıcı** ile bu sırayla çalıştırın:

   ```bat
   setup-database.bat <rds-endpoint> 3306 admin <master-şifre>
   ```

   veya elle:

   ```bash
   mysql -h <rds-endpoint> -P 3306 -u admin -p --default-character-set=utf8mb4 < database/000_CreateDatabase.sql
   mysql -h <rds-endpoint> -P 3306 -u admin -p --default-character-set=utf8mb4 < database/001_InitialSchema.sql
   # isteğe bağlı:
   mysql -h <rds-endpoint> -P 3306 -u admin -p --default-character-set=utf8mb4 < database/002_SeedData.sql
   ```

   (`setup-database.bat` şifreyi komut satırında `-p<şifre>` olarak geçirir; şifrede `& ^ % ! < > |` gibi karakterler varsa elle çalıştırın.)
4. App Runner ortam değişkeni:
   `ConnectionStrings__Default=Server=<rds-endpoint>;Port=3306;Database=kargopazar;User=kargopazar_app;Password=<2. adımdaki şifre>;SslMode=Required;`
   Diğer değişkenler: `docs/BACKEND.md` ve `backend/.env.example`.

### Uygulama kullanıcısının şifresini değiştirmek

```sql
ALTER USER 'kargopazar_app'@'%' IDENTIFIED BY '<yeni-şifre>';
```

Sonra App Runner'da `ConnectionStrings__Default` değerini güncelleyip yeniden dağıtın.

## Demo verisi: 002 isteğe bağlıdır

- API açılışta veritabanında hiç kullanıcı yoksa seed'i kendisi yükler (tarihler o anki zamana göre). Yani 000 + 001 yeterlidir.
- `002_SeedData.sql` üretildiği andaki tarihlerle donmuştur (dosya başındaki `seed-now`). Sadece API'yi başlatmadan veriyi görmek/incelemek isterseniz kullanın.
- Panelde **Ayarlar > Demo verisini sıfırla** (`POST /api/state/reset`) tüm demo verisini seed'den **güncel tarihlerle** yeniden yükler ve şifreyi `Demo123!`'e döndürür. `leads` (landing iletişim formu) tablosu sıfırlamadan etkilenmez.
- Demo giriş: `demo` veya `demo@kargopazar.com` / `Demo123!`.

## 002'yi yeniden üretmek

Seed dosyaları değiştiğinde:

```bash
node database/generate-seed-sql.mjs                                   # şimdiki zamana göre
node database/generate-seed-sql.mjs --now=2026-10-01T09:00:00Z        # deterministik
node database/generate-seed-sql.mjs --tz=Europe/Istanbul --out=/tmp/seed.sql
```

Saat dilimi varsayılanı `backend/appsettings.json` içindeki `Seed:TimeZone` (Europe/Istanbul); göreli tarihler (`{daysAgo, hour, minute}`) panelin `resolveDates()` kuralıyla o saat dilimindeki yerel saate çevrilir.

## Şema notları

- Hibrit şema: `users`, `companies`, `wallets`, `wallet_transactions` ilişkisel; her panel koleksiyonu (`orders`, `shipments`, ...) kendi tablosunda, sorgulanan alanlar tipli ve indeksli kolonlarda, tam kayıt `data` kolonunda. Belge türündeki seed'ler (`rate_cards`, `roles`, `system`, `counters`, ...) `app_documents`'ta, panelin çalışırken oluşturduğu koleksiyonlar (`requestLog`, `drafts`, ...) `app_records`'ta.
- `data` kolonları bilerek `LONGTEXT` + `CHECK (JSON_VALID(data))`: MySQL'in `JSON` tipi nesne anahtarlarını yeniden sıralar; API kayıtları panelin yazdığı anahtar sırası ve sayı biçimiyle birebir geri döndürmek zorunda. JSON fonksiyonları (`JSON_EXTRACT(data, '$.status')` vb.) bu kolonlarda da çalışır.
- Tipli kolonlar türetilmiş kopyalardır; API her yazmada yeniden hesaplar. Koleksiyon kolonlarının listesi `backend/Data/collections.json` ile aynıdır (`tests/KargoPazar.RoundTrip` ikisinin uyumunu kontrol eder). Yeni tipli kolon eklerken: `collections.json` + `001_InitialSchema.sql` (+ mevcut veritabanı için `ALTER TABLE`), sonra `002`'yi yeniden üretin.
- Kayıt anahtarları `utf8mb4_bin` (JavaScript id'leri gibi büyük/küçük harf duyarlı).
