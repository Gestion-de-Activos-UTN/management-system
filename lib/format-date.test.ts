import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRelativeDays } from './format-date'

test('formatRelativeDays cuenta días de calendario, no bloques de 24 h', () => {
  const now = new Date(2026, 9, 3, 23, 30)
  // Una hora después ya es "mañana" aunque no hayan pasado 24 h.
  assert.equal(formatRelativeDays(new Date(2026, 9, 4, 0, 30), now), 'mañana')
  assert.equal(formatRelativeDays(new Date(2026, 8, 30, 12), now), 'hace 3 días')
  assert.equal(formatRelativeDays(new Date(2026, 9, 3, 1), now), 'hoy')
})
