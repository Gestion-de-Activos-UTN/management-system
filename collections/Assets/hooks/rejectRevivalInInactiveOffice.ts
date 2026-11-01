import { APIError, type CollectionBeforeChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'

// Un activo dado de baja no vuelve a "activo" en una oficina inactiva: no contaría en riesgo ni
// en assessments y no tiene escáner que lo mantenga al día. Primero se reactiva la oficina (o el
// activo se mueve). Misma regla que los activos manuales (NonNetworkAssets/hooks/resolveTenant.ts).
export const rejectRevivalInInactiveOffice: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const reviving =
    originalDoc?.status === 'retired' && data?.status !== undefined && data.status !== 'retired'
  if (!reviving) return data
  const officeId = relationId(data.office ?? originalDoc.office)
  const office = await req.payload.findByID({
    collection: 'offices',
    id: officeId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  if (office.is_active === false) {
    throw new APIError(
      'La oficina de este activo está inactiva: reactívala antes de reactivar el activo.',
      400,
      undefined,
      true
    )
  }
  return data
}
