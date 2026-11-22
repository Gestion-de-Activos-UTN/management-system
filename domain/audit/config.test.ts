import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import {
  AUDIT_KEY_BYTES,
  formatAuditKeyErrors,
  parseAuditKeys,
  type AuditKeyError,
  type AuditKeyErrorCode,
} from './config'

// Claves de prueba fijas (no secretas): 32 bytes repetidos, distintas entre sí.
const key = (byte: number) => Buffer.alloc(AUDIT_KEY_BYTES, byte).toString('base64')
const H1 = key(0x11)
const H2 = key(0x22)
const N1 = key(0x33)

const VALID = {
  AUDIT_HMAC_KEYS: `dev-20261122-a1b2:${H1},dev-20261123-c3d4:${H2}`,
  AUDIT_HMAC_ACTIVE_KEY_ID: 'dev-20261123-c3d4',
  AUDIT_NETWORK_KEYS: `dev-20261122-e5f6:${N1}`,
  AUDIT_NETWORK_ACTIVE_KEY_ID: 'dev-20261122-e5f6',
}

function errorsFor(overrides: Record<string, string | undefined>, production = false) {
  const result = parseAuditKeys({ ...VALID, ...overrides }, { production })
  assert.equal(result.ok, false, 'se esperaba que la configuración fuera rechazada')
  return (result as { errors: readonly AuditKeyError[] }).errors
}

test('acepta llaveros válidos y devuelve KeyObjects de 32 bytes', () => {
  const result = parseAuditKeys(VALID, { production: false })
  assert.ok(result.ok)
  const { hmac, network } = result.keys
  assert.deepEqual([...hmac.keys.keys()], ['dev-20261122-a1b2', 'dev-20261123-c3d4'])
  assert.equal(hmac.activeKeyId, 'dev-20261123-c3d4')
  assert.equal(hmac.active, hmac.keys.get('dev-20261123-c3d4'))
  assert.equal(hmac.active.symmetricKeySize, AUDIT_KEY_BYTES)
  assert.deepEqual(hmac.active.export(), Buffer.from(H2, 'base64'))
  assert.equal(network.activeKeyId, 'dev-20261122-e5f6')
  assert.deepEqual(network.active.export(), Buffer.from(N1, 'base64'))
})

test('imprimir el resultado no muestra ninguna clave', () => {
  const result = parseAuditKeys(VALID, { production: false })
  const printed = inspect(result, { depth: Infinity }) + JSON.stringify(result)
  for (const encoded of [H1, H2, N1]) {
    assert.ok(!printed.includes(encoded))
    assert.ok(!printed.includes(Buffer.from(encoded, 'base64').toString('hex')))
  }
})

test('rechaza con variable, posición y código, sin corregir nada', () => {
  const ok = `dev-20261122-a1b2:${H1}`
  const cases: Array<
    [string, Record<string, string | undefined>, string, number | undefined, AuditKeyErrorCode]
  > = [
    ['falta el llavero', { AUDIT_HMAC_KEYS: undefined }, 'AUDIT_HMAC_KEYS', undefined, 'missing'],
    ['llavero vacío', { AUDIT_HMAC_KEYS: '' }, 'AUDIT_HMAC_KEYS', undefined, 'empty'],
    ['coma al final', { AUDIT_HMAC_KEYS: `${ok},` }, 'AUDIT_HMAC_KEYS', 2, 'trailing_comma'],
    ['coma al principio', { AUDIT_HMAC_KEYS: `,${ok}` }, 'AUDIT_HMAC_KEYS', 1, 'empty_entry'],
    [
      'dos comas seguidas',
      { AUDIT_HMAC_KEYS: `${ok},,dev-x2:${H2}` },
      'AUDIT_HMAC_KEYS',
      2,
      'empty_entry',
    ],
    ['espacio al principio', { AUDIT_HMAC_KEYS: ` ${ok}` }, 'AUDIT_HMAC_KEYS', 1, 'whitespace'],
    [
      'espacio después de la coma',
      { AUDIT_HMAC_KEYS: `${ok}, dev-x2:${H2}` },
      'AUDIT_HMAC_KEYS',
      2,
      'whitespace',
    ],
    ['salto de línea al final', { AUDIT_HMAC_KEYS: `${ok}\n` }, 'AUDIT_HMAC_KEYS', 1, 'whitespace'],
    ['solo espacios', { AUDIT_HMAC_KEYS: '   ' }, 'AUDIT_HMAC_KEYS', 1, 'whitespace'],
    [
      'par sin ":"',
      { AUDIT_HMAC_KEYS: `${ok},dev-x2${H2}` },
      'AUDIT_HMAC_KEYS',
      2,
      'missing_separator',
    ],
    [
      'par con dos ":"',
      { AUDIT_HMAC_KEYS: `dev:x:${H1}` },
      'AUDIT_HMAC_KEYS',
      1,
      'extra_separator',
    ],
    ['id vacío', { AUDIT_HMAC_KEYS: `:${H1}` }, 'AUDIT_HMAC_KEYS', 1, 'invalid_id'],
    [
      'id con mayúsculas',
      { AUDIT_HMAC_KEYS: `Dev-a1b2:${H1}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_id',
    ],
    [
      'id con guion bajo',
      { AUDIT_HMAC_KEYS: `dev_a1b2:${H1}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_id',
    ],
    [
      'id que empieza con guion',
      { AUDIT_HMAC_KEYS: `-dev:${H1}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_id',
    ],
    ['id demasiado corto', { AUDIT_HMAC_KEYS: `ab:${H1}` }, 'AUDIT_HMAC_KEYS', 1, 'invalid_id'],
    [
      'id de 65 caracteres',
      { AUDIT_HMAC_KEYS: `${'a'.repeat(65)}:${H1}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_id',
    ],
    ['clave vacía', { AUDIT_HMAC_KEYS: 'dev-a1b2:' }, 'AUDIT_HMAC_KEYS', 1, 'invalid_key'],
    [
      'clave de 16 bytes',
      { AUDIT_HMAC_KEYS: `dev-a1b2:${Buffer.alloc(16, 1).toString('base64')}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_key',
    ],
    [
      'clave de 33 bytes',
      { AUDIT_HMAC_KEYS: `dev-a1b2:${Buffer.alloc(33, 1).toString('base64')}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_key',
    ],
    [
      'clave sin "="',
      { AUDIT_HMAC_KEYS: `dev-a1b2:${H1.slice(0, -1)}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_key',
    ],
    [
      'clave en base64url',
      { AUDIT_HMAC_KEYS: `dev-a1b2:${key(0xfb).replaceAll('+', '-').replaceAll('/', '_')}` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_key',
    ],
    // 'A'×42 + 'B' decodifica a los mismos 32 bytes que 'A'×43: Buffer.from lo aceptaría.
    [
      'clave en base64 no canónico',
      { AUDIT_HMAC_KEYS: `dev-a1b2:${'A'.repeat(42)}B=` },
      'AUDIT_HMAC_KEYS',
      1,
      'invalid_key',
    ],
    [
      'id repetido',
      { AUDIT_HMAC_KEYS: `${ok},dev-20261122-a1b2:${H2}` },
      'AUDIT_HMAC_KEYS',
      2,
      'duplicate_id',
    ],
    [
      'clave repetida con otro id',
      { AUDIT_HMAC_KEYS: `${ok},dev-20261123-c3d4:${H1}` },
      'AUDIT_HMAC_KEYS',
      2,
      'duplicate_key',
    ],
    [
      'misma clave en los dos llaveros',
      { AUDIT_NETWORK_KEYS: `dev-20261122-e5f6:${H2}` },
      'AUDIT_NETWORK_KEYS',
      1,
      'shared_key',
    ],
    [
      'falta la activa',
      { AUDIT_NETWORK_ACTIVE_KEY_ID: undefined },
      'AUDIT_NETWORK_ACTIVE_KEY_ID',
      undefined,
      'missing',
    ],
    [
      'activa vacía',
      { AUDIT_HMAC_ACTIVE_KEY_ID: '' },
      'AUDIT_HMAC_ACTIVE_KEY_ID',
      undefined,
      'empty',
    ],
    [
      'activa con espacio al final',
      { AUDIT_HMAC_ACTIVE_KEY_ID: 'dev-20261123-c3d4 ' },
      'AUDIT_HMAC_ACTIVE_KEY_ID',
      undefined,
      'whitespace',
    ],
    [
      'activa con formato inválido',
      { AUDIT_HMAC_ACTIVE_KEY_ID: 'DEV' },
      'AUDIT_HMAC_ACTIVE_KEY_ID',
      undefined,
      'invalid_id',
    ],
    [
      'activa que no está en el llavero',
      { AUDIT_HMAC_ACTIVE_KEY_ID: 'dev-otra' },
      'AUDIT_HMAC_ACTIVE_KEY_ID',
      undefined,
      'active_unknown',
    ],
  ]

  for (const [name, overrides, variable, position, code] of cases) {
    const errors = errorsFor(overrides)
    assert.equal(errors.length, 1, `${name}: ${formatAuditKeyErrors(errors)}`)
    const [error] = errors as [AuditKeyError]
    assert.equal(error.variable, variable, name)
    assert.equal(error.position, position, name)
    assert.equal(error.code, code, name)
    const where = position === undefined ? `${variable}: ` : `${variable}, posición ${position}: `
    assert.ok(error.message.startsWith(where), `${name}: ${error.message}`)

    // Nunca el valor: ni la clave, ni el id, ni el texto mal formado.
    for (const value of Object.values(overrides)) {
      for (const piece of (value ?? '').split(/[,:\s]/).filter(piece => piece.length >= 3))
        assert.ok(!error.message.includes(piece), `${name}: el mensaje incluye parte del valor`)
    }
  }
})

test('junta todos los errores de los dos llaveros', () => {
  const errors = errorsFor({
    AUDIT_HMAC_KEYS: `dev-a1b2:${H1},`,
    AUDIT_HMAC_ACTIVE_KEY_ID: undefined,
    AUDIT_NETWORK_KEYS: `dev-e5f6 :${N1}`,
  })
  assert.deepEqual(
    errors.map(error => [error.variable, error.position, error.code]),
    [
      ['AUDIT_HMAC_KEYS', 2, 'trailing_comma'],
      ['AUDIT_HMAC_ACTIVE_KEY_ID', undefined, 'missing'],
      ['AUDIT_NETWORK_KEYS', 1, 'whitespace'],
    ]
  )
  assert.equal(
    formatAuditKeyErrors(errors),
    [
      '- AUDIT_HMAC_KEYS, posición 2: coma al final (sobra la última coma).',
      '- AUDIT_HMAC_ACTIVE_KEY_ID: falta la variable.',
      '- AUDIT_NETWORK_KEYS, posición 1: contiene espacios u otros caracteres en blanco.',
    ].join('\n')
  )
})

test('en producción rechaza una clave activa de desarrollo', () => {
  const errors = errorsFor({}, true)
  assert.deepEqual(
    errors.map(error => [error.variable, error.code]),
    [
      ['AUDIT_HMAC_ACTIVE_KEY_ID', 'dev_key_in_production'],
      ['AUDIT_NETWORK_ACTIVE_KEY_ID', 'dev_key_in_production'],
    ]
  )
})

test('en producción acepta claves activas que no son de desarrollo, aunque queden dev- viejas', () => {
  const result = parseAuditKeys(
    {
      AUDIT_HMAC_KEYS: `dev-20261122-a1b2:${H1},prod-2027-01:${H2}`,
      AUDIT_HMAC_ACTIVE_KEY_ID: 'prod-2027-01',
      AUDIT_NETWORK_KEYS: `prod-2027-01:${N1}`,
      AUDIT_NETWORK_ACTIVE_KEY_ID: 'prod-2027-01',
    },
    { production: true }
  )
  assert.ok(result.ok)
  assert.equal(result.keys.hmac.activeKeyId, 'prod-2027-01')
})
