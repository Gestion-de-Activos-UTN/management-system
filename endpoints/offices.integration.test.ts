import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import type { OfficeDeactivationImpact } from '@/domain/offices/office-lifecycle'
import { relationId } from '@/lib/relationId'
import { officeEndpoints } from './offices'
import { assessmentDraftEndpoint } from './assessments'

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

async function openOfficeAssessments(payload: Payload, officeId: string) {
  return payload.find({
    collection: 'assessment-instances',
    where: {
      and: [
        { scope: { equals: 'office' } },
        { office: { equals: officeId } },
        { status: { in: ['pending', 'in_progress'] } },
      ],
    },
    overrideAccess: true,
    depth: 0,
  })
}

test('Oficinas: alta con ubicación y tope del plan, desactivación en un solo paso con cuadro de impacto, reactivación sin cascada', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const officeId = String(office.id)
  const adminId = await member(payload, orgId, [officeId], 'org_admin')
  const managerId = await member(payload, orgId, [officeId], 'office_manager')
  await reconcileAssessmentInstance(
    payload,
    { scope: 'office', id: officeId, organizationId: orgId, is_active: true },
    'initial'
  )

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

  // Lo que la desactivación tiene que resolver: un activo manual a cargo del office_manager que se
  // mueve, otro que se da de baja, una tarea de cada uno y otra tarea de la oficina que el
  // office_manager tiene tomada.
  const laptop = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Notebook de recepción',
      asset_category: 'computer',
      criticality: 'medium',
      office: officeId,
      organization: orgId,
      owner: managerId,
      location: 'Recepción',
    } as never,
  })
  const laptopId = String(laptop.id)
  const oldPrinter = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Impresora vieja',
      asset_category: 'printer',
      criticality: 'low',
      office: officeId,
      organization: orgId,
      owner: managerId,
    } as never,
  })
  const oldPrinterId = String(oldPrinter.id)
  const task = (data: Record<string, unknown>) =>
    payload.create({
      collection: 'tasks',
      overrideAccess: true,
      data: {
        priority: 'normal',
        start_at: new Date(Date.now() - 60_000).toISOString(),
        assignment_kind: 'open_pool',
        organization: orgId,
        office: officeId,
        created_by: { relationTo: 'users', value: adminId },
        ...data,
      } as never,
    })
  const officeTask = await task({
    title: 'Revisar el rack',
    status: 'in_progress',
    claimed_by: { relationTo: 'users', value: managerId },
    claimed_at: new Date().toISOString(),
  })
  const laptopTask = await task({
    title: 'Actualizar la notebook',
    related_entity: { relationTo: 'non-network-assets', value: laptopId },
  })
  const printerTask = await task({
    title: 'Cambiar el tóner',
    related_entity: { relationTo: 'non-network-assets', value: oldPrinterId },
  })

  const impactResponse = await endpoint('get', '/v1/offices/:id/deactivation-impact').handler(
    request(payload, adminId, { id: officeId })
  )
  assert.equal(impactResponse.status, 200)
  const impact = (await impactResponse.json()) as OfficeDeactivationImpact
  assert.equal(impact.agents, 1)
  assert.equal(impact.network_assets, 1)
  assert.deepEqual(
    impact.members_without_office.map(m => m.user_id),
    [managerId]
  )
  assert.deepEqual(
    impact.manual_assets.map(asset => [asset.id, asset.open_tasks]).sort(),
    [
      [laptopId, 1],
      [oldPrinterId, 1],
    ].sort(),
    'cada activo manual informa sus tareas: siguen la decisión sobre ese activo'
  )
  assert.deepEqual(
    impact.destination_offices.map(destination => destination.id),
    [secondId]
  )
  assert.equal(impact.open_tasks, 1, 'sólo la tarea propia de la oficina, sin las de sus activos')
  assert.equal(impact.open_assessment, true)

  const status = (id: string, body: unknown) =>
    endpoint('post', '/v1/offices/:id/status').handler(request(payload, adminId, { id, body }))
  const decisions = [
    { asset_id: laptopId, destination: secondId },
    { asset_id: oldPrinterId, destination: 'retire' },
  ]

  const mismatch = await status(officeId, {
    is_active: false,
    confirm_name: 'Otra',
    manual_asset_decisions: decisions,
  })
  assert.equal(mismatch.status, 400)
  assert.equal(((await mismatch.json()) as { error: string }).error, 'confirmation_mismatch')

  const stale = await status(officeId, {
    is_active: false,
    confirm_name: office.name,
    manual_asset_decisions: [],
  })
  assert.equal(stale.status, 409, 'cada activo manual necesita un destino')
  assert.equal(((await stale.json()) as { error: string }).error, 'impact_changed')

  const sameOffice = await status(officeId, {
    is_active: false,
    confirm_name: office.name,
    manual_asset_decisions: [
      { asset_id: laptopId, destination: officeId },
      { asset_id: oldPrinterId, destination: 'retire' },
    ],
  })
  assert.equal(sameOffice.status, 400)
  assert.equal(((await sameOffice.json()) as { error: string }).error, 'invalid_destination')

  assert.equal(
    (
      await status(officeId, {
        is_active: false,
        confirm_name: office.name,
        manual_asset_decisions: decisions,
      })
    ).status,
    200
  )

  const read = <T>(collection: 'assets' | 'non-network-assets' | 'tasks' | 'users', id: string) =>
    payload.findByID({ collection, id, overrideAccess: true, depth: 0 }) as Promise<T>

  const retired = await read<{ status: string }>('assets', String(server.id))
  assert.equal(retired.status, 'retired', 'los activos de red se dan de baja')

  const moved = await read<{ office: string; owner: unknown; location: unknown }>(
    'non-network-assets',
    laptopId
  )
  assert.equal(relationId(moved.office), secondId, 'el activo manual va a la oficina elegida')
  assert.equal(moved.owner ?? null, null, 'llega sin responsable')
  assert.equal(moved.location ?? null, null, 'llega sin ubicación')
  const laptopReview = await payload.find({
    collection: 'assessment-instances',
    where: {
      and: [{ manual_asset: { equals: laptopId } }, { status: { in: ['pending', 'in_progress'] } }],
    },
    overrideAccess: true,
    depth: 0,
  })
  assert.equal(laptopReview.totalDocs, 1)
  assert.equal(relationId(laptopReview.docs[0].office), secondId)

  const retiredPrinter = await read<{ status: string; office: string; deleted_at?: string | null }>(
    'non-network-assets',
    oldPrinterId
  )
  assert.equal(retiredPrinter.status, 'retired', 'el activo manual elegido se da de baja')
  assert.equal(relationId(retiredPrinter.office), officeId, 'y queda como historial de su oficina')
  assert.equal(retiredPrinter.deleted_at ?? null, null)
  const printerTaskAfter = await read<{ status: string }>('tasks', String(printerTask.id))
  assert.equal(
    printerTaskAfter.status,
    'cancelled',
    'las tareas del activo dado de baja se cancelan'
  )

  const movedTask = await read<{ status: string; office: string }>('tasks', String(laptopTask.id))
  assert.equal(movedTask.status, 'pending', 'la tarea del activo movido no se cancela')
  assert.equal(relationId(movedTask.office), secondId)

  const cancelled = await read<{
    status: string
    cancellation_reason: string
    claim_history: Array<{ action: string; reason?: string }>
  }>('tasks', String(officeTask.id))
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.cancellation_reason, 'Oficina desactivada.')
  assert.equal(
    cancelled.claim_history.at(-1)?.reason,
    'member_deactivated',
    'antes se liberó porque quien la tenía quedó desactivado'
  )

  const manager = await read<{ status: string }>('users', managerId)
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
    (await openOfficeAssessments(payload, officeId)).totalDocs,
    0,
    'se cierra el assessment de la oficina'
  )
  const officeAssessment = await payload.find({
    collection: 'assessment-instances',
    where: { and: [{ scope: { equals: 'office' } }, { office: { equals: officeId } }] },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  const draft = await assessmentDraftEndpoint.handler(
    request(payload, adminId, { id: String(officeAssessment.docs[0].id), body: { answers: [] } })
  )
  assert.equal(draft.status, 409, 'una oficina inactiva no se responde')
  assert.equal(((await draft.json()) as { error: string }).error, 'office_inactive')

  await assert.rejects(
    payload.update({
      collection: 'assets',
      id: server.id,
      overrideAccess: true,
      data: { status: 'active' },
    }),
    /oficina de este activo está inactiva/,
    'un activo de red no se reactiva en una oficina inactiva'
  )

  assert.equal(
    (
      await status(secondId, {
        is_active: false,
        confirm_name: 'Sucursal Rosario',
        manual_asset_decisions: [],
      })
    ).status,
    409,
    'no se puede desactivar la última oficina activa'
  )

  assert.equal((await status(officeId, { is_active: true })).status, 200)
  const reopened = await openOfficeAssessments(payload, officeId)
  assert.equal(reopened.totalDocs, 1, 'reactivar abre un assessment nuevo de la oficina')
  assert.equal(reopened.docs[0].created_reason, 'office_reactivated')
  assert.equal(
    (await read<{ status: string }>('users', managerId)).status,
    'inactive',
    'reactivar la oficina no reactiva personas'
  )
  assert.equal(
    (await read<{ status: string }>('assets', String(server.id))).status,
    'retired',
    'ni activos dados de baja'
  )
  assert.equal(
    relationId((await read<{ office: string }>('non-network-assets', laptopId)).office),
    secondId,
    'ni devuelve los activos movidos'
  )
})
