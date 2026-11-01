import type { StatusTone } from '@/components/ui/StatusBadge'
import type { TaskDTO } from './service'
import { CLAIM_RELEASE_REASON_LABEL, TASK_STATUS_TONES } from './task-labels'

export type ActivityEvent = {
  label: string
  at: string
  actor?: string | null
  note?: string | null
  /** Sólo los cierres (completada, cancelada, archivada): la actividad los resalta con su color. */
  tone?: StatusTone
}

/** Todo lo que le pasó a la tarea, del más reciente al más antiguo (incluye cambios del activo). */
export function taskActivity(
  task: Pick<
    TaskDTO,
    | 'actor_labels'
    | 'createdAt'
    | 'completed_at'
    | 'completion_reason'
    | 'cancelled_at'
    | 'cancellation_reason'
    | 'archived_at'
    | 'lifecycle_history'
  >
): ActivityEvent[] {
  const labels = task.actor_labels
  const claimEvents = labels?.claim_events ?? []
  const reassignmentPairs = new Set<number>()
  claimEvents.forEach((event, index) => {
    const previous = claimEvents[index - 1]
    if (
      event.action === 'reassigned' &&
      previous?.action === 'released' &&
      previous.reason === 'task_reassigned' &&
      previous.at === event.at &&
      previous.actor === event.actor
    )
      reassignmentPairs.add(index)
  })
  const events: Array<ActivityEvent | null> = [
    { label: 'Creada', at: task.createdAt, actor: labels?.created_by },
    ...claimEvents.map((event, index) =>
      reassignmentPairs.has(index + 1)
        ? null
        : {
            label:
              event.action === 'reassigned'
                ? 'Reasignada'
                : event.action === 'claimed'
                  ? 'Reclamada'
                  : event.reason === 'task_reassigned'
                    ? 'Liberada por reasignación'
                    : 'Liberada',
            at: event.at,
            actor: event.actor,
            note: reassignmentPairs.has(index)
              ? 'Se liberó el reclamo anterior.'
              : event.reason
                ? CLAIM_RELEASE_REASON_LABEL[event.reason]
                : null,
          }
    ),
    ...(labels?.edit_events ?? []).map(event => ({
      label: 'Modificada',
      at: event.at,
      actor: event.actor,
      note: event.replanned ? 'Volvió a pendiente: se liberó el reclamo.' : null,
    })),
    task.completed_at
      ? {
          label: 'Completada',
          at: task.completed_at,
          tone: TASK_STATUS_TONES.completed,
          actor: labels?.completed_by,
          note: task.completion_reason
            ? `Motivo de finalización forzada: ${task.completion_reason}`
            : null,
        }
      : null,
    task.cancelled_at
      ? {
          label: 'Cancelada',
          at: task.cancelled_at,
          tone: TASK_STATUS_TONES.cancelled,
          actor: labels?.cancelled_by,
          note: task.cancellation_reason ? `Motivo: ${task.cancellation_reason}` : null,
        }
      : null,
    task.archived_at
      ? {
          label: 'Archivada',
          at: task.archived_at,
          actor: labels?.archived_by,
          tone: 'neutral' as const,
        }
      : null,
    ...(Array.isArray(task.lifecycle_history) ? task.lifecycle_history : []).map(event =>
      event && typeof event === 'object' && 'reason' in event && 'at' in event
        ? { label: String(event.reason), at: String(event.at), actor: 'Cambio en el activo' }
        : null
    ),
  ]
  return events
    .filter((event): event is ActivityEvent => event !== null)
    .map((event, order) => ({ event, order }))
    .sort(
      (left, right) =>
        Date.parse(right.event.at) - Date.parse(left.event.at) || right.order - left.order
    )
    .map(({ event }) => event)
}
