import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AssessmentInstance } from '@/app/types/payload-types'
import { deriveAssessmentStatus } from './assessmentExpiration'

const assessment = (status: AssessmentInstance['status'], due_at: string) =>
  ({ status, due_at }) as AssessmentInstance

describe('assessment expiration', () => {
  it('derives an expired completed cycle without rewriting history', () => {
    assert.equal(
      deriveAssessmentStatus(
        assessment('completed', '2026-01-01T00:00:00.000Z'),
        new Date('2026-01-02T00:00:00.000Z')
      ),
      'expired'
    )
  })

  it('does not expire open, superseded, or still-current cycles', () => {
    const now = new Date('2026-01-02T00:00:00.000Z')
    assert.equal(
      deriveAssessmentStatus(assessment('pending', '2026-01-01T00:00:00.000Z'), now),
      'pending'
    )
    assert.equal(
      deriveAssessmentStatus(assessment('superseded', '2026-01-01T00:00:00.000Z'), now),
      'superseded'
    )
    assert.equal(
      deriveAssessmentStatus(assessment('completed', '2026-02-01T00:00:00.000Z'), now),
      'completed'
    )
  })
})
