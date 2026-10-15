import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portalHref } from './portal-href'

test('portalHref conserva asOrganization y combina parámetros extra', () => {
  assert.equal(portalHref('/portal/inventory'), '/portal/inventory')
  assert.equal(portalHref('/portal/inventory', null, 'tab=x'), '/portal/inventory?tab=x')
  assert.equal(portalHref('/portal/inventory', '42'), '/portal/inventory?asOrganization=42')
  assert.equal(
    portalHref('/portal/inventory', '42', 'tab=x'),
    '/portal/inventory?tab=x&asOrganization=42'
  )
  assert.equal(portalHref('/portal/a?step=2', '42'), '/portal/a?step=2&asOrganization=42')
})
