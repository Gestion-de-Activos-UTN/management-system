import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Asset } from '@/app/types/payload-types'
import type { AnswerEvidence } from '@/domain/risk/answer-evidence'
import { buildDeficiencyPairs, type RiskInputAsset } from '@/domain/risk/deficiency-pairs'
import { networkObservation } from '@/domain/risk/network-evidence'
import { buildRiskLists } from '@/domain/risk/risk-lists'
import { contributionFromPair } from '@/domain/risk/persistRiskEvaluation'
import { networkExplanation } from '@/domain/assessments/network-explanations'
import { formatDate } from '@/lib/format-date'
import { itemAction, reasonLabel } from './risk-labels'
import type { DeficiencyItemDTO, PendingItemDTO, ReasonDTO, Subject } from './service'

const observed = (services: unknown[], overrides: Record<string, unknown> = {}) =>
  networkObservation({
    id: 'x',
    status: 'active',
    last_seen: '2026-11-10T00:00:00.000Z',
    identified: true,
    authorization_status: 'authorized',
    confirmed_type: 'server',
    asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
    services,
    ...overrides,
  } as unknown as Asset)

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
  observation: observed([]),
  ...overrides,
})

const answer = (overrides: Partial<AnswerEvidence>): AnswerEvidence => ({
  control_key: 'A.5.25',
  origin: 'organization',
  asset_key: null,
  office_id: null,
  applicability: 'applicable',
  compliance: 1,
  sub: [],
  applied_rules: [],
  assessment_id: 'a-1',
  result_id: 'r-1',
  completed_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

describe('reasonLabel', () => {
  it('has a plain-language text for every reason both lists can carry', () => {
    const telnet = { protocol: 'tcp', port: 23, state: 'open', confidence: 10 }
    const rdp = { protocol: 'tcp', port: 3389, state: 'open', confidence: 10 }
    const assets = [
      asset({}),
      asset({ key: 'asset:shadow', identified: false, authorization_status: 'pending' }),
      asset({ key: 'asset:no', authorization_status: 'unauthorized', has_owner: false }),
      asset({
        key: 'asset:unknown',
        criticality: 'unknown',
        observation: observed([], { status: 'offline' }),
      }),
      asset({
        key: 'asset:partial',
        observation: observed([], {
          asset_coverage: { port_scan: 'partial', service_detection: 'complete' },
        }),
      }),
      asset({ key: 'asset:bad', observation: observed([telnet]) }),
      asset({ key: 'asset:rdp', observation: observed([rdp]) }),
      asset({ key: 'asset:o2', office_id: 'o2' }),
      asset({ key: 'asset:o3', office_id: 'o3' }),
      asset({ key: 'manual:1', source: 'manual', observation: null, excluded: true }),
    ]
    const answers = [
      answer({}),
      answer({ origin: 'office', office_id: 'o1', compliance: null }),
      answer({
        origin: 'office',
        office_id: 'o2',
        applicability: 'not_applicable',
        compliance: null,
      }),
    ]
    const monitoring = ['agent_reporting', 'agent_not_reporting', 'agent_missing'].map(
      (reason, index) => ({ office_id: `o${index + 1}`, efficacy: null, reason_code: reason })
    )
    const { pairs, context } = buildDeficiencyPairs({
      organizationId: 'org',
      policy: 'essential',
      assets,
      answers,
      monitoring,
    })
    // Every reason of both lists reads as text, never as its raw code.
    const lists = buildRiskLists(pairs.map(contributionFromPair), context)
    const reasons = [...lists.deficiencies, ...lists.pending].flatMap(item => item.reasons)
    assert.ok(reasons.length > 5)
    for (const reason of reasons) {
      const { title, detail } = reasonLabel(reason)
      assert.ok(title && title !== reason.reason_code, `raw label for ${reason.key}`)
      assert.ok(
        !title.startsWith('answer_') && !detail?.startsWith('answer_'),
        `raw label for ${reason.key}`
      )
    }
  })
  const reason = (overrides: Partial<ReasonDTO>): ReasonDTO => ({
    key: 'asset:g|A.8.21|tcp:23|network.telnet.confirmed',
    list: 'deficiency',
    class: 'deficiency',
    priority: 'high',
    reason_code: 'network_prohibited',
    adjustments: [],
    ...overrides,
  })

  it('reads a network service from the same explanation Assessment shows', () => {
    const telnet = reasonLabel(
      reason({ check_key: 'network.telnet.confirmed', service_key: 'tcp:23' })
    )
    assert.equal(telnet.title, 'TCP 23')
    assert.equal(
      telnet.detail,
      networkExplanation({
        check_key: 'network.telnet.confirmed',
        reason_code: 'network_prohibited',
      })
    )
  })

  it('dates the D26 antecedent as observation or evaluation, as it was stored', () => {
    const pending = (date_kind: 'observation' | 'evaluation') =>
      reasonLabel(
        reason({
          list: 'pending',
          class: 'missing_information',
          priority: null,
          reason_code: 'service_state_unconfirmed',
          check_key: 'network.service:tcp:23',
          service_key: 'tcp:23',
          previous: {
            result_id: 'r',
            check_key: 'network.telnet.confirmed',
            date: '2026-11-01T12:00:00.000Z',
            date_kind,
          },
        })
      ).detail!
    const date = formatDate('2026-11-01T12:00:00.000Z')
    assert.ok(
      pending('observation').endsWith(
        `En la observación del ${date} estaba clasificado como no permitido.`
      )
    )
    assert.ok(pending('evaluation').includes(`En la evaluación del ${date}`))
  })

  it('splits an answer into the option and the question prompt', () => {
    const label = reasonLabel(
      reason({
        reason_code: 'answer_no',
        question_key: 'A.5.15.access_revocation',
        option_key: 'no',
      })
    )
    assert.match(label.title, /^Respuesta: /)
    assert.ok(label.detail && label.detail !== 'A.5.15.access_revocation')
  })
})

describe('itemAction', () => {
  const item = (
    subject: Subject,
    reasons: Partial<ReasonDTO>[],
    control_key = 'A.5.9'
  ): PendingItemDTO => ({
    key: 'k',
    group: 'survey',
    control_key,
    importance: null,
    subject,
    reasons: reasons.map(overrides => ({
      key: 'r',
      list: 'pending',
      class: 'missing_information',
      priority: null,
      reason_code: 'inventory_completeness',
      adjustments: [],
      ...overrides,
    })),
  })
  const asset = (asset_key: string): Subject => ({
    kind: 'asset',
    asset_key,
    asset_label: 'x',
    criticality: 'low',
  })

  it('opens the inventory for every subject kind and keeps asOrganization', () => {
    assert.equal(
      itemAction(item(asset('asset:1'), [{}]), 'org-9')?.href,
      '/portal/inventory/1?asOrganization=org-9'
    )
    assert.equal(
      itemAction(item(asset('manual:7'), [{}]), 'org-9')?.href,
      '/portal/inventory?nonNetworkAsset=7&asOrganization=org-9'
    )
    assert.equal(
      itemAction(item({ kind: 'office', id: 'o1', label: 'Palermo', affected_assets: 2 }, [{}]))
        ?.href,
      '/portal/inventory?officeId=o1'
    )
    assert.equal(
      itemAction(item({ kind: 'organization', id: 'org', label: 'Org', affected_assets: 2 }, [{}]))
        ?.href,
      '/portal/inventory'
    )
    // A key without a prefix has no page: no link rather than a broken one.
    assert.equal(itemAction(item(asset('broken'), [{}])), null)
  })

  it('sends answers to the reviews and has no page for the office agent', () => {
    const answer: DeficiencyItemDTO = {
      ...item(asset('asset:1'), [
        { list: 'deficiency', reason_code: 'answer_no', question_key: 'q', option_key: 'no' },
      ]),
      priority: 'high',
      compliance: 0,
      status: 'non_compliant',
    }
    assert.equal(itemAction(answer)?.href, '/portal/security-review')
    assert.equal(
      itemAction(
        item(
          { kind: 'office', id: 'o1', label: 'P', affected_assets: 0 },
          [{ reason_code: 'agent_missing' }],
          'A.8.16'
        )
      ),
      null
    )
  })
})
