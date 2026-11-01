import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// A component suite must never reach the application or a database by accident.
vi.stubGlobal('fetch', () => {
  throw new Error('Unexpected network request: provide an explicit HTTP test response')
})
