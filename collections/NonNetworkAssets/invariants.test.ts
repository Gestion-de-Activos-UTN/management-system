import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertOfficeInScope,
  computeNextReviewAt,
  computeReviewStatus,
  MissingOfficeError,
  OfficeOutOfScopeError,
  resolveReviewIntervalDays,
} from './invariants'

test('office-scope: permite una office dentro del alcance del usuario', () => {
  assert.doesNotThrow(() => assertOfficeInScope('office-a', ['office-a', 'office-b'], false))
})

test('office-scope: bloquea una office de otro tenant', () => {
  assert.throws(
    () => assertOfficeInScope('office-z', ['office-a', 'office-b'], false),
    OfficeOutOfScopeError
  )
})

test('office-scope: bloquea si no hay office', () => {
  assert.throws(() => assertOfficeInScope(null, ['office-a'], false), MissingOfficeError)
})

test('office-scope: platform_admin sin organización seleccionada no está restringido', () => {
  assert.doesNotThrow(() => assertOfficeInScope('office-z', [], true))
})

test('office-scope: platform_admin sigue necesitando una office', () => {
  assert.throws(() => assertOfficeInScope(null, [], true), MissingOfficeError)
})

// El status importa tanto como el bloqueo: un rechazo de autorización que sale como 500
// es indistinguible de un bug del servidor para quien consume la API.
test('office-scope: office ajena es 403, office faltante es 400', () => {
  const statusOf = (e: unknown) => (e as { status?: number }).status
  assert.throws(
    () => assertOfficeInScope('office-z', ['office-a'], false),
    e => statusOf(e) === 403
  )
  assert.throws(
    () => assertOfficeInScope(null, ['office-a'], false),
    e => statusOf(e) === 400
  )
})

test('intervalo: by_category gana sobre default_days', () => {
  const policy = { default_days: 90, by_category: { backup: 30 } }
  assert.equal(resolveReviewIntervalDays(policy, 'backup'), 30)
})

test('intervalo: cae en default_days si la categoría no está en la política', () => {
  const policy = { default_days: 90, by_category: { backup: 30 } }
  assert.equal(resolveReviewIntervalDays(policy, 'cloud_asset'), 90)
})

test('intervalo: sin política no hay default', () => {
  assert.equal(resolveReviewIntervalDays(null, 'backup'), null)
})

test('intervalo: ignora valores no positivos', () => {
  assert.equal(resolveReviewIntervalDays({ default_days: 0 }, 'backup'), null)
  assert.equal(
    resolveReviewIntervalDays({ default_days: 90, by_category: { backup: -1 } }, 'backup'),
    90
  )
})

test('next_review_at: suma los días de la categoría sobre la fecha dada', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const result = computeNextReviewAt({ by_category: { backup: 30 } }, 'backup', now)
  assert.equal(result, '2026-01-31T00:00:00.000Z')
})

test('next_review_at: cruza el fin de año sin romper', () => {
  const now = new Date('2026-12-20T00:00:00.000Z')
  const result = computeNextReviewAt({ default_days: 30 }, 'other', now)
  assert.equal(result, '2027-01-19T00:00:00.000Z')
})

test('next_review_at: sin política devuelve null (lo carga el usuario)', () => {
  assert.equal(computeNextReviewAt(null, 'backup', new Date('2026-01-01T00:00:00.000Z')), null)
})

test('next_review_at: no muta la fecha recibida', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  computeNextReviewAt({ default_days: 30 }, 'other', now)
  assert.equal(now.toISOString(), '2026-01-01T00:00:00.000Z')
})

test('review_status: sin next_review_at es ok, no overdue', () => {
  assert.equal(computeReviewStatus(null, new Date('2026-01-01T00:00:00.000Z')), 'ok')
})

test('review_status: fecha futura es ok', () => {
  assert.equal(
    computeReviewStatus('2026-02-01T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z')),
    'ok'
  )
})

test('review_status: fecha pasada es overdue', () => {
  assert.equal(
    computeReviewStatus('2025-12-01T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z')),
    'overdue'
  )
})
