import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import { actorRelation } from '@/lib/actor-relation'
import { withTaskLock } from './with-task-lock'
import { assignmentEligibleMembers, listEligibleTaskMembers } from './task-eligibility'
import { resolveTaskReference } from './task-reference'

/** Asset transitions and task transitions share the same transaction. Terminal history stays fixed. */
export const reconcileAssetTasks: CollectionAfterChangeHook = async ({
  collection,
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update' || !previousDoc) return doc
  const moved = relationId(doc.office) !== relationId(previousDoc.office)
  const unavailable = doc.status === 'retired' || Boolean(doc.deleted_at)
  const assessmentChanged = [
    'confirmed_type',
    'asset_category',
    'identified',
    'identification_status',
    'assessment_scope',
    'assessment_excluded_until',
  ].some(key => doc[key] !== previousDoc[key])
  if (!moved && !unavailable && !assessmentChanged) return doc
  const assessments = await req.payload.find({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    sort: '-opened_at',
    where: {
      and: [
        { organization: { equals: relationId(doc.organization) } },
        { [collection.slug === 'assets' ? 'asset' : 'manual_asset']: { equals: doc.id } },
      ],
    },
  })
  const replacement = assessments.docs.find(
    row =>
      ['pending', 'in_progress'].includes(row.status) &&
      relationId(row.office) === relationId(doc.office)
  )
  const obsoleteIds = assessments.docs.filter(row => row.status === 'superseded').map(row => row.id)
  const result = await req.payload.find({
    collection: 'tasks',
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    where: {
      and: [
        {
          or: [
            {
              and: [
                { 'related_entity.relationTo': { equals: collection.slug } },
                { 'related_entity.value': { equals: doc.id } },
              ],
            },
            ...(obsoleteIds.length
              ? [
                  {
                    and: [
                      { 'related_entity.relationTo': { equals: 'assessment-instances' } },
                      { 'related_entity.value': { in: obsoleteIds } },
                    ],
                  },
                ]
              : []),
            ...(unavailable && assessments.docs.length
              ? [
                  {
                    and: [
                      { 'related_entity.relationTo': { equals: 'assessment-instances' } },
                      { 'related_entity.value': { in: assessments.docs.map(row => row.id) } },
                    ],
                  },
                ]
              : []),
          ],
        },
        { status: { in: ['pending', 'in_progress'] } },
      ],
    },
  })
  for (const candidate of result.docs.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    await withTaskLock(req, String(candidate.id), async () => {
      const task = await req.payload.findByID({
        collection: 'tasks',
        id: candidate.id,
        req,
        overrideAccess: true,
        depth: 0,
      })
      if (task.status === 'completed' || task.status === 'cancelled') return
      const assessmentTask = task.related_entity?.relationTo === 'assessment-instances'
      if (!assessmentTask && !moved && !unavailable) return
      const noReview = assessmentTask && !replacement
      const at = new Date().toISOString()
      const reason = unavailable
        ? doc.deleted_at
          ? 'Activo eliminado del inventario.'
          : 'Activo retirado.'
        : noReview
          ? 'La revisión de este activo ya no corresponde.'
          : assessmentTask
            ? 'Revisión de seguridad actualizada por un cambio del activo.'
            : 'Activo trasladado de oficina.'
      const event = {
        at,
        reason,
        previous_office: previousDoc.office ? relationId(previousDoc.office) : null,
        office: doc.office ? relationId(doc.office) : null,
        previous_claimant: task.claimed_by ?? null,
        ...(assessmentTask
          ? {
              previous_assessment: relationId(task.related_entity!.value),
              assessment: replacement?.id ?? null,
            }
          : {}),
      }
      const data: Record<string, unknown> = {
        lifecycle_history: [
          ...(Array.isArray(task.lifecycle_history) ? task.lifecycle_history : []),
          event,
        ],
      }
      if (unavailable || noReview)
        Object.assign(data, {
          status: 'cancelled',
          cancelled_at: at,
          cancelled_by: req.user ? actorRelation(req, String(req.user.id)) : null,
          cancellation_reason: reason,
          requires_reassignment: false,
        })
      else {
        const officeId = doc.office ? relationId(doc.office) : null
        const reference = await resolveTaskReference(req, {
          relationTo: assessmentTask
            ? 'assessment-instances'
            : (collection.slug as 'assets' | 'non-network-assets'),
          value: String(assessmentTask ? replacement!.id : doc.id),
        })
        const members = await listEligibleTaskMembers(
          req,
          relationId(task.organization),
          officeId,
          reference
        )
        const assignment = {
          assignment_kind: task.assignment_kind,
          assigned_role: task.assigned_role ? relationId(task.assigned_role) : undefined,
          assigned_user: task.assigned_user ? relationId(task.assigned_user) : undefined,
        }
        const eligible = assignmentEligibleMembers(members, assignment)
        const adminClaim = task.claimed_by?.relationTo === 'admins'
        const claimEligible =
          adminClaim || eligible.some(member => member.userId === relationId(task.claimed_by))
        Object.assign(data, { office: officeId, requires_reassignment: eligible.length === 0 })
        if (assessmentTask)
          data.related_entity = { relationTo: 'assessment-instances', value: replacement!.id }
        if (task.status === 'in_progress' && !claimEligible)
          Object.assign(data, { status: 'pending', claimed_by: null, claimed_at: null })
        if (task.assignment_kind === 'user' && !eligible.length) data.assigned_user = null
      }
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {asset transition, task transition}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {task managers and previous claimant}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      await req.payload.update({
        collection: 'tasks',
        id: task.id,
        req,
        overrideAccess: true,
        data,
      })
    })
  }
  return doc
}
