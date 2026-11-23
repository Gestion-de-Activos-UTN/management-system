import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import type { DatabaseAdapterObj } from 'payload'
import { formatAuditKeyErrors, parseAuditKeys, type AuditKeyError, type AuditKeys } from './config'

// Llaveros del AuditLog de este proceso (documentation/planes/audit-log/03-seguridad-y-claves.md
// §5: verificar presencia, longitud, ids y versión activa antes de aceptar escrituras auditables).
// Lee process.env, valida con config.ts y guarda el resultado bueno. Los errores no se guardan:
// cada llamada vuelve a validar, así un proceso al que le falta una clave nunca escribe.
//
// Las claves llegan siempre por el entorno. Next carga .env.local solo en `next dev`/`next build`;
// con NODE_ENV=test no lo lee (@next/env), y los seeds y tests no cargan ningún .env: en Docker
// llegan por el env_file del compose y en CI por el workflow (PLAN-AUDITLOG, F1b, riesgo 3).
//
// Dos puntos de control (Tani, 23/11):
// 1. Al iniciar Payload, antes de abrir el pool (withAuditKeysCheck, en payload.config.ts). No en
//    onInit: Payload conecta a Postgres antes de onInit, y un init que falla después de conectar
//    deja el pool abierto (el proceso no termina y, en dev, cada pedido abre otro). Así también
//    validan los seeds, que inician Payload con disableOnInit.
// 2. En el cierre transaccional, antes de escribir (F1b, paso 4b): segunda línea de defensa.
// `next build` no inicializa Payload (comprobado el 23/11); igual, en NEXT_PHASE=phase-production-
// build no se piden claves: tienen que existir solo en el contenedor que corre, nunca en el build,
// para que no queden en la imagen.

type Env = Readonly<Record<string, string | undefined>>

export class AuditKeysConfigError extends Error {
  constructor(
    readonly errors: readonly AuditKeyError[],
    env: Env
  ) {
    super(auditKeysConfigMessage(errors, env))
    this.name = 'AuditKeysConfigError'
  }
}

let cached: AuditKeys | undefined

/** Llaveros del proceso; lanza AuditKeysConfigError si faltan o son inválidos. */
export function getAuditKeys(): AuditKeys {
  cached ??= loadAuditKeys(process.env)
  return cached
}

/** Valida el entorno dado, sin caché. La usa getAuditKeys y los tests. */
export function loadAuditKeys(env: Env): AuditKeys {
  const result = parseAuditKeys(env, { production: env.NODE_ENV === 'production' })
  if (!result.ok) throw new AuditKeysConfigError(result.errors, env)
  return result.keys
}

/** Durante `next build` no se validan claves al iniciar Payload (el build no debe tenerlas). */
export function auditKeysRequiredAtInit(env: Env): boolean {
  return env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD
}

/**
 * Envuelve el adaptador de base para validar los llaveros antes de crearlo: Payload llama a este
 * `init` antes de `db.init()` y de `db.connect()`, así que sin claves no se abre ninguna conexión.
 */
export function withAuditKeysCheck(adapter: DatabaseAdapterObj): DatabaseAdapterObj {
  return {
    ...adapter,
    init: args => {
      if (auditKeysRequiredAtInit(process.env)) getAuditKeys()
      return adapter.init(args)
    },
  }
}

/** Solo para tests: olvida los llaveros guardados. */
export function resetAuditKeysCache() {
  cached = undefined
}

/** Mensaje de arranque: qué variable falla y qué hacer, nunca un valor. */
export function auditKeysConfigMessage(errors: readonly AuditKeyError[], env: Env): string {
  const lines = [
    'AuditLog: las claves no están configuradas o son inválidas.',
    formatAuditKeyErrors(errors),
  ]
  if (env.NODE_ENV === 'production') {
    lines.push('En producción las provee el gestor de secretos del despliegue (nunca ids dev-).')
  } else {
    if (errors.some(error => error.code === 'missing'))
      lines.push(
        'En desarrollo: correr `pnpm audit:keys:init` (las agrega a .env.local) y recrear el contenedor con `docker compose up -d`.'
      )
    if (env.NODE_ENV === 'test')
      lines.push(
        'Con NODE_ENV=test no se lee .env.local: las variables AUDIT_* tienen que llegar por el entorno (en Docker, por el env_file; en el host, ver COMMANDS.md).'
      )
  }
  return lines.join('\n')
}
