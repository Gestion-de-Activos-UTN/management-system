import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import {
  OrganizationMaturitySchema,
  OrganizationSettingsFormSchema,
} from '../modules/organization-settings/schema'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// OrganizationSettings.access es () => false en las 4 acciones a propósito (solo la creación de
// org escribe el doc inicial, ver domain/organizations/createOrgWithAdmin.ts). Estos dos
// endpoints son el único otro punto de lectura/escritura, acotados a los campos de config de
// Inventario (snapshot_before_each_scan/snapshot_interval_days). La política de assessments
// tendrá su endpoint dedicado; no se modifica desde este comando genérico de settings.
// El portal ya oculta /admin a quien no es org_admin (client-side, ver admin/layout.tsx) — acá se
// repite la validación server-side, que es la que realmente cuenta.
type LoadResult =
  { ok: false; response: Response } | { ok: true; doc: { id: string | number }; userId: string }

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

  return { ok: true, doc, userId: ctx.userId }
}

export const organizationSettingsGetEndpoint: Endpoint = {
  path: '/v1/organization-settings',
  method: 'get',
  handler: async req => {
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
  handler: async req => {
    const loaded = await loadSettings(req)
    if (!loaded.ok) return loaded.response

    const parsed = OrganizationSettingsFormSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_settings', issues: parsed.error.issues }, 400)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organization settings: offline_after_hours, snapshot_before_each_scan, snapshot_interval_days}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const updated = await req.payload.update({
      collection: 'organization-settings',
      id: loaded.doc.id,
      overrideAccess: true,
      req,
      // Relations stay as ids: the response must not embed user documents.
      depth: 0,
      data: parsed.data,
    })

    return json(updated)
  },
}

// Maturity profile: business context for remediation advice, editable only by org_admin
// (loadSettings). It is kept out of the generic settings command so it records who answered.
export const organizationMaturityUpdateEndpoint: Endpoint = {
  path: '/v1/organization-settings/maturity',
  method: 'patch',
  handler: async req => {
    const loaded = await loadSettings(req)
    if (!loaded.ok) return loaded.response
    const parsed = OrganizationMaturitySchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_maturity', issues: parsed.error.issues }, 400)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {maturity_it_owner, maturity_security_budget}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const updated = await req.payload.update({
      collection: 'organization-settings',
      id: loaded.doc.id,
      overrideAccess: true,
      req,
      // Relations stay as ids: the response must not embed user documents.
      depth: 0,
      data: {
        ...parsed.data,
        maturity_updated_at: new Date().toISOString(),
        maturity_updated_by: loaded.userId,
      },
    })
    return json(updated)
  },
}
