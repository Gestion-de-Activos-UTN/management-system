import { expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'
import { reportsEndpoint } from './reports'
import { agentProvisioningEndpoint } from './agentProvisioning'
import { HeartbeatPayloadSchema } from '@/contracts/heartbeat.schema'
import { OrganizationSettingsFormSchema } from '@/modules/organization-settings/schema'
import { AssessmentAnswerDraftSchema } from '@/modules/assessments/schema'
import {
  evaluateAutomaticComplianceForAssessment,
  reevaluateComplianceAfterScan,
} from '@/domain/assessments/evaluateAutomaticCompliance'
import { resolveBulkAssessmentPreview } from '@/domain/assessments/bulkAssessmentLifecycle'
import { reconcileOrganizationAssessments } from '@/domain/assessments/reconcileAssessmentInstance'
import { assessmentsListEndpoint } from './assessments'
import { getAgentQuota } from '@/domain/subscriptions/agent-quota'
import { enqueueOrganizationRiskRecalculation } from '@/domain/risk/enqueueRiskRecalculation'
import { buildAgentPackage } from '@/domain/agents/buildAgentPackage'

vi.mock('@/access/middleware/resolveAgentAuth', () => ({
  resolveAgentAuth: vi.fn(async () => ({ agentId: 'a', officeId: 'o', organizationId: 'g' })),
  createPayloadAgentAuthDeps: () => ({ resetAttempts: vi.fn(async () => undefined) }),
  AgentAuthError: class extends Error {
    status = 401
  },
}))
vi.mock('@/access/tenant/resolveTenantContext', () => ({
  getTenantContext: vi.fn(async () => ({
    role: 'org_admin',
    isActive: true,
    organizationId: 'g',
    officeIds: ['o'],
    userId: 'u',
    isPlatformAdmin: false,
  })),
}))
vi.mock('@/domain/agents/buildAgentPackage', async importOriginal => ({
  ...(await importOriginal<typeof import('@/domain/agents/buildAgentPackage')>()),
  buildAgentPackage: vi.fn(async () => {
    throw new Error('Package IO failure')
  }),
}))
vi.mock('@/domain/risk/enqueueRiskRecalculation', () => ({
  enqueueRiskRecalculation: vi.fn(),
  enqueueOrganizationRiskRecalculation: vi.fn(),
}))

// Assertions capture defects under controlled doubles. They do not assert HTTP/DB integration.
it('SEC-02: missing Content-Length is bounded before JSON parsing', async () => {
  const parse = vi.fn(async () => ({ padding: 'x'.repeat(5 * 1024 * 1024) }))
  const response = (await reportsEndpoint.handler!({
    headers: new Headers(),
    payload: {},
    json: parse,
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)) } }),
  } as unknown as PayloadRequest)) as Response
  expect(response.status).toBe(413)
  expect(parse).not.toHaveBeenCalled()
})

it('SEC-02: declared oversized body is rejected before JSON parsing (negative control)', async () => {
  const parse = vi.fn()
  const response = (await reportsEndpoint.handler!({
    headers: new Headers({ 'content-length': String(6 * 1024 * 1024) }),
    payload: {},
    json: parse,
  } as unknown as PayloadRequest)) as Response
  expect(response.status).toBe(413)
  expect(parse).not.toHaveBeenCalled()
})

it('SEC-24: heartbeat rejects unbounded identifiers and arbitrary extra fields', () => {
  const input = {
    agent_id: 'a'.repeat(100000),
    timestamp: new Date().toISOString(),
    status: 'idle',
    extra: 'x'.repeat(2 * 1024 * 1024),
  }
  expect(HeartbeatPayloadSchema.safeParse(input).success).toBe(false)
})

it('VAL-03: server schema rejects missing/oversized justification and trims valid values', () => {
  const answer = { question_key: 'q', question_version: 2, option_key: 'not_applicable' }
  expect(AssessmentAnswerDraftSchema.safeParse(answer).success).toBe(false)
  expect(
    AssessmentAnswerDraftSchema.safeParse({ ...answer, justification: 'x'.repeat(2001) }).success
  ).toBe(false)
  expect(
    AssessmentAnswerDraftSchema.parse({ ...answer, justification: ' accepted ' }).justification
  ).toBe('accepted')
})

it('VAL-04: settings schema rejects values outside predefined choices', () => {
  expect(
    OrganizationSettingsFormSchema.safeParse({
      offline_after_hours: 1000000,
      snapshot_before_each_scan: false,
      snapshot_interval_days: 32,
    }).success
  ).toBe(false)
})

it('SEC-26: quota requests all records and includes the 5001st agent', async () => {
  const find = vi.fn(async ({ collection }: { collection: string }) => {
    if (collection === 'subscriptions') return { docs: [{ level: 'premium' }] }
    if (collection === 'offices') return { docs: [{ id: 'o' }], totalDocs: 1 }
    return {
      docs: Array.from({ length: 5001 }, (_, i) => ({
        id: `a${i}`,
        office: 'o',
        lifecycle_status: 'active',
      })),
      totalDocs: 5001,
      hasNextPage: true,
    }
  })
  const quota = await getAgentQuota({ find } as unknown as Payload, 'g')
  expect(quota.used).toBe(5001)
  expect(find.mock.calls.find(([a]) => a.collection === 'agents')?.[0]).toMatchObject({ pagination: false })
  expect(find.mock.calls.filter(([a]) => a.collection === 'agents')).toHaveLength(1)
})

it('SEC-34: monitoring includes the online 101st agent', async () => {
  const agents = Array.from({ length: 101 }, (_, i) => ({
    id: `a${i}`,
    lifecycle_status: 'active',
    last_heartbeat_at: i === 100 ? new Date().toISOString() : '2000-01-01T00:00:00.000Z',
  }))
  const create = vi.fn(async args => args.data)
  const find = vi.fn(async ({ collection, limit }: { collection: string; limit: number }) =>
    collection === 'agents'
      ? { docs: agents.slice(0, limit), totalDocs: 101, hasNextPage: false }
      : { docs: [] }
  )
  await evaluateAutomaticComplianceForAssessment(
    { find, create } as unknown as Payload,
    {
      scope: 'office',
      office: 'o',
      organization: 'g',
      policy_key: 'essential',
      policy_version: 2,
    } as never
  )
  expect(create.mock.calls[0][0].data.status).toBe('compliant')
})

it('SEC-16/06: package failure leaves no agent and URL uses configured origin', async () => {
  const create = vi.fn(async () => ({ id: 'created-agent' }))
  const payload = {
    findByID: async () => ({ id: 'o', organization: 'g', is_active: true }),
    create,
    find: async ({ collection }: { collection: string }) =>
      collection === 'subscriptions'
        ? { docs: [{ level: 'premium' }] }
        : collection === 'offices'
          ? { docs: [{ id: 'o' }], totalDocs: 1 }
          : { docs: [] },
  }
  const req = {
    payload,
    url: 'http://caller-origin.test/api/v1/agents/provision',
    json: async () => ({ office_id: 'o' }),
  } as unknown as PayloadRequest
  await expect(agentProvisioningEndpoint.handler!(req)).rejects.toThrow('Package IO failure')
  expect(create).not.toHaveBeenCalled()
  expect(vi.mocked(buildAgentPackage).mock.calls[0][0].platformUrl).toBe(
    'http://localhost:3001/api/v1/reports'
  )
})

it('SEC-51: refresh processes remaining organizations and retains failure for retry', async () => {
  const config = await (await import('../payload.config')).default
  const task = config.jobs.tasks!.find(t => typeof t !== 'string' && t.slug === 'refresh-risk')!
  const enqueue = vi.mocked(enqueueOrganizationRiskRecalculation)
  enqueue.mockClear()
  enqueue.mockImplementation(async (_payload, id) => {
    if (id === 'second') throw new Error('Queue failure')
  })
  const req = {
    payload: { find: async () => ({ docs: [{ id: 'first' }, { id: 'second' }, { id: 'third' }] }) },
  }
  await expect((task as any).handler({ req, input: {} })).rejects.toThrow('could not queue every organization')
  expect(enqueue.mock.calls.map(call => call[1])).toEqual(['first', 'second', 'third'])
})

it('SEC-12: a relevant service beyond 500 results is included through bounded pages', async () => {
  const prior = Array.from({ length: 501 }, (_, i) => ({
    id: `r${i}`,
    service_key: `tcp:${i}`,
    check_key: 'network.fixture',
    control_key: 'A.8.21',
    status: 'non_compliant',
    severity: 'high',
  }))
  const create = vi.fn(async args => args.data)
  const find = vi.fn(async ({ collection, limit, page = 1 }: { collection: string; limit: number; page?: number }) =>
    collection === 'compliance-results'
      ? { docs: prior.slice((page - 1) * limit, page * limit), totalDocs: 501, hasNextPage: page * limit < prior.length }
      : { docs: [] }
  )
  const findByID = async () => ({
    id: 'a',
    identified: true,
    status: 'active',
    confirmed_type: 'server',
    port_scan_coverage: [{ protocol: 'tcp', status: 'complete', port_spec: '0-1000' }],
    asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
    services: [],
  })
  await evaluateAutomaticComplianceForAssessment(
    { find, findByID, create } as unknown as Payload,
    {
      scope: 'asset',
      asset: 'a',
      office: 'o',
      organization: 'g',
      policy_key: 'essential',
      policy_version: 2,
    } as never
  )
  const closed = create.mock.calls
    .map(([arg]) => arg.data)
    .filter(row => row.reason_code === 'service_no_longer_observed')
  expect(closed).toHaveLength(501)
  expect(closed.some(row => row.service_key === 'tcp:500')).toBe(true)
})

it('SEC-13: office cycle beyond 500 candidates is evaluated', async () => {
  const find = vi.fn(async ({ collection }: { collection: string }) => {
    if (collection === 'organization-settings')
      return { docs: [{ assessment_policy_key: 'essential', assessment_policy_version: 2 }] }
    if (collection === 'subscriptions')
      return { docs: [{ features: { security_assessments: true } }] }
    if (collection === 'assessment-instances')
      return {
        docs: [...Array.from({ length: 500 }, (_, i) => ({
          id: `cycle${i}`,
          organization: 'g',
          office: 'o',
          asset: 'a',
          scope: 'asset',
          policy_key: 'essential',
          policy_version: 2,
        })), { id: 'office-cycle', organization: 'g', office: 'o', scope: 'office', policy_key: 'essential', policy_version: 2 }],
        totalDocs: 501,
        hasNextPage: true,
      }
    return { docs: [] }
  })
  const create = vi.fn(async args => args.data)
  const findByID = async () => ({ id: 'a', status: 'active', services: [], asset_coverage: {} })
  await reevaluateComplianceAfterScan({ find, create, findByID } as unknown as Payload, 'g', 'o', [
    'a',
  ])
  expect(find.mock.calls.filter(([arg]) => arg.collection === 'agents')).toHaveLength(1)
  expect(create.mock.calls.some(([arg]) => arg.data.check_key === 'office.monitoring.active')).toBe(
    true
  )
})

it('SEC-29: list returns the complete 5001-record history without truncation', async () => {
  const find = vi.fn(async ({ collection }: { collection: string }) =>
    collection === 'subscriptions'
      ? { docs: [{ features: { security_assessments: true } }] }
      : {
          docs: Array.from({ length: 5001 }, (_, i) => ({
            id: `c${i}`,
            organization: 'g',
            scope: 'organization',
            status: 'completed',
          })),
          totalDocs: 5001,
          totalPages: 2,
          hasNextPage: true,
        }
  )
  const req = {
    payload: { find },
    url: 'http://localhost/api/v1/assessments',
  } as unknown as PayloadRequest
  const response = (await assessmentsListEndpoint.handler!(req)) as Response
  const data = await response.json()
  expect(data.totalDocs).toBe(5001)
  expect(find.mock.calls.find(([a]) => a.collection === 'assessment-instances')?.[0]).toMatchObject({ pagination: false })
  expect(data.hasNextPage).toBe(false)
})

it('SEC-28: bulk preview includes the 5001st target without an arbitrary answer-row limit', async () => {
  const targets = Array.from({ length: 5001 }, (_, i) => ({
    id: `a${i}`,
    alias: `asset${i}`,
    organization: 'g',
    office: 'o',
    status: 'active',
    confirmed_type: 'workstation',
    identified: true,
    identification_status: 'confirmed',
  }))
  const instances = targets.map(a => ({
    id: `c${a.id}`,
    organization: 'g',
    office: 'o',
    asset: a.id,
    scope: 'asset',
    status: 'pending',
    question_set_snapshot: [{ key: 'q', version: 2 }],
  }))
  const find = vi.fn(async ({ collection, limit }: { collection: string; limit: number }) => {
    if (collection === 'assessment-instances')
      return { docs: instances.slice(0, limit), totalDocs: 5001, hasNextPage: true }
    if (collection === 'assets') return { docs: targets.slice(0, limit) }
    return { docs: [] }
  })
  const fake = { find } as unknown as Payload
  const preview = await resolveBulkAssessmentPreview(
    fake,
    { organizationId: 'g', role: 'org_admin', isPlatformAdmin: false } as never,
    { mode: 'organization', risk_asset_type: 'workstation' },
    { payload: fake } as PayloadRequest
  )
  expect(preview.applicable).toHaveLength(5001)
  expect(find.mock.calls.find(([arg]) => arg.collection === 'assessment-answers')?.[0]).toMatchObject({ pagination: false, select: { assessment: true } })
})

it('SEC-30: policy reconciliation includes the 1001st office', async () => {
  const offices = Array.from({ length: 1001 }, (_, i) => ({ id: `o${i}`, is_active: true }))
  const findByID = async () => ({ id: 'g', is_active: true })
  const find = vi.fn(async ({ collection, limit }: { collection: string; limit: number }) =>
    collection === 'offices'
      ? { docs: offices.slice(0, limit), totalDocs: 1001, hasNextPage: true }
      : { docs: [] }
  )
  await reconcileOrganizationAssessments(
    { find, findByID } as unknown as Payload,
    'g',
    'policy_changed'
  )
  expect(find.mock.calls.filter(([arg]) => arg.collection === 'offices')).toHaveLength(1)
  // Each represented office plus organization executes exactly one open-cycle lookup.
  expect(find.mock.calls.filter(([arg]) => arg.collection === 'assessment-instances')).toHaveLength(
    1002
  )
})
