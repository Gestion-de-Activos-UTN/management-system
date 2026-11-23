import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditChainError, auditOrganizationLockKey, parseAuditInteger } from './chain'

// node-postgres devuelve `numeric` como texto: sequence y schema_version se convierten
// explícitamente, y todo lo que no sea un entero exacto se rechaza (Tani, 23/11). Lo usa la
// lectura de la cabeza de la cadena y lo va a usar el verificador.

test('parseAuditInteger acepta enteros exactos, como número o como texto decimal', () => {
  for (const [value, expected] of [
    [0, 0],
    [2, 2],
    ['0', 0],
    ['2', 2],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ] as const) {
    assert.equal(parseAuditInteger(value, 'sequence'), expected, String(value))
  }
})

test('parseAuditInteger rechaza todo lo que no sea un entero exacto, sin mostrar el valor', () => {
  for (const value of [
    '2.0',
    '1e3',
    ' 2',
    '2 ',
    '',
    '02',
    '-1',
    '+2',
    '0x10',
    '9007199254740992',
    '9007199254740993',
    2.5,
    -1,
    2 ** 53,
    Number.NaN,
    null,
    undefined,
    true,
    {},
    [2],
  ]) {
    assert.throws(
      () => parseAuditInteger(value, 'sequence'),
      (error: unknown) =>
        error instanceof AuditChainError &&
        error.message === 'AuditLog: sequence no es un entero exacto.',
      JSON.stringify(value) ?? String(value)
    )
  }
})

test('la clave del lock de una organización es la de su cadena', () => {
  assert.equal(
    auditOrganizationLockKey('0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e'),
    'audit:org:0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e'
  )
})
