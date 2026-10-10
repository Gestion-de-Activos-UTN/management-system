import { describe, expect, it } from 'vitest'
import { Users } from './index'
import { Admins } from '../Admins'

describe('SEC-40: explicit manual unlock denial', () => {
  for (const collection of [Users, Admins]) {
    it(`${collection.slug} denies unlock without account-wide lockout`, () => {
      expect((collection.access!.unlock as () => boolean)()).toBe(false)
      expect(collection.auth).toMatchObject({ maxLoginAttempts: 0, useSessions: true })
    })
  }
})
