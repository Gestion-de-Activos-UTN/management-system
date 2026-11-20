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
    policy_version: 2,
    status: 'pending',
    question_set_snapshot: [
      { key: 'A.5.15.individual_accounts', version: 2 },
      { key: 'A.5.15.access_revocation', version: 2 },
    ],
  }
  const answers: Array<Record<string, unknown>> = []
  const results: Array<Record<string, unknown>> = []
  let committed = 0
  let rolledBack = 0
  const payload = {
    db: {
      sessions: { 'tx-1': { db: { execute: async () => undefined } } },
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
    async find({
      collection,
      where,
    }: {
      collection: string
      where?: { and?: Array<Record<string, { equals?: string }>> }
    }) {
      if (collection === 'assessment-answers') {
        const key = where?.and?.find(clause => 'question_key' in clause)?.question_key?.equals
        return {
          docs: answers
            .filter(item => !key || item.question_key === key)
            .map(item => ({ ...item })),
        }
      }
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
    { question_key: 'A.5.15.individual_accounts', question_version: 2, option_key: 'yes' as const },
    { question_key: 'A.5.15.access_revocation', question_version: 2, option_key: 'yes' as const },
  ],
}

describe('assessment lifecycle', () => {
  it('copies compatible answers into a new cycle using the target question version', () => {
    const copied = buildCopiedAssessmentDraft(
      [
        {
          question_key: 'A.5.15.individual_accounts',
          question_version: 2,
          option_key: 'yes',
          justification: null,
          evidence_note: 'Checked accounts',
        } as AssessmentAnswer,
        {
          question_key: 'removed.question',
          question_version: 2,
          option_key: 'no',
        } as AssessmentAnswer,
      ],
      [{ key: 'A.5.15.individual_accounts', version: 2 }]
    )
    assert.deepEqual(copied.answers, [
      {
        question_key: 'A.5.15.individual_accounts',
        question_version: 2,
        option_key: 'yes',
        justification: undefined,
        evidence_note: 'Checked accounts',
      },
    ])
  })

  it('upserts a draft idempotently instead of duplicating answers', async () => {
    const setup = makeLifecyclePayload()
    const req = { context: {}, payload: setup.payload } as PayloadRequest
    await saveAssessmentDraft(setup.payload, 'assessment-1', command, 'user-1', req)
    await saveAssessmentDraft(setup.payload, 'assessment-1', command, 'user-1', req)
    assert.equal(setup.answers.length, 2)
  })

  it('completes atomically and a retry creates no duplicate result', async () => {
    const setup = makeLifecyclePayload()
    await completeAssessment(setup.payload, 'assessment-1', command, 'user-1', {
      payload: setup.payload,
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
      payload: setup.payload,
      context: {},
    } as PayloadRequest)
    assert.equal(setup.results.length, 1)
    assert.equal(setup.state().committed, 2)
  })

  const completeWith = async (options: [string, string]) => {
    const setup = makeLifecyclePayload()
    await completeAssessment(
      setup.payload,
      'assessment-1',
      {
        answers: command.answers.map((answer, index) => ({
          ...answer,
          option_key: options[index],
          ...(options[index] === 'not_applicable'
            ? { justification: 'No hay sistemas compartidos.' }
            : {}),
        })),
      },
      'user-1',
      { payload: setup.payload, context: {} } as PayloadRequest
    )
    return { assessment: setup.state().assessment, result: setup.results[0] }
  }

  it('persists a partial control as partially_effective, not non_compliant', async () => {
    const { assessment, result } = await completeWith(['yes', 'no'])
    assert.equal(result.status, 'partially_effective')
    assert.equal(
      (result.evidence_snapshot as { evaluation_effect: { combined_efficacy: number } })
        .evaluation_effect.combined_efficacy,
      0.5
    )
    assert.equal(
      (assessment.completion_summary as Record<string, number>).partially_effective,
      1
    )
  })

  it('persists a fully not-applicable control as not_applicable, not not_evaluable', async () => {
    const { assessment, result } = await completeWith(['not_applicable', 'not_applicable'])
    assert.equal(result.status, 'not_applicable')
    assert.equal(result.reason_code, 'not_applicable')
    const summary = assessment.completion_summary as Record<string, number>
    assert.equal(summary.not_applicable, 1)
    assert.equal(summary.not_evaluable, 0)
  })

  it('keeps unknown answers as not_evaluable', async () => {
    const { result } = await completeWith(['yes', 'unknown'])
    assert.equal(result.status, 'not_evaluable')
  })

  it('dates the result at closing and keeps answered_at per sub-question', async () => {
    const { assessment, result } = await completeWith(['yes', 'no'])
    assert.equal(typeof assessment.completed_at, 'string')
    assert.equal(result.evaluated_at, assessment.completed_at)
    const subs = (
      result.evidence_snapshot as {
        evaluation_effect: { sub_efficacies: Array<{ question_key: string; answered_at: string }> }
      }
    ).evaluation_effect.sub_efficacies
    assert.deepEqual(
      subs.map(sub => sub.question_key),
      ['A.5.15.individual_accounts', 'A.5.15.access_revocation']
    )
    for (const sub of subs) assert.equal(typeof sub.answered_at, 'string')
  })

  it('explains each persisted state differently', async () => {
    const explanations = await Promise.all(
      (
        [
          ['yes', 'yes'],
          ['yes', 'no'],
          ['no', 'no'],
          ['yes', 'unknown'],
          ['not_applicable', 'not_applicable'],
        ] as Array<[string, string]>
      ).map(async options => (await completeWith(options)).result.explanation)
    )
    assert.equal(new Set(explanations).size, 5)
  })

  it('rolls back and never marks complete when a required answer is missing', async () => {
    const setup = makeLifecyclePayload()
    await assert.rejects(
      completeAssessment(setup.payload, 'assessment-1', { answers: [] }, 'user-1', {
        payload: setup.payload,
        context: {},
      } as PayloadRequest),
      /Responde todas las preguntas visibles/
    )
    assert.notEqual(setup.state().assessment.status, 'completed')
    assert.equal(setup.results.length, 0)
    assert.equal(setup.state().rolledBack, 1)
  })
})
