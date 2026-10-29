import { expect, it } from 'vitest'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canChangeMemberStatus, canEditMemberOffices } from './member-status'
import { canDo } from './permissions'

const ctx: TenantContext = {
  userId: 'manager',
  role: 'office_manager',
  organizationId: 'org',
  officeIds: ['a', 'b'],
  selectedOfficeId: 'a',
  isPlatformAdmin: false,
  isActive: true,
}
const viewer = { organizationId: 'org', role: 'org_viewer', officeIds: ['a'] }

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
it('rejects other roles, other organizations, inactive actors and viewers', () => {
  for (const role of ['office_manager', 'org_admin'])
    expect(canChangeMemberStatus(ctx, { ...viewer, role })).toBe(false)
  expect(canChangeMemberStatus(ctx, { ...viewer, organizationId: 'other' })).toBe(false)
  expect(canChangeMemberStatus({ ...ctx, isActive: false }, viewer)).toBe(false)
  expect(canChangeMemberStatus({ ...ctx, role: 'org_viewer' }, viewer)).toBe(false)
})
it('preserves administration within an explicit organization only', () => {
  expect(
    canChangeMemberStatus(
      { ...ctx, role: 'org_admin' },
      { ...viewer, role: 'office_manager', officeIds: [] }
    )
  ).toBe(true)
  expect(
    canChangeMemberStatus(
      { ...ctx, role: 'platform_admin', organizationId: null, isPlatformAdmin: true },
      viewer
    )
  ).toBe(false)
})

it('allows editing offices only for active Viewers fully covered by the Manager', () => {
  expect(canDo('office_manager', 'organization-memberships', 'edit_offices', 'org')).toBe(true)
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: true })).toBe(true)
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: false })).toBe(false)
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: true, officeIds: ['a', 'c'] })).toBe(
    false
  )
  expect(canEditMemberOffices(ctx, { ...viewer, isActive: true, role: 'office_manager' })).toBe(
    false
  )
  expect(canEditMemberOffices({ ...ctx, role: 'org_viewer' }, { ...viewer, isActive: true })).toBe(
    false
  )
})

it('lets organization administrators prepare inactive access while preserving tenant and active-actor checks', () => {
  const administrator = { ...ctx, role: 'org_admin' as const }
  const inactive = { ...viewer, role: 'office_manager', isActive: false }
  expect(canEditMemberOffices(administrator, inactive)).toBe(true)
  expect(canEditMemberOffices(administrator, { ...inactive, organizationId: 'other' })).toBe(false)
  expect(canEditMemberOffices({ ...administrator, isActive: false }, inactive)).toBe(false)
})
