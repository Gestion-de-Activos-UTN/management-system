import { expect, it } from 'vitest'
import { organizationRequestPath } from './organization-request-context'
it('forwards explicit portal selection for writes and preserves explicit API scope', () => {
  expect(organizationRequestPath('/api/v1/tasks', '?asOrganization=org-a')).toBe(
    '/api/v1/tasks?asOrganization=org-a'
  )
  expect(organizationRequestPath('/api/assets/id?depth=1', '?asOrganization=org-a')).toBe(
    '/api/assets/id?depth=1&asOrganization=org-a'
  )
  expect(
    organizationRequestPath('/api/v1/tasks?asOrganization=org-b', '?asOrganization=org-a')
  ).toContain('asOrganization=org-b')
  expect(organizationRequestPath('/api/v1/tasks', '')).toBe('/api/v1/tasks')
  expect(organizationRequestPath('https://external.test/path', '?asOrganization=org-a')).toBe(
    'https://external.test/path'
  )
})
