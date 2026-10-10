import { expect, it, vi } from 'vitest'
import { listResource } from './list-resource'
import { httpClient } from './http-client'
vi.mock('./http-client', () => ({ httpClient: { get: vi.fn() } }))
it('loads every bounded page rather than silently hiding rows after the default page', async () => {
  vi.mocked(httpClient.get)
    .mockResolvedValueOnce({ docs: [{ id: 'first' }], hasNextPage: true })
    .mockResolvedValueOnce({ docs: [{ id: 'second' }], hasNextPage: false })
  expect(await listResource('/api/assets', { asOrganization: 'org' })).toEqual([
    { id: 'first' },
    { id: 'second' },
  ])
  expect(httpClient.get).toHaveBeenNthCalledWith(2, '/api/assets', {
    sort: 'id',
    asOrganization: 'org',
    limit: '100',
    page: '2',
  })
})
