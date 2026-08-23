export type RoleSlug = 'platform_admin' | 'org_admin' | 'org_viewer' | 'office_manager'
export type CollectionSlug =
  | 'organizations'
  | 'offices'
  | 'assets'
  | 'non-network-assets'
  | 'scan-reports'
  | 'roles'
  | 'job-runs'
  | 'inventory-snapshots'
export type Action = 'create' | 'read' | 'update' | 'delete'

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
    assets: ['read'],
    'non-network-assets': ['read'],
    'scan-reports': ['read'],
    roles: ['read'],
    'job-runs': ['read'],
    'inventory-snapshots': ['create', 'read'],
  },
  org_admin: {
    organizations: ['read'],
    offices: ['read'],
    assets: ['read', 'update'],
    'non-network-assets': ['create', 'read', 'update', 'delete'],
    'scan-reports': ['read'],
    'inventory-snapshots': ['create', 'read'],
  },
  org_viewer: {
    organizations: ['read'],
    offices: ['read'],
    assets: ['read'],
    'non-network-assets': ['read'],
    'scan-reports': ['read'],
    'inventory-snapshots': ['read'],
  },
  office_manager: {
    organizations: ['read'],
    offices: ['read'],
    assets: ['read', 'update'],
    'non-network-assets': ['create', 'read', 'update'],
    'scan-reports': ['read'],
    'inventory-snapshots': ['read'],
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
  return MATRIX[roleSlug]?.[collection]?.includes(action) ?? false
}
