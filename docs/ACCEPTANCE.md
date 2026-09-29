# Kabul kontrol listesi

Her faz sonunda ilgili maddeler buraya kopyalanır ve doğrulanarak işaretlenir.

## Faz 1: Altyapı

- [x] `npm run build` hatasız; `dist/app/index.html` oluşuyor.
- [x] `/app/` açılıyor, oturum yokken `/app/#/orders` login'e yönleniyor (`redirect` query ile), girişten sonra hedef sayfaya dönülüyor.
- [x] Seed ilk açılışta yükleniyor (localStorage `kpz_demo:version`), bakiye ve menü sayaçları seed verisinden geliyor.
- [x] `npm run seed` deterministik (iki koşu bayt bazında aynı), seed doğrulamaları (sayılar, cüzdan toplamı) geçiyor.
- [x] Uygulama kabuğu: daraltılabilir kenar çubuğu, komut paleti (Ctrl/Cmd+K), DEMO rozeti, dil anahtarı, bildirim zili, kullanıcı menüsü, rol önizleme şeridi.
- [x] Bileşen kütüphanesi (Bölüm 4.2) ve SVG grafik bileşenleri (Bölüm 4.3) mevcut.
- [x] Konsolda hata yok (login ve kabuk).
