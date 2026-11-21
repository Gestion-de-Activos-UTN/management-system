import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from './catalog'

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
