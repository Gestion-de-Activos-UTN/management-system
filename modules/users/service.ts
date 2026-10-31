import { httpClient } from '@/lib/http-client'
import type { RoleSlug } from '@/access/rbac/permissions'
import { roleSlugLabel } from '@/lib/role-labels'
import type { MyProfile } from '@/endpoints/myProfile'
import type { MemberCreate, MemberUpdate, UserCredentials } from './schema'

export type OrgMember = {
  id: string
  name: string
  /** Only for people who manage members (endpoints/orgMembers.ts). */
  email?: string
  role: RoleSlug
  office_ids: string[]
  status: 'onboarding' | 'active'
  is_active: boolean
  can_change_status?: boolean
  can_edit_offices?: boolean
}

export function memberCoversOffice(member: OrgMember, officeId: string): boolean {
  return (
    member.role === 'org_admin' ||
    member.role === 'platform_admin' ||
    member.office_ids.includes(officeId)
  )
}

// Formato único para identificar a una persona en cualquier selector: nombre · rol · email
// (el email sólo cuando el servidor lo envía).
export function orgMemberOptionLabel(
  member: Pick<OrgMember, 'name' | 'email'> & { role: string }
): string {
  return [member.name || member.email, roleSlugLabel(member.role), member.name && member.email]
    .filter(Boolean)
    .join(' · ')
}

// Deliberadamente NO usa /api/users (Users.read es () => false hoy, ver el ponytail: en
// app/portal/(protected)/admin/users/page.tsx) — endpoints/orgMembers.ts expone solo lo mínimo
// que un selector de owner necesita, sin reabrir esa colección. `asOrganization` se reenvía
// igual que en modules/offices/service.ts: el servidor solo lee ese query param de ESTA
// request, no de la URL del browser — sin reenviarlo, un platform_admin "visitando" una
// organización (?asOrganization=) vería la lista vacía.
export function listOrgMembers(params?: { asOrganization?: string; includeInactive?: boolean }) {
  return httpClient
    .get<{ docs: OrgMember[] }>('/api/v1/org-members', {
      asOrganization: params?.asOrganization,
      include_inactive: params?.includeInactive ? '1' : undefined,
    })
    .then(r => r.docs)
}

export function updateOrgMember(userId: string, input: MemberUpdate, asOrganization?: string) {
  return httpClient.patch<{ ok: boolean }>(`/api/v1/org-members/${userId}`, input, {
    asOrganization,
  })
}

export function createOrgMember(input: MemberCreate, asOrganization?: string) {
  return httpClient.post<{ id: string; name: string; email: string; role: RoleSlug }>(
    '/api/v1/org-members',
    input,
    { asOrganization }
  )
}

export function createPlatformOrgAdmin(organizationId: string, input: UserCredentials) {
  return httpClient.post<{ id: string; name: string; email: string; role: 'org_admin' }>(
    `/api/v1/platform-admin/organizations/${organizationId}/org-admins`,
    input
  )
}

/** Lo que pasa al desactivar a una persona (endpoints/orgMembers.ts). */
export type MemberDeactivationImpact = {
  owned_assets: Array<{
    id: string
    collection: 'assets' | 'non-network-assets'
    name: string
    office_id: string
    office_name: string
    office_active: boolean
  }>
  in_progress_tasks: number
  assigned_tasks: number
}

export function getMemberDeactivationImpact(userId: string, asOrganization?: string) {
  return httpClient.get<MemberDeactivationImpact>(
    `/api/v1/org-members/${userId}/deactivation-impact`,
    { asOrganization }
  )
}

export function getMyProfile() {
  return httpClient.get<MyProfile>('/api/v1/me/profile')
}

export function updateMyProfile(name: string) {
  return httpClient.patch<MyProfile>('/api/v1/me/profile', { name })
}
