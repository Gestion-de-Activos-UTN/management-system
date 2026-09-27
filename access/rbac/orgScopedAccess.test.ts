import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { scopeWhere } from './orgScopedAccess'

const scope = { kind: 'org_offices', field: 'office' } as const
const ctx = { organizationId: 'org-1', officeIds: ['office-1', 'office-2'] }

describe('org_offices row scope', () => {
  it('org-wide roles see the whole organization, including org-level rows', () => {
    for (const role of ['org_admin', 'platform_admin'] as const)
      assert.deepEqual(scopeWhere(scope, { ...ctx, role }), {
        organization: { equals: 'org-1' },
      })
  })

  it('office-scoped roles only see their offices, which also drops office = null rows', () => {
    for (const role of ['office_manager', 'org_viewer'] as const)
      assert.deepEqual(scopeWhere(scope, { ...ctx, role }), {
        and: [{ organization: { equals: 'org-1' } }, { office: { in: ['office-1', 'office-2'] } }],
      })
  })

  it('denies without an organization context', () => {
    assert.equal(scopeWhere(scope, { ...ctx, organizationId: null, role: 'org_admin' }), false)
  })
})
