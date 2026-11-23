/**
 * Preload de `pnpm test:integration` (`--import`). Al terminar los tests de cada archivo cierra
 * las instancias de Payload que quedaron en la caché de `getPayload` y su pool de PostgreSQL.
 * Sin esto, el pool deja vivo al proceso hijo de node:test y hacía falta --test-force-exit, que
 * cortaba la salida sin avisar y no corría tests registrados después de un `await` de nivel
 * superior (F0.8).
 *
 * El cierre del pool usa campos internos de pg-pool: ver la deuda técnica en
 * `testing/pg-pool-teardown.ts`. Con una versión de pg-pool no verificada, cada archivo falla
 * antes de correr sus tests, con un mensaje que dice qué revisar.
 *
 * Solo actúa en los procesos hijo (uno por archivo): en el padre no hay Payload, y registrar un
 * hook ahí crearía un segundo árbol de tests.
 */
import { after } from 'node:test'
import {
  assertSupportedPgPool,
  closePool,
  readInstalledPgPoolVersion,
  type PgPool,
} from './pg-pool-teardown'

type ClosablePayload = { destroy: () => Promise<void>; db?: { pool?: PgPool } }
type CachedPayload = { payload: ClosablePayload | null; promise: Promise<ClosablePayload> | null }
type Cleanup = () => Promise<void>

// Limpiezas que un archivo de tests necesita hacer con Payload todavía abierto. Un `after` del
// propio archivo corre después que el de este preload (se registra antes), cuando Payload ya está
// cerrado. En globalThis con Symbol.for: si el archivo importa este módulo por otra ruta, comparte
// el mismo registro.
const CLEANUPS_KEY = Symbol.for('siam.testing.integration-cleanups')
const registry = globalThis as typeof globalThis & { [CLEANUPS_KEY]?: Cleanup[] }
const cleanups: Cleanup[] = (registry[CLEANUPS_KEY] ??= [])

/**
 * Registra una limpieza que corre al terminar el archivo, antes de cerrar Payload (en orden de
 * registro). Para restos de la corrida actual; los de una corrida interrumpida se limpian al
 * empezar (ver testing/audit-test-data.ts).
 */
export function onIntegrationTeardown(cleanup: Cleanup) {
  cleanups.push(cleanup)
}

if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  assertSupportedPgPool(readInstalledPgPoolVersion())

  after(async () => {
    // Primero las limpiezas de los archivos; si alguna falla, Payload se cierra igual.
    let cleanupError: unknown
    for (const cleanup of cleanups.splice(0)) {
      try {
        await cleanup()
      } catch (error) {
        cleanupError ??= error
      }
    }
    try {
      await closeCachedPayloads()
    } finally {
      if (cleanupError) throw cleanupError
    }
  })
}

async function closeCachedPayloads() {
  // getPayload guarda sus instancias en global._payload (Map por `key`; payload 3.x).
  const cache = (globalThis as { _payload?: Map<string, CachedPayload> })._payload
  if (!cache) return
  for (const entry of cache.values()) {
    const payload = entry.payload ?? (await entry.promise?.catch(() => null)) ?? null
    if (!payload) continue
    const pool = payload.db?.pool
    await payload.destroy()
    if (pool) await closePool(pool)
  }
  cache.clear()
}
