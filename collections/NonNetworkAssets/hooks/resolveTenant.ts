import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { categoryHasSoftware } from '@/domain/assets/asset-types'
import {
  assertOfficeInScope,
  assertSoftwareIdentityComplete,
  buildCpeCandidate,
  computeNextReviewAt,
  type ReviewInterval,
} from '../invariants'
import { relationId } from '@/lib/relationId'
import { assertOwnerCoversOffice } from '@/access/tenant/assertOwnerCoversOffice'

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
  const ownerId = data?.owner
    ? relationId(data.owner)
    : originalDoc?.owner
      ? relationId(originalDoc.owner)
      : null
  if (ownerId) {
    await assertOwnerCoversOffice(req, ownerId, organizationId, officeId)
  }

  // next_review_at se deriva de review_interval: en creación siempre se calcula; en edición
  // solo se recalcula (desde `now`, reiniciando la cuenta) si el intervalo cambió — así una
  // edición de alias/criticality que no toca el intervalo no resetea la cuenta atrás de más.
  const interval = (data?.review_interval ??
    originalDoc?.review_interval ??
    'never') as ReviewInterval
  const intervalChanged =
    'review_interval' in (data ?? {}) && data?.review_interval !== originalDoc?.review_interval
  const nextReviewAt =
    !originalDoc || intervalChanged
      ? computeNextReviewAt(interval, new Date())
      : originalDoc.next_review_at

  // Mismo criterio que review_interval arriba: `'x' in data` y no `??`, porque un PATCH que manda
  // explícitamente null para limpiar un campo tiene que poder hacerlo — con `??` el valor viejo
  // del originalDoc resucitaría.
  const incoming = (key: string) =>
    data && key in data ? (data[key] as string | null) : ((originalDoc?.[key] as string) ?? null)

  type ProductKey = 'software_vendor' | 'software_product' | 'software_version'

  const incomingProduct = (key: ProductKey): string | null => {
    const sent =
      data && 'product_details' in data
        ? (data.product_details as Partial<Record<ProductKey, string | null>> | null)
        : undefined
    if (sent === null) return null // el grupo entero fue limpiado explícitamente
    if (sent && key in sent) return sent[key] ?? null
    return (originalDoc?.product_details?.[key] as string | undefined) ?? null
  }

  const category = incoming('asset_category') ?? null
  const hasSoftware = categoryHasSoftware(category)
  const identity = {
    part: incoming('software_part') ?? 'a',
    vendor: incomingProduct('software_vendor'),
    product: incomingProduct('software_product'),
    version: incomingProduct('software_version'),
  }
  if (hasSoftware) assertSoftwareIdentityComplete(identity.vendor, identity.product)

  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, office, organization,
  // asset_category, criticality, owner, status, assessment scope and exclusion}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  return {
    ...data,
    office: officeId,
    organization: organizationId,
    next_review_at: nextReviewAt,
    last_updated_at: new Date().toISOString(),
    // Cambiar a una categoría sin software limpia la identidad: si no, quedaría un cpe_candidate
    // huérfano describiendo un producto que este activo ya no declara.
    ...(hasSoftware
      ? { cpe_candidate: buildCpeCandidate(identity) }
      : {
          software_part: null,
          cpe_candidate: null,
        }),
  }
}
