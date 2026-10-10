import { getPayload, type SanitizedConfig } from 'payload'

/** A seed can enqueue work, but must not become a second worker or recover a live worker's jobs. */
export async function initializeSeedPayload(config: SanitizedConfig | Promise<SanitizedConfig>) {
  const resolved = await config
  return getPayload({
    disableOnInit: true,
    config: {
      ...resolved,
      jobs: { ...resolved.jobs, autoRun: [] },
      typescript: { ...resolved.typescript, autoGenerate: false },
      admin: { ...resolved.admin, importMap: { ...resolved.admin.importMap, autoGenerate: false } },
    },
  })
}
