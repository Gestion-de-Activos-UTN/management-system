import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Asset, AssessmentInstance } from '@/app/types/payload-types'
import { inventoryEfficacy } from '@/domain/risk/automatic-evidence'
import {
  evaluateAssetFacts,
  evaluateAutomaticComplianceForAssessment,
  evaluateOfficeMonitoring,
  priorResultWhere,
  reevaluateComplianceAfterScan,
} from './evaluateAutomaticCompliance'

type Row = Record<string, unknown> & { id: string; evaluated_at: string; createdAt: string }

// Minimal in-memory compliance-results honouring equals/exists/in, so the real where is exercised.
const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([field, condition]) => {
    if (field === 'and') return (condition as Record<string, unknown>[]).every(item => matches(row, item))
    const { equals, exists, in: within } = condition as { equals?: unknown; exists?: boolean; in?: unknown[] }
    const value = row[field] ?? null
    if (exists !== undefined) return exists ? value !== null : value === null
    if (within) return within.includes(value)
    return value === equals
  })

function fakePayload(asset: Record<string, unknown>, rows: Row[]) {
  let clock = 0
  return {
    findByID: async () => asset,
    find: async ({ where, limit }: { where: Record<string, unknown>; limit?: number }) => {
      const docs = rows
        .filter(row => matches(row, where))
        .sort((a, b) => b.evaluated_at.localeCompare(a.evaluated_at) || b.createdAt.localeCompare(a.createdAt))
      return { docs: limit === 1 ? docs.slice(0, 1) : docs, hasNextPage: false }
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      clock += 1
      const row = { ...data, id: `new-${rows.length + 1}`, createdAt: `2026-11-20T00:00:0${clock}.000Z` } as Row
      rows.push(row)
      return row
    },
  }
}

const gatewayAsset = (state: string) => ({
  id: 'g1',
  status: 'active',
  last_seen: '2026-11-19T00:00:00.000Z',
  identified: true,
  owner: 'u1',
  criticality: 'high',
  authorization_status: 'authorized',
  confirmed_type: 'gateway',
  asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
  services: [{ protocol: 'tcp', port: 23, state, confidence: 10 }],
})

const assessment = {
  id: 'as-1',
  organization: 'org-1',
  office: 'o1',
  asset: 'g1',
  scope: 'asset',
  policy_key: 'essential',
  policy_version: 1,
} as unknown as AssessmentInstance

describe('automatic compliance checks', () => {
  it('uses known inventory fields without turning missing data into failure', () => {
    const missing = evaluateAssetFacts({
      identified: true,
      owner: null,
      criticality: null,
      authorization_status: 'pending',
    })
    assert.deepEqual(
      missing.map(check => check.status),
      ['not_evaluable', 'not_evaluable', 'not_evaluable']
    )
    const unauthorized = evaluateAssetFacts({
      identified: true,
      owner: 'user-1',
      criticality: 'high',
      authorization_status: 'unauthorized',
    })
    assert.equal(
      unauthorized.find(check => check.control_key === 'A.8.20')?.status,
      'non_compliant'
    )
    // A decided authorization completes the inventory; the problem is reported once, by A.8.20.
    assert.equal(unauthorized.find(check => check.control_key === 'A.5.9')?.status, 'compliant')
  })

  it('leaves criticality to A.5.12: missing criticality never makes the inventory incomplete', () => {
    const facts = evaluateAssetFacts({
      identified: true,
      owner: 'user-1',
      criticality: null,
      authorization_status: 'authorized',
    })
    assert.equal(facts.find(check => check.control_key === 'A.5.9')?.status, 'compliant')
    assert.equal(facts.find(check => check.control_key === 'A.5.12')?.status, 'not_evaluable')
  })

  it('agrees with the index for every combination (same rule and projection as recalculateRisk)', () => {
    const owners: Asset['owner'][] = [null, 'user-1', { id: 'user-1' } as Asset['owner']]
    const authorizations: Asset['authorization_status'][] = ['authorized', 'unauthorized', 'pending', null]
    for (const identified of [true, false])
      for (const owner of owners)
        for (const authorization_status of authorizations) {
          const assessment = evaluateAssetFacts({ identified, owner, criticality: 'low', authorization_status })
            .find(check => check.control_key === 'A.5.9')!.status === 'compliant'
          // recalculateRisk.ts: has_owner = Boolean(doc.owner), authorization ?? 'pending'.
          const index = inventoryEfficacy(identified, Boolean(owner), authorization_status ?? 'pending') === 1
          assert.equal(assessment, index, JSON.stringify({ identified, owner, authorization_status }))
        }
  })

  it('distinguishes absent visibility from a scanner that stopped reporting', () => {
    const now = new Date('2026-01-01T00:10:00Z')
    assert.equal(evaluateOfficeMonitoring([], now).status, 'not_evaluable')
    assert.equal(
      evaluateOfficeMonitoring(
        [{ id: 'agent-1', lifecycle_status: 'active', last_heartbeat_at: '2026-01-01T00:00:00Z' }],
        now
      ).status,
      'compliant'
    )
    assert.equal(
      evaluateOfficeMonitoring(
        [{ id: 'agent-1', lifecycle_status: 'active', last_heartbeat_at: '2025-12-31T23:00:00Z' }],
        now
      ).status,
      'non_compliant'
    )
  })

  it('loads scan targets only for the currently selected policy version', async () => {
    let assessmentWhere: unknown
    const payload = {
      find: async ({ collection, where }: { collection: string; where?: unknown }) => {
        if (collection === 'organization-settings')
          return {
            docs: [{ assessment_policy_key: 'reinforced', assessment_policy_version: 2 }],
          }
        if (collection === 'subscriptions')
          return { docs: [{ features: { security_assessments: true } }] }
        if (collection === 'assessment-instances') {
          assessmentWhere = where
          return { docs: [] }
        }
        throw new Error(`Unexpected collection ${collection}`)
      },
    }

    await reevaluateComplianceAfterScan(
      payload as never,
      'org-1',
      'office-1',
      [],
      undefined,
      new Date('2026-01-01T00:00:00Z')
    )

    assert.deepEqual(assessmentWhere, {
      and: [
        { organization: { equals: 'org-1' } },
        { policy_key: { equals: 'reinforced' } },
        { policy_version: { equals: 2 } },
        {
          or: [
            { office: { equals: 'office-1' }, scope: { equals: 'office' } },
            { asset: { in: [] }, scope: { equals: 'asset' } },
          ],
        },
      ],
    })
  })

  it('links a service result to its antecedent across check keys, never to another protocol or asset (D26)', async () => {
    const rows: Row[] = [
      { id: 'other-asset', organization: 'org-1', office: 'o1', asset: 'g2', control_key: 'A.8.21', check_key: 'network.telnet.confirmed', service_key: 'tcp:23', evaluated_at: '2026-11-19T00:00:00.000Z', createdAt: '2026-11-19T00:00:00.000Z' },
      { id: 'other-protocol', organization: 'org-1', office: 'o1', asset: 'g1', control_key: 'A.8.21', check_key: 'network.service:udp:23', service_key: 'udp:23', evaluated_at: '2026-11-19T00:00:00.000Z', createdAt: '2026-11-19T00:00:00.000Z' },
    ]
    await evaluateAutomaticComplianceForAssessment(fakePayload(gatewayAsset('open'), rows) as never, assessment, undefined, new Date('2026-11-20T00:00:00Z'))
    const telnet = rows.find(row => row.check_key === 'network.telnet.confirmed' && row.asset === 'g1')!
    assert.equal(telnet.supersedes, null)
    assert.deepEqual((telnet.evidence_snapshot as { observation: unknown }).observation, {
      observed_at: '2026-11-19T00:00:00.000Z',
      asset_status: 'active',
      identified: true,
      authorization_status: 'authorized',
      port_scan: 'complete',
      service_detection: 'complete',
    })

    await evaluateAutomaticComplianceForAssessment(fakePayload(gatewayAsset('filtered'), rows) as never, assessment, undefined, new Date('2026-11-21T00:00:00Z'))
    const uncertain = rows.find(row => row.check_key === 'network.service:tcp:23')!
    assert.equal(uncertain.status, 'not_evaluable')
    assert.equal(uncertain.supersedes, telnet.id)

    // A repeated run links to the latest head, not to the first one.
    await evaluateAutomaticComplianceForAssessment(fakePayload(gatewayAsset('filtered'), rows) as never, assessment, undefined, new Date('2026-11-22T00:00:00Z'))
    assert.equal(rows.filter(row => row.check_key === 'network.service:tcp:23').at(-1)!.supersedes, uncertain.id)
    // Asset facts keep the per-check chain and carry no observation.
    const facts = rows.filter(row => row.check_key === 'asset.inventory.complete')
    assert.equal(facts[1].supersedes, facts[0].id)
    assert.equal('observation' in (facts[0].evidence_snapshot as object), false)
  })

  it('keeps the per-check chain for results without a service', () => {
    const ids = { organizationId: 'org-1', officeId: 'o1', assetId: null }
    assert.deepEqual(priorResultWhere({ control_key: 'A.8.16', check_key: 'office.monitoring.active' }, ids), {
      and: [
        { organization: { equals: 'org-1' } },
        { office: { equals: 'o1' } },
        { asset: { exists: false } },
        { check_key: { equals: 'office.monitoring.active' } },
        { service_key: { exists: false } },
      ],
    })
  })
})
