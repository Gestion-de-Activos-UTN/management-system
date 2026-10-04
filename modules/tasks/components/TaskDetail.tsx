'use client'

import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@mantine/core'
import { Archive, Check, Hand, Pencil, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatDateTime } from '@/lib/format-date'
import { relationId } from '@/lib/relationId'
import type { ReassignTaskInput } from '../schema'
import type { TaskAction, TaskDTO } from '../service'
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from '../task-labels'
import { getTaskReferenceHref } from '../task-reference-link'
import { useTaskCommand } from '../hooks/use-task-actions'
import { useTaskAssignmentOptions } from '../hooks/use-task-options'
import { TaskEditForm } from './TaskEditForm'
import { TaskAssignmentFields, type TaskAssignmentKind } from './TaskAssignmentFields'
import { TaskReferenceSummary } from './TaskReferenceSummary'

export function TaskDetail({ task, asOrganization }: { task: TaskDTO; asOrganization?: string }) {
  const command = useTaskCommand(task.id)
  const [editOpened, setEditOpened] = useState(false)
  const [reassignOpened, setReassignOpened] = useState(false)
  const [cancelOpened, setCancelOpened] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [assignmentKind, setAssignmentKind] = useState<TaskAssignmentKind>('open_pool')
  const [assignmentTarget, setAssignmentTarget] = useState<string | null>(null)
  const reference = task.related_entity_info
    ? { relationTo: task.related_entity_info.relationTo, value: task.related_entity_info.value }
    : undefined
  const assignmentOptions = useTaskAssignmentOptions(
    task.office ? [relationId(task.office)] : [],
    reference,
    asOrganization
  )
  const referenceHref = task.related_entity_info
    ? getTaskReferenceHref(task.related_entity_info, asOrganization)
    : null
  const has = (action: TaskAction) => task.available_actions.includes(action)
  const run = (action: TaskAction, payload?: unknown) => command.mutate({ action, payload })

  const reassign = () => {
    const payload: ReassignTaskInput =
      assignmentKind === 'role'
        ? { assignment_kind: 'role', assigned_role: assignmentTarget! }
        : assignmentKind === 'user'
          ? { assignment_kind: 'user', assigned_user: assignmentTarget! }
          : { assignment_kind: 'open_pool' }
    run('reassign', payload)
    setReassignOpened(false)
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={700} fz="xl">
            {task.title}
          </Text>
          <Text c="dimmed" size="sm">
            Creada {formatDateTime(task.createdAt)}
          </Text>
        </div>
        <Group gap="xs">
          <StatusBadge
            tone={TASK_STATUS_TONES[task.effective_status]}
            label={TASK_STATUS_LABELS[task.effective_status]}
          />
          {task.archived_at && (
            <Badge color="gray" variant="outline">
              Archivada
            </Badge>
          )}
        </Group>
      </Group>
      {task.is_overdue && (
        <Alert color="red">
          La tarea está vencida, pero todavía puede reclamarse y completarse.
        </Alert>
      )}
      {task.requires_reassignment && (
        <Alert color="orange">
          La asignación actual ya no tiene personas elegibles. Reasigna la tarea.
        </Alert>
      )}
      <Card withBorder padding="lg">
        <Stack gap="md">
          <Text style={{ whiteSpace: 'pre-wrap' }}>{task.description || 'Sin descripción.'}</Text>
          <Divider />
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <div>
              <Text size="xs" c="dimmed">
                Prioridad
              </Text>
              <Text>{TASK_PRIORITY_LABELS[task.priority]}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Inicio
              </Text>
              <Text>{formatDate(task.start_at)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Vencimiento
              </Text>
              <Text>{task.due_at ? formatDate(task.due_at) : 'Sin vencimiento'}</Text>
            </div>
          </SimpleGrid>
          {task.related_entity_info && (
            <TaskReferenceSummary
              relationTo={task.related_entity_info.relationTo}
              label={task.related_entity_info.label}
              href={referenceHref}
            />
          )}
        </Stack>
      </Card>
      <Group justify="flex-end">
        {has('edit') && (
          <Button
            variant="default"
            leftSection={<Pencil size={16} strokeWidth={1.5} />}
            onClick={() => setEditOpened(true)}
          >
            Editar
          </Button>
        )}
        {has('claim') && (
          <Button
            leftSection={<Hand size={16} strokeWidth={1.5} />}
            loading={command.isPending}
            onClick={() => run('claim')}
          >
            Reclamar
          </Button>
        )}
        {has('release') && (
          <Button
            variant="light"
            leftSection={<RotateCcw size={16} strokeWidth={1.5} />}
            loading={command.isPending}
            onClick={() => run('release')}
          >
            Liberar tarea
          </Button>
        )}
        {has('reassign') && (
          <Button variant="light" onClick={() => setReassignOpened(true)}>
            Reasignar
          </Button>
        )}
        {has('complete') && (
          <Button
            color="green"
            leftSection={<Check size={16} strokeWidth={1.5} />}
            loading={command.isPending}
            onClick={() => run('complete')}
          >
            Completar
          </Button>
        )}
        {has('cancel') && (
          <Button
            color="red"
            variant="light"
            leftSection={<XCircle size={16} strokeWidth={1.5} />}
            onClick={() => setCancelOpened(true)}
          >
            Cancelar tarea
          </Button>
        )}
        {has('archive') && (
          <Button
            variant="light"
            leftSection={<Archive size={16} strokeWidth={1.5} />}
            loading={command.isPending}
            onClick={() => run('archive')}
          >
            Archivar
          </Button>
        )}
        {has('delete') && (
          <Button
            color="red"
            variant="subtle"
            leftSection={<Trash2 size={16} strokeWidth={1.5} />}
            loading={command.isPending}
            onClick={() => window.confirm('¿Eliminar esta tarea pendiente?') && run('delete')}
          >
            Eliminar
          </Button>
        )}
      </Group>

      <Modal
        opened={editOpened}
        onClose={() => setEditOpened(false)}
        title="Editar tarea"
        size="lg"
      >
        <TaskEditForm task={task} onSaved={() => setEditOpened(false)} />
      </Modal>
      <Modal
        opened={reassignOpened}
        onClose={() => setReassignOpened(false)}
        title="Reasignar tarea"
        size="lg"
      >
        <Stack>
          <TaskAssignmentFields
            kind={assignmentKind}
            target={assignmentTarget}
            options={assignmentOptions.data}
            onKindChange={kind => {
              setAssignmentKind(kind)
              setAssignmentTarget(null)
            }}
            onTargetChange={setAssignmentTarget}
          />
          <Group justify="flex-end">
            <Button
              onClick={reassign}
              disabled={assignmentKind !== 'open_pool' && !assignmentTarget}
            >
              Reasignar
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={cancelOpened} onClose={() => setCancelOpened(false)} title="Cancelar tarea">
        <Stack>
          <Textarea
            label="Motivo"
            required
            minLength={3}
            maxLength={500}
            value={cancelReason}
            onChange={event => setCancelReason(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              color="red"
              disabled={cancelReason.trim().length < 3}
              onClick={() => {
                run('cancel', cancelReason)
                setCancelOpened(false)
              }}
            >
              Cancelar tarea
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
