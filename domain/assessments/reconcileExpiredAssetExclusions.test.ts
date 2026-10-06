import assert from 'node:assert/strict'
import test from 'node:test'
import type { Payload } from 'payload'
import { reconcileExpiredAssetExclusions } from './reconcileExpiredAssetExclusions'

test('reincludes expired assets from both inventories and only queries dated exclusions', async () => {
  const finds: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    async find(args: Record<string, unknown>) {
      finds.push(args)
      return { docs: [{ id: args.collection === 'assets' ? 'network-1' : 'manual-1' }] }
    },
    async update(args: Record<string, unknown>) {
      updates.push(args)
      return { id: args.id }
    },
  } as unknown as Payload

  const now = new Date('2026-09-12T12:00:00.000Z')
  const result = await reconcileExpiredAssetExclusions(payload, now)

  assert.deepEqual(result, { network_assets_reincluded: 1, manual_assets_reincluded: 1 })
  assert.equal(updates.length, 2)
  assert.deepEqual(
    updates.map(update => update.data),
    [{ assessment_scope: 'included' }, { assessment_scope: 'included' }]
  )
  for (const find of finds) {
    const where = find.where as { and: Array<Record<string, unknown>> }
    assert.deepEqual(where.and, [
      { assessment_scope: { equals: 'excluded' } },
      { assessment_excluded_until: { less_than_equal: now.toISOString() } },
    ])
  }
})
