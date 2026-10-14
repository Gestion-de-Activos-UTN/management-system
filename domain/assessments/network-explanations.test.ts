import { test } from 'node:test'
import assert from 'node:assert/strict'
import { networkExplanation } from './network-explanations'

test('networkExplanation: el motivo tiene prioridad sobre el mensaje de la regla', () => {
  // Un servicio que ya no se observa conserva el check_key de su regla original.
  const text = networkExplanation({
    check_key: 'network.remote_access.review',
    reason_code: 'service_no_longer_observed',
  })
  assert.match(text!, /ya no encontró/)
  assert.match(
    networkExplanation({ check_key: 'network.remote_access.review', reason_code: 'network_review' })!,
    /acceso remoto/
  )
  assert.equal(networkExplanation({ check_key: 'desconocido', reason_code: 'otro' }), null)
})
