import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import {
  canDo,
  hasOrgWideScope,
  type CollectionSlug,
  type RoleSlug,
} from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import type { TaskReferenceInput } from '@/modules/tasks/schema'
import { TaskDomainError } from './task-error'

export type ResolvedTaskReference = TaskReferenceInput & {
  organizationId: string
  officeId: string | null
  label: string
}

const REFERENCE_COLLECTION_PERMISSIONS: Record<TaskReferenceInput['relationTo'], CollectionSlug> = {
  offices: 'offices',
  assets: 'assets',
  'non-network-assets': 'non-network-assets',
  'assessment-instances': 'assessment-instances',
  'compliance-results': 'compliance-results',
  'inventory-snapshots': 'inventory-snapshots',
  'scan-reports': 'scan-reports',
  'risk-evaluations': 'risk-evaluations',
  agents: 'agents',
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export async function resolveTaskReference(
  req: PayloadRequest,
  reference: TaskReferenceInput
): Promise<ResolvedTaskReference> {
  const loaded = await req.payload
    .findByID({
      collection: reference.relationTo,
      id: reference.value,
      overrideAccess: true,
      req,
      depth: 0,
    })
    .catch(() => null)
  if (!loaded) throw new TaskDomainError('related_entity_not_found', 404, 'La entidad no existe.')
  // Payload no discrimina el tipo de retorno cuando `collection` es una unión dinámica. La
  // whitelist del schema y el switch exhaustivo de abajo son los que fijan la forma concreta.
  const doc = loaded as unknown as Record<string, unknown> & { id: string | number }

  let organizationId = 'organization' in doc && doc.organization ? relationId(doc.organization) : ''
  let officeId = 'office' in doc && doc.office ? relationId(doc.office) : null
  let label = reference.value

  switch (reference.relationTo) {
    case 'offices':
      organizationId = relationId(doc.organization)
      officeId = String(doc.id)
      label = `Inventario · ${text(doc.name, 'Oficina')}`
      break
    case 'assets':
      label = text(doc.alias, text(doc.hostname, text(doc.ip, `Activo ${doc.id}`)))
      break
    case 'non-network-assets':
      label = text(doc.alias, `Activo ${doc.id}`)
      break
    case 'assessment-instances':
      label = `Revisión de seguridad · ${String(doc.id)}`
      break
    case 'compliance-results':
      label = text(doc.check_key, `Resultado ${doc.id}`)
      break
    case 'inventory-snapshots':
      label = `Instantánea · ${text(doc.taken_at, String(doc.id))}`
      break
    case 'scan-reports': {
      label = `Escaneo · ${String(doc.id)}`
      if (!organizationId && officeId) {
        const office = await req.payload.findByID({
          collection: 'offices',
          id: officeId,
          overrideAccess: true,
          req,
          depth: 0,
        })
        organizationId = relationId(office.organization)
      }
      break
    }
    case 'risk-evaluations':
      label = `Evaluación de riesgo · ${text(doc.evaluated_at, String(doc.id))}`
      break
    case 'agents':
      label = `Agente · ${String(doc.id)}`
      break
  }

  if (!organizationId) {
    throw new TaskDomainError(
      'related_entity_without_organization',
      400,
      'No se pudo resolver la organización de la entidad.'
    )
  }
  return { ...reference, organizationId, officeId, label }
}

export function roleCanReadTaskReference(
  role: RoleSlug,
  organizationId: string,
  roleOfficeIds: string[],
  reference: ResolvedTaskReference
): boolean {
  if (reference.organizationId !== organizationId) return false
  const permissionCollection = REFERENCE_COLLECTION_PERMISSIONS[reference.relationTo]
  if (!canDo(role, permissionCollection, 'read', organizationId)) return false
  if (!reference.officeId) return hasOrgWideScope(role)
  return hasOrgWideScope(role) || roleOfficeIds.includes(reference.officeId)
}

export function tenantCanReadTaskReference(
  ctx: TenantContext,
  reference: ResolvedTaskReference
): boolean {
  if (!ctx.organizationId || !ctx.role) return false
  if (ctx.isPlatformAdmin && ctx.organizationId === reference.organizationId) {
    return canDo(
      ctx.role,
      REFERENCE_COLLECTION_PERMISSIONS[reference.relationTo],
      'read',
      ctx.organizationId
    )
  }
  return roleCanReadTaskReference(ctx.role, ctx.organizationId, ctx.officeIds, reference)
}
