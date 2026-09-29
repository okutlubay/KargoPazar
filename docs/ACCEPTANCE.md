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

## Kimlik

- [x] `demo / Demo123!` ve `demo@kargopazar.com / Demo123!` ile giriş.
- [x] Hatalı şifre mesajı, 5 denemede 30 sn kilit.
- [x] Beni hatırla açık (localStorage, 30 gün) / kapalı (sessionStorage) davranışı.
- [x] `?demo=1` otomatik doldurma.
- [x] Kayıt + e-posta kodu + 6 adımlı sihirbaz, cevaplar Plan ekranında.

## Operasyon (Faz 2)

- [x] Senkronize et yeni siparişler getiriyor.
- [x] CSV içe aktarma şablon, eşleme, hata listesi.
- [x] Adres önerisini uygula skoru yükseltiyor, geri al çalışıyor.
- [x] Tekli gönderi: merkez önerisi, canlı adres skoru, hacimsel ağırlık, AI önerisi + Neden?, kendi hesap satırı, müşteri kuralı etkisi, cüzdandan ödeme, etiket PDF.
- [x] Etiket sonrası 6 halkalı tutarlılık zinciri (Bölüm 3.1): sipariş Etiketlendi, gönderi satırı, cüzdan hareketi, KPI, takip no geri yazma log'u, bildirim.
- [x] Etiket iptali ve iade (USPS gecikmeli iade).
- [x] Dummy label ve "Değiştirildi" akışı.

## Operasyon (Faz 3)

- [x] Toplu optimizasyon, varsayılana göre tasarruf, satır bazında değişiklik, toplu PDF.
- [x] Manifest oluşturma (taşıyıcı ve hava kargo), PDF.
- [x] Operasyon Merkezi paket kabul, ağırlık farkı, düzeltme, cüzdan, bildirim.
- [x] Cüzdan yükleme (başarılı ve reddedilen test kartı, 3DS), otomatik yükleme tetiklenmesi.
- [x] Ağırlık düzeltmesine itiraz.
- [x] Plan değiştirme ve özellik kilitleri.
- [x] Public takip sayfası oturumsuz açılıyor.
