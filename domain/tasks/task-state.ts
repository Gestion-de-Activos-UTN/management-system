export const TASK_PERSISTED_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const

export type TaskPersistedStatus = (typeof TASK_PERSISTED_STATUSES)[number]
export type TaskEffectiveStatus = TaskPersistedStatus | 'planned'

export type TaskStateFields = {
  status?: string | null
  start_at?: string | null
  due_at?: string | null
  completed_at?: string | null
}

export function effectiveTaskStatus(task: TaskStateFields, now = new Date()): TaskEffectiveStatus {
  const status = (task.status ?? 'pending') as TaskPersistedStatus
  if (status === 'pending' && task.start_at && Date.parse(task.start_at) > now.getTime()) {
    return 'planned'
  }
  return status
}

export function isTaskOverdue(task: TaskStateFields, now = new Date()): boolean {
  if (!task.due_at || task.status === 'completed' || task.status === 'cancelled') return false
  return Date.parse(task.due_at) < now.getTime()
}

export function wasTaskCompletedLate(task: TaskStateFields): boolean {
  if (!task.due_at || !task.completed_at) return false
  return Date.parse(task.completed_at) > Date.parse(task.due_at)
}

export function assertTaskEditable(status: string | null | undefined): void {
  if (status === 'completed' || status === 'cancelled') {
    throw new Error('La tarea es terminal y no puede modificarse.')
  }
}

export function assertTaskCanStart(task: TaskStateFields, now = new Date()): void {
  if (task.status !== 'pending') throw new Error('La tarea no está pendiente.')
  if (task.start_at && Date.parse(task.start_at) > now.getTime()) {
    throw new Error('La tarea todavía está planificada.')
  }
}
