import { describe, expect, it } from 'vitest'
import { Users } from './index'
import { Admins } from '../Admins'

describe('SEC-40: explicit manual unlock denial with native lockout', () => {
  for (const collection of [Users, Admins]) {
    it(`${collection.slug} denies manual unlock; the lock expires after lockTime`, () => {
      expect((collection.access!.unlock as () => boolean)()).toBe(false)
      expect(collection.auth).toMatchObject({ maxLoginAttempts: 5, lockTime: 10 * 60 * 1000, useSessions: true })
    })
  }
})
