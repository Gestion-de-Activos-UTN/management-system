import { z } from 'zod'

// Mapeo 1:1 contra el payload inline de scanner-prototype/src/siam_agent/agent.py::_heartbeat_loop
// (no es un dataclass en models.py, pero la forma es fija igual).
export const HeartbeatPayloadSchema = z
  .object({
    agent_id: z.string(),
    status: z.string(),
    timestamp: z.string(),
  })
  .passthrough()

export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>
