import { InventoryIncidents } from './collections/InventoryIncidents'
import { resolveInventoryIncidentEndpoint } from './endpoints/inventoryIncidents'
import { recoverJobsOnStartup } from './domain/risk/recover-jobs'
import path from 'path'
import { fileURLToPath } from 'url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { platformOrigin } from './lib/platform-origin'
import { Organizations } from './collections/Organizations'
import { Offices } from './collections/Offices'
import { Agents } from './collections/Agents'
import { Assets } from './collections/Assets'
import { NonNetworkAssets } from './collections/NonNetworkAssets'
import { ScanReports } from './collections/ScanReports'
import { Roles } from './collections/Roles'
import { OrganizationSettings } from './collections/OrganizationSettings'
import { Subscriptions } from './collections/Subscriptions'
import { Admins } from './collections/Admins'
import { Users } from './collections/Users'
import { OrganizationMemberships } from './collections/OrganizationMemberships'
import { JobRun } from './collections/JobRun'
import { InventorySnapshots } from './collections/InventorySnapshots'
import { AssessmentInstances } from './collections/AssessmentInstances'
import { AssessmentAnswers } from './collections/AssessmentAnswers'
import { ComplianceResults } from './collections/ComplianceResults'
import { RiskEvaluations } from './collections/RiskEvaluations'
import { RiskContributions } from './collections/RiskContributions'
import { Tasks } from './collections/Tasks'
import { PortalMessages } from './collections/PortalMessages'
import { PortalMessageReceipts } from './collections/PortalMessageReceipts'
import { latestRiskEvaluationEndpoint } from './endpoints/risk'
import { taskEndpoints } from './endpoints/tasks'
import { portalMessageEndpoints } from './endpoints/portalMessages'
import { recalculateRisk } from './domain/risk/recalculateRisk'
import { enqueueOrganizationRiskRecalculation } from './domain/risk/enqueueRiskRecalculation'
import { reportsEndpoint } from './endpoints/reports'
import { heartbeatEndpoint } from './endpoints/heartbeat'
import { vendorEndpoint } from './endpoints/vendor'
import { sessionEndpoint } from './endpoints/session'
import {
  platformAdminProfileEndpoint,
  updatePlatformAdminProfileEndpoint,
} from './endpoints/platformAdminProfile'
import { nonNetworkAssetReviewEndpoint } from './endpoints/nonNetworkAssetReview'
import { inventorySnapshotNameEndpoint, scanReportNameEndpoint } from './endpoints/evidenceNames'
import { assetIdentifyEndpoint } from './endpoints/assetIdentify'
import { assetUnidentifyEndpoint } from './endpoints/assetUnidentify'
import { assetBusinessEndpoint } from './endpoints/assetBusiness'
import { agingSweepEndpoint, expireRawScanPayloadsEndpoint } from './endpoints/internalJobs'
import { agingSweep } from './domain/inventories/agingSweep'
import { generateInventorySnapshotEndpoint } from './endpoints/inventorySnapshots'
import {
  orgMemberDeactivationImpactEndpoint,
  orgMembersEndpoint,
  updateOrgMemberEndpoint,
} from './endpoints/orgMembers'
import { officeEndpoints } from './endpoints/offices'
import { myProfileEndpoints } from './endpoints/myProfile'
import {
  organizationSettingsGetEndpoint,
  organizationSettingsUpdateEndpoint,
  organizationMaturityUpdateEndpoint,
} from './endpoints/organizationSettings'
import { agentProvisioningEndpoint } from './endpoints/agentProvisioning'
import { officeAgentSummaryEndpoint } from './endpoints/officeAgentSummary'
import { dashboardMetricsEndpoint } from './endpoints/dashboardMetrics'
import { platformDashboardEndpoint } from './endpoints/platformDashboard'
import { platformOrganizationEndpoints } from './endpoints/platformOrganizations'
import { agentRevokeEndpoint } from './endpoints/agentRevoke'
import { expireRawScanPayloads } from './domain/inventories/expireRawScanPayloads'
import { reconcileExpiredAssessments } from './domain/assessments/reconcileExpiredAssessments'
import { reconcileExpiredAssetExclusions } from './domain/assessments/reconcileExpiredAssetExclusions'
import {
  assessmentCompleteEndpoint,
  assessmentDetailEndpoint,
  assessmentDraftEndpoint,
  assessmentReopenEndpoint,
  assessmentPolicyEndpoint,
  assessmentsListEndpoint,
  securityReviewSummaryEndpoint,
} from './endpoints/assessments'
import {
  bulkAssessmentCompleteEndpoint,
  bulkAssessmentPreviewEndpoint,
} from './endpoints/bulkAssessments'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  serverURL: platformOrigin(),
  csrf: [platformOrigin()],
  cors: [platformOrigin()],
  secret: process.env.PAYLOAD_SECRET as string,
  db: postgresAdapter({
    // Applies to every collection without its own `id` field — Agents/ScanReports
    // define a custom text id (agent_id/report_id) and are unaffected.
    idType: 'uuid',
    pool: {
      connectionString: process.env.DATABASE_URL as string,
    },
  }),
  editor: lexicalEditor(),
  // El login prueba admins primero y users después (modules/auth/service.ts) — un login de
  // usuario normal SIEMPRE dispara un 401 de admins antes del intento real. Ese 401 ya se
  // devuelve al cliente (no es información que se pierda) y no es un malfuncionamiento del
  // servidor, así que no amerita nivel 'error' con stack trace — solo ensucia los logs.
  // Sigue vigente después de Auth0: ese flujo también va a tener su propio "401 esperado".
  loggingLevels: {
    AuthenticationError: 'info',
  },
  collections: [
    Organizations,
    Offices,
    Agents,
    Assets,
    NonNetworkAssets,
    ScanReports,
    Roles,
    OrganizationSettings,
    Subscriptions,
    Admins,
    Users,
    OrganizationMemberships,
    JobRun,
    InventorySnapshots,
    AssessmentInstances,
    AssessmentAnswers,
    ComplianceResults,
    RiskEvaluations,
    RiskContributions,
    Tasks,
    PortalMessages,
    PortalMessageReceipts,
    InventoryIncidents,
  ],
  // Servidos vía app/(payload)/api/[...slug]/route.ts (catch-all de Next que reexporta
  // REST_GET/REST_POST/... de @payloadcms/next/routes) — sin ese archivo, Payload no recibe
  // tráfico, Next nunca delega la request.
  endpoints: [
    resolveInventoryIncidentEndpoint,
    reportsEndpoint,
    heartbeatEndpoint,
    vendorEndpoint,
    sessionEndpoint,
    platformAdminProfileEndpoint,
    updatePlatformAdminProfileEndpoint,
    nonNetworkAssetReviewEndpoint,
    scanReportNameEndpoint,
    inventorySnapshotNameEndpoint,
    assetIdentifyEndpoint,
    assetUnidentifyEndpoint,
    assetBusinessEndpoint,
    agingSweepEndpoint,
    expireRawScanPayloadsEndpoint,
    generateInventorySnapshotEndpoint,
    orgMembersEndpoint,
    updateOrgMemberEndpoint,
    orgMemberDeactivationImpactEndpoint,
    organizationSettingsGetEndpoint,
    organizationSettingsUpdateEndpoint,
    organizationMaturityUpdateEndpoint,
    agentProvisioningEndpoint,
    officeAgentSummaryEndpoint,
    dashboardMetricsEndpoint,
    platformDashboardEndpoint,
    ...platformOrganizationEndpoints,
    agentRevokeEndpoint,
    // Specific bulk routes must precede /v1/assessments/:id/* or Payload treats "bulk" as an id.
    bulkAssessmentPreviewEndpoint,
    bulkAssessmentCompleteEndpoint,
    assessmentsListEndpoint,
    securityReviewSummaryEndpoint,
    assessmentDetailEndpoint,
    assessmentDraftEndpoint,
    assessmentCompleteEndpoint,
    assessmentReopenEndpoint,
    assessmentPolicyEndpoint,
    latestRiskEvaluationEndpoint,
    ...taskEndpoints,
    ...portalMessageEndpoints,
    ...officeEndpoints,
    ...myProfileEndpoints,
  ],
  jobs: {
    // Queue supersede/delete/create must use the caller's transaction, without the hook path
    // that forces disableTransaction in Payload 3.86.0.
    runHooks: false,
    deleteJobOnComplete: true,
    enableConcurrencyControl: true,
    tasks: [
      {
        slug: 'recalculate-risk',
        label: 'Recalculate risk',
        retries: { attempts: 5, backoff: { type: 'exponential', delay: 1000 } },
        // One run at a time per organization/office scope, and a new event replaces the pending
        // run: only the latest state matters, so bursts (a scan updating every asset) collapse.
        concurrency: {
          key: ({ input }) => `risk:${input.organization_id}:${input.office_id || 'org'}`,
          exclusive: true,
          supersedes: true,
        },
        inputSchema: [
          { name: 'organization_id', type: 'text', required: true },
          { name: 'office_id', type: 'text' },
        ],
        // Sin evaluation_id cuando la organización o la oficina quedaron inactivas entre el
        // encolado y la corrida: no cuentan en riesgo y no se persiste nada.
        outputSchema: [{ name: 'evaluation_id', type: 'text' }],
        handler: async ({ input, req }) => {
          const [organization, office] = await Promise.all([
            req.payload.findByID({
              collection: 'organizations',
              id: input.organization_id,
              overrideAccess: true,
              req,
              depth: 0,
            }),
            input.office_id
              ? req.payload.findByID({
                  collection: 'offices',
                  id: input.office_id,
                  overrideAccess: true,
                  req,
                  depth: 0,
                })
              : null,
          ])
          if (organization.is_active === false || office?.is_active === false) return { output: {} }
          const evaluation = await recalculateRisk(
            req.payload,
            { organizationId: input.organization_id, officeId: input.office_id || undefined },
            req
          )
          return { output: { evaluation_id: String(evaluation.id) } }
        },
      },
      {
        // Answer expiry (valid_until) and stale agent heartbeats change risk without any event.
        // ponytail: daily safety net, so those two can lag up to a day; enqueue from the jobs that
        // detect them if fresher risk is needed. Every other change enqueues its own recalculation.
        slug: 'refresh-risk',
        label: 'Refresh risk evaluations',
        inputSchema: [],
        outputSchema: [{ name: 'organizations', type: 'number', required: true }],
        retries: 5,
        schedule: [{ cron: '0 45 3 * * *', queue: 'maintenance' }],
        handler: async ({ req }) => {
          const organizations = await req.payload.find({
            collection: 'organizations',
            where: { is_active: { equals: true } },
            overrideAccess: true,
            depth: 0,
            pagination: false,
            select: {},
          })
          const failures: unknown[] = []
          for (const organization of organizations.docs) {
            try {
              await enqueueOrganizationRiskRecalculation(req.payload, String(organization.id))
            } catch (error) {
              failures.push(error)
            }
          }
          if (failures.length)
            throw new AggregateError(failures, 'Risk refresh could not queue every organization')
          return { output: { organizations: organizations.docs.length } }
        },
      },
      {
        slug: 'aging-sweep',
        label: 'Refresh offline inventory',
        inputSchema: [],
        outputSchema: [
          { name: 'assets_transitioned', type: 'number', required: true },
          { name: 'organizations_processed', type: 'number', required: true },
        ],
        retries: 5,
        // Hourly: offline_after_hours is measured in hours. Offset from the exclusions job.
        schedule: [{ cron: '0 5 * * * *', queue: 'maintenance' }],
        handler: async ({ req }) => ({ output: await agingSweep(req.payload) }),
      },
      {
        slug: 'expire-raw-scan-payloads',
        label: 'Expire raw scan payloads',
        inputSchema: [],
        outputSchema: [
          { name: 'expired', type: 'number', required: true },
          { name: 'asset_evidence_expired', type: 'number', required: true },
          { name: 'snapshot_evidence_expired', type: 'number', required: true },
        ],
        schedule: [{ cron: '0 15 3 * * *', queue: 'maintenance' }],
        handler: async ({ req }) => ({
          output: await expireRawScanPayloads(req.payload),
        }),
      },
      {
        slug: 'reconcile-expired-assessments',
        label: 'Reconcile expired security reviews',
        inputSchema: [],
        outputSchema: [
          { name: 'expired_cycles_examined', type: 'number', required: true },
          { name: 'cycles_created', type: 'number', required: true },
          { name: 'cycles_preserved', type: 'number', required: true },
          { name: 'cycles_skipped', type: 'number', required: true },
        ],
        schedule: [{ cron: '0 30 3 * * *', queue: 'maintenance' }],
        handler: async ({ req }) => ({
          output: await reconcileExpiredAssessments(req.payload),
        }),
      },
      {
        slug: 'reconcile-expired-asset-exclusions',
        label: 'Reinclude assets with expired assessment exclusions',
        inputSchema: [],
        outputSchema: [
          { name: 'network_assets_reincluded', type: 'number', required: true },
          { name: 'manual_assets_reincluded', type: 'number', required: true },
        ],
        schedule: [{ cron: '0 0 * * * *', queue: 'maintenance' }],
        handler: async ({ req }) => ({
          output: await reconcileExpiredAssetExclusions(req.payload, new Date(), req),
        }),
      },
    ],
    // Payload agenda y ejecuta estas tareas dentro del proceso de la aplicación: no requiere cron
    // administrado ni workers, pero sí un proceso siempre encendido (no funciona en serverless).
    autoRun: [
      { cron: '0 * * * * *', queue: 'maintenance', limit: 5 },
      // Risk recalculations are queued by domain events; the task's concurrency key collapses bursts.
      { cron: '*/15 * * * * *', queue: 'risk', limit: 10 },
    ],
  },
  // Single-worker startup recovery; disable SIAM_JOB_RECOVERY_ON_START for shared workers.
  onInit: recoverJobsOnStartup,
  typescript: {
    outputFile: path.resolve(dirname, 'app/types/payload-types.ts'),
  },
})
