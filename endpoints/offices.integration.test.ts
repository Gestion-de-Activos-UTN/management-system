import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { relationId } from '@/lib/relationId'
import { officeEndpoints } from './offices'

function endpoint(method: Endpoint['method'], path: string) {
  const found = officeEndpoints.find(item => item.method === method && item.path === path)
  assert.ok(found, `${method} ${path}`)
  return found
}

function request(payload: Payload, userId: string, options: { id?: string; body?: unknown } = {}) {
  return {
    payload,
    user: { id: userId, collection: 'users' },
    context: {},
    routeParams: options.id ? { id: options.id } : {},
    json: async () => options.body ?? {},
  } as unknown as PayloadRequest
}

test('Oficinas: alta con ubicación y tope del plan, desactivación con revocación y aviso, reactivación sin cascada', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const officeId = String(office.id)
  const adminId = await member(payload, orgId, [officeId], 'org_admin')
  const managerId = await member(payload, orgId, [officeId], 'office_manager')

  const forbidden = await endpoint('post', '/v1/offices').handler(
    request(payload, managerId, { body: { name: 'X', province_id: '82' } })
  )
  assert.equal(forbidden.status, 403, 'sólo el org_admin crea oficinas')

  const badLocation = await endpoint('post', '/v1/offices').handler(
    request(payload, adminId, { body: { name: 'X', province_id: '82', department_id: '02001' } })
  )
  assert.equal(badLocation.status, 400, 'el departamento debe pertenecer a la provincia')

  const created = await endpoint('post', '/v1/offices').handler(
    request(payload, adminId, { body: { name: 'Sucursal Rosario', province_id: '82' } })
  )
  assert.equal(created.status, 201)
  const secondId = String(((await created.json()) as { id: string }).id)
  const adminMembership = await payload.find({
    collection: 'organization-memberships',
    where: { user: { equals: adminId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  assert.ok(
    (adminMembership.docs[0].offices ?? []).map(relationId).includes(secondId),
    'la oficina nueva se asigna a los org_admin'
  )

  await payload.update({
    collection: 'subscriptions',
    where: { organization: { equals: orgId } },
    data: { max_offices: 2 },
    overrideAccess: true,
  })
  const overQuota = await endpoint('post', '/v1/offices').handler(
    request(payload, adminId, { body: { name: 'Tercera', province_id: '82' } })
  )
  assert.equal(overQuota.status, 409, 'respeta el tope de oficinas del plan')

  const status = (id: string, body: unknown) =>
    endpoint('post', '/v1/offices/:id/status').handler(request(payload, adminId, { id, body }))

  // El office_manager sólo tiene la oficina principal: desactivarla lo deja sin oficinas.
  const warned = await status(officeId, { is_active: false })
  assert.equal(warned.status, 409)
  const warning = (await warned.json()) as {
    error: string
    details: { agents: number; members_without_office: Array<{ user_id: string }> }
  }
  assert.equal(warning.error, 'members_would_be_deactivated')
  assert.deepEqual(
    warning.details.members_without_office.map(m => m.user_id),
    [managerId]
  )
  assert.equal(warning.details.agents, 1)

  assert.equal(
    (await status(officeId, { is_active: false, confirm_member_deactivation: true })).status,
    200
  )
  const manager = await payload.findByID({
    collection: 'users',
    id: managerId,
    overrideAccess: true,
  })
  assert.equal(manager.status, 'inactive', 'quien queda sin oficina se desactiva')
  const agents = await payload.find({
    collection: 'agents',
    where: { office: { equals: officeId } },
    overrideAccess: true,
    depth: 0,
  })
  assert.ok(agents.docs.every(agent => agent.lifecycle_status === 'revoked'))
  assert.equal(agents.docs[0].revocation_reason, 'office_deactivated')

  assert.equal(
    (await status(secondId, { is_active: false })).status,
    409,
    'no se puede desactivar la última oficina activa'
  )

  assert.equal((await status(officeId, { is_active: true })).status, 200)
  const managerAfter = await payload.findByID({
    collection: 'users',
    id: managerId,
    overrideAccess: true,
  })
  assert.equal(managerAfter.status, 'inactive', 'reactivar la oficina no reactiva personas')
})
