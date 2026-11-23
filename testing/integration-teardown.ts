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
import { assertSupportedPgPool, closePool, readInstalledPgPoolVersion, type PgPool } from './pg-pool-teardown'

type ClosablePayload = { destroy: () => Promise<void>; db?: { pool?: PgPool } }
type CachedPayload = { payload: ClosablePayload | null; promise: Promise<ClosablePayload> | null }

if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  assertSupportedPgPool(readInstalledPgPoolVersion())

  after(async () => {
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
  })
}
