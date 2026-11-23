import { APIError, type CollectionBeforeOperationHook } from 'payload'
import { consumeInternalAuditWrite } from './internal-write'

// Guard de solo agregado para AuditLogs y AuditNetworkContexts (documentation/planes/audit-log/
// 03-seguridad-y-claves.md §2). Corre en beforeOperation, que Payload ejecuta también con
// overrideAccess: true y desde la Local API, y antes del control de acceso:
// - create: solo con la marca interna de un solo uso (internal-write.ts);
// - update, delete y restoreVersion: siempre rechazados.
// No protege frente a SQL directo (payload.db.* o psql): eso es el rol de base sin UPDATE/DELETE
// (decisión G14, al desplegar). La purga de AuditNetworkContexts (03 §8) agregará su propia marca.

export function appendOnlyGuard(collectionLabel: string): CollectionBeforeOperationHook {
  return ({ operation, context }) => {
    if (operation === 'create') {
      if (consumeInternalAuditWrite(context)) return
      throw new APIError(
        `${collectionLabel}: solo se escribe desde el cierre transaccional del AuditLog.`,
        403
      )
    }
    if (operation === 'update' || operation === 'delete' || operation === 'restoreVersion') {
      throw new APIError(
        `${collectionLabel}: es de solo agregado, no se modifica ni se borra.`,
        403
      )
    }
  }
}
