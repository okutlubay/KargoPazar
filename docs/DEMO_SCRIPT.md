# KargoPazar demo senaryosu (yaklaşık 20 dakika)

Danışman ve Teknopark sunumu için akış. Parantez içindeki numaralar Ar-Ge iş paketi kalemleridir (Yönetim > Ar-Ge İş Paketleri).

**Hazırlık:** temiz tarayıcı profili veya Ayarlar > Demo Verisi > "Demo verisini sıfırla". Adres: `https://www.kargopazar.com/`.

1. **Landing** (#14): konumlandırma metni, hesaplayıcıda Çıkış NJ01, Varış ZIP `90210`, 3 lb. Sonuç panelle aynı fiyat motorundan gelir. "Canlı demoyu aç".
2. **Giriş** (#13): `demo` / `Demo123!` (alanlar `?demo=1` ile dolu gelir). Genel Bakış: KPI kartları ve AI içgörü kartları.
3. **Ar-Ge İş Paketleri** (#1): `/app/#/admin/rnd`. 23/23 tamamlandı, Gantt. "Sunum modu"nu açın; aşağıdaki adımlarda üst şerit ile kalemler arasında ilerleyebilirsiniz.
4. **Siparişler** (#10, #12): "Senkronize et" (mağaza başına yeni sipariş sonuçları), kanal filtreleri. Adres skoru 70'in altındaki bir siparişte "Önerilen düzeltmeyi uygula", skorun yükseldiğini ve "Geri al"ı gösterin (#5).
5. **WooCommerce bağla** (#12): Entegrasyonlar > Pazaryerleri > WooCommerce > Bağla. Mağaza URL'i, izin ekranı, REST API anahtarı adımı, ilk senkron: 12 yeni sipariş.
6. **Gönderi oluştur** (#2, #18, #20): bir siparişten "Gönderi oluştur". Merkez önerisi ve Neden?, canlı adres skoru, hacimsel ağırlık, taşıyıcı listesinde AI önerisi ve Neden? (skor bileşenleri), Maliyet/Hız kaydırıcısı, UPS için "Kendi hesabınız" satırı. "Etiket oluştur ve öde", etiket PDF'i.
7. **Taşıyıcı Hesaplarım** (#20): FedEx bağlayın (hesap no `000000000` hata örneğidir, geçerli 9 haneli bir numara ile devam edin). Yeni gönderide FedEx servisleri iki satır görünür.
8. **Toplu İşlemler** (#18): "Tüm bekleyen siparişler", ön kontrol, AI toplu optimizasyon, varsayılan kurala göre tasarruf, etiketleri oluşturun, tek PDF indirin, "Manifestleri oluştur".
9. **Operasyon Merkezi** (#7, #8): NJ01, "Örnek barkod okut", "Tartıdan oku". Ağırlık farkı çıkan pakette otomatik düzeltme, cüzdan tahsilatı ve bildirim. Taşıyıcıya teslim sekmesi.
10. **AI Merkezi** (#3): mimari şeması. Adres Doğrulama metrikleri ve "Kural vs Kural + ML" (#5). Talep Tahmini: güven bantları, MAPE, veri yeterlilik skoru ve açıklaması (#9). Dinamik Fiyatlandırma: bir öneriyi onaylayın, ardından gönderi oluştururken "Dinamik fiyat" rozetini gösterin (#16).
11. **HS Kodu** (#21): test aracına `handwoven wool kilim pillow case 16x16` yazın; ilk öneri 5702.42. "Farklı kod seç" ile 6304.92 seçin, "Modeli yeniden eğit", aynı başlıkta 6304.92 üste çıkar. Gümrük Belgeleri: CN22/CN23 ve ticari fatura PDF'i.
12. **İlk Mil** (#19, #22): Uluslararası > Yeni gönderi, menşe Türkiye, geçici etiket (dummy label) seçeneği, ödeme. Detayda "Sonraki aşamaya ilerlet" ile aşamaları ilerletin; ABD merkezinde son mil etiketleri oluşur, geçici etiket "Değiştirildi" olur.
13. **Entegrasyon Testleri** (#17, #4): Birleşik Krallık setini çalıştırın (canlı log), geçmiş koşudaki başarısız senaryolar ve düzeltme notları, "Test raporunu indir (PDF)".
14. **Yönetim** (#15, #11, #23, #6): Taşıyıcılar > Yeni taşıyıcı > "Örnek veriyle doldur" (Veho) > Bağlantıyı test et > Etkinleştir; yeni gönderide listede görünür. Tarife Kartları: platform markup'ı. Ülke Yapılandırması: Kanada'yı yeni pazar olarak ekleyin. Sistem Durumu.
15. **Ekip ve kurallar** (#22): kullanıcı menüsü > Rol olarak görüntüle > Finans (kilitli butonlar, üst şerit). Ayarlar > Gönderi Kuralları: "Değer > $250 ise sigorta ve imza" kuralını "Test et".
16. **API** (#2): API ve Webhook'lar > API Konsolu, `/v1/rates` gönderin; İstek log'unda panel işlemleri de görünür.
17. **Kayıt sihirbazı** (#13): çıkış yapmadan `/app/#/signup`; e-posta kodu `246810`, 6 adımlı kurulum ve plan önerisi (isteğe bağlı, sona bırakılabilir).
18. **Sunum sonrası:** Ayarlar > Demo Verisi > "Demo verisini sıfırla".
