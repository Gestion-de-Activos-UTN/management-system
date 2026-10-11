import { afterEach, expect, it, vi } from 'vitest'
import { platformOrigin } from './platform-origin'
afterEach(() => vi.unstubAllEnvs())
it('requires configured HTTPS in production and accepts loopback HTTP only in development', () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
  expect(platformOrigin).toThrow('required')
  for (const origin of ['http://localhost:3001', 'https://example.test/path', 'https://user:secret@example.test', 'https://example.test/?x=1']) {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin)
    expect(platformOrigin).toThrow()
  }
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.test')
  expect(platformOrigin()).toBe('https://example.test')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3001')
  expect(platformOrigin()).toBe('http://localhost:3001')
})
