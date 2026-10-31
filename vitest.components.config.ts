import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['**/*.component.test.tsx'],
    environment: 'happy-dom',
    setupFiles: ['./testing/components-setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
    env: { NODE_ENV: 'test', PAYLOAD_DISABLE_JOBS: '1' },
  },
})
