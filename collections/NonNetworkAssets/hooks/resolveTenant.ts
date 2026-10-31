import { APIError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { categoryHasSoftware } from '@/domain/assets/asset-types'
import {
  assertOfficeInScope,
  assertSoftwareIdentityComplete,
  buildCpeCandidate,
  computeNextReviewAt,
  deriveNextReviewAt,
  type ReviewInterval,
} from '../invariants'

import { relationId } from '@/lib/relationId'
import { assertOwnerCoversOffice } from '@/access/tenant/assertOwnerCoversOffice'

async function findOffice(req: PayloadRequest, officeId: string) {
  const office = await req.payload.findByID({
    collection: 'offices',
    id: officeId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  return { organizationId: relationId(office.organization), isActive: office.is_active !== false }
}

const reject = (message: string) => {
  throw new APIError(message, 400, undefined, true)
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

  const office = await findOffice(req, officeId as string)
  const organizationId = office.organizationId

  // "Cambió" = distinto de lo guardado, no "vino en el request": el formulario manda todos los
  // campos, y una cascada del sistema escribe sobre activos que ya están en oficinas inactivas.
  const officeChanged = !originalDoc || officeId !== relationId(originalDoc.office)
  const revived = originalDoc?.status === 'retired' && data?.status === 'active'
  // RF-23a: una oficina inactiva no recibe activos nuevos, movidos ni reactivados.
  if (!office.isActive && (officeChanged || revived)) {
    reject('La oficina elegida está inactiva.')
  }

  // RF-51a: owner obligatorio al crear. `null` sólo lo escribe el sistema (lib/system-context.ts):
  // una persona nunca puede elegir "Sin responsable", aunque sí conservarlo al editar otra cosa.
  const ownerId =
    data && 'owner' in data
      ? data.owner
        ? relationId(data.owner)
        : null
      : originalDoc?.owner
        ? relationId(originalDoc.owner)
        : null
  const previousOwnerId = originalDoc?.owner ? relationId(originalDoc.owner) : null
  const systemRelease = req.context.systemOwnerRelease === true
  if (!ownerId && !systemRelease) {
    if (!originalDoc) reject('Selecciona un responsable.')
    if (previousOwnerId) reject('Selecciona un responsable.')
    if (officeChanged) reject('Selecciona un responsable para la nueva oficina.')
  }
  // Se valida sólo si cambia el owner o la oficina: un owner que quedó viejo (desactivado) no
  // bloquea editar otra cosa del activo.
  if (ownerId && (ownerId !== previousOwnerId || officeChanged)) {
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
  // Internal callers may replay a historical event with its original clock. Public HTTP input
  // cannot set req.context; the demo seed uses this seam to create genuinely overdue records
  // through the same derivation used by the frontend instead of writing next_review_at directly.
  const requestedNow = req.context.seedEffectiveNow
  const parsedNow = requestedNow ? new Date(String(requestedNow)) : new Date()
  const effectiveNow = Number.isFinite(parsedNow.getTime()) ? parsedNow : new Date()
  // `reviewConfirmed` sólo lo setea endpoints/nonNetworkAssetReview.ts vía req.context (el input
  // HTTP público no llega a req.context), igual que `seedEffectiveNow`.
  const nextReviewAt = deriveNextReviewAt({
    interval,
    previous: originalDoc?.next_review_at,
    isCreate: !originalDoc,
    intervalChanged,
    reviewConfirmed: req.context.reviewConfirmed === true,
    now: effectiveNow,
  })

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
