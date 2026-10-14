import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScanReportPayloadSchema } from '@/contracts/scan-report.schema'
import { buildDemoReports } from './seedDemoData'

test('demo reports satisfy the real Scanner to Platform contract', () => {
  const reports = buildDemoReports(new Date('2026-10-03T15:00:00.000Z'))
  assert.equal(reports.length, 3)
  for (const report of reports)
    assert.equal(ScanReportPayloadSchema.safeParse(report).success, true)
  assert.equal(new Set(reports.map(report => report.report_id)).size, reports.length)
  assert.equal(
    new Set(reports.flatMap(report => report.assets.map(asset => asset.asset_id))).size,
    reports.reduce((total, report) => total + report.assets.length, 0)
  )
})

test('demo reports cover full, degraded, current and stale evidence', () => {
  const now = new Date('2026-10-03T15:00:00.000Z')
  const reports = buildDemoReports(now)
  assert.ok(reports.some(report => report.scan_mode === 'full'))
  assert.ok(reports.some(report => report.scan_mode === 'degraded'))
  assert.ok(
    reports.some(report => now.getTime() - Date.parse(report.scan_end) > 72 * 60 * 60 * 1000)
  )
  assert.ok(reports.some(report => report.assets.some(asset => asset.mac === '')))
  assert.ok(reports.some(report => report.assets.some(asset => asset.services.length > 1)))
})
