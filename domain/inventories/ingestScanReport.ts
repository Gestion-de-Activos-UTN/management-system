import type { Payload } from 'payload'
import type { Asset } from '../../app/types/payload-types'
import type { AssetPayload } from '../../contracts/asset.schema'
import type { ScanReportPayload } from '../../contracts/scan-report.schema'
import type { AgentAuthResult } from '../../access/middleware/resolveAgentAuth'
import { inferDeviceCategory } from '../assets/inferDeviceCategory'

export interface IngestResult {
  processedAssetIds: string[]
  processedDocumentIds: string[]
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
  return REQUIRED_ASSET_FIELDS.filter(field => !asset[field]) as string[]
}

type EvidenceHistoryRow = {
  id?: string | null
  kind?: 'mac' | 'vendor' | 'name' | 'device_class' | null
  value?: string | null
  source?: string | null
  first_seen_at?: string | null
  last_seen_at?: string | null
  seen_count?: number | null
  last_report_id?: string | null
}

type ExistingAssetDoc = Asset

type ObservedAgentRow = Omit<NonNullable<Asset['observed_agents']>[number], 'id'>

// Aunque el contrato Zod es estricto, acá se extrae EXPLÍCITAMENTE solo el bloque técnico
// conocido: el modelo HTTP nunca se persiste por spread directo en Assets.
//
// Política de merge no es uniforme para todo el bloque (dos naturalezas distintas):
// - IDENTIDAD (mac/vendor/hostname/os/gateway_*): requieren privilegios (ARP/raw socket) para
//   resolverse. Un scan degraded (sin sudo/Npcap, ver scan-report.schema.ts) manda "" — eso NO
//   significa "el dato cambió a vacío", significa "este scan no pudo verlo". Not-null-wins: se
//   conserva el último valor conocido si el nuevo viene vacío.
// - DINÁMICO (ip/services/cobertura/issues): refleja la última observación y solo se reemplaza
//   cuando scan_time no es anterior a last_seen. `services: []` describe cero observaciones;
//   la inferencia consulta asset_coverage antes de convertir esa ausencia en señal.
//   `state_reason`/`host_scripts` son igual de dinámicos (evidencia puntual de ESE scan). `os_candidates`
//   viaja pegado a `os` (misma naturaleza identidad, mismo not-null-wins) — no tiene sentido
//   vaciar candidatos previos solo porque un scan puntual no trajo osmatch.
const OS_ACCURACY_THRESHOLD = 85

// Decisión de negocio de la plataforma, nunca del agente (el scanner solo reporta candidatos
// crudos) — ver management-system/CLAUDE.md y la nota de conversación sobre esta regla.
function resolveOsStatus(
  osCandidates: AssetPayload['os_candidates']
): 'identified' | 'indeterminate' {
  return (osCandidates[0]?.accuracy ?? 0) >= OS_ACCURACY_THRESHOLD ? 'identified' : 'indeterminate'
}

function sanitizeTechnicalBlock(
  asset: AssetPayload,
  report: ScanReportPayload,
  existingDoc: ExistingAssetDoc | undefined,
  agentId: string
) {
  const incomingIsLatest =
    !existingDoc?.last_seen || Date.parse(asset.scan_time) >= Date.parse(existingDoc.last_seen)
  const osCandidates =
    incomingIsLatest && asset.os_candidates.length > 0
      ? asset.os_candidates
      : ((existingDoc?.os_candidates as AssetPayload['os_candidates'] | undefined) ?? [])

  const scannerHostMatch = deriveScannerHostMatch(asset, report.scanner_interfaces)
  const appliedReportIds = (existingDoc?.applied_report_ids ?? [])
    .map(row => row.report_id)
    .filter((id): id is string => Boolean(id))
  const evidenceHistory = mergeEvidenceHistory(
    existingDoc?.evidence_history,
    asset,
    report.report_id,
    appliedReportIds.includes(report.report_id)
  )

  const technical = {
    asset_id: existingDoc?.asset_id ?? asset.asset_id,
    ip: incomingIsLatest ? asset.ip : existingDoc?.ip,
    // El scanner manda "" cuando no pudo resolverlos (ver nota arriba) — se normaliza a `null`
    // acá, no en el scanner, para que Assets guarde exactamente lo que su propio contrato
    // documenta (`mac: string | null`, doc 05 §5.1), no un string vacío disfrazado de dato.
    mac: (asset.mac || null) ?? (existingDoc?.mac as string | null | undefined) ?? null,
    vendor: (asset.vendor || null) ?? (existingDoc?.vendor as string | null | undefined) ?? null,
    hostname:
      (asset.hostname || null) ?? (existingDoc?.hostname as string | null | undefined) ?? null,
    // Payload tipa el group field como opcional (undefined), no nullable — el wire protocol
    // sí manda `null` cuando nmap no detecta OS (models.py::Asset.os: Optional[...]).
    os:
      (incomingIsLatest ? asset.os : undefined) ??
      (existingDoc?.os as AssetPayload['os'] | undefined) ??
      undefined,
    os_candidates: osCandidates,
    os_status: resolveOsStatus(osCandidates),
    state_reason: incomingIsLatest ? asset.state_reason : existingDoc?.state_reason,
    host_scripts: incomingIsLatest ? asset.host_scripts : existingDoc?.host_scripts,
    services: incomingIsLatest ? asset.services : existingDoc?.services,
    last_seen: incomingIsLatest ? asset.scan_time : existingDoc?.last_seen,
    gateway_ip:
      (incomingIsLatest ? report.gateway_ip : undefined) ??
      (existingDoc?.gateway_ip as string | null | undefined) ??
      null,
    gateway_mac:
      (incomingIsLatest ? report.gateway_mac : undefined) ??
      (existingDoc?.gateway_mac as string | null | undefined) ??
      null,
    observed_agents: mergeObservedAgents(existingDoc?.observed_agents, {
      agentId,
      ip: asset.ip,
      gatewayIp: report.gateway_ip,
      gatewayMac: report.gateway_mac,
      lastSeen: asset.scan_time,
    }),
    names: incomingIsLatest ? asset.names : (existingDoc?.names ?? []),
    mac_metadata: incomingIsLatest ? asset.mac_metadata : existingDoc?.mac_metadata,
    asset_coverage: incomingIsLatest ? asset.asset_coverage : existingDoc?.asset_coverage,
    scan_issues: incomingIsLatest ? asset.scan_issues : (existingDoc?.scan_issues ?? []),
    is_scanner_host: incomingIsLatest
      ? scannerHostMatch !== 'none' &&
        scannerHostMatch !== 'unknown' &&
        scannerHostMatch !== 'conflict'
      : existingDoc?.is_scanner_host,
    scanner_host_match: incomingIsLatest
      ? scannerHostMatch
      : (existingDoc?.scanner_host_match ?? 'unknown'),
    evidence_history: evidenceHistory,
    applied_report_ids: [
      ...appliedReportIds.filter(id => id !== report.report_id),
      report.report_id,
    ]
      .slice(-50)
      .map(report_id => ({ report_id })),
  }
  const inference = inferDeviceCategory({
    ...technical,
    gateway_match_conflict:
      hasGatewayConflict(report) &&
      (asset.ip === report.gateway_ip || asset.mac === report.gateway_mac),
  })
  const inferredType = inference.category ?? ('unknown' as const)
  return {
    ...technical,
    inferred_type: inferredType,
    inference_confidence: inference.tier,
    inference_signals: inference.signals,
    inference_version: 2,
  }
}

function mergeObservedAgents(
  existingRows: ExistingAssetDoc['observed_agents'] | undefined,
  observation: {
    agentId: string
    ip: string
    gatewayIp: string | null
    gatewayMac: string | null
    lastSeen: string
  }
) {
  const rows: ObservedAgentRow[] = (existingRows ?? []).map(({ id: _id, ...row }) => row)
  const existing = rows.find(row => {
    const agent = row.agent
    return typeof agent === 'string' ? agent === observation.agentId : agent?.id === observation.agentId
  })

  if (existing) {
    existing.ip = observation.ip
    existing.gateway_ip = observation.gatewayIp
    existing.gateway_mac = observation.gatewayMac
    if (!existing.last_seen || Date.parse(observation.lastSeen) >= Date.parse(existing.last_seen)) {
      existing.last_seen = observation.lastSeen
    }
  } else {
    rows.push({
      agent: observation.agentId,
      ip: observation.ip,
      gateway_ip: observation.gatewayIp,
      gateway_mac: observation.gatewayMac,
      last_seen: observation.lastSeen,
    })
  }

  return rows
}

function hasGatewayConflict(report: ScanReportPayload): boolean {
  if (!report.gateway_ip || !report.gateway_mac) return false
  const ipMatch = report.assets.findIndex(asset => asset.ip === report.gateway_ip)
  const macMatch = report.assets.findIndex(asset => asset.mac === report.gateway_mac)
  return ipMatch >= 0 && macMatch >= 0 && ipMatch !== macMatch
}

function deriveScannerHostMatch(
  asset: AssetPayload,
  interfaces: ScanReportPayload['scanner_interfaces']
): 'ip' | 'mac' | 'both' | 'conflict' | 'none' | 'unknown' {
  if (interfaces.length === 0) return 'unknown'
  const ipMatches = new Set(
    interfaces.flatMap((iface, index) => (iface.ip === asset.ip ? [index] : []))
  )
  const macMatches = new Set(
    interfaces.flatMap((iface, index) =>
      asset.mac && iface.mac && iface.mac === asset.mac ? [index] : []
    )
  )
  if (ipMatches.size > 0 && macMatches.size > 0) {
    return [...ipMatches].some(index => macMatches.has(index)) ? 'both' : 'conflict'
  }
  if (macMatches.size > 0) return 'mac'
  if (ipMatches.size > 0) return 'ip'
  return 'none'
}

function mergeEvidenceHistory(
  existingRows: EvidenceHistoryRow[] | null | undefined,
  asset: AssetPayload,
  reportId: string,
  alreadyApplied: boolean
): EvidenceHistoryRow[] {
  const rows = (existingRows ?? []).map(({ id: _id, ...row }) => ({ ...row }))
  if (alreadyApplied) return rows
  const observations: Array<Pick<EvidenceHistoryRow, 'kind' | 'value' | 'source'>> = []
  if (asset.mac && asset.mac_metadata.kind === 'globally_administered') {
    observations.push({ kind: 'mac', value: asset.mac, source: 'scanner' })
  }
  if (asset.vendor) observations.push({ kind: 'vendor', value: asset.vendor, source: 'oui' })
  for (const name of asset.names) {
    observations.push({ kind: 'name', value: name.value.toLowerCase(), source: name.source })
  }
  if (asset.os?.device_type) {
    observations.push({ kind: 'device_class', value: asset.os.device_type, source: 'nmap' })
  }

  for (const observation of observations) {
    const existing = rows.find(
      row =>
        row.kind === observation.kind &&
        row.value === observation.value &&
        row.source === observation.source
    )
    if (existing) {
      if (existing.last_report_id !== reportId) {
        if (
          !existing.first_seen_at ||
          Date.parse(asset.scan_time) < Date.parse(existing.first_seen_at)
        ) {
          existing.first_seen_at = asset.scan_time
        }
        if (
          !existing.last_seen_at ||
          Date.parse(asset.scan_time) > Date.parse(existing.last_seen_at)
        ) {
          existing.last_seen_at = asset.scan_time
        }
        existing.seen_count = (existing.seen_count ?? 0) + 1
        existing.last_report_id = reportId
      }
    } else {
      rows.push({
        ...observation,
        first_seen_at: asset.scan_time,
        last_seen_at: asset.scan_time,
        seen_count: 1,
        last_report_id: reportId,
      })
    }
  }
  return rows
    .sort((a, b) => Date.parse(b.last_seen_at ?? '') - Date.parse(a.last_seen_at ?? ''))
    .slice(0, 100)
}

const TECHNICAL_DIFF_FIELDS = [
  'ip',
  'mac',
  'vendor',
  'hostname',
  'os',
  'os_candidates',
  'services',
  'gateway_ip',
  'gateway_mac',
  'observed_agents',
  'names',
  'mac_metadata',
  'asset_coverage',
  'scan_issues',
  'is_scanner_host',
  'scanner_host_match',
] as const

// `state_reason`/`host_scripts` quedan fuera a propósito: cambian con cada scan aunque nada
// relevante haya cambiado, no aportan señal útil de "Changed" para el usuario.

// Payload auto-agrega un `id` a cada fila de un campo `array` (ver services[].id/os_candidates[].id
// en app/types/payload-types.ts) — existingDoc siempre lo trae, el bloque recién sanitizado del
// payload del agente nunca. Sin este strip, JSON.stringify los ve distintos en casi cualquier
// ingesta con filas, disparando "Changed" aunque nada haya cambiado de verdad. Se compara solo
// el contenido real de cada fila.
const ARRAY_DIFF_FIELDS = new Set<(typeof TECHNICAL_DIFF_FIELDS)[number]>([
  'services',
  'os_candidates',
  'observed_agents',
  'names',
  'scan_issues',
])

function stripArrayIds(
  rows: Array<Record<string, unknown>> | null | undefined
): Array<Record<string, unknown>> {
  return (rows ?? []).map(({ id: _id, ...rest }) => rest)
}

// Comparación por JSON.stringify: suficiente para detectar cambios reales (no le importa el
// orden interno de `services`/`os.cpe` a costa de falsos positivos si el scanner reordena el
// mismo set — aceptable para un badge informativo, no para lógica de negocio).
function hasTechnicalChanged(
  existingDoc: ExistingAssetDoc,
  technical: ReturnType<typeof sanitizeTechnicalBlock>
): boolean {
  return TECHNICAL_DIFF_FIELDS.some(field => {
    // Campos incorporados por una versión nueva no convierten por sí solos al documento en
    // "Changed"; el badge representa un cambio observado entre dos valores conocidos.
    if (existingDoc[field] === undefined) return false
    if (ARRAY_DIFF_FIELDS.has(field)) {
      return (
        JSON.stringify(
          stripArrayIds(existingDoc[field] as Array<Record<string, unknown>> | null)
        ) !==
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
  officeId: string,
  organizationId: string,
  asset: AssetPayload
): Promise<ExistingAssetDoc | undefined> {
  if (asset.mac) {
    const byMac = await payload.find({
      collection: 'assets',
      where: {
        organization: { equals: organizationId },
        mac: { equals: asset.mac },
      },
      overrideAccess: true,
      limit: 1,
      depth: 0,
    })
    if (byMac.docs[0]) return byMac.docs[0]
  }

  const byIp = await payload.find({
    collection: 'assets',
    where: {
      organization: { equals: organizationId },
      office: { equals: officeId },
      ip: { equals: asset.ip },
    },
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
  auth: AgentAuthResult
): Promise<IngestResult> {
  const processedAssetIds: string[] = []
  const processedDocumentIds: string[] = []
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

    const existingDoc = await findExistingAsset(
      payload,
      auth.officeId,
      auth.organizationId,
      asset
    )
    const technical = sanitizeTechnicalBlock(asset, report, existingDoc, auth.agentId)

    if (existingDoc) {
      // "Changed" solo aplica a un activo que un humano ya vio (first_viewed_at != null) — antes
      // de eso el badge "New" ya cubre "hay algo nuevo acá", marcar ambos sería redundante.
      const technicalChanged =
        existingDoc.first_viewed_at != null && hasTechnicalChanged(existingDoc, technical)

      // Bloque de negocio (alias/criticality/location/status) nunca se toca acá, salvo
      // 'retired' → sticky (doc05§5.1): un scan nuevo no revive un activo dado de baja.
      // AUDIT: emits AuditLogs entry (chain_hash, chained per organization_id) — TODO(audit-feature): wire via domain/audit/builder.ts::addAuditEvent
      const updated = await payload.update({
        collection: 'assets',
        id: existingDoc.id,
        overrideAccess: true,
        context: { systemJob: true },
        data: {
          ...technical,
          agent: auth.agentId,
          office: auth.officeId,
          organization: auth.organizationId,
          ...(existingDoc.status === 'retired' ? {} : { status: 'active' }),
          ...(existingDoc.identification_status === 'confirmed' &&
          existingDoc.confirmed_type &&
          technical.inference_confidence === 'likely' &&
          technical.inferred_type !== existingDoc.confirmed_type
            ? { identification_status: 'needs_review' }
            : {}),
          ...(technicalChanged ? { technical_changed_at: new Date().toISOString() } : {}),
        },
      })
      processedDocumentIds.push(String(updated.id))
    } else {
      // AUDIT: emits AuditLogs entry (chain_hash, chained per organization_id) — TODO(audit-feature): wire via domain/audit/builder.ts::addAuditEvent
      const created = await payload.create({
        collection: 'assets',
        overrideAccess: true,
        context: { systemJob: true },
        data: {
          ...technical,
          agent: auth.agentId,
          office: auth.officeId,
          organization: auth.organizationId,
          status: 'active',
        },
      })
      processedDocumentIds.push(String(created.id))
    }

    processedAssetIds.push(technical.asset_id)
  }

  return { processedAssetIds, processedDocumentIds, rejectedAssets }
}
