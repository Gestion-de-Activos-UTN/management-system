import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canDo } from './permissions'

test('org_viewer puede leer offices', () => {
  assert.equal(canDo('org_viewer', 'offices', 'read', 'org-1'), true)
})

test('org_viewer no puede actualizar offices (fase solo-lectura)', () => {
  assert.equal(canDo('org_viewer', 'offices', 'update', 'org-1'), false)
})

test('org_admin no puede crear organizations (fase solo-lectura)', () => {
  assert.equal(canDo('org_admin', 'organizations', 'create', 'org-1'), false)
})

test('platform_admin puede leer roles', () => {
  assert.equal(canDo('platform_admin', 'roles', 'read', null), true)
})

test('org_admin no puede leer roles (no está en su matriz)', () => {
  assert.equal(canDo('org_admin', 'roles', 'read', 'org-1'), false)
})

test('rol null/undefined siempre false', () => {
  assert.equal(canDo(null, 'offices', 'read', 'org-1'), false)
  assert.equal(canDo(undefined, 'offices', 'read', 'org-1'), false)
})
