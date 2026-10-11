import { httpClient } from '@/lib/http-client'
import type { RoleSlug } from '@/access/rbac/permissions'
import { roleSlugLabel } from '@/lib/role-labels'

export type OrgMember = {
  id: string
  name: string
  email: string
  role: RoleSlug
  office_ids: string[]
  status: 'onboarding' | 'active'
}

export function memberCoversOffice(member: OrgMember, officeId: string): boolean {
  return (
    member.role === 'org_admin' ||
    member.role === 'platform_admin' ||
    member.office_ids.includes(officeId)
  )
}

// Formato único para identificar a una persona en cualquier selector: nombre · rol · email.
export function orgMemberOptionLabel(
  member: Pick<OrgMember, 'name' | 'email'> & { role: string }
): string {
  return `${member.name || member.email} · ${roleSlugLabel(member.role)}${member.name ? ` · ${member.email}` : ''}`
}

// Deliberadamente NO usa /api/users (Users.read es () => false hoy, ver el ponytail: en
// app/portal/(protected)/admin/users/page.tsx) — endpoints/orgMembers.ts expone solo lo mínimo
// que un selector de owner necesita, sin reabrir esa colección. `asOrganization` se reenvía
// igual que en modules/offices/service.ts: el servidor solo lee ese query param de ESTA
// request, no de la URL del browser — sin reenviarlo, un platform_admin "visitando" una
// organización (?asOrganization=) vería la lista vacía.
export function listOrgMembers(params?: { asOrganization?: string }) {
  return httpClient
    .get<{ docs: OrgMember[] }>('/api/v1/org-members', { asOrganization: params?.asOrganization })
    .then(r => r.docs)
}
