import type { Task } from '@/app/types/payload-types'
import { httpClient } from '@/lib/http-client'
import type {
  CreateTasksInput,
  EditTaskInput,
  ReassignTaskInput,
  TaskReferenceInput,
} from './schema'

export type TaskAction =
  'edit' | 'claim' | 'release' | 'reassign' | 'complete' | 'cancel' | 'archive' | 'delete'

export type TaskReferenceInfo = TaskReferenceInput & {
  available: boolean
  label: string | null
  office_id: string | null
}

export type TaskDTO = Task & {
  effective_status: 'planned' | 'pending' | 'in_progress' | 'completed' | 'cancelled'
  related_entity_info: TaskReferenceInfo | null
  available_actions: TaskAction[]
  requires_reassignment: boolean
}

export type TaskReferenceOption = TaskReferenceInput & {
  label: string
  office_id: string | null
}

export type TaskAssignmentOptions = {
  users: Array<{ id: string; name: string; email: string; role_id: string; role: string }>
  roles: Array<{ id: string; slug: string }>
}

export function listTasks(params: {
  view: 'mine' | 'pool' | 'all'
  status?: string
  priority?: string
  officeId?: string | null
  includeArchived?: boolean
  asOrganization?: string
}) {
  return httpClient
    .get<{ docs: TaskDTO[] }>('/api/v1/tasks', {
      view: params.view,
      status: params.status,
      priority: params.priority,
      office_id: params.officeId ?? undefined,
      include_archived: params.includeArchived ? 'true' : undefined,
      asOrganization: params.asOrganization,
    })
    .then(response => response.docs)
}

export function getTask(id: string, asOrganization?: string) {
  return httpClient.get<TaskDTO>(`/api/v1/tasks/${id}`, { asOrganization })
}

export function createTasks(input: CreateTasksInput) {
  return httpClient.post<{ docs: TaskDTO[]; totalDocs: number }>('/api/v1/tasks', input)
}

export function editTask(id: string, input: EditTaskInput) {
  return httpClient.patch<TaskDTO>(`/api/v1/tasks/${id}`, input)
}

export function taskCommand(
  id: string,
  action: Exclude<TaskAction, 'edit' | 'reassign' | 'cancel' | 'delete'>
) {
  return httpClient.post<TaskDTO>(`/api/v1/tasks/${id}/${action}`, {})
}

export function reassignTask(id: string, input: ReassignTaskInput) {
  return httpClient.post<TaskDTO>(`/api/v1/tasks/${id}/reassign`, input)
}

export function cancelTask(id: string, reason: string) {
  return httpClient.post<TaskDTO>(`/api/v1/tasks/${id}/cancel`, { reason })
}

export function deleteTask(id: string) {
  return httpClient.delete<TaskDTO>(`/api/v1/tasks/${id}`)
}

export function listTaskReferenceOptions(params: {
  type: TaskReferenceInput['relationTo']
  officeId?: string | null
  asOrganization?: string
  id?: string
}) {
  return httpClient
    .get<{ docs: TaskReferenceOption[] }>('/api/v1/tasks/reference-options', {
      type: params.type,
      office_id: params.officeId ?? undefined,
      asOrganization: params.asOrganization,
      id: params.id,
    })
    .then(response => response.docs)
}

export function getTaskAssignmentOptions(params: {
  officeIds: string[]
  reference?: TaskReferenceInput
  asOrganization?: string
}) {
  return httpClient.get<TaskAssignmentOptions>('/api/v1/tasks/assignment-options', {
    office_ids: params.officeIds.length ? params.officeIds.join(',') : undefined,
    reference_type: params.reference?.relationTo,
    reference_id: params.reference?.value,
    asOrganization: params.asOrganization,
  })
}
