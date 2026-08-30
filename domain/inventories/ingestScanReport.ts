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
function sanitizeTechnicalBlock(asset: AssetPayload, report: ScanReportPayload, existingDoc?: ExistingAssetDoc) {
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
    services: asset.services,
    last_seen: asset.scan_time,
    gateway_ip: report.gateway_ip ?? (existingDoc?.gateway_ip as string | null | undefined) ?? null,
    gateway_mac: report.gateway_mac ?? (existingDoc?.gateway_mac as string | null | undefined) ?? null,
  }
}

const TECHNICAL_DIFF_FIELDS = ['ip', 'mac', 'vendor', 'hostname', 'os', 'services', 'gateway_ip', 'gateway_mac'] as const

// Comparación por JSON.stringify: suficiente para detectar cambios reales (no le importa el
// orden interno de `services`/`os.cpe` a costa de falsos positivos si el scanner reordena el
// mismo set — aceptable para un badge informativo, no para lógica de negocio).
function hasTechnicalChanged(existingDoc: ExistingAssetDoc, technical: ReturnType<typeof sanitizeTechnicalBlock>): boolean {
  return TECHNICAL_DIFF_FIELDS.some(
    field => JSON.stringify(existingDoc[field] ?? null) !== JSON.stringify(technical[field] ?? null),
  )
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

    const existing = await payload.find({
      collection: 'assets',
      where: { asset_id: { equals: asset.asset_id } },
      overrideAccess: true,
      limit: 1,
      depth: 0,
    })
    const existingDoc = existing.docs[0]
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
