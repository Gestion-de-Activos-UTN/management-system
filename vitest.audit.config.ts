import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

// Exercise the seed on the empty disposable database before other fixtures exist.
class AuditSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    const sorted = await super.sort(files)
    return sorted.sort(
      (a, b) =>
        Number(b.moduleId.includes('security-policy')) -
        Number(a.moduleId.includes('security-policy'))
    )
  }
}

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include:
      process.env.SIAM_AUDIT_INTEGRATION === '1'
        ? process.env.SIAM_AUDIT_REMAINING === '1'
          ? ['endpoints/remaining-corroboration.audit.integration.test.ts']
          : ['**/*.audit.integration.test.ts']
        : ['**/*.audit.test.ts'],
    // Bootstrap and seed corroboration require their own empty disposable database.
    exclude:
      process.env.SIAM_AUDIT_REMAINING === '1'
        ? []
        : ['**/remaining-corroboration.audit.integration.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { sequencer: AuditSequencer },
    testTimeout: 30000,
    hookTimeout: 60000,
    env: { NODE_ENV: 'test', PAYLOAD_DISABLE_JOBS: '1' },
  },
})
