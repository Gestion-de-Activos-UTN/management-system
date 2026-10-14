import { expect, it } from 'vitest'
import { actorMatches, actorRelation } from './actor-relation'
import { relationId } from './relationId'
import { canDo } from '@/access/rbac/permissions'
import { resolveTenantContext, type TenantResolverDeps } from '@/access/tenant/resolveTenantContext'

it('keeps users and platform administrators distinct even when UUIDs coincide', () => {
  const req = { user: { id: 'same', collection: 'admins' } } as never
  const actor = actorRelation(req, 'same')
  expect(actor).toEqual({ relationTo: 'admins', value: 'same' })
  expect(relationId(actor)).toBe('same')
  expect(actorMatches(actor, { userId: 'same', isPlatformAdmin: true })).toBe(true)
  expect(actorMatches(actor, { userId: 'same', isPlatformAdmin: false })).toBe(false)
})

it('gives selected platform administrators the organization role while retaining actor identity', async () => {
  const deps = {
    findActiveMembershipByUserId: async () => null,
    findActiveAdminById: async () => ({ isActive: true }),
    organizationExists: async () => true,
    findOfficeIdsByOrganization: async () => ['office'],
  } as TenantResolverDeps
  const ctx = await resolveTenantContext({ collection: 'admins', externalId: 'admin' }, deps, 'org')
  expect(ctx).toMatchObject({
    role: 'org_admin',
    isPlatformAdmin: true,
    organizationId: 'org',
    officeIds: ['office'],
  })
  for (const action of ['create', 'claim', 'edit', 'complete', 'delete'] as const)
    expect(canDo('platform_admin', 'tasks', action, 'org')).toBe(
      canDo('org_admin', 'tasks', action, 'org')
    )
  expect(canDo('platform_admin', 'tasks', 'create', null)).toBe(false)
})
