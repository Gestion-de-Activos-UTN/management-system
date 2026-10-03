import type { Payload, PayloadRequest, Where } from 'payload'
import type {
  Agent,
  Asset,
  AssessmentInstance,
  NonNetworkAsset,
  Office,
  OrganizationSetting,
  User,
} from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import type { ScanReportPayload } from '@/contracts/scan-report.schema'
import { ScanReportPayloadSchema } from '@/contracts/scan-report.schema'
import { processScanReport } from '@/domain/inventories/processScanReport'
import { createInventorySnapshot } from '@/domain/inventories/createInventorySnapshot'
import { completeAssessment, saveAssessmentDraft } from '@/domain/assessments/assessmentLifecycle'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'
import {
  createTasks,
  claimTask,
  completeTask,
  cancelTask,
  archiveTask,
} from '@/domain/tasks/task-actions'
import { relationId } from '@/lib/relationId'

const DAY = 24 * 60 * 60 * 1000
const DEMO_ORGANIZATION = 'Demo Organization'
const DEMO_AGENT_MAIN = 'demo-agent-main'
const DEMO_AGENT_SECONDARY = 'demo-agent-secondary'

type DemoUserKey = 'admin' | 'viewer' | 'mainManager' | 'secondaryManager'
type DemoUsers = Record<DemoUserKey, User>

export interface SeedDemoDataOptions {
  organizationName?: string
  now?: Date
}

export interface SeedDemoDataSummary {
  organizationId: string
  agentsCreated: number
  reportsProcessed: number
  manualAssetsCreated: number
  assessmentsCompleted: number
  tasksCreated: number
  snapshotsCreated: number
}

const at = (now: Date, offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString()

function humanRequest(payload: Payload, userId: string, seedEffectiveNow?: string): PayloadRequest {
  return {
    payload,
    user: { id: userId, collection: 'users' },
    context: seedEffectiveNow ? { seedEffectiveNow } : {},
  } as unknown as PayloadRequest
}

async function findOne<T = Record<string, any>>(
  payload: Payload,
  collection: Parameters<Payload['find']>[0]['collection'],
  where: Where,
  depth = 0
): Promise<T | undefined> {
  const result = await payload.find({
    collection,
    where,
    overrideAccess: true,
    depth,
    limit: 1,
  } as Parameters<Payload['find']>[0])
  return result.docs[0] as T | undefined
}

function service(
  port: number,
  name: string,
  product: string,
  options: { version?: string; tunnel?: string; scripts?: Record<string, string> } = {}
) {
  return {
    port,
    protocol: 'tcp' as const,
    state: 'open' as const,
    name,
    product,
    version: options.version ?? '',
    extra_info: '',
    cpe: '',
    reason: 'syn-ack',
    detection_method: 'probed' as const,
    confidence: 10,
    tunnel: options.tunnel ?? '',
    scripts: options.scripts ?? {},
  }
}

function operatingSystem(
  name: string,
  family: string,
  generation: string,
  vendor: string,
  deviceType: string,
  accuracy = 96
) {
  return {
    name,
    accuracy,
    cpe: [],
    osfamily: family,
    osgen: generation,
    vendor,
    device_type: deviceType,
  }
}

function asset(
  agentId: string,
  scanTime: string,
  input: {
    key: string
    ip: string
    mac: string
    vendor: string
    hostname: string
    os: ReturnType<typeof operatingSystem> | null
    services: ReturnType<typeof service>[]
    names?: Array<{ value: string; source: 'nmap' | 'ptr' | 'mdns' | 'netbios' | 'ssdp' }>
    coverage?: 'complete' | 'partial'
    issues?: Array<{
      stage:
        | 'discovery'
        | 'port_scan'
        | 'service_detection'
        | 'os_detection'
        | 'name_resolution'
        | 'routing'
        | 'scanner'
      code:
        | 'host_timeout'
        | 'permission_denied'
        | 'tool_unavailable'
        | 'resolution_timeout'
        | 'parse_error'
        | 'route_ambiguous'
        | 'execution_error'
        | 'other'
    }>
  }
) {
  const coverage = input.coverage ?? 'complete'
  return {
    asset_id: `demo-${input.key}`,
    agent_id: agentId,
    ip: input.ip,
    mac: input.mac,
    vendor: input.vendor,
    hostname: input.hostname,
    os: input.os,
    services: input.services,
    scan_time: scanTime,
    os_candidates: input.os ? [input.os] : [],
    state_reason: input.mac ? 'arp-response' : 'echo-reply',
    host_scripts: {},
    names:
      input.names ?? (input.hostname ? [{ value: input.hostname, source: 'nmap' as const }] : []),
    mac_metadata: {
      kind: input.mac ? ('globally_administered' as const) : ('unknown' as const),
      vendor_resolution: input.vendor ? ('resolved' as const) : ('not_attempted' as const),
    },
    asset_coverage: {
      port_scan: coverage,
      service_detection: coverage,
      os_detection: input.os ? coverage : ('not_attempted' as const),
      name_resolution: input.hostname ? coverage : ('partial' as const),
    },
    scan_issues: input.issues ?? [],
  }
}

function report(
  now: Date,
  input: {
    id: string
    agentId: string
    network: string
    gatewayIp: string
    gatewayMac: string
    offsetMs: number
    degraded?: boolean
    assets: Array<Parameters<typeof asset>[2]>
  }
): ScanReportPayload {
  const scanEnd = at(now, input.offsetMs)
  const scanStart = at(now, input.offsetMs - 4 * 60 * 1000)
  const degraded = input.degraded ?? false
  const payload = {
    report_id: input.id,
    agent_id: input.agentId,
    network: input.network,
    scan_start: scanStart,
    scan_end: scanEnd,
    hosts_up: input.assets.length,
    assets: input.assets.map(item => asset(input.agentId, scanEnd, item)),
    scan_mode: degraded ? ('degraded' as const) : ('full' as const),
    scan_mode_reason: degraded
      ? 'OS fingerprinting is unavailable without elevated privileges.'
      : null,
    execution_status: degraded ? ('partial' as const) : ('completed' as const),
    scanner_interfaces: [
      {
        name: 'eth0',
        ip: input.network.replace(/\.0\/24$/, '.2'),
        mac: input.agentId === DEMO_AGENT_MAIN ? '02:42:AC:11:00:02' : '02:42:AC:12:00:02',
        network: input.network,
        is_route_to_target: true,
      },
    ],
    report_coverage: {
      schema_version: 1 as const,
      profile: 'siam_standard_v1' as const,
      discovery: { status: 'complete' as const, methods_attempted: ['arp', 'icmp'] },
      ports: [
        {
          protocol: 'tcp' as const,
          port_spec: '1-1024,1433,3306,3389,5432,8080,8443,9100',
          status: degraded ? ('partial' as const) : ('complete' as const),
        },
      ],
      service_detection: { status: degraded ? ('partial' as const) : ('complete' as const) },
      os_detection: { status: degraded ? ('not_attempted' as const) : ('complete' as const) },
      name_resolution: {
        status: degraded ? ('partial' as const) : ('complete' as const),
        methods_attempted: ['ptr', 'mdns'],
      },
      limitations: degraded
        ? [{ stage: 'os_detection' as const, code: 'permission_denied' as const }]
        : [],
    },
    gateway_ip: input.gatewayIp,
    gateway_mac: input.gatewayMac,
  }
  return ScanReportPayloadSchema.parse(payload)
}

export function buildDemoReports(now = new Date()): ScanReportPayload[] {
  const linux = operatingSystem('Linux 5.15', 'Linux', '5.X', 'Linux', 'general purpose')
  const windows = operatingSystem(
    'Microsoft Windows 11',
    'Windows',
    '11',
    'Microsoft',
    'general purpose'
  )
  const router = operatingSystem('Linux 4.X embedded', 'Linux', '4.X', 'OpenWrt', 'router')
  const printer = operatingSystem('HP embedded', 'embedded', '', 'HP', 'printer')
  const camera = operatingSystem('Linux embedded camera', 'Linux', '3.X', 'Hikvision', 'webcam')

  return [
    report(now, {
      id: 'demo-main-scan-v1',
      agentId: DEMO_AGENT_MAIN,
      network: '10.20.10.0/24',
      gatewayIp: '10.20.10.1',
      gatewayMac: '00:11:22:33:44:01',
      offsetMs: -20 * 60 * 1000,
      assets: [
        {
          key: 'main-gateway',
          ip: '10.20.10.1',
          mac: '00:11:22:33:44:01',
          vendor: 'Ubiquiti Networks',
          hostname: 'gw-main',
          os: router,
          services: [
            service(53, 'domain', 'dnsmasq'),
            service(443, 'https', 'uhttpd', { tunnel: 'ssl' }),
          ],
        },
        {
          key: 'main-server',
          ip: '10.20.10.10',
          mac: '00:11:22:33:44:10',
          vendor: 'Dell',
          hostname: 'srv-files-01',
          os: linux,
          services: [
            service(22, 'ssh', 'OpenSSH', { version: '8.9' }),
            service(445, 'microsoft-ds', 'Samba', { version: '4.15' }),
          ],
        },
        {
          key: 'main-workstation',
          ip: '10.20.10.20',
          mac: '00:11:22:33:44:20',
          vendor: 'Lenovo',
          hostname: 'ws-finance-04',
          os: windows,
          services: [
            service(135, 'msrpc', 'Microsoft Windows RPC'),
            service(3389, 'ms-wbt-server', 'Microsoft Terminal Services'),
          ],
        },
        {
          key: 'main-printer',
          ip: '10.20.10.30',
          mac: '00:11:22:33:44:30',
          vendor: 'HP',
          hostname: 'printer-floor-1',
          os: printer,
          services: [
            service(80, 'http', 'HP Embedded Web Server'),
            service(9100, 'jetdirect', 'HP JetDirect'),
          ],
        },
        {
          key: 'main-legacy-nas',
          ip: '10.20.10.50',
          mac: '00:11:22:33:44:50',
          vendor: 'Synology',
          hostname: 'nas-legacy',
          os: linux,
          services: [
            service(445, 'microsoft-ds', 'Samba', { version: '4.10' }),
            service(5000, 'http', 'Synology DSM'),
          ],
        },
        {
          key: 'main-unknown',
          ip: '10.20.10.44',
          mac: '',
          vendor: '',
          hostname: '',
          os: null,
          services: [service(8080, 'http-proxy', '')],
          coverage: 'partial',
          issues: [{ stage: 'os_detection', code: 'permission_denied' }],
        },
      ],
    }),
    report(now, {
      id: 'demo-secondary-historic-scan-v1',
      agentId: DEMO_AGENT_SECONDARY,
      network: '10.20.20.0/24',
      gatewayIp: '10.20.20.1',
      gatewayMac: '00:11:22:33:55:01',
      offsetMs: -5 * DAY,
      assets: [
        {
          key: 'secondary-camera',
          ip: '10.20.20.25',
          mac: '00:11:22:33:55:25',
          vendor: 'Hikvision',
          hostname: 'camera-warehouse',
          os: camera,
          services: [
            service(80, 'http', 'Hikvision web server'),
            service(554, 'rtsp', 'Hikvision RTSP'),
          ],
        },
      ],
    }),
    report(now, {
      id: 'demo-secondary-scan-v1',
      agentId: DEMO_AGENT_SECONDARY,
      network: '10.20.20.0/24',
      gatewayIp: '10.20.20.1',
      gatewayMac: '00:11:22:33:55:01',
      offsetMs: -45 * 60 * 1000,
      degraded: true,
      assets: [
        {
          key: 'secondary-ap',
          ip: '10.20.20.5',
          mac: '00:11:22:33:55:05',
          vendor: 'Cisco',
          hostname: 'ap-warehouse-01',
          os: null,
          services: [
            service(22, 'ssh', 'Cisco SSH'),
            service(443, 'https', 'Cisco web UI', { tunnel: 'ssl' }),
          ],
          coverage: 'partial',
        },
        {
          key: 'secondary-workstation',
          ip: '10.20.20.15',
          mac: '00:11:22:33:55:15',
          vendor: 'Dell',
          hostname: 'ws-logistics-02',
          os: null,
          services: [service(135, 'msrpc', 'Microsoft Windows RPC')],
          coverage: 'partial',
        },
      ],
    }),
  ]
}

async function requiredCore(payload: Payload, organizationName: string) {
  const organization = await findOne(payload, 'organizations', {
    name: { equals: organizationName },
  })
  if (!organization)
    throw new Error(`Demo organization '${organizationName}' not found; run seed:navigation first`)
  const organizationId = String(organization.id)
  const offices = await payload.find({
    collection: 'offices',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    depth: 0,
    limit: 20,
  })
  const mainOffice = offices.docs.find(office => office.name === 'Main Office') ?? offices.docs[0]
  const secondaryOffice =
    offices.docs.find(office => office.name === 'Secondary Office') ?? offices.docs[1]
  if (!mainOffice || !secondaryOffice) throw new Error('The demo seed requires two offices')

  const emails: Record<DemoUserKey, string> = {
    admin: 'org-admin@siam.com',
    viewer: 'org-viewer@siam.com',
    mainManager: 'main-manager@siam.com',
    secondaryManager: 'secondary-manager@siam.com',
  }
  const users = {} as DemoUsers
  for (const [key, email] of Object.entries(emails) as Array<[DemoUserKey, string]>) {
    const user = await findOne(payload, 'users', { email: { equals: email } })
    if (!user) throw new Error(`Demo user '${email}' not found; run seed:navigation first`)
    users[key] = user as User
  }
  return {
    organizationId,
    mainOffice: mainOffice as Office,
    secondaryOffice: secondaryOffice as Office,
    users,
  }
}

async function ensureAgent(
  payload: Payload,
  input: { id: string; officeId: string; lastHeartbeatAt: string; apiKey: string }
): Promise<{ created: boolean }> {
  const existing = await findOne<Agent>(payload, 'agents', { id: { equals: input.id } })
  if (existing) {
    if (existing.lifecycle_status !== 'revoked') {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {agent heartbeat state}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await payload.update({
        collection: 'agents',
        id: input.id,
        overrideAccess: true,
        context: { systemJob: true },
        data: {
          lifecycle_status: 'active',
          runtime_status: 'idle',
          first_heartbeat_at: existing.first_heartbeat_at ?? input.lastHeartbeatAt,
          last_heartbeat_at: input.lastHeartbeatAt,
          last_agent_timestamp: input.lastHeartbeatAt,
        },
      })
    }
    return { created: false }
  }
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {agent, office}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  await payload.create({
    collection: 'agents',
    overrideAccess: true,
    context: { seedApiKey: input.apiKey, systemJob: true },
    data: {
      id: input.id,
      office: input.officeId,
      lifecycle_status: 'active',
      runtime_status: 'idle',
      first_heartbeat_at: input.lastHeartbeatAt,
      last_heartbeat_at: input.lastHeartbeatAt,
      last_agent_timestamp: input.lastHeartbeatAt,
    },
  })
  return { created: true }
}

async function findAsset(payload: Payload, assetId: string): Promise<Asset> {
  const found = await findOne(payload, 'assets', { asset_id: { equals: assetId } })
  if (!found) throw new Error(`Demo asset '${assetId}' was not created by ingestion`)
  return found as Asset
}

async function enrichAsset(
  payload: Payload,
  assetId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const current = await findAsset(payload, assetId)
  if (current.identified) return false
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {asset identification and business fields}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  await payload.update({
    collection: 'assets',
    id: current.id,
    overrideAccess: true,
    data: {
      identified: true,
      identification_status: 'confirmed',
      type_confirmed_at: new Date().toISOString(),
      ...data,
    },
  })
  return true
}

async function ensureManualAsset(
  payload: Payload,
  req: PayloadRequest,
  input: {
    alias: string
    category:
      | 'computer'
      | 'software_license'
      | 'cloud_asset'
      | 'provider_service'
      | 'backup'
      | 'information_repository'
      | 'physical_record'
      | 'removable_media'
    criticality: 'low' | 'medium' | 'high' | 'critical'
    ownerId: string
    officeId: string
    organizationId: string
    location: string
    reviewInterval: 'never' | '1d' | '1w' | '1m' | '6m' | '1y'
    status?: 'active' | 'retired'
  }
) {
  const existing = await findOne<NonNetworkAsset>(payload, 'non-network-assets', {
    and: [{ alias: { equals: input.alias } }, { organization: { equals: input.organizationId } }],
  })
  if (existing) return { doc: existing, created: false }
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {manual asset business fields}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  const doc = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    req,
    data: {
      alias: input.alias,
      asset_category: input.category,
      criticality: input.criticality,
      owner: input.ownerId,
      office: input.officeId,
      organization: input.organizationId,
      location: input.location,
      review_interval: input.reviewInterval,
      status: input.status ?? 'active',
    },
  })
  return { doc: doc as NonNetworkAsset, created: true }
}

function assessmentAnswers(assessment: AssessmentInstance, mode: 'healthy' | 'mixed' | 'weak') {
  const snapshot = Array.isArray(assessment.question_set_snapshot)
    ? assessment.question_set_snapshot
    : []
  return {
    answers: snapshot.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || !('key' in item) || !('version' in item)) return []
      const definition = RISK_QUESTIONS_V2.find(question => question.key === item.key)
      if (!definition) return []
      const desired =
        mode === 'healthy'
          ? 1
          : mode === 'weak'
            ? 0
            : index % 3 === 0
              ? 0
              : index % 3 === 1
                ? 0.5
                : 1
      const option =
        definition.options.find(candidate => candidate.efficacy === desired) ??
        definition.options[0]
      return [
        {
          question_key: String(item.key),
          question_version: Number(item.version),
          option_key: option.key,
          ...(option.requires_justification
            ? { justification: 'Este control no aplica al alcance operativo documentado.' }
            : {}),
          evidence_note: 'Evidencia demostrativa validada durante la revisión inicial.',
        },
      ]
    }),
  }
}

async function seedAssessment(
  payload: Payload,
  assessment: AssessmentInstance | undefined,
  userId: string,
  mode: 'healthy' | 'mixed' | 'weak',
  complete: boolean
): Promise<boolean> {
  if (!assessment || !['pending', 'in_progress'].includes(assessment.status)) return false
  const existing = await payload.find({
    collection: 'assessment-answers',
    where: { assessment: { equals: assessment.id } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  if (existing.docs.length) return false
  const command = assessmentAnswers(assessment, mode)
  const req = humanRequest(payload, userId)
  if (complete) await completeAssessment(payload, String(assessment.id), command, userId, req)
  else
    await saveAssessmentDraft(
      payload,
      String(assessment.id),
      { answers: command.answers.slice(0, 1) },
      userId,
      req
    )
  return complete
}

function tenantContext(userId: string, organizationId: string, officeIds: string[]): TenantContext {
  return {
    userId,
    role: 'org_admin',
    organizationId,
    officeIds,
    selectedOfficeId: officeIds[0] ?? null,
    isPlatformAdmin: false,
    isActive: true,
  }
}

async function ensureTask(
  payload: Payload,
  ctx: TenantContext,
  input: {
    title: string
    description: string
    priority: 'low' | 'normal' | 'high' | 'urgent'
    officeId: string
    startAt: string
    dueAt?: string
    reference?: {
      relationTo:
        'assets' | 'non-network-assets' | 'risk-evaluations' | 'inventory-snapshots' | 'agents'
      value: string
    }
    finalState: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'archived'
  }
): Promise<boolean> {
  const existing = await findOne(payload, 'tasks', {
    and: [{ organization: { equals: ctx.organizationId } }, { title: { equals: input.title } }],
  })
  if (existing) return false
  const created = await createTasks(humanRequest(payload, ctx.userId), ctx, {
    title: input.title,
    description: input.description,
    priority: input.priority,
    global: false,
    office_ids: [input.officeId],
    assignment_kind: 'open_pool',
    start_at: input.startAt,
    due_at: input.dueAt,
    related_entity: input.reference,
  })
  const task = created[0]
  if (input.finalState === 'pending') return true
  await claimTask(humanRequest(payload, ctx.userId), ctx, String(task.id))
  if (input.finalState === 'in_progress') return true
  if (input.finalState === 'cancelled') {
    await cancelTask(
      humanRequest(payload, ctx.userId),
      ctx,
      String(task.id),
      'El trabajo fue reemplazado por una acción correctiva de mayor alcance.'
    )
    return true
  }
  await completeTask(humanRequest(payload, ctx.userId), ctx, String(task.id))
  if (input.finalState === 'archived')
    await archiveTask(humanRequest(payload, ctx.userId), ctx, String(task.id))
  return true
}

function snapshotContainsDemoAssets(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const network = (value as { network?: unknown }).network
  return (
    Array.isArray(network) &&
    network.some(
      row =>
        row &&
        typeof row === 'object' &&
        'asset_id' in row &&
        String(row.asset_id).startsWith('demo-')
    )
  )
}

export async function seedDemoData(
  payload: Payload,
  options: SeedDemoDataOptions = {}
): Promise<SeedDemoDataSummary> {
  const now = options.now ?? new Date()
  const core = await requiredCore(payload, options.organizationName ?? DEMO_ORGANIZATION)
  const mainOfficeId = String(core.mainOffice.id)
  const secondaryOfficeId = String(core.secondaryOffice.id)
  const adminId = String(core.users.admin.id)
  const summary: SeedDemoDataSummary = {
    organizationId: core.organizationId,
    agentsCreated: 0,
    reportsProcessed: 0,
    manualAssetsCreated: 0,
    assessmentsCompleted: 0,
    tasksCreated: 0,
    snapshotsCreated: 0,
  }

  const settings = await findOne<OrganizationSetting>(payload, 'organization-settings', {
    organization: { equals: core.organizationId },
  })
  if (settings && (!settings.maturity_it_owner || !settings.maturity_security_budget)) {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organization settings and maturity}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.update({
      collection: 'organization-settings',
      id: settings.id,
      overrideAccess: true,
      data: {
        ...(!settings.maturity_it_owner ? { maturity_it_owner: 'yes' } : {}),
        ...(!settings.maturity_security_budget ? { maturity_security_budget: 'recurring' } : {}),
        maturity_updated_at: now.toISOString(),
        maturity_updated_by: adminId,
        offline_after_hours: settings.offline_after_hours ?? 72,
        snapshot_interval_days: settings.snapshot_interval_days ?? 7,
      },
    })
  }

  summary.agentsCreated += Number(
    (
      await ensureAgent(payload, {
        id: DEMO_AGENT_MAIN,
        officeId: mainOfficeId,
        lastHeartbeatAt: at(now, -2 * 60 * 1000),
        apiKey: 'demo-main-agent-key-2026-000000000000000000000000',
      })
    ).created
  )
  summary.agentsCreated += Number(
    (
      await ensureAgent(payload, {
        id: DEMO_AGENT_SECONDARY,
        officeId: secondaryOfficeId,
        lastHeartbeatAt: at(now, -45 * 60 * 1000),
        apiKey: 'demo-secondary-agent-key-2026-000000000000000000',
      })
    ).created
  )

  const officeByAgent = new Map([
    [DEMO_AGENT_MAIN, mainOfficeId],
    [DEMO_AGENT_SECONDARY, secondaryOfficeId],
  ])
  let sourceChanged = summary.agentsCreated > 0
  for (const demoReport of buildDemoReports(now)) {
    const result = await processScanReport(payload, demoReport, {
      agentId: demoReport.agent_id,
      officeId: officeByAgent.get(demoReport.agent_id)!,
      organizationId: core.organizationId,
    })
    if (!result.alreadyProcessed) {
      summary.reportsProcessed += 1
      sourceChanged = true
    }
  }

  const mainServer = await findAsset(payload, 'demo-main-server')
  const mainWorkstation = await findAsset(payload, 'demo-main-workstation')
  const mainPrinter = await findAsset(payload, 'demo-main-printer')
  const mainLegacyNas = await findAsset(payload, 'demo-main-legacy-nas')
  const mainGateway = await findAsset(payload, 'demo-main-gateway')
  const secondaryAp = await findAsset(payload, 'demo-secondary-ap')
  const secondaryWorkstation = await findAsset(payload, 'demo-secondary-workstation')
  const secondaryCamera = await findAsset(payload, 'demo-secondary-camera')

  sourceChanged =
    (await enrichAsset(payload, mainServer.asset_id, {
      confirmed_type: 'server',
      authorization_status: 'authorized',
      alias: 'Servidor de archivos principal',
      criticality: 'critical',
      owner: adminId,
      location: 'Sala técnica — planta baja',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, mainWorkstation.asset_id, {
      confirmed_type: 'workstation',
      authorization_status: 'authorized',
      alias: 'Equipo de Finanzas 04',
      criticality: 'high',
      owner: core.users.mainManager.id,
      location: 'Finanzas — puesto 4',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, mainPrinter.asset_id, {
      confirmed_type: 'printer',
      authorization_status: 'unauthorized',
      alias: 'Impresora recepción sin registrar',
      location: 'Recepción',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, mainGateway.asset_id, {
      confirmed_type: 'gateway',
      authorization_status: 'authorized',
      alias: 'Gateway principal',
      criticality: 'critical',
      owner: adminId,
      location: 'Rack principal',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, mainLegacyNas.asset_id, {
      confirmed_type: 'server',
      authorization_status: 'authorized',
      alias: 'NAS legado fuera de servicio',
      criticality: 'low',
      owner: adminId,
      location: 'Archivo técnico',
      status: 'retired',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, secondaryAp.asset_id, {
      confirmed_type: 'network_device',
      authorization_status: 'authorized',
      alias: 'Access Point depósito',
      criticality: 'medium',
      owner: core.users.secondaryManager.id,
      location: 'Depósito — techo norte',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, secondaryWorkstation.asset_id, {
      confirmed_type: 'workstation',
      authorization_status: 'authorized',
      alias: 'Equipo de Logística 02',
      criticality: 'medium',
      owner: core.users.secondaryManager.id,
      location: 'Logística — puesto 2',
      type_confirmed_by: adminId,
    })) || sourceChanged
  sourceChanged =
    (await enrichAsset(payload, secondaryCamera.asset_id, {
      confirmed_type: 'iot',
      authorization_status: 'authorized',
      alias: 'Cámara del depósito',
      criticality: 'high',
      owner: core.users.secondaryManager.id,
      location: 'Depósito — acceso',
      type_confirmed_by: adminId,
    })) || sourceChanged
  if (secondaryCamera.status !== 'offline') {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {asset, status: offline}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.update({
      collection: 'assets',
      id: secondaryCamera.id,
      overrideAccess: true,
      context: { systemJob: true },
      data: { status: 'offline' },
    })
    sourceChanged = true
  }

  const manualInputs = [
    {
      alias: 'Notebook de Dirección',
      category: 'computer' as const,
      criticality: 'critical' as const,
      ownerId: adminId,
      officeId: mainOfficeId,
      location: 'Dirección',
      reviewInterval: '1m' as const,
    },
    {
      alias: 'Microsoft 365 Business Premium',
      category: 'software_license' as const,
      criticality: 'high' as const,
      ownerId: adminId,
      officeId: mainOfficeId,
      location: 'Tenant corporativo',
      reviewInterval: '6m' as const,
    },
    {
      alias: 'Repositorio documental corporativo',
      category: 'information_repository' as const,
      criticality: 'critical' as const,
      ownerId: core.users.mainManager.id,
      officeId: mainOfficeId,
      location: 'SharePoint Online',
      reviewInterval: '1m' as const,
    },
    {
      alias: 'Backup diario de sistemas críticos',
      category: 'backup' as const,
      criticality: 'critical' as const,
      ownerId: core.users.mainManager.id,
      officeId: mainOfficeId,
      location: 'Almacenamiento externo cifrado',
      reviewInterval: '1w' as const,
      seededAtOffsetMs: -10 * DAY,
    },
    {
      alias: 'Inventario de soportes de backup',
      category: 'backup' as const,
      criticality: 'high' as const,
      ownerId: core.users.mainManager.id,
      officeId: mainOfficeId,
      location: 'Custodia externa',
      reviewInterval: '1d' as const,
      seededAtOffsetMs: -4 * DAY,
    },
    {
      alias: 'CRM comercial en la nube',
      category: 'cloud_asset' as const,
      criticality: 'high' as const,
      ownerId: adminId,
      officeId: mainOfficeId,
      location: 'SaaS',
      reviewInterval: '1m' as const,
    },
    {
      alias: 'Servicio de Internet secundario',
      category: 'provider_service' as const,
      criticality: 'medium' as const,
      ownerId: core.users.secondaryManager.id,
      officeId: secondaryOfficeId,
      location: 'Enlace de respaldo del depósito',
      reviewInterval: '6m' as const,
    },
    {
      alias: 'Archivo físico de contratos',
      category: 'physical_record' as const,
      criticality: 'high' as const,
      ownerId: core.users.secondaryManager.id,
      officeId: secondaryOfficeId,
      location: 'Armario ignífugo',
      reviewInterval: '1y' as const,
    },
    {
      alias: 'Disco externo de intercambio',
      category: 'removable_media' as const,
      criticality: 'medium' as const,
      ownerId: core.users.secondaryManager.id,
      officeId: secondaryOfficeId,
      location: 'Caja fuerte del depósito',
      reviewInterval: '1m' as const,
    },
    {
      alias: 'Licencia antivirus reemplazada',
      category: 'software_license' as const,
      criticality: 'low' as const,
      ownerId: core.users.secondaryManager.id,
      officeId: secondaryOfficeId,
      location: 'Histórico de licencias',
      reviewInterval: 'never' as const,
      status: 'retired' as const,
    },
  ]
  const manualDocs: NonNetworkAsset[] = []
  for (const input of manualInputs) {
    const result = await ensureManualAsset(
      payload,
      humanRequest(
        payload,
        adminId,
        'seededAtOffsetMs' in input && typeof input.seededAtOffsetMs === 'number'
          ? at(now, input.seededAtOffsetMs)
          : undefined
      ),
      {
        ...input,
        organizationId: core.organizationId,
      }
    )
    manualDocs.push(result.doc)
    if (result.created) {
      summary.manualAssetsCreated += 1
      sourceChanged = true
    }
  }

  const openAssessments = await payload.find({
    collection: 'assessment-instances',
    where: {
      and: [
        { organization: { equals: core.organizationId } },
        { status: { in: ['pending', 'in_progress'] } },
      ],
    },
    overrideAccess: true,
    depth: 0,
    limit: 200,
  })
  const organizationAssessment = openAssessments.docs.find(row => row.scope === 'organization')
  const mainOfficeAssessment = openAssessments.docs.find(
    row => row.scope === 'office' && relationId(row.office) === mainOfficeId
  )
  const manualComputerAssessment = openAssessments.docs.find(
    row => row.manual_asset && relationId(row.manual_asset) === String(manualDocs[0].id)
  )
  const networkWorkstationAssessment = openAssessments.docs.find(
    row => row.asset && relationId(row.asset) === String(mainWorkstation.id)
  )
  for (const [assessment, mode, complete] of [
    [organizationAssessment, 'mixed', true],
    [mainOfficeAssessment, 'healthy', true],
    [manualComputerAssessment, 'weak', true],
    [networkWorkstationAssessment, 'mixed', false],
  ] as Array<[AssessmentInstance | undefined, 'healthy' | 'mixed' | 'weak', boolean]>) {
    const completed = await seedAssessment(payload, assessment, adminId, mode, complete)
    if (completed) {
      summary.assessmentsCompleted += 1
      sourceChanged = true
    }
  }

  const latestEvaluationByOffice = new Map<string, string>()
  for (const officeId of [mainOfficeId, secondaryOfficeId]) {
    const existingEvaluation = await findOne(payload, 'risk-evaluations', {
      and: [{ organization: { equals: core.organizationId } }, { office: { equals: officeId } }],
    })
    const evaluation =
      sourceChanged || !existingEvaluation
        ? await recalculateRisk(payload, { organizationId: core.organizationId, officeId })
        : existingEvaluation
    latestEvaluationByOffice.set(officeId, String(evaluation.id))
  }
  if (
    sourceChanged ||
    !(await findOne(payload, 'risk-evaluations', {
      and: [{ organization: { equals: core.organizationId } }, { office: { exists: false } }],
    }))
  ) {
    await recalculateRisk(payload, { organizationId: core.organizationId })
  }

  const snapshots = await payload.find({
    collection: 'inventory-snapshots',
    where: { organization: { equals: core.organizationId } },
    overrideAccess: true,
    depth: 0,
    limit: 100,
  })
  for (const officeId of [mainOfficeId, secondaryOfficeId]) {
    const hasPopulated = snapshots.docs.some(
      row => relationId(row.office) === officeId && snapshotContainsDemoAssets(row.assets_dump)
    )
    if (!hasPopulated) {
      await createInventorySnapshot(payload, officeId, { type: 'pre_audit' })
      summary.snapshotsCreated += 1
    }
  }

  const ctx = tenantContext(adminId, core.organizationId, [mainOfficeId, secondaryOfficeId])
  const taskInputs = [
    {
      title: 'Validar dispositivo desconocido detectado',
      description:
        'Identificar el equipo sin nombre observado por el escáner y confirmar si está autorizado.',
      priority: 'urgent' as const,
      officeId: mainOfficeId,
      startAt: at(now, -DAY),
      dueAt: at(now, -2 * 60 * 60 * 1000),
      reference: {
        relationTo: 'assets' as const,
        value: String((await findAsset(payload, 'demo-main-unknown')).id),
      },
      finalState: 'pending' as const,
    },
    {
      title: 'Actualizar reglas del gateway principal',
      description: 'Revisar exposición y reglas de acceso remoto del gateway.',
      priority: 'high' as const,
      officeId: mainOfficeId,
      startAt: at(now, 2 * DAY),
      dueAt: at(now, 5 * DAY),
      reference: { relationTo: 'assets' as const, value: String(mainGateway.id) },
      finalState: 'pending' as const,
    },
    {
      title: 'Revisar hardening del servidor de archivos',
      description: 'Validar servicios SMB y SSH contra la línea base segura.',
      priority: 'high' as const,
      officeId: mainOfficeId,
      startAt: at(now, -DAY),
      dueAt: at(now, 2 * DAY),
      reference: { relationTo: 'assets' as const, value: String(mainServer.id) },
      finalState: 'in_progress' as const,
    },
    {
      title: 'Documentar licencia corporativa',
      description: 'Confirmar alcance, responsables y fecha de renovación de la licencia.',
      priority: 'normal' as const,
      officeId: mainOfficeId,
      startAt: at(now, -8 * DAY),
      dueAt: at(now, -3 * DAY),
      reference: { relationTo: 'non-network-assets' as const, value: String(manualDocs[1].id) },
      finalState: 'completed' as const,
    },
    {
      title: 'Investigar cámara sin conexión',
      description: 'Verificar alimentación, enlace y vigencia del dispositivo del depósito.',
      priority: 'urgent' as const,
      officeId: secondaryOfficeId,
      startAt: at(now, -4 * DAY),
      dueAt: at(now, -DAY),
      reference: { relationTo: 'assets' as const, value: String(secondaryCamera.id) },
      finalState: 'cancelled' as const,
    },
    {
      title: 'Revisión histórica del riesgo de oficina',
      description: 'Tarea cerrada conservada como ejemplo de historial operativo.',
      priority: 'low' as const,
      officeId: secondaryOfficeId,
      startAt: at(now, -14 * DAY),
      dueAt: at(now, -10 * DAY),
      reference: {
        relationTo: 'risk-evaluations' as const,
        value: latestEvaluationByOffice.get(secondaryOfficeId)!,
      },
      finalState: 'archived' as const,
    },
  ]
  for (const input of taskInputs)
    summary.tasksCreated += Number(await ensureTask(payload, ctx, input))

  return summary
}
