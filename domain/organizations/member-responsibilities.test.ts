import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lostCoverage, type MemberCoverage } from './member-responsibilities'

const active = ['a', 'b', 'c']
const member = (overrides: Partial<MemberCoverage> = {}): MemberCoverage => ({
  isActive: true,
  orgWide: false,
  officeIds: ['a', 'b'],
  ...overrides,
})

test('lostCoverage: desactivar a la persona libera todo', () => {
  assert.equal(lostCoverage(member(), member({ isActive: false }), active), 'all')
})

test('lostCoverage: una membership que ya estaba inactiva no pierde nada (reactivación)', () => {
  assert.deepEqual(lostCoverage(member({ isActive: false }), member(), active), [])
  assert.deepEqual(
    lostCoverage(member({ isActive: false }), member({ isActive: false }), active),
    []
  )
})

test('lostCoverage: quitarle una oficina libera sólo esa', () => {
  assert.deepEqual(lostCoverage(member(), member({ officeIds: ['a'] }), active), ['b'])
  assert.deepEqual(lostCoverage(member(), member({ officeIds: ['a', 'b', 'c'] }), active), [])
})

test('lostCoverage: degradar a un org-wide libera las oficinas activas que no conserva', () => {
  assert.deepEqual(
    lostCoverage(member({ orgWide: true, officeIds: [] }), member({ officeIds: ['a'] }), active),
    ['b', 'c']
  )
})

test('lostCoverage: ignora oficinas inactivas (updateMember las descarta en silencio)', () => {
  // 'z' está inactiva: perderla no es una pérdida real.
  assert.deepEqual(
    lostCoverage(member({ officeIds: ['a', 'z'] }), member({ officeIds: ['a'] }), active),
    []
  )
  assert.deepEqual(
    lostCoverage(
      member({ orgWide: true, officeIds: ['a', 'b', 'c', 'z'] }),
      member({ officeIds: ['a', 'b', 'c'] }),
      active
    ),
    []
  )
})

test('lostCoverage: pasar a org-wide no pierde nada', () => {
  assert.deepEqual(lostCoverage(member(), member({ orgWide: true, officeIds: [] }), active), [])
})
