import { afterEach, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'
import { enqueueRiskRecalculation } from './enqueueRiskRecalculation'
import { recoverJobsOnStartup } from './recover-jobs'

afterEach(() => {
  vi.unstubAllEnvs()
})
it('SEC-58: propagates the parent request to every queue write, without committing it', async () => {
  vi.stubEnv('PAYLOAD_DISABLE_JOBS', '0')
  const queue = vi.fn(async () => ({})),
    commit = vi.fn()
  const payload = { jobs: { queue }, db: { commitTransaction: commit } } as unknown as Payload
  const req = { payload, context: {}, transactionID: 'parent' } as unknown as PayloadRequest
  await enqueueRiskRecalculation(payload, 'org', ['a', 'a', null, 'b'], req)
  expect(queue).toHaveBeenCalledTimes(3)
  for (const [args] of queue.mock.calls as unknown as Array<[{ req: PayloadRequest }]>)
    expect(args.req).toBe(req)
  expect(commit).not.toHaveBeenCalled()
})
it('SEC-36: standalone replacement failure rolls back and does not commit', async () => {
  vi.stubEnv('PAYLOAD_DISABLE_JOBS', '0')
  const error = new Error('queue write failed'),
    rollback = vi.fn(),
    commit = vi.fn()
  const payload = {
    jobs: {
      queue: vi.fn(async () => {
        throw error
      }),
    },
    db: {
      beginTransaction: vi.fn(async () => 'owned'),
      rollbackTransaction: rollback,
      commitTransaction: commit,
    },
  } as unknown as Payload
  const req = { payload, context: {} } as unknown as PayloadRequest
  await expect(enqueueRiskRecalculation(payload, 'org', ['a'], req)).rejects.toBe(error)
  expect(rollback).toHaveBeenCalledWith('owned')
  expect(commit).not.toHaveBeenCalled()
  expect(req.transactionID).toBeUndefined()
})
it('SEC-57: recovers both queues on startup, with an explicit shared-worker opt-out', async () => {
  const update = vi.fn(async () => ({}))
  const payload = { update } as unknown as Payload
  await recoverJobsOnStartup(payload)
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        and: [{ queue: { in: ['risk', 'maintenance'] } }, { processing: { equals: true } }],
      },
      data: { processing: false },
    })
  )
  vi.stubEnv('SIAM_JOB_RECOVERY_ON_START', '0')
  await recoverJobsOnStartup(payload)
  expect(update).toHaveBeenCalledTimes(1)
})
