import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import { hasOrgWideScope, type RoleSlug } from '@/access/rbac/permissions'
import {
  lostCoverage,
  releaseOwnedAssets,
  type MemberCoverage,
} from '@/domain/organizations/member-responsibilities'
import { releaseClaimedTasks } from '@/domain/tasks/task-actions'

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
    req.payload.find({
      collection: 'offices',
      where: {
        and: [{ organization: { equals: organizationId } }, { is_active: { equals: true } }],
      },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
      select: {},
    }),
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
    activeOffices.docs.map(office => String(office.id))
  )
  if (Array.isArray(lost) && !lost.length) return doc

  await releaseOwnedAssets(req, organizationId, userId, lost)
  await releaseClaimedTasks(
    req,
    organizationId,
    userId,
    lost,
    lost === 'all' ? 'member_deactivated' : 'office_access_removed'
  )
  return doc
}
