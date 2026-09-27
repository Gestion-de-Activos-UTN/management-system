import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest, Where } from 'payload'
import config from '../payload.config'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import { reconcileOrganizationAssessments } from '@/domain/assessments/reconcileAssessmentInstance'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import {
  assessmentCompleteEndpoint,
  assessmentDetailEndpoint,
  assessmentsListEndpoint,
} from './assessments'

function request(
  payload: Payload,
  userId: string,
  options: { url?: string; id?: string; body?: unknown } = {}
) {
  return {
    payload,
    user: { id: userId, collection: 'users' },
    context: {},
    url: options.url,
    routeParams: options.id ? { id: options.id } : {},
    json: async () => options.body ?? {},
  } as unknown as PayloadRequest
}

async function seedManualComputerFlow(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    overrideAccess: true,
    data: { name: `Assessment integration ${Math.random()}` },
  })
  const [mainOffice, secondaryOffice] = await Promise.all([
    payload.create({
      collection: 'offices',
      overrideAccess: true,
      data: { organization: organization.id, name: 'Main Office' },
    }),
    payload.create({
      collection: 'offices',
      overrideAccess: true,
      data: { organization: organization.id, name: 'Secondary Office' },
    }),
  ])
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      name: 'Assessment Owner',
      email: `assessment-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'x'.repeat(12),
    },
  })
  const roleResult = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'org_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    roleResult.docs[0] ??
    (await payload.create({
      collection: 'roles',
      overrideAccess: true,
      data: {
        name: 'Organization administrator',
        slug: 'org_admin',
        rank: 2,
        scope: 'organization',
        is_platform_role: false,
      },
    }))
  await payload.create({
    collection: 'organization-memberships',
    overrideAccess: true,
    data: {
      user: user.id,
      organization: organization.id,
      offices: [mainOffice.id, secondaryOffice.id],
      role: role.id,
      status: 'active',
      is_active: true,
    },
  })
  await Promise.all([
    payload.create({
      collection: 'organization-settings',
      overrideAccess: true,
      data: {
        organization: organization.id,
        industry: 'Professional services',
        assessment_policy_key: 'essential',
        assessment_policy_version: 2,
        assessment_policy_selected_at: new Date().toISOString(),
      },
    }),
    payload.create({
      collection: 'subscriptions',
      overrideAccess: true,
      data: {
        organization: organization.id,
        level: 'premium',
        user_limits: {},
        max_offices: 10,
        features: { security_assessments: true },
      },
    }),
  ])
  const asset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Portable workstation',
      asset_category: 'computer',
      criticality: 'medium',
      owner: user.id,
      office: mainOffice.id,
      organization: organization.id,
      status: 'active',
      review_interval: 'never',
    },
  })
  return { organization, mainOffice, secondaryOffice, user, asset }
}

async function completeLatestCycle(payload: Payload, userId: string, manualAssetId: string) {
  const cycle = (
    await payload.find({
      collection: 'assessment-instances',
      where: {
        and: [
          { manual_asset: { equals: manualAssetId } },
          { status: { in: ['pending', 'in_progress'] } },
        ],
      },
      overrideAccess: true,
      limit: 1,
      sort: '-createdAt',
    })
  ).docs[0]
  assert.ok(cycle)
  const body = {
    answers: (cycle.question_set_snapshot as Array<{ key: string; version: number }>).map(item => ({
      question_key: item.key,
      question_version: item.version,
      // Best option of each v2 question; any valid option would do for this flow test.
      option_key: RISK_QUESTIONS_V2.find(question => question.key === item.key)!.options.find(
        option => option.efficacy === 1
      )!.key,
    })),
  }
  const response = await assessmentCompleteEndpoint.handler(
    request(payload, userId, { id: String(cycle.id), body })
  )
  assert.equal(response.status, 200)
}

test('Security Review filters a moved manual computer by its current office and keeps both cycles', async () => {
  const payload = await getPayload({ config })
  const { mainOffice, secondaryOffice, user, asset } = await seedManualComputerFlow(payload)

  await completeLatestCycle(payload, String(user.id), String(asset.id))
  await payload.update({
    collection: 'non-network-assets',
    id: asset.id,
    overrideAccess: true,
    data: { office: secondaryOffice.id },
  })
  await completeLatestCycle(payload, String(user.id), String(asset.id))

  const mainResponse = await assessmentsListEndpoint.handler(
    request(payload, String(user.id), {
      url: `http://localhost/api/v1/assessments?office_id=${mainOffice.id}`,
    })
  )
  const secondaryResponse = await assessmentsListEndpoint.handler(
    request(payload, String(user.id), {
      url: `http://localhost/api/v1/assessments?office_id=${secondaryOffice.id}`,
    })
  )
  assert.equal(mainResponse.status, 200)
  assert.equal(secondaryResponse.status, 200)

  const main = (await mainResponse.json()) as { docs: Array<{ manual_asset?: unknown }> }
  const secondary = (await secondaryResponse.json()) as { docs: Array<{ manual_asset?: unknown }> }
  const belongsToAsset = (row: { manual_asset?: unknown }) => {
    const relation = row.manual_asset
    return (
      String(
        typeof relation === 'object' && relation && 'id' in relation ? relation.id : relation
      ) === String(asset.id)
    )
  }
  assert.equal(main.docs.filter(belongsToAsset).length, 0)
  assert.equal(secondary.docs.filter(belongsToAsset).length, 2)
})

async function openCycle(payload: Payload, where: Where) {
  const cycle = (
    await payload.find({
      collection: 'assessment-instances',
      where: { and: [where, { status: { in: ['pending', 'in_progress'] } }] },
      overrideAccess: true,
      limit: 1,
    })
  ).docs[0]
  assert.ok(cycle)
  return cycle
}

async function completeCycle(payload: Payload, userId: string, cycleId: string) {
  const cycle = await payload.findByID({
    collection: 'assessment-instances',
    id: cycleId,
    overrideAccess: true,
  })
  const answers = (cycle.question_set_snapshot as Array<{ key: string; version: number }>).map(
    item => ({
      question_key: item.key,
      question_version: item.version,
      option_key: RISK_QUESTIONS_V2.find(question => question.key === item.key)!.options.find(
        option => option.efficacy === 1
      )!.key,
    })
  )
  const response = await assessmentCompleteEndpoint.handler(
    request(payload, userId, { id: cycleId, body: { answers } })
  )
  assert.equal(response.status, 200)
}

test('Security Review hides organization-level cycles and answers from office-scoped roles', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const organizationId = String(organization.id)
  const officeId = String(office.id)
  const admin = await member(payload, organizationId, [officeId], 'org_admin')
  await reconcileOrganizationAssessments(payload, organizationId, 'policy_changed')
  const organizationCycle = await openCycle(payload, {
    and: [{ organization: { equals: organizationId } }, { scope: { equals: 'organization' } }],
  })
  const officeCycle = await openCycle(payload, {
    and: [{ office: { equals: officeId } }, { scope: { equals: 'office' } }],
  })
  await completeCycle(payload, admin, String(organizationCycle.id))
  await completeCycle(payload, admin, String(officeCycle.id))
  const organizationKeys = (organizationCycle.question_set_snapshot as Array<{ key: string }>).map(
    item => item.key
  )

  const detail = async (userId: string, id: string) => {
    const response = await assessmentDetailEndpoint.handler(request(payload, userId, { id }))
    return {
      status: response.status,
      body: (await response.json()) as { effective_evidence?: Record<string, unknown> },
    }
  }
  // org_admin still sees organization answers inherited into the office view.
  const adminView = await detail(admin, String(officeCycle.id))
  assert.ok(organizationKeys.some(key => key in adminView.body.effective_evidence!))

  for (const slug of ['office_manager', 'org_viewer'] as const) {
    const scoped = await member(payload, organizationId, [officeId], slug)
    const list = await assessmentsListEndpoint.handler(
      request(payload, scoped, { url: 'http://localhost/api/v1/assessments' })
    )
    const docs = ((await list.json()) as { docs: Array<{ scope: string }> }).docs
    assert.ok(docs.length > 0)
    assert.ok(
      docs.every(doc => doc.scope !== 'organization'),
      `${slug} list`
    )

    const officeList = await assessmentsListEndpoint.handler(
      request(payload, scoped, { url: `http://localhost/api/v1/assessments?office_id=${officeId}` })
    )
    const officeDocs = ((await officeList.json()) as { docs: Array<{ scope: string }> }).docs
    assert.ok(
      officeDocs.every(doc => doc.scope !== 'organization'),
      `${slug} office list`
    )

    assert.equal((await detail(scoped, String(organizationCycle.id))).status, 403)
    const officeView = await detail(scoped, String(officeCycle.id))
    assert.equal(officeView.status, 200)
    assert.ok(organizationKeys.every(key => !(key in officeView.body.effective_evidence!)))

    // REST path query on assessment.office: organization answers never show up.
    const answers = await payload.find({
      collection: 'assessment-answers',
      overrideAccess: false,
      user: { id: scoped, collection: 'users' } as never,
      depth: 0,
      pagination: false,
    })
    assert.ok(answers.docs.length > 0)
    assert.ok(
      answers.docs.every(row => String(row.assessment) !== String(organizationCycle.id)),
      `${slug} answers`
    )
  }
})
