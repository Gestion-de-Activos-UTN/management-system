import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from '@/lib/canonical-json'
import { AUDIT_JSON_MAX_DEPTH, AuditCanonicalError, auditCanonicalJson } from './canonical'

function rejection(value: unknown): AuditCanonicalError {
  try {
    auditCanonicalJson(value)
  } catch (error) {
    assert.ok(error instanceof AuditCanonicalError, `se esperaba AuditCanonicalError: ${error}`)
    return error
  }
  assert.fail('se esperaba que el valor fuera rechazado')
}

function nested(levels: number): unknown {
  let value: unknown = 0
  for (let i = 0; i < levels; i++) value = [value]
  return value
}

test('produce el mismo texto que lib/canonical-json para JSON válido', () => {
  const value = {
    z: [{ b: 1, a: -0 }, 'ñandú 🦆'],
    a: null,
    big: 1e21,
    m: { y: true, x: false },
  }
  const expected = '{"a":null,"big":1e+21,"m":{"x":false,"y":true},"z":[{"a":0,"b":1},"ñandú 🦆"]}'
  assert.equal(auditCanonicalJson(value), expected)
  assert.equal(auditCanonicalJson(value), canonicalJson(value))
})

test('acepta valores sueltos, objetos sin prototipo y referencias repetidas no circulares', () => {
  assert.equal(auditCanonicalJson(null), 'null')
  assert.equal(auditCanonicalJson('texto'), '"texto"')
  assert.equal(auditCanonicalJson(-0), '0')
  const bare = Object.create(null) as Record<string, unknown>
  bare.b = 2
  bare.a = 1
  assert.equal(auditCanonicalJson(bare), '{"a":1,"b":2}')
  const shared = { id: 'x' }
  assert.equal(
    auditCanonicalJson({ before: shared, after: shared }),
    '{"after":{"id":"x"},"before":{"id":"x"}}'
  )
})

test('rechaza lo que no es JSON e indica dónde está', () => {
  class Snapshot {
    id = 'x'
  }
  const holes: unknown[] = [1]
  holes[2] = 3
  const extra = Object.assign([1, 2], { label: 'x' })
  const cases: Array<[string, unknown, string, string]> = [
    ['undefined suelto', undefined, '$', 'undefined'],
    ['undefined en un objeto', { a: { b: undefined } }, '$.a.b', 'undefined'],
    ['undefined en un array', { a: [1, undefined] }, '$.a[1]', 'undefined'],
    ['NaN', { n: NaN }, '$.n', 'no finito'],
    ['Infinity', { n: [-Infinity] }, '$.n[0]', 'no finito'],
    ['bigint', { n: BigInt(1) }, '$.n', 'bigint'],
    ['función', { f: () => 1 }, '$.f', 'function'],
    ['symbol como valor', { s: Symbol('s') }, '$.s', 'symbol'],
    ['symbol como clave', { [Symbol('s')]: 1 }, '$', 'symbol'],
    ['Date', { at: new Date(0) }, '$.at', 'Date'],
    ['Map', { m: new Map() }, '$.m', 'Map'],
    ['Set', { s: new Set([1]) }, '$.s', 'Set'],
    ['Buffer', { b: Buffer.from('x') }, '$.b', 'Buffer'],
    ['instancia de una clase', { s: new Snapshot() }, '$.s', 'Snapshot'],
    ['hueco en un array', { a: holes }, '$.a[1]', 'hueco'],
    ['array con propiedades extra', { a: extra }, '$.a', 'propiedades extra'],
    ['clave __proto__ propia', JSON.parse('{"__proto__":{"x":1}}'), '$.__proto__', '__proto__'],
    ['NUL en un texto', { t: 'a\u0000b' }, '$.t', 'NUL'],
    ['NUL en una clave', { 'a\u0000': 1 }, '$["a\\u0000"]', 'NUL'],
    ['surrogate suelto en un texto', { t: 'x\uD800' }, '$.t', 'surrogate'],
    ['surrogate suelto en una clave', { ['\uDC00']: 1 }, '$["�"]', 'surrogate'],
    [
      'clave que no es identificador',
      { 'otra clave': { x: NaN } },
      '$["otra clave"].x',
      'no finito',
    ],
  ]
  for (const [name, value, path, reason] of cases) {
    const error = rejection(value)
    assert.equal(error.path, path, name)
    assert.match(error.reason, new RegExp(reason), name)
    assert.match(error.message, /^Valor no admitido para el AuditLog en /, name)
  }
})

test('rechaza referencias circulares sin desbordar la pila', () => {
  const loop: Record<string, unknown> = { a: 1 }
  loop.self = { back: loop }
  const error = rejection(loop)
  assert.equal(error.path, '$.self.back')
  assert.match(error.reason, /circular/)
})

test(`admite hasta ${AUDIT_JSON_MAX_DEPTH} niveles anidados`, () => {
  assert.doesNotThrow(() => auditCanonicalJson(nested(AUDIT_JSON_MAX_DEPTH)))
  const error = rejection(nested(AUDIT_JSON_MAX_DEPTH + 1))
  assert.match(error.reason, /niveles anidados/)
})

test('el error nunca incluye el valor rechazado', () => {
  const secret = 'contraseña-que-no-debe-aparecer'
  for (const value of [{ t: `${secret}\u0000` }, { t: `${secret}\uD800` }]) {
    const error = rejection(value)
    assert.ok(!error.message.includes(secret))
    assert.ok(!String(error.stack).includes(secret))
  }
})

test('recorta en la ruta las claves largas', () => {
  const key = 'k'.repeat(100)
  const error = rejection({ [key]: NaN })
  assert.equal(error.path, `$["${'k'.repeat(64)}…"]`)
})
