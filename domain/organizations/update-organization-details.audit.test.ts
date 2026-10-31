import { expect, it, vi } from 'vitest'
import { updateOrganizationDetails } from './update-organization-details'
import type { PayloadRequest } from 'payload'

function request(active = true, settings = true) {
  const update = vi.fn().mockResolvedValue({})
  const req = {
    transactionID: 'test-transaction',
    payload: {
      findByID: vi.fn().mockResolvedValue({ is_active: active }),
      find: vi.fn().mockResolvedValue({ docs: settings ? [{ id: 'settings' }] : [] }),
      update,
    },
  } as unknown as PayloadRequest
  return { req, update }
}

it('requires an active organization and existing settings before any write', async () => {
  for (const [active, settings, code] of [
    [false, true, 'organization_inactive'],
    [true, false, 'organization_settings_missing'],
  ] as const) {
    const { req, update } = request(active, settings)
    await expect(
      updateOrganizationDetails(req, 'org', { name: 'Organización', industry: 'technology' })
    ).rejects.toMatchObject({ code })
    expect(update).not.toHaveBeenCalled()
  }
})

it('writes only name and industry through the same request and transaction', async () => {
  const { req, update } = request()
  await updateOrganizationDetails(req, 'org', { name: 'Organización', industry: 'technology' })
  expect(update).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ req, collection: 'organizations', data: { name: 'Organización' } })
  )
  expect(update).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      req,
      collection: 'organization-settings',
      data: { industry: 'technology', industry_details: null },
    })
  )
})
