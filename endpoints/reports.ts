import type { Endpoint } from 'payload'
import { ScanReportPayloadSchema } from '../contracts/scan-report.schema'
import {
  resolveAgentAuth,
  createPayloadAgentAuthDeps,
  AgentAuthError,
} from '../access/middleware/resolveAgentAuth'
import { ingestScanReport } from '../domain/inventories/ingestScanReport'
import { maybeCreateAutoSnapshot } from '../domain/inventories/autoSnapshot'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// AUDIT: la ingesta de un ScanReport es una escritura sensible (crea/actualiza Assets de una organización).
// TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent una vez exista el write path de AuditLogs.
export const reportsEndpoint: Endpoint = {
  path: '/v1/reports',
  method: 'post',
  handler: async (req) => {
    const authDeps = createPayloadAgentAuthDeps(req.payload)
    let auth
    try {
      auth = await resolveAgentAuth(
        {
          authorization: req.headers.get('authorization'),
          'x-agent-id': req.headers.get('x-agent-id'),
        },
        authDeps,
      )
    } catch (err) {
      if (err instanceof AgentAuthError) return json({ error: err.message }, 401)
      throw err
    }
    // Resetea acá, no solo al final: la resolución de auth arriba ya exigió el hash
    // correcto, así que un retry idempotente (línea ~59, abajo) también cuenta como éxito.
    await authDeps.resetAttempts(auth.agentId)

    const rawBody = await req.json!()
    const parseResult = ScanReportPayloadSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return json({ error: 'invalid payload', issues: parseResult.error.issues }, 400)
    }
    const body = parseResult.data

    // El token ya resolvió un agentId (vía X-Agent-ID o directo) — el agent_id del body
    // es la fuente que realmente importa (doc 08.4): si no coincide, alguien intenta
    // inyectar datos a nombre de otro agente con un token que no es el suyo.
    if (body.agent_id !== auth.agentId) {
      return json({ error: 'agent_id mismatch' }, 401)
    }

    const existing = await req.payload.find({
      collection: 'scan-reports',
      where: { id: { equals: body.report_id } },
      overrideAccess: true,
      limit: 1,
      depth: 0,
    })
    const existingReport = existing.docs[0]

    // Idempotencia (doc 08.6): reintento con el mismo report_id ya procesado/fallido no reprocesa.
    if (existingReport && existingReport.status !== 'received') {
      return json({ report_id: body.report_id, status: existingReport.status }, 200)
    }

    if (!existingReport) {
      await req.payload.create({
        collection: 'scan-reports',
        overrideAccess: true,
        data: {
          id: body.report_id,
          agent: auth.agentId,
          office: auth.officeId,
          network: body.network,
          scan_start: body.scan_start,
          scan_end: body.scan_end,
          hosts_up: body.hosts_up,
          raw_payload: body,
          status: 'received',
        },
      })
    }

    // Antes de aplicar el reporte, no después — el snapshot debe reflejar el estado previo a
    // este scan, no el que el scan está a punto de escribir. No bloquea el ingest si falla
    // (ver catch): tomar un snapshot es secundario al trabajo principal del endpoint.
    try {
      await maybeCreateAutoSnapshot(req.payload, auth.officeId, auth.organizationId)
    } catch {
      // ponytail: sin logging estructurado en el repo todavía — un snapshot perdido no debe
      // tumbar la ingesta real. Revisar si esto se vuelve frecuente en prod.
    }

    const result = await ingestScanReport(req.payload, body, auth)

    await req.payload.update({
      collection: 'scan-reports',
      id: body.report_id,
      overrideAccess: true,
      data: {
        status: 'processed',
        processed_at: new Date().toISOString(),
        error: result.rejectedAssets.length > 0 ? JSON.stringify(result.rejectedAssets) : null,
      },
    })

    return json({
      report_id: body.report_id,
      status: 'processed',
      processed: result.processedAssetIds.length,
      rejected: result.rejectedAssets,
    })
  },
}
