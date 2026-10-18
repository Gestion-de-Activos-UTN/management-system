import type { Payload, PayloadRequest } from 'payload'

/**
 * Oficinas activas de la organización: las únicas que cuentan (riesgo, cobertura de personas,
 * destinos de activos). Vive aparte de office-lifecycle para que riesgo pueda usarlo sin ciclo.
 */
export async function findActiveOffices(
  payload: Payload,
  organizationId: string,
  req?: PayloadRequest
) {
  const found = await payload.find({
    collection: 'offices',
    where: { and: [{ organization: { equals: organizationId } }, { is_active: { equals: true } }] },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs
}
