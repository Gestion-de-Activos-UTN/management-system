import config from '../payload.config'
import { formatAuditVerifyReport, verifyAuditChains } from '../domain/audit/verify'
import { initializeSeedPayload } from './seed-payload'

// pnpm audit:verify [--chain <chain_id>]...
// Verificación local de solo lectura de las cadenas del AuditLog (domain/audit/verify.ts). Inicia
// Payload como los seeds (sin jobs ni recuperación) y necesita las claves del AuditLog por el
// entorno, como la app. Sale con 0 si todo verifica, 1 si hay errores o anomalías y 2 si el uso es
// incorrecto. Nunca imprime payloads, IPs ni claves.
// Solo lectura también para el schema: fuera de producción Payload sincroniza el schema al
// conectar (pushDevSchema), y el verificador no debe cambiar la base. Por eso crea el adaptador con
// `push = false`; sus consultas, además, corren en una transacción READ ONLY.

const USAGE = 'uso: pnpm audit:verify [--chain <chain_id>]...'

function parseArgs(args: string[]): string[] | undefined {
  const chains: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg === '--chain' && value && !value.startsWith('--')) {
      chains.push(value)
      index += 1
    } else {
      throw new Error(USAGE)
    }
  }
  return chains.length > 0 ? chains : undefined
}

const write = (text: string) =>
  new Promise<void>(resolve => process.stdout.write(`${text}\n`, () => resolve()))

async function main() {
  let chainIds: string[] | undefined
  try {
    chainIds = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    process.exit(2)
  }
  const resolved = await config
  const payload = await initializeSeedPayload({
    ...resolved,
    db: {
      ...resolved.db,
      init: args => Object.assign(resolved.db.init(args), { push: false }),
    },
  })
  let code = 1
  try {
    const report = await verifyAuditChains(payload, { chainIds })
    await write(formatAuditVerifyReport(report))
    code = report.ok ? 0 : 1
  } finally {
    await payload.destroy()
  }
  process.exit(code)
}

main().catch(error => {
  console.error('audit:verify falló:', error instanceof Error ? error.message : error)
  process.exit(1)
})
