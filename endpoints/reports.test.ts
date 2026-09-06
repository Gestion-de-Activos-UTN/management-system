import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PayloadRequest } from 'payload'
import { reportsEndpoint } from './reports'

test('reports endpoint rejects an oversized body before authentication or writes', async () => {
  const request = {
    headers: new Headers({ 'content-length': String(6 * 1024 * 1024) }),
  } as unknown as PayloadRequest

  const response = await reportsEndpoint.handler(request)
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'payload too large' })
})
