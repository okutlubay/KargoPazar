import { ref } from 'vue';

const trStrings = {
  nav: { product: "Ürün", integrations: "Entegrasyonlar", ai: "AI", pricing: "Hesapla", about: "Hakkımızda", contact: "İletişim", login: "Giriş Yap", signup: "Ücretsiz Başla" },
  hero: {
    pill: "Teknopark Ar-Ge Projesi",
    title: "Tek panel,\nyüzlerce kargo seçeneği,\nuluslararası satış.",
    sub: "Etsy ve Shopify mağazalarınızı bağlayın; 30+ uluslararası kargo firması arasından AI destekli en iyi rotayı saniyeler içinde seçin. Gümrükten teslimat onayına kadar her şey tek panelde.",
    cta1: "14 gün ücretsiz deneyin", cta2: "Demo izle",
    meta: "Kredi kartı gerektirmez · 2 dakikada kurulum · Türkiye merkezli destek",
  },
  logos: "Önde gelen pazaryerleri ve taşıyıcılarla entegre",
  features: { eyebrow: "Platform", title: "Sınır ötesi satış için ihtiyacınız olan her şey", sub: "Sipariş geldiğinde fiyat karşılaştır, etiketi yazdır, gümrük formunu otomatik doldur. Tek bir API, tek bir panel." },
  calc: { eyebrow: "Canlı araç", title: "Kargo karşılaştırma", sub: "Gönderiniz için en uygun fiyatlı taşıyıcıyı saniyeler içinde bulun. AI motor, geçmiş 12 milyon gönderiden öğrendi." },
  integrations: { eyebrow: "Entegrasyonlar", title: "Mağazanızı dakikalar içinde bağlayın", sub: "OAuth ile güvenli bağlantı. Siparişler otomatik akar; etiket ve gümrük formu hazır gelir." },
  ai: { eyebrow: "Yapay Zeka", title: "Veriden öğrenen,\nkararı veren motor", sub: "Her gönderi modelimizi güçlendirir. Adresten gümrük koduna, fiyatlandırmadan rota seçimine kadar 7 ayrı model birlikte çalışır." },
  dashboard: { eyebrow: "Panel", title: "Operasyonun komuta merkezi", sub: "Tüm satışlarınız, taşıyıcılarınız ve müşterileriniz tek görünümde. Gönderi takibinden iade yönetimine kadar." },
  about: {
    eyebrow: "Hakkımızda", title: "Türkiye'den dünyaya, sınırsız ticaret",
    p1: "Kargopazaryeri, Türkiye'deki KOBİ ve e-ihracat satıcılarının uluslararası lojistik karmaşasıyla daha az boğuşmasını sağlamak için kuruldu. Etsy ve Shopify mağazaları için tasarlanan platformumuz, taşıyıcı seçimi, gümrük süreci ve fiyatlandırmayı yapay zeka ile otomatize eder.",
    p2: "Projemiz, Teknopark bünyesinde Ar-Ge faaliyeti olarak yürütülmektedir. 7 farklı yapay zeka modülünün geliştirilmesi, 30+ kargo firması ve büyük pazaryerleri ile entegrasyonu, uluslararası gümrük operasyonlarında otomasyon hedefliyoruz.",
  },
  contact: { eyebrow: "İletişim", title: "Konuşalım", sub: "Demo, fiyatlandırma veya entegrasyon hakkında. 1 iş günü içinde dönüş garanti." },
  footer: { tagline: "AI destekli sınır ötesi kargo platformu.", product: "Ürün", company: "Şirket", resources: "Kaynaklar", legal: "Yasal", copyright: "© 2026 Kargopazaryeri Bilişim A.Ş. Tüm hakları saklıdır.", teknopark: "Teknopark Ar-Ge Projesi" },
};

const enStrings = {
  nav: { product: "Product", integrations: "Integrations", ai: "AI", pricing: "Calculate", about: "About", contact: "Contact", login: "Sign in", signup: "Start free" },
  hero: {
    pill: "Teknopark R&D project",
    title: "One panel,\nhundreds of carriers,\nborderless commerce.",
    sub: "Connect your Etsy and Shopify stores; pick the AI-recommended route from 30+ international carriers in seconds. From customs to delivery confirmation — all in one place.",
    cta1: "Start 14-day free trial", cta2: "Watch demo",
    meta: "No credit card · 2-minute setup · Turkey-based support",
  },
  logos: "Integrated with leading marketplaces and carriers",
  features: { eyebrow: "Platform", title: "Everything you need for cross-border selling", sub: "When an order arrives, compare rates, print the label, auto-fill customs forms. One API, one panel." },
  calc: { eyebrow: "Live tool", title: "Rate comparison", sub: "Find the best-priced carrier for your shipment in seconds. Our AI engine learned from 12M past shipments." },
  integrations: { eyebrow: "Integrations", title: "Connect your store in minutes", sub: "Secure OAuth connection. Orders flow automatically; labels and customs forms come ready." },
  ai: { eyebrow: "Artificial Intelligence", title: "An engine that learns\nand decides", sub: "Every shipment strengthens the model. From addresses to HS codes, from pricing to route — 7 models work together." },
  dashboard: { eyebrow: "Dashboard", title: "Command center for your operations", sub: "All your sales, carriers and customers in one view. From tracking to return management." },
  about: {
    eyebrow: "About", title: "From Turkey to the world, borderless commerce",
    p1: "Kargopazaryeri was founded to free SMEs and e-export sellers in Turkey from the chaos of international logistics. Built for Etsy and Shopify stores, our platform automates carrier selection, customs and pricing with AI.",
    p2: "Our project is conducted as an R&D activity under Teknopark. We aim to develop 7 distinct AI modules, integrate with 30+ carriers and major marketplaces, and automate international customs operations.",
  },
  contact: { eyebrow: "Contact", title: "Let's talk", sub: "Demo, pricing or integration. 1 business day response guaranteed." },
  footer: { tagline: "AI-powered cross-border shipping platform.", product: "Product", company: "Company", resources: "Resources", legal: "Legal", copyright: "© 2026 Kargopazaryeri Bilişim Inc. All rights reserved.", teknopark: "Teknopark R&D Project" },
};

function getInitialLang() {
  if (typeof localStorage === 'undefined') return 'tr';
  const stored = localStorage.getItem('kpz_lang');
  return (stored === 'tr' || stored === 'en') ? stored : 'tr';
}

export const currentLang = ref(getInitialLang());

export const t = ref(currentLang.value === 'en' ? enStrings : trStrings);

export function setLang(newLang) {
  currentLang.value = newLang;
  t.value = newLang === 'en' ? enStrings : trStrings;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('kpz_lang', newLang);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = newLang;
  }
}
