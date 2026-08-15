import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Bearer/JWT parsing is automatic, not something this handler does: createPayloadRequest.js
// runs executeAuthStrategies for every REST request (custom endpoints included) before any
// handler executes, extracting `Authorization: Bearer <token>` (extractJWT.js) and populating
// req.user. getTenantContext(req) -> payloadNativeIdentityProvider.resolveIdentity(req) reads
// exactly that req.user — nothing to parse here, don't add redundant header handling.
export const sessionEndpoint: Endpoint = {
  path: '/v1/session',
  method: 'get',
  handler: async (req) => {
    const ctx = await getTenantContext(req)
    if (!ctx) return json({ error: 'unauthenticated' }, 401)
    return json(ctx)
  },
}
