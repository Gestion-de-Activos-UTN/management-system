import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import type { OrganizationStatusImpact } from '@/domain/organizations/organization-lifecycle'
import { platformOrganizationEndpoints } from './platformOrganizations'

function endpoint(method: Endpoint['method'], path: string) {
  const found = platformOrganizationEndpoints.find(
    item => item.method === method && item.path === path
  )
  assert.ok(found, `${method} ${path}`)
  return found
}

function request(
  payload: Payload,
  user: { id: string; collection: 'users' | 'admins' },
  options: { id: string; body?: unknown }
) {
  return {
    payload,
    user,
    context: {},
    routeParams: { id: options.id },
    json: async () => options.body ?? {},
  } as unknown as PayloadRequest
}

async function platformAdmin(payload: Payload) {
  const roles = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'platform_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    roles.docs[0] ??
    (await payload.create({
      collection: 'roles',
      overrideAccess: true,
      data: {
        slug: 'platform_admin',
        name: 'Platform',
        rank: 0,
        scope: 'platform',
        is_platform_role: true,
      },
    }))
  const admin = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      role: role.id,
      email: `platform-${crypto.randomUUID()}@example.test`,
      password: 'x'.repeat(16),
      status: 'active',
    },
  })
  return { id: String(admin.id), collection: 'admins' as const }
}

async function openAssessments(payload: Payload, organizationId: string) {
  return payload.find({
    collection: 'assessment-instances',
    where: {
      and: [
        { organization: { equals: organizationId } },
        { status: { in: ['pending', 'in_progress'] } },
      ],
    },
    overrideAccess: true,
    depth: 0,
    pagination: false,
  })
}

test('Organizaciones: sólo un PlatformAdmin las desactiva; se da de baja todo en un solo paso', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const officeId = String(office.id)
  const firstAdminId = await member(payload, orgId, [officeId], 'org_admin')
  const secondAdminId = await member(payload, orgId, [officeId], 'org_admin')
  const managerId = await member(payload, orgId, [officeId], 'office_manager')
  // Una oficina desactivada antes de este cambio, con un activo manual que quedó vigente.
  const legacy = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: orgId, name: 'Vieja', is_active: false },
  })
  const legacyLaptop = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Notebook olvidada',
      asset_category: 'computer',
      criticality: 'low',
      office: String(legacy.id),
      organization: orgId,
      owner: managerId,
    } as never,
  })
  const task = await payload.create({
    collection: 'tasks',
    overrideAccess: true,
    data: {
      title: 'Tarea de la organización',
      priority: 'normal',
      start_at: new Date(Date.now() - 60_000).toISOString(),
      assignment_kind: 'open_pool',
      organization: orgId,
      created_by: { relationTo: 'users', value: firstAdminId },
    } as never,
  })
  for (const subject of [
    { scope: 'organization' as const, id: orgId },
    { scope: 'office' as const, id: officeId },
  ]) {
    await reconcileAssessmentInstance(
      payload,
      { ...subject, organizationId: orgId, is_active: true },
      'initial'
    )
  }

  const status = (user: { id: string; collection: 'users' | 'admins' }, body: unknown) =>
    endpoint('post', '/v1/platform-admin/organizations/:id/status').handler(
      request(payload, user, { id: orgId, body })
    )
  const orgAdmin = { id: firstAdminId, collection: 'users' as const }
  assert.equal(
    (await status(orgAdmin, { is_active: false, confirm_name: organization.name })).status,
    403,
    'un OrgAdmin no puede desactivar su organización'
  )

  const admin = await platformAdmin(payload)
  const impactResponse = await endpoint(
    'get',
    '/v1/platform-admin/organizations/:id/status-impact'
  ).handler(request(payload, admin, { id: orgId }))
  const impact = (await impactResponse.json()) as OrganizationStatusImpact
  assert.ok(impact.is_active)
  assert.equal(impact.deactivation.offices, 1)
  assert.equal(impact.deactivation.members, 3)
  assert.equal(impact.deactivation.network_assets, 1)
  assert.equal(impact.deactivation.manual_assets, 1)
  assert.equal(impact.deactivation.open_tasks, 1)

  const mismatch = await status(admin, { is_active: false, confirm_name: 'Otra' })
  assert.equal(mismatch.status, 400)

  assert.equal(
    (await status(admin, { is_active: false, confirm_name: organization.name })).status,
    200
  )

  const inOrganization = { organization: { equals: orgId } }
  const offices = () =>
    payload.find({
      collection: 'offices',
      where: inOrganization,
      overrideAccess: true,
      depth: 0,
      pagination: false,
    })
  const memberships = () =>
    payload.find({
      collection: 'organization-memberships',
      where: inOrganization,
      overrideAccess: true,
      depth: 0,
      pagination: false,
    })
  const org = await payload.findByID({
    collection: 'organizations',
    id: orgId,
    overrideAccess: true,
  })
  assert.equal(org.is_active, false)
  assert.ok((await offices()).docs.every(o => o.is_active === false))
  assert.ok(
    (await memberships()).docs.every(m => m.is_active === false),
    'el guard del último OrgAdmin no protege una organización inactiva'
  )
  const users = await payload.find({
    collection: 'users',
    where: { id: { in: [firstAdminId, secondAdminId, managerId] } },
    overrideAccess: true,
    depth: 0,
    pagination: false,
  })
  assert.ok(users.docs.every(u => u.status === 'inactive'))
  const serverAfter = await payload.findByID({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
  })
  assert.equal(serverAfter.status, 'retired')
  const legacyAfter = await payload.findByID({
    collection: 'non-network-assets',
    id: legacyLaptop.id,
    overrideAccess: true,
    depth: 0,
  })
  assert.equal(legacyAfter.status, 'retired', 'también se dan de baja los de oficinas ya inactivas')
  assert.equal(legacyAfter.owner ?? null, null)
  const agents = await payload.find({
    collection: 'agents',
    where: { office: { equals: officeId } },
    overrideAccess: true,
    depth: 0,
  })
  assert.ok(agents.docs.every(a => a.revocation_reason === 'organization_deactivated'))
  const taskAfter = await payload.findByID({
    collection: 'tasks',
    id: task.id,
    overrideAccess: true,
  })
  assert.equal(taskAfter.status, 'cancelled')
  assert.equal(taskAfter.cancellation_reason, 'Organización desactivada.')
  assert.equal((await openAssessments(payload, orgId)).totalDocs, 0)
  const subscription = await payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: orgId } },
    overrideAccess: true,
    limit: 1,
  })
  assert.equal(
    (subscription.docs[0].features as { security_assessments?: boolean }).security_assessments,
    true,
    'las features del plan no se tocan'
  )

  // Reactivar: vuelve el OrgAdmin más antiguo y la oficina más antigua, nada más.
  const preview = (await (
    await endpoint('get', '/v1/platform-admin/organizations/:id/status-impact').handler(
      request(payload, admin, { id: orgId })
    )
  ).json()) as OrganizationStatusImpact
  assert.ok(!preview.is_active)
  assert.equal(preview.reactivation.office?.name, 'Main')

  assert.equal((await status(admin, { is_active: true })).status, 200)
  const activeUsers = (await memberships()).docs.filter(m => m.is_active).map(m => String(m.user))
  assert.deepEqual(activeUsers, [firstAdminId], 'sólo vuelve el OrgAdmin más antiguo')
  const firstAdmin = await payload.findByID({
    collection: 'users',
    id: firstAdminId,
    overrideAccess: true,
  })
  assert.equal(firstAdmin.status, 'active')
  assert.deepEqual(
    (await offices()).docs.filter(o => o.is_active).map(o => String(o.id)),
    [officeId],
    'sólo vuelve la oficina más antigua'
  )
  const reopened = await openAssessments(payload, orgId)
  assert.deepEqual(reopened.docs.map(a => [a.scope, a.created_reason]).sort(), [
    ['office', 'office_reactivated'],
    ['organization', 'organization_reactivated'],
  ])
  assert.equal(
    (await payload.findByID({ collection: 'assets', id: server.id, overrideAccess: true })).status,
    'retired',
    'los activos dados de baja no se restauran'
  )
})

test('Organizaciones: sin ningún OrgAdmin no se puede reactivar', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  await member(payload, orgId, [String(office.id)], 'office_manager')
  const admin = await platformAdmin(payload)
  const status = (body: unknown) =>
    endpoint('post', '/v1/platform-admin/organizations/:id/status').handler(
      request(payload, admin, { id: orgId, body })
    )
  assert.equal((await status({ is_active: false, confirm_name: organization.name })).status, 200)
  const reactivated = await status({ is_active: true })
  assert.equal(reactivated.status, 409)
  assert.equal(((await reactivated.json()) as { error: string }).error, 'no_admin_available')
})

test('Organizaciones: reactivar no revive a un OrgAdmin que se dio de baja antes que la organización', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const officeId = String(office.id)
  const formerAdminId = await member(payload, orgId, [officeId], 'org_admin')
  const currentAdminId = await member(payload, orgId, [officeId], 'org_admin')
  const membershipOf = async (userId: string) =>
    (
      await payload.find({
        collection: 'organization-memberships',
        where: { user: { equals: userId } },
        overrideAccess: true,
        depth: 0,
        limit: 1,
      })
    ).docs[0]
  // El más antiguo se fue de la empresa: se lo desactiva a mano mientras la organización sigue activa.
  await payload.update({
    collection: 'organization-memberships',
    id: (await membershipOf(formerAdminId)).id,
    data: { is_active: false },
    overrideAccess: true,
  })

  const admin = await platformAdmin(payload)
  const status = (body: unknown) =>
    endpoint('post', '/v1/platform-admin/organizations/:id/status').handler(
      request(payload, admin, { id: orgId, body })
    )
  assert.equal((await status({ is_active: false, confirm_name: organization.name })).status, 200)

  const currentUser = await payload.findByID({
    collection: 'users',
    id: currentAdminId,
    overrideAccess: true,
  })
  const preview = (await (
    await endpoint('get', '/v1/platform-admin/organizations/:id/status-impact').handler(
      request(payload, admin, { id: orgId })
    )
  ).json()) as OrganizationStatusImpact
  assert.ok(!preview.is_active)
  assert.equal(preview.reactivation.admin?.email, currentUser.email)

  assert.equal((await status({ is_active: true })).status, 200)
  assert.equal((await membershipOf(currentAdminId)).is_active, true)
  assert.equal((await membershipOf(formerAdminId)).is_active, false, 'sigue afuera')
  const formerUser = await payload.findByID({
    collection: 'users',
    id: formerAdminId,
    overrideAccess: true,
  })
  assert.equal(formerUser.status, 'inactive')
})
