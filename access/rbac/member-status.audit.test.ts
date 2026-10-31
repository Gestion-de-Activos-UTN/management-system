import { expect, it } from 'vitest'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canChangeMemberStatus, canEditMemberOffices } from './member-status'
import { canDo } from './permissions'

// Seed ranks (scripts/seed-navigation.ts): 1 = highest authority.
const ctx: TenantContext = {
  userId: 'manager',
  role: 'office_manager',
  roleRank: 5,
  organizationId: 'org',
  officeIds: ['a', 'b'],
  selectedOfficeId: 'a',
  isPlatformAdmin: false,
  isActive: true,
}
const viewer = { organizationId: 'org', role: 'org_viewer', rank: 10, officeIds: ['a'] }
const managerTarget = { ...viewer, role: 'office_manager', rank: 5 }
const adminTarget = { ...viewer, role: 'org_admin', rank: 1 }

it('delegates status changes without granting general membership editing', () => {
  expect(canDo('office_manager', 'organization-memberships', 'change_status', 'org')).toBe(true)
  expect(canDo('office_manager', 'organization-memberships', 'update', 'org')).toBe(false)
  expect(canChangeMemberStatus(ctx, viewer)).toBe(true)
  expect(canChangeMemberStatus(ctx, { ...viewer, officeIds: ['a', 'b'] })).toBe(true)
})
it('requires full office coverage and a nonempty assigned scope', () => {
  for (const officeIds of [[], ['c'], ['a', 'c']])
    expect(canChangeMemberStatus(ctx, { ...viewer, officeIds })).toBe(false)
})
it('rejects equal or higher authority, other organizations, inactive actors and viewers', () => {
  expect(canChangeMemberStatus(ctx, managerTarget)).toBe(false)
  expect(canChangeMemberStatus(ctx, adminTarget)).toBe(false)
  expect(canChangeMemberStatus(ctx, { ...viewer, organizationId: 'other' })).toBe(false)
  expect(canChangeMemberStatus({ ...ctx, isActive: false }, viewer)).toBe(false)
  expect(canChangeMemberStatus({ ...ctx, role: 'org_viewer', roleRank: 10 }, viewer)).toBe(false)
})
it('compares rank polarity, not role names, and fails closed on unknown ranks', () => {
  expect(canChangeMemberStatus(ctx, { ...viewer, role: 'future_role', rank: 7 })).toBe(true)
  expect(canChangeMemberStatus(ctx, { ...viewer, role: 'future_role', rank: 3 })).toBe(false)
  for (const rank of [null, undefined, Number.NaN])
    expect(canChangeMemberStatus(ctx, { ...viewer, rank })).toBe(false)
  for (const roleRank of [null, undefined, Number.NaN])
    expect(canChangeMemberStatus({ ...ctx, roleRank }, viewer)).toBe(false)
})
it('preserves organization-wide administration, including OrgAdmin over another OrgAdmin', () => {
  const administrator = { ...ctx, role: 'org_admin' as const, roleRank: 1 }
  expect(canChangeMemberStatus(administrator, { ...managerTarget, officeIds: [] })).toBe(true)
  expect(canChangeMemberStatus(administrator, adminTarget)).toBe(true)
  const visitor = { ...ctx, role: 'platform_admin' as const, roleRank: null, isPlatformAdmin: true }
  expect(canChangeMemberStatus(visitor, adminTarget)).toBe(true)
  expect(canChangeMemberStatus({ ...visitor, organizationId: null }, viewer)).toBe(false)
})

it('allows editing offices only for active lower-rank members fully covered by the Manager', () => {
  expect(canDo('office_manager', 'organization-memberships', 'edit_offices', 'org')).toBe(true)
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: true })).toBe(true)
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: false })).toBe(false)
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: true, officeIds: ['a', 'c'] })).toBe(
    false
  )
  expect(canEditMemberOffices(ctx, { ...managerTarget, isActive: true })).toBe(false)
  expect(
    canEditMemberOffices({ ...ctx, role: 'org_viewer', roleRank: 10 }, { ...viewer, isActive: true })
  ).toBe(false)
})

it('lets organization administrators prepare inactive access while preserving tenant and active-actor checks', () => {
  const administrator = { ...ctx, role: 'org_admin' as const, roleRank: 1 }
  const inactive = { ...managerTarget, isActive: false }
  expect(canEditMemberOffices(administrator, inactive)).toBe(true)
  expect(canEditMemberOffices(administrator, { ...inactive, organizationId: 'other' })).toBe(false)
  expect(canEditMemberOffices({ ...administrator, isActive: false }, inactive)).toBe(false)
})
