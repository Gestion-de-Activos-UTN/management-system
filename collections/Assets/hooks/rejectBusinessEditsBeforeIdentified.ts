import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

const GATED_FIELDS = [
  'alias',
  'location',
  'criticality',
  'owner',
  'confirmed_type',
  'authorization_status',
] as const

// Mientras nadie confirmó que un activo detectado es real (Assets.identified), sus campos de
// negocio no tienen sentido — no hay a quién asignarle ubicación/criticidad/owner todavía.
// `identified` y `status` quedan fuera del gate: son las únicas escrituras legítimas en este
// estado. Mismo patrón que rejectManualOfflineStatus.ts: rechazar en beforeChange, no confiar
// solo en que la UI deshabilite los inputs (endpoints/assetIdentify.ts es el único camino
// legítimo para pasar de false a true).
export const rejectBusinessEditsBeforeIdentified: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  operation,
}) => {
  // Assets.create no está expuesto a usuarios: sólo lo ejecuta ingestScanReport con
  // overrideAccess. Payload materializa defaults de negocio (p. ej. authorization_status)
  // durante esa creación; no deben confundirse con una edición humana.
  if (operation === 'create') return data

  const status = data?.identification_status ?? originalDoc?.identification_status
  const willBeIdentified =
    status === 'confirmed' ||
    ('identified' in (data ?? {}) ? Boolean(data.identified) : Boolean(originalDoc?.identified))
  if (willBeIdentified) return data

  const touchedFields = GATED_FIELDS.filter(
    field => field in (data ?? {}) && data[field] !== originalDoc?.[field]
  )
  if (touchedFields.length > 0) {
    throw new APIError(
      `Este activo todavía no fue identificado: alias, ubicación, criticidad y responsable no se ` +
        `pueden editar hasta confirmarlo. Campo(s) en conflicto: ${touchedFields
          .map(field => `${field} (${JSON.stringify(originalDoc?.[field])} -> ${JSON.stringify(data?.[field])})`)
          .join(', ')}`,
      400
    )
  }
  return data
}
