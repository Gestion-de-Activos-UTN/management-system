import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { taskEndpoints } from './tasks'

function endpoint(method: Endpoint['method'], path: string) {
  const found = taskEndpoints.find(item => item.method === method && item.path === path)
  assert.ok(found, `${method} ${path}`)
  return found
}

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

test('Tasks cubre creación multi-oficina, reclamo, reprogramación, completado y borrado', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const secondOffice = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organization.id, name: 'Secondary' },
  })
  const organizationId = String(organization.id)
  const officeIds = [String(office.id), String(secondOffice.id)]
  const adminId = await member(payload, organizationId, officeIds, 'org_admin')
  const viewerId = await member(payload, organizationId, officeIds, 'org_viewer')

  const createResponse = await endpoint('post', '/v1/tasks').handler(
    request(payload, adminId, {
      body: {
        title: 'Revisar inventarios',
        description: 'Validar los dos inventarios.',
        priority: 'high',
        global: false,
        office_ids: officeIds,
        assignment_kind: 'open_pool',
      },
    })
  )
  assert.equal(createResponse.status, 201)
  const created = (await createResponse.json()) as {
    docs: Array<{ id: string; creation_batch_id: string }>
  }
  assert.equal(created.docs.length, 2)
  assert.ok(created.docs[0].creation_batch_id)
  assert.equal(created.docs[0].creation_batch_id, created.docs[1].creation_batch_id)

  const firstId = String(created.docs[0].id)
  const claimResponse = await endpoint('post', '/v1/tasks/:id/claim').handler(
    request(payload, viewerId, { id: firstId })
  )
  assert.equal(claimResponse.status, 200)

  const future = new Date(Date.now() + 86_400_000).toISOString()
  const editResponse = await endpoint('patch', '/v1/tasks/:id').handler(
    request(payload, adminId, { id: firstId, body: { start_at: future } })
  )
  assert.equal(editResponse.status, 200)
  const replanned = (await editResponse.json()) as {
    status: string
    effective_status: string
    claimed_by: unknown
  }
  assert.equal(replanned.status, 'pending')
  assert.equal(replanned.effective_status, 'planned')
  assert.equal(replanned.claimed_by, null)

  const earlyClaim = await endpoint('post', '/v1/tasks/:id/claim').handler(
    request(payload, viewerId, { id: firstId })
  )
  assert.equal(earlyClaim.status, 400)

  await endpoint('patch', '/v1/tasks/:id').handler(
    request(payload, adminId, { id: firstId, body: { start_at: new Date().toISOString() } })
  )
  assert.equal(
    (
      await endpoint('post', '/v1/tasks/:id/claim').handler(
        request(payload, viewerId, { id: firstId })
      )
    ).status,
    200
  )
  assert.equal(
    (
      await endpoint('post', '/v1/tasks/:id/complete').handler(
        request(payload, viewerId, { id: firstId })
      )
    ).status,
    200
  )

  const completed = await payload.findByID({
    collection: 'tasks',
    id: firstId,
    overrideAccess: true,
    depth: 0,
  })
  assert.equal(completed.status, 'completed')
  assert.equal(String(completed.completed_by), viewerId)

  const secondId = String(created.docs[1].id)
  assert.equal(
    (await endpoint('delete', '/v1/tasks/:id').handler(request(payload, adminId, { id: secondId })))
      .status,
    200
  )
  await assert.rejects(() =>
    payload.findByID({ collection: 'tasks', id: secondId, overrideAccess: true })
  )
})

test('Tasks rechaza asignar por rol cuando ese rol no puede leer la entidad', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const organizationId = String(organization.id)
  const officeId = String(office.id)
  const adminId = await member(payload, organizationId, [officeId], 'org_admin')
  const viewerId = await member(payload, organizationId, [officeId], 'org_viewer')
  const viewerMembership = (
    await payload.find({
      collection: 'organization-memberships',
      where: { user: { equals: viewerId } },
      overrideAccess: true,
      depth: 0,
      limit: 1,
    })
  ).docs[0]
  assert.ok(viewerMembership)
  const agent = (
    await payload.find({
      collection: 'agents',
      where: { office: { equals: officeId } },
      overrideAccess: true,
      depth: 0,
      limit: 1,
    })
  ).docs[0]
  assert.ok(agent)

  const response = await endpoint('post', '/v1/tasks').handler(
    request(payload, adminId, {
      body: {
        title: 'Revisar agente',
        priority: 'normal',
        global: false,
        office_ids: [officeId],
        assignment_kind: 'role',
        assigned_role: String(viewerMembership.role),
        related_entity: { relationTo: 'agents', value: String(agent.id) },
      },
    })
  )
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'no_eligible_assignees')
})
