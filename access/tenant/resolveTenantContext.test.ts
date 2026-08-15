import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTenantContext, TenantResolutionError, type TenantResolverDeps } from './resolveTenantContext'

function makeDeps(overrides: Partial<TenantResolverDeps> = {}): TenantResolverDeps {
  return {
    findActiveAdminById: async () => null,
    findActiveMembershipByUserId: async () => null,
    organizationExists: async () => false,
    findOfficeIdsByOrganization: async () => [],
    ...overrides,
  }
}

test('sin identidad -> null (fail-closed)', async () => {
  const ctx = await resolveTenantContext(null, makeDeps())
  assert.equal(ctx, null)
})

test('admin sin match -> null', async () => {
  const ctx = await resolveTenantContext({ externalId: 'a1', collection: 'admins' }, makeDeps())
  assert.equal(ctx, null)
})

test('admin válido sin asOrganization -> organizationId null, ve todo', async () => {
  const deps = makeDeps({ findActiveAdminById: async () => ({ isActive: true }) })
  const ctx = await resolveTenantContext({ externalId: 'a1', collection: 'admins' }, deps)
  assert.deepEqual(ctx, {
    userId: 'a1', role: 'platform_admin', organizationId: null,
    officeIds: [], selectedOfficeId: null, isPlatformAdmin: true, isActive: true,
  })
})

test('admin con asOrganization válido -> organizationId seteado', async () => {
  const deps = makeDeps({
    findActiveAdminById: async () => ({ isActive: true }),
    organizationExists: async () => true,
  })
  const ctx = await resolveTenantContext({ externalId: 'a1', collection: 'admins' }, deps, 'org-1')
  assert.equal(ctx?.organizationId, 'org-1')
})

test('admin visitando una organización -> officeIds poblados desde esa organización (como un org_admin)', async () => {
  const deps = makeDeps({
    findActiveAdminById: async () => ({ isActive: true }),
    organizationExists: async () => true,
    findOfficeIdsByOrganization: async (organizationId) => {
      assert.equal(organizationId, 'org-1')
      return ['office-1', 'office-2']
    },
  })
  const ctx = await resolveTenantContext({ externalId: 'a1', collection: 'admins' }, deps, 'org-1')
  assert.deepEqual(ctx?.officeIds, ['office-1', 'office-2'])
  assert.equal(ctx?.selectedOfficeId, 'office-1')
})

test('admin con asOrganization inexistente -> throw', async () => {
  const deps = makeDeps({
    findActiveAdminById: async () => ({ isActive: true }),
    organizationExists: async () => false,
  })
  await assert.rejects(
    resolveTenantContext({ externalId: 'a1', collection: 'admins' }, deps, 'org-inexistente'),
    TenantResolutionError,
  )
})

test('user sin membership activa -> null (incluye membership recién desactivada)', async () => {
  const ctx = await resolveTenantContext({ externalId: 'u1', collection: 'users' }, makeDeps())
  assert.equal(ctx, null)
})

test('user con membership activa -> contexto completo', async () => {
  const deps = makeDeps({
    findActiveMembershipByUserId: async () => ({
      organization: 'org-1',
      offices: ['office-1', 'office-2'],
      role: { slug: 'org_viewer', rank: 10 },
      is_active: true,
    }),
  })
  const ctx = await resolveTenantContext({ externalId: 'u1', collection: 'users' }, deps)
  assert.deepEqual(ctx, {
    userId: 'u1', role: 'org_viewer', organizationId: 'org-1',
    officeIds: ['office-1', 'office-2'], selectedOfficeId: 'office-1',
    isPlatformAdmin: false, isActive: true,
  })
})

test('asOrganization mandado por un Users se ignora (no escala)', async () => {
  const deps = makeDeps({
    findActiveMembershipByUserId: async () => ({
      organization: 'org-1', offices: [], role: { slug: 'org_viewer', rank: 10 }, is_active: true,
    }),
    organizationExists: async () => true,
  })
  const ctx = await resolveTenantContext({ externalId: 'u1', collection: 'users' }, deps, 'org-otra')
  assert.equal(ctx?.organizationId, 'org-1') // no 'org-otra'
})
