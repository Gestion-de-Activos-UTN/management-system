import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ComplianceResult } from '@/app/types/payload-types'
import { answerEvidence, assetKey, selectAnswer, type AnswerEvidence } from './answer-evidence'

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'r-1',
    control_key: 'A.5.15',
    status: 'compliant',
    office: null,
    asset: null,
    manual_asset: null,
    evaluated_at: '2026-11-20T10:00:00.000Z',
    reason_code: 'evaluable',
    evidence_snapshot: {
      assessment_id: 'a-1',
      evaluation_effect: {
        combined_efficacy: 1,
        applied_rules: [],
        sub_efficacies: [
          { question_key: 'q1', option_key: 'yes', base: 1, adjusted: 1, answered_at: '2026-11-19T09:00:00.000Z' },
        ],
      },
    },
    ...overrides,
  }) as unknown as ComplianceResult

const evidence = (overrides: Partial<AnswerEvidence>): AnswerEvidence => ({
  control_key: 'A.8.13',
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

describe('answerEvidence', () => {
  it('derives the origin; an asset row keeps the office it was answered in', () => {
    const own = answerEvidence(row({ asset: 'n1', office: 'o1' }))
    assert.equal(own.origin, 'asset')
    assert.equal(own.asset_key, 'asset:n1')
    assert.equal(own.office_id, 'o1')
    assert.equal(answerEvidence(row({ office: 'o1' })).origin, 'office')
    assert.equal(answerEvidence(row()).origin, 'organization')
  })

  it('formats manual asset keys exactly like loaded assets', () => {
    const manual = answerEvidence(row({ manual_asset: 'm1', office: 'o1' }))
    assert.equal(manual.asset_key, 'manual:m1')
    assert.equal(manual.asset_key, assetKey({ manual_asset: 'm1' }))
  })

  it('never scores not_applicable or not_evaluable rows, whatever the snapshot says', () => {
    const notApplicable = answerEvidence(
      row({ status: 'not_applicable', evidence_snapshot: { evaluation_effect: { combined_efficacy: 0 } } })
    )
    assert.equal(notApplicable.applicability, 'not_applicable')
    assert.equal(notApplicable.compliance, null)
    assert.equal(
      answerEvidence(
        row({ status: 'not_evaluable', evidence_snapshot: { evaluation_effect: { combined_efficacy: 0 } } })
      ).compliance,
      null
    )
  })

  it('keeps a partial value, its sub-answers and provenance', () => {
    const partial = answerEvidence(
      row({
        status: 'partially_effective',
        evidence_snapshot: {
          assessment_id: 'a-9',
          evaluation_effect: { combined_efficacy: 0.5, applied_rules: ['r'], sub_efficacies: [{ question_key: 'q1' }] },
        },
      })
    )
    assert.equal(partial.compliance, 0.5)
    assert.equal(partial.sub.length, 1)
    assert.deepEqual(partial.applied_rules, ['r'])
    assert.equal(partial.assessment_id, 'a-9')
    assert.equal(partial.completed_at, '2026-11-20T10:00:00.000Z')
  })

  it('tolerates a snapshot without sub-answers', () => {
    assert.deepEqual(answerEvidence(row({ evidence_snapshot: {} })).sub, [])
  })
})

describe('selectAnswer', () => {
  const target = { control_key: 'A.8.13', asset_key: 'asset:n1', office_id: 'o1', scope: 'office' as const }

  it('prefers own answer, then its office, then the organization', () => {
    const organization = evidence({ result_id: 'org' })
    const office = evidence({ origin: 'office', office_id: 'o1', result_id: 'off' })
    const otherOffice = evidence({ origin: 'office', office_id: 'o2', result_id: 'off2' })
    const own = evidence({ origin: 'asset', asset_key: 'asset:n1', office_id: 'o1', result_id: 'own' })
    assert.equal(selectAnswer([organization, office, own], target)?.result_id, 'own')
    assert.equal(selectAnswer([organization, office], target)?.result_id, 'off')
    assert.equal(selectAnswer([organization, otherOffice], target)?.result_id, 'org')
  })

  it('never lets an asset-scoped control inherit from office or organization', () => {
    const inherited = [evidence({}), evidence({ origin: 'office', office_id: 'o1' })]
    assert.equal(selectAnswer(inherited, { ...target, scope: 'asset' }), undefined)
  })

  it('takes the most recent closing; a reopened cycle closed later wins (Plan §8.10)', () => {
    const first = evidence({ result_id: 'r-old', completed_at: '2026-10-01T00:00:00.000Z' })
    const reopened = evidence({ result_id: 'r-new', completed_at: '2026-11-01T00:00:00.000Z' })
    assert.equal(selectAnswer([reopened, first], target)?.result_id, 'r-new')
    assert.equal(selectAnswer([first, reopened], target)?.result_id, 'r-new')
  })

  it('breaks an exact tie by the lowest result id, by code point and in any input order', () => {
    const at = '2026-11-01T00:00:00.000Z'
    const ids = [
      'f0000000-0000-4000-8000-000000000000',
      '10000000-0000-4000-8000-000000000000',
      '10000000-0000-4000-8000-00000000000a',
      '9fffffff-ffff-4fff-bfff-ffffffffffff',
    ]
    const candidates = ids.map(id => evidence({ result_id: id, completed_at: at }))
    for (const order of [candidates, [...candidates].reverse()])
      assert.equal(selectAnswer(order, target)?.result_id, '10000000-0000-4000-8000-000000000000')
  })
})
