import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { messageTargetsUser } from './targeting'

const org = 'org-1'
const user = 'user-1'

describe('messageTargetsUser', () => {
  it('un mensaje global llega a cualquier persona de cualquier organización', () => {
    assert.equal(messageTargetsUser({ scope: 'global', target_kind: 'all' }, org, null, user), true)
  })

  it('nunca llega a una organización que no está entre las destinatarias', () => {
    for (const target_kind of ['all', 'role', 'user'] as const) {
      assert.equal(
        messageTargetsUser(
          {
            scope: 'organizations',
            target_kind,
            target_organizations: ['org-2'],
            target_roles: ['org_admin'],
            target_users: [user],
          },
          org,
          'org_admin',
          user
        ),
        false
      )
    }
  })

  it('acepta relaciones pobladas además de ids', () => {
    assert.equal(
      messageTargetsUser(
        { scope: 'organizations', target_kind: 'all', target_organizations: [{ id: org }] },
        org,
        null,
        user
      ),
      true
    )
  })

  it('por rol exige que el rol de la persona esté elegido', () => {
    const message = {
      scope: 'organizations' as const,
      target_kind: 'role' as const,
      target_organizations: [org],
      target_roles: ['office_manager'],
    }
    assert.equal(messageTargetsUser(message, org, 'office_manager', user), true)
    assert.equal(messageTargetsUser(message, org, 'org_viewer', user), false)
    assert.equal(messageTargetsUser(message, org, null, user), false)
  })

  it('por persona exige que esté en la lista', () => {
    const message = {
      scope: 'organizations' as const,
      target_kind: 'user' as const,
      target_organizations: [org],
      target_users: [{ id: user }],
    }
    assert.equal(messageTargetsUser(message, org, 'org_viewer', user), true)
    assert.equal(messageTargetsUser(message, org, 'org_viewer', 'user-2'), false)
  })
})
