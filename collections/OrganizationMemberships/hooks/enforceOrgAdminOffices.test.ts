import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CollectionBeforeChangeHook } from 'payload'
import { enforceOrgAdminOffices } from './enforceOrgAdminOffices'

test('org_admin membership always receives every office in its organization', async () => {
  const result = await enforceOrgAdminOffices({
    data: { organization: 'org-1', role: 'role-admin', offices: ['office-1'] },
    originalDoc: undefined,
    req: {
      payload: {
        findByID: async () => ({ id: 'role-admin', slug: 'org_admin' }),
        find: async () => ({ docs: [{ id: 'office-1' }, { id: 'office-2' }] }),
      },
    },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])

  assert.deepEqual(result?.offices, ['office-1', 'office-2'])
})

test('non-admin membership preserves its explicitly assigned offices', async () => {
  const data = { organization: 'org-1', role: 'role-manager', offices: ['office-1'] }
  const result = await enforceOrgAdminOffices({
    data,
    originalDoc: undefined,
    req: {
      payload: {
        findByID: async () => ({ id: 'role-manager', slug: 'office_manager' }),
      },
    },
  } as unknown as Parameters<CollectionBeforeChangeHook>[0])

  assert.equal(result, data)
})
