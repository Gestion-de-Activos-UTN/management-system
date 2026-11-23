import { randomUUID } from 'node:crypto'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { onIntegrationTeardown } from './integration-teardown'

// Datos de prueba de los tests de integración del AuditLog. `pnpm test:integration` también corre
// contra la base de desarrollo (docker compose exec app …), así que una corrida cortada con
// Ctrl+C no puede dejar nada que rompa la siguiente ni que quede suelto (Tani, 23/11):
//
// - Organizaciones de prueba con un prefijo fijo de 48 bits (00f1b7e5-0000-4…) y el resto al
//   azar: únicas en cada corrida y reconocibles. Las cadenas `org:<id>` con ese prefijo se borran
//   al empezar (restos de una corrida interrumpida) y al terminar. Un id real de Payload (UUID v4
//   al azar) cae en ese prefijo con probabilidad 2^-48.
// - Tablas auxiliares (la "escritura de negocio" de un test) en un schema propio de cada archivo,
//   nunca en `public`: Payload compara `public` con su schema al iniciar, y una tabla que no
//   conoce con filas lo frena con un aviso de pérdida de datos (y sin terminal, process.exit(0)).
//   Fuera de `public` no la mira. El schema se borra entero al empezar y al terminar.
// - La cadena `platform` no se usa en tests de integración: es compartida, y borrar filas de
//   prueba ahí cortaría la cadena real de una base de desarrollo.

export const AUDIT_TEST_ORG_PREFIX = '00f1b7e5-0000-4'

/** Id de organización de prueba: UUID v4 válido con el prefijo de prueba. */
export function auditTestOrganizationId(): string {
  return `${AUDIT_TEST_ORG_PREFIX}${randomUUID().slice(AUDIT_TEST_ORG_PREFIX.length)}`
}

const drizzle = (payload: Payload) => (payload.db as unknown as PostgresAdapter).drizzle

/** Borra los eventos y contextos de red de todas las organizaciones de prueba. */
export async function deleteAuditTestRows(payload: Payload) {
  const chains = `org:${AUDIT_TEST_ORG_PREFIX}%`
  const db = drizzle(payload)
  await db.execute(sql`DELETE FROM audit_network_contexts WHERE chain_id LIKE ${chains}`)
  await db.execute(sql`DELETE FROM audit_logs WHERE chain_id LIKE ${chains}`)
}

/**
 * Prepara los datos de prueba de un archivo: limpia lo que haya dejado una corrida anterior, crea
 * el schema auxiliar si se pide y registra la misma limpieza para el final (antes de cerrar
 * Payload). Llamar en el `before` del archivo.
 */
export async function prepareAuditTestData(
  payload: Payload,
  options: { schema?: string } = {}
): Promise<void> {
  const { schema } = options
  if (schema !== undefined && !/^siam_test_[a-z0-9_]+$/.test(schema))
    throw new Error('El schema de prueba tiene que empezar con siam_test_.')
  const cleanup = async () => {
    await deleteAuditTestRows(payload)
    if (schema)
      await drizzle(payload).execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schema)} CASCADE`)
  }
  await cleanup()
  if (schema) await drizzle(payload).execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`)
  onIntegrationTeardown(cleanup)
}
