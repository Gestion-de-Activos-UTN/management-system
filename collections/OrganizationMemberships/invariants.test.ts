import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNoRankEscalation,
  assertNotLastActiveOrgAdmin,
  RankEscalationError,
  LastActiveOrgAdminError,
} from './invariants'

test('rank-escalation: actor rank 1 puede asignar rank 10', () => {
  assert.doesNotThrow(() => assertNoRankEscalation(1, 10))
})

test('rank-escalation: actor rank 10 no puede asignar rank 1', () => {
  assert.throws(() => assertNoRankEscalation(10, 1), RankEscalationError)
})

test('rank-escalation: mismo rank permitido', () => {
  assert.doesNotThrow(() => assertNoRankEscalation(5, 5))
})

test('rank-escalation: sin actor (bootstrap) siempre permitido', () => {
  assert.doesNotThrow(() => assertNoRankEscalation(null, 1))
})

test('último org_admin: bloquea si el conteo post-operación es 0', () => {
  assert.throws(() => assertNotLastActiveOrgAdmin(0), LastActiveOrgAdminError)
})

test('último org_admin: permite si queda al menos 1', () => {
  assert.doesNotThrow(() => assertNotLastActiveOrgAdmin(1))
})
