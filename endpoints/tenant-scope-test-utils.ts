import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import {
  getPayload,
  handleEndpoints,
  type CollectionSlug,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'

export async function scopeFixture(
  phase:
    | 'manual'
    | 'bulk'
    | 'messages'
    | 'settings'
    | 'profiles'
    | 'crud'
    | 'offices'
    | 'incidents'
    | 'snapshots'
    | 'evidence'
    | 'batches'
    | 'validity'
    | 'receipts'
    | 'operations'
    | 'findings'
) {
  if (
    !new RegExp(
      `^postgresql://siam_audit@127\\.0\\.0\\.1:55443/siam_scope_${phase}_[a-f0-9]+$`
    ).test(process.env.DATABASE_URL ?? '')
  )
    throw new Error(`Use a new disposable siam_scope_${phase}_* database on port 55443`)
  const config: SanitizedConfig = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  const payload: Payload = await getPayload({ config })
  expect(
    (await payload.count({ collection: 'organizations', overrideAccess: true })).totalDocs
  ).toBe(0)
  const password = 'Scope-test-2026!'
  async function api(path: string, cookie = '', method = 'GET', body?: unknown) {
    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost/api${path}`, {
        method,
        headers: {
          origin: 'http://localhost:3001',
          ...(cookie ? { cookie } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    })
    return { status: response.status, data: await response.json(), response }
  }
  async function login(id: string, collection: 'users' | 'admins' = 'users') {
    const account = await payload.findByID({ collection, id, overrideAccess: true })
    const result = await api(`/${collection}/login`, '', 'POST', {
      email: account.email,
      password: collection === 'users' ? 'x'.repeat(12) : password,
    })
    expect(result.status).toBe(200)
    return result.response.headers.get('set-cookie')!.split(';')[0]
  }
  const role = await payload.create({
    collection: 'roles',
    overrideAccess: true,
    data: {
      slug: 'platform_admin',
      name: 'Administrador de plataforma',
      rank: 0,
      scope: 'platform',
      is_platform_role: true,
    },
  })
  const staff = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      name: 'Personal de plataforma',
      role: role.id,
      status: 'active',
      email: 'platform@scope.test',
      password,
    },
  })
  const platform = await login(String(staff.id), 'admins')
  async function tenant(label: string) {
    const seed = await seedRiskOrganization(payload)
    const org = String(seed.organization.id),
      office = String(seed.office.id)
    const second = await payload.create({
      collection: 'offices',
      overrideAccess: true,
      data: { organization: org, name: `${label} segunda oficina` },
    })
    const admin = await member(payload, org, [office, String(second.id)], 'org_admin')
    const manager = await member(payload, org, [office], 'office_manager')
    const viewer = await member(payload, org, [office], 'org_viewer')
    const outside = await member(payload, org, [String(second.id)], 'org_viewer')
    return {
      org,
      office,
      second: String(second.id),
      name: seed.organization.name,
      admin,
      manager,
      viewer,
      outside,
      label,
      adminCookie: await login(admin),
      managerCookie: await login(manager),
      viewerCookie: await login(viewer),
      outsideCookie: await login(outside),
    }
  }
  const own = await tenant('Propio'),
    foreign = await tenant('Ajeno')
  const tracked = [
    'organizations',
    'organization-settings',
    'subscriptions',
    'offices',
    'users',
    'admins',
    'organization-memberships',
    'agents',
    'assets',
    'non-network-assets',
    'tasks',
    'assessment-instances',
    'assessment-answers',
    'compliance-results',
    'risk-evaluations',
    'inventory-snapshots',
    'portal-messages',
    'portal-message-receipts',
    'payload-jobs',
  ] as const satisfies readonly CollectionSlug[]
  async function versions(
    additional: Array<'inventory-incidents' | 'risk-contributions' | 'scan-reports'> = []
  ) {
    return Object.fromEntries(
      await Promise.all(
        [...new Set([...tracked, ...additional])].map(async collection => {
          const result = await payload.find({
            collection,
            overrideAccess: true,
            depth: 0,
            pagination: false,
          })
          return [
            collection,
            result.docs
              .map(d => ({ id: String(d.id), updatedAt: d.updatedAt }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          ]
        })
      )
    )
  }
  function manualInput(tenant: typeof own, extra: Record<string, unknown> = {}) {
    return {
      alias: `Equipo ${randomUUID()}`,
      asset_category: 'computer',
      office: tenant.office,
      owner: tenant.viewer,
      criticality: 'medium',
      review_interval: 'never',
      ...extra,
    }
  }
  async function createManual(tenant = own, extra: Record<string, unknown> = {}) {
    const result = await api(
      '/non-network-assets',
      tenant.adminCookie,
      'POST',
      manualInput(tenant, extra)
    )
    expect(result.status, result.data.errors?.[0]?.message).toBe(201)
    return result.data.doc
  }
  async function deactivate(tenant = own) {
    const result = await api(
      `/v1/platform-admin/organizations/${tenant.org}/status`,
      platform,
      'POST',
      {
        is_active: false,
        confirm_name: tenant.name,
      }
    )
    expect(result.status).toBe(200)
  }
  return {
    payload,
    api,
    login,
    own,
    foreign,
    platform,
    versions,
    manualInput,
    createManual,
    deactivate,
  }
}
export type ScopeFixture = Awaited<ReturnType<typeof scopeFixture>>
