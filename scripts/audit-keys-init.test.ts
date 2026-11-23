import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Prueba el script real (scripts/audit-keys-init.ts) como proceso aparte, siempre sobre
// archivos en una carpeta temporal: nunca toca el .env.local del repo.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'audit-keys-init.ts')

function run(file: string, env: Record<string, string | undefined> = {}) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--file', file], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ...env },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'siam-audit-keys-'))
}

const modeOf = (file: string) => statSync(file).mode & 0o777

/** Valores de claves del archivo (lo que no debe aparecer nunca en la salida). */
function keyValues(content: string): string[] {
  return [...content.matchAll(/^AUDIT_(?:HMAC|NETWORK)_KEYS=.*?:(\S+)$/gm)].map(match => match[1]!)
}

test('crea el archivo con permisos 600, sin imprimir claves, y la segunda vez no cambia nada', t => {
  const dir = tempDir()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.env.local')

  const first = run(file)
  assert.equal(first.status, 0, first.output)
  assert.equal(modeOf(file), 0o600)
  const content = readFileSync(file, 'utf8')
  const keys = keyValues(content)
  assert.equal(keys.length, 2)
  for (const key of keys) assert.ok(!first.output.includes(key), 'la salida muestra una clave')
  assert.match(first.output, /Creado .*\.env\.local/)
  assert.match(
    first.output,
    /agregadas AUDIT_HMAC_KEYS y AUDIT_HMAC_ACTIVE_KEY_ID \(clave activa dev-\d{8}-[0-9a-f]{4}\)/
  )

  const second = run(file)
  assert.equal(second.status, 0, second.output)
  assert.equal(readFileSync(file, 'utf8'), content)
  assert.match(second.output, /Sin cambios: el llavero hmac ya existe/)
  for (const key of keys) assert.ok(!second.output.includes(key))
  assert.deepEqual(readdirSync(dir), ['.env.local'], 'quedó un archivo temporal')
})

test('agrega a un archivo existente sin tocar lo anterior y lo deja en 600', t => {
  const dir = tempDir()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.env.local')
  const existing = 'PAYLOAD_SECRET=no-tocar\nAUDIT_LOG_ENCRYPTION_KEY=vieja-secreta\n'
  writeFileSync(file, existing)
  chmodSync(file, 0o644)

  const result = run(file)
  assert.equal(result.status, 0, result.output)
  assert.equal(modeOf(file), 0o600)
  const content = readFileSync(file, 'utf8')
  assert.ok(content.startsWith(existing))
  assert.match(result.output, /AUDIT_LOG_ENCRYPTION_KEY es obsoleta/)
  assert.ok(!result.output.includes('vieja-secreta'))
  assert.ok(!result.output.includes('no-tocar'))
})

test('con los llaveros completos solo corrige los permisos', t => {
  const dir = tempDir()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.env.local')
  assert.equal(run(file).status, 0)
  const content = readFileSync(file, 'utf8')
  chmodSync(file, 0o644)

  const result = run(file)
  assert.equal(result.status, 0, result.output)
  assert.equal(readFileSync(file, 'utf8'), content)
  assert.equal(modeOf(file), 0o600)
  assert.match(result.output, /Permisos de .*: 644 → 600/)
})

test('un par a medias termina con error y no cambia el archivo', t => {
  const dir = tempDir()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.env.local')
  writeFileSync(file, 'AUDIT_NETWORK_ACTIVE_KEY_ID=dev-x\n')
  const result = run(file)
  assert.equal(result.status, 1)
  assert.match(result.output, /falta AUDIT_NETWORK_KEYS/)
  assert.equal(readFileSync(file, 'utf8'), 'AUDIT_NETWORK_ACTIVE_KEY_ID=dev-x\n')
})

test('no sigue symlinks', t => {
  const dir = tempDir()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const real = path.join(dir, 'real.env')
  const link = path.join(dir, '.env.local')
  writeFileSync(real, 'PAYLOAD_SECRET=x\n')
  symlinkSync(real, link)
  const result = run(link)
  assert.equal(result.status, 1)
  assert.match(result.output, /es un symlink/)
  assert.equal(readFileSync(real, 'utf8'), 'PAYLOAD_SECRET=x\n')
})

test('se niega con NODE_ENV=production', t => {
  const dir = tempDir()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.env.local')
  const result = run(file, { NODE_ENV: 'production' })
  assert.equal(result.status, 1)
  assert.match(result.output, /no genera claves de producción/)
  assert.ok(!existsSync(file))
})
