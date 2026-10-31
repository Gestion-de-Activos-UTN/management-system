import { afterAll, beforeAll, expect, it } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import type { BulkAssessmentSelector } from '@/modules/assessments/schema'

let f: ScopeFixture, mine: any, otherOffice: any, foreign: any, managerOwned: any
const previewPath = '/v1/assessments/bulk/preview',
  completePath = '/v1/assessments/bulk/complete'
const organizationSelector = (): BulkAssessmentSelector => ({
  mode: 'organization',
  risk_asset_type: 'workstation',
})
const officeSelector = (office = f.own.office): BulkAssessmentSelector => ({
  mode: 'office',
  office_id: office,
  risk_asset_type: 'workstation',
})
const ownerSelector = (owner = f.own.viewer): BulkAssessmentSelector => ({
  mode: 'owner',
  owner_id: owner,
  risk_asset_type: 'workstation',
})
const preview = (cookie: string, selector: unknown, suffix = '') =>
  f.api(previewPath + suffix, cookie, 'POST', { selector })
function command(data: any, selector: unknown, ids?: string[]) {
  return {
    selector,
    assessment_ids: ids ?? data.applicable.map((row: any) => row.assessment_id),
    question_set_signature: data.question_set_signature,
    answers: (data.question_set_snapshot as Array<{ key: string; version: number }>).map(
      question => {
        const definition = RISK_QUESTIONS_V2.find(item => item.key === question.key)!
        const option = definition.options.find(item => item.efficacy === 1) ?? definition.options[0]
        return {
          question_key: question.key,
          question_version: question.version,
          option_key: option.key,
          ...(option.requires_justification ? { justification: 'Justificación de prueba.' } : {}),
        }
      }
    ),
  }
}
beforeAll(async () => {
  f = await scopeFixture('bulk')
  mine = await f.createManual()
  managerOwned = await f.createManual(f.own, { owner: f.own.manager })
  otherOffice = await f.createManual(f.own, { office: f.own.second, owner: f.own.outside })
  foreign = await f.createManual(f.foreign)
}, 60000)
afterAll(async () => {
  if (f) await f.payload.destroy()
})

for (const actor of ['admin', 'manager', 'viewer', 'platform', 'visited', 'anonymous'] as const) {
  it(`${actor}: organization bulk selector requires an organization administrator`, async () => {
    const cookie =
      actor === 'anonymous'
        ? ''
        : actor === 'platform' || actor === 'visited'
          ? f.platform
          : f.own[`${actor}Cookie`]
    const before = await f.versions()
    const result = await preview(
      cookie,
      organizationSelector(),
      actor === 'visited' ? `?asOrganization=${f.own.org}` : ''
    )
    expect(result.status).toBe(
      actor === 'admin' ? 200 : actor === 'anonymous' ? 401 : actor === 'platform' ? 400 : 403
    )
    if (actor === 'admin') {
      expect(result.data.applicable.map((row: any) => row.asset_id).sort()).toEqual(
        [mine.id, managerOwned.id, otherOffice.id].sort()
      )
      expect(JSON.stringify(result.data)).not.toContain(foreign.id)
    }
    expect(await f.versions()).toEqual(before)
  })
}

it('a manager previews only its assigned office while the admin can preview either office', async () => {
  const before = await f.versions()
  const own = await preview(f.own.managerCookie, officeSelector())
  expect(own.status).toBe(200)
  expect(own.data.applicable.map((row: any) => row.asset_id).sort()).toEqual(
    [mine.id, managerOwned.id].sort()
  )
  expect((await preview(f.own.managerCookie, officeSelector(f.own.second))).status).toBe(403)
  expect((await preview(f.own.managerCookie, officeSelector(f.foreign.office))).status).toBe(403)
  const second = await preview(f.own.adminCookie, officeSelector(f.own.second))
  expect(second.status).toBe(200)
  expect(second.data.applicable.map((row: any) => row.asset_id)).toEqual([otherOffice.id])
  expect(await f.versions()).toEqual(before)
})

it('a Viewer previews only its own assets and cannot request another owner or whole office', async () => {
  const before = await f.versions()
  const result = await preview(f.own.viewerCookie, ownerSelector())
  expect(result.status).toBe(200)
  expect(result.data.applicable.map((row: any) => row.asset_id)).toEqual([mine.id])
  expect((await preview(f.own.viewerCookie, ownerSelector(f.own.manager))).status).toBe(403)
  expect((await preview(f.own.viewerCookie, officeSelector())).status).toBe(403)
  expect(await f.versions()).toEqual(before)
})

for (const selector of ['foreign-office', 'foreign-owner'] as const) {
  it(`an allowed administrator selector cannot reveal ${selector} targets`, async () => {
    const before = await f.versions()
    const result = await preview(
      f.own.adminCookie,
      selector === 'foreign-office'
        ? officeSelector(f.foreign.office)
        : ownerSelector(f.foreign.viewer)
    )
    expect(result.status).toBe(200)
    expect(result.data.applicable).toEqual([])
    expect(result.data.preserved_completed).toEqual([])
    expect(JSON.stringify(result.data)).not.toContain(foreign.id)
    expect(await f.versions()).toEqual(before)
  })
}

for (const actor of ['viewer', 'manager', 'visited', 'anonymous'] as const) {
  it(`${actor}: bulk completion cannot bypass selector authorization`, async () => {
    const valid = await preview(f.own.adminCookie, organizationSelector())
    expect(valid.status).toBe(200)
    const before = await f.versions()
    const cookie =
      actor === 'anonymous' ? '' : actor === 'visited' ? f.platform : f.own[`${actor}Cookie`]
    const result = await f.api(
      completePath + (actor === 'visited' ? `?asOrganization=${f.own.org}` : ''),
      cookie,
      'POST',
      command(valid.data, organizationSelector())
    )
    expect(result.status).toBe(actor === 'anonymous' ? 401 : 403)
    expect(await f.versions()).toEqual(before)
  })
}

for (const target of ['foreign', 'other-office', 'other-owner'] as const) {
  it(`completion rejects injected ${target} assessment IDs without any writes`, async () => {
    const selector = target === 'other-owner' ? ownerSelector() : officeSelector()
    const cookie = target === 'other-owner' ? f.own.viewerCookie : f.own.managerCookie
    const valid = await preview(cookie, selector)
    expect(valid.status).toBe(200)
    const asset =
      target === 'foreign' ? foreign : target === 'other-office' ? otherOffice : managerOwned
    const rows = await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      where: { manual_asset: { equals: asset.id } },
      depth: 0,
      limit: 1,
    })
    const before = await f.versions()
    const result = await f.api(
      completePath,
      cookie,
      'POST',
      command(valid.data, selector, [
        valid.data.applicable[0].assessment_id,
        String(rows.docs[0].id),
      ])
    )
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('bulk_selection_stale')
    expect(await f.versions()).toEqual(before)
  })
}

it('a cached preview loses eligibility immediately when the owner changes', async () => {
  const asset = await f.createManual()
  const selector = ownerSelector()
  const old = await preview(f.own.viewerCookie, selector)
  const candidate = old.data.applicable.find((row: any) => row.asset_id === asset.id)
  expect(candidate).toBeTruthy()
  expect(
    (
      await f.api(`/non-network-assets/${asset.id}`, f.own.adminCookie, 'PATCH', {
        owner: f.own.manager,
      })
    ).status
  ).toBe(200)
  const before = await f.versions()
  const result = await f.api(
    completePath,
    f.own.viewerCookie,
    'POST',
    command(old.data, selector, [candidate.assessment_id])
  )
  expect(result.status).toBe(409)
  expect(result.data.error).toBe('bulk_selection_stale')
  expect(await f.versions()).toEqual(before)
})

it('the same manager cookie cannot reuse an office selector after its office assignment changes', async () => {
  expect((await preview(f.own.managerCookie, officeSelector())).status).toBe(200)
  expect(
    (
      await f.api(`/v1/org-members/${f.own.manager}`, f.own.adminCookie, 'PATCH', {
        office_ids: [f.own.second],
      })
    ).status
  ).toBe(200)
  const before = await f.versions()
  expect((await preview(f.own.managerCookie, officeSelector())).status).toBe(403)
  expect(await f.versions()).toEqual(before)
  expect(
    (
      await f.api(`/v1/org-members/${f.own.manager}`, f.own.adminCookie, 'PATCH', {
        office_ids: [f.own.office],
      })
    ).status
  ).toBe(200)
})

it('a Viewer can complete an eligible owned review through the real bulk endpoint', async () => {
  const selector = ownerSelector()
  const result = await preview(f.own.viewerCookie, selector)
  expect(result.status).toBe(200)
  const candidate = result.data.applicable.find((row: any) => row.asset_id === mine.id)
  const completion = await f.api(
    completePath,
    f.own.viewerCookie,
    'POST',
    command(result.data, selector, [candidate.assessment_id])
  )
  expect(completion.status, completion.data.message).toBe(200)
  expect(completion.data.completed).toBe(1)
  expect(
    (
      await f.payload.findByID({
        collection: 'assessment-instances',
        id: candidate.assessment_id,
        overrideAccess: true,
      })
    ).status
  ).toBe('completed')
  expect(
    (
      await f.payload.count({
        collection: 'assessment-answers',
        overrideAccess: true,
        where: { assessment: { equals: candidate.assessment_id } },
      })
    ).totalDocs
  ).toBeGreaterThan(0)
})

it('organization deactivation revokes existing cookies for preview and completion', async () => {
  const old = await preview(f.own.adminCookie, organizationSelector())
  await f.deactivate()
  const before = await f.versions()
  expect((await preview(f.own.adminCookie, organizationSelector())).status).toBe(401)
  expect(
    (
      await f.api(
        completePath,
        f.own.adminCookie,
        'POST',
        command(old.data, organizationSelector())
      )
    ).status
  ).toBe(401)
  expect(await f.versions()).toEqual(before)
})
