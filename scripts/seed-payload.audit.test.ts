import { expect, it, vi } from 'vitest'
import { getPayload, type SanitizedConfig } from 'payload'
import { initializeSeedPayload } from './seed-payload'

vi.mock('payload', () => ({ getPayload: vi.fn(async options => options) }))
it('seed initialization disables scheduling/recovery/code generation without mutating app config', async () => {
  const jobs = {
    autoRun: [{ queue: 'maintenance', cron: '0 * * * * *' }],
    tasks: ['keep task configuration'],
  }
  const original = {
    jobs,
    typescript: {},
    admin: { importMap: {} },
    onInit: vi.fn(),
  } as unknown as SanitizedConfig
  await initializeSeedPayload(original)
  expect(getPayload).toHaveBeenCalledWith(
    expect.objectContaining({
      disableOnInit: true,
      config: expect.objectContaining({
        jobs: { ...jobs, autoRun: [] },
        typescript: { autoGenerate: false },
        admin: { importMap: { autoGenerate: false } },
      }),
    })
  )
  expect(original.jobs.autoRun).toHaveLength(1)
  expect(original.onInit).not.toHaveBeenCalled()
})
