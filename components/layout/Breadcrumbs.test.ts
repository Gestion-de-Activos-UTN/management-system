import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBreadcrumbs } from './Breadcrumbs'

const q = '?asOrganization=7'
const nav = [
  { label: 'Panel general', href: `/portal/dashboard${q}`, icon: null },
  { label: 'Tareas', href: `/portal/tasks${q}`, icon: null },
  {
    label: 'Inventario',
    href: `/portal/inventory${q}`,
    icon: null,
    children: [{ label: 'Escaneos', href: `/portal/inventory/scan-reports${q}`, icon: null }],
  },
]
const home = `/portal/dashboard${q}`
const labels = (pathname: string) => buildBreadcrumbs(nav, home, pathname).map(c => c.label)

test('buildBreadcrumbs muestra sólo antecesores, nunca la página actual', () => {
  assert.deepEqual(labels('/portal/dashboard'), [])
  // Sección de primer nivel: sólo quedaría "Panel general" → no se muestra.
  assert.deepEqual(labels('/portal/tasks'), [])
  assert.deepEqual(labels('/portal/tasks/12'), ['Panel general', 'Tareas'])
  assert.deepEqual(labels('/portal/inventory/scan-reports'), ['Panel general', 'Inventario'])
  assert.deepEqual(labels('/portal/inventory/scan-reports/9'), [
    'Panel general',
    'Inventario',
    'Escaneos',
  ])
  // Los hrefs conservan ?asOrganization=.
  assert.equal(buildBreadcrumbs(nav, home, '/portal/tasks/12')[1].href, `/portal/tasks${q}`)
})
