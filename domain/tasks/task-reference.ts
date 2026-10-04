import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import {
  canDo,
  hasOrgWideScope,
  type CollectionSlug,
  type RoleSlug,
} from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import { formatDate, formatDateTime } from '@/lib/format-date'
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

async function assessmentTargetLabel(
  req: PayloadRequest,
  doc: Record<string, unknown>
): Promise<string> {
  if (doc.scope === 'organization') {
    const organization = await req.payload.findByID({
      collection: 'organizations',
      id: relationId(doc.organization),
      overrideAccess: true,
      req,
      depth: 0,
    })
    return organization.name
  }
  if (doc.scope === 'office' && doc.office) {
    const office = await req.payload.findByID({
      collection: 'offices',
      id: relationId(doc.office),
      overrideAccess: true,
      req,
      depth: 0,
    })
    return office.name
  }
  if (doc.manual_asset) {
    const asset = await req.payload.findByID({
      collection: 'non-network-assets',
      id: relationId(doc.manual_asset),
      overrideAccess: true,
      req,
      depth: 0,
    })
    return asset.alias
  }
  if (doc.asset) {
    const asset = await req.payload.findByID({
      collection: 'assets',
      id: relationId(doc.asset),
      overrideAccess: true,
      req,
      depth: 0,
    })
    return asset.alias || asset.hostname || asset.ip || `Activo ${asset.id}`
  }
  return 'alcance sin nombre'
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
      label = text(doc.name, 'Oficina')
      break
    case 'assets':
      label = text(doc.alias, text(doc.hostname, text(doc.ip, `Activo ${doc.id}`)))
      break
    case 'non-network-assets':
      label = text(doc.alias, `Activo ${doc.id}`)
      break
    case 'assessment-instances': {
      const target = await assessmentTargetLabel(req, doc)
      const opened = doc.opened_at ? formatDate(String(doc.opened_at)) : String(doc.id)
      label = `${target} · ciclo del ${opened} · ${text(doc.policy_key, 'política')} v${String(doc.policy_version ?? '—')}`
      break
    }
    case 'compliance-results':
      label = `${text(doc.control_key, 'Control sin identificar')} · ${text(doc.check_key, `resultado ${doc.id}`)}`
      break
    // El tipo de entidad se muestra aparte en la UI; acá sólo va lo que la distingue de sus pares.
    case 'inventory-snapshots':
      label = doc.taken_at ? formatDateTime(String(doc.taken_at)) : `Instantánea ${doc.id}`
      break
    case 'scan-reports':
      label = doc.scan_start ? formatDateTime(String(doc.scan_start)) : `Escaneo ${doc.id}`
      break
    case 'risk-evaluations':
      label = doc.evaluated_at ? formatDateTime(String(doc.evaluated_at)) : `Evaluación ${doc.id}`
      if (!officeId) label = `${label} · Toda la organización`
      break
    case 'agents':
      // Una oficina puede tener agentes revocados; el prefijo corto del id los distingue.
      label = `Agente ${String(doc.id).slice(0, 8)}`
      break
  }

  if (
    officeId &&
    reference.relationTo !== 'offices' &&
    reference.relationTo !== 'assessment-instances'
  ) {
    const office = await req.payload.findByID({
      collection: 'offices',
      id: officeId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (!organizationId) organizationId = relationId(office.organization)
    label = `${label} · ${office.name}`
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
