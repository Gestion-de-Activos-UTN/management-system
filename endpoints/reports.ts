import type { Endpoint } from 'payload'
import { ScanReportPayloadSchema } from '../contracts/scan-report.schema'
import {
  resolveAgentAuth,
  createPayloadAgentAuthDeps,
  AgentAuthError,
} from '../access/middleware/resolveAgentAuth'
import { processScanReport } from '../domain/inventories/processScanReport'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

const MAX_REPORT_BYTES = 5 * 1024 * 1024
// AUDIT: la ingesta de un ScanReport es una escritura sensible (crea/actualiza Assets de una organización).
// TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent una vez exista el write path de AuditLogs.
export const reportsEndpoint: Endpoint = {
  path: '/v1/reports',
  method: 'post',
  handler: async req => {
    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_REPORT_BYTES) return json({ error: 'payload too large' }, 413)

    const authDeps = createPayloadAgentAuthDeps(req.payload)
    let auth
    try {
      auth = await resolveAgentAuth(
        {
          authorization: req.headers.get('authorization'),
          'x-agent-id': req.headers.get('x-agent-id'),
        },
        authDeps
      )
    } catch (err) {
      if (err instanceof AgentAuthError) return json({ error: err.message }, err.status)
      throw err
    }
    // Resetea acá, no solo al final: la resolución de auth arriba ya exigió el hash
    // correcto, así que un retry idempotente (línea ~59, abajo) también cuenta como éxito.
    await authDeps.resetAttempts(auth.agentId)

    const rawBody = await req.json!()
    if (Buffer.byteLength(JSON.stringify(rawBody), 'utf8') > MAX_REPORT_BYTES) {
      return json({ error: 'payload too large' }, 413)
    }
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
    if (body.assets.some(asset => asset.agent_id !== body.agent_id)) {
      return json({ error: 'asset agent_id mismatch' }, 400)
    }

    const result = await processScanReport(req.payload, body, auth, req)

    return json({
      report_id: body.report_id,
      status: result.status,
      processed: result.processedAssetIds.length,
      rejected: result.rejectedAssets,
    })
  },
}
