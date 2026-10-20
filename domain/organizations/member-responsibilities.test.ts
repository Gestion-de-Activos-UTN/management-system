import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PayloadRequest } from 'payload'
import {
  lostCoverage,
  releaseMemberTasks,
  sameCoverageInputs,
  withDeferredTaskReleases,
  type MemberCoverage,
} from './member-responsibilities'

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

test('sameCoverageInputs: ignora el orden y la forma (id o poblado) de las oficinas', () => {
  const previous = { is_active: true, role: 'r1', offices: ['a', 'b'] }
  assert.equal(sameCoverageInputs(previous, { ...previous, offices: [{ id: 'b' }, 'a'] }), true)
  assert.equal(sameCoverageInputs(previous, { ...previous, role: { id: 'r1' } }), true)
})

test('sameCoverageInputs: detecta cambios de estado, rol u oficinas', () => {
  const previous = { is_active: true, role: 'r1', offices: ['a', 'b'] }
  assert.equal(sameCoverageInputs(previous, { ...previous, is_active: false }), false)
  assert.equal(sameCoverageInputs(previous, { ...previous, role: 'r2' }), false)
  assert.equal(sameCoverageInputs(previous, { ...previous, offices: ['a'] }), false)
})

test('withDeferredTaskReleases: libera las tareas al final y restaura el contexto', async () => {
  const released: string[] = []
  const req = {
    context: {},
    payload: {
      find: async ({ where }: { where: { and: Array<Record<string, { equals?: string }>> } }) => {
        released.push(
          String(where.and.find(clause => clause['claimed_by.value'])?.['claimed_by.value']?.equals)
        )
        return { docs: [] }
      },
    },
  } as unknown as PayloadRequest
  await withDeferredTaskReleases(req, async () => {
    await releaseMemberTasks(req, {
      organizationId: 'org',
      userId: 'u1',
      offices: 'all',
      reason: 'member_deactivated',
    })
    assert.deepEqual(released, [], 'dentro del bloque sólo se encola')
  })
  assert.deepEqual(released, ['u1'])
  assert.equal(req.context.deferredTaskReleases, undefined)
})

test('withDeferredTaskReleases: si el bloque falla no libera nada y restaura el contexto', async () => {
  const req = {
    context: {},
    payload: { find: async () => assert.fail('no debe liberar') },
  } as unknown as PayloadRequest
  await assert.rejects(
    withDeferredTaskReleases(req, async () => {
      await releaseMemberTasks(req, {
        organizationId: 'org',
        userId: 'u1',
        offices: 'all',
        reason: 'member_deactivated',
      })
      throw new Error('boom')
    }),
    /boom/
  )
  assert.equal(req.context.deferredTaskReleases, undefined)
})
