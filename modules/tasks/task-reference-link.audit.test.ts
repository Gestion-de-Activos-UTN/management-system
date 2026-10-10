import { expect, it } from 'vitest'
import { getTaskCurrentReferenceHref, getTaskReferenceHref } from './task-reference-link'

it('live scope links preserve organization context while evidence links preserve the original version', () => {
  const risk = {
    relationTo: 'risk-evaluations',
    value: 'original-evaluation',
    available: true,
    office_id: 'office-A',
    label: 'Original',
  } as const
  expect(getTaskCurrentReferenceHref(risk, 'org-A')).toBe(
    '/portal/risk-score?officeId=office-A&asOrganization=org-A'
  )
  expect(getTaskReferenceHref(risk, 'org-A')).toContain(
    'evaluation=original-evaluation&officeId=office-A'
  )
  const snapshot = { ...risk, relationTo: 'inventory-snapshots' } as const
  expect(getTaskCurrentReferenceHref(snapshot)).toBe('/portal/inventory?officeId=office-A')
  expect(getTaskReferenceHref(snapshot)).toBe('/portal/inventory/snapshots/original-evaluation')
  expect(getTaskCurrentReferenceHref({ ...risk, office_id: null })).toBe(
    '/portal/risk-score?officeId=all'
  )
  expect(getTaskCurrentReferenceHref({ ...risk, available: false })).toBeNull()
})
