import type { Payload } from 'payload'
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

// Saneo: el Zod schema es .passthrough() a propósito (permisivo-en-lectura), pero acá se
// extrae EXPLÍCITAMENTE solo el bloque técnico conocido — nada del payload original (con
// eventuales campos extra) llega directo a `payload.create`/`update`.
function sanitizeTechnicalBlock(asset: AssetPayload) {
  return {
    asset_id: asset.asset_id,
    ip: asset.ip,
    // El scanner manda "" cuando no pudo resolverlos (ver nota arriba) — se normaliza a `null`
    // acá, no en el scanner, para que Assets guarde exactamente lo que su propio contrato
    // documenta (`mac: string | null`, doc 05 §5.1), no un string vacío disfrazado de dato.
    mac: asset.mac || null,
    vendor: asset.vendor || null,
    hostname: asset.hostname || null,
    // Payload tipa el group field como opcional (undefined), no nullable — el wire protocol
    // sí manda `null` cuando nmap no detecta OS (models.py::Asset.os: Optional[...]).
    os: asset.os ?? undefined,
    services: asset.services,
    last_seen: asset.scan_time,
  }
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

    const technical = sanitizeTechnicalBlock(asset)
    const existing = await payload.find({
      collection: 'assets',
      where: { asset_id: { equals: technical.asset_id } },
      overrideAccess: true,
      limit: 1,
      depth: 0,
    })
    const existingDoc = existing.docs[0]

    if (existingDoc) {
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
