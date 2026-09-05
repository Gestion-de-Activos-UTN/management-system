import { z } from 'zod'

// Mapeo 1:1 contra el payload inline de scanner-prototype/src/siam_agent/agent.py::_heartbeat_loop
// (no es un dataclass en models.py, pero la forma es fija igual).
export const HeartbeatPayloadSchema = z
  .object({
    agent_id: z.string(),
    // Agentes viejos podían mandar cualquier texto; los valores desconocidos se conservan como
    // `unknown` en vez de romper el canal durante una actualización gradual.
    status: z.enum(['idle', 'scanning', 'unknown']).catch('unknown'),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .passthrough()

export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>
