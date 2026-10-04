import type { RoleSlug } from '@/access/rbac/permissions'

export const ROLE_LABELS: Record<RoleSlug, string> = {
  platform_admin: 'Administrador de plataforma',
  org_admin: 'Administrador de la organización',
  org_viewer: 'Observador de la organización',
  office_manager: 'Responsable de oficina',
}

export function roleSlugLabel(role: string): string {
  return ROLE_LABELS[role as RoleSlug] ?? role
}
