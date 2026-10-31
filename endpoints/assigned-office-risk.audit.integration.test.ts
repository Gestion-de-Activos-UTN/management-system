import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getPayload, handleEndpoints, type Payload, type SanitizedConfig } from 'payload'
import { member, manualResult, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { calculateRiskForScope, recalculateRisk } from '@/domain/risk/recalculateRisk'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'

let payload: Payload, config: SanitizedConfig
let org: string, a: string, b: string, outside: string, foreignOffice: string
let adminCookie: string,
  managerCookie: string,
  viewerCookie: string,
  hiddenCookie: string,
  manager: string
let assetA: string, assetB: string, outsideAsset: string
let evaluation: string
const endpoint = '/api/v1/risk/latest'
const summary = '/api/v1/security-review/summary'
async function api(path: string, cookie = managerCookie, method = 'GET', body?: unknown) {
  const response = await handleEndpoints({
    config,
    request: new Request('http://localhost' + path, {
      method,
      headers: {
        origin: 'http://localhost:3001',
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  })
  return { status: response.status, body: await response.json(), response }
}
async function login(id: string) {
  const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
  const response = await api('/api/users/login', '', 'POST', {
    email: user.email,
    password: 'x'.repeat(12),
  })
  expect(response.status).toBe(200)
  return response.response.headers.get('set-cookie')!.split(';')[0]
}
async function asset(
  office: string,
  alias: string,
  criticality: 'low' | 'critical',
  efficacy: number
) {
  const doc = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias,
      asset_category: 'computer',
      review_interval: 'never',
      criticality,
      office,
      organization: org,
      owner: manager,
    },
  })
  const keys = new Set(
    RISK_QUESTIONS_V2.filter(q => q.policies.includes('essential')).map(q => q.control_key)
  )
  for (const key of keys)
    await payload.create({
      collection: 'compliance-results',
      overrideAccess: true,
      data: {
        ...manualResult(
          { organizationId: org, officeId: office, assetId: '' },
          key,
          efficacy,
          new Date(Date.now() + 86400000).toISOString()
        ),
        asset: null,
        manual_asset: doc.id,
      },
    })
  return String(doc.id)
}
beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_test@127\.0\.0\.1:55447\/siam_risk_scope_checks(?:_[a-z0-9]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use the disposable siam_risk_scope_checks database only')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  const seed = await seedRiskOrganization(payload)
  org = String(seed.organization.id)
  a = String(seed.office.id)
  await payload.update({
    collection: 'assets',
    id: seed.server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { status: 'retired' },
  })
  async function office(name: string) {
    return String(
      (
        await payload.create({
          collection: 'offices',
          overrideAccess: true,
          data: { name, organization: org },
        })
      ).id
    )
  }
  b = await office('Branch B')
  outside = await office('Outside scope')
  const admin = await member(payload, org, [a, b, outside], 'org_admin')
  manager = await member(payload, org, [a, b], 'office_manager')
  const viewer = await member(payload, org, [a, b], 'org_viewer')
  assetA = await asset(a, 'Allowed low', 'low', 1)
  assetB = await asset(b, 'Allowed critical', 'critical', 0)
  // Create the outside asset with a valid owner; it must never enter the Manager result.
  const hidden = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Never expose outside',
      asset_category: 'computer',
      review_interval: 'never',
      criticality: 'critical',
      office: outside,
      organization: org,
      owner: admin,
    },
  })
  outsideAsset = String(hidden.id)
  const other = await seedRiskOrganization(payload)
  foreignOffice = String(other.office.id)
  await payload.update({
    collection: 'assets',
    id: other.server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { identified: false, identification_status: 'pending' },
  })
  evaluation = String((await recalculateRisk(payload, { organizationId: org })).id)
  await recalculateRisk(payload, { organizationId: org, officeId: a })
  const hiddenManager = await member(
    payload,
    String(other.organization.id),
    [foreignOffice],
    'office_manager'
  )
  adminCookie = await login(admin)
  managerCookie = await login(manager)
  viewerCookie = await login(viewer)
  hiddenCookie = await login(hiddenManager)
}, 60000)
afterAll(async () => {
  if (payload) await payload.destroy()
})

it('consolidates the exact assigned set with the engine, not an arithmetic mean, and writes no evaluations', async () => {
  const before = await payload.count({ collection: 'risk-evaluations', overrideAccess: true })
  const response = await api(endpoint)
  expect(response.status).toBe(200)
  expect(response.body.scope).toBe('assigned_offices')
  expect(response.body.evaluation.id).toBeNull()
  const first = await calculateRiskForScope(payload, { organizationId: org, officeId: a })
  const second = await calculateRiskForScope(payload, { organizationId: org, officeId: b })
  const combined = await calculateRiskForScope(payload, { organizationId: org, officeIds: [a, b] })
  expect(response.body.evaluation.score).toBeCloseTo(combined.result.score!, 8)
  expect(response.body.evaluation.score).not.toBeCloseTo(
    (first.result.score! + second.result.score!) / 2,
    4
  )
  const all = await api(endpoint + '?limit=50')
  expect(all.status).toBe(200)
  expect(new Set(all.body.contributions.map((r: { asset_key: string }) => r.asset_key))).toEqual(
    new Set([`manual:${assetA}`, `manual:${assetB}`])
  )
  expect(JSON.stringify(all.body)).not.toContain(outsideAsset)
  expect(JSON.stringify(all.body)).not.toContain('Never expose outside')
  expect(
    (await payload.count({ collection: 'risk-evaluations', overrideAccess: true })).totalDocs
  ).toBe(before.totalDocs)
})
it('returns the same score, coverage and counts on dashboard summary and risk detail', async () => {
  const detail = await api(endpoint),
    short = await api(summary)
  expect(short.status).toBe(200)
  expect(short.body.scope).toBe('assigned_offices')
  expect(short.body.risk_score).toBe(detail.body.evaluation.score)
  expect(short.body.evaluated_percentage).toBe(detail.body.evaluation.coverage)
  expect(short.body.requires_attention).toBe(
    detail.body.evaluation.counts.non_compliant + detail.body.evaluation.counts.partially_effective
  )
})
it('ignores forged office sets and rejects concrete foreign offices and organization history', async () => {
  for (const office of [outside, foreignOffice]) {
    expect((await api(endpoint + '?office_id=' + office)).status).toBe(403)
    expect((await api(summary + '?office_id=' + office)).status).toBe(403)
  }
  const forged = await api(endpoint + '?office_ids=' + outside + ',' + foreignOffice)
  expect(forged.status).toBe(200)
  expect(JSON.stringify(forged.body)).not.toContain(outsideAsset)
  expect((await api(endpoint + '?evaluation_id=' + evaluation)).status).toBe(403)
})
it('keeps OrgAdmin on persisted global scope and Viewer restricted to concrete office', async () => {
  const admin = await api(endpoint, adminCookie)
  expect(admin.status).toBe(200)
  expect(admin.body.scope).toBe('organization')
  expect(admin.body.evaluation.id).toBe(evaluation)
  expect((await api(summary, adminCookie)).body.scope).toBe('organization')
  expect((await api(endpoint, viewerCookie)).status).toBe(403)
  expect((await api(summary, viewerCookie)).status).toBe(403)
  expect((await api(endpoint + '?office_id=' + a, viewerCookie)).status).toBe(200)
  const session = await api('/api/v1/session')
  expect(session.body.permissions.assignedOfficeRisk).toBe(true)
})
it('rejects unauthenticated calls and validates pagination before computing', async () => {
  expect((await api(endpoint, '')).status).toBe(401)
  expect((await api(summary, '')).status).toBe(401)
  expect((await api(endpoint + '?page=0')).status).toBe(400)
  const ascending = await api(endpoint + '?sort=asset&direction=asc&limit=50')
  const descending = await api(endpoint + '?sort=asset&direction=desc&limit=50')
  expect(ascending.status).toBe(200)
  expect(descending.status).toBe(200)
  expect(ascending.body.pagination.totalDocs).toBe(descending.body.pagination.totalDocs)
  expect(ascending.body.contributions[0].asset_label).toBe('Allowed critical')
  expect(descending.body.contributions[0].asset_label).toBe('Allowed low')
})
it('rechecks the current membership and excludes inactive offices rather than broadening the scope', async () => {
  const row = (
    await payload.find({
      collection: 'organization-memberships',
      where: { user: { equals: manager } },
      overrideAccess: true,
      limit: 1,
    })
  ).docs[0]
  await payload.update({
    collection: 'organization-memberships',
    id: row.id,
    overrideAccess: true,
    data: { offices: [a] },
  })
  try {
    const response = await api(endpoint)
    expect(response.status).toBe(200)
    expect(
      response.body.contributions.every(
        (r: { asset_key: string }) => r.asset_key === `manual:${assetA}`
      )
    ).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain(assetB)
    await payload.update({
      collection: 'offices',
      id: outside,
      overrideAccess: true,
      data: { is_active: false },
    })
    const inactive = await calculateRiskForScope(payload, {
      organizationId: org,
      officeIds: [outside],
    })
    expect(inactive.result.contributions).toEqual([])
    const empty = await calculateRiskForScope(payload, { organizationId: org, officeIds: [] })
    expect(empty.result.contributions).toEqual([])
    const foreign = await calculateRiskForScope(payload, {
      organizationId: org,
      officeIds: [foreignOffice],
    })
    expect(foreign.result.contributions).toEqual([])
  } finally {
    await payload.update({
      collection: 'organization-memberships',
      id: row.id,
      overrideAccess: true,
      data: { offices: [a, b] },
    })
  }
})

it('enforces the risk feature on both assigned-office endpoints', async () => {
  const subscription = (
    await payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: org } },
      overrideAccess: true,
      limit: 1,
    })
  ).docs[0]
  const original = subscription.features as Record<string, boolean>
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    overrideAccess: true,
    data: { features: { ...original, risk_score: false } },
  })
  try {
    expect((await api(endpoint)).status).toBe(403)
    expect((await api(summary)).status).toBe(403)
  } finally {
    await payload.update({
      collection: 'subscriptions',
      id: subscription.id,
      overrideAccess: true,
      data: { features: original },
    })
  }
})

it('keeps hidden scores and bands private in the live consolidation too', async () => {
  const response = await api(endpoint, hiddenCookie)
  expect(response.status).toBe(200)
  expect(response.body.evaluation.confidence).toBe('hidden')
  expect(response.body.evaluation.score).toBeNull()
  expect(response.body.evaluation.base_band).toBeNull()
  expect(response.body.evaluation.final_band).toBeNull()
  expect(response.body.evaluation.controls).toEqual([])
  expect(response.body.evaluation.top_assets).toEqual([])
  expect(
    response.body.contributions.every(
      (row: { inherent_risk: unknown; residual_risk: unknown }) =>
        row.inherent_risk === null && row.residual_risk === null
    )
  ).toBe(true)
  const short = await api(summary, hiddenCookie)
  expect(short.body.risk_score).toBeNull()
  expect(short.body.risk_band).toBeNull()
})

it('reuses the consolidation across pages until the organization evidence signal changes', async () => {
  await recalculateRisk(payload, { organizationId: org })
  const before = (await api(endpoint + '?limit=10')).body.pagination.totalDocs
  // Jobs are disabled here, so new evidence does not move the signal by itself.
  const extra = await asset(a, 'Cache probe', 'low', 1)
  try {
    expect((await api(endpoint + '?limit=10&page=2')).body.pagination.totalDocs).toBe(before)
    await recalculateRisk(payload, { organizationId: org })
    expect((await api(endpoint + '?limit=10')).body.pagination.totalDocs).toBeGreaterThan(before)
  } finally {
    await payload.update({
      collection: 'non-network-assets',
      id: extra,
      overrideAccess: true,
      data: { status: 'retired' },
    })
    await recalculateRisk(payload, { organizationId: org })
  }
})

it('shows the organization recalculation state to the Manager as it does to OrgAdmin', async () => {
  const job = await payload.jobs.queue({
    task: 'recalculate-risk',
    queue: 'risk',
    input: { organization_id: org },
  })
  try {
    expect((await api(endpoint)).body.recalculation).toBe('pending')
    expect((await api(summary)).body.recalculation).toBe('pending')
    expect((await api(summary, adminCookie)).body.recalculation).toBe('pending')
  } finally {
    await payload.delete({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
  }
  expect((await api(summary)).body.recalculation).toBe('current')
})

it('answers a failed live calculation with risk_unavailable, without internals, and keeps no failure', async () => {
  await recalculateRisk(payload, { organizationId: org })
  const find = payload.find.bind(payload)
  const spy = vi
    .spyOn(payload, 'find')
    .mockImplementation(((args: { collection: string }) =>
      args.collection === 'compliance-results'
        ? Promise.reject(new Error('internal detail 42'))
        : find(args as Parameters<typeof find>[0])) as typeof payload.find)
  try {
    for (const path of [endpoint, summary]) {
      const failed = await api(path)
      expect(failed.status).toBe(503)
      expect(failed.body).toEqual({ error: 'risk_unavailable' })
      expect(JSON.stringify(failed.body)).not.toContain('internal detail')
    }
  } finally {
    spy.mockRestore()
  }
  expect((await api(summary)).status).toBe(200)
})
