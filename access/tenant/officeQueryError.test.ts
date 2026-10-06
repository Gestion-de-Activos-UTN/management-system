import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { officeQueryError } from './officeQueryError'

describe('officeQueryError', () => {
  it('lets org-wide roles read the organization view or any of their offices', () => {
    const ctx = { role: 'org_admin' as const, officeIds: ['office-1'] }
    assert.equal(officeQueryError(ctx, undefined), null)
    assert.equal(officeQueryError(ctx, 'office-1'), null)
    assert.equal(officeQueryError(ctx, 'office-9'), 'office_forbidden')
  })

  it('requires office-scoped roles to name one of their offices', () => {
    for (const role of ['office_manager', 'org_viewer'] as const) {
      const ctx = { role, officeIds: ['office-1'] }
      assert.equal(officeQueryError(ctx, null), 'office_required')
      assert.equal(officeQueryError(ctx, 'office-1'), null)
      assert.equal(officeQueryError(ctx, 'office-2'), 'office_forbidden')
    }
  })
})
