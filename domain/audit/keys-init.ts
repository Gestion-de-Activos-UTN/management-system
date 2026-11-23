import { AUDIT_DEV_KEY_PREFIX, AUDIT_KEY_BYTES, AUDIT_KEY_VARIABLES } from './config'

// Lógica de `pnpm audit:keys:init` (scripts/audit-keys-init.ts), sin tocar el disco: recibe
// el contenido actual de .env.local y devuelve qué agregar. Decisión G3 (PLAN-AUDITLOG):
// genera llaveros de desarrollo solo si faltan, nunca pisa ni borra nada y nunca imprime
// claves. Los mensajes nombran variables e ids (no son secretos), nunca valores de claves.
// Ninguna tarea genera claves de producción (03-seguridad-y-claves.md §6): ids siempre dev-.

export const OBSOLETE_AUDIT_VARIABLE = 'AUDIT_LOG_ENCRYPTION_KEY'

type Keyring = keyof typeof AUDIT_KEY_VARIABLES

export interface KeysInitSources {
  /** CSPRNG: crypto.randomBytes en el script; fijo en los tests. */
  randomBytes: (size: number) => Buffer
  now: Date
}

export interface KeysInitPlan {
  /** Contenido nuevo del archivo, o null si no hay que escribir nada. */
  content: string | null
  added: Array<{ keyring: Keyring; variables: [string, string]; activeKeyId: string }>
  /** Llaveros que ya estaban completos (las dos variables, con valor). */
  kept: Keyring[]
  warnings: string[]
  /** Si hay errores, no se escribe nada. */
  errors: string[]
}

interface Assignment {
  line: number
  empty: boolean
}

/** Asignaciones `NOMBRE=valor` (o `export NOMBRE=valor`) por variable; ignora comentarios. */
function assignments(content: string): Map<string, Assignment[]> {
  const found = new Map<string, Assignment[]>()
  content.split(/\r?\n/).forEach((text, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(text)
    if (!match) return
    const [, name, rawValue] = match as unknown as [string, string, string]
    const value = rawValue.trim()
    const empty = value === '' || value === '""' || value === "''"
    found.set(name, [...(found.get(name) ?? []), { line: index + 1, empty }])
  })
  return found
}

export function planKeysInit(content: string, sources: KeysInitSources): KeysInitPlan {
  const found = assignments(content)
  const plan: KeysInitPlan = { content: null, added: [], kept: [], warnings: [], errors: [] }

  if (found.has(OBSOLETE_AUDIT_VARIABLE))
    plan.warnings.push(
      `${OBSOLETE_AUDIT_VARIABLE} es obsoleta y ya no se usa (la reemplazan los llaveros AUDIT_HMAC_* y AUDIT_NETWORK_*). Borrala a mano de .env.local; este comando no la toca.`
    )

  const missing: Keyring[] = []
  for (const keyring of Object.keys(AUDIT_KEY_VARIABLES) as Keyring[]) {
    const { keys, activeKeyId } = AUDIT_KEY_VARIABLES[keyring]
    const pair = [keys, activeKeyId].map(name => ({ name, entries: found.get(name) ?? [] }))
    for (const { name, entries } of pair) {
      if (entries.length > 1)
        plan.errors.push(
          `${name} está definida ${entries.length} veces (líneas ${entries.map(e => e.line).join(', ')}): dejá una sola.`
        )
      else if (entries[0]?.empty)
        plan.errors.push(
          `${name} está vacía (línea ${entries[0].line}): completala o borrala para que este comando la genere.`
        )
    }
    const present = pair.filter(({ entries }) => entries.length > 0).map(({ name }) => name)
    if (present.length === 2) plan.kept.push(keyring)
    else if (present.length === 1)
      plan.errors.push(
        `Está ${present[0]} pero falta ${pair.find(({ name }) => name !== present[0])!.name}: completá el par a mano o borrá la que está para que este comando genere las dos.`
      )
    else missing.push(keyring)
  }

  if (plan.errors.length > 0 || missing.length === 0) return plan

  const date = sources.now.toISOString().slice(0, 10)
  const lines = [
    '',
    `# AuditLog: llaveros de DESARROLLO generados por \`pnpm audit:keys:init\` el ${date}.`,
    '# No copiarlos a otros entornos ni subirlos a Git. Producción rechaza los ids dev-.',
  ]
  for (const keyring of missing) {
    const { keys, activeKeyId } = AUDIT_KEY_VARIABLES[keyring]
    const id = `${AUDIT_DEV_KEY_PREFIX}${date.replaceAll('-', '')}-${sources.randomBytes(2).toString('hex')}`
    const key = sources.randomBytes(AUDIT_KEY_BYTES).toString('base64')
    lines.push(`${keys}=${id}:${key}`, `${activeKeyId}=${id}`)
    plan.added.push({ keyring, variables: [keys, activeKeyId], activeKeyId: id })
  }

  // Archivo nuevo: sin la línea en blanco que separa el bloque de lo que ya había.
  if (content === '') lines.shift()
  const base = content === '' || content.endsWith('\n') ? content : `${content}\n`
  plan.content = `${base}${lines.join('\n')}\n`
  return plan
}
