import type { Endpoint } from 'payload'
import { HeartbeatPayloadSchema } from '../contracts/heartbeat.schema'
import { readBoundedJSON, RequestBodyError } from '../lib/read-bounded-json'
import {
  resolveAgentAuth,
  createPayloadAgentAuthDeps,
  AgentAuthError,
} from '../access/middleware/resolveAgentAuth'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export const heartbeatEndpoint: Endpoint = {
  path: '/v1/heartbeat',
  method: 'post',
  handler: async req => {
    let rawBody: unknown
    try { rawBody = await readBoundedJSON(req, 16 * 1024) }
    catch (error) {
      if (error instanceof RequestBodyError) return json({ error: error.message }, error.status)
      throw error
    }
    const authDeps = createPayloadAgentAuthDeps(req.payload)
    let auth
    try {
      // agent.py::_heartbeat_loop no manda X-Agent-ID (solo Authorization) — resolveAgentAuth
      // ya tolera esa ausencia, solo compara si el header está presente.
      auth = await resolveAgentAuth({ authorization: req.headers.get('authorization') }, authDeps)
    } catch (err) {
      // Contrato con el escáner: 401 {"error": "agent revoked"} (sólo con credencial válida) hace
      // que el agente se detenga solo y no vuelva a escanear (scanner-prototype agent.py
      // _is_revocation). No cambiar ese texto sin versionar el canal (SYSTEM_PROMPT §6).
      if (err instanceof AgentAuthError) return json({ error: err.message }, err.status)
      throw err
    }

    const parseResult = HeartbeatPayloadSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return json({ error: 'invalid payload', issues: parseResult.error.issues }, 400)
    }
    const body = parseResult.data

    if (body.agent_id !== auth.agentId) {
      return json({ error: 'agent_id mismatch' }, 401)
    }

    const receivedAt = new Date().toISOString()
    const existing = await req.payload.findByID({
      collection: 'agents',
      id: auth.agentId,
      overrideAccess: true,
      req,
      depth: 0,
    })

    try {
      await req.payload.update({
        collection: 'agents',
        id: auth.agentId,
        overrideAccess: true,
        req,
        data: {
          // La conectividad se decide con el reloj del servidor. El reloj local del cliente puede
          // estar atrasado, adelantado o manipulado y queda solo como evidencia diagnóstica.
          last_heartbeat_at: receivedAt,
          last_agent_timestamp: body.timestamp,
          runtime_status: body.status,
          lifecycle_status: 'active',
          ...(existing.first_heartbeat_at ? {} : { first_heartbeat_at: receivedAt }),
        },
      })
    } catch {
      // Carrera: el agente fue revocado entre resolveAgentAuth (arriba) y este update —
      // assertAgentTransition (collections/Agents beforeChange) rechaza revoked -> active.
      return json({ error: 'agent revoked' }, 401)
    }
    // Un heartbeat exitoso resetea el contador de fallos previos — no deben acumularse
    // fallos viejos y ya no representativos hasta bloquear al agente (ver resolveAgentAuth.ts).
    await authDeps.resetAttempts(auth.agentId)

    return json({ status: 'ok' })
  },
}
