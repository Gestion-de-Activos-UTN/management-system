import type { PayloadRequest } from 'payload'
import { hasOrgWideScope, type RoleSlug } from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import type { CreateTasksInput, ReassignTaskInput } from '@/modules/tasks/schema'
import type { ResolvedTaskReference } from './task-reference'
import { roleCanReadTaskReference } from './task-reference'
import { TaskDomainError } from './task-error'

type Assignment = Pick<
  CreateTasksInput | ReassignTaskInput,
  'assignment_kind' | 'assigned_role' | 'assigned_user'
>

export type EligibleMember = {
  userId: string
  name: string
  email: string
  roleId: string
  role: RoleSlug
  officeIds: string[]
}

export async function listEligibleTaskMembers(
  req: PayloadRequest,
  organizationId: string,
  officeId: string | null,
  reference?: ResolvedTaskReference
): Promise<EligibleMember[]> {
  const memberships = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      and: [
        { organization: { equals: organizationId } },
        { is_active: { equals: true } },
        { status: { equals: 'active' } },
      ],
    },
    overrideAccess: true,
    req,
    depth: 2,
    limit: 1000,
  })

  return memberships.docs.flatMap(membership => {
    const roleDoc = membership.role as unknown as { id: string; slug: RoleSlug }
    const userDoc = membership.user as unknown as {
      id: string
      name: string
      email: string
      status?: string
    }
    const officeIds = (membership.offices ?? []).map(relationId)
    if (!roleDoc?.slug || !userDoc?.id || userDoc.status === 'inactive') return []
    if (officeId && !hasOrgWideScope(roleDoc.slug) && !officeIds.includes(officeId)) return []
    // Una tarea global sin entidad pertenece al pool de toda la organización. Si referencia
    // una entidad organizacional, en cambio, el permiso de esa entidad decide quién entra.
    if (!officeId && reference && !hasOrgWideScope(roleDoc.slug)) return []
    if (
      reference &&
      !roleCanReadTaskReference(roleDoc.slug, organizationId, officeIds, reference)
    ) {
      return []
    }
    return [
      {
        userId: String(userDoc.id),
        name: userDoc.name,
        email: userDoc.email,
        roleId: String(roleDoc.id),
        role: roleDoc.slug,
        officeIds,
      },
    ]
  })
}

export function assignmentEligibleMembers(
  members: EligibleMember[],
  assignment: Assignment
): EligibleMember[] {
  if (assignment.assignment_kind === 'open_pool') return members
  if (assignment.assignment_kind === 'role') {
    return members.filter(member => member.roleId === assignment.assigned_role)
  }
  return members.filter(member => member.userId === assignment.assigned_user)
}

export async function assertTaskAssignmentHasEligibleMember(
  req: PayloadRequest,
  organizationId: string,
  officeId: string | null,
  assignment: Assignment,
  reference?: ResolvedTaskReference
): Promise<EligibleMember[]> {
  const members = assignmentEligibleMembers(
    await listEligibleTaskMembers(req, organizationId, officeId, reference),
    assignment
  )
  if (!members.length) {
    throw new TaskDomainError(
      'no_eligible_assignees',
      400,
      'La asignación no tiene miembros elegibles para el alcance y la entidad seleccionados.'
    )
  }
  return members
}
