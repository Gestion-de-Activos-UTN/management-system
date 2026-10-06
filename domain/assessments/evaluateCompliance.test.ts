import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveEffectiveAnswer } from './evaluateCompliance'

// Efficacy of the effective answer is covered by domain/risk/control-efficacy.test.ts.
describe('effective assessment evidence', () => {
  it('turns an expired answer into not evaluable, never non-compliant', () => {
    const effective = resolveEffectiveAnswer(
      [{ id: 'a1', option_key: 'none', source: 'exact', valid_until: '2026-01-01T00:00:00Z' }],
      new Date('2026-01-02T00:00:00Z')
    )
    assert.deepEqual(effective, { state: 'not_evaluable', reason_code: 'answer_expired' })
  })

  it('reports a missing answer distinctly from an expired one', () => {
    assert.deepEqual(resolveEffectiveAnswer([], new Date('2026-01-01T00:00:00Z')), {
      state: 'not_evaluable',
      reason_code: 'answer_missing',
    })
  })

  it('prefers current exact evidence over inherited evidence', () => {
    const effective = resolveEffectiveAnswer(
      [
        {
          id: 'inherited',
          option_key: 'none',
          source: 'inherited',
          valid_until: '2027-01-01T00:00:00Z',
        },
        {
          id: 'exact',
          option_key: 'formal',
          source: 'exact',
          valid_until: '2027-01-01T00:00:00Z',
        },
      ],
      new Date('2026-01-01T00:00:00Z')
    )
    assert.equal(effective.state === 'current' && effective.candidate.id, 'exact')
  })
})
