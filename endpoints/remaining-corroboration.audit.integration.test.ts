import { resolveInventoryIncidentEndpoint } from './inventoryIncidents'
import { completeTask } from '@/domain/tasks/task-actions'
import { logicalDeleteEndpoint } from '@/domain/assets/logical-delete'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLocalReq, getPayload, type Payload } from 'payload'
import type { AgentAuthResult } from '@/access/middleware/resolveAgentAuth'
import { seedRiskOrganization, member } from '@/domain/risk/risk-integration-seed'
import { processScanReport } from '@/domain/inventories/processScanReport'
import { ingestScanReport } from '@/domain/inventories/ingestScanReport'
import { auditAsset, auditReport } from '@/domain/inventories/remaining-audit-fixtures'
import { ScanReportPayloadSchema } from '@/contracts/scan-report.schema'
import { agingSweep } from '@/domain/inventories/agingSweep'
import { createInventorySnapshot } from '@/domain/inventories/createInventorySnapshot'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'
import { relationId } from '@/lib/relationId'
import { saveAssessmentDraft } from '@/domain/assessments/assessmentLifecycle'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import { reconcileExpiredAssessments } from '@/domain/assessments/reconcileExpiredAssessments'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import { evaluateAutomaticComplianceForAssessment } from '@/domain/assessments/evaluateAutomaticCompliance'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { createTasks, assertCanReadTask, claimTask } from '@/domain/tasks/task-actions'
import { handleEndpoints } from 'payload'
import { seedDemoData } from '@/domain/demo/seedDemoData'

// Regression tests converted from corroboration probes as the audit fixes were applied.
// Integration uses only the disposable database guarded below.
let payload: Payload
beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_audit_security_remaining(?:_[a-z]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Only the disposable remaining-audit database is allowed')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required')
  process.env.PAYLOAD_SECRET = 'disposable-remaining-audit-secret'
  const config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
})
afterAll(async () => {
  vi.restoreAllMocks()
  if (payload) await payload.destroy()
})

async function scope() {
  const s = await seedRiskOrganization(payload)
  const auth: AgentAuthResult = {
    organizationId: String(s.organization.id),
    officeId: String(s.office.id),
    agentId: relationId(s.server.agent),
  }
  return { ...s, auth }
}
const assetDoc = async (id: string) =>
  payload.findByID({ collection: 'assets', id, overrideAccess: true, depth: 0 })

it('SEC-09/10: concurrent identical retries apply inventory and snapshot once', async () => {
  const { auth } = await scope()
  const report = auditReport(auth, [auditAsset(auth, { mac: '00:11:22:AB:CD:EF' })])
  const results = await Promise.all([processScanReport(payload, report, auth), processScanReport(payload, report, auth)])
  expect(results.filter(result => result.alreadyProcessed)).toHaveLength(1)
  const assets = await payload.find({ collection: 'assets', overrideAccess: true,
    where: { organization: { equals: auth.organizationId }, mac: { equals: '00:11:22:AB:CD:EF' } } })
  expect(assets.totalDocs).toBe(1)
  const snapshots = await payload.find({ collection: 'inventory-snapshots', overrideAccess: true,
    where: { office: { equals: auth.officeId } } })
  expect(snapshots.totalDocs).toBe(1)
  await expect(processScanReport(payload, { ...report, gateway_ip: '10.0.0.1' }, auth)).rejects.toMatchObject({ status: 409 })
})

it('REVIEW-02: concurrent distinct reports read each other after the organization lock', async () => {
  const { auth } = await scope()
  const reports = ['91', '92'].map(octet =>
    auditReport(auth, [auditAsset(auth, { ip: `10.0.0.${octet}`, mac: `00:11:22:33:44:${octet}` })])
  )
  const results = await Promise.all(reports.map(report => processScanReport(payload, report, auth)))
  expect(results.map(result => [result.status, result.alreadyProcessed])).toEqual([['processed', false], ['processed', false]])
  // The second report must see the snapshot the first committed while it waited on the lock.
  const snapshots = await payload.find({ collection: 'inventory-snapshots', overrideAccess: true,
    where: { office: { equals: auth.officeId } } })
  expect(snapshots.totalDocs).toBe(1)
})

it('SEC-38: anonymous first-register remains closed with an empty Admins collection', async () => {
  expect((await payload.count({ collection: 'admins', overrideAccess: true })).totalDocs).toBe(0)
  const role = await payload.create({
    collection: 'roles',
    overrideAccess: true,
    data: {
      name: 'Bootstrap platform',
      slug: 'platform_admin',
      rank: 0,
      scope: 'platform',
      is_platform_role: true,
    },
  })
  const request = () =>
    new Request('http://localhost/api/admins/first-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `bootstrap-${crypto.randomUUID()}@example.test`,
        password: 'x'.repeat(12),
        role: role.id,
      }),
    })
  const first = await handleEndpoints({ config: payload.config, request: request() })
  expect(first.status).toBe(403)
  expect((await payload.count({ collection: 'admins', overrideAccess: true })).totalDocs).toBe(0)
  expect((await handleEndpoints({ config: payload.config, request: request() })).status).toBe(403)
})

it('SEC-03: future and reversed scan times cannot persist through the shared processing path', async () => {
  const { auth } = await scope()
  const future = auditAsset(auth, {
    scan_time: '2099-01-01T00:00:00.000Z',
    hostname: 'future',
    host_scripts: { marker: 'future' },
  })
  const report = auditReport(auth, [future], {
    scan_start: '2099-02-01T00:00:00.000Z',
    scan_end: '2000-01-01T00:00:00.000Z',
  })
  expect(ScanReportPayloadSchema.safeParse(report).success).toBe(false)
  await expect(processScanReport(payload, report, auth)).rejects.toMatchObject({ status: 400 })
})

it('SEC-11: old report preserves services, date, offline status and hostname', async () => {
  const { auth } = await scope()
  const result = await ingestScanReport(
    payload,
    auditReport(auth, [auditAsset(auth, { hostname: 'recent' })]),
    auth
  )
  const id = result.processedDocumentIds[0],
    before = await assetDoc(id)
  await payload.update({
    collection: 'assets',
    id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { status: 'offline' },
  })
  await ingestScanReport(
    payload,
    auditReport(auth, [
      auditAsset(auth, { scan_time: '2000-01-01T00:00:00.000Z', hostname: 'obsolete' }),
    ]),
    auth
  )
  const doc = await assetDoc(id)
  expect(doc.last_seen).toBe(before.last_seen)
  expect(doc.status).toBe('offline')
  expect(doc.hostname).toBe('recent')
})

it('SEC-04: local MAC is scoped to office and organizations remain separate', async () => {
  const { auth, organization } = await scope()
  const asset = auditAsset(auth, {
    mac: '02:11:22:33:44:55',
    mac_metadata: { kind: 'locally_administered', vendor_resolution: 'not_attempted' },
  })
  const first = await ingestScanReport(payload, auditReport(auth, [asset]), auth)
  const office = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organization.id, name: 'Moved to' },
  })
  const agent = await payload.create({
    collection: 'agents',
    overrideAccess: true,
    context: { systemJob: true },
    data: { id: `audit-${crypto.randomUUID()}`, office: office.id },
  })
  const secondAuth = { ...auth, officeId: String(office.id), agentId: String(agent.id) }
  const second = await ingestScanReport(
    payload,
    auditReport(secondAuth, [auditAsset(secondAuth, { ...asset, agent_id: secondAuth.agentId })]),
    secondAuth
  )
  expect(second.processedDocumentIds).not.toEqual(first.processedDocumentIds)
  expect(relationId((await assetDoc(first.processedDocumentIds[0])).office)).toBe(auth.officeId)
  const foreign = await scope()
  const separate = await ingestScanReport(
    payload,
    auditReport(foreign.auth, [
      auditAsset(foreign.auth, {
        ...asset,
        asset_id: `foreign-${crypto.randomUUID()}`,
        agent_id: foreign.auth.agentId,
      }),
    ]),
    foreign.auth
  )
  expect(separate.processedDocumentIds[0]).not.toBe(first.processedDocumentIds[0])
})

it('SEC-04: non-CIDR networks and hosts outside declared network are rejected', async () => {
  const { auth } = await scope()
  for (const network of ['not-a-cidr', '192.168.1.0/24']) {
    const report = auditReport(auth, [auditAsset(auth)], { network })
    expect(ScanReportPayloadSchema.safeParse(report).success).toBe(false)
    await expect(processScanReport(payload, report, auth)).rejects.toMatchObject({ status: 400 })
  }
})

it('SEC-44: OS is normalized to the strongest sorted candidate', async () => {
  const { auth } = await scope()
  const os = {
    name: 'low',
    accuracy: 10,
    cpe: [],
    osfamily: '',
    osgen: '',
    vendor: '',
    device_type: '',
  }
  const asset = auditAsset(auth, { os, os_candidates: [{ ...os, name: 'high', accuracy: 95 }, os] })
  const report = auditReport(auth, [asset])
  expect(ScanReportPayloadSchema.safeParse(report).success).toBe(true)
  const result = await ingestScanReport(payload, report, auth)
  const doc = await assetDoc(result.processedDocumentIds[0])
  expect(doc.os?.name).toBe('high')
  expect(doc.os_status).toBe('identified')
  const reversed = auditReport(auth, [{ ...asset, os_candidates: [os, { ...os, accuracy: 95 }] }])
  expect(ScanReportPayloadSchema.safeParse(reversed).success).toBe(true)
})

it('SEC-45: repeated IP with conflicting MAC rejects both observations', async () => {
  const { auth } = await scope()
  const report = auditReport(
    auth,
    ['00:11:22:33:44:55', '00:11:22:33:44:56'].map(mac =>
      auditAsset(auth, {
        mac,
        mac_metadata: { kind: 'globally_administered', vendor_resolution: 'not_found' },
      })
    )
  )
  expect(ScanReportPayloadSchema.safeParse(report).success).toBe(true)
  const result = await ingestScanReport(payload, report, auth)
  expect(result.processedDocumentIds).toEqual([])
  expect(result.rejectedAssets).toHaveLength(2)
})

it('SEC-46: failed report remains diagnostic and does not update inventory', async () => {
  const { auth } = await scope()
  const report = auditReport(auth, [auditAsset(auth)], { execution_status: 'failed' })
  expect(ScanReportPayloadSchema.safeParse(report).success).toBe(true)
  const result = await processScanReport(payload, report, auth)
  expect(result.status).toBe('failed')
  expect(result.processedDocumentIds).toEqual([])
})

it('SEC-09: another agent cannot resume an existing report with changed content', async () => {
  const original = await scope(),
    other = await scope()
  const report = auditReport(original.auth, [auditAsset(original.auth)])
  await payload.create({
    collection: 'scan-reports',
    overrideAccess: true,
    data: {
      id: report.report_id,
      agent: original.auth.agentId,
      office: original.auth.officeId,
      network: report.network,
      scan_start: report.scan_start,
      scan_end: report.scan_end,
      hosts_up: 1,
      execution_status: report.execution_status,
      raw_payload: report,
      status: 'received',
    },
  })
  const replacement = auditReport(
    other.auth,
    [auditAsset(other.auth, { hostname: 'replacement' })],
    { report_id: report.report_id }
  )
  await expect(processScanReport(payload, replacement, other.auth)).rejects.toMatchObject({ status: 409 })
  const stored = await payload.findByID({
    collection: 'scan-reports',
    id: report.report_id,
    overrideAccess: true,
    depth: 0,
  })
  expect(relationId(stored.office)).toBe(original.auth.officeId)
  expect(stored.status).toBe('received')
})

it('SEC-10: second asset failure rolls back the whole report; retry creates exactly one snapshot', async () => {
  const { auth } = await scope()
  await payload.update({
    collection: 'organization-settings',
    overrideAccess: true,
    where: { organization: { equals: auth.organizationId } },
    data: { snapshot_before_each_scan: true },
  })
  const report = auditReport(auth, [auditAsset(auth), auditAsset(auth, { ip: '10.0.0.91' })])
  const original = payload.create.bind(payload)
  const spy = vi.spyOn(payload, 'create').mockImplementation(async args => {
    if (args.collection === 'assets' && (args.data as Record<string, unknown>).ip === '10.0.0.91')
      throw new Error('Second asset INSERT failure')
    return original(args as never) as never
  })
  try {
    await expect(processScanReport(payload, report, auth)).rejects.toThrow('Second asset')
  } finally {
    spy.mockRestore()
  }
  expect(
    (
      await payload.find({
        collection: 'assets',
        overrideAccess: true,
        where: { and: [{ office: { equals: auth.officeId } }, { ip: { equals: '10.0.0.90' } }] },
      })
    ).totalDocs
  ).toBe(0)
  await expect(payload.findByID({ collection: 'scan-reports', id: report.report_id, overrideAccess: true })).rejects.toMatchObject({ status: 404 })
  await processScanReport(payload, report, auth)
  const snapshots = await payload.find({
    collection: 'inventory-snapshots',
    overrideAccess: true,
    where: { office: { equals: auth.officeId } },
    sort: 'taken_at',
  })
  expect(snapshots.totalDocs).toBe(1)
  expect((snapshots.docs[0].assets_dump as { network: unknown[] }).network.length).toBe(1)
  const replay = await processScanReport(payload, report, auth)
  expect(replay.alreadyProcessed).toBe(true)
})

it('SEC-48: required automatic snapshot failure rejects and rolls back the report', async () => {
  const { auth } = await scope()
  await payload.update({
    collection: 'organization-settings',
    overrideAccess: true,
    where: { organization: { equals: auth.organizationId } },
    data: { snapshot_before_each_scan: true },
  })
  const original = payload.create.bind(payload)
  const spy = vi.spyOn(payload, 'create').mockImplementation(async args => {
    if (args.collection === 'inventory-snapshots') throw new Error('Snapshot INSERT failure')
    return original(args as never) as never
  })
  try {
    await expect(processScanReport(payload, auditReport(auth, [auditAsset(auth)]), auth)).rejects.toThrow('Snapshot INSERT failure')
    expect(
      (
        await payload.find({
          collection: 'inventory-snapshots',
          overrideAccess: true,
          where: { office: { equals: auth.officeId } },
        })
      ).totalDocs
    ).toBe(0)
  } finally {
    spy.mockRestore()
  }
})

it('SEC-47: concurrent changes yield a coherent snapshot after transaction retry', async () => {
  const { server, auth } = await scope()
  const original = payload.find.bind(payload)
  let intercepted = false
  const spy = vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await original(args as never)
    if (!intercepted && args.collection === 'assets') {
      intercepted = true
      await payload.update({
        collection: 'assets',
        id: server.id,
        overrideAccess: true,
        context: { systemJob: true },
        data: { criticality: 'low' },
      })
    }
    return result as never
  })
  let snapshot
  try {
    snapshot = await createInventorySnapshot(payload, auth.officeId, { type: 'scheduled' })
  } finally {
    spy.mockRestore()
  }
  const dumped = (
    snapshot.assets_dump as { network: Array<{ id: string; criticality: string }> }
  ).network.find(d => d.id === server.id)
  expect(dumped?.criticality).toBe('low')
  const contributions = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    where: { evaluation: { equals: relationId(snapshot.risk_score) } },
    limit: 1000,
  })
  expect(
    contributions.docs
      .filter(c => c.asset_key === `asset:${server.id}`)
      .every(c => c.criticality === 'low')
  ).toBe(true)
  expect(contributions.docs.some(c => c.asset_key === `asset:${server.id}`)).toBe(true)
})

it('SEC-50: aging rechecks a fresh observation committed after its candidate selection', async () => {
  const { auth, server } = await scope()
  await payload.update({ collection: 'assets', id: server.id, overrideAccess: true,
    context: { systemJob: true }, data: { last_seen: '2000-01-01T00:00:00.000Z' } })
  const original = payload.find.bind(payload)
  let injected = false
  const spy = vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await original(args as never)
    if (!injected && args.collection === 'assets' && args.sort === 'id' && result.docs.some(row => row.id === server.id)) {
      injected = true
      await ingestScanReport(payload, auditReport(auth, [auditAsset(auth, { ip: server.ip!, mac: server.mac ?? '' })]), auth)
    }
    return result as never
  })
  try { await agingSweep(payload) } finally { spy.mockRestore() }
  const doc = await assetDoc(String(server.id))
  expect(injected).toBe(true)
  expect(Date.parse(doc.last_seen!)).toBeGreaterThan(Date.now() - 60000)
  expect(doc.status).toBe('active')
})

it('SEC-31: concurrent open cycles are rejected by database uniqueness', async () => {
  const { auth } = await scope()
  // A fresh office has no cycle; disable assessment hook indirectly by using an organization with no initial office cycle.
  await payload.delete({
    collection: 'assessment-instances',
    overrideAccess: true,
    where: { and: [{ office: { equals: auth.officeId } }, { scope: { equals: 'office' } }] },
  })
  const req1 = await createLocalReq({}, payload),
    req2 = await createLocalReq({}, payload)
  const tx1 = await payload.db.beginTransaction(),
    tx2 = await payload.db.beginTransaction()
  req1.transactionID = tx1!
  req2.transactionID = tx2!
  const subject = {
    scope: 'office' as const,
    id: auth.officeId,
    organizationId: auth.organizationId,
    is_active: true,
  }
  try {
    const first = await reconcileAssessmentInstance(payload, subject, 'initial', req1)
    const second = reconcileAssessmentInstance(payload, subject, 'initial', req2).then(value => ({ value }), error => ({ error }))
    expect(first.action).toBe('created')
    await payload.db.commitTransaction(tx1!)
    const outcome = await second
    if ('error' in outcome) {
      await payload.db.rollbackTransaction(tx2!)
    } else {
      expect(outcome.value.action).toBe('preserved')
      await payload.db.commitTransaction(tx2!)
    }
    const rows = await payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      where: {
        and: [
          { office: { equals: auth.officeId } },
          { scope: { equals: 'office' } },
          { status: { equals: 'pending' } },
        ],
      },
    })
    expect(rows.totalDocs).toBe(1)
  } finally {
    await payload.db.rollbackTransaction(tx1!)
    await payload.db.rollbackTransaction(tx2!)
  }
})

it('SEC-32: concurrent draft saves serialize and preserve one answer per question', async () => {
  const { auth } = await scope()
  const actor = await member(payload, auth.organizationId, [auth.officeId], 'org_admin')
  const cycle = await reconcileAssessmentInstance(
    payload,
    { scope: 'office', id: auth.officeId, organizationId: auth.organizationId, is_active: true },
    'initial'
  )
  await payload.update({
    collection: 'assessment-instances',
    id: cycle.id!,
    overrideAccess: true,
    data: { status: 'in_progress' },
  })
  const definition = RISK_QUESTIONS_V2.find(
    q => q.scope === 'office' && q.policies.includes('essential')
  )!
  const command = {
    answers: [
      {
        question_key: definition.key,
        question_version: definition.version,
        option_key: definition.options.find(o => o.key !== 'not_applicable')!.key,
      },
    ],
  }
  const req1 = await createLocalReq({}, payload),
    req2 = await createLocalReq({}, payload)
  const tx1 = await payload.db.beginTransaction(),
    tx2 = await payload.db.beginTransaction()
  req1.transactionID = tx1!
  req2.transactionID = tx2!
  try {
    await saveAssessmentDraft(payload, String(cycle.id), command, actor, req1)
    const second = saveAssessmentDraft(payload, String(cycle.id), command, actor, req2)
    await payload.db.commitTransaction(tx1!)
    await second
    await payload.db.commitTransaction(tx2!)
    expect(
      (
        await payload.find({
          collection: 'assessment-answers',
          overrideAccess: true,
          where: { assessment: { equals: cycle.id } },
        })
      ).totalDocs
    ).toBe(1)
  } finally {
    await payload.db.rollbackTransaction(tx1!)
    await payload.db.rollbackTransaction(tx2!)
  }
})

it('SEC-33: successful expiry reconciliation excludes already processed historical cycles', async () => {
  const { auth } = await scope()
  const cycle = await reconcileAssessmentInstance(
    payload,
    { scope: 'office', id: auth.officeId, organizationId: auth.organizationId, is_active: true },
    'initial'
  )
  await payload.update({
    collection: 'assessment-instances',
    id: cycle.id!,
    overrideAccess: true,
    data: { status: 'completed', due_at: '2000-01-01T00:00:00.000Z' },
  })
  const first = await reconcileExpiredAssessments(payload),
    second = await reconcileExpiredAssessments(payload)
  expect(first.expired_cycles_examined).toBeGreaterThan(0)
  expect(second.expired_cycles_examined).toBe(0)
  expect(second.cycles_created).toBe(0)
})

it('SEC-57 regression: real worker killed inside handler leaves processing=true and startup recovers it', async () => {
  const job = await payload.jobs.queue({
    task: 'reconcile-expired-asset-exclusions',
    queue: 'maintenance',
    input: {},
    meta: { scheduled: true },
  })
  try {
    await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import { getPayload } from 'payload';
      const config = await (await import('./payload.config.ts')).default;
      config.typescript.autoGenerate = false;
      config.admin.importMap.autoGenerate = false;
      config.jobs.autoRun = [];
      const task = config.jobs.tasks.find(t => t.slug === 'reconcile-expired-asset-exclusions');
      task.handler = async () => { process.kill(process.pid, 'SIGKILL'); };
      const app = await getPayload({ config, disableOnInit: true });
      await app.jobs.run({ queue: 'maintenance', limit: 1 });
      process.exit(2);
    `,
      ],
      { cwd: process.cwd(), env: { ...process.env }, timeout: 20000 }
    )
    throw new Error('Child unexpectedly survived')
  } catch (error) {
    expect((error as { signal?: string }).signal).toBe('SIGKILL')
  }
  expect(
    (await payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true }))
      .processing
  ).toBe(true)
  await payload.config.onInit!(payload)
  expect(
    (await payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true }))
      .processing
  ).toBe(false)
  await payload.jobs.run({ queue: 'maintenance' })
  await expect(
    payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
  ).rejects.toThrow()
})

it('SEC-20: filtered ports remain unknown instead of closing prior noncompliance', async () => {
  const { auth, server } = await scope()
  const now = new Date().toISOString()
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: {
      organization: auth.organizationId,
      office: auth.officeId,
      asset: server.id,
      control_key: 'A.8.21',
      check_key: 'network.telnet',
      service_key: 'tcp:23',
      status: 'non_compliant',
      severity: 'high',
      policy_key: 'essential',
      policy_version: 2,
      evaluated_at: now,
      valid_until: '2099-01-01T00:00:00.000Z',
      reason_code: 'fixture',
      explanation: 'Prior open telnet',
      evidence_snapshot: {},
    },
  })
  await payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      services: [{ port: 23, protocol: 'tcp', state: 'filtered', name: 'telnet', confidence: 10 }],
      asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
    },
  })
  await evaluateAutomaticComplianceForAssessment(payload, {
    organization: auth.organizationId,
    office: auth.officeId,
    asset: server.id,
    scope: 'asset',
    policy_key: 'essential',
    policy_version: 2,
  } as never)
  const rows = await payload.find({
    collection: 'compliance-results',
    overrideAccess: true,
    where: {
      and: [
        { asset: { equals: server.id } },
        { service_key: { equals: 'tcp:23' } },
        { reason_code: { equals: 'service_state_unconfirmed' } },
      ],
    },
  })
  expect(rows.totalDocs).toBe(1)
  expect(rows.docs[0].status).toBe('not_evaluable')
})

it('SEC-25/37/43: cookies reject foreign Origin and viewers receive only scanner status without JSON JWT', async () => {
  const { auth } = await scope()
  const viewer = await member(payload, auth.organizationId, [auth.officeId], 'org_viewer')
  const user = await payload.findByID({ collection: 'users', id: viewer, overrideAccess: true })
  const login = await handleEndpoints({
    config: payload.config,
    request: new Request('http://localhost/api/users/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'x'.repeat(12) }),
    }),
  })
  expect(login.status).toBe(200)
  expect(await login.json()).not.toHaveProperty('token')
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const result = await handleEndpoints({
    config: payload.config,
    request: new Request('http://localhost/api/v1/offices/agent-summary', {
      headers: { cookie, origin: 'https://untrusted.example.test' },
    }),
  })
  expect(result.status).toBe(401)
  const trusted = await handleEndpoints({ config: payload.config, request: new Request('http://localhost/api/v1/offices/agent-summary', {
    headers: { cookie, origin: 'http://localhost:3001' },
  }) })
  expect(trusted.status).toBe(200)
  const data = await trusted.json()
  expect(data.docs[0]).toEqual({ office_id: auth.officeId, scanner_status: 'online' })
  expect(data.quota).toBeNull()
})

it('SEC-53: moved task follows the asset and is visible only in its new office', async () => {
  const { auth, server } = await scope()
  await payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { identification_status: 'confirmed' },
  })
  const otherOffice = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: auth.organizationId, name: 'Destination office' },
  })
  const admin = await member(
    payload,
    auth.organizationId,
    [auth.officeId, String(otherOffice.id)],
    'org_admin'
  )
  const a = await member(payload, auth.organizationId, [auth.officeId], 'office_manager')
  const b = await member(payload, auth.organizationId, [String(otherOffice.id)], 'office_manager')
  const req = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  const ctx = (await getTenantContext(req))!
  const tasks = await createTasks(req, ctx, {
    title: 'Moved asset task',
    priority: 'normal',
    global: false,
    office_ids: [auth.officeId],
    assignment_kind: 'open_pool',
    related_entity: { relationTo: 'assets', value: String(server.id) },
  } as never)
  await payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { office: otherOffice.id },
  })
  const task = await payload.findByID({
    collection: 'tasks',
    id: tasks[0].id,
    overrideAccess: true,
    depth: 0,
  })
  expect(relationId(task.office)).toBe(String(otherOffice.id))
  for (const id of [a]) {
    const r = await createLocalReq({ user: { id, collection: 'users' } as never }, payload)
    await expect(assertCanReadTask(r, (await getTenantContext(r))!, task)).rejects.toMatchObject({
      status: 404,
    })
  }
  const newOfficeReq = await createLocalReq({ user: { id: b, collection: 'users' } as never }, payload)
  await expect(assertCanReadTask(newOfficeReq, (await getTenantContext(newOfficeReq))!, task)).resolves.toBeDefined()
})

it('SEC-53: retiring an asset cancels its task automatically and rejects a new claim', async () => {
  const { auth, server } = await scope()
  await payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { identification_status: 'confirmed' },
  })
  const admin = await member(payload, auth.organizationId, [auth.officeId], 'org_admin')
  const req = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  const tasks = await createTasks(req, (await getTenantContext(req))!, {
    title: 'Retired asset task',
    priority: 'normal',
    global: false,
    office_ids: [auth.officeId],
    assignment_kind: 'open_pool',
    related_entity: { relationTo: 'assets', value: String(server.id) },
  } as never)
  await payload.update({
    collection: 'assets',
    id: server.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { status: 'retired' },
  })
  const claimReq = await createLocalReq(
    { user: { id: admin, collection: 'users' } as never },
    payload
  )
  await expect(claimTask(claimReq, (await getTenantContext(claimReq))!, String(tasks[0].id))).rejects.toMatchObject({ code: 'task_not_pending' })
  expect(
    (await payload.findByID({ collection: 'tasks', id: tasks[0].id, overrideAccess: true })).status
  ).toBe('cancelled')
})

it('SEC-52/53: logical deletion cancels open tasks, preserves references and queues risk', async () => {
  const { auth } = await scope()
  const admin = await member(payload, auth.organizationId, [auth.officeId], 'org_admin')
  const req = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  const ctx = (await getTenantContext(req))!
  const manual = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      organization: auth.organizationId,
      office: auth.officeId,
      owner: admin,
      alias: 'Deletion fixture',
      asset_category: 'computer',
      criticality: 'medium',
      review_interval: 'never',
    },
    context: { systemJob: true },
  })
  const tasks = await createTasks(req, ctx, {
    title: 'Manual related task',
    priority: 'normal',
    global: false,
    office_ids: [auth.officeId],
    assignment_kind: 'open_pool',
    related_entity: { relationTo: 'non-network-assets', value: String(manual.id) },
  } as never)
  const history = await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: {
      organization: auth.organizationId,
      office: auth.officeId,
      manual_asset: manual.id,
      control_key: 'A.5.9',
      check_key: 'manual.fixture',
      status: 'compliant',
      severity: 'medium',
      policy_key: 'essential',
      policy_version: 2,
      evaluated_at: new Date().toISOString(),
      valid_until: '2099-01-01T00:00:00.000Z',
      reason_code: 'fixture',
      explanation: 'Historical manual evidence',
      evidence_snapshot: {},
    },
  })
  const evaluation = await recalculateRisk(payload, {
    organizationId: auth.organizationId,
    officeId: auth.officeId,
  })
  delete process.env.PAYLOAD_DISABLE_JOBS
  try {
    const deleteReq = await createLocalReq(
      { user: { id: admin, collection: 'users' } as never },
      payload
    )
    await expect(payload.delete({ collection: 'non-network-assets', id: manual.id, overrideAccess: true, req: deleteReq })).rejects.toThrow('lógicamente')
    deleteReq.routeParams = { id: String(manual.id) }
    expect((await logicalDeleteEndpoint('non-network-assets').handler(deleteReq)).status).toBe(200)
    const task = await payload.findByID({
      collection: 'tasks',
      id: tasks[0].id,
      overrideAccess: true,
    })
    expect(task.status).toBe('cancelled')
    expect(relationId(task.related_entity?.value)).toBe(String(manual.id))
    expect(
      (
        await payload.findByID({
          collection: 'compliance-results',
          id: history.id,
          overrideAccess: true,
          depth: 0,
        })
      ).manual_asset
    ).toBe(String(manual.id))
    const contributions = await payload.find({
      collection: 'risk-contributions',
      overrideAccess: true,
      where: {
        and: [
          { evaluation: { equals: evaluation.id } },
          { asset_key: { equals: `manual:${manual.id}` } },
        ],
      },
      limit: 1000,
    })
    expect(contributions.totalDocs).toBeGreaterThan(0)
    expect(contributions.docs.every(c => relationId(c.manual_asset) === String(manual.id))).toBe(true)
    const jobs = await payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: { concurrencyKey: { equals: `risk:${auth.organizationId}:org` } },
    })
    expect(jobs.totalDocs).toBeGreaterThan(0)
  } finally {
    process.env.PAYLOAD_DISABLE_JOBS = '1'
  }
})

it('SEED: renamed manual assets and tasks retain their scenario identity on repeat', async () => {
  const { seedNavigation } = await import('@/scripts/seed-navigation')
  await seedNavigation(payload)
  await seedDemoData(payload)
  const org = await payload.find({
    collection: 'organizations',
    overrideAccess: true,
    where: { name: { equals: 'Demo Organization' } },
  })
  const id = org.docs[0].id
  const manuals = await payload.find({
    collection: 'non-network-assets',
    overrideAccess: true,
    where: { organization: { equals: id } },
  })
  const tasks = await payload.find({
    collection: 'tasks',
    overrideAccess: true,
    where: { organization: { equals: id } },
  })
  await payload.update({
    collection: 'non-network-assets',
    id: manuals.docs[0].id,
    overrideAccess: true,
    data: { alias: 'User renamed asset' },
  })
  await payload.update({
    collection: 'tasks',
    id: tasks.docs[0].id,
    overrideAccess: true,
    data: { title: 'User renamed task' },
  })
  const repeat = await seedDemoData(payload)
  expect(repeat.manualAssetsCreated).toBe(0)
  expect(repeat.tasksCreated).toBe(0)
  expect(
    (
      await payload.find({
        collection: 'non-network-assets',
        overrideAccess: true,
        where: { organization: { equals: id } },
      })
    ).totalDocs
  ).toBe(manuals.totalDocs)
  expect(
    (
      await payload.find({
        collection: 'tasks',
        overrideAccess: true,
        where: { organization: { equals: id } },
      })
    ).totalDocs
  ).toBe(tasks.totalDocs)
})


it('SEC-01: selected PlatformAdmin creates, claims and completes with its own actor identity', async () => {
  const { auth } = await scope()
  await member(payload, auth.organizationId, [auth.officeId], 'org_admin')
  const role = (await payload.find({ collection: 'roles', overrideAccess: true, where: { slug: { equals: 'platform_admin' } }, limit: 1 })).docs[0]
  const admin = await payload.create({ collection: 'admins', overrideAccess: true, data: { email: `platform-${crypto.randomUUID()}@example.test`, password: 'x'.repeat(12), role: role.id } })
  const request = () => createLocalReq({ user: { id: admin.id, collection: 'admins' } as never, req: { url: `http://localhost/api/v1/tasks?asOrganization=${auth.organizationId}` } as never }, payload)
  const req = await request()
  const ctx = (await getTenantContext(req))!
  expect(ctx).toMatchObject({ role: 'org_admin', isPlatformAdmin: true })
  const [task] = await createTasks(req, ctx, { title: 'Platform task', priority: 'normal', global: false, office_ids: [auth.officeId], assignment_kind: 'open_pool' } as never)
  expect(task.created_by.relationTo).toBe('admins')
  expect(relationId(task.created_by)).toBe(String(admin.id))
  const claimReq = await request()
  const claimed = await claimTask(claimReq, (await getTenantContext(claimReq))!, String(task.id))
  expect(claimed.claimed_by?.relationTo).toBe('admins')
  expect(relationId(claimed.claimed_by)).toBe(String(admin.id))
  const completeReq = await request()
  const completed = await completeTask(completeReq, (await getTenantContext(completeReq))!, String(task.id))
  expect(completed.completed_by?.relationTo).toBe('admins')
  expect(relationId(completed.completed_by)).toBe(String(admin.id))
  const noSelection = await createLocalReq({ user: { id: admin.id, collection: 'admins' } as never }, payload)
  await expect(createTasks(noSelection, (await getTenantContext(noSelection))!, { title: 'No scope' } as never)).rejects.toMatchObject({ status: 403 })
})

it('SEC-04: global MAC conflicts preserve identity and office until an authorized move, then release an invalid claim', async () => {
  const { auth } = await scope()
  const mac = '00:11:22:AA:BC:DE'
  const first = await processScanReport(payload, auditReport(auth, [auditAsset(auth, { mac })]), auth)
  const asset = (await payload.find({ collection: 'assets', overrideAccess: true, where: { asset_id: { equals: first.processedAssetIds[0] } }, limit: 1 })).docs[0]
  await payload.update({ collection: 'assets', id: asset.id, overrideAccess: true, context: { systemJob: true }, data: { identified: true, identification_status: 'confirmed', confirmed_type: 'server', authorization_status: 'authorized' } })
  const destination = await payload.create({ collection: 'offices', overrideAccess: true, data: { organization: auth.organizationId, name: 'New location' } })
  const agent = await payload.create({ collection: 'agents', overrideAccess: true, context: { systemJob: true }, data: { id: `agent-${crypto.randomUUID()}`, office: destination.id } })
  const otherAuth = { ...auth, officeId: String(destination.id), agentId: String(agent.id) }
  const manager = await member(payload, auth.organizationId, [auth.officeId], 'office_manager')
  const admin = await member(payload, auth.organizationId, [auth.officeId, String(destination.id)], 'org_admin')
  const managerReq = await createLocalReq({ user: { id: manager, collection: 'users' } as never }, payload)
  const [task] = await createTasks(managerReq, (await getTenantContext(managerReq))!, { title: 'Claim before movement', priority: 'normal', office_ids: [auth.officeId], global: false, assignment_kind: 'user', assigned_user: manager, related_entity: { relationTo: 'assets', value: String(asset.id) } } as never)
  const claimReq = await createLocalReq({ user: { id: manager, collection: 'users' } as never }, payload)
  await claimTask(claimReq, (await getTenantContext(claimReq))!, String(task.id))
  await processScanReport(payload, auditReport(otherAuth, [auditAsset(otherAuth, { mac })]), otherAuth)
  await processScanReport(payload, auditReport(otherAuth, [auditAsset(otherAuth, { mac })]), otherAuth)
  expect(relationId((await assetDoc(String(asset.id))).office)).toBe(auth.officeId)
  const incidents = await payload.find({ collection: 'inventory-incidents', overrideAccess: true, where: { asset: { equals: asset.id } } })
  expect(incidents.totalDocs).toBe(1)
  const resolveReq = async (userId: string) => { const r = await createLocalReq({ user: { id: userId, collection: 'users' } as never }, payload); r.routeParams = { id: incidents.docs[0].id }; r.json = async () => ({ decision: 'move' }); return r }
  expect((await resolveInventoryIncidentEndpoint.handler(await resolveReq(manager))).status).toBe(404)
  expect((await resolveInventoryIncidentEndpoint.handler(await resolveReq(admin))).status).toBe(200)
  const moved = await assetDoc(String(asset.id))
  expect(moved.asset_id).toBe(asset.asset_id)
  expect(relationId(moved.office)).toBe(String(destination.id))
  const updatedTask = await payload.findByID({ collection: 'tasks', id: task.id, overrideAccess: true, depth: 0 })
  expect(updatedTask).toMatchObject({ status: 'pending', requires_reassignment: true, office: destination.id })
  expect(updatedTask.claimed_by ?? null).toBeNull()
  expect(updatedTask.assigned_user ?? null).toBeNull()
  expect(updatedTask.lifecycle_history).toHaveLength(1)
})

it('REVIEW-07: a kept location keeps refreshing presence without moving the asset', async () => {
  const { auth } = await scope()
  const mac = '00:11:22:AA:BC:07'
  const first = await processScanReport(payload, auditReport(auth, [auditAsset(auth, { mac })]), auth)
  const asset = (await payload.find({ collection: 'assets', overrideAccess: true, where: { asset_id: { equals: first.processedAssetIds[0] } }, limit: 1 })).docs[0]
  const visited = await payload.create({ collection: 'offices', overrideAccess: true, data: { organization: auth.organizationId, name: 'Visited office' } })
  const agent = await payload.create({ collection: 'agents', overrideAccess: true, context: { systemJob: true }, data: { id: `agent-${crypto.randomUUID()}`, office: visited.id } })
  const otherAuth = { ...auth, officeId: String(visited.id), agentId: String(agent.id) }
  const admin = await member(payload, auth.organizationId, [auth.officeId, String(visited.id)], 'org_admin')
  await processScanReport(payload, auditReport(otherAuth, [auditAsset(otherAuth, { mac })]), otherAuth)
  const incidents = await payload.find({ collection: 'inventory-incidents', overrideAccess: true, where: { asset: { equals: asset.id } } })
  const resolveReq = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  resolveReq.routeParams = { id: incidents.docs[0].id }
  resolveReq.json = async () => ({ decision: 'keep' })
  expect((await resolveInventoryIncidentEndpoint.handler(resolveReq)).status).toBe(200)

  const later = new Date(Date.now() + 1000).toISOString()
  const result = await processScanReport(payload,
    auditReport(otherAuth, [auditAsset(otherAuth, { mac, scan_time: later })], { scan_start: later, scan_end: later }), otherAuth)
  expect(result.rejectedAssets).toEqual([])
  const refreshed = await assetDoc(String(asset.id))
  expect(Date.parse(refreshed.last_seen!)).toBe(Date.parse(later))
  expect(relationId(refreshed.office)).toBe(auth.officeId)
  const after = await payload.find({ collection: 'inventory-incidents', overrideAccess: true, where: { asset: { equals: asset.id } } })
  expect(after.docs.map(incident => incident.status)).toEqual(['kept'])
})

it('FOLLOWUP: moving an asset follows the replacement assessment, releases invalid claims, and preserves completed task history', async () => {
  const { auth, server } = await scope()
  const destination = await payload.create({ collection: 'offices', overrideAccess: true, data: { organization: auth.organizationId, name: 'Followup destination' } })
  const manager = await member(payload, auth.organizationId, [auth.officeId], 'office_manager')
  const admin = await member(payload, auth.organizationId, [auth.officeId, String(destination.id)], 'org_admin')
  await payload.update({ collection: 'assets', id: server.id, overrideAccess: true, data: { identified: true, identification_status: 'confirmed', confirmed_type: 'workstation', authorization_status: 'authorized' } })
  const assessment = (await payload.find({ collection: 'assessment-instances', overrideAccess: true, where: { asset: { equals: server.id }, status: { equals: 'pending' } } })).docs[0]
  expect(assessment).toBeTruthy()
  const req = await createLocalReq({ user: { id: manager, collection: 'users' } as never }, payload)
  const ctx = (await getTenantContext(req))!
  const input = { title: 'Followup review task', priority: 'normal', global: false, office_ids: [auth.officeId], assignment_kind: 'user', assigned_user: manager, related_entity: { relationTo: 'assessment-instances', value: String(assessment.id) } } as never
  const [task] = await createTasks(req, ctx, input)
  await claimTask(req, ctx, String(task.id))
  const [completed] = await createTasks(req, ctx, { ...input as object, title: 'Historical completed task' } as never)
  await claimTask(req, ctx, String(completed.id))
  await completeTask(req, ctx, String(completed.id))
  const adminReq = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  await payload.update({ collection: 'assets', id: server.id, req: adminReq, overrideAccess: true, data: { office: destination.id, owner: null } })
  const moved = await payload.findByID({ collection: 'tasks', id: task.id, overrideAccess: true, depth: 0 })
  expect(moved.status).toBe('pending')
  expect(moved.requires_reassignment).toBe(true)
  expect(moved.claimed_by ?? null).toBeNull()
  expect(relationId(moved.office)).toBe(String(destination.id))
  expect(relationId(moved.related_entity?.value)).not.toBe(String(assessment.id))
  expect(moved.lifecycle_history).toEqual(expect.arrayContaining([expect.objectContaining({ previous_assessment: assessment.id })]))
  const historical = await payload.findByID({ collection: 'tasks', id: completed.id, overrideAccess: true, depth: 0 })
  expect(historical.status).toBe('completed')
  expect(relationId(historical.related_entity?.value)).toBe(String(assessment.id))
  await payload.update({ collection: 'assets', id: server.id, req: adminReq, overrideAccess: true, data: { status: 'retired' } })
  const cancelled = await payload.findByID({ collection: 'tasks', id: task.id, overrideAccess: true })
  expect(cancelled.status).toBe('cancelled')
  expect(cancelled.cancellation_reason).toBe('Activo retirado.')
})

it('FOLLOWUP: compact enriched seed covers reassignment, automatic cancellation and immutable origin references without duplicates', async () => {
  const first = await seedDemoData(payload, { profile: 'expanded' })
  expect(first.manualAssetsCreated).toBe(8)
  const org = (await payload.find({ collection: 'organizations', overrideAccess: true, where: { name: { equals: 'Demo Organization' } } })).docs[0]
  const scope = { organization: { equals: org.id } }
  const tasks = (await payload.find({ collection: 'tasks', overrideAccess: true, depth: 0, pagination: false, where: scope })).docs
  const reassign = tasks.find(t => t.title.startsWith('Revisar portátil trasladado'))!
  expect(reassign.requires_reassignment).toBe(true)
  expect(reassign.status).toBe('pending')
  expect(reassign.claimed_by ?? null).toBeNull()
  const cancelled = tasks.find(t => t.title.startsWith('Revisar impresora retirada'))!
  expect(cancelled.status).toBe('cancelled')
  expect(cancelled.cancellation_reason).toBe('Activo retirado.')
  expect(tasks.some(t => t.status === 'pending' && t.related_entity?.relationTo === 'inventory-snapshots')).toBe(true)
  expect(tasks.some(t => t.status === 'pending' && t.related_entity?.relationTo === 'risk-evaluations')).toBe(true)
  expect((await payload.count({ collection: 'assets', overrideAccess: true, where: scope })).totalDocs).toBe(21)
  expect((await payload.count({ collection: 'non-network-assets', overrideAccess: true, where: scope })).totalDocs).toBe(18)
  expect(tasks).toHaveLength(22)
  const repeat = await seedDemoData(payload, { profile: 'expanded' })
  expect(repeat).toMatchObject({ reportsProcessed: 0, manualAssetsCreated: 0, tasksCreated: 0, snapshotsCreated: 0 })
  expect((await payload.count({ collection: 'tasks', overrideAccess: true, where: scope })).totalDocs).toBe(tasks.length)
}, 120000)

it('FOLLOWUP: historical risk reads the selected immutable evaluation and enforces office/organization scope', async () => {
  const { auth } = await scope()
  const manager = await member(payload, auth.organizationId, [auth.officeId], 'office_manager')
  const old = await recalculateRisk(payload, { organizationId: auth.organizationId, officeId: auth.officeId })
  await recalculateRisk(payload, { organizationId: auth.organizationId, officeId: auth.officeId })
  const { latestRiskEvaluationEndpoint } = await import('./risk')
  const request = (officeId: string, id: string) => createLocalReq({ user: { id: manager, collection: 'users' } as never, req: { url: `http://localhost/api/v1/risk/latest?office_id=${officeId}&evaluation_id=${id}` } as never }, payload)
  const response = await latestRiskEvaluationEndpoint.handler(await request(auth.officeId, String(old.id)))
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.evaluation.id).toBe(String(old.id))
  expect(data.recalculation).toBeUndefined()
  const other = await scope()
  const foreign = await recalculateRisk(payload, { organizationId: other.auth.organizationId, officeId: other.auth.officeId })
  expect((await latestRiskEvaluationEndpoint.handler(await request(auth.officeId, String(foreign.id)))).status).toBe(404)
  expect((await latestRiskEvaluationEndpoint.handler(await request(other.auth.officeId, String(foreign.id)))).status).toBe(403)
})
