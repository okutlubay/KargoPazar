// Public tracking page (spec 5.13).
export default {
  tr: {
    track: {
      title: 'Gönderi takibi', subtitle: 'Takip numarası veya sipariş numarası ile gönderinizin nerede olduğunu görün.',
      placeholder: 'Takip no veya sipariş no (birden fazlası için virgülle ayırın)', search: 'Sorgula',
      hint: 'Birden fazla numarayı virgülle ayırarak toplu sorgulayabilirsiniz.', sample: 'Örnek takip numaraları',
      language: 'Dil', backToPanel: 'Panele dön', status: 'Durum',
      head: { label: 'Etiket oluşturuldu', hub: 'Merkezde', transit: 'Yolda', out: 'Dağıtımda', delivered: 'Teslim edildi', exception: 'Teslimatta sorun', returned: 'Göndericiye iade', voided: 'Etiket iptal edildi' },
      eta: 'Tahmini teslim: {date}', deliveredOn: '{date} tarihinde teslim edildi',
      trackingNo: 'Takip no', service: 'Taşıyıcı ve servis', route: 'Güzergah', order: 'Sipariş', progress: 'Gönderi ilerlemesi',
      exceptionNote: 'Taşıyıcı teslimatta bir sorun bildirdi. Gönderici ile iletişime geçebilirsiniz.',
      voidedNote: 'Bu etiket iptal edildi ve taşıyıcıya teslim edilmeyecek.',
      events: 'Hareketler', copyLink: 'Takip linkini kopyala',
      notFound: '"{q}" için sonuç bulunamadı', notFoundDesc: 'Numarayı kontrol edin. Yeni oluşturulan etiketler birkaç dakika içinde görünür.',
      f1: 'Canlı takip', f1d: 'Taşıyıcı olayları tek zaman çizelgesinde.', f2: 'Toplu sorgu', f2d: 'Virgülle ayırarak birden fazla gönderi.', f3: 'Paylaşılabilir', f3d: 'Alıcınıza oturum gerektirmeyen link gönderin.',
      powered: 'Powered by',
      errors: { empty: 'Bir takip numarası girin', VALIDATION: 'Bir takip numarası girin' },
    },
  },
  en: {
    track: {
      title: 'Track a shipment', subtitle: 'See where your parcel is with a tracking or order number.',
      placeholder: 'Tracking or order number (separate several with commas)', search: 'Track',
      hint: 'Separate several numbers with commas to look them up together.', sample: 'Sample tracking numbers',
      language: 'Language', backToPanel: 'Back to panel', status: 'Status',
      head: { label: 'Label created', hub: 'At hub', transit: 'In transit', out: 'Out for delivery', delivered: 'Delivered', exception: 'Delivery issue', returned: 'Returned to sender', voided: 'Label voided' },
      eta: 'Estimated delivery: {date}', deliveredOn: 'Delivered on {date}',
      trackingNo: 'Tracking number', service: 'Carrier and service', route: 'Route', order: 'Order', progress: 'Shipment progress',
      exceptionNote: 'The carrier reported a delivery issue. You can contact the sender.',
      voidedNote: 'This label was voided and will not be handed to the carrier.',
      events: 'Scan events', copyLink: 'Copy tracking link',
      notFound: 'No results for "{q}"', notFoundDesc: 'Check the number. New labels appear within a few minutes.',
      f1: 'Live tracking', f1d: 'Carrier scans in one timeline.', f2: 'Bulk lookup', f2d: 'Several shipments separated by commas.', f3: 'Shareable', f3d: 'Send your buyer a link that needs no login.',
      powered: 'Powered by',
      errors: { empty: 'Enter a tracking number', VALIDATION: 'Enter a tracking number' },
    },
  },
}
