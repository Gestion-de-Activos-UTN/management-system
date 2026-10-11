import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { assertCreationOffices, assignmentOptionsScope } from './task-actions'
import { withTaskLock } from './with-task-lock'

const ctx: TenantContext = {
  userId: 'actor',
  organizationId: 'org',
  officeIds: ['office-a'],
  selectedOfficeId: 'office-a',
  role: 'office_manager',
  isActive: true,
  isPlatformAdmin: false,
}
const request = (task = { organization: 'org', office: 'office-a', status: 'pending' }) =>
  ({
    context: {},
    payload: {
      find: vi.fn(async () => ({ docs: [{ id: 'office-a' }] })),
      findByID: vi.fn(async () => task),
    },
  }) as unknown as PayloadRequest

describe('SEC-27: domain scope authorization', () => {
  it('rejects global creation and foreign offices before querying members', async () => {
    const req = request()
    await expect(assertCreationOffices(req, ctx, [])).rejects.toMatchObject({ code: 'forbidden' })
    await expect(assertCreationOffices(req, ctx, ['office-b'])).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(req.payload.find).not.toHaveBeenCalled()
    await expect(assertCreationOffices(req, ctx, ['office-a'])).resolves.toBeUndefined()
  })
  it('requires explicit creation scope but derives reassignment from stored task', async () => {
    const req = request()
    await expect(assignmentOptionsScope(req, ctx, { officeIds: [] })).rejects.toMatchObject({
      code: 'scope_required',
    })
    expect(await assignmentOptionsScope(req, ctx, { officeIds: [], taskId: 'task' })).toMatchObject(
      { offices: ['office-a'] }
    )
    await expect(
      assignmentOptionsScope(
        request({ organization: 'other', office: 'office-a', status: 'pending' }),
        ctx,
        { officeIds: [], taskId: 'task' }
      )
    ).rejects.toMatchObject({ status: 404 })
  })
  it('preserves authorized global reassignment and rejects terminal tasks', async () => {
    expect(
      await assignmentOptionsScope(
        request({ organization: 'org', office: '', status: 'pending' }),
        ctx,
        { officeIds: [], taskId: 'task' }
      )
    ).toMatchObject({ offices: [null] })
    await expect(
      assignmentOptionsScope(
        request({ organization: 'org', office: 'office-a', status: 'completed' }),
        ctx,
        { officeIds: [], taskId: 'task' }
      )
    ).rejects.toMatchObject({ status: 409 })
  })
})

it('SEC-54: owned locks commit/restore request; inherited transactions remain owned by caller', async () => {
  const execute = vi.fn(async () => ({})),
    commit = vi.fn(),
    rollback = vi.fn()
  const req = {
    context: {},
    payload: {
      db: {
        beginTransaction: vi.fn(async () => 'tx'),
        sessions: { tx: { db: { execute } } },
        commitTransaction: commit,
        rollbackTransaction: rollback,
      },
    },
  } as unknown as PayloadRequest
  expect(await withTaskLock(req, 'task', async () => 'result')).toBe('result')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(commit).toHaveBeenCalledWith('tx')
  expect(req.transactionID).toBeUndefined()
  req.transactionID = 'tx'
  await withTaskLock(req, 'task', async () => 'inherited')
  expect(commit).toHaveBeenCalledTimes(1)
  expect(req.transactionID).toBe('tx')
  req.transactionID = undefined
  await expect(
    withTaskLock(req, 'task', async () => {
      throw new Error('rejected')
    })
  ).rejects.toThrow('rejected')
  expect(rollback).toHaveBeenCalledWith('tx')
})
