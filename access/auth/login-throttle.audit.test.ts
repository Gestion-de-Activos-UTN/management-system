import { afterEach, expect, it } from 'vitest'
import { LoginThrottle, loginOrigin } from './login-throttle'

const originalTrust = process.env.SIAM_TRUST_LOGIN_PROXY
afterEach(() => {
  if (originalTrust === undefined) delete process.env.SIAM_TRUST_LOGIN_PROXY
  else process.env.SIAM_TRUST_LOGIN_PROXY = originalTrust
})

it('limits an origin without blocking other origins or accounts', () => {
  const limiter = new LoginThrottle(2, 1)
  expect(limiter.take('A', 0)).toBe(true)
  expect(limiter.take('A', 0)).toBe(true)
  expect(limiter.take('A', 0)).toBe(false)
  expect(limiter.take('B', 0)).toBe(true)
  expect(limiter.take('A', 500)).toBe(false)
  expect(limiter.take('A', 1000)).toBe(true)
})
it('bounds memory without eviction letting attackers reset an active limit', () => {
  const limiter = new LoginThrottle(1, 1, 2)
  expect(limiter.take('A', 0)).toBe(true)
  expect(limiter.take('B', 0)).toBe(true)
  expect(limiter.take('C', 0)).toBe(false)
  expect(limiter.take('A', 0)).toBe(false)
  expect(limiter.take('C', 1000)).toBe(true)
})
it('ignores spoofable headers unless proxy trust was explicitly configured', () => {
  process.env.SIAM_TRUST_LOGIN_PROXY = '0'
  const headers = new Headers({ 'x-real-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.2' })
  expect(loginOrigin(headers)).toBeNull()
  process.env.SIAM_TRUST_LOGIN_PROXY = '1'
  expect(loginOrigin(headers)).toBe('192.0.2.1')
  expect(loginOrigin(new Headers({ 'x-real-ip': 'not-an-ip' }))).toBeNull()
})
