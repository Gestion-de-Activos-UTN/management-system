import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { orgMembersEndpoint, updateOrgMemberEndpoint } from './orgMembers'
import { myProfileEndpoints } from './myProfile'

function request(
  payload: Payload,
  userId: string,
  options: { id?: string; body?: unknown; url?: string } = {}
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

test('Miembros: desactivar, reactivar y cambiar de rol respetan las reglas de la organización', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const officeId = String(office.id)
  const adminId = await member(payload, orgId, [officeId], 'org_admin')
  const viewerId = await member(payload, orgId, [officeId], 'org_viewer')
  const adminEmail = (
    await payload.findByID({ collection: 'users', id: adminId, overrideAccess: true })
  ).email
  const viewerEmail = (
    await payload.findByID({ collection: 'users', id: viewerId, overrideAccess: true })
  ).email
  const patch = (actor: string, target: string, body: unknown) =>
    updateOrgMemberEndpoint.handler(request(payload, actor, { id: target, body }))

  assert.equal((await patch(viewerId, adminId, { is_active: false })).status, 403)
  const self = await patch(adminId, adminId, { is_active: false, confirm_email: adminEmail })
  assert.equal(self.status, 409)
  assert.equal(((await self.json()) as { error: string }).error, 'cannot_deactivate_self')
  const lastAdmin = await patch(adminId, adminId, { role: 'org_viewer', office_ids: [officeId] })
  assert.equal(lastAdmin.status, 409, 'el último org_admin no puede bajarse de rol')

  assert.equal(
    (await patch(adminId, viewerId, { role: 'office_manager', office_ids: [] })).status,
    400,
    'un rol que no es admin necesita al menos una oficina'
  )

  assert.equal(
    (await patch(adminId, viewerId, { is_active: false, confirm_email: viewerEmail })).status,
    200
  )
  const listed = await orgMembersEndpoint.handler(
    request(payload, adminId, { url: 'http://localhost/x?include_inactive=1' })
  )
  const { docs } = (await listed.json()) as { docs: Array<{ id: string; is_active: boolean }> }
  assert.equal(
    docs.find(doc => doc.id === viewerId)?.is_active,
    false,
    'el admin ve a los inactivos'
  )
  const plain = await orgMembersEndpoint.handler(request(payload, adminId))
  assert.ok(
    !((await plain.json()) as { docs: Array<{ id: string }> }).docs.some(
      doc => doc.id === viewerId
    ),
    'los selectores sólo reciben personas activas'
  )

  await payload.update({
    collection: 'subscriptions',
    where: { organization: { equals: orgId } },
    data: { user_limits: { org_viewer: 0 } },
    overrideAccess: true,
  })
  assert.equal(
    (await patch(adminId, viewerId, { is_active: true })).status,
    409,
    'reactivar respeta el tope de personas por rol'
  )
  await payload.update({
    collection: 'subscriptions',
    where: { organization: { equals: orgId } },
    data: { user_limits: {} },
    overrideAccess: true,
  })
  assert.equal((await patch(adminId, viewerId, { is_active: true })).status, 200)
  const viewer = await payload.findByID({ collection: 'users', id: viewerId, overrideAccess: true })
  assert.equal(viewer.status, 'active', 'reactivar la membresía reactiva al usuario')

  // Con un segundo admin, el primero puede bajarse de rol.
  assert.equal((await patch(adminId, viewerId, { role: 'org_admin' })).status, 200)
  assert.equal(
    (await patch(adminId, adminId, { role: 'office_manager', office_ids: [officeId] })).status,
    200
  )
  // Ya como office_manager no tiene permiso de gestionar personas (ni de subirse otra vez).
  assert.equal((await patch(adminId, adminId, { role: 'org_admin' })).status, 403)

  const [getProfile, patchProfile] = myProfileEndpoints
  const renamed = await patchProfile.handler(
    request(payload, viewerId, { body: { name: 'Nombre nuevo' } })
  )
  assert.equal(renamed.status, 200)
  const profile = (await (await getProfile.handler(request(payload, viewerId))).json()) as {
    name: string
    all_offices: boolean
  }
  assert.equal(profile.name, 'Nombre nuevo')
  assert.equal(profile.all_offices, true)
})
