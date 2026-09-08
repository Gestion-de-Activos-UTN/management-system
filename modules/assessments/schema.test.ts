import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AssessmentAnswerDraftSchema, UpdateAssessmentPolicySchema } from './schema'

describe('assessment command schemas', () => {
  it('requires a justification only for not applicable', () => {
    assert.equal(
      AssessmentAnswerDraftSchema.safeParse({
        question_key: 'q',
        question_version: 1,
        answer: 'unknown',
      }).success,
      true
    )
    assert.equal(
      AssessmentAnswerDraftSchema.safeParse({
        question_key: 'q',
        question_version: 1,
        answer: 'not_applicable',
      }).success,
      false
    )
    assert.equal(
      AssessmentAnswerDraftSchema.safeParse({
        question_key: 'q',
        question_version: 1,
        answer: 'not_applicable',
        justification: 'We do not keep files on this device.',
      }).success,
      true
    )
  })

  it('accepts only versioned catalog policies', () => {
    assert.equal(
      UpdateAssessmentPolicySchema.safeParse({ policy_key: 'essential', policy_version: 1 })
        .success,
      true
    )
    assert.equal(
      UpdateAssessmentPolicySchema.safeParse({ policy_key: 'custom', policy_version: 1 }).success,
      false
    )
  })
})
