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

// Cierre del módulo de Inventario: el bloque de negocio de un Asset (alias/criticality/owner/
// location/status) ya es editable por org_admin/office_manager — el bloque técnico sigue
// bloqueado, pero eso lo hace technicalFieldAccess a nivel de campo (collections/Assets/index.ts),
// no esta matriz. `create`/`delete` siguen fuera de la matriz para todos los roles: un Asset
// nunca se crea/borra a mano, solo lo hace la ingesta con overrideAccess.
test('assets: org_admin y office_manager pueden editar el bloque de negocio', () => {
  for (const role of ['org_admin', 'office_manager'] as const) {
    assert.equal(canDo(role, 'assets', 'update', 'org-1'), true, role)
    assert.equal(canDo(role, 'assets', 'create', 'org-1'), false, role)
    assert.equal(canDo(role, 'assets', 'delete', 'org-1'), false, role)
  }
})

test('assets: org_viewer y platform_admin siguen en solo-lectura', () => {
  for (const role of ['org_viewer', 'platform_admin'] as const) {
    assert.equal(canDo(role, 'assets', 'read', 'org-1'), true, role)
    assert.equal(canDo(role, 'assets', 'update', 'org-1'), false, role)
    assert.equal(canDo(role, 'assets', 'create', 'org-1'), false, role)
  }
})
