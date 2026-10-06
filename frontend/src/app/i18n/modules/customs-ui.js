// Customs page (spec 9.3): namespace `customsUi`.
export default {
  tr: {
    customsUi: {
      subtitle: 'HS kodları, üretilen gümrük belgeleri, hava kargo gümrük manifestoları ve ABD gümrüğündeki ilk mil gönderileri.',
      openAutomation: 'Gümrük belge otomasyonu',
      tabs: { hs: 'HS Kodları', docs: 'Belgeler', manifests: 'Manifestler', status: 'Gümrük durumu' },
      hs: {
        status: { missing: 'HS kodu yok', ai_pending: 'AI önerisi onay bekliyor', review: 'Öneri farklı', confirmed: 'Onaylı' },
        product: 'Ürün', origin: 'Menşe', code: 'HS kodu', suggestion: 'AI önerisi', noCode: 'Kod yok', low: 'Düşük güven',
        kpiProducts: 'Katalog ürünü', kpiCoverage: 'HS kapsamı', kpiMissing: 'HS kodu eksik', kpiPending: 'Onay bekleyen öneri',
        search: 'SKU, ürün veya HS kodu ara', openModel: 'HS modeli', bulk: 'Tümüne AI önerisi al', noneMissing: 'HS kodu eksik ürün yok',
        bulkProgress: 'AI önerileri hesaplanıyor: {done}/{total}', bulkDone: '{n} ürün için öneri hazır, onayınızı bekliyor', bulkNone: 'Öneri gereken ürün yok',
        approveAll: 'Tümünü onayla ({n})', approve: 'Onayla', reject: 'Reddet', change: 'Farklı kod', approved: '{n} HS kodu onaylandı, model geri bildirimine eklendi',
        rejected: '{sku} için öneri reddedildi', changeTitle: '{sku} için HS kodu', pick: '24 koddan seç', free: 'veya serbest 6 hane',
        invalidCode: '6 haneli geçerli bir kod girin (ör. 630492)', empty: 'Ürün yok',
      },
      docs: {
        type: 'Belge türü', number: 'Belge no', shipment: 'Gönderi', value: 'Değer (USD)', search: 'Belge no veya gönderi ara',
        empty: 'Henüz gümrük belgesi yok', emptyDesc: 'İlk mil gönderisi oluşturduğunuzda belgeler otomatik üretilir.',
        status: { generated: 'Üretildi', active: 'Aktif', replaced: 'Değiştirildi', uploaded: 'Yüklendi', created: 'Oluşturuldu', customs_submitted: 'Gümrüğe sunuldu', customs_cleared: 'Gümrükten çekildi', handed_over: 'Teslim edildi' },
      },
      manifests: {
        id: 'Manifest', search: 'Manifest, MAWB, uçuş veya gönderi ara', all: 'Tüm manifestler', empty: 'Hava kargo manifestosu yok',
        status: { created: 'Oluşturuldu', customs_submitted: 'Gümrüğe sunuldu', customs_cleared: 'Gümrükten çekildi', handed_over: 'Taşıyıcıya teslim edildi' },
      },
      status: {
        customs: 'Gümrük durumu', inFlight: 'Uçuşta', review: 'Gümrük incelemesinde', docs: 'Ek belge istendi', cleared: 'Çekildi, merkeze yolda',
        requestTitle: '{id}: CBP ek belge istedi ({date})', title: 'ABD gümrüğündeki ilk mil gönderileri', sub: 'Uçuşta, incelemede ve çekilmiş olanlar',
        empty: 'Gümrükte bekleyen gönderi yok', emptyDesc: 'Hava kargodaki gönderiler burada görünür.',
        deMinimis: '> {v}', deMinimisTip: 'ABD muafiyet eşiği ({v}) aşıldı: vergi/harç uygulanabilir',
        deMinimisSuspended: 'Vergiye tabi', deMinimisSuspendedTip: 'ABD muafiyet eşiği askıda: tüm gönderiler beyana ve vergi/harca tabidir',
      },
    },
  },
  en: {
    customsUi: {
      subtitle: 'HS codes, generated customs documents, air cargo customs manifests and first mile shipments at US customs.',
      openAutomation: 'Customs document automation',
      tabs: { hs: 'HS Codes', docs: 'Documents', manifests: 'Manifests', status: 'Customs status' },
      hs: {
        status: { missing: 'No HS code', ai_pending: 'AI suggestion pending', review: 'Suggestion differs', confirmed: 'Confirmed' },
        product: 'Product', origin: 'Origin', code: 'HS code', suggestion: 'AI suggestion', noCode: 'No code', low: 'Low confidence',
        kpiProducts: 'Catalog products', kpiCoverage: 'HS coverage', kpiMissing: 'Missing HS code', kpiPending: 'Suggestions to approve',
        search: 'Search SKU, product or HS code', openModel: 'HS model', bulk: 'Get AI suggestions for all', noneMissing: 'No product is missing an HS code',
        bulkProgress: 'Computing AI suggestions: {done}/{total}', bulkDone: 'Suggestions ready for {n} products, awaiting your approval', bulkNone: 'No product needs a suggestion',
        approveAll: 'Approve all ({n})', approve: 'Approve', reject: 'Reject', change: 'Other code', approved: '{n} HS codes approved and added to model feedback',
        rejected: 'Suggestion rejected for {sku}', changeTitle: 'HS code for {sku}', pick: 'Pick one of the 24 codes', free: 'or enter 6 digits',
        invalidCode: 'Enter a valid 6 digit code (e.g. 630492)', empty: 'No products',
      },
      docs: {
        type: 'Document type', number: 'Document no', shipment: 'Shipment', value: 'Value (USD)', search: 'Search document no or shipment',
        empty: 'No customs documents yet', emptyDesc: 'Documents are generated automatically when you create a first mile shipment.',
        status: { generated: 'Generated', active: 'Active', replaced: 'Replaced', uploaded: 'Uploaded', created: 'Created', customs_submitted: 'Submitted to customs', customs_cleared: 'Cleared customs', handed_over: 'Handed over' },
      },
      manifests: {
        id: 'Manifest', search: 'Search manifest, MAWB, flight or shipment', all: 'All manifests', empty: 'No air cargo manifests',
        status: { created: 'Created', customs_submitted: 'Submitted to customs', customs_cleared: 'Cleared customs', handed_over: 'Handed to carrier' },
      },
      status: {
        customs: 'Customs status', inFlight: 'In flight', review: 'Under customs review', docs: 'Documents requested', cleared: 'Cleared, on the way to the hub',
        requestTitle: '{id}: CBP requested additional documents ({date})', title: 'First mile shipments at US customs', sub: 'In flight, under review and cleared',
        empty: 'Nothing waiting at customs', emptyDesc: 'Shipments in the air appear here.',
        deMinimis: '> {v}', deMinimisTip: 'Above the US de minimis threshold ({v}): duties and taxes may apply',
        deMinimisSuspended: 'Dutiable', deMinimisSuspendedTip: 'US de minimis is suspended: every shipment is subject to formal declaration and duty',
      },
    },
  },
}
