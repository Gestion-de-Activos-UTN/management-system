import { randomBytes } from 'node:crypto'
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planKeysInit } from '../domain/audit/keys-init'

// Genera los llaveros de DESARROLLO del AuditLog en management-system/.env.local, solo si
// faltan (decisión G3, PLAN-AUDITLOG; documentation/planes/audit-log/03-seguridad-y-claves.md §5):
// - nunca pisa ni borra variables existentes, y nunca imprime claves (solo nombres e ids);
// - deja el archivo con permisos 600 (solo el dueño lee y escribe);
// - escribe en un temporal 600 del mismo directorio y lo renombra: un corte a mitad de camino
//   no deja el archivo a medias;
// - se niega con NODE_ENV=production y con un symlink.
//
//   pnpm audit:keys:init                     # management-system/.env.local
//   pnpm audit:keys:init --file <ruta>       # otro archivo (por ejemplo, para probarlo)

const PRIVATE = 0o600

function fail(message: string): never {
  console.error(`audit:keys:init: ${message}`)
  process.exit(1)
}

function targetPath(args: string[]): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  if (args.length === 0) return path.join(root, '.env.local')
  const [flag, value, ...rest] = args
  if (flag === '--file' && value && rest.length === 0) return path.resolve(value)
  if (flag?.startsWith('--file=') && value === undefined) return path.resolve(flag.slice(7))
  return fail('uso: pnpm audit:keys:init [--file <ruta>]')
}

/** Contenido actual, o '' si no existe. Rechaza symlinks y lo que no sea un archivo común. */
function readTarget(file: string): { content: string; exists: boolean } {
  let stat
  try {
    stat = lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', exists: false }
    throw error
  }
  if (stat.isSymbolicLink()) fail(`${file} es un symlink: no lo sigo. Usá la ruta real.`)
  if (!stat.isFile()) fail(`${file} no es un archivo común.`)
  return { content: readFileSync(file, 'utf8'), exists: true }
}

/** Escribe en un temporal 600 del mismo directorio y lo renombra sobre el destino. */
function writePrivate(file: string, content: string) {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${randomBytes(6).toString('hex')}`
  )
  const fd = openSync(temp, 'wx', PRIVATE)
  try {
    fchmodSync(fd, PRIVATE)
    writeSync(fd, content)
    fsyncSync(fd)
  } catch (error) {
    closeSync(fd)
    rmSync(temp, { force: true })
    throw error
  }
  closeSync(fd)
  renameSync(temp, file)
}

function modeOf(file: string) {
  return statSync(file).mode & 0o777
}

function main() {
  if (process.env.NODE_ENV === 'production')
    fail(
      'no genera claves de producción (NODE_ENV=production). Las de producción las provee el gestor de secretos del despliegue.'
    )

  const file = targetPath(process.argv.slice(2))
  const { content, exists } = readTarget(file)
  const plan = planKeysInit(content, { randomBytes, now: new Date() })

  for (const warning of plan.warnings) console.warn(`Aviso: ${warning}`)
  if (plan.errors.length > 0) {
    console.error(`No se cambió ${file}:`)
    for (const error of plan.errors) console.error(`- ${error}`)
    process.exit(1)
  }

  for (const keyring of plan.kept)
    console.log(`Sin cambios: el llavero ${keyring} ya existe (no se tocó).`)

  if (plan.content !== null) {
    writePrivate(file, plan.content)
    console.log(exists ? `Actualizado ${file}:` : `Creado ${file}:`)
    for (const { variables, activeKeyId } of plan.added)
      console.log(`- agregadas ${variables.join(' y ')} (clave activa ${activeKeyId})`)
    console.log(
      'Si la app corre en Docker, recreá el contenedor para que tome las variables: docker compose up -d'
    )
  } else if (exists) {
    const mode = modeOf(file)
    if (mode !== PRIVATE) {
      const fd = openSync(file, 'r')
      fchmodSync(fd, PRIVATE)
      closeSync(fd)
      console.log(`Permisos de ${file}: ${mode.toString(8)} → 600.`)
    }
  }
  console.log(`${file}: permisos ${modeOf(file).toString(8)}.`)
}

main()
