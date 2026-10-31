import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTaskReference, roleCanReadTaskReference } from './task-reference'
import { formatDateTime } from '@/lib/format-date'
import type { PayloadRequest } from 'payload'

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

for (const collection of ['inventory-snapshots', 'scan-reports'] as const) {
  test(`${collection}: prioriza el nombre y conserva fecha de respaldo y oficina`, async () => {
    const date = '2026-10-30T12:00:00.000Z'
    for (const name of ['Evidencia de prueba', null, '   ']) {
      const req = {
        payload: {
          findByID: async ({ collection: requested }: { collection: string }) =>
            requested === 'offices'
              ? { id: 'office-1', name: 'Casa central', organization: 'org-1' }
              : {
                  id: 'evidence-1',
                  organization: 'org-1',
                  office: 'office-1',
                  display_name: name,
                  taken_at: date,
                  scan_start: date,
                },
        },
      } as unknown as PayloadRequest
      const reference = await resolveTaskReference(req, {
        relationTo: collection,
        value: 'evidence-1',
      })
      assert.equal(reference.label, `${name?.trim() ? name : formatDateTime(date)} · Casa central`)
      assert.equal(reference.value, 'evidence-1')
      assert.equal(reference.officeId, 'office-1')
    }
  })
}
