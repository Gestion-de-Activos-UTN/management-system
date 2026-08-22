import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'
import { assertOfficeInScope } from '../collections/NonNetworkAssets/invariants'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { createInventorySnapshot } from '../domain/inventories/createInventorySnapshot'
import { relationId } from '../lib/relationId'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Trigger manual de snapshot (RF-41). generated_by='scheduled'/'pre_audit' quedan reservados
// para cuando exista un disparador automático (ver endpoints/internalJobs.ts) — este endpoint
// siempre produce 'manual', asociado al usuario autenticado que lo pidió.
export const generateInventorySnapshotEndpoint: Endpoint = {
  path: '/v1/inventory-snapshots/generate',
  method: 'post',
  handler: async (req) => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!canDo(ctx.role, 'inventory-snapshots', 'create', ctx.organizationId)) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await req.json!().catch(() => ({}))
    const officeId = body?.office_id as string | undefined
    if (!officeId) return json({ error: 'office_id es requerido' }, 400)

    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    assertOfficeInScope(officeId, ctx.officeIds, unrestricted)

    // Defensa en profundidad: no confiar solo en officeIds (ver access/tenant/assertOrganizationMatches.ts)
    // — verificar la organización real de la oficina antes de generar un snapshot en su nombre.
    const office = await req.payload.findByID({
      collection: 'offices',
      id: officeId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    assertOrganizationMatches(relationId(office.organization), ctx.organizationId, unrestricted)

    const snapshot = await createInventorySnapshot(req.payload, officeId, {
      type: 'manual',
      userId: ctx.userId,
    })

    return json(snapshot, 201)
  },
}
