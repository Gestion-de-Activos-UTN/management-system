import type { ColumnDef } from '@tanstack/react-table'
import { Group, Text, Tooltip } from '@mantine/core'
import { AlertTriangle, Archive, UserRoundCog } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format-date'
import type { TaskDTO } from './service'
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  TASK_REFERENCE_ICONS,
  TASK_REFERENCE_TYPE_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
} from './task-labels'
import { RowActions } from './components/RowActions'

export function getTasksColumns(asOrganization?: string): ColumnDef<TaskDTO, unknown>[] {
  return [
    {
      accessorKey: 'title',
      header: 'Tarea',
      cell: ({ row }) => {
        const reference = row.original.related_entity_info
        const Icon = reference ? TASK_REFERENCE_ICONS[reference.relationTo] : null
        return (
          <div>
            <Group gap={6} wrap="nowrap" align="center" w="100%" miw={0}>
              {row.original.requires_reassignment && (
                <Tooltip label="Requiere reasignación: la asignación actual no tiene personas elegibles">
                  <span style={{ flexShrink: 0 }}>
                    <StatusBadge
                      tone="warning"
                      label="Requiere reasignación"
                      icon={<UserRoundCog size={13} strokeWidth={1.5} />}
                      iconOnly
                      size="xs"
                    />
                  </span>
                </Tooltip>
              )}
              <Text fw={600} size="sm" lineClamp={1} style={{ minWidth: 0, flex: 1 }}>
                {row.original.title}
              </Text>
            </Group>
            {reference && (
              <Group gap={4} wrap="nowrap" c="dimmed">
                {Icon && <Icon size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />}
                <Text size="xs" lineClamp={1}>
                  {TASK_REFERENCE_TYPE_LABELS[reference.relationTo]}
                  {reference.label ? ` · ${reference.label}` : ''}
                </Text>
              </Group>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'priority',
      header: 'Prioridad',
      size: 110,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <StatusBadge
          tone={TASK_PRIORITY_TONES[row.original.priority]}
          label={TASK_PRIORITY_LABELS[row.original.priority]}
        />
      ),
    },
    {
      accessorKey: 'effective_status',
      header: 'Estado',
      size: 130,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <Group gap={6} justify="center" wrap="nowrap">
          <StatusBadge
            tone={TASK_STATUS_TONES[row.original.effective_status]}
            label={TASK_STATUS_LABELS[row.original.effective_status]}
          />
          {row.original.archived_at && (
            <Tooltip label="Tarea archivada">
              <span style={{ flexShrink: 0 }}>
                <StatusBadge
                  tone="neutral"
                  label="Archivada"
                  icon={<Archive size={13} strokeWidth={1.5} />}
                  iconOnly
                  size="xs"
                />
              </span>
            </Tooltip>
          )}
        </Group>
      ),
    },
    {
      accessorKey: 'due_at',
      header: 'Vencimiento',
      cell: ({ row }) =>
        row.original.due_at ? (
          <Group gap={4} wrap="nowrap" c={row.original.is_overdue ? 'red' : undefined}>
            {row.original.is_overdue && <AlertTriangle size={14} strokeWidth={1.5} />}
            <Text size="sm" fw={row.original.is_overdue ? 600 : undefined}>
              {formatDate(row.original.due_at)}
            </Text>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            Sin vencimiento
          </Text>
        ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      size: 140,
      meta: { align: 'center' },
      cell: ({ row }) => <RowActions task={row.original} asOrganization={asOrganization} />,
    },
  ]
}
