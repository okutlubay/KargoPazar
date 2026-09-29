// Data sync (backend API), save indicator, offline login and demo data size texts.
export default {
  tr: {
    sync: {
      status: { saved: 'Kaydedildi', saving: 'Kaydediliyor…', error: 'Kaydedilemedi' },
      retry: 'Tekrar dene',
      retryTip: 'Değişiklikler sunucuya kaydedilemedi. Şimdi tekrar denemek için tıklayın.',
      tip: 'Değişiklikler otomatik olarak sunucuya kaydedilir',
      lastSaved: 'Son kayıt: {time}',
      failedRetrying: 'Değişiklikler kaydedilemedi, yeniden deneniyor',
      recovered: 'Değişiklikler kaydedildi',
      resetFailed: 'Demo verisi sıfırlanamadı, lütfen tekrar deneyin',
      login: { offline: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.' },
      demo: {
        desc: 'Tüm veriler sunucuda (MySQL) saklanır ve tüm demo ziyaretçileri tarafından paylaşılır. Değişiklikler birkaç yüz milisaniye içinde kaydedilir.',
        storage: 'Veri boyutu',
        collections: 'Koleksiyon',
        quota: '{used} (bellekteki verinin yaklaşık boyutu, %{pct})',
        breakdown: 'Veri dökümü',
        breakdownDesc: 'Sunucudan yüklenen koleksiyonlar ve yaklaşık boyutları.',
        nothingStored: 'Henüz yüklenmiş veri yok.',
        key: 'Koleksiyon',
      },
    },
    core: {
      errors: {
        NETWORK_ERROR: 'Sunucuya ulaşılamadı, lütfen tekrar deneyin',
        TIMEOUT: 'Sunucu zamanında yanıt vermedi, lütfen tekrar deneyin',
        WEAK_PASSWORD: 'Yeni şifre yeterince güçlü değil',
      },
    },
  },
  en: {
    sync: {
      status: { saved: 'Saved', saving: 'Saving…', error: 'Not saved' },
      retry: 'Retry',
      retryTip: 'Changes could not be saved to the server. Click to retry now.',
      tip: 'Changes are saved to the server automatically',
      lastSaved: 'Last saved: {time}',
      failedRetrying: 'Changes could not be saved, retrying',
      recovered: 'Changes saved',
      resetFailed: 'Demo data could not be reset, please try again',
      login: { offline: 'The server could not be reached. Check your connection and try again.' },
      demo: {
        desc: 'All data is stored on the server (MySQL) and shared by every demo visitor. Changes are saved within a few hundred milliseconds.',
        storage: 'Data size',
        collections: 'Collections',
        quota: '{used} (approximate size of the loaded data, {pct}%)',
        breakdown: 'Data breakdown',
        breakdownDesc: 'Collections loaded from the server and their approximate size.',
        nothingStored: 'No data loaded yet.',
        key: 'Collection',
      },
    },
    core: {
      errors: {
        NETWORK_ERROR: 'The server could not be reached, please try again',
        TIMEOUT: 'The server did not respond in time, please try again',
        WEAK_PASSWORD: 'The new password is not strong enough',
      },
    },
  },
}
