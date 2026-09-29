// Barrel for all PDF generators. Import lazily from screens:
//   const docs = await import('@/app/docs/index.js')
//   docs.downloadLabel(shipment)
export * from './label.js'
export * from './customs.js'
export * from './invoice.js'
export * from './cn22.js'
export * from './cn23.js'
export * from './manifest.js'
export * from './testReport.js'
export * from './statement.js'
export { download, toBlobUrl, toDataUrl, toBlob, printDoc } from './pdf.js'
