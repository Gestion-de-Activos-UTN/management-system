/**
 * Cierre del pool de PostgreSQL de Payload al terminar cada archivo de `pnpm test:integration`
 * (lo usa `testing/integration-teardown.ts`). Deuda técnica conocida (F0.8):
 *
 * - `payload.destroy()` no alcanza (payload 3.86): el `destroy()` del adaptador Postgres solo
 *   limpia su estado y no cierra el pool.
 * - El `connect()` de `@payloadcms/db-postgres` toma un cliente con `pool.connect()` para escuchar
 *   reconexiones y nunca lo devuelve, así que `pool.end()` espera para siempre.
 * - Por eso se destruye ese cliente a mano con campos internos de pg-pool: `_clients` (todos los
 *   clientes) e `_idle` (los libres). Verificado solo con pg-pool 3.14.x: con otra versión falla
 *   antes de correr los tests, con un mensaje que dice qué revisar.
 *
 * Al actualizar `pg` o Payload: revisar si Payload ya cierra el pool (y entonces borrar esto) o
 * si pg-pool cambió esos campos; después actualizar SUPPORTED_PG_POOL.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Versiones de pg-pool con las que se verificó el uso de `_clients` / `_idle`. */
export const SUPPORTED_PG_POOL = /^3\.14\.\d+$/

/** Versión de pg-pool que usa `pg` (la que usa Payload: hay una sola copia de `pg`). */
export function readInstalledPgPoolVersion(): string {
  const fromProject = createRequire(join(process.cwd(), 'package.json'))
  const fromPg = createRequire(fromProject.resolve('pg'))
  // pg-pool no exporta su package.json; su entrada (`index.js`) está en la raíz del paquete.
  const pkg = JSON.parse(readFileSync(join(dirname(fromPg.resolve('pg-pool')), 'package.json'), 'utf8')) as {
    name?: string
    version?: string
  }
  if (pkg.name !== 'pg-pool' || typeof pkg.version !== 'string') {
    throw new Error('testing/pg-pool-teardown.ts: no se pudo leer la versión de pg-pool')
  }
  return pkg.version
}

export function assertSupportedPgPool(version: string): void {
  if (SUPPORTED_PG_POOL.test(version)) return
  throw new Error(
    `pg-pool ${version} no está verificado para cerrar el pool de Payload en test:integration (solo 3.14.x). ` +
      'testing/pg-pool-teardown.ts usa campos internos de pg-pool (_clients, _idle) para destruir el cliente que ' +
      'el connect() de @payloadcms/db-postgres retiene, porque payload.destroy() no cierra el pool. ' +
      'Revisar si Payload ya cierra el pool (y entonces borrar ese cierre) o si pg-pool cambió esos campos, ' +
      'y actualizar SUPPORTED_PG_POOL. Detalle: PR de F0.8 y SYSTEM_PROMPT.md §8.',
  )
}

type PgClient = { release: (destroy?: boolean) => void }
export type PgPool = { _clients?: unknown; _idle?: unknown; end: () => Promise<void> }

/** Destruye los clientes prestados (el que retuvo Payload) y cierra el pool. */
export async function closePool(pool: PgPool): Promise<void> {
  if (!Array.isArray(pool._clients) || !Array.isArray(pool._idle)) {
    throw new Error(
      'testing/pg-pool-teardown.ts: pg-pool ya no expone _clients/_idle; revisar cómo cerrar el pool de Payload',
    )
  }
  const idle = new Set((pool._idle as { client: PgClient }[]).map((item) => item.client))
  for (const client of pool._clients as PgClient[]) {
    if (!idle.has(client)) client.release(true)
  }
  await pool.end()
}
