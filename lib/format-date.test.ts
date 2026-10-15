import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDate, formatRelativeDays, formatScanWindow, formatTime } from './format-date'

test('formatRelativeDays cuenta días de calendario, no bloques de 24 h', () => {
  const now = new Date(2026, 9, 3, 23, 30)
  // Una hora después ya es "mañana" aunque no hayan pasado 24 h.
  assert.equal(formatRelativeDays(new Date(2026, 9, 4, 0, 30), now), 'mañana')
  assert.equal(formatRelativeDays(new Date(2026, 8, 30, 12), now), 'hace 3 días')
  assert.equal(formatRelativeDays(new Date(2026, 9, 3, 1), now), 'hoy')
})

test('formatScanWindow muestra la fecha una sola vez, el rango y la duración', () => {
  const start = new Date(2026, 9, 15, 2, 40)
  const end = new Date(2026, 9, 15, 2, 44)
  assert.equal(
    formatScanWindow(start, end),
    `${formatDate(start)} · ${formatTime(start)} → ${formatTime(end)} (4 min)`
  )
  assert.equal(formatScanWindow(start), `${formatDate(start)} · ${formatTime(start)}`)
  // Cruza la medianoche: la fecha de fin se repite porque es otra.
  const nextDay = new Date(2026, 9, 16, 0, 10)
  assert.match(formatScanWindow(start, nextDay), new RegExp(`→ ${formatDate(nextDay)}`))
})
