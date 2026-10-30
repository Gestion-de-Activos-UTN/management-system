import { beforeEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { calculateRisk } from './engine'
import { calculateRiskForScope } from './recalculateRisk'
import { assignedOfficeRisk } from './assigned-office-risk'

vi.mock('./recalculateRisk', () => ({ calculateRiskForScope: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const ctx = {
  role: 'office_manager',
  organizationId: 'org',
  officeIds: ['a', 'b'],
  isActive: true,
} as TenantContext
const req = {
  payload: { create: vi.fn() },
  url: 'http://localhost/?office_ids=foreign',
} as unknown as PayloadRequest

it.each(['org_viewer', 'org_admin', 'platform_admin'] as const)(
  'does not grant the Manager-only aggregate route to %s',
  async role => {
    await expect(assignedOfficeRisk(req, { ...ctx, role })).rejects.toThrow('forbidden')
    expect(calculateRiskForScope).not.toHaveBeenCalled()
  }
)
it('rejects an inactive membership before reading evidence', async () => {
  await expect(assignedOfficeRisk(req, { ...ctx, isActive: false })).rejects.toThrow('forbidden')
  expect(calculateRiskForScope).not.toHaveBeenCalled()
})
it('takes scope from membership and never creates a reference to a nonexistent persisted evaluation', async () => {
  vi.mocked(calculateRiskForScope).mockResolvedValue({
    result: calculateRisk([], []),
    policy: 'essential',
    evaluatedAt: new Date('2026-10-30T00:00:00Z'),
    undeterminedExposure: [],
    officeIds: ['a', 'b'],
  })
  const view = await assignedOfficeRisk(req, ctx)
  expect(calculateRiskForScope).toHaveBeenCalledWith(
    req.payload,
    { organizationId: 'org', officeIds: ['a', 'b'] },
    req
  )
  expect(view.evaluation.id).toBeNull()
  expect(view.evaluation.score).toBeNull()
  expect(view.contributions).toEqual([])
  expect(req.payload.create).not.toHaveBeenCalled()
})
