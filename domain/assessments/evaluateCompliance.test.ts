import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateAnswer, resolveEffectiveAnswer } from './evaluateCompliance'

describe('effective assessment evidence', () => {
  it('turns an expired negative answer into not evaluable, never non-compliant', () => {
    const effective = resolveEffectiveAnswer(
      [{ id: 'a1', answer: 'no', source: 'exact', valid_until: '2026-01-01T00:00:00Z' }],
      new Date('2026-01-02T00:00:00Z')
    )
    assert.deepEqual(evaluateAnswer(effective), {
      status: 'not_evaluable',
      severity: 'medium',
      reason_code: 'answer_expired',
      explanation:
        'The previous answer has expired. A new review is needed before SIAM can evaluate this routine.',
    })
  })

  it('prefers current exact evidence over inherited evidence', () => {
    const effective = resolveEffectiveAnswer(
      [
        { id: 'inherited', answer: 'no', source: 'inherited', valid_until: '2027-01-01T00:00:00Z' },
        { id: 'exact', answer: 'yes', source: 'exact', valid_until: '2027-01-01T00:00:00Z' },
      ],
      new Date('2026-01-01T00:00:00Z')
    )
    assert.equal(effective.state === 'current' && effective.candidate.id, 'exact')
  })

  it('keeps unknown and justified not applicable outside risk', () => {
    for (const answer of ['unknown', 'not_applicable'] as const) {
      const effective = resolveEffectiveAnswer(
        [{ id: answer, answer, source: 'exact', valid_until: '2027-01-01T00:00:00Z' }],
        new Date('2026-01-01T00:00:00Z')
      )
      assert.equal(evaluateAnswer(effective).status, 'not_evaluable')
    }
  })
})
