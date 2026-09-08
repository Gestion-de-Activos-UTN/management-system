import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assessmentFieldKey, buildAssessmentDraft } from './assessment-form-state'

describe('assessment form state', () => {
  it('serializes answers whose catalog keys contain dots', () => {
    const questions = [{ key: 'access.individual_accounts', version: 1 }]
    const fieldKey = assessmentFieldKey(questions, questions[0].key)

    assert.equal(fieldKey, '0')
    assert.deepEqual(buildAssessmentDraft(questions, questions, { 0: { answer: 'yes' } }), {
      answers: [
        {
          question_key: 'access.individual_accounts',
          question_version: 1,
          answer: 'yes',
          justification: undefined,
          evidence_note: undefined,
        },
      ],
    })
  })
})
