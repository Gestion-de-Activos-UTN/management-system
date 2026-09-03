import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { withScannerFixture } from '../domain/agents/scanner-source-fixture'
import { agentProvisioningEndpoint } from './agentProvisioning'

// Mismo enfoque que assetIdentify.integration.test.ts (Local API real + PayloadRequest mínimo).
function fakeRequest(
  payload: Payload,
  opts: { user?: { id: string; collection: 'users' }; body?: unknown },
) {
  return {
    payload,
    user: opts.user,
    context: {},
    url: 'http://localhost/api/v1/agents/provision',
    json: async () => opts.body ?? {},
  } as unknown as PayloadRequest
}

async function zipEntries(res: Response) {
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  return Object.values(zip.files)
    .filter(entry => !entry.dir)
    .map(entry => entry.name)
}

async function seedTenant(payload: Payload, roleSlug: 'org_admin' | 'org_viewer') {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Oficina Test', is_active: true },
    overrideAccess: true,
  })
  const existingRole = await payload.find({
    collection: 'roles',
    where: { slug: { equals: roleSlug } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    existingRole.docs[0] ??
    (await payload.create({
      collection: 'roles',
      data: {
        slug: roleSlug,
        name: roleSlug,
        rank: roleSlug === 'org_admin' ? 2 : 3,
        scope: 'organization',
        is_platform_role: false,
      },
      overrideAccess: true,
    }))
  const user = await payload.create({
    collection: 'users',
    data: { name: 'Test User', email: `u-${Math.random().toString(36).slice(2)}@test.local`, password: 'x'.repeat(12) },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'organization-memberships',
    data: {
      user: user.id,
      organization: organization.id,
      offices: [office.id],
      role: role.id,
      status: 'active',
      is_active: true,
    },
    overrideAccess: true,
  })
  return { organization, office, user }
}

test('POST /v1/agents/provision: 401 sin sesión', async () => {
  const payload = await getPayload({ config })
  const res = await agentProvisioningEndpoint.handler(fakeRequest(payload, { body: { office_id: 'x' } }))
  assert.equal(res.status, 401)
})

test('POST /v1/agents/provision: 403 sin permiso de create sobre agents (org_viewer)', async () => {
  const payload = await getPayload({ config })
  const { office, user } = await seedTenant(payload, 'org_viewer')

  const res = await agentProvisioningEndpoint.handler(
    fakeRequest(payload, {
      user: { id: String(user.id), collection: 'users' },
      body: { office_id: String(office.id) },
    }),
  )
  assert.equal(res.status, 403)
})

test('POST /v1/agents/provision: rechaza (403 vía assertOrganizationMatches) una office de otra organización', async () => {
  const payload = await getPayload({ config })
  const { user } = await seedTenant(payload, 'org_admin')
  const otherOrg = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const otherOffice = await payload.create({
    collection: 'offices',
    data: { organization: otherOrg.id, name: 'Otra Org', is_active: true },
    overrideAccess: true,
  })

  await assert.rejects(
    async () => {
      await agentProvisioningEndpoint.handler(
        fakeRequest(payload, {
          user: { id: String(user.id), collection: 'users' },
          body: { office_id: String(otherOffice.id) },
        }),
      )
    },
    (e: unknown) => (e as { status?: number }).status === 403,
  )
})

test('POST /v1/agents/provision: 201 happy path crea el agent y devuelve el .zip', async () => {
  await withScannerFixture(async () => {
    const payload = await getPayload({ config })
    const { office, user } = await seedTenant(payload, 'org_admin')

    const res = await agentProvisioningEndpoint.handler(
      fakeRequest(payload, {
        user: { id: String(user.id), collection: 'users' },
        body: { office_id: String(office.id) },
      }),
    )
    assert.equal(res.status, 201)
    assert.equal(res.headers.get('Content-Type'), 'application/zip')

    const agents = await payload.find({
      collection: 'agents',
      where: { office: { equals: office.id } },
      overrideAccess: true,
      limit: 1,
    })
    assert.equal(agents.docs.length, 1)
    assert.equal(agents.docs[0].is_active, true)

    // Sin `platform` en el body (cliente anterior al soporte Windows) el paquete sigue siendo POSIX.
    const entries = await zipEntries(res)
    assert.equal(entries.includes('start-agent.sh'), true)
    assert.equal(entries.includes('start-agent.ps1'), false)
  })
})

test('POST /v1/agents/provision: platform=windows devuelve el paquete con los launchers de Windows', async () => {
  await withScannerFixture(async () => {
    const payload = await getPayload({ config })
    const { office, user } = await seedTenant(payload, 'org_admin')

    const res = await agentProvisioningEndpoint.handler(
      fakeRequest(payload, {
        user: { id: String(user.id), collection: 'users' },
        body: { office_id: String(office.id), platform: 'windows' },
      }),
    )
    assert.equal(res.status, 201)
    assert.match(
      res.headers.get('Content-Disposition') ?? '',
      /attachment; filename="agent-[0-9a-f-]+-windows\.zip"/,
    )

    const entries = await zipEntries(res)
    assert.equal(entries.includes('start-agent.ps1'), true)
    assert.equal(entries.includes('start-agent.cmd'), true)
    assert.equal(entries.includes('start-agent.sh'), false)
  })
})

test('POST /v1/agents/provision: 400 con un platform desconocido', async () => {
  const payload = await getPayload({ config })
  const { office, user } = await seedTenant(payload, 'org_admin')

  const res = await agentProvisioningEndpoint.handler(
    fakeRequest(payload, {
      user: { id: String(user.id), collection: 'users' },
      body: { office_id: String(office.id), platform: 'solaris' },
    }),
  )
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'platform_invalid')
})
