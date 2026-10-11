import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enforceAuthorizationInvariant } from './enforceAuthorizationInvariant'

function run(data: Record<string, unknown>, originalDoc: Record<string, unknown>) {
  return (
    enforceAuthorizationInvariant as unknown as (args: {
      data: Record<string, unknown>
      originalDoc: Record<string, unknown>
    }) => Record<string, unknown>
  )({ data, originalDoc })
}

test('un PATCH que pone authorization_status en unauthorized limpia owner/criticality aunque no los toque', () => {
  const result = run(
    { authorization_status: 'unauthorized' },
    { authorization_status: 'authorized', owner: 'user-1', criticality: 'high' }
  )
  assert.equal(result.owner, null)
  assert.equal(result.criticality, null)
})

test('no toca nada si ya está authorized', () => {
  const result = run(
    { criticality: 'medium' },
    { authorization_status: 'authorized', owner: 'user-1', criticality: 'low' }
  )
  assert.equal(result.criticality, 'medium')
  assert.equal('owner' in result, false)
})

test('no reescribe data si owner/criticality ya vienen/están null (sin cambios de más)', () => {
  const result = run(
    { alias: 'nuevo' },
    { authorization_status: 'pending', owner: null, criticality: null }
  )
  assert.deepEqual(result, { alias: 'nuevo' })
})

test('pending por default (sin authorization_status previo) también limpia', () => {
  const result = run({ owner: 'user-2' }, { owner: null, criticality: null })
  assert.equal(result.owner, null)
})
