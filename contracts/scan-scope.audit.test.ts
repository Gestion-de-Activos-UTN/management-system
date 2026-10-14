import { describe, expect, it } from 'vitest'
import { ScanReportPayloadSchema } from './scan-report.schema'
import { HeartbeatPayloadSchema } from './heartbeat.schema'
import { auditAsset, auditReport } from '@/domain/inventories/remaining-audit-fixtures'
import { parseScanNetwork } from './network'

const auth = { agentId: 'agent', officeId: 'office', organizationId: 'org' }
describe('scanner scope and timestamps', () => {
  it('accepts a valid report and rejects observations outside its network or interval', () => {
    expect(ScanReportPayloadSchema.safeParse(auditReport(auth, [auditAsset(auth)])).success).toBe(true)
    for (const override of [{ ip: '192.168.0.1' }, { scan_time: '2099-01-01T00:00:00Z' }, { scan_time: '2000-01-01T00:00:00Z' }])
      expect(ScanReportPayloadSchema.safeParse(auditReport(auth, [auditAsset(auth, override)])).success).toBe(false)
  })
  it('rejects reversed or future scans and unsupported networks', () => {
    for (const override of [{ scan_start: '2099-01-01T00:00:00Z' }, { scan_end: '2099-01-01T00:00:00Z' }, { network: 'invalid' }, { network: '10.0.0.1/24' }, { network: '8.8.8.0/24' }])
      expect(ScanReportPayloadSchema.safeParse(auditReport(auth, [], override)).success).toBe(false)
    expect(parseScanNetwork('172.16.0.0/16')).not.toBeNull()
  })
  it('bounds heartbeat identifiers and rejects extra properties', () => {
    const heartbeat = { agent_id: 'agent', status: 'idle', timestamp: new Date().toISOString() }
    expect(HeartbeatPayloadSchema.safeParse(heartbeat).success).toBe(true)
    expect(HeartbeatPayloadSchema.safeParse({ ...heartbeat, extra: 'unexpected' }).success).toBe(false)
    expect(HeartbeatPayloadSchema.safeParse({ ...heartbeat, agent_id: 'x'.repeat(121) }).success).toBe(false)
  })
})
