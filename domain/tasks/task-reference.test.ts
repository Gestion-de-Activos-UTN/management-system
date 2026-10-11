import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roleCanReadTaskReference } from './task-reference'

const officeAsset = {
  relationTo: 'assets' as const,
  value: 'asset-1',
  organizationId: 'org-1',
  officeId: 'office-1',
  label: 'Asset',
}

test('un rol de oficina sólo lee referencias dentro de sus oficinas', () => {
  assert.equal(roleCanReadTaskReference('office_manager', 'org-1', ['office-1'], officeAsset), true)
  assert.equal(
    roleCanReadTaskReference('office_manager', 'org-1', ['office-2'], officeAsset),
    false
  )
})

test('un rol sin permiso sobre la colección no puede leer la referencia', () => {
  assert.equal(
    roleCanReadTaskReference('org_viewer', 'org-1', ['office-1'], {
      ...officeAsset,
      relationTo: 'agents',
    }),
    false
  )
})

test('una referencia organizacional exige alcance organizacional', () => {
  const organizationAssessment = {
    relationTo: 'assessment-instances' as const,
    value: 'assessment-1',
    organizationId: 'org-1',
    officeId: null,
    label: 'Assessment',
  }
  assert.equal(
    roleCanReadTaskReference('office_manager', 'org-1', ['office-1'], organizationAssessment),
    false
  )
  assert.equal(roleCanReadTaskReference('org_admin', 'org-1', [], organizationAssessment), true)
})
