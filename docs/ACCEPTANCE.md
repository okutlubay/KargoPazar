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
- [x] Yasaklı marka kelimeleri taraması (spec Bölüm 0.6) `frontend/` altında boş.
- [x] `grep -rn "—\|–" frontend/src frontend/index.html frontend/app/index.html` boş.
- [x] TR/EN geçişi tüm ekranlarda eksiksiz: 44 ekran iki dilde gezildi, geliştirme modunda eksik anahtar uyarısı çıkmıyor.
- [x] Sayfa yenilendiğinde kullanıcı değişiklikleri korunuyor (localStorage).
- [x] "Demo verisini sıfırla" her şeyi seed'e döndürüyor, şifre `Demo123!` oluyor.
- [x] Konsolda hata yok (44 ekran TR ve EN gezildi).
- [ ] Hiçbir butonun tıklanınca tepkisiz kalmadığı: ekran bazında ajanlarca kontrol edildi, sunum öncesi elle tam tur önerilir.

## Geri bildirim turu (pazaryeri, gümrük, para birimi)

Doğrulama yöntemi: `npm run build`, `npm run seed` doğrulamaları, `dotnet build`, round-trip testleri ve seed verisi üzerinde Node ile motor testleri. Bu tur yerel veritabanı olmadığı için tarayıcıda tıklanarak gezilmedi; işaretsiz maddeler canlı ortamda elle tur atılarak işaretlenecek.

### 1. Demo müşterisi: Türkiye'den ABD'ye satan Türk şirketi
- [x] `user.json`: unvan Anadolu Ev ve El Sanatları Tic. Ltd. Şti. (kısa ad Anatolia Home & Craft), Kâğıthane/İstanbul merkez adresi, +90 telefon, 10 haneli VKN ve vergi dairesi.
- [x] ABD gönderen adresleri "Anatolia Home & Craft c/o KargoPazar NJ01" ve LA01.
- [x] Ekip: Elif Aydın, Burak Şahin, Selin Koç, Deniz Yılmaz; eski ABD'li isimler seed'de yok.
- [x] Tercihler tr / TRY / metric; arayüzde kg/cm, yanında lb/in.
- [x] Tüm ürünler TR menşeli, HS kodu dolu veya öneri bekliyor; merkez bazında stok adetleri.
- [x] Stok akışı (çoğunluk) ve doğrudan akış (~%15) seed'de; stoktan çıkan gönderilerde `firstMileRef`.
- [x] TR ilk mil gönderileri CUS-001'e, UK gönderileri pilot müşteri CUS-010 (Cotswold Candle Co.) kaydına ait.
- [x] Genel Bakış "ABD stok durumu" kartı ve stok tükenme önerisi; buton ilk mil gönderisini ürünlerle açar.
- [x] Kurulum sihirbazı, plan önerisi, landing konumlandırması ve hesaplayıcı varsayılanı "Türkiye (ilk mil)".
- [x] Seed sürümü 2026.10.3; backend açılışta sürüm farkında yeniden seed yükler. Cüzdan toplamı 1.248,60 kontrolü geçiyor.
- [ ] Canlıda demo girişiyle tıklanarak doğrulama.

### 2. Pazaryeri karşılaştırması
- [x] `/#/compare` Teklif Karşılaştır, Operasyon grubunun en üstünde; gönderi oluşturma adım 4 ve ilk mil fiyat adımı aynı `QuoteComparison` bileşenini kullanıyor.
- [x] TR çıkışlı paket teklifler: ilk mil x NJ01/LA01 x son mil ve DHL Express doğrudan; ayak ayak kırılım.
- [x] Kartlarda fark (tutar, %), teslim aralığı, zamanında teslim, rozetler, kural tabanlı artı/eksi (3-5 madde).
- [x] Taşıyıcı servislerinde özellik alanları (imza, cumartesi, PO Box, takip, sigorta, hasar süresi, kesim saati, DDP, iade etiketi).
- [x] 2-4 teklif seçilince yapışkan çubuk, yan yana tablo (en iyi yeşil, en kötü kırmızı) ve AI özeti.
- [x] Kart / Tablo / Grafik görünümü, filtreler ve sıralama.
- [x] Toplu İşlemler'de "Alternatifler (N)".
- [x] Landing hesaplayıcısında artı/eksi kartları ve karşılaştırma.
- [x] Genel Bakış "Pazaryeri özeti" kartı.
- [ ] Canlıda tıklanarak doğrulama.

### 3. Gümrük bilgilendirme
- [x] `hs_duty_rates.json` (24 HS x US/GB/DE/TR), Ayarlar > Gümrük oranları ekranında düzenlenebilir, "Demo oranları" notu.
- [x] ABD de minimis ülke kaydında "askıda / uygulanıyor" + eşik; varsayılan askıda; Yönetim > Ülke Yapılandırması'ndan değişiyor, hesaplamalar ona göre.
- [x] HS kodu seçilince Gümrük Bilgilendirme paneli (vergi kalemleri, landed cost, DDP/DDU, belgeler, ETGB notu, kısıtlar, süre); çok kalemli ilk milde kalem bazında ve toplam.
- [x] Gönderi detayı (son mil ve ilk mil) Gümrük sekmesi; stoktan çıkan gönderide ilk mil gümrük kaydına link.
- [x] Gümrük menüsü ana seviyede, ilk sekme Gümrük Bilgi Merkezi.
- [x] HS Kodu Önerisi kartlarında "Gümrük bilgisini gör".
- [x] Landing'de TR ilk mil seçilince tahmini vergi satırı ve "Gümrük detayını gör".
- [ ] Canlıda tıklanarak doğrulama.

### 4. Para birimi
- [x] Üst çubukta ve landing'de TRY/USD/EUR/GBP seçici, varsayılan TRY, tercih saklanıyor.
- [x] İç hesaplar USD, gösterim dönüştürülüyor; `fx.json` ve "Kur: demo, 1 USD = X TRY" notu; Ayarlar > Birimler'de kur tablosu.
- [x] Tutarlar Money bileşeninden; kalan `$`/`USD` geçişleri yalnızca gümrük (varış para birimi), API sözleşmesi örnekleri ve iç sabitler.
- [x] Cüzdan bakiyesi seçili para biriminde, TRY yükleme seçenekleri ₺2.500/5.000/10.000/25.000, harekette iki para birimi.
- [x] Fatura ve hesap dökümü PDF'leri seçili para biriminde, yanında USD karşılığı.
- [x] Gümrükte vergiler varış ülkesi para birimi ve seçili para biriminde birlikte.
- [x] Biçim: TR `₺1.248,60`, EN `TRY 1,248.60`.
- [ ] Canlıda tıklanarak doğrulama.

### 5. Platform şirketi
- [x] Landing İletişim, Footer, Hakkımızda: FENECE YAZILIM DANIŞMANLIK VE TİCARET LİMİTED ŞİRKETİ, Lapseki/Çanakkale adresi; info@fenece.com eklendi.
- [x] Gizlilik/Şartlar/KVKK veri sorumlusu bilgisi.
- [x] Fatura ve hesap dökümü PDF'lerinde Hizmet sağlayıcı ve Müşteri blokları.
- [x] Ayarlar > Hakkında.
- [x] Kodda "Fenece Teknoloji" kalmadı.

### 6. Kapanış
- [x] Ar-Ge #13, #16, #18, #19, #20, #21 "Demoda göster" linklerine Teklif Karşılaştır, Gümrük Bilgi Merkezi, gönderi detayı Gümrük sekmesi ve ABD stok durumu eklendi.
- [x] `docs/DEMO_SCRIPT.md` güncellendi.
- [x] `npm run build` hatasız; yasaklı kelime ve uzun tire taraması temiz.
