import type { PayloadRequest } from 'payload'

export class RequestBodyError extends Error {
  constructor(message: string, public readonly status: 400 | 413) {
    super(message)
  }
}

/** Count wire bytes before decoding or parsing, including requests without Content-Length. */
export async function readBoundedJSON(req: PayloadRequest, maxBytes: number): Promise<unknown> {
  const declared = req.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    throw new RequestBodyError('invalid content-length', 400)
  if (declared !== null && Number(declared) > maxBytes)
    throw new RequestBodyError('payload too large', 413)
  if (!req.body) {
    // Payload Local API callers have no wire stream; HTTP requests always use the branch below.
    if (!req.json) throw new RequestBodyError('missing payload', 400)
    let value: unknown
    try { value = await req.json() } catch { throw new RequestBodyError('invalid JSON', 400) }
    if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > maxBytes)
      throw new RequestBodyError('payload too large', 413)
    return value
  }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new RequestBodyError('payload too large', 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch { throw new RequestBodyError('invalid JSON', 400) }
}
