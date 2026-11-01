import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roleSlugLabel } from '../../lib/role-labels'
import { memberCoversOffice, orgMemberOptionLabel, type OrgMember } from './service'

const member = (role: OrgMember['role'], officeIds: string[]): OrgMember => ({
  id: 'user-1',
  name: 'Usuario',
  email: 'usuario@example.com',
  role,
  office_ids: officeIds,
  status: 'active',
  is_active: true,
})

test('los roles de oficina sólo pueden ser responsables en sus oficinas', () => {
  const manager = member('office_manager', ['office-1'])
  assert.equal(memberCoversOffice(manager, 'office-1'), true)
  assert.equal(memberCoversOffice(manager, 'office-2'), false)
})

test('los roles organizacionales pueden ser responsables en cualquier oficina', () => {
  assert.equal(memberCoversOffice(member('org_admin', []), 'office-2'), true)
})

test('la etiqueta usa el email si llega y, si no, la oficina; nunca imprime undefined', () => {
  const viewer = roleSlugLabel('org_viewer')
  const base = { name: 'Ana Pérez', role: 'org_viewer' }
  const label = (extra: Partial<OrgMember>) => orgMemberOptionLabel({ ...base, ...extra })
  assert.equal(label({ email: 'ana@example.com' }), `Ana Pérez · ${viewer} · ana@example.com`)
  assert.equal(label({ office_names: ['Rosario'] }), `Ana Pérez · ${viewer} · Rosario`)
  assert.equal(
    label({ office_names: ['Rosario', 'Palermo', 'Centro'] }),
    `Ana Pérez · ${viewer} · Rosario +2`
  )
  assert.equal(label({}), `Ana Pérez · ${viewer}`)
  assert.equal(label({ office_names: [] }), `Ana Pérez · ${viewer}`)
  assert.equal(
    orgMemberOptionLabel({ name: '', email: 'ana@example.com', role: 'org_viewer' }),
    `ana@example.com · ${viewer}`
  )
  for (const text of [label({}), label({ office_names: [] })]) {
    assert.doesNotMatch(text, /undefined| · · |· $/)
  }
})
