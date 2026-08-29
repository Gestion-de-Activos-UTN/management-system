import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { assertOfficeInScope, computeNextReviewAt, type ReviewInterval } from '../invariants'
import { relationId } from '@/lib/relationId'
import { assertOwnerBelongsToOrganization } from '@/access/tenant/assertOwnerBelongsToOrganization'

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

  // RF-51a: owner obligatorio — validado igual que assertOfficeInScope valida `office`, pero acá
  // necesita I/O (membership real), así que no puede vivir como invariante pura en invariants.ts.
  const ownerId = data?.owner ? relationId(data.owner) : originalDoc?.owner ? relationId(originalDoc.owner) : null
  if (ownerId) {
    await assertOwnerBelongsToOrganization(req, ownerId, organizationId)
  }

  // next_review_at se deriva de review_interval: en creación siempre se calcula; en edición
  // solo se recalcula (desde `now`, reiniciando la cuenta) si el intervalo cambió — así una
  // edición de alias/criticality que no toca el intervalo no resetea la cuenta atrás de más.
  const interval = (data?.review_interval ?? originalDoc?.review_interval ?? 'never') as ReviewInterval
  const intervalChanged = 'review_interval' in (data ?? {}) && data?.review_interval !== originalDoc?.review_interval
  const nextReviewAt = !originalDoc || intervalChanged
    ? computeNextReviewAt(interval, new Date())
    : originalDoc.next_review_at

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
