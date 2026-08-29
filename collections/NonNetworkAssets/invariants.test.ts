import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertOfficeInScope,
  canReviewNow,
  computeNextReviewAt,
  computeReviewStatus,
  MissingOfficeError,
  OfficeOutOfScopeError,
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

test('next_review_at: never no vence', () => {
  assert.equal(computeNextReviewAt('never', new Date('2026-01-01T00:00:00.000Z')), null)
})

test('next_review_at: 1w suma 7 días', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  assert.equal(computeNextReviewAt('1w', now), '2026-01-08T00:00:00.000Z')
})

test('next_review_at: 1m suma 30 días (mes calendario aproximado)', () => {
  const now = new Date('2026-12-20T00:00:00.000Z')
  assert.equal(computeNextReviewAt('1m', now), '2027-01-19T00:00:00.000Z')
})

test('next_review_at: no muta la fecha recibida', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  computeNextReviewAt('1m', now)
  assert.equal(now.toISOString(), '2026-01-01T00:00:00.000Z')
})

test('can_review: never nunca habilita', () => {
  assert.equal(canReviewNow('2026-01-08T00:00:00.000Z', 'never', new Date('2026-01-01T00:00:00.000Z')), false)
})

test('can_review: sin next_review_at no habilita', () => {
  assert.equal(canReviewNow(null, '1w', new Date('2026-01-01T00:00:00.000Z')), false)
})

test('can_review: vencido siempre habilita', () => {
  assert.equal(canReviewNow('2025-12-01T00:00:00.000Z', '1w', new Date('2026-01-01T00:00:00.000Z')), true)
})

test('can_review: 1d/3d habilitan 12hs antes', () => {
  const dueAt = '2026-01-10T00:00:00.000Z'
  assert.equal(canReviewNow(dueAt, '1d', new Date('2026-01-09T11:00:00.000Z')), false)
  assert.equal(canReviewNow(dueAt, '1d', new Date('2026-01-09T13:00:00.000Z')), true)
})

test('can_review: 1w habilita 1 día antes', () => {
  const dueAt = '2026-01-10T00:00:00.000Z'
  assert.equal(canReviewNow(dueAt, '1w', new Date('2026-01-08T00:00:00.000Z')), false)
  assert.equal(canReviewNow(dueAt, '1w', new Date('2026-01-09T00:00:00.000Z')), true)
})

test('can_review: 1m habilita 5 días antes', () => {
  const dueAt = '2026-02-01T00:00:00.000Z'
  assert.equal(canReviewNow(dueAt, '1m', new Date('2026-01-26T00:00:00.000Z')), false)
  assert.equal(canReviewNow(dueAt, '1m', new Date('2026-01-27T00:00:00.000Z')), true)
})

test('can_review: 6m/1y habilitan 10 días antes', () => {
  const dueAt = '2026-06-01T00:00:00.000Z'
  assert.equal(canReviewNow(dueAt, '6m', new Date('2026-05-21T00:00:00.000Z')), false)
  assert.equal(canReviewNow(dueAt, '6m', new Date('2026-05-22T00:00:00.000Z')), true)
  assert.equal(canReviewNow(dueAt, '1y', new Date('2026-05-22T00:00:00.000Z')), true)
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
