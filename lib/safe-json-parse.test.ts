import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeJsonParse } from './safe-json-parse'

test('safeJsonParse: parsea JSON normal igual que JSON.parse', () => {
  assert.deepEqual(safeJsonParse('{"a":1,"b":[1,2,3]}'), { a: 1, b: [1, 2, 3] })
})

test('safeJsonParse: descarta __proto__ en vez de contaminar Object.prototype', () => {
  const result = safeJsonParse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>
  assert.equal(result.a, 1)
  assert.equal(Object.getPrototypeOf(result), Object.prototype)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('safeJsonParse: descarta constructor/prototype en objetos anidados', () => {
  const result = safeJsonParse('{"nested":{"constructor":{"prototype":{"polluted":true}}}}') as {
    nested: Record<string, unknown>
  }
  // La key "constructor" propia se descarta durante el parse, así que la propiedad vuelve a
  // resolverse por herencia normal — el Object constructor nativo, no el objeto inyectado.
  assert.equal(result.nested.constructor, Object)
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined)
})

test('safeJsonParse: JSON inválido sigue tirando (mismo comportamiento que JSON.parse)', () => {
  assert.throws(() => safeJsonParse('{not valid json'))
})
