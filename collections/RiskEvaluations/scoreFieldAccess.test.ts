import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { whenBandVisible, whenIndexVisible } from './scoreFieldAccess'

const request = (stored: Record<string, string | Error>) => {
  let reads = 0
  const req = {
    context: {},
    payload: {
      findByID: async ({ id }: { id: string }) => {
        reads += 1
        const value = stored[id]
        if (value instanceof Error) throw value
        return { visibility: value }
      },
    },
  }
  return { req, reads: () => reads }
}
const access = (fn: typeof whenIndexVisible, doc: unknown, req: unknown) =>
  (fn as unknown as (args: { doc: unknown; req: unknown }) => Promise<boolean>)({ doc, req })

describe('risk evaluation field access', () => {
  it('reads visibility from the document when present', async () => {
    const { req, reads } = request({})
    assert.equal(await access(whenIndexVisible, { id: 'e', visibility: 'preliminary' }, req), true)
    assert.equal(await access(whenBandVisible, { id: 'e', visibility: 'preliminary' }, req), false)
    assert.equal(reads(), 0)
  })

  it('looks visibility up once per evaluation when a partial select left it out', async () => {
    const { req, reads } = request({ banded: 'banded', hidden: 'hidden' })
    assert.equal(await access(whenIndexVisible, { id: 'banded' }, req), true)
    assert.equal(await access(whenBandVisible, { id: 'banded' }, req), true)
    assert.equal(await access(whenIndexVisible, { id: 'hidden' }, req), false)
    assert.equal(reads(), 2)
  })

  it('fails closed without an id or when the lookup fails', async () => {
    const { req } = request({ broken: new Error('db down') })
    assert.equal(await access(whenIndexVisible, {}, req), false)
    assert.equal(await access(whenIndexVisible, { id: 'broken' }, req), false)
  })
})
