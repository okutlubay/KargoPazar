// Adapter: address model (api/orders.validateAddress) -> AddressForm `validator` prop shape.
import { validateAddress } from '../../api/orders.js'
import { issueText } from '../shipments/helpers.js'

export function makeAddressValidator(opts = {}) {
  return async function validator(address) {
    const r = await validateAddress(address, opts)
    return {
      score: r.score,
      issues: (r.issues ?? []).map(i => ({ ...i, label: i.label ?? issueText(i) })),
      suggestion: r.suggestion?.patch && Object.keys(r.suggestion.patch).length ? { ...r.suggestion.patch } : null,
      raw: r,
    }
  }
}
