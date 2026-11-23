/**
 * Preload de `pnpm test:integration` (`--import`). Al terminar los tests de cada archivo cierra
 * las instancias de Payload que quedaron en la caché de `getPayload` y su pool de PostgreSQL.
 * Sin esto, el pool deja vivo al proceso hijo de node:test y hacía falta --test-force-exit, que
 * cortaba la salida sin avisar (F0.8).
 *
 * Por qué no alcanza con `payload.destroy()` (payload 3.86): el `destroy()` del adaptador solo
 * limpia su estado y no cierra el pool. Además, el `connect()` del adaptador toma un cliente con
 * `pool.connect()` para escuchar reconexiones y nunca lo devuelve, así que `pool.end()` esperaría
 * para siempre. Ese cliente se destruye a mano usando los campos internos de pg-pool 3.x
 * (`_clients`, `_idle`). Si una versión cambia esos campos, el hook falla con un error explícito
 * (el archivo de tests queda en rojo); si algo se colgara, lo corta el timeout del job de CI.
 *
 * Solo actúa en los procesos hijo (uno por archivo): en el padre no hay Payload, y registrar un
 * hook ahí crearía un segundo árbol de tests.
 */
import { after } from 'node:test'

type PgClient = { release: (destroy?: boolean) => void }
type PgPool = { _clients?: unknown; _idle?: unknown; end: () => Promise<void> }
type ClosablePayload = { destroy: () => Promise<void>; db?: { pool?: PgPool } }
type CachedPayload = { payload: ClosablePayload | null; promise: Promise<ClosablePayload> | null }

async function closePool(pool: PgPool) {
  if (!Array.isArray(pool._clients) || !Array.isArray(pool._idle)) {
    throw new Error(
      'testing/integration-teardown.ts: pg-pool ya no expone _clients/_idle; revisar cómo cerrar el pool de Payload',
    )
  }
  const idle = new Set((pool._idle as { client: PgClient }[]).map((item) => item.client))
  for (const client of pool._clients as PgClient[]) {
    if (!idle.has(client)) client.release(true) // el cliente que Payload retuvo en connect()
  }
  await pool.end()
}

if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
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
