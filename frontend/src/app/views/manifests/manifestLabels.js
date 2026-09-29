// Manifest status / kind labels shared by the manifest screens.
import { t } from '../../i18n/index.js'

const TONES = { created: 'info', handed_over: 'success', customs_submitted: 'warning', customs_cleared: 'success' }

export function manifestStatusLabel(status) {
  return ['created', 'handed_over', 'customs_submitted', 'customs_cleared'].includes(status) ? t('manifests.status.' + status) : status
}
export function manifestStatusTone(status) { return TONES[status] ?? 'neutral' }
export function manifestKindLabel(m) {
  if (m?.type === 'air_customs') return t('manifests.kinds.air')
  return m?.formType === 'usps_scan_form' ? t('manifests.kinds.scan') : t('manifests.kinds.eod')
}
