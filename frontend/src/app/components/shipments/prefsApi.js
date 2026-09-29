// User preference writes used by the shipment wizard (optimizer cost/speed slider, spec 5.5 step 4).
//   saveOptimizerWeight(w) -> { optimizerWeight }     PATCH /v1/me/preferences
import { request, ApiError } from '../../api/client.js'
import { db } from '../../store/db.js'

export function saveOptimizerWeight(weight) {
  return request('PATCH /v1/me/preferences', () => {
    const w = Math.round(Number(weight) * 100) / 100
    if (!(w >= 0 && w <= 1)) throw new ApiError('VALIDATION', 'Weight must be between 0 and 1', 422, { optimizerWeight: 'range' })
    const user = db.doc('user')
    db.patchDoc('user', { preferences: { ...(user.preferences ?? {}), optimizerWeight: w } })
    return { optimizerWeight: w }
  }, { minMs: 80, maxMs: 180 })
}
