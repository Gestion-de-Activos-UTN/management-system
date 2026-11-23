import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_SECTION,
  AUDIT_OUTCOMES,
  AUDIT_SECTIONS,
} from './catalog'

test('cada código de acción es único', () => {
  const codes = AUDIT_ACTIONS.map(action => action.code)
  const repeated = codes.filter((code, index) => codes.indexOf(code) !== index)
  assert.deepEqual(repeated, [])
})

test('cada acción pertenece a una categoría existente', () => {
  const unknown = AUDIT_ACTIONS.filter(action => !(action.category in AUDIT_CATEGORIES))
  assert.deepEqual(
    unknown.map(action => action.code),
    []
  )
})

test('ninguna etiqueta está vacía ni es solo espacios', () => {
  const blankActions = AUDIT_ACTIONS.filter(action => !action.label.trim())
  const blankCategories = Object.entries(AUDIT_CATEGORIES).filter(([, label]) => !label.trim())
  assert.deepEqual(
    blankActions.map(action => action.code),
    []
  )
  assert.deepEqual(blankCategories, [])
})

test('toda categoría tiene al menos una acción', () => {
  const used = new Set<string>(AUDIT_ACTIONS.map(action => action.category))
  assert.deepEqual(
    Object.keys(AUDIT_CATEGORIES).filter(category => !used.has(category)),
    []
  )
})

test('los códigos tienen la forma entidad.verbo en minúsculas', () => {
  const malformed = AUDIT_ACTIONS.filter(action => !/^[a-z_]+\.[a-z_]+$/.test(action.code))
  assert.deepEqual(
    malformed.map(action => action.code),
    []
  )
})

test('cada categoría tiene una sección existente, y solo las categorías tienen sección', () => {
  assert.deepEqual(Object.keys(AUDIT_CATEGORY_SECTION).sort(), Object.keys(AUDIT_CATEGORIES).sort())
  const unknown = Object.entries(AUDIT_CATEGORY_SECTION).filter(
    ([, section]) => !(section in AUDIT_SECTIONS)
  )
  assert.deepEqual(unknown, [])
})

test('toda sección tiene al menos una categoría', () => {
  const used = new Set<string>(Object.values(AUDIT_CATEGORY_SECTION))
  assert.deepEqual(
    Object.keys(AUDIT_SECTIONS).filter(section => !used.has(section)),
    [],
    'Una sección sin categorías no se borra (la usan eventos viejos): marcarla como retirada y ajustar este test.'
  )
})

test('secciones y resultados: códigos en minúsculas y etiquetas no vacías', () => {
  for (const list of [AUDIT_SECTIONS, AUDIT_OUTCOMES]) {
    for (const [code, label] of Object.entries(list)) {
      assert.match(code, /^[a-z][a-z0-9_]*$/)
      assert.ok(label.trim(), `etiqueta vacía: ${code}`)
    }
  }
})

test('los resultados son exactamente success, failed y denied', () => {
  // La lista solo crece (el sobre valida eventos viejos con ella): agregar un valor es una
  // decisión que se registra; quitar uno, nunca.
  assert.deepEqual(Object.keys(AUDIT_OUTCOMES), ['success', 'failed', 'denied'])
})
