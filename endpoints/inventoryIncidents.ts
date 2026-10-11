import type { Endpoint } from 'payload'
import { z } from 'zod'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope } from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import { actorRelation } from '@/lib/actor-relation'
import { lockAssetRow, transactionLock, withTransaction } from '@/domain/with-transaction'
import {
  assertOwnerCoversOffice,
  OwnerOutOfScopeError,
} from '@/access/tenant/assertOwnerCoversOffice'

export const ResolveInventoryIncidentSchema = z
  .object({ decision: z.enum(['move', 'keep', 'reviewed']) })
  .strict()

export const resolveInventoryIncidentEndpoint: Endpoint = {
  path: '/v1/inventory-incidents/:id/resolve',
  method: 'post',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx?.isActive) return Response.json({ error: 'unauthenticated' }, { status: 401 })
    if (!ctx.organizationId || !canDo(ctx.role, 'assets', 'update', ctx.organizationId))
      return Response.json({ error: 'forbidden' }, { status: 403 })
    const parsed = ResolveInventoryIncidentSchema.safeParse(await req.json?.())
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })
    return withTransaction(req.payload, req, async request => {
      await transactionLock(request, `inventory:${ctx.organizationId}`)
      const incident = await request.payload
        .findByID({
          collection: 'inventory-incidents',
          id: String(req.routeParams?.id),
          req: request,
          overrideAccess: true,
          depth: 0,
        })
        .catch(() => null)
      if (
        !incident ||
        relationId(incident.organization) !== ctx.organizationId ||
        (!hasOrgWideScope(ctx.role) &&
          [incident.office, incident.proposed_office]
            .filter(Boolean)
            .some(id => !ctx.officeIds.includes(relationId(id))))
      )
        return Response.json({ error: 'not_found' }, { status: 404 })
      if (incident.status !== 'pending')
        return Response.json({ error: 'already_resolved' }, { status: 409 })
      if (
        (incident.kind === 'location' && parsed.data.decision === 'reviewed') ||
        (incident.kind === 'identity' && parsed.data.decision !== 'reviewed')
      )
        return Response.json({ error: 'invalid_decision' }, { status: 400 })
      if (parsed.data.decision === 'move') {
        if (
          incident.kind !== 'location' ||
          !incident.asset ||
          !incident.proposed_office ||
          !incident.agent
        )
          return Response.json({ error: 'invalid_decision' }, { status: 400 })
        const id = relationId(incident.asset)
        await lockAssetRow(request, 'assets', id)
        const asset = await request.payload.findByID({
          collection: 'assets',
          id,
          req: request,
          overrideAccess: true,
          depth: 0,
        })
        if (
          asset.deleted_at ||
          asset.status === 'retired' ||
          relationId(asset.office) !== relationId(incident.office)
        )
          return Response.json(
            {
              error: 'asset_changed',
              message: 'El activo cambió. Actualiza la vista antes de decidir.',
            },
            { status: 409 }
          )
        const office = relationId(incident.proposed_office)
        const destination = await request.payload.findByID({
          collection: 'offices',
          id: office,
          req: request,
          overrideAccess: true,
          depth: 0,
        })
        if (!destination.is_active || relationId(destination.organization) !== ctx.organizationId)
          return Response.json({ error: 'invalid_office' }, { status: 409 })
        let owner = asset.owner
        if (owner) {
          try {
            await assertOwnerCoversOffice(request, relationId(owner), ctx.organizationId!, office)
          } catch (error) {
            if (!(error instanceof OwnerOutOfScopeError)) throw error
            owner = null
          }
        }
        // AUDIT: this action must emit an AuditLogs entry (chain_hash over {confirmed asset movement}, previous hash for this organization_id)
        // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
        await request.payload.update({
          collection: 'assets',
          id,
          req: request,
          overrideAccess: true,
          data: { office, agent: relationId(incident.agent), owner, location_pending: false },
        })
      } else if (incident.asset) {
        await request.payload.update({
          collection: 'assets',
          id: relationId(incident.asset),
          req: request,
          overrideAccess: true,
          data: { location_pending: false },
        })
      }
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {inventory conflict resolution}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      const doc = await request.payload.update({
        collection: 'inventory-incidents',
        id: incident.id,
        req: request,
        overrideAccess: true,
        data: {
          status:
            parsed.data.decision === 'move'
              ? 'moved'
              : parsed.data.decision === 'keep'
                ? 'kept'
                : 'reviewed',
          resolved_at: new Date().toISOString(),
          resolved_by: actorRelation(request, ctx.userId),
        },
      })
      return Response.json(doc)
    })
  },
}
