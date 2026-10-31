import { expect, it } from 'vitest'
import { getTaskCurrentReferenceHref, getTaskReferenceHref } from './task-reference-link'
import { TaskReferenceSchema } from './schema'
import { TASK_REFERENCE_TYPE_LABELS } from './task-labels'

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

it('preserves existing control-result references after hiding the option from the general selector', () => {
  const reference = {
    relationTo: 'compliance-results',
    value: 'saved-result',
    available: true,
    office_id: 'office-A',
    label: 'Control guardado',
  } as const
  expect(TaskReferenceSchema.safeParse(reference).success).toBe(true)
  expect(TASK_REFERENCE_TYPE_LABELS[reference.relationTo]).toBe('Resultado de control')
  expect(getTaskReferenceHref(reference, 'org-A')).toBe(
    '/portal/security-review?result=saved-result&asOrganization=org-A'
  )
})
