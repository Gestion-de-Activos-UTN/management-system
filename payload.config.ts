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
import { reportsEndpoint } from './endpoints/reports'
import { heartbeatEndpoint } from './endpoints/heartbeat'
import { vendorEndpoint } from './endpoints/vendor'
import { sessionEndpoint } from './endpoints/session'

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
  ],
  // Servidos vía app/(payload)/api/[...slug]/route.ts (catch-all de Next que reexporta
  // REST_GET/REST_POST/... de @payloadcms/next/routes) — sin ese archivo, Payload no recibe
  // tráfico, Next nunca delega la request.
  endpoints: [reportsEndpoint, heartbeatEndpoint, vendorEndpoint, sessionEndpoint],
  typescript: {
    outputFile: path.resolve(dirname, 'app/types/payload-types.ts'),
  },
})
