// Texts for accounts with demo texts turned off (user.demoMode === false, e.g. a company's own
// workspace). t() reads a key here first for such accounts, then falls back to the regular
// messages. Only keys whose regular text mentions the demo belong here; components hide the
// demo-only hints (DEMO badge, 3-D Secure note, TOTP code preview ...) themselves via session.demoMode.
export default {
  tr: {
    apiConsole: {
      sandboxNote: 'Konsol istekleri gerçek API katmanında çalışır: fiyatlar fiyat motorundan gelir, canlı anahtarla oluşturulan gönderiler cüzdandan düşer.',
      webhooks: { urlHint: 'HTTPS zorunlu. .invalid veya localhost adreslerine teslimat başarısız olur.' },
    },
    billing: {
      card: { testTitle: 'Test kartları' },
      topup: { bankName: 'Kartı veren banka' },
      adj: { stepDecision: 'Karar (sonuç bildirimi)' },
    },
    fx: {
      note: 'Kur: 1 USD = {rate} {cur}',
      noteTitle: 'Kur tablosu ({date}). Hesaplamalar USD ile yapılır, tutarlar seçilen para biriminde gösterilir.',
      table: { source: 'Kaynak: platform kur tablosu', reset: 'Varsayılan kurlara dön' },
    },
    about: {
      desc: 'Platform sağlayıcısı, uygulama sürümü ve şirket bilgileri.',
      seed: 'Referans veri sürümü',
      demoCompany: 'Müşteri şirketi',
    },
    customsInfo: {
      disclaimer: 'Tahmini oranlardır, resmi tarifenin yerine geçmez.',
      panel: { missing: '{dest} için oranı tanımlı olmayan HS kodları: {codes}', noRate: 'Bu varış ülkesi için oran tanımlı değil' },
    },
    docs: {
      invoice: { fx: 'Değerler menşe para biriminden ({cur} {total}) {rate} kuru ile USD’ye çevrilmiştir.' },
      test: { envs: { demo: 'Test' } },
    },
    intl: {
      errors: { FILE_NOT_STORED: 'Dosya içeriği saklanmadı (yalnızca adı kaydedildi)' },
      detail: {
        demoNote: 'Aşamayı elle ilerletir. Aşama olayları normalde taşıyıcılardan (DHL, Evri, CBP) otomatik gelir.',
        fxUsed: 'Kur 1 {cur} = {rate} USD',
        recipientsDemo: 'Alıcı listesi taşıyıcıdan gelecek; etiketler {hub} merkezinde basılır.',
      },
      new: { fxNote: 'Değerler menşe para biriminde ({cur}) girilir. USD karşılığı sabit kurla gösterilir: 1 {cur} = {rate} USD.' },
      upload: { note: 'Belgeler gümrük müşavirine ve CBP\'ye iletilir. 320 KB altındaki dosyaların içeriği saklanır.' },
    },
    shell: {
      resetDemo: 'Verileri sıfırla',
      resetTitle: 'Veriler sıfırlansın mı?',
      resetDesc: 'Sipariş, gönderi, cüzdan ve diğer tüm hesap verileri silinir. Şirket bilgileriniz ve şifreniz korunur, oturumunuz açık kalır.',
      resetDone: 'Veriler sıfırlandı',
    },
    ops: { intake: { scanHint: 'El terminali okuttuğunda Enter gönderir. "Örnek barkod okut" sıradaki bekleyen etiketi doldurur.' } },
    orders: { marketplace: { body: 'Sipariş, pazaryerinin satıcı panelinde yeni sekmede açılır. Bu sipariş için pazaryeri bağlantısı bulunamadı.' } },
    settings: {
      subtitle: 'Hesap, şirket, güvenlik, gönderi kuralları, ekip ve veri ayarları.',
      sections: { demo: 'Veriler' },
      errors: { INVALID_EXPORT: 'Dosya geçerli bir KargoPazar dışa aktarımı değil' },
      audit: { categories: { demo: 'Veri' }, actions: { demo_export: 'Veriler dışa aktarıldı', demo_import: 'Veriler içe aktarıldı' } },
      demo: {
        title: 'Veriler',
        exportDesc: 'Hesabınızdaki tüm verileri JSON olarak indirin.',
        importConfirm: 'Mevcut tüm veriler dosyadakiyle değiştirilecek. Oturumunuz açık kalır.',
        dropHint: 'KargoPazar dışa aktarımı (.json)',
        resetTitle: 'Verileri sıfırla',
        resetDesc: 'Sipariş, gönderi, cüzdan ve diğer tüm hesap verilerini siler. Şirket bilgileri ve şifre korunur.',
        resetConfirm: 'Sipariş, gönderi, cüzdan ve diğer tüm hesap verileri silinir. Şirket bilgileriniz ve şifreniz korunur, oturumunuz açık kalır.',
      },
    },
    shipments: {
      actions: { scanHint: 'Bir sonraki takip olayını ekler' },
      void: {
        uspsNote: 'USPS iadeleri taşıyıcı onayıyla 15 gün içinde tamamlanır.',
        donePending: 'Etiket iptal edildi. {amount} iade USPS onayı bekliyor.',
      },
    },
    sync: {
      resetFailed: 'Veriler sıfırlanamadı, lütfen tekrar deneyin',
      demo: { desc: 'Tüm veriler sunucuda (MySQL) saklanır. Değişiklikler birkaç yüz milisaniye içinde kaydedilir.' },
    },
  },
  en: {
    apiConsole: {
      sandboxNote: 'Console requests run on the real API layer: prices come from the rate engine and shipments created with a live key are charged to the wallet.',
      webhooks: { urlHint: 'HTTPS required. Deliveries to .invalid or localhost addresses fail.' },
    },
    billing: {
      card: { testTitle: 'Test cards' },
      topup: { bankName: 'Card issuer' },
      adj: { stepDecision: 'Decision (result notification)' },
    },
    fx: {
      note: 'Rate: 1 USD = {rate} {cur}',
      noteTitle: 'Rate table ({date}). Calculations run in USD; amounts are shown in the selected currency.',
      table: { source: 'Source: platform rate table', reset: 'Back to default rates' },
    },
    about: {
      desc: 'Platform provider, application version and company details.',
      seed: 'Reference data version',
      demoCompany: 'Customer company',
    },
    customsInfo: {
      disclaimer: 'Estimated rates, not a substitute for the official tariff.',
      panel: { missing: 'HS codes without a rate for {dest}: {codes}', noRate: 'No rate defined for this destination' },
    },
    docs: {
      invoice: { fx: 'Values converted to USD from the origin currency ({cur} {total}) at the rate {rate}.' },
      test: { envs: { demo: 'Test' } },
    },
    intl: {
      errors: { FILE_NOT_STORED: 'File content was not stored (only its name was saved)' },
      detail: {
        demoNote: 'Advances the stage manually. Stage events normally arrive automatically from the carriers (DHL, Evri, CBP).',
        fxUsed: 'Rate 1 {cur} = {rate} USD',
        recipientsDemo: 'The recipient list will come from the carrier; labels are printed at {hub}.',
      },
      new: { fxNote: 'Values are entered in the origin currency ({cur}). USD equivalents use a fixed rate: 1 {cur} = {rate} USD.' },
      upload: { note: 'Documents go to the customs broker and CBP. The content of files under 320 KB is stored.' },
    },
    shell: {
      resetDemo: 'Reset data',
      resetTitle: 'Reset data?',
      resetDesc: 'Orders, shipments, wallet activity and all other account data are removed. Your company details and password are kept and you stay signed in.',
      resetDone: 'Data has been reset',
    },
    ops: { intake: { scanHint: 'Handheld scanners send Enter after a scan. "Scan sample barcode" fills in the next waiting label.' } },
    orders: { marketplace: { body: 'The order opens in the marketplace seller dashboard in a new tab. No marketplace link was found for this order.' } },
    settings: {
      subtitle: 'Account, company, security, shipping rules, team and data settings.',
      sections: { demo: 'Data' },
      errors: { INVALID_EXPORT: 'The file is not a valid KargoPazar export' },
      audit: { categories: { demo: 'Data' }, actions: { demo_export: 'Data exported', demo_import: 'Data imported' } },
      demo: {
        title: 'Data',
        exportDesc: 'Download all data in your account as JSON.',
        importConfirm: 'All current data will be replaced with the file. You stay signed in.',
        dropHint: 'KargoPazar export (.json)',
        resetTitle: 'Reset data',
        resetDesc: 'Removes orders, shipments, wallet activity and all other account data. Company details and password are kept.',
        resetConfirm: 'Orders, shipments, wallet activity and all other account data are removed. Your company details and password are kept and you stay signed in.',
      },
    },
    shipments: {
      actions: { scanHint: 'Adds the next tracking event' },
      void: {
        uspsNote: 'USPS refunds are approved by the carrier within 15 days.',
        donePending: 'Label voided. The {amount} refund is waiting for USPS approval.',
      },
    },
    sync: {
      resetFailed: 'Data could not be reset, please try again',
      demo: { desc: 'All data is stored on the server (MySQL). Changes are saved within a few hundred milliseconds.' },
    },
  },
}
