export type RoleSlug = 'platform_admin' | 'org_admin' | 'org_viewer' | 'office_manager'
export type CollectionSlug =
  | 'organizations'
  | 'offices'
  | 'agents'
  | 'assets'
  | 'non-network-assets'
  | 'scan-reports'
  | 'roles'
  | 'job-runs'
  | 'inventory-snapshots'
  | 'assessment-instances'
  | 'assessment-answers'
  | 'compliance-results'
  | 'risk-evaluations'
  | 'risk-contributions'
  | 'tasks'
  | 'organization-memberships'
export type Action =
  | 'read_technical'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'edit'
  | 'claim'
  | 'release'
  | 'assign'
  | 'reassign'
  | 'complete'
  | 'cancel'
  | 'archive'
  | 'change_status'
  | 'edit_offices'
  // Live consolidation of the actor's assigned offices (risk-evaluations).
  | 'read_assigned'

// Matriz estática — decisión explícita (documentation/01-erd-core.md nota 9): el sistema no
// tiene hoy suficientes funcionalidades como para justificar overrides dinámicos por
// organización guardados en DB. Cero lectura a base para decidir un permiso.
//
// Cierre del módulo de Inventario: 'assets' gana 'update' para org_admin/office_manager (edición
// de campos de negocio — los técnicos siguen bloqueados por technicalFieldAccess a nivel de
// campo, ver collections/Assets/index.ts). 'create'/'delete' de 'assets' quedan fuera de la
// matriz a propósito: un Asset nunca se crea/borra a mano (solo la ingesta, con overrideAccess).
const MATRIX: Record<RoleSlug, Partial<Record<CollectionSlug, Action[]>>> = {
  platform_admin: {
    organizations: ['read'],
    offices: ['read'],
    agents: ['create', 'read', 'update'],
    assets: ['read'],
    'non-network-assets': ['read'],
    'scan-reports': ['read', 'read_technical'],
    roles: ['read'],
    'job-runs': ['read'],
    'inventory-snapshots': ['create', 'read'],
    'assessment-instances': ['read'],
    'assessment-answers': ['read'],

    'compliance-results': ['read'],
    'risk-evaluations': ['read'],
    'risk-contributions': ['read'],
    tasks: ['read'],
  },
  org_admin: {
    organizations: ['read'],
    // Administración general de oficinas y miembros. El Manager sólo recibe el flujo delegado
    // de alta/estado de Viewers; las colecciones siguen cerradas al CRUD directo.
    offices: ['create', 'read', 'update'],
    'organization-memberships': ['create', 'read', 'update', 'change_status', 'edit_offices'],
    agents: ['create', 'read', 'update'],
    assets: ['read', 'update', 'delete'],
    'non-network-assets': ['create', 'read', 'update', 'delete'],
    // 'update' = sólo renombrar (display_name) vía endpoints/evidenceNames.ts; la evidencia en sí
    // sigue inmutable (las colecciones mantienen update: () => false).
    'scan-reports': ['read', 'read_technical', 'update'],
    'inventory-snapshots': ['create', 'read', 'update'],
    'assessment-instances': ['read'],
    'assessment-answers': ['read'],

    'compliance-results': ['read'],
    'risk-evaluations': ['read'],
    'risk-contributions': ['read'],
    tasks: [
      'create',
      'read',
      'edit',
      'claim',
      'release',
      'assign',
      'reassign',
      'complete',
      'cancel',
      'archive',
      'delete',
    ],
  },
  org_viewer: {
    organizations: ['read'],
    offices: ['read'],
    assets: ['read'],
    'non-network-assets': ['read'],
    'scan-reports': ['read'],
    'inventory-snapshots': ['read'],
    'assessment-instances': ['read'],
    'assessment-answers': ['read'],

    'compliance-results': ['read'],
    'risk-evaluations': ['read'],
    'risk-contributions': ['read'],
    tasks: ['read', 'claim', 'release', 'complete'],
  },
  office_manager: {
    organizations: ['read'],
    offices: ['read'],
    // Status changes are limited to Viewers fully covered by the actor's offices in the domain.
    'organization-memberships': ['create', 'change_status', 'edit_offices'],
    assets: ['read', 'update'],
    'non-network-assets': ['create', 'read', 'update'],
    // 'update' = sólo renombrar, en sus oficinas (ver org_admin).
    'scan-reports': ['read', 'read_technical', 'update'],
    'inventory-snapshots': ['read', 'update'],
    'assessment-instances': ['read'],
    'assessment-answers': ['read'],

    'compliance-results': ['read'],
    'risk-evaluations': ['read', 'read_assigned'],
    'risk-contributions': ['read'],
    tasks: [
      'create',
      'read',
      'edit',
      'claim',
      'release',
      'assign',
      'reassign',
      'complete',
      'cancel',
      'archive',
      'delete',
    ],
  },
}

// _organizationId: reservado, no participa de la decisión hoy — la matriz estática no tiene
// overrides por organización. Se mantiene en la firma por fidelidad a documentation/02 y
// documentation/03 (canDo(role, Collection, Action, organizationId)); el día que exista un
// override real, entra acá sin romper el call-site.
export function canDo(
  roleSlug: RoleSlug | null | undefined,
  collection: CollectionSlug,
  action: Action,
  _organizationId: string | null
): boolean {
  if (!roleSlug) return false
  if (roleSlug === 'platform_admin' && !_organizationId && action !== 'read') return false
  const effectiveRole = roleSlug === 'platform_admin' && _organizationId ? 'org_admin' : roleSlug
  return MATRIX[effectiveRole]?.[collection]?.includes(action) ?? false
}

// Alcance de fila por rol: org_admin/platform_admin ven toda la organización (incluidas las filas
// org-level, office = null); office_manager y org_viewer solo sus oficinas (membership.offices).
// Único lugar con esta regla — endpoints, access y frontend (vía /v1/session) la consultan acá.
export function hasOrgWideScope(roleSlug: RoleSlug | null | undefined): boolean {
  return roleSlug === 'platform_admin' || roleSlug === 'org_admin'
}
