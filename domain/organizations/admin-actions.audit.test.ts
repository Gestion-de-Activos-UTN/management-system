import { expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { organizationWriteError } from './admin-actions'

it.each([true, undefined])('allows writes when organization.is_active is %s', async is_active => {
  const findByID = vi.fn().mockResolvedValue({ is_active })
  const req = { payload: { findByID } } as unknown as PayloadRequest
  expect(await organizationWriteError(req, 'organization-test')).toBeNull()
  expect(findByID).toHaveBeenCalledWith({
    collection: 'organizations',
    id: 'organization-test',
    overrideAccess: true,
    req,
    depth: 0,
  })
})

it('rejects writes only when the organization is explicitly inactive', async () => {
  const req = {
    payload: { findByID: vi.fn().mockResolvedValue({ is_active: false }) },
  } as unknown as PayloadRequest
  const response = await organizationWriteError(req, 'organization-test')
  expect(response?.status).toBe(409)
  expect(await response?.json()).toMatchObject({ error: 'organization_inactive' })
})

it('propagates an unexpected read failure instead of granting write access', async () => {
  const failure = new Error('Database unavailable')
  const req = {
    payload: { findByID: vi.fn().mockRejectedValue(failure) },
  } as unknown as PayloadRequest
  await expect(organizationWriteError(req, 'organization-test')).rejects.toBe(failure)
})
