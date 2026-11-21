import assert from 'node:assert/strict'
import test from 'node:test'
import { classificationEfficacy, inventoryEfficacy, shadowItEfficacy } from './automatic-evidence'

test('automatic controls never turn missing data into failure', () => {
  assert.equal(shadowItEfficacy(true, 'unauthorized'), 0)
  assert.equal(shadowItEfficacy(true, 'pending'), null)
  assert.equal(shadowItEfficacy(false, 'authorized'), null)
  assert.equal(inventoryEfficacy(true, false, 'authorized'), null)
  assert.equal(inventoryEfficacy(true, true, 'authorized'), 1)
  // A decided authorization is enough: an unauthorized asset is A.8.20, not missing inventory data.
  assert.equal(inventoryEfficacy(true, true, 'unauthorized'), 1)
  assert.equal(inventoryEfficacy(true, true, 'pending'), null)
  assert.equal(inventoryEfficacy(false, true, 'authorized'), null)
  assert.equal(classificationEfficacy('unknown'), null)
  assert.equal(classificationEfficacy('low'), 1)
})
