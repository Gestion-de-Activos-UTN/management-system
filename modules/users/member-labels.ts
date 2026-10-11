import type { StatusTone } from '@/components/ui/StatusBadge'
import type { OrgMember } from './service'
import type { OrganizationRoleSlug } from './schema'

export const ROLE_DESCRIPTIONS: Record<OrganizationRoleSlug | 'platform_admin', string> = {
  platform_admin:
    'Administra todas las organizaciones, sus suscripciones y los mensajes del portal.',
  org_admin: 'Administra toda la organización: usuarios, oficinas y configuración.',
  office_manager: 'Gestiona el inventario y las tareas de sus oficinas.',
  org_viewer: 'Consulta la información de sus oficinas y completa tareas.',
}

/** Para los contadores de uso del plan: "1 de 1 administradores". */
export const ROLE_PLURAL_LABELS: Record<OrganizationRoleSlug, string> = {
  org_admin: 'administradores',
  office_manager: 'responsables de oficina',
  org_viewer: 'observadores',
}

export type MemberStatus = 'active' | 'onboarding' | 'inactive'
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Activo',
  onboarding: 'Incorporación',
  inactive: 'Inactivo',
}
export const MEMBER_STATUS_TONES: Record<MemberStatus, StatusTone> = {
  active: 'success',
  onboarding: 'warning',
  inactive: 'danger',
}

export function memberStatus(member: Pick<OrgMember, 'is_active' | 'status'>): MemberStatus {
  if (!member.is_active) return 'inactive'
  return member.status === 'onboarding' ? 'onboarding' : 'active'
}
