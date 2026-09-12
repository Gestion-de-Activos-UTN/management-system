import assert from 'node:assert/strict'
import test from 'node:test'
import { isAssetExcludedFromAssessments } from './asset-assessment-scope'

const now = new Date('2026-09-12T12:00:00.000Z')

test('legacy and explicitly included assets remain in assessment scope', () => {
  assert.equal(isAssetExcludedFromAssessments({}, now), false)
  assert.equal(isAssetExcludedFromAssessments({ assessment_scope: 'included' }, now), false)
})

test('an exclusion without an end date never expires', () => {
  assert.equal(
    isAssetExcludedFromAssessments(
      { assessment_scope: 'excluded', assessment_excluded_until: null },
      now
    ),
    true
  )
  assert.equal(
    isAssetExcludedFromAssessments(
      { assessment_scope: 'excluded', assessment_excluded_until: 'invalid' },
      now
    ),
    true
  )
})

test('a temporary exclusion stops applying at its expiration instant', () => {
  assert.equal(
    isAssetExcludedFromAssessments(
      { assessment_scope: 'excluded', assessment_excluded_until: '2026-09-12T12:00:01.000Z' },
      now
    ),
    true
  )
  assert.equal(
    isAssetExcludedFromAssessments(
      { assessment_scope: 'excluded', assessment_excluded_until: now.toISOString() },
      now
    ),
    false
  )
})
