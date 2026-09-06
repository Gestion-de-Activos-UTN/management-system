import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Payload } from 'payload'
import { expireRawScanPayloads } from './expireRawScanPayloads'

test('expireRawScanPayloads clears raw data but keeps report documents', async () => {
  let queried = false
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    async find() {
      if (queried) return { docs: [] }
      queried = true
      return { docs: [{ id: 'report-1' }, { id: 'report-2' }] }
    },
    async update({ id, data }: { id: string; data: Record<string, unknown> }) {
      updates.push({ id, ...data })
      return { id }
    },
  } as unknown as Payload

  const result = await expireRawScanPayloads(payload, new Date('2026-01-01T00:00:00.000Z'))

  assert.deepEqual(result, { expired: 2 })
  assert.deepEqual(updates, [
    { id: 'report-1', raw_payload: null, raw_payload_expires_at: null },
    { id: 'report-2', raw_payload: null, raw_payload_expires_at: null },
  ])
})
