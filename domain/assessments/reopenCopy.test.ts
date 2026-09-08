import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Payload, PayloadRequest } from 'payload'
import type { AssessmentAnswer } from '@/app/types/payload-types'
import { POLICY_CATALOG, QUESTION_CATALOG } from './catalog'
import { resolveApplicableQuestions } from './resolveApplicableQuestions'
import { buildCopiedAssessmentDraft, saveAssessmentDraft } from './assessmentLifecycle'

// Reproduces the "Start new review cycle" flow (endpoints/assessments.ts
// assessmentReopenEndpoint): a completed org-scope assessment's answers must carry
// over into the freshly-opened next cycle, end to end through buildCopiedAssessmentDraft
// + saveAssessmentDraft, not just the pure buildCopiedAssessmentDraft unit in isolation.
describe('reopen copies every answer into the new cycle', () => {
  it('persists a full 1:1 copy when the subject is unchanged between cycles', async () => {
    const policy = POLICY_CATALOG.find(p => p.key === 'essential' && p.version === 1)!
    const applicable = resolveApplicableQuestions(
      { scope: 'organization', is_active: true },
      policy,
      { include_unresolved_answer_dependencies: true },
      QUESTION_CATALOG
    )
    assert.ok(applicable.length > 0, 'expected at least one org-scope question in the catalog')

    const sourceAnswers: AssessmentAnswer[] = applicable.map(
      question =>
        ({
          id: `answer-${question.key}`,
          question_key: question.key,
          question_version: question.version,
          answer: 'yes',
          justification: null,
          evidence_note: question.evidence_note_required_for?.includes('yes')
            ? 'Checked during the prior cycle'
            : null,
        }) as AssessmentAnswer
    )

    const targetSnapshot = applicable.map(question => ({
      key: question.key,
      version: question.version,
    }))

    const copiedDraft = buildCopiedAssessmentDraft(sourceAnswers, targetSnapshot)
    assert.equal(
      copiedDraft.answers.length,
      sourceAnswers.length,
      'every source answer should map to a question in the new cycle\'s snapshot'
    )

    const created: Array<Record<string, unknown>> = []
    const targetAssessment = {
      id: 'assessment-new',
      organization: 'org-1',
      status: 'pending',
      policy_key: policy.key,
      question_set_snapshot: targetSnapshot,
    }
    const payload = {
      async findByID() {
        return { ...targetAssessment }
      },
      async find({ collection }: { collection: string }) {
        if (collection === 'assessment-answers') return { docs: [] }
        return { docs: [] }
      },
      async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
        if (collection === 'assessment-instances') return { id: 'assessment-new', ...data }
        const row = { id: `answer-new-${created.length + 1}`, ...data }
        created.push(row)
        return row
      },
      async update({ data }: { data: Record<string, unknown> }) {
        return data
      },
    } as unknown as Payload

    await saveAssessmentDraft(
      payload,
      'assessment-new',
      copiedDraft,
      'user-1',
      { context: {} } as PayloadRequest
    )

    assert.equal(
      created.length,
      sourceAnswers.length,
      'every answer copied by buildCopiedAssessmentDraft should actually persist'
    )
    const persistedKeys = new Set(created.map(row => row.question_key))
    for (const answer of sourceAnswers) {
      assert.ok(persistedKeys.has(answer.question_key), `missing carried-over answer for ${answer.question_key}`)
    }
  })
})
