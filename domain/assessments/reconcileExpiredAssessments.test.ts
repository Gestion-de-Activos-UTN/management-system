import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Payload } from 'payload'
import type { AssessmentInstance } from '@/app/types/payload-types'
import { reconcileExpiredAssessments } from './reconcileExpiredAssessments'

describe('expired assessment reconciliation job', () => {
  it('creates one new cycle and preserves it on retry', async () => {
    const openCycles: Array<Record<string, unknown>> = []
    const expired = {
      id: 'expired-1',
      organization: 'org-1',
      scope: 'organization',
      status: 'completed',
      due_at: '2026-01-01T00:00:00.000Z',
    } as AssessmentInstance
    const payload = {
      async find(args: { collection: string; where?: Record<string, unknown> }) {
        if (args.collection === 'assessment-instances') {
          const clauses = (args.where?.and ?? []) as Array<Record<string, unknown>>
          const isExpiredQuery = clauses.some(clause => 'due_at' in clause)
          return isExpiredQuery
            ? { docs: [expired], totalPages: 1 }
            : { docs: openCycles, totalPages: 1 }
        }
        if (args.collection === 'organization-settings') {
          return {
            docs: [{ assessment_policy_key: 'essential', assessment_policy_version: 1 }],
            totalPages: 1,
          }
        }
        if (args.collection === 'subscriptions') {
          return { docs: [{ features: { security_assessments: true } }], totalPages: 1 }
        }
        return { docs: [], totalPages: 1 }
      },
      async findByID() {
        return { id: 'org-1', is_active: true }
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const created = { id: 'new-1', ...data }
        openCycles.push(created)
        return created
      },
      async update() {
        throw new Error('No cycle should be superseded during an idempotent retry')
      },
    } as unknown as Payload

    const first = await reconcileExpiredAssessments(payload, new Date('2026-01-02T00:00:00Z'))
    const retry = await reconcileExpiredAssessments(payload, new Date('2026-01-02T00:00:00Z'))

    assert.equal(first.cycles_created, 1)
    assert.equal(retry.cycles_created, 0)
    assert.equal(retry.cycles_preserved, 1)
    assert.equal(openCycles.length, 1)
    assert.equal(openCycles[0].created_reason, 'answer_expired')
  })
})
