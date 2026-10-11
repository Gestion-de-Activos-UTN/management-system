import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { portalMessageEndpoints } from './portalMessages'

function endpoint(method: Endpoint['method'], path: string) {
  const found = portalMessageEndpoints.find(item => item.method === method && item.path === path)
  assert.ok(found, `${method} ${path}`)
  return found
}

function request(
  payload: Payload,
  user: { id: string; collection: 'users' | 'admins' },
  options: { url?: string; id?: string; body?: unknown } = {}
) {
  return {
    payload,
    user,
    context: {},
    url: options.url,
    routeParams: options.id ? { id: options.id } : {},
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
        name: 'Platform Admin',
        slug: 'platform_admin',
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
      email: `portal-admin-${crypto.randomUUID()}@test.local`,
      password: 'x'.repeat(12),
      status: 'active',
    },
  })
  return { id: String(admin.id), collection: 'admins' as const }
}

type MyMessage = {
  id: string
  delivery_version: number
  seen: boolean
  dismissed: boolean
  entity: { kind: string; href?: string | null; access: string } | null
}

test('Portal messages: entrega por organización, recibos, reenvío, enlace y desactivación', async () => {
  const payload = await getPayload({ config })
  const admin = await platformAdmin(payload)
  const { organization, office } = await seedRiskOrganization(payload)
  const { organization: otherOrganization } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const recipient = {
    id: await member(payload, orgId, [String(office.id)], 'org_viewer'),
    collection: 'users' as const,
  }
  const outsider = {
    id: await member(payload, String(otherOrganization.id), [], 'org_viewer'),
    collection: 'users' as const,
  }
  const input = {
    title: 'Revisión pendiente',
    description: 'Revisa el inventario.',
    message_type: 'actionable',
    cta_label: 'Ir al inventario',
    audience: { scope: 'organizations', target_kind: 'all', organization_ids: [orgId] },
    linked_section: 'inventory',
    is_active: true,
  }

  const invalid = await endpoint('post', '/v1/platform-admin/portal-messages').handler(
    request(payload, admin, { body: { ...input, message_type: 'notice' } })
  )
  assert.equal(invalid.status, 400, 'un aviso no admite texto de acción')
  const forbidden = await endpoint('post', '/v1/platform-admin/portal-messages').handler(
    request(payload, recipient, { body: input })
  )
  assert.equal(forbidden.status, 403)

  const created = await endpoint('post', '/v1/platform-admin/portal-messages').handler(
    request(payload, admin, { body: input })
  )
  assert.equal(created.status, 201)
  const messageId = String(((await created.json()) as { id: string }).id)

  const mine = async (user: typeof recipient) => {
    const response = await endpoint('get', '/v1/portal-messages').handler(request(payload, user))
    assert.equal(response.status, 200)
    const { docs } = (await response.json()) as { docs: MyMessage[] }
    return docs.find(doc => String(doc.id) === messageId)
  }
  const delivered = await mine(recipient)
  assert.ok(delivered)
  assert.equal(delivered.seen, false)
  assert.deepEqual(
    { kind: delivered.entity?.kind, href: delivered.entity?.href },
    { kind: 'section', href: '/portal/inventory' }
  )
  assert.equal(await mine(outsider), undefined, 'otra organización no lo recibe')

  const receipt = (user: typeof recipient, status: string, deliveryVersion: number) =>
    endpoint('patch', '/v1/portal-messages/:id/receipt').handler(
      request(payload, user, {
        id: messageId,
        body: { status, delivery_version: deliveryVersion },
      })
    )
  assert.equal((await receipt(outsider, 'seen', 1)).status, 404)
  assert.equal((await receipt(recipient, 'seen', 1)).status, 200)
  assert.equal((await mine(recipient))?.seen, true)
  assert.equal((await receipt(recipient, 'dismissed', 1)).status, 200)
  assert.equal((await mine(recipient))?.dismissed, true)

  const link = await endpoint('get', '/v1/portal-messages/:id/resolve-link').handler(
    request(payload, recipient, { id: messageId })
  )
  assert.deepEqual(await link.json(), { url: '/portal/inventory' })

  const replay = await endpoint('post', '/v1/platform-admin/portal-messages/:id/replay').handler(
    request(payload, admin, { id: messageId })
  )
  assert.equal(replay.status, 200)
  const replayed = await mine(recipient)
  assert.equal(replayed?.delivery_version, 2)
  assert.equal(replayed?.dismissed, false, 'el reenvío lo vuelve a mostrar')
  assert.equal(
    ((await (await receipt(recipient, 'dismissed', 1)).json()) as { stale?: boolean }).stale,
    true,
    'un recibo de la entrega anterior no descarta la nueva'
  )

  const entities = await endpoint('get', '/v1/platform-admin/portal-message-entities').handler(
    request(payload, admin, {
      url: `http://localhost/x?scope=organizations&organization_id=${orgId}&type=offices`,
    })
  )
  const { docs: offices } = (await entities.json()) as { docs: Array<{ value: string }> }
  assert.deepEqual(
    offices.map(doc => doc.value),
    [String(office.id)],
    'sólo entidades de la organización destinataria'
  )

  // Una audiencia que quedó obsoleta no impide desactivar el mensaje, pero sí reactivarlo.
  await payload.update({
    collection: 'organizations',
    id: orgId,
    data: { is_active: false },
    overrideAccess: true,
  })
  const update = (isActive: boolean) =>
    endpoint('patch', '/v1/platform-admin/portal-messages/:id').handler(
      request(payload, admin, { id: messageId, body: { ...input, is_active: isActive } })
    )
  assert.equal((await update(false)).status, 200)
  assert.equal((await update(true)).status, 400)
})
