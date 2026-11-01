import { beforeEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { calculateRisk } from './engine'
import { calculateRiskForScope } from './recalculateRisk'
import { assignedOfficeRisk } from './assigned-office-risk'
import { evaluationFromResult } from './evaluation-from-result'
import { RISK_CATALOG_VERSION, RISK_ENGINE_VERSION } from './constants'

vi.mock('./recalculateRisk', () => ({ calculateRiskForScope: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const ctx = {
  role: 'office_manager',
  organizationId: 'org',
  officeIds: ['a', 'b'],
  isActive: true,
} as TenantContext
const req = {
  payload: { create: vi.fn(), find: vi.fn(async () => ({ docs: [] })) },
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

const calculated = () => ({
  result: calculateRisk([], []),
  policy: 'essential' as const,
  evaluatedAt: new Date('2026-10-30T00:00:00Z'),
  undeterminedExposure: [],
  officeIds: [],
})
const withJob = (job: { id: string; processing?: boolean; hasError?: boolean } | undefined) =>
  ({
    payload: {
      create: vi.fn(),
      find: vi.fn(async ({ collection }: { collection: string }) => ({
        docs: collection === 'payload-jobs' && job ? [job] : [],
      })),
    },
  }) as unknown as PayloadRequest

it('shares the organization recalculation state and recalculates only when its signal changes', async () => {
  vi.mocked(calculateRiskForScope).mockResolvedValue(calculated())
  const scoped = { ...ctx, officeIds: ['signal'] }
  const processing = withJob({ id: 'job-1', processing: true })
  expect((await assignedOfficeRisk(processing, scoped)).recalculation).toBe('processing')
  expect((await assignedOfficeRisk(processing, scoped)).recalculation).toBe('processing')
  expect(calculateRiskForScope).toHaveBeenCalledTimes(1)
  const failed = withJob({ id: 'job-1', hasError: true })
  expect((await assignedOfficeRisk(failed, scoped)).recalculation).toBe('failed')
  expect(calculateRiskForScope).toHaveBeenCalledTimes(1)
  const superseded = withJob({ id: 'job-2' })
  expect((await assignedOfficeRisk(superseded, scoped)).recalculation).toBe('pending')
  expect(calculateRiskForScope).toHaveBeenCalledTimes(2)
  expect((await assignedOfficeRisk(withJob(undefined), scoped)).recalculation).toBe('current')
  expect(calculateRiskForScope).toHaveBeenCalledTimes(3)
})

it('does not share a calculation started inside a transaction', async () => {
  vi.mocked(calculateRiskForScope).mockResolvedValue(calculated())
  const inTransaction = Object.assign(withJob(undefined), { transactionID: 'tx' })
  const scoped = { ...ctx, officeIds: ['transaction'] }
  await assignedOfficeRisk(inTransaction, scoped)
  await assignedOfficeRisk(inTransaction, scoped)
  expect(calculateRiskForScope).toHaveBeenCalledTimes(2)
})

it('builds the live evaluation with the same fields a persisted evaluation stores', async () => {
  vi.mocked(calculateRiskForScope).mockResolvedValue(calculated())
  const view = await assignedOfficeRisk(withJob(undefined), { ...ctx, officeIds: ['fields'] })
  expect(view.evaluation).toEqual({
    id: null,
    evaluated_at: '2026-10-30T00:00:00.000Z',
    ...evaluationFromResult(calculated()),
  })
  expect(view.evaluation.engine_version).toBe(RISK_ENGINE_VERSION)
  expect(view.evaluation.catalog_version).toBe(RISK_CATALOG_VERSION)
})
