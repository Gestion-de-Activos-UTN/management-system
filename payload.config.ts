import path from 'path'
import { fileURLToPath } from 'url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
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
import { reportsEndpoint } from './endpoints/reports'
import { heartbeatEndpoint } from './endpoints/heartbeat'
import { vendorEndpoint } from './endpoints/vendor'
import { sessionEndpoint } from './endpoints/session'
import { nonNetworkAssetReviewEndpoint } from './endpoints/nonNetworkAssetReview'
import { assetIdentifyEndpoint } from './endpoints/assetIdentify'
import { assetUnidentifyEndpoint } from './endpoints/assetUnidentify'
import { assetBusinessEndpoint } from './endpoints/assetBusiness'
import { agingSweepEndpoint, expireRawScanPayloadsEndpoint } from './endpoints/internalJobs'
import { generateInventorySnapshotEndpoint } from './endpoints/inventorySnapshots'
import { orgMembersEndpoint } from './endpoints/orgMembers'
import {
  organizationSettingsGetEndpoint,
  organizationSettingsUpdateEndpoint,
} from './endpoints/organizationSettings'
import { agentProvisioningEndpoint } from './endpoints/agentProvisioning'
import { officeAgentSummaryEndpoint } from './endpoints/officeAgentSummary'
import { dashboardMetricsEndpoint } from './endpoints/dashboardMetrics'
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

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
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
  ],
  // Servidos vía app/(payload)/api/[...slug]/route.ts (catch-all de Next que reexporta
  // REST_GET/REST_POST/... de @payloadcms/next/routes) — sin ese archivo, Payload no recibe
  // tráfico, Next nunca delega la request.
  endpoints: [
    reportsEndpoint,
    heartbeatEndpoint,
    vendorEndpoint,
    sessionEndpoint,
    nonNetworkAssetReviewEndpoint,
    assetIdentifyEndpoint,
    assetUnidentifyEndpoint,
    assetBusinessEndpoint,
    agingSweepEndpoint,
    expireRawScanPayloadsEndpoint,
    generateInventorySnapshotEndpoint,
    orgMembersEndpoint,
    organizationSettingsGetEndpoint,
    organizationSettingsUpdateEndpoint,
    agentProvisioningEndpoint,
    officeAgentSummaryEndpoint,
    dashboardMetricsEndpoint,
    agentRevokeEndpoint,
    assessmentsListEndpoint,
    securityReviewSummaryEndpoint,
    assessmentDetailEndpoint,
    assessmentDraftEndpoint,
    assessmentCompleteEndpoint,
    assessmentReopenEndpoint,
    assessmentPolicyEndpoint,
  ],
  jobs: {
    deleteJobOnComplete: true,
    tasks: [
      {
        slug: 'expire-raw-scan-payloads',
        label: 'Expire raw scan payloads',
        inputSchema: [],
        outputSchema: [{ name: 'expired', type: 'number', required: true }],
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
          output: await reconcileExpiredAssetExclusions(req.payload),
        }),
      },
    ],
    // Payload agenda y ejecuta localmente la tarea diaria dentro del proceso de la aplicación.
    // No requiere cron administrado, workers ni servicios externos.
    autoRun: [{ cron: '0 * * * * *', queue: 'maintenance', limit: 1 }],
  },
  typescript: {
    outputFile: path.resolve(dirname, 'app/types/payload-types.ts'),
  },
})
