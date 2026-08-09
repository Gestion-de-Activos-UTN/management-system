import type { Endpoint } from 'payload'
import {
  resolveAgentAuth,
  createPayloadAgentAuthDeps,
  AgentAuthError,
} from '../access/middleware/resolveAgentAuth'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// ponytail: mismo catálogo fijo de demo que scanner-prototype/src/siam_agent/mock_server.py
// (_MOCK_VENDORS) — reemplazar por una base IEEE OUI real cuando haya necesidad real de
// resolver vendors fuera de este catálogo demo.
const MOCK_VENDORS: Record<string, string> = {
  '44D454': 'Sagemcom Broadband SAS',
  C07982: 'TCL King Electrical Appliances',
}

export const vendorEndpoint: Endpoint = {
  path: '/v1/vendor',
  method: 'get',
  handler: async (req) => {
    try {
      // oui_lookup.py::_lookup_vendor_remote no manda X-Agent-ID, igual que heartbeat.
      await resolveAgentAuth(
        { authorization: req.headers.get('authorization') },
        createPayloadAgentAuthDeps(req.payload),
      )
    } catch (err) {
      if (err instanceof AgentAuthError) return json({ error: err.message }, 401)
      throw err
    }

    const mac = new URL(req.url ?? '', 'http://localhost').searchParams
      .get('mac')
      ?.replace(/[:-]/g, '')
      .toUpperCase()
      .slice(0, 6)

    const vendor = mac ? MOCK_VENDORS[mac] : undefined
    // 404 en miss, no {vendor:null} con 200 — mismo contrato que mock_server.py, ya consumido
    // por oui_lookup.py::_lookup_vendor_remote (`resp.status_code != 200` → None, sin romper el breaker).
    if (!vendor) return json({ error: 'unknown vendor' }, 404)

    return json({ vendor })
  },
}
