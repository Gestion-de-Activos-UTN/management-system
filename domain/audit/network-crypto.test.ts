import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecretKey } from 'node:crypto'
import { parseAuditKeys, type AuditKeyring } from './config'
import { FIXTURE_ENVELOPE, FIXTURE_KEY_HEX, FIXTURE_NETWORK_CONTEXT } from './envelope.fixture'
import { computeNetworkDigest } from './hmac'
import { AuditNetworkContextError } from './network-context'
import {
  AUDIT_NETWORK_CIPHER_VERSION,
  AuditNetworkDecryptError,
  AuditNetworkKeyMissingError,
  decryptAesGcm,
  decryptNetworkContext,
  encryptNetworkContext,
  networkContextAad,
} from './network-crypto'

const hex = (...groups: string[]) => Buffer.from(groups.join(''), 'hex')

// Vectores de la especificación de GCM: D. McGrew y J. Viega, "The Galois/Counter Mode of
// Operation (GCM)", Apéndice B (Test Vectors). NIST la lista como propuesta de modo en
// https://csrc.nist.gov/projects/block-cipher-techniques/bcm/modes-development (fila GCM,
// "Revised specification posted June 2, 2005"), pero ya no enlaza el PDF: las rutas de CSRC
// dan 404. Copia usada (22/11/2026):
// https://luca-giuzzi.unibs.it/corsi/Support/papers-cryptography/gcm-spec.pdf
// (sha256 8cec9d63d2e28400773fff488c7aa9fcecb9636d50d994baca3cc025aa23df95).
// Valores copiados del documento, en los grupos en que están impresos.

// Test Case 16 (clave de 256 bits, P de 60 bytes, A de 20 bytes, IV de 96 bits): página 39 del
// documento (41 del PDF).
const TC16 = {
  K: hex('feffe9928665731c6d6a8f9467308308', 'feffe9928665731c6d6a8f9467308308'),
  P: hex(
    'd9313225f88406e5a55909c5aff5269a',
    '86a7a9531534f7da2e4c303d8a318a72',
    '1c3c0c95956809532fcf0e2449a6b525',
    'b16aedf5aa0de657ba637b39'
  ),
  A: hex('feedfacedeadbeeffeedfacedeadbeef', 'abaddad2'),
  IV: hex('cafebabefacedbaddecaf888'),
  C: hex(
    '522dc1f099567d07f47f37a32a84427d',
    '643a8cdcbfe5c0c97598a2bd2555d1aa',
    '8cb08e48590dbb3da7b08b1056828838',
    'c5f61e6393ba7a0abcc9f662'
  ),
  T: hex('76fc6ece0f4e1768cddf8853bb2d551b'),
}

// Test Case 14 (clave de 256 bits en cero, P de 16 bytes en cero, sin A): página 37 del
// documento (39 del PDF).
const TC14 = {
  K: hex('00000000000000000000000000000000', '00000000000000000000000000000000'),
  P: hex('00000000000000000000000000000000'),
  A: Buffer.alloc(0),
  IV: hex('000000000000000000000000'),
  C: hex('cea7403d4d606b6e074ec5d3baf39d18'),
  T: hex('d0d1c8a799996bf0265b98b5d48ab919'),
}

// Llavero de red de prueba: activa la 02; la 01 queda como versión vieja.
const RESULT = parseAuditKeys(
  {
    AUDIT_HMAC_KEYS: `test-hmac-01:${Buffer.from(FIXTURE_KEY_HEX, 'hex').toString('base64')}`,
    AUDIT_HMAC_ACTIVE_KEY_ID: 'test-hmac-01',
    AUDIT_NETWORK_KEYS: `test-net-01:${Buffer.alloc(32, 0x51).toString('base64')},test-net-02:${Buffer.alloc(32, 0x52).toString('base64')}`,
    AUDIT_NETWORK_ACTIVE_KEY_ID: 'test-net-02',
  },
  { production: false }
)
assert.ok(RESULT.ok)
const NETWORK: AuditKeyring = RESULT.keys.network
const HMAC = RESULT.keys.hmac
const BINDING = { chain_id: FIXTURE_ENVELOPE.chain_id, event_id: FIXTURE_ENVELOPE.id }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const nonCanonical = (tag: string) => `${tag.slice(0, 21)}${B64[B64.indexOf(tag[21]!) | 1]}==`

const flipBit = (base64: string, byte = 0) => {
  const bytes = Buffer.from(base64, 'base64')
  bytes[byte]! ^= 0x01
  return bytes.toString('base64')
}

function decryptError(stored: unknown, binding = BINDING): AuditNetworkDecryptError {
  try {
    decryptNetworkContext(stored, binding, NETWORK.keys)
  } catch (error) {
    assert.ok(
      error instanceof AuditNetworkDecryptError,
      `se esperaba AuditNetworkDecryptError: ${error}`
    )
    return error
  }
  assert.fail('se esperaba que el descifrado fallara')
}

test('descifra el Test Case 16 de la especificación de GCM (con AAD)', () => {
  assert.deepEqual(decryptAesGcm(TC16.K, TC16.IV, TC16.A, TC16.C, TC16.T), TC16.P)
})

test('descifra el Test Case 14 de la especificación de GCM (sin AAD)', () => {
  assert.deepEqual(decryptAesGcm(TC14.K, TC14.IV, TC14.A, TC14.C, TC14.T), TC14.P)
})

test('con el vector publicado, alterar tag, AAD, nonce o ciphertext hace fallar la autenticación', () => {
  const tampered = (buffer: Buffer) => {
    const copy = Buffer.from(buffer)
    copy[copy.length - 1]! ^= 0x01
    return copy
  }
  const attempts: Array<[string, () => Buffer]> = [
    ['tag', () => decryptAesGcm(TC16.K, TC16.IV, TC16.A, TC16.C, tampered(TC16.T))],
    ['AAD', () => decryptAesGcm(TC16.K, TC16.IV, tampered(TC16.A), TC16.C, TC16.T)],
    ['nonce', () => decryptAesGcm(TC16.K, tampered(TC16.IV), TC16.A, TC16.C, TC16.T)],
    ['ciphertext', () => decryptAesGcm(TC16.K, TC16.IV, TC16.A, tampered(TC16.C), TC16.T)],
    ['clave', () => decryptAesGcm(tampered(TC16.K), TC16.IV, TC16.A, TC16.C, TC16.T)],
  ]
  for (const [name, attempt] of attempts) assert.throws(attempt, AuditNetworkDecryptError, name)
})

test('rechaza un tag truncado aunque sea un prefijo del correcto', () => {
  for (const length of [4, 8, 12, 15])
    assert.throws(
      () => decryptAesGcm(TC16.K, TC16.IV, TC16.A, TC16.C, TC16.T.subarray(0, length)),
      AuditNetworkDecryptError,
      `tag de ${length} bytes`
    )
})

test('cifra y descifra el contexto, con el formato v1 esperado', () => {
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  assert.deepEqual(Object.keys(stored).sort(), ['ciphertext', 'key_id', 'nonce', 'tag', 'v'])
  assert.equal(stored.v, AUDIT_NETWORK_CIPHER_VERSION)
  assert.equal(stored.key_id, 'test-net-02')
  assert.equal(Buffer.from(stored.nonce, 'base64').length, 12)
  assert.equal(Buffer.from(stored.tag, 'base64').length, 16)
  assert.ok(!stored.ciphertext.includes(Buffer.from('203.0.113.7').toString('base64')))
  assert.deepEqual(decryptNetworkContext(stored, BINDING, NETWORK.keys), FIXTURE_NETWORK_CONTEXT)
})

test('el contexto descifrado coincide con su network_digest', () => {
  const digest = computeNetworkDigest(
    { ...BINDING, context: FIXTURE_NETWORK_CONTEXT },
    HMAC.activeKeyId,
    HMAC.keys
  )
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  const context = decryptNetworkContext(stored, BINDING, NETWORK.keys)
  assert.equal(computeNetworkDigest({ ...BINDING, context }, HMAC.activeKeyId, HMAC.keys), digest)
})

test('nunca repite el nonce: 1000 cifrados del mismo contexto', () => {
  const nonces = new Set<string>()
  const ciphertexts = new Set<string>()
  for (let i = 0; i < 1000; i++) {
    const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
    nonces.add(stored.nonce)
    ciphertexts.add(stored.ciphertext)
  }
  assert.equal(nonces.size, 1000)
  assert.equal(ciphertexts.size, 1000)
})

test('alterar nonce, tag o ciphertext guardados hace fallar el descifrado', () => {
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  for (const field of ['nonce', 'tag', 'ciphertext'] as const) {
    const error = decryptError({ ...stored, [field]: flipBit(stored[field]) })
    assert.match(error.message, /autenticación falló/, field)
  }
})

test('el ciphertext no se puede mover a otro evento ni a otra cadena (AAD)', () => {
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  decryptError(stored, { ...BINDING, event_id: '3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e70' })
  decryptError(stored, { ...BINDING, chain_id: 'org:1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' })
})

test('cambiar el key_id guardado hace fallar el descifrado', () => {
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  decryptError({ ...stored, key_id: 'test-net-01' })
  // Aun con la clave correcta, el key_id forma parte del AAD.
  const sameKey = new Map([['test-net-01', NETWORK.keys.get('test-net-02')!]])
  assert.throws(
    () => decryptNetworkContext({ ...stored, key_id: 'test-net-01' }, BINDING, sameKey),
    AuditNetworkDecryptError
  )
})

test('rotación: un contexto cifrado con la clave vieja se sigue leyendo', () => {
  const old: AuditKeyring = {
    ...NETWORK,
    activeKeyId: 'test-net-01',
    active: NETWORK.keys.get('test-net-01')!,
  }
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, old)
  assert.equal(stored.key_id, 'test-net-01')
  assert.deepEqual(decryptNetworkContext(stored, BINDING, NETWORK.keys), FIXTURE_NETWORK_CONTEXT)
})

test('una versión de clave ausente es un error propio', () => {
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  assert.throws(
    () => decryptNetworkContext({ ...stored, key_id: 'test-net-09' }, BINDING, NETWORK.keys),
    AuditNetworkKeyMissingError
  )
})

test('rechaza un formato guardado inválido antes de descifrar', () => {
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  const short = (base64: string, bytes: number) =>
    Buffer.from(base64, 'base64').subarray(0, bytes).toString('base64')
  const cases: Array<[string, Record<string, unknown>]> = [
    ['otra versión', { ...stored, v: 2 }],
    ['campo de más', { ...stored, extra: 1 }],
    ['tag de 12 bytes', { ...stored, tag: short(stored.tag, 12) }],
    ['nonce de 16 bytes', { ...stored, nonce: Buffer.alloc(16, 1).toString('base64') }],
    // 16 bytes = 22 caracteres + '==': el último carácter tiene 4 bits sin usar. Con uno en 1,
    // Buffer.from decodifica los mismos bytes, pero no es la forma canónica.
    ['tag en base64 no canónico', { ...stored, tag: nonCanonical(stored.tag) }],
    ['ciphertext vacío', { ...stored, ciphertext: '' }],
    [
      'ciphertext en base64url',
      { ...stored, ciphertext: stored.ciphertext.replaceAll('+', '-').replaceAll('/', '_') + '-_' },
    ],
    ['key_id inválido', { ...stored, key_id: 'Net 02' }],
  ]
  for (const [name, value] of cases) {
    const error = decryptError(value)
    assert.match(error.message, /formato guardado/, name)
  }
})

test('no cifra un contexto inválido y los errores no muestran la IP', () => {
  assert.throws(
    () =>
      encryptNetworkContext({ ...FIXTURE_NETWORK_CONTEXT, ip: '203.0.113.7:80' }, BINDING, NETWORK),
    AuditNetworkContextError
  )
  const stored = encryptNetworkContext(FIXTURE_NETWORK_CONTEXT, BINDING, NETWORK)
  const error = decryptError({ ...stored, tag: flipBit(stored.tag) })
  assert.ok(!error.message.includes('203.0.113.7'))
})

test('el AAD es el JSON canónico de chain_id, event_id, key_id y versión', () => {
  assert.equal(
    networkContextAad(BINDING, 'test-net-02').toString('utf8'),
    '{"chain_id":"org:0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e","event_id":"3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e6f","key_id":"test-net-02","v":1}'
  )
})

test('la clave de un vector no es aceptada si tiene otro largo', () => {
  assert.throws(
    () => decryptAesGcm(createSecretKey(Buffer.alloc(16)), TC14.IV, TC14.A, TC14.C, TC14.T),
    AuditNetworkDecryptError
  )
})
