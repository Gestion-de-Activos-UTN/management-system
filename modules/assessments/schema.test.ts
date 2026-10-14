import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AssessmentAnswerDraftSchema,
  BulkAssessmentCompleteSchema,
  BulkAssessmentSelectorSchema,
  UpdateAssessmentPolicySchema,
} from './schema'

describe('assessment command schemas', () => {
  it('requires a justification only for not applicable', () => {
    assert.equal(
      AssessmentAnswerDraftSchema.safeParse({
        question_key: 'q',
        question_version: 1,
        option_key: 'unknown',
      }).success,
      true
    )
    assert.equal(
      AssessmentAnswerDraftSchema.safeParse({
        question_key: 'q',
        question_version: 1,
        option_key: 'not_applicable',
      }).success,
      false
    )
    assert.equal(
      AssessmentAnswerDraftSchema.safeParse({
        question_key: 'q',
        question_version: 1,
        option_key: 'not_applicable',
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

  it('requires the identifier belonging to the selected bulk scope', () => {
    assert.equal(
      BulkAssessmentSelectorSchema.safeParse({
        mode: 'owner',
        risk_asset_type: 'workstation',
        owner_id: 'user-1',
      }).success,
      true
    )
    assert.equal(
      BulkAssessmentSelectorSchema.safeParse({
        mode: 'office',
        risk_asset_type: 'workstation',
      }).success,
      false
    )
    assert.equal(
      BulkAssessmentSelectorSchema.safeParse({
        mode: 'selected',
        risk_asset_type: 'workstation',
        assessment_ids: ['assessment-1'],
      }).success,
      false
    )
  })

  it('limits a bulk completion to one hundred open assessments', () => {
    const base = {
      selector: { mode: 'organization', risk_asset_type: 'workstation' },
      question_set_signature: 'q@2',
      answers: [],
    }
    assert.equal(
      BulkAssessmentCompleteSchema.safeParse({
        ...base,
        assessment_ids: Array.from({ length: 100 }, (_, index) => `assessment-${index}`),
      }).success,
      true
    )
    assert.equal(
      BulkAssessmentCompleteSchema.safeParse({
        ...base,
        assessment_ids: Array.from({ length: 101 }, (_, index) => `assessment-${index}`),
      }).success,
      false
    )
  })
})
