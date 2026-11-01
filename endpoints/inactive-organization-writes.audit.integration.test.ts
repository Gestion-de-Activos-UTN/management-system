import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'

// Matriz de la organización inactiva: lecturas e historial abiertos, toda escritura de un usuario
// (incluido el PlatformAdmin que visita) rechazada con 409, escrituras del sistema sin usuario y
// cascadas del StaffPortal permitidas.
let f: ScopeFixture
let asset: string, task: string, assessment: string
const visit = () => `?asOrganization=${f.own.org}`

beforeAll(async () => {
  f = await scopeFixture('inactive')
  const agent = (
    await f.payload.find({
      collection: 'agents',
      overrideAccess: true,
      depth: 0,
      where: { office: { equals: f.own.office } },
      limit: 1,
    })
  ).docs[0]
  asset = String(
    (
      await f.payload.create({
        collection: 'assets',
        overrideAccess: true,
        context: { systemJob: true },
        data: {
          asset_id: `inactive-${randomUUID()}`,
          agent: agent.id,
          organization: f.own.org,
          office: f.own.office,
          ip: '10.0.0.42',
          identification_status: 'confirmed',
          identified: true,
          confirmed_type: 'server',
          authorization_status: 'authorized',
          criticality: 'medium',
          status: 'active',
        },
      })
    ).id
  )
  const created = await f.api('/v1/tasks', f.own.adminCookie, 'POST', {
    title: 'Revisar respaldo',
    priority: 'normal',
    global: false,
    office_ids: [f.own.office],
    assignment_kind: 'open_pool',
  })
  expect(created.status, JSON.stringify(created.data)).toBe(201)
  task = String(created.data.docs[0].id)
  // Cambiar la política reconcilia los assessments de organización y de oficina.
  const policy = await f.api('/v1/organization/assessment-policy', f.own.adminCookie, 'PATCH', {
    policy_key: 'reinforced',
    policy_version: 2,
  })
  expect(policy.status, JSON.stringify(policy.data)).toBe(200)
  assessment = String(
    (
      await f.payload.find({
        collection: 'assessment-instances',
        overrideAccess: true,
        depth: 0,
        where: {
          and: [{ scope: { equals: 'office' } }, { office: { equals: f.own.office } }],
        },
        limit: 1,
      })
    ).docs[0].id
  )
  // La cascada del StaffPortal (sin organización visitada) retira activos pese al hook.
  await f.deactivate()
}, 60000)
afterAll(async () => {
  if (f) await f.payload.destroy()
})

it('the StaffPortal cascade retired the network asset', async () => {
  const stored = await f.payload.findByID({
    collection: 'assets',
    id: asset,
    overrideAccess: true,
    depth: 0,
  })
  expect(stored.status).toBe('retired')
})

describe('reads keep working', () => {
  it('network asset', async () => {
    expect((await f.api(`/assets/${asset}${visit()}`, f.platform)).status).toBe(200)
  })
  it('task detail', async () => {
    expect((await f.api(`/v1/tasks/${task}${visit()}`, f.platform)).status).toBe(200)
  })
  it('office assessment reports the inactive organization, not an active office', async () => {
    const result = await f.api(`/v1/assessments/${assessment}${visit()}`, f.platform)
    expect(result.status).toBe(200)
    expect(result.data.inactive_subject).toBe('organization_inactive')
  })
})

const writes: Array<[string, () => [string, string, unknown]]> = [
  ['PATCH network asset', () => [`/assets/${asset}`, 'PATCH', { location: 'Depósito' }]],
  [
    'create task',
    () => [
      '/v1/tasks',
      'POST',
      {
        title: 'No crear',
        priority: 'normal',
        global: false,
        office_ids: [f.own.office],
        assignment_kind: 'open_pool',
      },
    ],
  ],
  ['edit task', () => [`/v1/tasks/${task}`, 'PATCH', { title: 'No editar' }]],
  ['task command', () => [`/v1/tasks/${task}/claim`, 'POST', {}]],
  [
    'assessment policy',
    () => [
      '/v1/organization/assessment-policy',
      'PATCH',
      { policy_key: 'essential', policy_version: 2 },
    ],
  ],
  [
    'office assessment draft',
    () => [`/v1/assessments/${assessment}/draft`, 'PATCH', { answers: [] }],
  ],
]
describe('visited writes are rejected without changes', () => {
  for (const [name, request] of writes)
    it(name, async () => {
      const [path, method, body] = request()
      const before = await f.versions()
      const result = await f.api(`${path}${visit()}`, f.platform, method, body)
      expect(result.status, JSON.stringify(result.data)).toBe(409)
      expect(result.data.error ?? result.data.errors?.[0]?.data?.code).toBe('organization_inactive')
      expect(await f.versions()).toEqual(before)
    })
})

it('a system write without a user (scanner, jobs) is not blocked', async () => {
  await expect(
    f.payload.update({
      collection: 'assets',
      id: asset,
      overrideAccess: true,
      context: { systemJob: true },
      data: { location: 'Depósito' },
    })
  ).resolves.toMatchObject({ id: asset })
})
