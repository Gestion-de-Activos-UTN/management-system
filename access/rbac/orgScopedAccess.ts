import type { Access, Where } from 'payload'
import { canDo, type Action, type CollectionSlug } from './permissions'
import { getTenantContext } from '../tenant/resolveTenantContext'

type OrgScope =
  | { kind: 'self' } // la propia fila es la organización (ej. Organizations.id)
  | { kind: 'organization'; field: string } // filtra por un campo `organization` de la fila
  | { kind: 'offices'; field: string } // filtra por un campo relación a Offices, vía ctx.officeIds

type TenantCtxForScope = { organizationId: string | null; officeIds: string[] }

function scopeWhere(scope: OrgScope, ctx: TenantCtxForScope): Where | false {
  if (scope.kind === 'offices') return { [scope.field]: { in: ctx.officeIds } }
  if (!ctx.organizationId) return false
  if (scope.kind === 'self') return { id: { equals: ctx.organizationId } }
  return { [scope.field]: { equals: ctx.organizationId } }
}

// Combina canDo (¿puede hacer esto en general?) + el filtro de fila por organización
// (¿qué filas puede ver?) — doc 03.1: el row-level scoping es una capa aparte que NUNCA se
// salta aunque canDo ya haya dado true.
export function orgScopedAccess(
  collection: CollectionSlug,
  action: Action,
  scope: OrgScope = { kind: 'organization', field: 'organization' },
): Access {
  return async ({ req }) => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return false
    if (!canDo(ctx.role, collection, action, ctx.organizationId)) return false

    if (ctx.isPlatformAdmin) {
      // Sin ?asOrganization=, platform_admin ve todo. Con uno válido, queda scoped por
      // organización igual que cualquier otro rol (doc 03) — ctx.officeIds ya viene resuelto
      // para la org visitada (resolveTenantContext::findOfficeIdsByOrganization), así que el
      // scope `offices` también se filtra correctamente en este caso.
      if (!ctx.organizationId) return true
      return scopeWhere(scope, ctx)
    }

    if (scope.kind === 'offices') return scopeWhere(scope, ctx)
    if (!ctx.organizationId) return false
    return scopeWhere(scope, ctx)
  }
}

// Roles no es organization-scoped (catálogo global) — cualquier identidad activa con permiso
// puede leerlo completo, sin filtro de fila.
export function globalReadAccess(collection: CollectionSlug, action: Action): Access {
  return async ({ req }) => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return false
    return canDo(ctx.role, collection, action, ctx.organizationId)
  }
}
