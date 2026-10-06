// Platform provider (legal entity behind KargoPazar). Single source for the landing page,
// legal texts, the panel About section and the service provider block of PDF invoices.
export const PLATFORM_COMPANY = Object.freeze({
  brand: 'KargoPazar',
  legalName: 'FENECE YAZILIM DANIŞMANLIK VE TİCARET LİMİTED ŞİRKETİ',
  address: {
    line1: '18 Mart Cad. Tekke Mah. Çardak Beldesi',
    district: 'Lapseki',
    city: 'Çanakkale',
    country: { tr: 'Türkiye', en: 'Türkiye' },
  },
  /** One line address: "18 Mart Cad. Tekke Mah. Çardak Beldesi, Lapseki / Çanakkale / Türkiye" */
  addressLine: '18 Mart Cad. Tekke Mah. Çardak Beldesi, Lapseki / Çanakkale / Türkiye',
  phone: '+90 532 557 74 64',
  email: 'info@fenece.com',
  taxOffice: 'Lapseki Malmüdürlüğü',
  taxId: '3852045917',
  web: 'kargopazar.com',
})

/** "Vergi Dairesi: Lapseki Malmüdürlüğü · VKN: 3852045917" (TR) / "Tax office: ... · Tax ID (VKN): ..." (EN) */
export function taxLine(lang = 'tr', c = PLATFORM_COMPANY) {
  return lang === 'en'
    ? `Tax office: ${c.taxOffice} · Tax ID (VKN): ${c.taxId}`
    : `Vergi Dairesi: ${c.taxOffice} · VKN: ${c.taxId}`
}

/** Single line postal address of a company record { line1, district, city, zip, country }. */
export function formatAddress(a) {
  if (!a) return ''
  if (typeof a === 'string') return a
  const cityPart = [a.district, a.city].filter(Boolean).join(' / ')
  const zipCity = [a.zip, cityPart].filter(Boolean).join(' ')
  const country = a.country === 'TR' ? 'Türkiye' : a.country
  return [a.line1, a.line2, zipCity, country].filter(Boolean).join(', ')
}
