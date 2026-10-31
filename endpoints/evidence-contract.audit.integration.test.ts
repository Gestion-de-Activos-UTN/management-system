import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'

let f: ScopeFixture
const collections = ['scan-reports', 'inventory-snapshots'] as const
type EvidenceCollection = (typeof collections)[number]
let records: Record<EvidenceCollection, { own: string; foreign: string; second: string }>
beforeAll(async () => {
  f = await scopeFixture('evidence')
  const server = (
    await f.payload.find({
      collection: 'assets',
      overrideAccess: true,
      depth: 0,
      where: { office: { equals: f.own.office } },
      limit: 1,
    })
  ).docs[0]
  await f.payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      host_scripts: { 'test-host': 'Salida cruda de host' },
      services: [
        {
          port: 443,
          protocol: 'tcp',
          state: 'open',
          name: 'https',
          scripts: { 'test-port': 'Salida cruda de puerto' },
        },
      ],
    },
  })
  await f.createManual()
  async function snapshot(office: string, cookie: string) {
    const result = await f.api('/v1/inventory-snapshots/generate', cookie, 'POST', {
      office_id: office,
    })
    expect(result.status).toBe(201)
    return String(result.data.id)
  }
  async function report(office: string) {
    const agent = (
      await f.payload.find({
        collection: 'agents',
        overrideAccess: true,
        depth: 0,
        where: { office: { equals: office } },
        limit: 1,
      })
    ).docs[0]
    const doc = await f.payload.create({
      collection: 'scan-reports',
      overrideAccess: true,
      data: {
        id: `report-${randomUUID()}`,
        agent: agent?.id ?? relationId(server.agent),
        office,
        execution_status: 'completed',
        network: '10.0.0.0/24',
        hosts_up: 1,
        scan_start: '2026-10-30T10:00:00Z',
        scan_end: '2026-10-30T10:00:01Z',
        content_fingerprint: 'fixture-fingerprint',
        raw_payload: { private: 'Salida cruda de informe' },
        error: 'Diagnóstico interno',
        status: 'processed',
      },
    })
    return String(doc.id)
  }
  records = {
    'scan-reports': {
      own: await report(f.own.office),
      foreign: await report(f.foreign.office),
      second: await report(f.own.second),
    },
    'inventory-snapshots': {
      own: await snapshot(f.own.office, f.own.adminCookie),
      foreign: await snapshot(f.foreign.office, f.foreign.adminCookie),
      second: await snapshot(f.own.second, f.own.adminCookie),
    },
  }
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
const versions = () => f.versions(['risk-contributions', 'scan-reports'])
const stored = (collection: EvidenceCollection, id = records[collection].own) =>
  f.payload.findByID({ collection, id, overrideAccess: true, depth: 0 })
const rename = (
  collection: EvidenceCollection,
  body: unknown,
  cookie = f.own.adminCookie,
  id = records[collection].own,
  suffix = ''
) => f.api(`/v1/${collection}/${id}/name${suffix}`, cookie, 'PATCH', body)
function actorCookie(actor: string) {
  return actor === 'anonymous'
    ? ''
    : actor === 'platform' || actor === 'visited'
      ? f.platform
      : actor === 'foreign'
        ? f.foreign.adminCookie
        : f.own[
            `${actor}Cookie` as 'adminCookie' | 'managerCookie' | 'viewerCookie' | 'outsideCookie'
          ]
}
function immutable<T extends { display_name?: string | null; updatedAt: string }>(doc: T) {
  const { display_name: _name, updatedAt: _updated, ...content } = doc
  return content
}
for (const collection of collections) {
  for (const actor of [
    'admin',
    'manager',
    'viewer',
    'outside',
    'foreign',
    'platform',
    'visited',
    'anonymous',
  ]) {
    it(`${collection}: ${actor} reads only authorized evidence and technical detail`, async () => {
      const suffix = actor === 'visited' ? `&asOrganization=${f.own.org}` : ''
      const before = await versions()
      const result = await f.api(
        `/${collection}/${records[collection].own}?depth=0${suffix}`,
        actorCookie(actor)
      )
      const allowed = ['admin', 'manager', 'viewer', 'platform', 'visited'].includes(actor)
      expect(result.status).toBe(allowed ? 200 : actor === 'anonymous' ? 403 : 404)
      if (allowed) {
        if (collection === 'scan-reports') {
          const technical = ['admin', 'manager', 'visited'].includes(actor)
          expect(result.data.raw_payload).toEqual(
            technical ? { private: 'Salida cruda de informe' } : undefined
          )
          expect(result.data.error).toBe(technical ? 'Diagnóstico interno' : undefined)
          expect(result.data.network).toBe('10.0.0.0/24')
        } else {
          const technical = ['admin', 'manager', 'visited'].includes(actor)
          const network = result.data.assets_dump.network as Array<{
            host_scripts?: unknown
            services?: Array<{ scripts?: unknown; port: number }>
          }>
          expect(network.length).toBeGreaterThan(0)
          expect(network[0].host_scripts).toEqual(
            technical ? { 'test-host': 'Salida cruda de host' } : undefined
          )
          expect(network[0].services?.[0].scripts).toEqual(
            technical ? { 'test-port': 'Salida cruda de puerto' } : undefined
          )
          expect(network[0].services?.[0].port).toBe(443)
        }
      }
      expect(await versions()).toEqual(before)
    })
    it(`${collection}: ${actor} renames only with effective permission and office scope`, async () => {
      const before = await versions()
      const old = await stored(collection)
      const allowed = ['admin', 'manager', 'visited'].includes(actor)
      const result = await rename(
        collection,
        { display_name: `Nombre ${actor}` },
        actorCookie(actor),
        undefined,
        actor === 'visited' ? `?asOrganization=${f.own.org}` : ''
      )
      expect(result.status).toBe(allowed ? 200 : actor === 'anonymous' ? 401 : 403)
      if (allowed) {
        expect(result.data).toEqual({
          id: records[collection].own,
          display_name: `Nombre ${actor}`,
        })
        expect(immutable(await stored(collection))).toEqual(immutable(old))
      } else expect(await versions()).toEqual(before)
    })
  }
  for (const name of [
    '  Cierre de período  ',
    null,
    '',
    '   ',
    'A'.repeat(80),
    'Revisión Córdoba 2026 - 01',
  ])
    it(`${collection}: accepts and normalizes name ${JSON.stringify(name)}`, async () => {
      const before = await stored(collection)
      const result = await rename(collection, { display_name: name })
      const expected = typeof name === 'string' ? name.trim() || null : null
      expect(result.status).toBe(200)
      expect(result.data).toEqual({ id: records[collection].own, display_name: expected })
      const after = await stored(collection)
      expect(after.display_name).toBe(expected)
      expect(immutable(after)).toEqual(immutable(before))
    })
  for (const body of [
    {},
    { display_name: 'A'.repeat(81) },
    { display_name: 42 },
    { display_name: [] },
    { display_name: 'Nombre <script>' },
    { display_name: 'Nombre\nnuevo' },
  ])
    it(`${collection}: rejects invalid name ${JSON.stringify(body)} without writes`, async () => {
      const before = await versions()
      const result = await rename(collection, body)
      expect(result.status).toBe(400)
      expect(result.data.error).toBe('invalid_body')
      expect(await versions()).toEqual(before)
    })
  it(`${collection}: a name command cannot replace historical content, ownership, dates or risk`, async () => {
    const before = await stored(collection)
    const result = await rename(collection, {
      display_name: 'Nombre permitido',
      office: f.foreign.office,
      organization: f.foreign.org,
      agent: 'injected',
      raw_payload: { private: 'Reemplazar' },
      error: 'Reemplazar',
      assets_dump: { network: [], non_network: [] },
      risk_score: randomUUID(),
      assessment_results_snapshot: { score: 0 },
      generated_by: 'scheduled',
      triggered_by_user: null,
      taken_at: '2000-01-01T00:00:00Z',
      scan_start: '2000-01-01T00:00:00Z',
      hosts_up: 999,
      content_fingerprint: 'new',
    })
    expect(result.status).toBe(200)
    expect(immutable(await stored(collection))).toEqual(immutable(before))
  })
  it(`${collection}: a nonexistent evidence identifier returns 404 without writes`, async () => {
    const before = await versions()
    const result = await rename(collection, { display_name: 'No existe' }, undefined, randomUUID())
    expect(result.status).toBe(404)
    expect(await versions()).toEqual(before)
  })
  it(`${collection}: an administrator cannot read or rename foreign tenant evidence`, async () => {
    const before = await versions()
    expect(
      (await f.api(`/${collection}/${records[collection].foreign}?depth=0`, f.own.adminCookie))
        .status
    ).toBe(404)
    expect(
      (
        await rename(
          collection,
          { display_name: 'Cambio ajeno' },
          undefined,
          records[collection].foreign
        )
      ).status
    ).toBe(403)
    expect(await versions()).toEqual(before)
  })
  it(`${collection}: office manager access does not expand to another office through list filters or IDs`, async () => {
    const before = await versions()
    expect(
      (await f.api(`/${collection}/${records[collection].second}?depth=0`, f.own.managerCookie))
        .status
    ).toBe(404)
    const result = await f.api(
      `/${collection}?depth=0&where[id][equals]=${records[collection].second}`,
      f.own.managerCookie
    )
    expect(result.status).toBe(200)
    expect(result.data.docs).toEqual([])
    expect(
      (
        await rename(
          collection,
          { display_name: 'Cambio fuera de oficina' },
          f.own.managerCookie,
          records[collection].second
        )
      ).status
    ).toBe(403)
    expect(await versions()).toEqual(before)
  })
  for (const method of ['POST', 'PATCH', 'DELETE'])
    it(`${collection}: native REST ${method} cannot mutate historical evidence`, async () => {
      const before = await versions()
      const result = await f.api(
        `/${collection}` + (method === 'POST' ? '' : `/${records[collection].own}`),
        f.own.adminCookie,
        method,
        method === 'DELETE'
          ? undefined
          : { display_name: 'No permitir', raw_payload: { replaced: true }, assets_dump: {} }
      )
      expect(result.status).toBe(403)
      expect(await versions()).toEqual(before)
    })
  it(`${collection}: a storage failure before rename leaves history intact and allows retry`, async () => {
    const before = await versions()
    const original = f.payload.update.bind(f.payload)
    const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
      if (args.collection === collection) throw new Error('Controlled evidence rename failure')
      return (await original(args as never)) as never
    })
    let result
    try {
      result = await rename(collection, { display_name: 'Reintento correcto' })
    } finally {
      spy.mockRestore()
    }
    expect(result.status).toBe(500)
    expect(await versions()).toEqual(before)
    expect((await rename(collection, { display_name: 'Reintento correcto' })).status).toBe(200)
  })
}
for (const collection of collections)
  for (const actor of ['admin', 'manager', 'viewer', 'visited'])
    it(`${collection}: ${actor} list and detail expansions expose no scanner credentials or account sessions`, async () => {
      const cookie = actorCookie(actor),
        suffix = actor === 'visited' ? `&asOrganization=${f.own.org}` : ''
      function keys(value: unknown): string[] {
        if (!value || typeof value !== 'object') return []
        return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
      }
      const before = await versions()
      for (const path of [
        `/${collection}/${records[collection].own}?depth=1${suffix}`,
        `/${collection}?depth=1&where[id][equals]=${records[collection].own}${suffix}`,
      ]) {
        const result = await f.api(path, cookie)
        expect(result.status).toBe(200)
        const fields = new Set(keys(result.data))
        for (const field of ['apiKeyHash', 'apiKey', 'sessions', 'password', 'salt', 'hash'])
          expect(fields.has(field), field).toBe(false)
        const doc = Array.isArray(result.data.docs) ? result.data.docs[0] : result.data
        expect(doc.id).toBe(records[collection].own)
        if (collection === 'scan-reports') expect(relationId(doc.agent)).toBeTruthy()
      }
      expect(await versions()).toEqual(before)
    })

it('viewer reads redact only the response and never alter stored snapshot or report evidence', async () => {
  const before = await versions()
  const snapshot = await stored('inventory-snapshots')
  const report = await stored('scan-reports')
  for (const collection of collections) {
    expect(
      (await f.api(`/${collection}/${records[collection].own}?depth=0`, f.own.viewerCookie)).status
    ).toBe(200)
    expect(
      (await f.api(`/${collection}/${records[collection].own}?depth=0`, f.own.adminCookie)).status
    ).toBe(200)
  }
  expect(await stored('inventory-snapshots')).toEqual(snapshot)
  expect(await stored('scan-reports')).toEqual(report)
  expect(await versions()).toEqual(before)
})
describe('inactive organization history', () => {
  beforeAll(async () => {
    await f.deactivate()
  })
  for (const collection of collections)
    it(`${collection}: a platform visit can read historical evidence but cannot rename it`, async () => {
      const before = await versions()
      const cookie = f.platform,
        suffix = `?asOrganization=${f.own.org}`
      expect(
        (await f.api(`/${collection}/${records[collection].own}${suffix}&depth=0`, cookie)).status
      ).toBe(200)
      const result = await rename(
        collection,
        { display_name: 'Cambio bloqueado' },
        cookie,
        undefined,
        suffix
      )
      expect(result.status).toBe(409)
      expect(result.data.error).toBe('organization_inactive')
      expect(await versions()).toEqual(before)
    })
})
