import { isIPv4, isIPv6 } from 'node:net'
import { z } from 'zod'

// Contexto de red de una solicitud, en claro: lo que se cifra en AuditNetworkContexts y lo que
// firma network_digest (documentation/planes/audit-log/02-modelo-y-captura.md §6 y 03 §3): el
// esquema, la forma canónica de una IP y requestNetwork, que lee la IP de la solicitud según el
// proxy confiable. Sin "cliente declarado" (user agent): fuera del contexto v1 (Tani, 23/11).
//
// La IP se guarda en forma canónica para que la misma dirección dé siempre el mismo digest:
// IPv4 en decimal sin ceros a la izquierda; IPv6 comprimida en minúsculas (RFC 5952, como la
// serializa URL); una IPv4 mapeada en IPv6 (::ffff:a.b.c.d) pasa a IPv4. Sin puertos ni zonas.

export const NETWORK_SOURCES = ['trusted_proxy', 'direct', 'unknown', 'none'] as const

/** Fuentes que traen una IP; `unknown` (sin proxy configurado) y `none` (job) no la traen. */
const SOURCES_WITH_IP = new Set<string>(['trusted_proxy', 'direct'])

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const MAPPED_IPV4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface CanonicalIp {
  ip: string
  family: 'ipv4' | 'ipv6'
}

/** Forma canónica de una IP literal, o null si no es una IP admitida (puerto, zona, texto). */
export function canonicalIp(raw: string): CanonicalIp | null {
  if (raw.length > 64) return null
  if (IPV4.test(raw) && isIPv4(raw)) return { ip: raw, family: 'ipv4' }
  if (!isIPv6(raw) || raw.includes('%')) return null

  let host: string
  try {
    host = new URL(`http://[${raw}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const mapped = MAPPED_IPV4.exec(host)
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16)
    const low = Number.parseInt(mapped[2]!, 16)
    return { ip: `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, family: 'ipv4' }
  }
  return { ip: host, family: 'ipv6' }
}

const isInstant = (value: string) =>
  INSTANT.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value

export const NetworkContextV1Schema = z
  .strictObject({
    source: z.enum(NETWORK_SOURCES),
    ip: z.string().nullable(),
    family: z.enum(['ipv4', 'ipv6']).nullable(),
    captured_at: z.string().refine(isInstant, 'Fecha ISO en UTC con milisegundos (y que exista).'),
  })
  .superRefine((context, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (!SOURCES_WITH_IP.has(context.source)) {
      if (context.ip !== null) issue('ip', 'Esta fuente no trae IP: debe ser null.')
      if (context.family !== null) issue('family', 'Esta fuente no trae IP: debe ser null.')
      return
    }
    if (context.ip === null) return issue('ip', 'Falta la IP de esta fuente.')
    const canonical = canonicalIp(context.ip)
    if (!canonical || canonical.ip !== context.ip) return issue('ip', 'IP inválida o no canónica.')
    if (canonical.family !== context.family) issue('family', 'No corresponde a la IP.')
  })

export type NetworkContextV1 = z.infer<typeof NetworkContextV1Schema>

export class AuditNetworkContextError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Contexto de red inválido:\n${issues.map(issue => `- ${issue}`).join('\n')}`)
    this.name = 'AuditNetworkContextError'
  }
}

/** Valida el contexto. Los mensajes nombran el campo, nunca la IP ni otro valor. */
export function parseNetworkContext(value: unknown): NetworkContextV1 {
  const result = NetworkContextV1Schema.safeParse(value)
  if (result.success) return result.data
  throw new AuditNetworkContextError(
    result.error.issues.map(issue => {
      const field = issue.path.join('.') || '(contexto)'
      if (issue.code === 'custom') return `${field}: ${issue.message}`
      if (issue.code === 'unrecognized_keys')
        return `${field}: ${issue.keys.length} campo(s) que no son del contexto v1.`
      return `${field}: valor inválido.`
    })
  )
}

// --- IP de la solicitud (02 §6) ---------------------------------------------------------------
//
// AUDIT_TRUSTED_PROXY_HOPS = cantidad de proxies confiables delante de la app (0 a 5; sin la
// variable, 0). Contrato de despliegue: cada proxy confiable agrega a X-Forwarded-For la dirección
// que vio (o el único proxy la sobrescribe), y el puerto de la app no se alcanza sin pasar por
// ellos. Así la IP del cliente es la entrada N contando desde la derecha: lo que haya más a la
// izquierda lo pudo escribir el cliente y se ignora. Nunca la primera entrada.
// - 0 (hoy: el compose no tiene proxy) → fuente `unknown`, aunque venga la cabecera: sin proxy,
//   cualquiera la puede falsificar.
// - Cabecera ausente, más corta que N, demasiado larga, o entrada que no es una IP literal admitida
//   (con puerto, zona, nombre, vacía) → `unknown`. No se adivina ni se toma otra entrada.
// - `direct` (dirección del socket) queda reservada: Next/Payload no la exponen a los endpoints.
// Nunca se guarda la cabecera cruda ni otra cabecera; solo la IP canónica, su familia y la hora.

export const AUDIT_TRUSTED_PROXY_HOPS_VARIABLE = 'AUDIT_TRUSTED_PROXY_HOPS'
export const AUDIT_MAX_TRUSTED_PROXY_HOPS = 5
/** Cabeceras más largas no se interpretan (fuente `unknown`). */
const MAX_FORWARDED_FOR_LENGTH = 4096
const HOPS = /^[0-9]$/

type Env = Readonly<Record<string, string | undefined>>

export class AuditNetworkConfigError extends Error {
  constructor(message: string) {
    super(`AuditLog: ${message}`)
    this.name = 'AuditNetworkConfigError'
  }
}

/** Proxies confiables configurados. Lanza si el valor no es un entero de 0 a 5 (sin mostrarlo). */
export function trustedProxyHops(env: Env): number {
  const raw = env[AUDIT_TRUSTED_PROXY_HOPS_VARIABLE]
  if (raw === undefined) return 0
  if (!HOPS.test(raw) || Number(raw) > AUDIT_MAX_TRUSTED_PROXY_HOPS)
    throw new AuditNetworkConfigError(
      `${AUDIT_TRUSTED_PROXY_HOPS_VARIABLE} tiene que ser un entero de 0 a ${AUDIT_MAX_TRUSTED_PROXY_HOPS} (cantidad de proxies confiables delante de la app).`
    )
  return Number(raw)
}

/** Contexto de red de una solicitud (para addAuditEvent). Ver las reglas arriba. */
export function requestNetwork(
  req: { headers: Headers },
  options: { env?: Env; now?: Date } = {}
): NetworkContextV1 {
  const hops = trustedProxyHops(options.env ?? process.env)
  const captured_at = (options.now ?? new Date()).toISOString()
  const unknown: NetworkContextV1 = { source: 'unknown', ip: null, family: null, captured_at }
  if (hops === 0) return unknown

  const header = req.headers.get('x-forwarded-for')
  if (!header || header.length > MAX_FORWARDED_FOR_LENGTH) return unknown
  const entries = header.split(',').map(entry => entry.trim())
  if (entries.length < hops) return unknown
  const client = canonicalIp(entries[entries.length - hops]!)
  if (!client) return unknown
  return parseNetworkContext({ source: 'trusted_proxy', ...client, captured_at })
}
