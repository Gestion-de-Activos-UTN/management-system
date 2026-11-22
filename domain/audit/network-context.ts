import { isIPv4, isIPv6 } from 'node:net'
import { z } from 'zod'

// Contexto de red de una solicitud, en claro: lo que se cifra en AuditNetworkContexts y lo que
// firma network_digest (documentation/planes/audit-log/02-modelo-y-captura.md §6 y 03 §3).
// Solo el esquema y la forma canónica de una IP; requestNetwork (leer la IP de la solicitud
// según el proxy confiable) se implementa en F1b.
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
