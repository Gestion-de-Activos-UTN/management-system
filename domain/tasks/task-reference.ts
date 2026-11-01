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
  unavailable?: boolean
  /** Su oficina está inactiva: una tarea nueva caería en ella y la creación la rechaza. */
  officeInactive?: boolean
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

type Doc = Record<string, unknown> & { id: string | number }
type RelatedCollection = 'offices' | 'assets' | 'non-network-assets' | 'organizations'
type Related = Record<RelatedCollection, Map<string, Doc>>
type Fetch = (collection: RelatedCollection, ids: string[]) => Promise<Doc[]>

/** Ids de lo que hace falta leer para nombrar las entidades: su oficina y el destino de un ciclo. */
function relatedIds(relationTo: TaskReferenceInput['relationTo'], docs: Doc[]) {
  const ids: Record<RelatedCollection, Set<string>> = {
    offices: new Set(),
    assets: new Set(),
    'non-network-assets': new Set(),
    organizations: new Set(),
  }
  for (const doc of docs) {
    if (relationTo !== 'offices' && doc.office) ids.offices.add(relationId(doc.office))
    if (relationTo !== 'assessment-instances') continue
    if (doc.scope === 'organization') ids.organizations.add(relationId(doc.organization))
    else if (doc.manual_asset) ids['non-network-assets'].add(relationId(doc.manual_asset))
    else if (doc.asset) ids.assets.add(relationId(doc.asset))
  }
  return ids
}

async function loadRelated(
  ids: Record<RelatedCollection, Set<string>>,
  fetch: Fetch
): Promise<Related> {
  const entries = await Promise.all(
    (Object.keys(ids) as RelatedCollection[]).map(async collection => {
      const docs = ids[collection].size ? await fetch(collection, [...ids[collection]]) : []
      return [collection, new Map(docs.map(doc => [String(doc.id), doc]))] as const
    })
  )
  return Object.fromEntries(entries) as Related
}

function assessmentTargetLabel(doc: Doc, related: Related): string {
  const get = (collection: RelatedCollection, value: unknown) =>
    related[collection].get(relationId(value))
  if (doc.scope === 'organization')
    return text(get('organizations', doc.organization)?.name, 'Organización')
  if (doc.scope === 'office' && doc.office) return text(get('offices', doc.office)?.name, 'Oficina')
  if (doc.manual_asset) return text(get('non-network-assets', doc.manual_asset)?.alias, 'Activo')
  if (doc.asset) {
    const asset = get('assets', doc.asset)
    return text(
      asset?.alias,
      text(asset?.hostname, text(asset?.ip, `Activo ${relationId(doc.asset)}`))
    )
  }
  return 'alcance sin nombre'
}

function describeReference(
  reference: TaskReferenceInput,
  doc: Doc,
  related: Related
): ResolvedTaskReference {
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
      const target = assessmentTargetLabel(doc, related)
      const opened = doc.opened_at ? formatDate(String(doc.opened_at)) : String(doc.id)
      label = `${target} · ciclo del ${opened} · ${text(doc.policy_key, 'política')} v${String(doc.policy_version ?? '—')}`
      break
    }
    case 'compliance-results':
      label = `${text(doc.control_key, 'Control sin identificar')} · ${text(doc.check_key, `resultado ${doc.id}`)}`
      break
    // El tipo de entidad se muestra aparte en la UI; acá sólo va lo que la distingue de sus pares.
    case 'inventory-snapshots':
      label = text(
        doc.display_name,
        doc.taken_at ? formatDateTime(String(doc.taken_at)) : `Instantánea ${doc.id}`
      )
      break
    case 'scan-reports':
      label = text(
        doc.display_name,
        doc.scan_start ? formatDateTime(String(doc.scan_start)) : `Escaneo ${doc.id}`
      )
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

  let officeInactive = reference.relationTo === 'offices' && doc.is_active === false
  if (officeId && reference.relationTo !== 'offices') {
    const office = related.offices.get(officeId)
    if (!organizationId && office) organizationId = relationId(office.organization)
    officeInactive = office?.is_active === false
    // El ciclo ya nombra su oficina o activo en el label.
    if (reference.relationTo !== 'assessment-instances' && office)
      label = `${label} · ${text(office.name, 'Oficina')}`
  }

  if (!organizationId) {
    throw new TaskDomainError(
      'related_entity_without_organization',
      400,
      'No se pudo resolver la organización de la entidad.'
    )
  }
  return {
    ...reference,
    organizationId,
    officeId,
    label,
    ...(officeInactive ? { officeInactive } : {}),
    ...(['assets', 'non-network-assets'].includes(reference.relationTo)
      ? { unavailable: doc.status === 'retired' || Boolean(doc.deleted_at) }
      : {}),
  }
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
  // whitelist del schema y el switch exhaustivo de describeReference fijan la forma concreta.
  const doc = loaded as unknown as Doc
  const related = await loadRelated(relatedIds(reference.relationTo, [doc]), (collection, ids) =>
    Promise.all(
      ids.map(
        id =>
          req.payload.findByID({
            collection,
            id,
            overrideAccess: true,
            req,
            depth: 0,
          }) as unknown as Promise<Doc>
      )
    )
  )
  return describeReference(reference, doc, related)
}

/** Lo mismo para una lista ya leída: una consulta por colección relacionada, no una por entidad. */
export async function resolveTaskReferences(
  req: PayloadRequest,
  relationTo: TaskReferenceInput['relationTo'],
  docs: Doc[]
): Promise<ResolvedTaskReference[]> {
  const related = await loadRelated(relatedIds(relationTo, docs), async (collection, ids) => {
    const found = await req.payload.find({
      collection,
      where: { id: { in: ids } },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
    })
    return found.docs as unknown as Doc[]
  })
  return docs.map(doc => describeReference({ relationTo, value: String(doc.id) }, doc, related))
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
