import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

const GATED_FIELDS = ['alias', 'location', 'criticality', 'owner'] as const

// Mientras nadie confirmó que un activo detectado es real (Assets.identified), sus campos de
// negocio no tienen sentido — no hay a quién asignarle ubicación/criticidad/owner todavía.
// `identified` y `status` quedan fuera del gate: son las únicas escrituras legítimas en este
// estado. Mismo patrón que rejectManualOfflineStatus.ts: rechazar en beforeChange, no confiar
// solo en que la UI deshabilite los inputs (endpoints/assetIdentify.ts es el único camino
// legítimo para pasar de false a true).
export const rejectBusinessEditsBeforeIdentified: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const willBeIdentified = 'identified' in (data ?? {}) ? Boolean(data.identified) : Boolean(originalDoc?.identified)
  if (willBeIdentified) return data

  const touchedGatedField = GATED_FIELDS.some(
    field => field in (data ?? {}) && data[field] !== originalDoc?.[field]
  )
  if (touchedGatedField) {
    throw new APIError(
      'Este activo todavía no fue identificado: alias, ubicación, criticidad y responsable no se pueden editar hasta confirmarlo.',
      400
    )
  }
  return data
}
