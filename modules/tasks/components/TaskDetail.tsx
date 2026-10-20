'use client'

import { textRuleError } from '@/lib/text-rules'
import { useState, type CSSProperties } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Timeline,
} from '@mantine/core'
import { CharacterCountTextarea } from '@/components/ui/CharacterCountTextarea'
import { Archive, Check, Hand, Pencil, RotateCcw, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { STATUS_TONE_COLOR, StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatDateTime } from '@/lib/format-date'
import { relationId } from '@/lib/relationId'
import type { ReassignTaskInput } from '../schema'
import type { TaskAction, TaskDTO } from '../service'
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from '../task-labels'
import { getTaskReferenceHref, getTaskCurrentReferenceHref } from '../task-reference-link'
import { useTaskCommand } from '../hooks/use-task-actions'
import { useTaskAssignmentOptions } from '../hooks/use-task-options'
import { TaskEditForm } from './TaskEditForm'
import { TaskAssignmentFields, type TaskAssignmentKind } from './TaskAssignmentFields'
import { TaskReferenceSummary } from './TaskReferenceSummary'
import { taskActivity } from '../task-activity'

export function TaskDetail({ task, asOrganization }: { task: TaskDTO; asOrganization?: string }) {
  const command = useTaskCommand(task.id)
  const [editOpened, setEditOpened] = useState(false)
  const [reassignOpened, setReassignOpened] = useState(false)
  const [cancelOpened, setCancelOpened] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [forceCompleteOpened, setForceCompleteOpened] = useState(false)
  const [forceCompleteReason, setForceCompleteReason] = useState('')
  const [assignmentKind, setAssignmentKind] = useState<TaskAssignmentKind>('open_pool')
  const [assignmentTarget, setAssignmentTarget] = useState<string | null>(null)
  const reference = task.related_entity_info
    ? { relationTo: task.related_entity_info.relationTo, value: task.related_entity_info.value }
    : undefined
  const assignmentOptions = useTaskAssignmentOptions(
    task.office ? [relationId(task.office)] : [],
    reference,
    asOrganization,
    { taskId: task.id, enabled: reassignOpened && task.available_actions.includes('reassign') }
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

  const activity = taskActivity(task)

  return (
    <Stack gap="md">
      <div>
        <Group gap="sm" wrap="wrap">
          <Text fw={700} fz="xl">
            {task.title}
          </Text>
          <StatusBadge
            tone={TASK_STATUS_TONES[task.effective_status]}
            label={TASK_STATUS_LABELS[task.effective_status]}
          />
          {task.archived_at && (
            <StatusBadge
              tone="neutral"
              label="Archivada"
              icon={<Archive size={13} strokeWidth={1.5} />}
              iconOnly
              size="xs"
            />
          )}
        </Group>
        <Text c="dimmed" size="sm">
          Creada por {task.actor_labels?.created_by ?? 'Usuario no disponible'} ·{' '}
          {formatDateTime(task.createdAt)}
        </Text>
      </div>
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
      {/* Una sola superficie: descripción, datos, referencia y actividad separados por líneas. */}
      <Card withBorder padding="lg">
        <Stack gap="md">
          <Text style={{ whiteSpace: 'pre-wrap' }}>{task.description || 'Sin descripción.'}</Text>
          <SimpleGrid cols={{ base: 1, xs: 3 }}>
            <Fact label="Prioridad" value={TASK_PRIORITY_LABELS[task.priority]} />
            <Fact label="Inicio" value={formatDate(task.start_at)} />
            <Fact
              label="Vencimiento"
              value={task.due_at ? formatDate(task.due_at) : 'Sin vencimiento'}
            />
          </SimpleGrid>
          {task.related_entity_info && (
            <TaskReferenceSummary
              relationTo={task.related_entity_info.relationTo}
              label={task.related_entity_info.label}
              href={referenceHref}
              currentHref={getTaskCurrentReferenceHref(task.related_entity_info, asOrganization)}
            />
          )}
          <Divider />
          <Text fw={700} size="sm">
            Actividad
          </Text>
          {/* Reclamar y liberar pueden repetirse: la actividad tiene su propio scroll. */}
          <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>
            {/* Círculo y línea pares (18/4): el centro de ambos cae en un píxel entero y no se
                desalinean al redondear con zoom. */}
            <Timeline
              active={activity.length - 1}
              bulletSize={18}
              lineWidth={4}
              color="pine"
              className="task-activity"
            >
              {activity.map(event => (
                <Timeline.Item
                  key={`${event.label}-${event.at}`}
                  title={event.label}
                  // Los cierres llevan el círculo relleno con el color de su estado (el mismo del
                  // badge) y su tramo de línea pasa de ese color al de la línea (globals.css,
                  // .activity-closing); el resto de los pasos queda hueco.
                  {...(event.tone && {
                    color: STATUS_TONE_COLOR[event.tone],
                    className: 'activity-closing',
                    style: {
                      '--activity-tone': `var(--mantine-color-${STATUS_TONE_COLOR[event.tone]}-filled)`,
                    } as CSSProperties,
                    styles: { itemBullet: { backgroundColor: 'var(--activity-tone)' } },
                  })}
                >
                  <Text size="xs" c="dimmed">
                    {[event.actor, formatDateTime(event.at)].filter(Boolean).join(' · ')}
                  </Text>
                  {event.note && (
                    <Text size="sm" c="dimmed" mt={2}>
                      {event.note}
                    </Text>
                  )}
                </Timeline.Item>
              ))}
            </Timeline>
          </ScrollArea.Autosize>
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
            loading={command.isPending && command.variables?.action === 'claim'}
            disabled={command.isPending}
            onClick={() => run('claim')}
          >
            Reclamar
          </Button>
        )}
        {has('release') && (
          <Button
            variant="light"
            leftSection={<RotateCcw size={16} strokeWidth={1.5} />}
            loading={command.isPending && command.variables?.action === 'release'}
            disabled={command.isPending}
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
            loading={command.isPending && command.variables?.action === 'complete'}
            disabled={command.isPending}
            onClick={() => run('complete')}
          >
            Completar
          </Button>
        )}
        {has('force_complete') && (
          <Button
            color="orange"
            variant="light"
            leftSection={<ShieldAlert size={16} strokeWidth={1.5} />}
            loading={command.isPending && command.variables?.action === 'force_complete'}
            disabled={command.isPending}
            onClick={() => setForceCompleteOpened(true)}
          >
            Completar como administrador
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
            loading={command.isPending && command.variables?.action === 'archive'}
            disabled={command.isPending}
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
            loading={command.isPending && command.variables?.action === 'delete'}
            disabled={command.isPending}
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
        centered
      >
        <TaskEditForm task={task} onSaved={() => setEditOpened(false)} />
      </Modal>
      <Modal
        opened={reassignOpened}
        onClose={() => setReassignOpened(false)}
        title="Reasignar tarea"
        size="lg"
        centered
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
      <Modal
        opened={forceCompleteOpened}
        onClose={() => setForceCompleteOpened(false)}
        title="Completar tarea reclamada por otra persona"
        centered
      >
        <Stack>
          <Alert color="orange" icon={<ShieldAlert size={18} strokeWidth={1.5} />}>
            La tarea está en progreso y fue reclamada por{' '}
            <strong>{task.actor_labels?.claimed_by ?? 'otra persona'}</strong>. Al continuar, la
            tarea quedará completada a tu nombre. La persona que la reclamó permanecerá registrada
            en la actividad.
          </Alert>
          <CharacterCountTextarea
            label="Motivo de la finalización forzada"
            description="Este motivo quedará registrado en la actividad de la tarea."
            required
            minLength={3}
            maxLength={500}
            value={forceCompleteReason}
            error={textRuleError(forceCompleteReason, 'free')}
            onChange={event => setForceCompleteReason(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setForceCompleteOpened(false)}>
              Volver
            </Button>
            <Button
              color="orange"
              loading={command.isPending && command.variables?.action === 'force_complete'}
              disabled={
                command.isPending ||
                forceCompleteReason.trim().length < 3 ||
                Boolean(textRuleError(forceCompleteReason, 'free'))
              }
              onClick={() => {
                run('force_complete', forceCompleteReason)
                setForceCompleteOpened(false)
                setForceCompleteReason('')
              }}
            >
              Confirmar finalización
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={cancelOpened}
        onClose={() => setCancelOpened(false)}
        title="Cancelar tarea"
        centered
      >
        <Stack>
          <CharacterCountTextarea
            label="Motivo"
            required
            minLength={3}
            maxLength={500}
            value={cancelReason}
            error={textRuleError(cancelReason, 'free')}
            onChange={event => setCancelReason(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              color="red"
              disabled={
                cancelReason.trim().length < 3 || Boolean(textRuleError(cancelReason, 'free'))
              }
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text>{value}</Text>
    </div>
  )
}
