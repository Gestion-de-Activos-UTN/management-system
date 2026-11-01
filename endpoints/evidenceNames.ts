import type { Endpoint, PayloadRequest } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'
import { assertOfficeInScope } from '../collections/NonNetworkAssets/invariants'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { relationId } from '../lib/relationId'
import { EvidenceNameSchema } from '../modules/scan-reports/schema'
import { organizationWriteError } from '@/domain/organizations/admin-actions'

const json = (body: unknown, status = 200) => Response.json(body, { status })

type EvidenceCollection = 'scan-reports' | 'inventory-snapshots'

// Informes de escaneo e instantáneas son evidencia inmutable (update: () => false en la
// colección). La única escritura permitida es su nombre visible, por este endpoint.
function renameEndpoint(collection: EvidenceCollection, path: string): Endpoint {
  return {
    path,
    method: 'patch',
    handler: async (req: PayloadRequest) => {
      const ctx = await getTenantContext(req)
      if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
      // A visited organization uses its effective tenant permissions.
      if (!ctx.organizationId || !canDo(ctx.role, collection, 'update', ctx.organizationId)) {
        return json({ error: 'forbidden' }, 403)
      }

      const body = EvidenceNameSchema.safeParse(await req.json?.().catch(() => null))
      if (!body.success) return json({ error: 'invalid_body' }, 400)

      const id = req.routeParams?.id as string
      const existing = await req.payload
        .findByID({ collection, id, overrideAccess: true, req, depth: 0 })
        .catch(() => null)
      if (!existing) return json({ error: 'not_found' }, 404)

      // Scoping de fila además de RBAC (SYSTEM_PROMPT §7): la oficina del documento tiene que
      // estar entre las del actor, y su organización tiene que ser la del actor.
      const officeId = relationId(existing.office)
      assertOfficeInScope(officeId, ctx.officeIds, false)
      const office = await req.payload.findByID({
        collection: 'offices',
        id: officeId,
        overrideAccess: true,
        req,
        depth: 0,
      })
      assertOrganizationMatches(relationId(office.organization), ctx.organizationId, false)
      const denied = await organizationWriteError(req, relationId(office.organization))
      if (denied) return denied

      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {collection, id, display_name}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      const updated = await req.payload.update({
        collection,
        id,
        overrideAccess: true,
        req,
        data: { display_name: body.data.display_name },
      })
      return json({ id: updated.id, display_name: updated.display_name ?? null })
    },
  }
}

export const scanReportNameEndpoint = renameEndpoint('scan-reports', '/v1/scan-reports/:id/name')
export const inventorySnapshotNameEndpoint = renameEndpoint(
  'inventory-snapshots',
  '/v1/inventory-snapshots/:id/name'
)
