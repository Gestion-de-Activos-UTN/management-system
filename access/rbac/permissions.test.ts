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

// non-network-assets es la única colección con escritura habilitada: no la descubre ningún
// agente, la carga una persona. El resto del inventario sigue siendo solo-lectura.
test('non-network-assets: org_admin administra el inventario completo', () => {
  for (const action of ['create', 'read', 'update', 'delete'] as const) {
    assert.equal(canDo('org_admin', 'non-network-assets', action, 'org-1'), true, action)
  }
})

test('non-network-assets: office_manager carga y corrige pero no borra', () => {
  assert.equal(canDo('office_manager', 'non-network-assets', 'create', 'org-1'), true)
  assert.equal(canDo('office_manager', 'non-network-assets', 'update', 'org-1'), true)
  assert.equal(canDo('office_manager', 'non-network-assets', 'delete', 'org-1'), false)
})

test('non-network-assets: org_viewer y platform_admin solo leen', () => {
  for (const role of ['org_viewer', 'platform_admin'] as const) {
    assert.equal(canDo(role, 'non-network-assets', 'read', 'org-1'), true, role)
    assert.equal(canDo(role, 'non-network-assets', 'create', 'org-1'), false, role)
    assert.equal(canDo(role, 'non-network-assets', 'delete', 'org-1'), false, role)
  }
})

test('assets (descubiertos por el escáner) sigue siendo solo-lectura para todos', () => {
  for (const role of ['org_admin', 'office_manager', 'org_viewer', 'platform_admin'] as const) {
    assert.equal(canDo(role, 'assets', 'create', 'org-1'), false, role)
    assert.equal(canDo(role, 'assets', 'update', 'org-1'), false, role)
  }
})
