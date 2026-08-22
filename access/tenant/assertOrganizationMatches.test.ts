import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertOrganizationMatches, OrganizationMismatchError } from './assertOrganizationMatches'

test('assertOrganizationMatches: pasa si coincide con la organización del actor', () => {
  assert.doesNotThrow(() => assertOrganizationMatches('org-1', 'org-1', false))
})

test('assertOrganizationMatches: bloquea si pertenece a otra organización', () => {
  assert.throws(() => assertOrganizationMatches('org-2', 'org-1', false), OrganizationMismatchError)
})

test('assertOrganizationMatches: bloquea si el actor no tiene organización resuelta', () => {
  assert.throws(() => assertOrganizationMatches('org-1', null, false), OrganizationMismatchError)
})

test('assertOrganizationMatches: platform_admin sin organización seleccionada no está restringido', () => {
  assert.doesNotThrow(() => assertOrganizationMatches('org-1', null, true))
})

test('assertOrganizationMatches: el mismatch es 403, no 500', () => {
  const statusOf = (e: unknown) => (e as { status?: number }).status
  assert.throws(
    () => assertOrganizationMatches('org-2', 'org-1', false),
    (e) => statusOf(e) === 403
  )
})
