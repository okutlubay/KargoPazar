// Overview (spec 5.3)
export default {
  tr: {
    overview: {
      greetMorning: 'Günaydın {name}, işte bugünkü operasyon özetiniz.',
      greetDay: 'İyi günler {name}, işte operasyon özetiniz.',
      greetEvening: 'İyi akşamlar {name}, işte operasyon özetiniz.',
      actions: { orders: 'Siparişler', newShipment: 'Yeni gönderi' },
      rangeNote: '{from} - {to}',
      vsPrev: 'önceki döneme göre',
      daysValue: '{n} gün',
      kpi: {
        count: 'Gönderi sayısı', spend: 'Toplam kargo harcaması', savings: 'AI önerileriyle tasarruf',
        avgDays: 'Ortalama teslim süresi', onTime: 'Zamanında teslim oranı', exceptions: 'İstisna sayısı',
      },
      ai: {
        title: 'AI içgörüleri', hub: 'AI Merkezi', emptyTitle: 'Şu an öneri yok', emptyDesc: 'Modeller yeni veri geldikçe içgörü üretir.',
        address: { title: '{n} bekleyen siparişte adres sorunu var', desc: 'Adres modeli skoru 70\'in altında. Önerilen düzeltmeleri uygulayarak iade ve düzeltme ücretlerini önleyin.', action: 'İncele' },
        forecast: { title: 'Talep tahmini', action: 'Tahmini aç', next4: 'Önümüzdeki 4 hafta (tahmin)', last4: 'Son 4 hafta (gerçekleşen)', band: '%80 güven aralığı' },
        optimizer: {
          title: 'Bekleyen {n} siparişi toplu optimize edin', desc: 'Toplu optimizasyonla tahmini {amount} tasarruf ({pct}).', calculating: 'Tasarruf hesaplanıyor…',
          action: 'Toplu İşlemler\'de aç', ai: 'AI önerisiyle toplam', default: 'Varsayılan kural (UPS Ground)', hubs: 'Merkez dağılımı',
        },
        pricing: { title: '{n} hat için fiyat önerisi onay bekliyor', desc: 'Dinamik fiyatlandırma modeli talep tahmini ve maliyete göre yeni fiyatlar önerdi.', action: 'Önerileri incele', reason: 'Öneriler 4 haftalık hacim tahmini, taşıyıcı kademe indirimi ve pazar referansından hesaplanır.' },
      },
      charts: {
        volume: 'Gönderi hacmi (çıkış merkezine göre)', daily: 'Günlük', weekly: 'Haftalık', carriers: 'Taşıyıcı dağılımı',
        regions: 'Varış bölgesi dağılımı', empty: 'Bu aralıkta gönderi yok',
      },
      regions: { Northeast: 'Kuzeydoğu', Southeast: 'Güneydoğu', Midwest: 'Orta Batı', Southwest: 'Güneybatı', West: 'Batı' },
      todo: {
        title: 'Yapılacaklar', labels: '{n} sipariş etiket bekliyor', adjustments: '{n} ağırlık düzeltmesinin itiraz süresi 7 gün içinde doluyor',
        hs: '{n} ürünün HS kodu onay bekliyor', woo: 'WooCommerce mağazanızı bağlamadınız', address: '{n} siparişte adres düzeltmesi gerekiyor',
        emptyTitle: 'Her şey yolunda', emptyDesc: 'Bekleyen iş yok.',
      },
      recent: {
        title: 'Son gönderiler', id: 'Gönderi', created: 'Oluşturma', recipient: 'Alıcı', carrier: 'Taşıyıcı / servis',
        emptyTitle: 'Henüz gönderi yok', emptyDesc: 'İlk etiketinizi oluşturun.',
      },
    },
  },
  en: {
    overview: {
      greetMorning: 'Good morning {name}, here is today\'s operations summary.',
      greetDay: 'Good afternoon {name}, here is your operations summary.',
      greetEvening: 'Good evening {name}, here is your operations summary.',
      actions: { orders: 'Orders', newShipment: 'New shipment' },
      rangeNote: '{from} - {to}',
      vsPrev: 'vs previous period',
      daysValue: '{n} days',
      kpi: {
        count: 'Shipments', spend: 'Total shipping spend', savings: 'Savings from AI picks',
        avgDays: 'Average delivery time', onTime: 'On-time delivery rate', exceptions: 'Exceptions',
      },
      ai: {
        title: 'AI insights', hub: 'AI Hub', emptyTitle: 'No suggestions right now', emptyDesc: 'Models create insights as new data arrives.',
        address: { title: 'Address issues on {n} waiting orders', desc: 'The address model scored them below 70. Apply the suggested corrections to avoid returns and correction fees.', action: 'Review' },
        forecast: { title: 'Demand forecast', action: 'Open forecast', next4: 'Next 4 weeks (forecast)', last4: 'Last 4 weeks (actual)', band: '80% confidence band' },
        optimizer: {
          title: 'Batch optimize {n} waiting orders', desc: 'Estimated saving with batch optimization: {amount} ({pct}).', calculating: 'Calculating savings…',
          action: 'Open in Batch', ai: 'Total with AI picks', default: 'Default rule (UPS Ground)', hubs: 'Hub split',
        },
        pricing: { title: 'Price suggestions waiting for approval on {n} lanes', desc: 'The dynamic pricing model suggested new prices from the demand forecast and cost.', action: 'Review suggestions', reason: 'Suggestions use the 4 week volume forecast, carrier tier discounts and the market reference.' },
      },
      charts: {
        volume: 'Shipment volume (by origin hub)', daily: 'Daily', weekly: 'Weekly', carriers: 'Carrier split',
        regions: 'Destination regions', empty: 'No shipments in this range',
      },
      regions: { Northeast: 'Northeast', Southeast: 'Southeast', Midwest: 'Midwest', Southwest: 'Southwest', West: 'West' },
      todo: {
        title: 'To do', labels: '{n} orders waiting for a label', adjustments: 'Dispute window closes within 7 days on {n} weight adjustments',
        hs: 'HS codes waiting for approval on {n} products', woo: 'You have not connected your WooCommerce store', address: '{n} orders need an address correction',
        emptyTitle: 'All clear', emptyDesc: 'Nothing is waiting.',
      },
      recent: {
        title: 'Recent shipments', id: 'Shipment', created: 'Created', recipient: 'Recipient', carrier: 'Carrier / service',
        emptyTitle: 'No shipments yet', emptyDesc: 'Create your first label.',
      },
    },
  },
}
