import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldGoOffline } from './agingSweep'

const now = new Date('2026-01-01T00:00:00.000Z').getTime()

test('shouldGoOffline: last_seen reciente, dentro del umbral', () => {
  assert.equal(shouldGoOffline('2025-12-31T23:00:00.000Z', 72, now), false)
})

test('shouldGoOffline: last_seen supera el umbral de esta organización', () => {
  assert.equal(shouldGoOffline('2025-12-20T00:00:00.000Z', 72, now), true)
})

test('shouldGoOffline: exactamente en el borde del umbral cuenta como vencido', () => {
  assert.equal(shouldGoOffline('2025-12-29T00:00:00.000Z', 72, now), true)
})

test('shouldGoOffline: sin last_seen es siempre vencido', () => {
  assert.equal(shouldGoOffline(null, 72, now), true)
})

test('shouldGoOffline: umbrales distintos por organización dan resultados distintos para el mismo last_seen', () => {
  const lastSeen = '2025-12-29T12:00:00.000Z'
  assert.equal(shouldGoOffline(lastSeen, 24, now), true)
  assert.equal(shouldGoOffline(lastSeen, 72, now), false)
})
