import {
  APIError,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeChangeHook,
  type Endpoint,
} from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope } from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import { withTransaction, lockAssetRow } from '@/domain/with-transaction'
import { organizationWriteError } from '@/domain/organizations/admin-actions'

export const rejectPhysicalAssetDelete: CollectionBeforeDeleteHook = () => {
  throw new APIError('Los activos se eliminan lógicamente para conservar su historial.', 409)
}

export const preserveDeletedAsset: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (
    originalDoc?.deleted_at &&
    ((data.status !== undefined && data.status !== 'retired') ||
      (data.deleted_at !== undefined && data.deleted_at !== originalDoc.deleted_at))
  )
    throw new APIError('Un activo eliminado conserva su baja y su historial.', 409)
  return data
}

export function logicalDeleteEndpoint(collection: 'assets' | 'non-network-assets'): Endpoint {
  return {
    path: '/:id',
    method: 'delete',
    handler: async req => {
      const ctx = await getTenantContext(req)
      if (!ctx?.isActive) return Response.json({ error: 'unauthenticated' }, { status: 401 })
      if (!ctx.organizationId || !canDo(ctx.role, collection, 'delete', ctx.organizationId))
        return Response.json({ error: 'forbidden' }, { status: 403 })
      const id = String(req.routeParams?.id ?? '')
      return withTransaction(req.payload, req, async request => {
        await lockAssetRow(request, collection, id)
        const asset = await request.payload
          .findByID({ collection, id, req: request, depth: 0, overrideAccess: true })
          .catch(() => null)
        if (
          !asset ||
          relationId(asset.organization) !== ctx.organizationId ||
          (!hasOrgWideScope(ctx.role) && !ctx.officeIds.includes(relationId(asset.office)))
        )
          return Response.json({ error: 'not_found' }, { status: 404 })
        const denied = await organizationWriteError(request, relationId(asset.organization))
        if (denied) return denied
        if (asset.deleted_at)
          return Response.json({
            doc: asset,
            message: 'Activo eliminado del inventario; historial conservado.',
          })
        // AUDIT: this action must emit an AuditLogs entry (chain_hash over {logical asset deletion}, previous hash for this organization_id)
        // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
        const deleted = await request.payload.update({
          collection,
          id,
          req: request,
          overrideAccess: true,
          data: { status: 'retired', deleted_at: new Date().toISOString() },
        })
        return Response.json({
          doc: deleted,
          message: 'Activo eliminado del inventario; historial conservado.',
        })
      })
    },
  }
}
