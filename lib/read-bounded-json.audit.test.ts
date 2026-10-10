import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { readBoundedJSON } from './read-bounded-json'

describe('bounded wire JSON', () => {
  it('rejects an oversized undeclared stream before consuming its remaining chunks', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":"123456789'))
    }, cancel })
    const req = new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' } as RequestInit) as PayloadRequest
    await expect(readBoundedJSON(req, 8)).rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('parses UTF-8 across chunk boundaries and rejects malformed JSON', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: '{"name":"á"}' }) as PayloadRequest
    expect(await readBoundedJSON(req, 50)).toEqual({ name: 'á' })
    await expect(readBoundedJSON(new Request('http://localhost', { method: 'POST', body: '{' }) as PayloadRequest, 50)).rejects.toMatchObject({ status: 400 })
  })
  it('rejects invalid and excessive declared lengths', async () => {
    for (const [length, status] of [['-1', 400], ['51', 413]] as const) {
      await expect(readBoundedJSON({ headers: new Headers({ 'content-length': length }) } as PayloadRequest, 50)).rejects.toMatchObject({ status })
    }
  })
})
