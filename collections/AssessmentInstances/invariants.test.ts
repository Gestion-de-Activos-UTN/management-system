import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertAssessmentMutable, assertAssessmentTarget } from './invariants'

describe('assessment instance invariants', () => {
  it('accepts only targets compatible with their scope', () => {
    assert.doesNotThrow(() => assertAssessmentTarget('organization', null, null))
    assert.doesNotThrow(() => assertAssessmentTarget('office', 'office-1', null))
    assert.doesNotThrow(() => assertAssessmentTarget('asset', 'office-1', 'asset-1'))
    assert.doesNotThrow(() => assertAssessmentTarget('asset', 'office-1', null, 'manual-1'))
    assert.throws(() => assertAssessmentTarget('organization', 'office-1', null), /incompatible/)
    assert.throws(() => assertAssessmentTarget('office', null, null), /incompatible/)
    assert.throws(() => assertAssessmentTarget('asset', 'office-1', null), /incompatible/)
    assert.throws(
      () => assertAssessmentTarget('asset', 'office-1', 'asset-1', 'manual-1'),
      /incompatible/
    )
  })

  it('makes every closed lifecycle state immutable', () => {
    assert.doesNotThrow(() => assertAssessmentMutable('pending'))
    assert.doesNotThrow(() => assertAssessmentMutable('in_progress'))
    for (const status of ['completed', 'expired', 'superseded'] as const) {
      assert.throws(() => assertAssessmentMutable(status), /immutable/, status)
    }
  })
})
