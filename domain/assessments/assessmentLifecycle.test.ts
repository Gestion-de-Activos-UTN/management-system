import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Payload, PayloadRequest } from 'payload'
import type { AssessmentAnswer } from '@/app/types/payload-types'
import {
  buildCopiedAssessmentDraft,
  completeAssessment,
  saveAssessmentDraft,
} from './assessmentLifecycle'

function makeLifecyclePayload() {
  let assessment: Record<string, unknown> = {
    id: 'assessment-1',
    organization: 'org-1',
    scope: 'organization',
    policy_key: 'essential',
    policy_version: 1,
    status: 'pending',
    question_set_snapshot: [{ key: 'access.individual_accounts', version: 1 }],
  }
  const answers: Array<Record<string, unknown>> = []
  const results: Array<Record<string, unknown>> = []
  let committed = 0
  let rolledBack = 0
  const payload = {
    db: {
      beginTransaction: async () => 'tx-1',
      commitTransaction: async () => {
        committed += 1
      },
      rollbackTransaction: async () => {
        rolledBack += 1
      },
    },
    async findByID({ collection }: { collection: string }) {
      if (collection === 'assessment-instances') return { ...assessment }
      throw new Error('not found')
    },
    async find({ collection }: { collection: string }) {
      if (collection === 'assessment-answers') return { docs: answers.map(item => ({ ...item })) }
      return { docs: [] }
    },
    async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
      if (collection === 'assessment-answers') {
        const row = { id: `answer-${answers.length + 1}`, ...data }
        answers.push(row)
        return { ...row }
      }
      if (collection === 'compliance-results') {
        const row = { id: `result-${results.length + 1}`, ...data }
        results.push(row)
        return { ...row }
      }
      throw new Error(`unexpected create ${collection}`)
    },
    async update({
      collection,
      id,
      data,
    }: {
      collection: string
      id: string
      data: Record<string, unknown>
    }) {
      if (collection === 'assessment-instances') {
        assessment = { ...assessment, ...data }
        return { ...assessment }
      }
      const index = answers.findIndex(answer => answer.id === id)
      answers[index] = { ...answers[index], ...data }
      return { ...answers[index] }
    },
  } as unknown as Payload
  return { payload, answers, results, state: () => ({ assessment, committed, rolledBack }) }
}

const command = {
  answers: [
    { question_key: 'access.individual_accounts', question_version: 1, answer: 'yes' as const },
  ],
}

describe('assessment lifecycle', () => {
  it('copies compatible answers into a new cycle using the target question version', () => {
    const copied = buildCopiedAssessmentDraft(
      [
        {
          question_key: 'access.individual_accounts',
          question_version: 1,
          answer: 'yes',
          justification: null,
          evidence_note: 'Checked accounts',
        } as AssessmentAnswer,
        { question_key: 'removed.question', question_version: 1, answer: 'no' } as AssessmentAnswer,
      ],
      [{ key: 'access.individual_accounts', version: 2 }]
    )
    assert.deepEqual(copied.answers, [
      {
        question_key: 'access.individual_accounts',
        question_version: 2,
        answer: 'yes',
        justification: undefined,
        evidence_note: 'Checked accounts',
      },
    ])
  })

  it('upserts a draft idempotently instead of duplicating answers', async () => {
    const setup = makeLifecyclePayload()
    const req = { context: {} } as PayloadRequest
    await saveAssessmentDraft(setup.payload, 'assessment-1', command, 'user-1', req)
    await saveAssessmentDraft(setup.payload, 'assessment-1', command, 'user-1', req)
    assert.equal(setup.answers.length, 1)
  })

  it('completes atomically and a retry creates no duplicate result', async () => {
    const setup = makeLifecyclePayload()
    await completeAssessment(setup.payload, 'assessment-1', command, 'user-1', {
      context: {},
    } as PayloadRequest)
    assert.equal(setup.state().assessment.status, 'completed')
    assert.equal(setup.results.length, 1)
    assert.equal(setup.state().committed, 1)
    assert.equal(
      setup.answers[0].evaluation_effect_snapshot &&
        (setup.answers[0].evaluation_effect_snapshot as { status: string }).status,
      'compliant'
    )

    await completeAssessment(setup.payload, 'assessment-1', command, 'user-1', {
      context: {},
    } as PayloadRequest)
    assert.equal(setup.results.length, 1)
    assert.equal(setup.state().committed, 2)
  })

  it('rolls back and never marks complete when a required answer is missing', async () => {
    const setup = makeLifecyclePayload()
    await assert.rejects(
      completeAssessment(setup.payload, 'assessment-1', { answers: [] }, 'user-1', {
        context: {},
      } as PayloadRequest),
      /Every visible question/
    )
    assert.notEqual(setup.state().assessment.status, 'completed')
    assert.equal(setup.results.length, 0)
    assert.equal(setup.state().rolledBack, 1)
  })
})
