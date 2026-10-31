import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { resolveInheritedAssessmentEvidence } from '@/domain/assessments/resolveInheritedEvidence'
import { reconcileExpiredAssessments } from '@/domain/assessments/reconcileExpiredAssessments'
import { withDerivedAssessmentStatus } from '@/domain/assessments/assessmentExpiration'
import { relationId } from '@/lib/relationId'
import { calculateRiskForScope } from '@/domain/risk/recalculateRisk'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import type { AssessmentInstance } from '@/app/types/payload-types'

let f: ScopeFixture
const instant = new Date('2030-06-15T12:00:00.000Z')
const future = new Date(instant.getTime() + 86400000).toISOString()
beforeAll(async () => {
  f = await scopeFixture('validity')
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
const versions = () => f.versions(['risk-contributions'])
async function target() {
  const asset = await f.createManual()
  const cycle = (
    await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      depth: 0,
      where: { manual_asset: { equals: asset.id } },
      limit: 1,
    })
  ).docs[0]
  const key = `fixture.shared.${randomUUID()}`
  const assessment = await f.payload.update({
    collection: 'assessment-instances',
    id: cycle.id,
    overrideAccess: true,
    data: {
      question_set_snapshot: [
        { key, version: 1, prompt_snapshot: 'Pregunta compartida de fixture' },
      ],
    },
  })
  return { asset, assessment, key }
}
async function parent(
  key: string,
  scope: 'organization' | 'office',
  office = f.own.office,
  org = f.own.org
) {
  return f.payload.create({
    collection: 'assessment-instances',
    overrideAccess: true,
    data: {
      organization: org,
      scope,
      ...(scope === 'office' ? { office } : {}),
      policy_key: 'essential',
      policy_version: 2,
      catalog_version: 2,
      question_set_snapshot: [{ key, version: 1 }],
      status: 'pending',
      created_reason: 'initial',
      opened_at: '2030-01-01T00:00:00Z',
      due_at: future,
      completion_summary: {
        compliant: 0,
        partially_effective: 0,
        non_compliant: 0,
        not_evaluable: 0,
      },
    },
  })
}
async function answer(
  assessment: AssessmentInstance,
  key: string,
  option = 'current',
  validUntil = future,
  at = new Date(instant.getTime() - 1000).toISOString()
) {
  return f.payload.create({
    collection: 'assessment-answers',
    overrideAccess: true,
    data: {
      organization: relationId(assessment.organization),
      assessment: assessment.id,
      question_key: key,
      question_version: 1,
      option_key: option,
      option_snapshot: { key: option },
      answered_by: { relationTo: 'users', value: f.own.admin },
      answered_at: at,
      valid_until: validUntil,
      evaluation_effect_snapshot: {},
      ...(option === 'not_applicable' ? { justification: 'Excepción de prueba justificada.' } : {}),
    },
  })
}
async function close(assessment: AssessmentInstance, due = future) {
  return f.payload.update({
    collection: 'assessment-instances',
    id: assessment.id,
    overrideAccess: true,
    data: {
      status: 'completed',
      completed_at: '2030-01-01T00:00:00Z',
      completed_by: { relationTo: 'users', value: f.own.admin },
      due_at: due,
    },
  })
}
for (const offset of [-1, 0, 1])
  it(`persisted evidence at expiry ${offset}ms uses the strict current-evidence boundary without rewriting history`, async () => {
    const item = await target()
    const until = new Date(instant.getTime() + offset).toISOString()
    const row = await answer(item.assessment, item.key, 'current', until)
    const before = await versions()
    const result = await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
      now: instant,
    })
    if (offset > 0)
      expect(result[item.key]).toMatchObject({
        state: 'current',
        candidate: { id: row.id, source: 'exact' },
      })
    else expect(result[item.key]).toEqual({ state: 'not_evaluable', reason_code: 'answer_expired' })
    expect(await versions()).toEqual(before)
  })
for (const mode of ['exact', 'fallback', 'exception', 'older-inherited'] as const)
  it(`${mode}: precedence is resolved from real persisted candidates at an explicit date`, async () => {
    const item = await target()
    const org = await parent(item.key, 'organization')
    const orgAnswer = await answer(
      org,
      item.key,
      'organization',
      future,
      new Date(instant.getTime() - 3000).toISOString()
    )
    await close(org)
    const office = await parent(item.key, 'office')
    const officeAnswer = await answer(
      office,
      item.key,
      'office',
      mode === 'older-inherited' ? instant.toISOString() : future,
      new Date(instant.getTime() - 2000).toISOString()
    )
    await close(office)
    const local = await answer(
      item.assessment,
      item.key,
      mode === 'exception' ? 'not_applicable' : 'exact',
      mode === 'fallback' || mode === 'older-inherited' ? instant.toISOString() : future
    )
    const before = await versions()
    const result = await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
      now: instant,
    })
    const expected =
      mode === 'exact' ? local.id : mode === 'older-inherited' ? orgAnswer.id : officeAnswer.id
    expect(result[item.key]).toMatchObject({
      state: 'current',
      candidate: { id: expected, source: mode === 'exact' ? 'exact' : 'inherited' },
    })
    expect(await versions()).toEqual(before)
  })
it('when all persisted candidates are expired, missing coverage is not fabricated as non-compliance', async () => {
  const item = await target(),
    org = await parent(item.key, 'organization')
  await answer(org, item.key, 'organization', instant.toISOString())
  await close(org)
  await answer(item.assessment, item.key, 'exact', new Date(instant.getTime() - 1).toISOString())
  const result = await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
    now: instant,
  })
  expect(result[item.key]).toEqual({ state: 'not_evaluable', reason_code: 'answer_expired' })
})
it('an applicable exception is used only when no current exact or inherited candidate exists', async () => {
  const item = await target(),
    row = await answer(item.assessment, item.key, 'not_applicable')
  const result = await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
    now: instant,
  })
  expect(result[item.key]).toMatchObject({
    state: 'current',
    candidate: { id: row.id, source: 'exception' },
  })
})
it('unanswered reviews expose no fabricated effective candidate', async () => {
  const item = await target(),
    before = await versions()
  expect(
    (
      await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
        now: instant,
      })
    )[item.key]
  ).toBeUndefined()
  expect(await versions()).toEqual(before)
})
it('evidence from another office or organization cannot become inherited evidence', async () => {
  const item = await target()
  const otherOffice = await parent(item.key, 'office', f.own.second)
  await answer(otherOffice, item.key)
  await close(otherOffice)
  const foreign = await parent(item.key, 'organization', f.foreign.office, f.foreign.org)
  await answer(foreign, item.key)
  await close(foreign)
  const before = await versions()
  expect(
    (
      await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
        now: instant,
      })
    )[item.key]
  ).toBeUndefined()
  expect(await versions()).toEqual(before)
})
it('the explicit office-scoped reader option excludes organization inheritance', async () => {
  const item = await target(),
    org = await parent(item.key, 'organization')
  const row = await answer(org, item.key)
  await close(org)
  const admin = await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
    now: instant,
  })
  const scoped = await resolveInheritedAssessmentEvidence(f.payload, item.assessment, undefined, {
    now: instant,
    includeOrganization: false,
  })
  expect(admin[item.key]).toMatchObject({ state: 'current', candidate: { id: row.id } })
  expect(scoped[item.key]).toBeUndefined()
})
it('detail endpoints apply organization inheritance only to the organization-wide reader', async () => {
  const item = await target(),
    org = await parent(item.key, 'organization')
  await answer(org, item.key)
  await close(org)
  const before = await versions()
  const admin = await f.api(`/v1/assessments/${item.assessment.id}`, f.own.adminCookie)
  expect(admin.status).toBe(200)
  expect(admin.data.effective_evidence[item.key]?.state).toBe('current')
  for (const cookie of [f.own.managerCookie, f.own.viewerCookie]) {
    const result = await f.api(`/v1/assessments/${item.assessment.id}`, cookie)
    expect(result.status).toBe(200)
    expect(result.data.effective_evidence[item.key]).toBeUndefined()
  }
  expect(await versions()).toEqual(before)
})
for (const [policy, days] of [
  ['essential', 365],
  ['reinforced', 180],
] as const)
  it(`${policy}: actual completion freezes answer and cycle validity at ${days} days`, async () => {
    const changed = await f.api('/v1/organization/assessment-policy', f.own.adminCookie, 'PATCH', {
      policy_key: policy,
      policy_version: 2,
    })
    expect(changed.status).toBe(200)
    const asset = await f.createManual()
    const cycle = (
      await f.payload.find({
        collection: 'assessment-instances',
        overrideAccess: true,
        depth: 0,
        where: {
          and: [
            { manual_asset: { equals: asset.id } },
            { status: { in: ['pending', 'in_progress'] } },
          ],
        },
        limit: 1,
      })
    ).docs[0]
    const answers = (cycle.question_set_snapshot as Array<{ key: string; version: number }>).map(
      q => {
        const question = RISK_QUESTIONS_V2.find(r => r.key === q.key)!,
          option = question.options.find(o => o.efficacy === 1) ?? question.options[0]
        return {
          question_key: q.key,
          question_version: q.version,
          option_key: option.key,
          ...(option.requires_justification ? { justification: 'Justificación de prueba.' } : {}),
        }
      }
    )
    expect(
      (await f.api(`/v1/assessments/${cycle.id}/complete`, f.own.adminCookie, 'POST', { answers }))
        .status
    ).toBe(200)
    const closed = await f.payload.findByID({
      collection: 'assessment-instances',
      id: cycle.id,
      overrideAccess: true,
      depth: 0,
    })
    const persisted = (
      await f.payload.find({
        collection: 'assessment-answers',
        overrideAccess: true,
        depth: 0,
        pagination: false,
        where: { assessment: { equals: cycle.id } },
      })
    ).docs
    expect(persisted).toHaveLength(answers.length)
    const expected = new Date(Date.parse(closed.completed_at!) + days * 86400000).toISOString()
    expect(closed.due_at).toBe(expected)
    expect(persisted.every(a => a.valid_until === expected)).toBe(true)
    const before = await versions()
    const control = RISK_QUESTIONS_V2.find(q => q.key === persisted[0].question_key)!.control_key
    const current = await calculateRiskForScope(f.payload, {
      organizationId: f.own.org,
      officeId: f.own.office,
      now: new Date(Date.parse(expected) - 1),
    })
    const expired = await calculateRiskForScope(f.payload, {
      organizationId: f.own.org,
      officeId: f.own.office,
      now: new Date(expected),
    })
    const currentPair = current.result.contributions.find(
      row => row.asset_id === `manual:${asset.id}` && row.control_key === control
    )
    const expiredPair = expired.result.contributions.find(
      row => row.asset_id === `manual:${asset.id}` && row.control_key === control
    )
    expect(currentPair).toBeTruthy()
    expect(typeof currentPair!.efficacy).toBe('number')
    expect(expiredPair).toBeTruthy()
    expect(expiredPair!.efficacy).toBeNull()
    expect(expiredPair!.status).toBe('not_evaluable')
    expect(withDerivedAssessmentStatus(closed, new Date(Date.parse(expected) - 1)).status).toBe(
      'completed'
    )
    expect(withDerivedAssessmentStatus(closed, new Date(expected)).status).toBe('expired')
    expect(await versions()).toEqual(before)
  })
async function expiredFixture() {
  const asset = await f.createManual()
  const cycle = (
    await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      depth: 0,
      where: { manual_asset: { equals: asset.id } },
      limit: 1,
    })
  ).docs[0]
  const snapshot = cycle.question_set_snapshot as Array<{ key: string; version: number }>
  for (const q of snapshot) {
    const definition = RISK_QUESTIONS_V2.find(row => row.key === q.key)!
    const option = definition.options.find(row => row.efficacy === 1) ?? definition.options[0]
    await f.payload.create({
      collection: 'assessment-answers',
      overrideAccess: true,
      data: {
        organization: f.own.org,
        assessment: cycle.id,
        question_key: q.key,
        question_version: q.version,
        option_key: option.key,
        option_snapshot: option,
        ...(option.requires_justification ? { justification: 'Justificación histórica.' } : {}),
        answered_by: { relationTo: 'users', value: f.own.admin },
        answered_at: '2025-01-01T00:00:00Z',
        valid_until: '2026-01-01T00:00:00Z',
        evaluation_effect_snapshot: {},
      },
    })
  }
  const answers = (
    await f.payload.find({
      collection: 'assessment-answers',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { assessment: { equals: cycle.id } },
    })
  ).docs
  const closed = await f.payload.update({
    collection: 'assessment-instances',
    id: cycle.id,
    overrideAccess: true,
    data: {
      status: 'completed',
      completed_at: '2025-01-01T00:00:00Z',
      due_at: '2026-01-01T00:00:00Z',
      completed_by: { relationTo: 'users', value: f.own.admin },
    },
  })
  return { asset, closed, answers }
}
it('expiry reconciliation starts at the boundary, preserves the completed record and creates only one successor on retry', async () => {
  const item = await expiredFixture()
  const before = await versions()
  expect(
    (await reconcileExpiredAssessments(f.payload, new Date('2025-12-31T23:59:59.999Z')))
      .expired_cycles_examined
  ).toBe(0)
  expect(await versions()).toEqual(before)
  const result = await reconcileExpiredAssessments(f.payload, new Date('2026-01-01T00:00:00Z'))
  expect(result.expired_cycles_examined).toBe(1)
  expect(result.cycles_created).toBe(1)
  const old = await f.payload.findByID({
    collection: 'assessment-instances',
    id: item.closed.id,
    overrideAccess: true,
    depth: 0,
  })
  expect(old.status).toBe('completed')
  expect(
    (
      await f.payload.find({
        collection: 'assessment-answers',
        overrideAccess: true,
        depth: 0,
        pagination: false,
        where: { assessment: { equals: old.id } },
      })
    ).docs
  ).toEqual(item.answers)
  expect(old.completed_at).toBe(item.closed.completed_at)
  expect(old.due_at).toBe(item.closed.due_at)
  expect(old.expiry_reconciled_at).toBeTruthy()
  const cycles = (
    await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { manual_asset: { equals: item.asset.id } },
    })
  ).docs
  expect(cycles.filter(c => c.status === 'pending')).toHaveLength(1)
  expect(cycles.find(c => c.status === 'pending')?.created_reason).toBe('answer_expired')
  const stable = await versions()
  expect(
    (await reconcileExpiredAssessments(f.payload, new Date('2026-01-01T00:00:00Z')))
      .expired_cycles_examined
  ).toBe(0)
  expect(await versions()).toEqual(stable)
})
it('a failed expiry marker can be retried without creating a second successor cycle', async () => {
  const item = await expiredFixture(),
    original = f.payload.update.bind(f.payload)
  const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (
      args.collection === 'assessment-instances' &&
      args.id === item.closed.id &&
      (args.data as { expiry_reconciled_at?: string }).expiry_reconciled_at
    )
      throw new Error('Controlled expiry marker failure')
    return (await original(args as never)) as never
  })
  try {
    await expect(
      reconcileExpiredAssessments(f.payload, new Date('2026-01-02T00:00:00Z'))
    ).rejects.toThrow('Controlled expiry marker failure')
  } finally {
    spy.mockRestore()
  }
  const current = () =>
    f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: {
        and: [{ manual_asset: { equals: item.asset.id } }, { status: { equals: 'pending' } }],
      },
    })
  const first = await current()
  expect(first.docs).toHaveLength(1)
  const retry = await reconcileExpiredAssessments(f.payload, new Date('2026-01-02T00:00:00Z'))
  expect(retry.cycles_created).toBe(0)
  expect(retry.cycles_preserved).toBe(1)
  expect(
    (
      await f.payload.find({
        collection: 'assessment-answers',
        overrideAccess: true,
        depth: 0,
        pagination: false,
        where: { assessment: { equals: item.closed.id } },
      })
    ).docs
  ).toEqual(item.answers)
  expect((await current()).docs.map(c => c.id)).toEqual(first.docs.map(c => c.id))
})
