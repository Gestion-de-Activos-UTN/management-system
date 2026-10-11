import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignmentEligibleMembers, type EligibleMember } from './task-eligibility'

const members: EligibleMember[] = [
  { userId: 'u1', name: 'One', email: 'one@test', roleId: 'r1', role: 'org_admin', officeIds: [] },
  {
    userId: 'u2',
    name: 'Two',
    email: 'two@test',
    roleId: 'r2',
    role: 'office_manager',
    officeIds: ['o1'],
  },
]

test('open pool mantiene todos los candidatos ya autorizados', () => {
  assert.deepEqual(assignmentEligibleMembers(members, { assignment_kind: 'open_pool' }), members)
})

test('asignación por rol y usuario filtra candidatos', () => {
  assert.deepEqual(
    assignmentEligibleMembers(members, { assignment_kind: 'role', assigned_role: 'r2' }).map(
      m => m.userId
    ),
    ['u2']
  )
  assert.deepEqual(
    assignmentEligibleMembers(members, { assignment_kind: 'user', assigned_user: 'u1' }).map(
      m => m.userId
    ),
    ['u1']
  )
})
