import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Arranque real de Payload (payload.config.ts) en un proceso aparte, sin claves del AuditLog
// (pedido de Tani, 23/11): tiene que fallar en pocos segundos, con el mensaje, sin abrir ninguna
// conexión a la base y sin colgarse. DATABASE_URL apunta a un servidor TCP falso que cuenta las
// conexiones: no hace falta Postgres. El control con claves comprueba que ese mismo arranque sí
// intenta conectarse, así el "0 conexiones" del primer caso no es casualidad.
//
// El hijo atrapa el error y NO llama a process.exit: si quedara un pool abierto, el proceso no
// terminaría solo (lo que pasaba validando en onInit, que corre después de conectar).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BOOT = `(async () => {
  const { getPayload } = await import('payload')
  const { default: config } = await import('./payload.config.ts')
  await getPayload({ config })
  console.log('payload iniciado')
})().catch(error => {
  console.error(error?.message ?? String(error))
  process.exitCode = 1
})`

/** Tiempo máximo para que el arranque sin claves termine solo (carga de la config incluida). */
const FAIL_FAST_MS = 30_000
const KEY_VARIABLES = [
  'AUDIT_HMAC_KEYS',
  'AUDIT_HMAC_ACTIVE_KEY_ID',
  'AUDIT_NETWORK_KEYS',
  'AUDIT_NETWORK_ACTIVE_KEY_ID',
]

async function fakeDatabase() {
  const sockets = new Set<Socket>()
  let connections = 0
  let onConnection = () => {}
  const server = createServer(socket => {
    connections += 1
    sockets.add(socket)
    socket.on('error', () => {})
    onConnection()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `postgresql://nadie:nada@127.0.0.1:${port}/ninguna`,
    connections: () => connections,
    firstConnection: () => new Promise<void>(resolve => (onConnection = resolve)),
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

function boot(env: Record<string, string>) {
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env }
  // El hijo no es un proceso de node:test ni un build de Next.
  for (const name of ['NODE_TEST_CONTEXT', 'NEXT_PHASE']) delete childEnv[name]
  for (const name of KEY_VARIABLES) if (!(name in env)) delete childEnv[name]
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', BOOT], {
    cwd: ROOT,
    env: { ...childEnv, NODE_ENV: 'test', PAYLOAD_DISABLE_JOBS: '1' },
  })
  let output = ''
  child.stdout.on('data', chunk => (output += chunk))
  child.stderr.on('data', chunk => (output += chunk))
  const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)))
  return { child, exited, output: () => output }
}

test('sin claves, Payload no inicia: falla rápido, con el mensaje, sin conectar a la base', async () => {
  const db = await fakeDatabase()
  try {
    const started = Date.now()
    const run = boot({ DATABASE_URL: db.url, PAYLOAD_SECRET: 'solo-para-este-test' })
    const timer = setTimeout(() => run.child.kill('SIGKILL'), FAIL_FAST_MS)
    const code = await run.exited
    clearTimeout(timer)
    const elapsed = Date.now() - started

    assert.ok(
      elapsed < FAIL_FAST_MS,
      `no terminó solo en ${FAIL_FAST_MS} ms (¿quedó un pool abierto?)`
    )
    assert.equal(code, 1, run.output())
    assert.match(run.output(), /AuditLog: las claves no están configuradas o son inválidas\./)
    assert.match(run.output(), /AUDIT_HMAC_KEYS: falta la variable\./)
    assert.doesNotMatch(run.output(), /payload iniciado/)
    assert.equal(db.connections(), 0, 'no tiene que abrir ninguna conexión a la base')
  } finally {
    await db.close()
  }
})

test('control: con claves, el mismo arranque sí intenta conectar a la base', async () => {
  const db = await fakeDatabase()
  // Claves descartables, solo para este proceso hijo; nunca se imprimen.
  const id = `test-${randomBytes(4).toString('hex')}`
  const run = boot({
    DATABASE_URL: db.url,
    PAYLOAD_SECRET: 'solo-para-este-test',
    AUDIT_HMAC_KEYS: `${id}-h:${randomBytes(32).toString('base64')}`,
    AUDIT_HMAC_ACTIVE_KEY_ID: `${id}-h`,
    AUDIT_NETWORK_KEYS: `${id}-n:${randomBytes(32).toString('base64')}`,
    AUDIT_NETWORK_ACTIVE_KEY_ID: `${id}-n`,
  })
  let timer: NodeJS.Timeout | undefined
  try {
    const connected = await Promise.race([
      db.firstConnection().then(() => true),
      run.exited.then(() => false),
      new Promise<boolean>(resolve => (timer = setTimeout(() => resolve(false), FAIL_FAST_MS))),
    ])
    assert.ok(connected, `no intentó conectar a la base:\n${run.output()}`)
    assert.doesNotMatch(run.output(), /AuditLog: las claves/)
  } finally {
    // Sin esto, el temporizador mantiene vivo el archivo de tests hasta que vence.
    clearTimeout(timer)
    run.child.kill('SIGKILL')
    await run.exited
    await db.close()
  }
})
