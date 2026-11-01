import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import type { BulkAssessmentComplete, BulkAssessmentSelector } from '@/modules/assessments/schema'
import type { BulkAssessmentPreview } from '@/domain/assessments/bulkAssessmentLifecycle'
let f: ScopeFixture
beforeAll(async () => {
  f = await scopeFixture('batches')
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
const selector = (): BulkAssessmentSelector => ({
  mode: 'organization',
  risk_asset_type: 'workstation',
})
const preview = (selection = selector(), cookie = f.own.adminCookie) =>
  f.api('/v1/assessments/bulk/preview', cookie, 'POST', { selector: selection })
const complete = (body: unknown, cookie = f.own.adminCookie) =>
  f.api('/v1/assessments/bulk/complete', cookie, 'POST', body)
const versions = () => f.versions(['risk-contributions'])
function command(
  data: BulkAssessmentPreview,
  ids: string[],
  selection = selector()
): BulkAssessmentComplete {
  return {
    selector: selection,
    assessment_ids: ids,
    question_set_signature: data.question_set_signature!,
    answers: (data.question_set_snapshot as Array<{ key: string; version: number }>).map(q => {
      const definition = RISK_QUESTIONS_V2.find(item => item.key === q.key)!
      const option = definition.options.find(item => item.efficacy === 1) ?? definition.options[0]
      return {
        question_key: q.key,
        question_version: q.version,
        option_key: option.key,
        ...(option.requires_justification ? { justification: 'Justificación de prueba.' } : {}),
      }
    }),
  }
}
async function scenario(multiOffice = false) {
  const assets = [
    await f.createManual(),
    await f.createManual(f.own, multiOffice ? { office: f.own.second, owner: f.own.outside } : {}),
  ]
  const view = await preview()
  expect(view.status).toBe(200)
  const ids = assets.map(
    a =>
      view.data.applicable.find((r: { asset_id: string }) => r.asset_id === a.id)
        .assessment_id as string
  )
  return { assets, ids, body: command(view.data, ids), view: view.data as BulkAssessmentPreview }
}
async function rows(ids: string[]) {
  return (
    await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { id: { in: ids } },
    })
  ).docs
}
it('preview performs no writes and reports a persisted draft without treating it as completed', async () => {
  const item = await scenario()
  const draft = await f.api(`/v1/assessments/${item.ids[0]}/draft`, f.own.adminCookie, 'PATCH', {
    answers: [item.body.answers[0]],
  })
  expect(draft.status).toBe(200)
  const before = await versions()
  const result = await preview()
  expect(result.status).toBe(200)
  expect(
    result.data.applicable.find((r: { assessment_id: string }) => r.assessment_id === item.ids[0])
      .has_draft
  ).toBe(true)
  expect(
    result.data.applicable.find((r: { assessment_id: string }) => r.assessment_id === item.ids[1])
      .has_draft
  ).toBe(false)
  expect(await versions()).toEqual(before)
})
for (const mutation of [
  'retired',
  'deleted',
  'moved',
  'category',
  'excluded',
  'superseded',
] as const)
  it(`a ${mutation} target after preview rejects the entire selected batch without writing`, async () => {
    const item = await scenario(),
      id = item.assets[1].id
    let result
    if (mutation === 'superseded')
      result = await f.payload.update({
        collection: 'assessment-instances',
        id: item.ids[1],
        overrideAccess: true,
        data: { status: 'superseded' },
      })
    else if (mutation === 'deleted')
      result = await f.api(`/non-network-assets/${id}`, f.own.adminCookie, 'DELETE')
    else
      result = await f.api(
        `/non-network-assets/${id}`,
        f.own.adminCookie,
        'PATCH',
        mutation === 'retired'
          ? { status: 'retired' }
          : mutation === 'moved'
            ? { office: f.own.second, owner: f.own.outside }
            : mutation === 'category'
              ? { asset_category: 'printer' }
              : {
                  assessment_scope: 'excluded',
                  assessment_exclusion_reason: 'temporary_or_lab',
                  assessment_excluded_until: new Date(Date.now() + 86400000).toISOString(),
                }
      )
    if ('status' in result && typeof result.status === 'number') expect(result.status).toBe(200)
    const before = await versions()
    const stale = await complete(item.body)
    expect(stale.status).toBe(409)
    expect(stale.data.error).toBe('bulk_selection_stale')
    expect(await versions()).toEqual(before)
    expect((await rows([item.ids[0]]))[0].status).toBe('pending')
  })
it('a changed frozen question set rejects the old signature without touching another selected review', async () => {
  const item = await scenario()
  const snapshot = structuredClone(item.view.question_set_snapshot) as Array<{
    key: string
    version: number
  }>
  snapshot[0].version += 1
  await f.payload.update({
    collection: 'assessment-instances',
    id: item.ids[1],
    overrideAccess: true,
    data: { question_set_snapshot: snapshot },
  })
  const before = await versions(),
    result = await complete(item.body)
  expect(result.status).toBe(409)
  expect(['bulk_selection_stale', 'bulk_preview_stale']).toContain(result.data.error)
  expect(await versions()).toEqual(before)
})
it('an explicitly wrong signature is rejected before writes', async () => {
  const item = await scenario(),
    before = await versions()
  const result = await complete({ ...item.body, question_set_signature: 'outdated@999' })
  expect(result.status).toBe(409)
  expect(result.data.error).toBe('bulk_preview_stale')
  expect(await versions()).toEqual(before)
})
for (const kind of [
  'empty',
  'duplicates',
  'too-many',
  'no-signature',
  'bad-question',
  'bad-option',
  'missing-answers',
] as const)
  it(`${kind} command cannot partially complete the batch`, async () => {
    const item = await scenario(),
      body = structuredClone(item.body)
    if (kind === 'empty') body.assessment_ids = []
    if (kind === 'duplicates') body.assessment_ids = [item.ids[0], item.ids[0]]
    if (kind === 'too-many') body.assessment_ids = Array.from({ length: 101 }, () => randomUUID())
    if (kind === 'no-signature') body.question_set_signature = ''
    if (kind === 'bad-question') body.answers[0].question_key = 'unknown.question'
    if (kind === 'bad-option') body.answers[0].option_key = 'unknown_option'
    if (kind === 'missing-answers') body.answers = []
    const before = await versions(),
      result = await complete(body)
    expect(result.status).toBe(400)
    expect(await versions()).toEqual(before)
  })
it('a new matching asset does not silently enter the user-selected batch', async () => {
  const item = await scenario(),
    extra = await f.createManual()
  const result = await complete(item.body)
  expect(result.status, String(result.data.message ?? '')).toBe(200)
  expect(result.data.completed).toBe(2)
  const extraCycle = (
    await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      where: { manual_asset: { equals: extra.id } },
      depth: 0,
      limit: 1,
    })
  ).docs[0]
  expect(extraCycle.status).toBe('pending')
})
it('a review completed after preview is preserved and only the remaining selected review is answered', async () => {
  const item = await scenario()
  expect(
    (
      await f.api(`/v1/assessments/${item.ids[0]}/complete`, f.own.adminCookie, 'POST', {
        answers: item.body.answers,
      })
    ).status
  ).toBe(200)
  const completed = (await rows([item.ids[0]]))[0]
  const answers = (
    await f.payload.find({
      collection: 'assessment-answers',
      overrideAccess: true,
      where: { assessment: { equals: item.ids[0] } },
      depth: 0,
      pagination: false,
    })
  ).docs
  const result = await complete(item.body)
  expect(result.status).toBe(200)
  expect(result.data).toMatchObject({ completed: 1, preserved_completed: 1 })
  expect((await rows([item.ids[0]]))[0]).toEqual(completed)
  expect(
    (
      await f.payload.find({
        collection: 'assessment-answers',
        overrideAccess: true,
        where: { assessment: { equals: item.ids[0] } },
        depth: 0,
        pagination: false,
      })
    ).docs
  ).toEqual(answers)
})
for (const checkpoint of ['answer', 'result', 'completed-review'] as const)
  it(`failure AFTER ${checkpoint} persistence on the second target rolls back both reviews and allows retry`, async () => {
    const item = await scenario(),
      before = await versions()
    const create = f.payload.create.bind(f.payload),
      update = f.payload.update.bind(f.payload)
    let written = false
    const spyCreate = vi.spyOn(f.payload, 'create').mockImplementation(async args => {
      const doc = await create(args as never)
      const data = args.data as { assessment?: string; manual_asset?: string }
      if (
        (checkpoint === 'answer' &&
          args.collection === 'assessment-answers' &&
          data.assessment === item.ids[1]) ||
        (checkpoint === 'result' &&
          args.collection === 'compliance-results' &&
          data.manual_asset === item.assets[1].id)
      ) {
        written = true
        expect(args.req?.transactionID).toBeTruthy()
        throw new Error('Controlled second-target write failure')
      }
      return doc
    })
    const spyUpdate = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
      const doc = (await update(args as never)) as never
      if (
        checkpoint === 'completed-review' &&
        args.collection === 'assessment-instances' &&
        args.id === item.ids[1] &&
        (args.data as { status?: string }).status === 'completed'
      ) {
        written = true
        expect(args.req?.transactionID).toBeTruthy()
        throw new Error('Controlled second completion failure')
      }
      return doc
    })
    let result
    try {
      result = await complete(item.body)
    } finally {
      spyCreate.mockRestore()
      spyUpdate.mockRestore()
    }
    expect(written).toBe(true)
    expect(result.status).toBe(400)
    expect(result.data.error).toBe('bulk_completion_failed')
    expect(await versions()).toEqual(before)
    expect((await rows(item.ids)).every(r => r.status === 'pending')).toBe(true)
    const retry = await complete(item.body)
    expect(retry.status).toBe(200)
    expect(retry.data.completed).toBe(2)
  })
it('a failure AFTER queuing real risk work rolls back the whole multi-office batch; retry queues each affected scope', async () => {
  const item = await scenario(true),
    before = await versions(),
    previous = process.env.PAYLOAD_DISABLE_JOBS
  const queue = f.payload.jobs.queue.bind(f.payload.jobs)
  let written = false
  const spy = vi.spyOn(f.payload.jobs, 'queue').mockImplementation(async args => {
    const job = await queue(args as never)
    written = true
    expect(args.req?.transactionID).toBeTruthy()
    throw new Error('Controlled failure after real risk job write')
    return job
  })
  let result
  try {
    process.env.PAYLOAD_DISABLE_JOBS = '0'
    result = await complete(item.body)
  } finally {
    spy.mockRestore()
    process.env.PAYLOAD_DISABLE_JOBS = previous
  }
  expect(written).toBe(true)
  expect(result.status).toBe(400)
  expect(await versions()).toEqual(before)
  try {
    process.env.PAYLOAD_DISABLE_JOBS = '0'
    result = await complete(item.body)
  } finally {
    process.env.PAYLOAD_DISABLE_JOBS = previous
  }
  expect(result.status).toBe(200)
  expect(result.data.affected_office_ids.sort()).toEqual([f.own.office, f.own.second].sort())
  const jobs = (
    await f.payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      depth: 0,
      pagination: false,
    })
  ).docs
  const scopes = jobs.map(j => (j.input as { office_id?: string }).office_id ?? 'organization')
  expect(scopes.sort()).toEqual(['organization', f.own.office, f.own.second].sort())
})
it('selecting a subset completes only the chosen review and preserves the other draft', async () => {
  const item = await scenario()
  expect(
    (
      await f.api(`/v1/assessments/${item.ids[1]}/draft`, f.own.adminCookie, 'PATCH', {
        answers: [item.body.answers[0]],
      })
    ).status
  ).toBe(200)
  const draft = (await rows([item.ids[1]]))[0]
  const answers = (
    await f.payload.find({
      collection: 'assessment-answers',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { assessment: { equals: item.ids[1] } },
    })
  ).docs
  const result = await complete({ ...item.body, assessment_ids: [item.ids[0]] })
  expect(result.status).toBe(200)
  expect(result.data.completed).toBe(1)
  expect((await rows([item.ids[1]]))[0]).toEqual(draft)
  expect(
    (
      await f.payload.find({
        collection: 'assessment-answers',
        overrideAccess: true,
        depth: 0,
        pagination: false,
        where: { assessment: { equals: item.ids[1] } },
      })
    ).docs
  ).toEqual(answers)
})
it('two concurrent confirmations persist one set of answers and results per selected review', async () => {
  const item = await scenario()
  const responses = await Promise.all([complete(item.body), complete(item.body)])
  expect(responses.map(r => r.status)).toEqual([200, 200])
  expect((await rows(item.ids)).every(r => r.status === 'completed')).toBe(true)
  for (const id of item.ids) {
    const answers = (
      await f.payload.find({
        collection: 'assessment-answers',
        overrideAccess: true,
        depth: 0,
        pagination: false,
        where: { assessment: { equals: id } },
      })
    ).docs
    expect(answers).toHaveLength(item.body.answers.length)
    expect(new Set(answers.map(a => a.question_key)).size).toBe(answers.length)
  }
  for (const asset of item.assets) {
    const results = (
      await f.payload.find({
        collection: 'compliance-results',
        overrideAccess: true,
        depth: 0,
        pagination: false,
        where: { manual_asset: { equals: asset.id } },
      })
    ).docs
    expect(results.length).toBeGreaterThan(0)
    expect(new Set(results.map(r => r.check_key)).size).toBe(results.length)
  }
})

it('changing the assessment policy invalidates a cached selection before any answer is written', async () => {
  const item = await scenario()
  const changed = await f.api('/v1/organization/assessment-policy', f.own.adminCookie, 'PATCH', {
    policy_key: 'reinforced',
    policy_version: 2,
  })
  expect(changed.status).toBe(200)
  const before = await versions(),
    result = await complete(item.body)
  expect(result.status).toBe(409)
  expect(['bulk_selection_stale', 'bulk_preview_stale']).toContain(result.data.error)
  expect(await versions()).toEqual(before)
})
