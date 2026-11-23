import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertSupportedPgPool, closePool, readInstalledPgPoolVersion } from './pg-pool-teardown'

describe('pg-pool-teardown', () => {
  describe('control de versión', () => {
    it('acepta pg-pool 3.14.x', () => {
      assert.doesNotThrow(() => assertSupportedPgPool('3.14.0'))
      assert.doesNotThrow(() => assertSupportedPgPool('3.14.7'))
    })

    it('rechaza cualquier otra versión, con un mensaje que dice qué revisar', () => {
      for (const version of ['3.15.0', '3.13.9', '4.0.0', '3.14.0-beta.1', '3.14']) {
        assert.throws(
          () => assertSupportedPgPool(version),
          (err: Error) =>
            err.message.startsWith(`pg-pool ${version} no está verificado`) &&
            err.message.includes('testing/pg-pool-teardown.ts') &&
            err.message.includes('_clients, _idle') &&
            err.message.includes('payload.destroy() no cierra el pool') &&
            err.message.includes('SUPPORTED_PG_POOL'),
        )
      }
    })

    // Si una actualización de pg trae otro pg-pool, falla acá (job build), sin esperar a integración.
    it('la versión instalada está verificada', () => {
      const version = readInstalledPgPoolVersion()
      assert.match(version, /^\d+\.\d+\.\d+/)
      assert.doesNotThrow(() => assertSupportedPgPool(version))
    })
  })

  describe('closePool', () => {
    const client = () => {
      const calls: (boolean | undefined)[] = []
      return { calls, release: (destroy?: boolean) => void calls.push(destroy) }
    }

    it('destruye solo los clientes prestados y después cierra el pool', async () => {
      const idleA = client()
      const idleB = client()
      const retained = client()
      const order: string[] = []
      const pool = {
        _clients: [idleA, retained, idleB],
        _idle: [{ client: idleA }, { client: idleB }],
        end: async () => {
          order.push(`end (retenido destruido: ${retained.calls.length === 1})`)
        },
      }
      await closePool(pool)
      assert.deepEqual(retained.calls, [true])
      assert.deepEqual(idleA.calls, [])
      assert.deepEqual(idleB.calls, [])
      assert.deepEqual(order, ['end (retenido destruido: true)'])
    })

    it('falla con un mensaje claro si pg-pool ya no tiene _clients/_idle', async () => {
      await assert.rejects(closePool({ end: async () => {} }), /pg-pool ya no expone _clients\/_idle/)
      await assert.rejects(closePool({ _clients: [], end: async () => {} }), /_clients\/_idle/)
    })
  })
})
