import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import { hasOrgWideScope, type RoleSlug } from '@/access/rbac/permissions'
import {
  lostCoverage,
  releaseMemberTasks,
  releaseOwnedAssets,
  sameCoverageInputs,
  type MemberCoverage,
} from '@/domain/organizations/member-responsibilities'
import { findActiveOffices } from '@/domain/offices/active-offices'

// Cuando una persona deja de cubrir oficinas (desactivación, cambio de oficinas o de rol, oficina
// desactivada, organización desactivada) sus activos quedan sin responsable y sus tareas en curso
// vuelven a pendientes. Vive acá y no en updateMember: deactivateOffice y la desactivación de la
// organización escriben la membership directo, y este hook corre en todas esas vías.
export const releaseMemberResponsibilities: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update' || !previousDoc || previousDoc.is_active !== true) return doc
  // Updates que no tocan la cobertura (p. ej. `status` de onboarding): no hay nada que liberar.
  if (sameCoverageInputs(previousDoc, doc)) return doc
  const organizationId = relationId(doc.organization)
  const userId = relationId(doc.user)
  // previousDoc llega con ids y doc puede llegar poblado: se normaliza todo con relationId.
  const roleIds = [...new Set([relationId(previousDoc.role), relationId(doc.role)])]
  const [roles, activeOffices] = await Promise.all([
    req.payload.find({
      collection: 'roles',
      where: { id: { in: roleIds } },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
    }),
    findActiveOffices(req.payload, organizationId, req),
  ])
  const slugById = new Map(roles.docs.map(role => [String(role.id), role.slug as RoleSlug]))
  const coverage = (membership: typeof doc): MemberCoverage => ({
    isActive: membership.is_active === true,
    orgWide: hasOrgWideScope(slugById.get(relationId(membership.role))),
    officeIds: (membership.offices ?? []).map(relationId),
  })
  const lost = lostCoverage(
    coverage(previousDoc),
    coverage(doc),
    activeOffices.map(office => String(office.id))
  )
  if (Array.isArray(lost) && !lost.length) return doc

  await releaseOwnedAssets(req, organizationId, userId, lost)
  await releaseMemberTasks(req, {
    organizationId,
    userId,
    offices: lost,
    reason: lost === 'all' ? 'member_deactivated' : 'office_access_removed',
  })
  return doc
}
