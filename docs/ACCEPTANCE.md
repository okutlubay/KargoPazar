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

## AI

- [x] Adres modeli: metrikler, kural vs ML, test aracı, yeniden eğitim ve loss eğrisi.
- [x] Talep tahmini: tüm kırılımlar, bantlar, ayrıştırma, MAPE, yeterlilik skoru, yeniden eğitim.
- [x] Dinamik fiyat: waterfall, onay sonrası Gönderi oluşturma'da "Dinamik fiyat" rozeti ve fiyat.
- [x] Optimizer simülatörü kaydırıcıyla canlı değişiyor, ısı haritası gerçek veriden.
- [x] HS: kilim yastık örneği (5702.42) düzelt + yeniden eğit sonrası 6304.92 üstte.
- [x] Gümrük belgeleri: CN22/CN23 seçimi, de minimis uyarısı, PDF'lerde Türkçe karakter doğru.

## Entegrasyonlar

- [x] WooCommerce bağlanıyor, 12 sipariş.
- [x] Bağlantı reddetme ve kesme.
- [x] Takip no geri yazma log'u, hata kaydını yeniden dene.
- [x] FedEx hesabı bağlama, `000000000` hatası, fiyatlar yan yana.
- [x] API anahtarı oluştur (tek seferlik gösterim), iptal.
- [x] Konsol: rates, shipments (live/test farkı), hatalı JSON 400.
- [x] Webhook test olayı ve yeniden gönder.

## Uluslararası ve Yönetim

- [x] UK ve TR menşeli gönderi oluşturma, aşama ilerletme, son mil etiketleri.
- [x] Test setleri çalışıyor (44/44), canlı log, PDF rapor, geçmiş koşuda düzeltme notları.
- [x] Yeni taşıyıcı sihirbazı, fiyat listesinde görünüyor.
- [x] Tarife değişikliği fiyatlara ve landing hesaplayıcısına yansıyor.
- [x] Müşteriye özel tarife uygulanıyor.
- [x] Ülke ekleme sihirbazı, menşe olarak seçilebiliyor.
- [x] Sistem Durumu kartları ve dağıtım geçmişi.
- [x] Ar-Ge İş Paketleri 23/23, sunum modu ile tüm kalemler gezilebiliyor.
- [x] Rol önizleme (Finans) kısıtları.
- [x] Gönderi kuralları "Test et" ve gerçek akışta tetikleme.

## Landing

- [x] Bölüm 11'deki 14 maddenin tamamı.
- [x] Hesaplayıcı ile uygulama aynı girdide aynı fiyatı veriyor.
- [x] Tüm "Giriş/Başla/Demo" butonları doğru `/app/#/...` rotasına gidiyor.

## Genel

- [x] `npm run build` hatasız; `dist/app/index.html` oluşuyor.
- [x] `/app/#/orders` doğrudan açılıp yenilenince 404 yok (hash yönlendirme).
- [x] `grep -ri "expership\|youparcel\|ship7\|areturnz" frontend/` boş.
- [x] `grep -rn "—\|–" frontend/src frontend/index.html frontend/app/index.html` boş.
- [x] TR/EN geçişi tüm ekranlarda eksiksiz: 44 ekran iki dilde gezildi, geliştirme modunda eksik anahtar uyarısı çıkmıyor.
- [x] Sayfa yenilendiğinde kullanıcı değişiklikleri korunuyor (localStorage).
- [x] "Demo verisini sıfırla" her şeyi seed'e döndürüyor, şifre `Demo123!` oluyor.
- [x] Konsolda hata yok (44 ekran TR ve EN gezildi).
- [ ] Hiçbir butonun tıklanınca tepkisiz kalmadığı: ekran bazında ajanlarca kontrol edildi, sunum öncesi elle tam tur önerilir.
