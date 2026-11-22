import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIT_KEY_ID_PATTERN, parseAuditKeys } from './config'
import { planKeysInit, type KeysInitPlan } from './keys-init'

const NOW = new Date('2026-11-22T23:10:00.000Z')

/** CSPRNG de prueba: devuelve bloques fijos en orden (sufijo del id y clave, por llavero). */
function fakeRandom(...blocks: Buffer[]) {
  const queue = [...blocks]
  return (size: number) => {
    const next = queue.shift()
    assert.ok(next, 'se pidieron más bytes aleatorios de los previstos')
    assert.equal(next.length, size, 'tamaño de bytes aleatorios inesperado')
    return next
  }
}

const HMAC_KEY = Buffer.alloc(32, 0x01)
const NET_KEY = Buffer.alloc(32, 0x02)
const sources = () => ({
  now: NOW,
  randomBytes: fakeRandom(Buffer.from([0xa1, 0xb2]), HMAC_KEY, Buffer.from([0xc3, 0xd4]), NET_KEY),
})

const BLOCK = [
  '# AuditLog: llaveros de DESARROLLO generados por `pnpm audit:keys:init` el 2026-11-22.',
  '# No copiarlos a otros entornos ni subirlos a Git. Producción rechaza los ids dev-.',
  `AUDIT_HMAC_KEYS=dev-20261122-a1b2:${HMAC_KEY.toString('base64')}`,
  'AUDIT_HMAC_ACTIVE_KEY_ID=dev-20261122-a1b2',
  `AUDIT_NETWORK_KEYS=dev-20261122-c3d4:${NET_KEY.toString('base64')}`,
  'AUDIT_NETWORK_ACTIVE_KEY_ID=dev-20261122-c3d4',
].join('\n')

const COMPLETE = `${BLOCK}\n`

/** Lo que dotenv leería de un .env sin comillas: NOMBRE=valor por línea. */
function envOf(content: string): Record<string, string> {
  return Object.fromEntries(
    content
      .split('\n')
      .filter(line => /^[A-Z_]+=/.test(line))
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
}

function messagesOf(plan: KeysInitPlan) {
  return [...plan.errors, ...plan.warnings, ...plan.added.map(a => a.activeKeyId)].join('\n')
}

test('archivo vacío: genera los dos llaveros con el bloque esperado', () => {
  const plan = planKeysInit('', sources())
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.content, COMPLETE)
  assert.deepEqual(
    plan.added.map(a => [a.keyring, a.variables, a.activeKeyId]),
    [
      ['hmac', ['AUDIT_HMAC_KEYS', 'AUDIT_HMAC_ACTIVE_KEY_ID'], 'dev-20261122-a1b2'],
      ['network', ['AUDIT_NETWORK_KEYS', 'AUDIT_NETWORK_ACTIVE_KEY_ID'], 'dev-20261122-c3d4'],
    ]
  )
})

test('lo generado pasa la validación de desarrollo y producción lo rechaza', () => {
  const env = envOf(planKeysInit('', sources()).content!)
  assert.ok(parseAuditKeys(env, { production: false }).ok)
  const production = parseAuditKeys(env, { production: true })
  assert.equal(production.ok, false)
  for (const id of [env.AUDIT_HMAC_ACTIVE_KEY_ID!, env.AUDIT_NETWORK_ACTIVE_KEY_ID!])
    assert.match(id, AUDIT_KEY_ID_PATTERN)
})

test('agrega al final sin cambiar lo que ya había, aunque falte el salto final', () => {
  const existing = 'PAYLOAD_SECRET=abc\n# comentario\nRBAC_SOURCE=db'
  const plan = planKeysInit(existing, sources())
  assert.equal(plan.content, `${existing}\n\n${BLOCK}\n`)
  const withNewline = planKeysInit(`${existing}\n`, sources())
  assert.equal(withNewline.content, `${existing}\n\n${BLOCK}\n`)
})

test('si los dos llaveros ya existen no escribe nada', () => {
  const plan = planKeysInit(COMPLETE, sources())
  assert.equal(plan.content, null)
  assert.deepEqual(plan.kept, ['hmac', 'network'])
  assert.deepEqual(plan.errors, [])
})

test('si falta un solo llavero, agrega solo ese', () => {
  const onlyHmac = BLOCK.split('\n')
    .filter(line => !line.startsWith('AUDIT_NETWORK'))
    .join('\n')
  const plan = planKeysInit(`${onlyHmac}\n`, {
    now: NOW,
    randomBytes: fakeRandom(Buffer.from([0xc3, 0xd4]), NET_KEY),
  })
  assert.deepEqual(plan.kept, ['hmac'])
  assert.deepEqual(
    plan.added.map(a => a.keyring),
    ['network']
  )
  assert.ok(plan.content!.startsWith(`${onlyHmac}\n`))
  assert.ok(!plan.content!.slice(onlyHmac.length).includes('AUDIT_HMAC_KEYS='))
})

test('un par a medias es un error y no escribe nada', () => {
  const plan = planKeysInit('AUDIT_HMAC_KEYS=dev-x:abc\n', sources())
  assert.equal(plan.content, null)
  assert.equal(plan.errors.length, 1)
  assert.match(plan.errors[0]!, /Está AUDIT_HMAC_KEYS pero falta AUDIT_HMAC_ACTIVE_KEY_ID/)
})

test('una variable definida dos veces es un error con las líneas', () => {
  const plan = planKeysInit(`${COMPLETE}AUDIT_NETWORK_KEYS=otra\n`, sources())
  assert.equal(plan.content, null)
  assert.deepEqual(plan.errors, [
    'AUDIT_NETWORK_KEYS está definida 2 veces (líneas 5, 7): dejá una sola.',
  ])
})

test('una variable vacía es un error: no se completa sola', () => {
  for (const empty of ['', '""', "''", '   ']) {
    const content = COMPLETE.replace(
      /^AUDIT_HMAC_ACTIVE_KEY_ID=.*$/m,
      `AUDIT_HMAC_ACTIVE_KEY_ID=${empty}`
    )
    const plan = planKeysInit(content, sources())
    assert.equal(plan.content, null, JSON.stringify(empty))
    assert.match(plan.errors.join('\n'), /AUDIT_HMAC_ACTIVE_KEY_ID está vacía \(línea 4\)/)
  }
})

test('un comentario no cuenta como variable; export sí', () => {
  const commented = COMPLETE.split('\n').map(line =>
    line.startsWith('AUDIT_') ? `# ${line}` : line
  )
  assert.equal(planKeysInit(commented.join('\n'), sources()).added.length, 2)
  const exported = COMPLETE.replace(/^AUDIT_/gm, 'export AUDIT_')
  assert.equal(planKeysInit(exported, sources()).content, null)
})

test('avisa de la variable obsoleta sin mostrar su valor ni tocarla', () => {
  const existing = 'AUDIT_LOG_ENCRYPTION_KEY=valor-viejo-secreto\n'
  const plan = planKeysInit(existing, sources())
  assert.equal(plan.warnings.length, 1)
  assert.match(plan.warnings[0]!, /AUDIT_LOG_ENCRYPTION_KEY es obsoleta/)
  assert.ok(!plan.warnings[0]!.includes('valor-viejo-secreto'))
  assert.ok(plan.content!.startsWith(existing))
})

test('ningún mensaje incluye una clave', () => {
  const plans = [
    planKeysInit('', sources()),
    planKeysInit(COMPLETE, sources()),
    planKeysInit(`${COMPLETE}AUDIT_HMAC_KEYS=x\n`, sources()),
  ]
  for (const plan of plans)
    for (const key of [HMAC_KEY, NET_KEY]) {
      assert.ok(!messagesOf(plan).includes(key.toString('base64')))
      assert.ok(!messagesOf(plan).includes(key.toString('hex')))
    }
})
