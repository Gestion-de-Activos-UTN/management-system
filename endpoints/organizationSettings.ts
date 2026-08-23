import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// OrganizationSettings.access es () => false en las 4 acciones a propósito (solo la creación de
// org escribe el doc inicial, ver domain/organizations/createOrgWithAdmin.ts). Estos dos
// endpoints son el único otro punto de lectura/escritura, acotados a los campos de config de
// Inventario (snapshot_before_each_scan/snapshot_interval_days) — nunca industry/risk_score_policy,
// que no tienen UI real todavía (ver app/portal/(protected)/admin/settings/page.tsx).
// El portal ya oculta /admin a quien no es org_admin (client-side, ver admin/layout.tsx) — acá se
// repite la validación server-side, que es la que realmente cuenta.
type LoadResult =
  | { ok: false; response: Response }
  | { ok: true; doc: { id: string | number } }

async function loadSettings(req: Parameters<Endpoint['handler']>[0]): Promise<LoadResult> {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return { ok: false, response: json({ error: 'unauthenticated' }, 401) }
  if (ctx.role !== 'org_admin' || !ctx.organizationId) {
    return { ok: false, response: json({ error: 'forbidden' }, 403) }
  }

  const result = await req.payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: ctx.organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const doc = result.docs[0]
  if (!doc) return { ok: false, response: json({ error: 'not_found' }, 404) }

  return { ok: true, doc }
}

export const organizationSettingsGetEndpoint: Endpoint = {
  path: '/v1/organization-settings',
  method: 'get',
  handler: async (req) => {
    const loaded = await loadSettings(req)
    if (!loaded.ok) return loaded.response
    const doc = await req.payload.findByID({
      collection: 'organization-settings',
      id: loaded.doc.id,
      overrideAccess: true,
      req,
      depth: 0,
    })
    return json(doc)
  },
}

export const organizationSettingsUpdateEndpoint: Endpoint = {
  path: '/v1/organization-settings',
  method: 'patch',
  handler: async (req) => {
    const loaded = await loadSettings(req)
    if (!loaded.ok) return loaded.response

    const body = (await req.json!()) as {
      snapshot_before_each_scan?: boolean
      snapshot_interval_days?: number | null
      offline_after_hours?: number | null
    }

    const updated = await req.payload.update({
      collection: 'organization-settings',
      id: loaded.doc.id,
      overrideAccess: true,
      req,
      data: {
        snapshot_before_each_scan: body.snapshot_before_each_scan,
        snapshot_interval_days: body.snapshot_interval_days,
        offline_after_hours: body.offline_after_hours,
      },
    })

    return json(updated)
  },
}
