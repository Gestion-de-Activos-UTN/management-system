import assert from 'node:assert/strict'
import { test } from 'node:test'
import { memberCoversOffice, type OrgMember } from './service'

const member = (role: OrgMember['role'], officeIds: string[]): OrgMember => ({
  id: 'user-1',
  name: 'Usuario',
  email: 'usuario@example.com',
  role,
  office_ids: officeIds,
  status: 'active',
})

test('los roles de oficina sólo pueden ser responsables en sus oficinas', () => {
  const manager = member('office_manager', ['office-1'])
  assert.equal(memberCoversOffice(manager, 'office-1'), true)
  assert.equal(memberCoversOffice(manager, 'office-2'), false)
})

test('los roles organizacionales pueden ser responsables en cualquier oficina', () => {
  assert.equal(memberCoversOffice(member('org_admin', []), 'office-2'), true)
})
