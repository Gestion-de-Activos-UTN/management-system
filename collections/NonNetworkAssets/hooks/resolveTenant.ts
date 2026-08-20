import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { assertOfficeInScope, computeNextReviewAt, type ReviewPolicy } from '../invariants'
import { relationId } from '@/lib/relationId'

async function findOrganizationOfOffice(req: PayloadRequest, officeId: string): Promise<string> {
  const office = await req.payload.findByID({
    collection: 'offices',
    id: officeId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  return relationId(office.organization)
}

// OrganizationSettings tiene los 4 access en false — se lee solo con overrideAccess desde acá.
// Leer la política NO requiere abrirle acceso público a esa colección; eso recién hará falta
// cuando exista una UI para editarla (hoy solo la escribe domain/organizations/createOrgWithAdmin.ts).
async function findReviewPolicy(
  req: PayloadRequest,
  organizationId: string
): Promise<ReviewPolicy | null> {
  const result = await req.payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const settings = result.docs[0]
  if (!settings?.review_policy) return null
  return settings.review_policy as ReviewPolicy
}

// A diferencia de Assets (que resuelve office/organization en domain/inventories/ingestScanReport.ts,
// porque ahí escribe un Agent vía endpoint custom), acá el actor es un humano contra el REST CRUD
// autogenerado — así que la resolución tiene que vivir en este hook, no en una función de dominio.
export const resolveTenantAndReview: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const ctx = await getTenantContext(req)

  if (!ctx) return data

  const officeId = data?.office
    ? relationId(data.office)
    : originalDoc?.office
      ? relationId(originalDoc.office)
      : null

  // Se revalida en cada escritura, no solo en create: mover un activo de oficina es legítimo,
  // pero la office destino tiene que seguir estando dentro del alcance del usuario.
  assertOfficeInScope(officeId, ctx.officeIds, ctx.isPlatformAdmin && !ctx.organizationId)

  const organizationId = await findOrganizationOfOffice(req, officeId as string)

  const category = (data?.asset_category ?? originalDoc?.asset_category ?? null) as string | null
  const hasExplicitReviewDate = Boolean(data?.next_review_at ?? originalDoc?.next_review_at)
  const nextReviewAt = hasExplicitReviewDate
    ? (data?.next_review_at ?? originalDoc?.next_review_at)
    : computeNextReviewAt(await findReviewPolicy(req, organizationId), category, new Date())

  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, office, organization,
  // asset_category, criticality, owner, status}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  return {
    ...data,
    office: officeId,
    organization: organizationId,
    next_review_at: nextReviewAt,
    last_updated_at: new Date().toISOString(),
  }
}
