import { httpClient } from '@/lib/http-client';

export type OrgMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'onboarding' | 'active';
};

// Deliberadamente NO usa /api/users (Users.read es () => false hoy, ver el ponytail: en
// app/portal/(protected)/admin/users/page.tsx) — endpoints/orgMembers.ts expone solo lo mínimo
// que un selector de owner necesita, sin reabrir esa colección. `asOrganization` se reenvía
// igual que en modules/offices/service.ts: el servidor solo lee ese query param de ESTA
// request, no de la URL del browser — sin reenviarlo, un platform_admin "visitando" una
// organización (?asOrganization=) vería la lista vacía.
export function listOrgMembers(params?: { asOrganization?: string }) {
  return httpClient
    .get<{ docs: OrgMember[] }>('/api/v1/org-members', { asOrganization: params?.asOrganization })
    .then((r) => r.docs);
}
