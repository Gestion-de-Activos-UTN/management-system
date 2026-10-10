import { expect, it } from 'vitest'
import { revokeInactiveSessions } from './account-sessions'

it('clears every session on deactivation or updates of an inactive account', () => {
  for (const data of [{ status: 'inactive', sessions: [{ id: 'one' }] }, { name: 'Changed' }]) {
    const result = revokeInactiveSessions({
      data,
      originalDoc: { status: 'inactive' },
    } as unknown as Parameters<typeof revokeInactiveSessions>[0])
    expect(result).toMatchObject({ sessions: [] })
  }
})
it('does not restore revoked sessions on reactivation', () => {
  const data = { status: 'active' }
  expect(
    revokeInactiveSessions({
      data,
      originalDoc: { status: 'inactive', sessions: [] },
    } as unknown as Parameters<typeof revokeInactiveSessions>[0])
  ).toEqual(data)
})
