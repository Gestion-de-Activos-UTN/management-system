import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope, type Action } from '../access/rbac/permissions'
import { defaultFeatures } from '../domain/subscriptions/features'

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
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx) return json({ error: 'unauthenticated' }, 401)
    const subscription = ctx.organizationId
      ? await req.payload.find({
          collection: 'subscriptions',
          where: { organization: { equals: ctx.organizationId } },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 1,
        })
      : null
    const rawFeatures = subscription?.docs[0]?.features
    const persistedFeatures =
      rawFeatures && typeof rawFeatures === 'object' && !Array.isArray(rawFeatures)
        ? rawFeatures
        : {}
    // Las suscripciones anteriores a una feature no tienen su clave en el JSON. Los defaults
    // completan esas claves sin pisar un false explícito y evitan una migración bloqueante.
    const features = { ...defaultFeatures(), ...persistedFeatures }
    // The frontend reads the row scope from here instead of comparing role slugs.
    const taskActions: Action[] = [
      'create',
      'read',
      'edit',
      'claim',
      'release',
      'assign',
      'reassign',
      'complete',
      'cancel',
      'archive',
      'delete',
    ]
    return json({
      ...ctx,
      orgWide: hasOrgWideScope(ctx.role),
      features,
      permissions: {
        tasks: taskActions.filter(action => canDo(ctx.role, 'tasks', action, ctx.organizationId)),
      },
    })
  },
}
