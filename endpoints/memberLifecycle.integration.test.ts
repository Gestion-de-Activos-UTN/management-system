import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { relationId } from '@/lib/relationId'
import type { MemberDeactivationImpact } from '@/modules/users/service'
import { orgMemberDeactivationImpactEndpoint, updateOrgMemberEndpoint } from './orgMembers'

function request(payload: Payload, userId: string, options: { id?: string; body?: unknown } = {}) {
  return {
    payload,
    user: { id: userId, collection: 'users' },
    context: {},
    routeParams: options.id ? { id: options.id } : {},
    json: async () => options.body ?? {},
  } as unknown as PayloadRequest
}

async function seed(payload: Payload) {
  const { organization, office, server } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const officeA = String(office.id)
  const second = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: orgId, name: 'Sucursal' },
  })
  const officeB = String(second.id)
  const adminId = await member(payload, orgId, [officeA, officeB], 'org_admin')
  const laptop = (ownerId: string, officeId: string) =>
    payload.create({
      collection: 'non-network-assets',
      overrideAccess: true,
      data: {
        alias: `Notebook ${Math.random().toString(36).slice(2)}`,
        asset_category: 'computer',
        criticality: 'medium',
        office: officeId,
        organization: orgId,
        owner: ownerId,
      } as never,
    })
  const claimedTask = (userId: string, officeId: string) =>
    payload.create({
      collection: 'tasks',
      overrideAccess: true,
      data: {
        title: 'Tarea tomada',
        priority: 'normal',
        status: 'in_progress',
        start_at: new Date(Date.now() - 60_000).toISOString(),
        assignment_kind: 'open_pool',
        organization: orgId,
        office: officeId,
        created_by: { relationTo: 'users', value: adminId },
        claimed_by: { relationTo: 'users', value: userId },
        claimed_at: new Date().toISOString(),
      } as never,
    })
  return { orgId, officeA, officeB, adminId, server, laptop, claimedTask }
}

const read = <T>(
  payload: Payload,
  collection: 'non-network-assets' | 'tasks' | 'assets',
  id: unknown
) => payload.findByID({ collection, id: String(id), overrideAccess: true, depth: 0 }) as Promise<T>

test('Personas: desactivar con reemplazo pasa sus activos al reemplazo y libera sus tareas en curso', async () => {
  const payload = await getPayload({ config })
  const { orgId, officeA, adminId, laptop, claimedTask } = await seed(payload)
  const leavingId = await member(payload, orgId, [officeA], 'office_manager')
  const replacementId = await member(payload, orgId, [officeA], 'office_manager')
  const asset = await laptop(leavingId, officeA)
  const task = await claimedTask(leavingId, officeA)

  const impactResponse = await orgMemberDeactivationImpactEndpoint.handler(
    request(payload, adminId, { id: leavingId })
  )
  assert.equal(impactResponse.status, 200)
  const impact = (await impactResponse.json()) as MemberDeactivationImpact
  assert.deepEqual(
    impact.owned_assets.map(item => item.id),
    [String(asset.id)]
  )
  assert.equal(impact.in_progress_tasks, 1)

  const updated = await updateOrgMemberEndpoint.handler(
    request(payload, adminId, {
      id: leavingId,
      body: { is_active: false, replacement_owner_id: replacementId },
    })
  )
  assert.equal(updated.status, 200)

  const reassigned = await read<{ owner: unknown }>(payload, 'non-network-assets', asset.id)
  assert.equal(relationId(reassigned.owner), replacementId)
  const review = await payload.find({
    collection: 'assessment-instances',
    where: {
      and: [{ manual_asset: { equals: asset.id } }, { status: { in: ['pending', 'in_progress'] } }],
    },
    overrideAccess: true,
    depth: 0,
  })
  assert.equal(
    relationId(review.docs[0].assigned_to),
    replacementId,
    'el assessment sigue al responsable'
  )

  const released = await read<{
    status: string
    claimed_by: unknown
    claim_history: Array<{ action: string; reason?: string }>
  }>(payload, 'tasks', task.id)
  assert.equal(released.status, 'pending')
  assert.equal(released.claimed_by ?? null, null)
  assert.equal(released.claim_history.at(-1)?.action, 'released')
  assert.equal(released.claim_history.at(-1)?.reason, 'member_deactivated')
})

test('Personas: sin reemplazo los activos quedan sin responsable, incluso los de red no identificados', async () => {
  const payload = await getPayload({ config })
  const { orgId, officeA, adminId, server, laptop } = await seed(payload)
  const leavingId = await member(payload, orgId, [officeA], 'office_manager')
  const asset = await laptop(leavingId, officeA)
  // Un activo des-identificado conserva su owner a propósito (assetUnidentify.ts).
  await payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { owner: leavingId, identified: false, identification_status: 'pending' } as never,
  })

  const invalid = await updateOrgMemberEndpoint.handler(
    request(payload, adminId, {
      id: leavingId,
      body: { is_active: false, replacement_owner_id: leavingId },
    })
  )
  assert.equal(invalid.status, 400, 'el reemplazo tiene que ser otra persona activa')

  const updated = await updateOrgMemberEndpoint.handler(
    request(payload, adminId, { id: leavingId, body: { is_active: false } })
  )
  assert.equal(updated.status, 200)
  assert.equal(
    (await read<{ owner: unknown }>(payload, 'non-network-assets', asset.id)).owner ?? null,
    null
  )
  assert.equal((await read<{ owner: unknown }>(payload, 'assets', server.id)).owner ?? null, null)
})

test('Personas: quitarle una oficina libera sólo sus activos y tareas de esa oficina', async () => {
  const payload = await getPayload({ config })
  const { orgId, officeA, officeB, adminId, laptop, claimedTask } = await seed(payload)
  const managerId = await member(payload, orgId, [officeA, officeB], 'office_manager')
  const inA = await laptop(managerId, officeA)
  const inB = await laptop(managerId, officeB)
  const taskA = await claimedTask(managerId, officeA)
  const taskB = await claimedTask(managerId, officeB)

  const updated = await updateOrgMemberEndpoint.handler(
    request(payload, adminId, { id: managerId, body: { office_ids: [officeB] } })
  )
  assert.equal(updated.status, 200)

  assert.equal(
    (await read<{ owner: unknown }>(payload, 'non-network-assets', inA.id)).owner ?? null,
    null
  )
  assert.equal(
    relationId((await read<{ owner: unknown }>(payload, 'non-network-assets', inB.id)).owner),
    managerId
  )
  const releasedA = await read<{ status: string; claim_history: Array<{ reason?: string }> }>(
    payload,
    'tasks',
    taskA.id
  )
  assert.equal(releasedA.status, 'pending')
  assert.equal(releasedA.claim_history.at(-1)?.reason, 'office_access_removed')
  assert.equal((await read<{ status: string }>(payload, 'tasks', taskB.id)).status, 'in_progress')
})

test('Activos manuales: una persona no puede dejarlos sin responsable ni moverlos a una oficina inactiva', async () => {
  const payload = await getPayload({ config })
  const { orgId, officeA, officeB, adminId, laptop } = await seed(payload)
  const managerId = await member(payload, orgId, [officeA, officeB], 'office_manager')
  const asset = await laptop(managerId, officeA)
  const admin = await payload.findByID({ collection: 'users', id: adminId, overrideAccess: true })
  const asAdmin = (data: Record<string, unknown>) =>
    payload.update({
      collection: 'non-network-assets',
      id: asset.id,
      overrideAccess: true,
      user: { ...admin, collection: 'users' },
      data,
    })

  await assert.rejects(asAdmin({ owner: null }), /responsable es obligatorio/)

  await payload.update({
    collection: 'offices',
    id: officeB,
    overrideAccess: true,
    data: { is_active: false },
  })
  await assert.rejects(asAdmin({ office: officeB }), /oficina elegida está inactiva/)

  // Desactivar al responsable lo deja sin responsable (sistema); después se puede editar otra
  // cosa conservando ese null, pero no mover el activo sin elegir un responsable.
  await payload.update({
    collection: 'organization-memberships',
    where: { user: { equals: managerId } },
    overrideAccess: true,
    data: { is_active: false },
  })
  assert.equal(
    (await read<{ owner: unknown }>(payload, 'non-network-assets', asset.id)).owner ?? null,
    null
  )
  await asAdmin({ criticality: 'high', owner: null })
  assert.equal(
    (await read<{ criticality: string }>(payload, 'non-network-assets', asset.id)).criticality,
    'high'
  )
})
