import path from 'path'
import { fileURLToPath } from 'url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { Organizations } from './collections/Organizations'
import { Offices } from './collections/Offices'
import { Agents } from './collections/Agents'
import { Assets } from './collections/Assets'
import { ScanReports } from './collections/ScanReports'
import { reportsEndpoint } from './endpoints/reports'
import { heartbeatEndpoint } from './endpoints/heartbeat'
import { vendorEndpoint } from './endpoints/vendor'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET as string,
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL as string,
    },
  }),
  editor: lexicalEditor(),
  collections: [Organizations, Offices, Agents, Assets, ScanReports],
  // Registrados nativos acá, no vía app/(payload)/api/[...slug]/route.ts — Payload los expone
  // directo bajo /api sin pasar por el App Router de Next.
  endpoints: [reportsEndpoint, heartbeatEndpoint, vendorEndpoint],
  typescript: {
    outputFile: path.resolve(dirname, 'app/types/payload-types.ts'),
  },
})
