import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NonNetworkAssetSchema } from './schema'

const base = {
  alias: 'Notebook de Ana',
  asset_category: 'computer',
  criticality: 'medium',
  location: null,
  status: 'active',
  office: '00000000-0000-4000-8000-000000000001',
  review_interval: 'never',
  assessment_scope: 'included',
  assessment_exclusion_reason: null,
  assessment_exclusion_note: null,
  assessment_excluded_until: null,
}

test('NonNetworkAssetSchema: el alta exige elegir un responsable', () => {
  assert.equal(NonNetworkAssetSchema.safeParse({ ...base, owner: '' }).success, false)
  assert.equal(
    NonNetworkAssetSchema.safeParse({ ...base, owner: '00000000-0000-4000-8000-000000000002' })
      .success,
    true
  )
})

test('NonNetworkAssetSchema: un activo que el sistema dejó sin responsable se puede guardar', () => {
  // null sólo lo pone el sistema; el formulario lo conserva al editar otra cosa.
  assert.equal(NonNetworkAssetSchema.safeParse({ ...base, owner: null }).success, true)
})
