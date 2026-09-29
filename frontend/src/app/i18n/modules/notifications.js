// Notification center page (/notifications).
export default {
  tr: {
    notifications: {
      subtitle: 'Adres uyarıları, ağırlık düzeltmeleri, model önerileri ve entegrasyon olayları tek yerde.',
      searchPlaceholder: 'Bildirimlerde ara…',
      tabs: { all: 'Tümü', unread: 'Okunmamış' },
      filters: { type: 'Tür' },
      groups: { today: 'Bugün', yesterday: 'Dün', week: 'Bu hafta', older: 'Daha eski' },
      types: {
        address: 'Adres', adjustment: 'Ağırlık düzeltmesi', forecast: 'Talep tahmini', pricing: 'Dinamik fiyat', integration: 'Entegrasyon',
        manifest: 'Manifest', wallet: 'Cüzdan', refund: 'İade', system: 'Sistem', country: 'Ülke yapılandırması', tests: 'Entegrasyon testleri',
        success: 'Başarılı', warning: 'Uyarı', error: 'Hata', info: 'Bilgi',
      },
      actions: { readAll: 'Tümünü okundu işaretle', clearRead: 'Okunanları temizle', markRead: 'Okundu işaretle', markUnread: 'Okunmadı işaretle', remove: 'Bildirimi sil' },
      open: 'Aç', unreadLabel: 'Okunmamış',
      clear: { title: 'Okunan bildirimler silinsin mi?', message: '{n} okunmuş bildirim listeden kaldırılır.', confirm: 'Okunanları temizle' },
      toast: {
        read: 'Bildirim okundu olarak işaretlendi', unread: 'Bildirim okunmadı olarak işaretlendi', removed: 'Bildirim silindi',
        allRead: '{n} bildirim okundu olarak işaretlendi', nothingUnread: 'Okunmamış bildirim yok', cleared: '{n} okunmuş bildirim temizlendi',
      },
      empty: {
        title: 'Bildirim yok', desc: 'Yeni siparişler, etiketler ve model önerileri burada görünecek.',
        filtered: 'Arama veya tür filtresini değiştirin.', allReadTitle: 'Hepsi okundu', allReadDesc: 'Okunmamış bildiriminiz yok.',
      },
    },
  },
  en: {
    notifications: {
      subtitle: 'Address warnings, weight adjustments, model suggestions and integration events in one place.',
      searchPlaceholder: 'Search notifications…',
      tabs: { all: 'All', unread: 'Unread' },
      filters: { type: 'Type' },
      groups: { today: 'Today', yesterday: 'Yesterday', week: 'This week', older: 'Older' },
      types: {
        address: 'Address', adjustment: 'Weight adjustment', forecast: 'Demand forecast', pricing: 'Dynamic pricing', integration: 'Integration',
        manifest: 'Manifest', wallet: 'Wallet', refund: 'Refund', system: 'System', country: 'Country setup', tests: 'Integration tests',
        success: 'Success', warning: 'Warning', error: 'Error', info: 'Info',
      },
      actions: { readAll: 'Mark all as read', clearRead: 'Clear read', markRead: 'Mark as read', markUnread: 'Mark as unread', remove: 'Delete notification' },
      open: 'Open', unreadLabel: 'Unread',
      clear: { title: 'Delete read notifications?', message: '{n} read notifications are removed from the list.', confirm: 'Clear read' },
      toast: {
        read: 'Notification marked as read', unread: 'Notification marked as unread', removed: 'Notification deleted',
        allRead: '{n} notifications marked as read', nothingUnread: 'No unread notifications', cleared: '{n} read notifications cleared',
      },
      empty: {
        title: 'No notifications', desc: 'New orders, labels and model suggestions will appear here.',
        filtered: 'Change the search or type filter.', allReadTitle: 'All caught up', allReadDesc: 'You have no unread notifications.',
      },
    },
  },
}
