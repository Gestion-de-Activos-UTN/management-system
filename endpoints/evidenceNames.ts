import type { Endpoint, PayloadRequest } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { getTenantContext, type TenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'
import { assertOfficeInScope } from '../collections/NonNetworkAssets/invariants'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { relationId } from '../lib/relationId'
import { EvidenceNameSchema } from '../modules/scan-reports/schema'
import { organizationWriteError } from '@/domain/organizations/admin-actions'
import { withTransaction } from '@/domain/with-transaction'
import { transactionDb } from '@/domain/transaction-locks'
import { addAuditEvent, type AuditActor } from '@/domain/audit/builder'
import { requestNetwork } from '@/domain/audit/network-context'

const json = (body: unknown, status = 200) => Response.json(body, { status })

type EvidenceCollection = 'scan-reports' | 'inventory-snapshots'

// AuditLog A095 (primer evento real, F1b): un renombre emite scan.rename o snapshot.rename en la
// misma transacción que el cambio, con el nombre anterior y el nuevo. Ficha de la acción:
// - entidad: el reporte o la instantánea (id; etiqueta histórica = display_name);
// - alcance: la organización y la oficina del documento;
// - autor: la persona con su rol, o el PlatformAdmin con su rol real (visit_id llega en F10);
// - campos: display_name antes y después ({state: 'value' | 'null'}); sin cambio real, sin evento;
// - red: requestNetwork (hoy `unknown`: no hay proxy delante).
const AUDIT = {
  'scan-reports': { action: 'scan.rename', entity: 'scan_report', table: 'scan_reports' },
  'inventory-snapshots': {
    action: 'snapshot.rename',
    entity: 'inventory_snapshot',
    table: 'inventory_snapshots',
  },
} as const

function auditActor(ctx: TenantContext): AuditActor {
  if (ctx.isPlatformAdmin) return { type: 'platform_admin', id: ctx.userId, role: 'platform_admin' }
  // canDo ya rechazó un rol nulo; si faltara, no se inventa uno para el evento.
  if (!ctx.role) throw new Error('AuditLog: la persona no tiene rol en el contexto.')
  return { type: 'user', id: ctx.userId, role: ctx.role }
}

const nameState = (value: string | null) =>
  value === null ? { state: 'null' as const } : { state: 'value' as const, value }

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
      // Lectura del estado anterior, controles y escritura en una sola transacción, con la fila
      // bloqueada: el "antes" del evento es el que reemplaza esta escritura (02 §4).
      return withTransaction(req.payload, req, async txReq => {
        const found = await txReq.payload
          .findByID({ collection, id, overrideAccess: true, req: txReq, depth: 0 })
          .catch(() => null)
        if (!found) return json({ error: 'not_found' }, 404)
        await (
          await transactionDb(txReq)
        ).execute(
          sql`SELECT id FROM ${sql.identifier(AUDIT[collection].table)} WHERE id = ${id} FOR UPDATE`
        )
        const existing = await txReq.payload.findByID({
          collection,
          id,
          overrideAccess: true,
          req: txReq,
          depth: 0,
        })

        // Scoping de fila además de RBAC (SYSTEM_PROMPT §7): la oficina del documento tiene que
        // estar entre las del actor, y su organización tiene que ser la del actor.
        const officeId = relationId(existing.office)
        assertOfficeInScope(officeId, ctx.officeIds, false)
        const office = await txReq.payload.findByID({
          collection: 'offices',
          id: officeId,
          overrideAccess: true,
          req: txReq,
          depth: 0,
        })
        const organizationId = relationId(office.organization)
        assertOrganizationMatches(organizationId, ctx.organizationId, false)
        const denied = await organizationWriteError(txReq, organizationId)
        if (denied) return denied

        const before = existing.display_name ?? null
        const after = body.data.display_name
        // Sin cambio real no hay escritura ni evento.
        if (before === after) return json({ id: existing.id, display_name: before })

        const updated = await txReq.payload.update({
          collection,
          id,
          overrideAccess: true,
          req: txReq,
          data: { display_name: after },
        })
        await addAuditEvent(txReq, {
          action: AUDIT[collection].action,
          scope: { kind: 'organization', organizationId, officeIds: [officeId] },
          entity: { type: AUDIT[collection].entity, id: String(existing.id) },
          actor: auditActor(ctx),
          origin: 'interactive',
          payload: {
            entity_snapshot: { label: after ?? before },
            changes: [
              { field: 'display_name', before: nameState(before), after: nameState(after) },
            ],
          },
          network: requestNetwork(req),
        })
        return json({ id: updated.id, display_name: updated.display_name ?? null })
      })
    },
  }
}

export const scanReportNameEndpoint = renameEndpoint('scan-reports', '/v1/scan-reports/:id/name')
export const inventorySnapshotNameEndpoint = renameEndpoint(
  'inventory-snapshots',
  '/v1/inventory-snapshots/:id/name'
)
