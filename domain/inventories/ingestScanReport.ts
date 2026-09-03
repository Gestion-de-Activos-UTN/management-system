import type { Payload } from 'payload'
import type { Asset } from '../../app/types/payload-types'
import type { AssetPayload } from '../../contracts/asset.schema'
import type { ScanReportPayload } from '../../contracts/scan-report.schema'
import type { AgentAuthResult } from '../../access/middleware/resolveAgentAuth'

export interface IngestResult {
  processedAssetIds: string[]
  rejectedAssets: Array<{ asset_id: string; error: string }>
}

// SOLO lo que doc 05 §5.1 marca "Técnicos obligatorios" para un Asset (agent_id/office_id
// vienen de `auth`, no del payload). `mac`/`vendor`/`hostname` son "Técnicos opcionales" a
// propósito — el scanner (models.py::Asset) los tipa como `str` simple, nunca `Optional`, y
// manda `""` cuando nmap no puede resolverlos (cualquier host fuera del segmento L2 del agente:
// notebooks/celulares por WiFi en otro subnet, sin entrada ARP visible). Exigirlos acá — como
// hacía esta lista hasta ahora — descartaba en silencio exactamente esos hosts, que es el caso
// más común de "activo real pero con dato técnico incompleto" que doc 05 ("Qué no asumir")
// dice explícitamente que hay que tolerar, no rechazar.
const REQUIRED_ASSET_FIELDS: Array<keyof AssetPayload> = ['asset_id', 'ip', 'scan_time']

function findMissingFields(asset: AssetPayload): string[] {
  return REQUIRED_ASSET_FIELDS.filter((field) => !asset[field]) as string[]
}

type ExistingAssetDoc = Asset

// Saneo: el Zod schema es .passthrough() a propósito (permisivo-en-lectura), pero acá se
// extrae EXPLÍCITAMENTE solo el bloque técnico conocido — nada del payload original (con
// eventuales campos extra) llega directo a `payload.create`/`update`.
//
// Política de merge no es uniforme para todo el bloque (dos naturalezas distintas):
// - IDENTIDAD (mac/vendor/hostname/os/gateway_*): requieren privilegios (ARP/raw socket) para
//   resolverse. Un scan degraded (sin sudo/Npcap, ver scan-report.schema.ts) manda "" — eso NO
//   significa "el dato cambió a vacío", significa "este scan no pudo verlo". Not-null-wins: se
//   conserva el último valor conocido si el nuevo viene vacío.
// - DINÁMICO (ip/services): refleja estado real y cambiante del activo (puertos que se
//   abren/cierran, IP que cambia por DHCP) — un TCP-connect sin privilegios igual reporta esto
//   con precisión. Siempre se sobreescribe con lo último, incluso si viene "menos lleno"
//   (ej. servicios vacío = puertos cerrados, dato real, no ausencia de dato).
//   `state_reason`/`host_scripts` son igual de dinámicos (evidencia puntual de ESE scan). `os_candidates`
//   viaja pegado a `os` (misma naturaleza identidad, mismo not-null-wins) — no tiene sentido
//   vaciar candidatos previos solo porque un scan puntual no trajo osmatch.
const OS_ACCURACY_THRESHOLD = 85

// Decisión de negocio de la plataforma, nunca del agente (el scanner solo reporta candidatos
// crudos) — ver management-system/CLAUDE.md y la nota de conversación sobre esta regla.
function resolveOsStatus(osCandidates: AssetPayload['os_candidates']): 'identified' | 'indeterminate' {
  return (osCandidates[0]?.accuracy ?? 0) >= OS_ACCURACY_THRESHOLD ? 'identified' : 'indeterminate'
}

function sanitizeTechnicalBlock(asset: AssetPayload, report: ScanReportPayload, existingDoc?: ExistingAssetDoc) {
  const osCandidates =
    asset.os_candidates.length > 0
      ? asset.os_candidates
      : ((existingDoc?.os_candidates as AssetPayload['os_candidates'] | undefined) ?? [])

  return {
    asset_id: asset.asset_id,
    ip: asset.ip,
    // El scanner manda "" cuando no pudo resolverlos (ver nota arriba) — se normaliza a `null`
    // acá, no en el scanner, para que Assets guarde exactamente lo que su propio contrato
    // documenta (`mac: string | null`, doc 05 §5.1), no un string vacío disfrazado de dato.
    mac: (asset.mac || null) ?? (existingDoc?.mac as string | null | undefined) ?? null,
    vendor: (asset.vendor || null) ?? (existingDoc?.vendor as string | null | undefined) ?? null,
    hostname: (asset.hostname || null) ?? (existingDoc?.hostname as string | null | undefined) ?? null,
    // Payload tipa el group field como opcional (undefined), no nullable — el wire protocol
    // sí manda `null` cuando nmap no detecta OS (models.py::Asset.os: Optional[...]).
    os: asset.os ?? (existingDoc?.os as AssetPayload['os'] | undefined) ?? undefined,
    os_candidates: osCandidates,
    os_status: resolveOsStatus(osCandidates),
    state_reason: asset.state_reason,
    host_scripts: asset.host_scripts,
    services: asset.services,
    last_seen: asset.scan_time,
    gateway_ip: report.gateway_ip ?? (existingDoc?.gateway_ip as string | null | undefined) ?? null,
    gateway_mac: report.gateway_mac ?? (existingDoc?.gateway_mac as string | null | undefined) ?? null,
  }
}

const TECHNICAL_DIFF_FIELDS = ['ip', 'mac', 'vendor', 'hostname', 'os', 'os_candidates', 'services', 'gateway_ip', 'gateway_mac'] as const

// `state_reason`/`host_scripts` quedan fuera a propósito: cambian con cada scan aunque nada
// relevante haya cambiado, no aportan señal útil de "Changed" para el usuario.

// Payload auto-agrega un `id` a cada fila de un campo `array` (ver services[].id/os_candidates[].id
// en app/types/payload-types.ts) — existingDoc siempre lo trae, el bloque recién sanitizado del
// payload del agente nunca. Sin este strip, JSON.stringify los ve distintos en casi cualquier
// ingesta con filas, disparando "Changed" aunque nada haya cambiado de verdad. Se compara solo
// el contenido real de cada fila.
const ARRAY_DIFF_FIELDS = new Set<(typeof TECHNICAL_DIFF_FIELDS)[number]>(['services', 'os_candidates'])

function stripArrayIds(rows: Array<Record<string, unknown>> | null | undefined): Array<Record<string, unknown>> {
  return (rows ?? []).map(({ id: _id, ...rest }) => rest)
}

// Comparación por JSON.stringify: suficiente para detectar cambios reales (no le importa el
// orden interno de `services`/`os.cpe` a costa de falsos positivos si el scanner reordena el
// mismo set — aceptable para un badge informativo, no para lógica de negocio).
function hasTechnicalChanged(existingDoc: ExistingAssetDoc, technical: ReturnType<typeof sanitizeTechnicalBlock>): boolean {
  return TECHNICAL_DIFF_FIELDS.some((field) => {
    if (ARRAY_DIFF_FIELDS.has(field)) {
      return (
        JSON.stringify(stripArrayIds(existingDoc[field] as Array<Record<string, unknown>> | null)) !==
        JSON.stringify(stripArrayIds(technical[field] as Array<Record<string, unknown>> | null))
      )
    }
    return JSON.stringify(existingDoc[field] ?? null) !== JSON.stringify(technical[field] ?? null)
  })
}

// `asset_id` (hash mac-or-ip calculado por el agente) NO es una identidad estable: un mismo
// dispositivo cambia de hash entre un scan degraded (sin mac) y uno full (con mac) — buscar por
// asset_id ahí falla y esto terminaba creando un documento nuevo, huérfano de alias/owner/status
// (bug reportado: "todo dispositivo que cambia algo aparece como New y pierde sus datos").
// `mac`/`ip` ya son columnas separadas — se busca directo por ellas, acotado a `agent` para no
// cruzar oficinas que reusan el mismo rango privado (mismo motivo por el que existía el hash).
async function findExistingAsset(
  payload: Payload,
  agentId: string,
  asset: AssetPayload,
): Promise<ExistingAssetDoc | undefined> {
  if (asset.mac) {
    const byMac = await payload.find({
      collection: 'assets',
      where: { agent: { equals: agentId }, mac: { equals: asset.mac } },
      overrideAccess: true,
      limit: 1,
      depth: 0,
    })
    if (byMac.docs[0]) return byMac.docs[0]
  }

  const byIp = await payload.find({
    collection: 'assets',
    where: { agent: { equals: agentId }, ip: { equals: asset.ip } },
    overrideAccess: true,
    limit: 1,
    depth: 0,
  })
  const candidate = byIp.docs[0]
  if (!candidate) return undefined
  // Sin mac todavía en este scan: el mismo dispositivo que ya conocíamos por IP (not-null-wins
  // conserva su mac guardada, si tiene una). Con mac en este scan: solo reconciliar si el
  // candidato no tiene mac propia — si ya tiene una (distinta, porque si coincidiera lo hubiese
  // encontrado arriba), la IP fue reasignada por DHCP a otro dispositivo real, no es el mismo.
  if (!asset.mac || !candidate.mac) return candidate
  return undefined
}

// Upsert vía Local API (nunca queries crudas) para que los hooks de Assets se disparen siempre.
// office/organization siempre vienen de `auth` (Agent ya autenticado), nunca del body.
export async function ingestScanReport(
  payload: Payload,
  report: ScanReportPayload,
  auth: AgentAuthResult,
): Promise<IngestResult> {
  const processedAssetIds: string[] = []
  const rejectedAssets: IngestResult['rejectedAssets'] = []

  for (const asset of report.assets) {
    const missing = findMissingFields(asset)
    if (missing.length > 0) {
      rejectedAssets.push({
        asset_id: asset.asset_id ?? 'unknown',
        error: `campos técnicos faltantes: ${missing.join(', ')}`,
      })
      continue
    }

    const existingDoc = await findExistingAsset(payload, auth.agentId, asset)
    const technical = sanitizeTechnicalBlock(asset, report, existingDoc)

    if (existingDoc) {
      // "Changed" solo aplica a un activo que un humano ya vio (first_viewed_at != null) — antes
      // de eso el badge "New" ya cubre "hay algo nuevo acá", marcar ambos sería redundante.
      const technicalChanged = existingDoc.first_viewed_at != null && hasTechnicalChanged(existingDoc, technical)

      // Bloque de negocio (alias/criticality/location/status) nunca se toca acá, salvo
      // 'retired' → sticky (doc05§5.1): un scan nuevo no revive un activo dado de baja.
      await payload.update({
        collection: 'assets',
        id: existingDoc.id,
        overrideAccess: true,
        data: {
          ...technical,
          agent: auth.agentId,
          office: auth.officeId,
          organization: auth.organizationId,
          ...(existingDoc.status === 'retired' ? {} : { status: 'active' }),
          ...(technicalChanged ? { technical_changed_at: new Date().toISOString() } : {}),
        },
      })
    } else {
      await payload.create({
        collection: 'assets',
        overrideAccess: true,
        data: {
          ...technical,
          agent: auth.agentId,
          office: auth.officeId,
          organization: auth.organizationId,
          status: 'active',
        },
      })
    }

    processedAssetIds.push(technical.asset_id)
  }

  return { processedAssetIds, rejectedAssets }
}
