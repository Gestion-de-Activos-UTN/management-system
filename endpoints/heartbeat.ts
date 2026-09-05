import type { Endpoint } from 'payload'
import { HeartbeatPayloadSchema } from '../contracts/heartbeat.schema'
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
    const authDeps = createPayloadAgentAuthDeps(req.payload)
    let auth
    try {
      // agent.py::_heartbeat_loop no manda X-Agent-ID (solo Authorization) — resolveAgentAuth
      // ya tolera esa ausencia, solo compara si el header está presente.
      auth = await resolveAgentAuth({ authorization: req.headers.get('authorization') }, authDeps)
    } catch (err) {
      if (err instanceof AgentAuthError) return json({ error: err.message }, 401)
      throw err
    }

    const rawBody = await req.json!()
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
    // Un heartbeat exitoso resetea el contador de fallos previos — no deben acumularse
    // fallos viejos y ya no representativos hasta bloquear al agente (ver resolveAgentAuth.ts).
    await authDeps.resetAttempts(auth.agentId)

    return json({ status: 'ok' })
  },
}
