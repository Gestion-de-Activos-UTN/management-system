import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CollectionAfterChangeHook } from 'payload'
import { syncOrgAdminMemberships } from './syncOrgAdminMemberships'

test('a new office is propagated to every org_admin membership', async () => {
  const updates: Array<{ id: string | number; offices: unknown[] }> = []
  const find = async ({ collection }: { collection: string }) =>
    collection === 'roles'
      ? { docs: [{ id: 'role-admin', slug: 'org_admin' }] }
      : {
          docs: [
            { id: 'membership-1', offices: ['office-1'] },
            { id: 'membership-2', offices: [] },
          ],
        }
  await syncOrgAdminMemberships({
    doc: { id: 'office-2', organization: 'org-1' },
    operation: 'create',
    req: {
      payload: {
        find,
        update: async ({ id, data }: { id: string | number; data: { offices: unknown[] } }) => {
          updates.push({ id, offices: data.offices })
          return { id }
        },
      },
    },
  } as unknown as Parameters<CollectionAfterChangeHook>[0])

  assert.deepEqual(updates, [
    { id: 'membership-1', offices: ['office-1', 'office-2'] },
    { id: 'membership-2', offices: ['office-2'] },
  ])
})
