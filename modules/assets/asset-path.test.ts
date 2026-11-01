import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riskAssetPath } from './asset-path'

test('riskAssetPath lleva al detalle o a la fila del activo manual según la clave de riesgo', () => {
  assert.equal(riskAssetPath('asset:a-1'), '/portal/inventory/a-1')
  assert.equal(riskAssetPath('manual:m-1'), '/portal/inventory?nonNetworkAsset=m-1')
  assert.equal(riskAssetPath('office:o-1'), null)
  assert.equal(riskAssetPath('sin-prefijo'), null)
})
