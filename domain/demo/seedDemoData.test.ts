import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScanReportPayloadSchema } from '@/contracts/scan-report.schema'
import { buildDemoReports } from './seedDemoData'

test('demo reports satisfy the real Scanner to Platform contract', () => {
  const reports = buildDemoReports(new Date('2026-10-03T15:00:00.000Z'))
  assert.equal(reports.length, 4)
  for (const report of reports)
    assert.equal(ScanReportPayloadSchema.safeParse(report).success, true)
  assert.equal(new Set(reports.map(report => report.report_id)).size, reports.length)
  // Only the D26 UPS appears in two reports; every other asset is observed once.
  const ids = reports.flatMap(report => report.assets.map(asset => asset.asset_id))
  assert.deepEqual(
    [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
    ['demo-main-ups']
  )
})

test('the D26 UPS goes from Telnet open to filtered, in scan order', () => {
  const reports = buildDemoReports(new Date('2026-10-03T15:00:00.000Z'))
  const scans = reports.flatMap(report =>
    report.assets
      .filter(asset => asset.asset_id === 'demo-main-ups')
      .map(asset => ({ index: reports.indexOf(report), end: report.scan_end, services: asset.services }))
  )
  assert.equal(scans.length, 2)
  assert.ok(scans[0].index < scans[1].index && Date.parse(scans[0].end) < Date.parse(scans[1].end))
  assert.deepEqual(scans.map(scan => scan.services.map(service => `${service.protocol}:${service.port}:${service.state}`)), [
    ['tcp:23:open'],
    ['tcp:23:filtered'],
  ])
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
