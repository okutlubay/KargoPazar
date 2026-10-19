// Shipment contents (package step): catalog product picker, HS code, qty and value per line.
export default {
  tr: {
    contents: {
      title: 'Gönderi içeriği',
      intro: 'Paketteki ürünleri seçin veya yazın. HS kodu girilince gümrük bilgisi hemen hesaplanır; beyan değeri bu satırlardan toplanır.',
      introRequired: 'Bu gönderi gümrükten geçecek: ürün, HS kodu, adet ve değer zorunludur. Burada girdiğiniz satırlar Gümrük adımına aktarılır.',
      pickProduct: 'Katalogdan ürün seç',
      pickNone: 'Ürünü elle yazın',
      emptyCatalog: 'Katalogda ürün yok; ürünü elle yazabilirsiniz.',
      fromCatalog: 'Katalog: {sku}',
      stock: 'Stok {hub}: {n}',
      pkgFilled: 'Paket ölçüsü ve ağırlığı seçilen üründen dolduruldu.',
      totalHint: 'İçerik toplamı: {v}. Beyan değeri boş bırakılırsa bu tutar kullanılır.',
      domesticNote: 'Bu gönderi ABD içi son mil. Ürün ABD\'ye ilk mil gönderisiyle girdiği için gümrük işlemleri o aşamada tamamlandı; aşağıdaki tutarlar giriş vergisinin bilgi amaçlı tahminidir.',
      firstMileLink: 'Ürünü ABD\'ye getiren ilk mil gönderisi: {id} (gümrük kaydı)',
      infoCenter: 'Gümrük Bilgi Merkezi\'nde aç',
    },
  },
  en: {
    contents: {
      title: 'Shipment contents',
      intro: 'Pick or type the products in the parcel. Customs information is calculated as soon as an HS code is entered; the declared value is summed from these lines.',
      introRequired: 'This shipment clears customs: product, HS code, quantity and value are required. The lines you enter here carry over to the Customs step.',
      pickProduct: 'Pick from catalog',
      pickNone: 'Type the product',
      emptyCatalog: 'No products in the catalog; you can type the product.',
      fromCatalog: 'Catalog: {sku}',
      stock: 'Stock {hub}: {n}',
      pkgFilled: 'Parcel dimensions and weight were filled from the selected product.',
      totalHint: 'Contents total: {v}. If the declared value is left empty, this amount is used.',
      domesticNote: 'This is a US domestic last-mile shipment. The product entered the US with a first-mile shipment, so customs was completed at that stage; the amounts below are an informational estimate of the import duties.',
      firstMileLink: 'First-mile shipment that brought the product into the US: {id} (customs record)',
      infoCenter: 'Open in Customs Information Center',
    },
  },
}
