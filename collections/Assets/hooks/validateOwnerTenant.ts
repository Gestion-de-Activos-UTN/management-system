import type { CollectionBeforeChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import { assertOwnerCoversOffice } from '@/access/tenant/assertOwnerCoversOffice'

// `organization` es un campo técnico inmutable (resuelto en la ingesta, ver
// domain/inventories/ingestScanReport.ts) — nunca viene en `data` de una edición humana de
// negocio, siempre se lee de `originalDoc`.
export const validateOwnerTenant: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data?.owner) return data

  const organizationId = relationId(originalDoc?.organization)
  const officeId = originalDoc?.office ? relationId(originalDoc.office) : null
  await assertOwnerCoversOffice(req, relationId(data.owner), organizationId, officeId)

  return data
}
