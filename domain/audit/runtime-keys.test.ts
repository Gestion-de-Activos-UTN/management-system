import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIT_KEY_BYTES } from './config'
import type { DatabaseAdapterObj } from 'payload'
import {
  AuditKeysConfigError,
  auditKeysRequiredAtInit,
  getAuditKeys,
  loadAuditKeys,
  resetAuditKeysCache,
  withAuditKeysCheck,
} from './runtime-keys'

// Claves de prueba fijas (no secretas), como en config.test.ts.
const key = (byte: number) => Buffer.alloc(AUDIT_KEY_BYTES, byte).toString('base64')
const H1 = key(0x11)
const N1 = key(0x33)

const VALID = {
  AUDIT_HMAC_KEYS: `dev-20261123-a1b2:${H1}`,
  AUDIT_HMAC_ACTIVE_KEY_ID: 'dev-20261123-a1b2',
  AUDIT_NETWORK_KEYS: `dev-20261123-e5f6:${N1}`,
  AUDIT_NETWORK_ACTIVE_KEY_ID: 'dev-20261123-e5f6',
}
// NEXT_PHASE también se guarda y se restaura: lo usa la excepción del build.
const NAMES = [...Object.keys(VALID), 'NEXT_PHASE'] as Array<keyof typeof VALID | 'NEXT_PHASE'>
const SECRETS = [H1, N1, 'dev-20261123-a1b2', 'dev-20261123-e5f6']

function messageFor(env: Record<string, string | undefined>): string {
  try {
    loadAuditKeys(env)
  } catch (error) {
    assert.ok(error instanceof AuditKeysConfigError, `se esperaba AuditKeysConfigError: ${error}`)
    for (const secret of SECRETS)
      assert.ok(!error.message.includes(secret), 'el mensaje muestra un valor')
    return error.message
  }
  assert.fail('se esperaba que la configuración fuera rechazada')
}

/** Corre `fn` con las variables AUDIT_* (y NEXT_PHASE) dadas en process.env y las restaura después. */
function withProcessEnv(values: Partial<Record<(typeof NAMES)[number], string>>, fn: () => void) {
  const saved = Object.fromEntries(NAMES.map(name => [name, process.env[name]]))
  try {
    for (const name of NAMES) {
      if (values[name] === undefined) delete process.env[name]
      else process.env[name] = values[name]
    }
    resetAuditKeysCache()
    fn()
  } finally {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    resetAuditKeysCache()
  }
}

test('acepta llaveros válidos fuera de producción', () => {
  const keys = loadAuditKeys({ ...VALID, NODE_ENV: 'development' })
  assert.equal(keys.hmac.activeKeyId, 'dev-20261123-a1b2')
  assert.equal(keys.network.activeKeyId, 'dev-20261123-e5f6')
})

test('sin claves en desarrollo: nombra las variables y el comando, sin valores', () => {
  const message = messageFor({ NODE_ENV: 'development' })
  for (const name of Object.keys(VALID)) assert.ok(message.includes(name), `no nombra ${name}`)
  assert.match(message, /pnpm audit:keys:init/)
  assert.match(message, /docker compose up -d/)
  assert.doesNotMatch(message, /NODE_ENV=test/)
})

test('sin claves con NODE_ENV=test: explica que .env.local no se lee', () => {
  const message = messageFor({ NODE_ENV: 'test' })
  assert.match(message, /NODE_ENV=test no se lee \.env\.local/)
  assert.match(message, /pnpm audit:keys:init/)
})

test('una clave mal formada no sugiere audit:keys:init (no la arreglaría)', () => {
  const message = messageFor({
    ...VALID,
    AUDIT_HMAC_KEYS: 'dev-20261123-a1b2:corta',
    NODE_ENV: 'development',
  })
  assert.match(message, /AUDIT_HMAC_KEYS/)
  assert.doesNotMatch(message, /audit:keys:init/)
})

test('en producción rechaza las claves dev- y no sugiere el comando de desarrollo', () => {
  const message = messageFor({ ...VALID, NODE_ENV: 'production' })
  assert.match(message, /gestor de secretos/)
  assert.doesNotMatch(message, /audit:keys:init/)
})

test('getAuditKeys lee process.env, guarda el resultado bueno y no guarda los errores', () => {
  withProcessEnv({}, () => {
    assert.throws(() => getAuditKeys(), AuditKeysConfigError)
    // El error no quedó guardado: al aparecer las claves, la siguiente llamada las toma.
    Object.assign(process.env, VALID)
    const first = getAuditKeys()
    assert.equal(first.hmac.activeKeyId, 'dev-20261123-a1b2')
    // El resultado bueno sí: cambiar el entorno después no cambia los llaveros del proceso.
    delete process.env.AUDIT_HMAC_KEYS
    assert.equal(getAuditKeys(), first)
  })
})

/** Adaptador falso: anota si Payload llegó a crearlo (lo que en el real abre el pool). */
function fakeAdapter() {
  const calls: unknown[] = []
  const adapter = {
    name: 'postgres',
    defaultIDType: 'text',
    init: (args: unknown) => {
      calls.push(args)
      return { created: true }
    },
  } as unknown as DatabaseAdapterObj
  return { adapter, calls }
}

test('withAuditKeysCheck: sin claves lanza antes de crear el adaptador', () => {
  withProcessEnv({}, () => {
    const { adapter, calls } = fakeAdapter()
    const checked = withAuditKeysCheck(adapter)
    assert.throws(() => checked.init({ payload: {} } as never), AuditKeysConfigError)
    assert.equal(calls.length, 0, 'no tiene que crear el adaptador (ni abrir conexiones)')
  })
})

test('withAuditKeysCheck: con claves crea el adaptador y conserva el resto de los campos', () => {
  withProcessEnv(VALID, () => {
    const { adapter, calls } = fakeAdapter()
    const checked = withAuditKeysCheck(adapter)
    assert.equal(checked.name, 'postgres')
    assert.equal(checked.defaultIDType, 'text')
    const args = { payload: {} } as never
    assert.deepEqual(checked.init(args), { created: true })
    assert.deepEqual(calls, [args])
  })
})

test('durante next build no se piden claves al iniciar Payload', () => {
  assert.equal(auditKeysRequiredAtInit({ NEXT_PHASE: 'phase-production-build' }), false)
  assert.equal(auditKeysRequiredAtInit({ NEXT_PHASE: 'phase-development-server' }), true)
  assert.equal(auditKeysRequiredAtInit({}), true)
  withProcessEnv({ NEXT_PHASE: 'phase-production-build' }, () => {
    const { adapter, calls } = fakeAdapter()
    assert.doesNotThrow(() => withAuditKeysCheck(adapter).init({ payload: {} } as never))
    assert.equal(calls.length, 1)
  })
})
