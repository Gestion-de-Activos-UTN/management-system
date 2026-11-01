'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { textRuleError } from '@/lib/text-rules'
import { useState, type CSSProperties } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Menu,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Timeline,
} from '@mantine/core'
import { CharacterCountTextarea } from '@/components/ui/CharacterCountTextarea'
import {
  Archive,
  Check,
  ChevronDown,
  Hand,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { STATUS_TONE_COLOR, StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatDateTime } from '@/lib/format-date'
import { relationId } from '@/lib/relationId'
import { ReassignTaskSchema } from '../schema'
import type { TaskAction, TaskDTO } from '../service'
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from '../task-labels'
import { getTaskReferenceHref, getTaskCurrentReferenceHref } from '../task-reference-link'
import { useTaskCommand } from '../hooks/use-task-actions'
import { useTaskAssignmentOptions } from '../hooks/use-task-options'
import { TaskEditForm } from './TaskEditForm'
import { TaskAssignmentFields, type TaskAssignmentKind } from './TaskAssignmentFields'
import { TaskReferenceSummary } from './TaskReferenceSummary'
import { taskActivity } from '../task-activity'
import { TaskDeleteModal } from './TaskDeleteModal'
import { useRouter } from 'next/navigation'
import { portalHref } from '@/lib/portal-href'

export function TaskDetail({ task, asOrganization }: { task: TaskDTO; asOrganization?: string }) {
  const command = useTaskCommand(task.id)
  const router = useRouter()
  const [deleteOpened, setDeleteOpened] = useState(false)
  const [editOpened, setEditOpened] = useState(false)
  const [reassignOpened, setReassignOpened] = useState(false)
  const [cancelOpened, setCancelOpened] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [forceCompleteOpened, setForceCompleteOpened] = useState(false)
  const [forceCompleteReason, setForceCompleteReason] = useState('')
  const [assignmentKind, setAssignmentKind] = useState<TaskAssignmentKind>('open_pool')
  const [assignmentTarget, setAssignmentTarget] = useState<string | null>(null)
  const [assignmentError, setAssignmentError] = useState<string>()
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

  const openReassign = () => {
    setAssignmentKind(task.assignment_kind)
    const target =
      task.assignment_kind === 'role'
        ? task.assigned_role
        : task.assignment_kind === 'user'
          ? task.assigned_user
          : null
    setAssignmentTarget(target ? relationId(target) : null)
    setAssignmentError(undefined)
    setReassignOpened(true)
  }

  const reassign = () => {
    const payload =
      assignmentKind === 'role'
        ? { assignment_kind: 'role', assigned_role: assignmentTarget ?? undefined }
        : assignmentKind === 'user'
          ? { assignment_kind: 'user', assigned_user: assignmentTarget ?? undefined }
          : { assignment_kind: 'open_pool' }
    const parsed = ReassignTaskSchema.safeParse(payload)
    if (!parsed.success) {
      setAssignmentError(parsed.error.issues[0]?.message)
      return
    }
    command.mutate(
      { action: 'reassign', payload: parsed.data },
      { onSuccess: () => setReassignOpened(false) }
    )
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
            <Fact label="Ámbito" value={task.office ? 'Oficina' : 'Organización'} />
            {task.office && (
              <Fact
                label="Oficina"
                value={task.assignment_info?.office_name ?? 'Oficina no disponible'}
              />
            )}
            <Fact
              label="Asignación"
              value={
                task.assignment_kind === 'role'
                  ? 'Rol'
                  : task.assignment_kind === 'user'
                    ? 'Persona'
                    : 'Pool abierto'
              }
            />
            {task.assignment_kind === 'role' && (
              <Fact
                label="Rol asignado"
                value={task.assignment_info?.role_name ?? 'Rol no disponible'}
              />
            )}
            {task.assignment_kind === 'user' && (
              <Fact
                label="Persona asignada"
                value={task.assignment_info?.user_name ?? 'Persona no disponible'}
              />
            )}
            {task.claimed_by && (
              <Fact
                label="Reclamada por"
                value={task.actor_labels?.claimed_by ?? 'Persona no disponible'}
              />
            )}
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
            disabled={command.isPending}
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
          <Button variant="light" onClick={openReassign} disabled={command.isPending}>
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
        {/* Una pendiente sin reclamar admite cancelar y eliminar: un solo botón dividido.
            Cancelar (conserva la tarea y el motivo) queda a la vista; eliminar, tras la flecha. */}
        {has('cancel') &&
          (has('delete') ? (
            <Button.Group>
              <Button
                color="red"
                variant="light"
                leftSection={<XCircle size={16} strokeWidth={1.5} />}
                disabled={command.isPending}
                onClick={() => setCancelOpened(true)}
              >
                Cancelar
              </Button>
              <Menu position="top-end" offset={4} withinPortal>
                <Menu.Target>
                  <Button
                    color="red"
                    variant="light"
                    px="xs"
                    aria-label="Más opciones de cancelación"
                    // Button.Group sólo dibuja separador en variantes con borde; light lo necesita.
                    style={{ borderLeft: '1px solid var(--mantine-color-red-light-hover)' }}
                    disabled={command.isPending}
                  >
                    <ChevronDown size={16} strokeWidth={1.5} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    color="red"
                    leftSection={<Trash2 size={14} strokeWidth={1.5} />}
                    onClick={() => setDeleteOpened(true)}
                  >
                    Eliminar tarea
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Button.Group>
          ) : (
            <Button
              color="red"
              variant="light"
              leftSection={<XCircle size={16} strokeWidth={1.5} />}
              disabled={command.isPending}
              onClick={() => setCancelOpened(true)}
            >
              Cancelar
            </Button>
          ))}
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
        {has('delete') && !has('cancel') && (
          <Button
            color="red"
            variant="subtle"
            leftSection={<Trash2 size={16} strokeWidth={1.5} />}
            loading={command.isPending && command.variables?.action === 'delete'}
            disabled={command.isPending}
            onClick={() => setDeleteOpened(true)}
          >
            Eliminar
          </Button>
        )}
      </Group>

      <TaskDeleteModal
        opened={deleteOpened}
        title={task.title}
        isPending={command.isPending}
        onClose={() => setDeleteOpened(false)}
        onConfirm={() => {
          // La invalidación puede desmontar el detalle antes de resolver la mutación.
          // La promesa conserva la navegación aunque el componente ya no se muestre.
          void command.mutateAsync({ action: 'delete' }).then(
            () => {
              setDeleteOpened(false)
              router.push(portalHref('/portal/tasks', asOrganization))
            },
            () => {
              // El hook muestra el error; el modal permite reintentar.
            }
          )
        }}
      />
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
        onClose={() => {
          if (!command.isPending) setReassignOpened(false)
        }}
        closeOnClickOutside={!command.isPending}
        closeOnEscape={!command.isPending}
        closeButtonProps={{ disabled: command.isPending }}
        title="Reasignar tarea"
        size="lg"
        centered
      >
        <ModalLayout
          footer={
            <Group justify="flex-end">
              <Button
                onClick={reassign}
                loading={command.isPending && command.variables?.action === 'reassign'}
                disabled={
                  command.isPending || assignmentOptions.isPending || assignmentOptions.isError
                }
              >
                Reasignar
              </Button>
            </Group>
          }
        >
          {assignmentOptions.isError && (
            <Alert color="red" title="No se pudieron cargar los destinatarios">
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() => void assignmentOptions.refetch()}
              >
                Reintentar
              </Button>
            </Alert>
          )}
          <TaskAssignmentFields
            kind={assignmentKind}
            target={assignmentTarget}
            options={assignmentOptions.data}
            targetError={assignmentError}
            disabled={command.isPending || assignmentOptions.isPending || assignmentOptions.isError}
            onKindChange={kind => {
              setAssignmentKind(kind)
              setAssignmentTarget(null)
              setAssignmentError(undefined)
            }}
            onTargetChange={value => {
              setAssignmentTarget(value)
              setAssignmentError(undefined)
            }}
          />
        </ModalLayout>
      </Modal>
      <Modal
        opened={forceCompleteOpened}
        onClose={() => setForceCompleteOpened(false)}
        title="Completar tarea reclamada por otra persona"
        centered
      >
        <ModalLayout
          footer={
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
          }
        >
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
        </ModalLayout>
      </Modal>
      <Modal opened={cancelOpened} onClose={() => setCancelOpened(false)} title="Cancelar" centered>
        <ModalLayout
          footer={
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
                Cancelar
              </Button>
            </Group>
          }
        >
          <CharacterCountTextarea
            label="Motivo"
            description="La tarea queda cancelada con este motivo y se conserva en la actividad."
            required
            minLength={3}
            maxLength={500}
            value={cancelReason}
            error={textRuleError(cancelReason, 'free')}
            onChange={event => setCancelReason(event.currentTarget.value)}
          />
        </ModalLayout>
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
