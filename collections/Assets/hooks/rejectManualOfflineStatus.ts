import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

// RF-37 / doc 05 §5.3: activo↔offline es autoridad exclusiva de ingesta + aging job
// (domain/inventories/ingestScanReport.ts, domain/inventories/agingSweep.ts), nunca de un
// humano. Ambos procesos pasan `context: { systemJob: true }` en su payload.update/create —
// cualquier otro caller (PATCH manual vía REST, overrideAccess o no) queda bloqueado acá.
export const rejectManualOfflineStatus: CollectionBeforeChangeHook = ({ data, req }) => {
  if (data?.status === 'offline' && !req.context?.systemJob) {
    throw new APIError("status 'offline' solo puede fijarlo un proceso automático (ingesta/aging), nunca una edición manual.", 400)
  }
  return data
}
