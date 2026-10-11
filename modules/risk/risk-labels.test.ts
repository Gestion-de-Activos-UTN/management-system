import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRiskPairs, type RiskInputAsset } from '@/domain/risk/build-pairs'
import { calculateRisk } from '@/domain/risk/engine'
import { riskReasonLabel } from './risk-labels'

const asset = (overrides: Partial<RiskInputAsset>): RiskInputAsset => ({
  key: 'asset:1',
  source: 'network',
  office_id: 'o1',
  risk_type: 'server',
  criticality: 'high',
  identified: true,
  authorization_status: 'authorized',
  has_owner: true,
  cidr: '10.0.0.0/24',
  excluded: false,
  network: { current: true, complete: true, services: [] },
  ...overrides,
})

describe('riskReasonLabel', () => {
  it('has a plain-language reason for every pair the engine can produce', () => {
    const assets = [
      asset({}),
      asset({ key: 'asset:shadow', identified: false, authorization_status: 'pending' }),
      asset({ key: 'asset:no', authorization_status: 'unauthorized', has_owner: false }),
      asset({
        key: 'asset:unknown',
        criticality: 'unknown',
        network: { current: false, complete: false, services: [] },
      }),
      asset({
        key: 'asset:bad',
        network: {
          current: true,
          complete: true,
          services: [{ classification: 'prohibited', severity: 'high' }],
        },
      }),
      asset({
        key: 'asset:rdp',
        network: { current: true, complete: true, services: [{ classification: 'review' }] },
      }),
      asset({ key: 'manual:1', source: 'manual', network: null, excluded: true }),
    ]
    const answers = (['evaluable', 'not_evaluable', 'not_applicable'] as const).map(reason => ({
      control_key: 'A.5.25',
      asset_key: null,
      office_id: reason === 'evaluable' ? null : 'o1',
      efficacy: reason === 'evaluable' ? 1 : null,
      evaluated_at: '2026-09-01T00:00:00.000Z',
      reason_code: reason,
    }))
    const monitoring = ['agent_reporting', 'agent_not_reporting', 'agent_missing'].map(
      (reason, index) => ({ office_id: `o${index + 1}`, efficacy: null, reason_code: reason })
    )
    const { pairs, population } = buildRiskPairs({
      organizationId: 'org',
      policy: 'essential',
      assets,
      answers,
      monitoring,
    })
    const offices = ['o2', 'o3'].map(office_id => asset({ key: `asset:${office_id}`, office_id }))
    const extra = buildRiskPairs({
      organizationId: 'org',
      policy: 'essential',
      assets: offices,
      answers,
      monitoring,
    })
    for (const row of calculateRisk(
      [...pairs, ...extra.pairs],
      [...population, ...extra.population]
    ).contributions) {
      assert.ok(
        riskReasonLabel(row),
        `missing label for ${row.control_key} ${row.reason_code} ${row.status}`
      )
    }
  })
})
