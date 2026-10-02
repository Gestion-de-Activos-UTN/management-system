import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Badge, Text, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDateTime } from '@/lib/format-date'
import type { TaskDTO } from './service'
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from './task-labels'

export function getTasksColumns(asOrganization?: string): ColumnDef<TaskDTO, unknown>[] {
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : ''
  return [
    {
      accessorKey: 'title',
      header: 'Tarea',
      cell: ({ row }) => (
        <div>
          <Text fw={600} size="sm" lineClamp={1}>
            {row.original.title}
          </Text>
          {row.original.related_entity_info?.label && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {row.original.related_entity_info.label}
            </Text>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'priority',
      header: 'Prioridad',
      size: 110,
      cell: ({ row }) => (
        <Badge variant="light">{TASK_PRIORITY_LABELS[row.original.priority]}</Badge>
      ),
    },
    {
      accessorKey: 'effective_status',
      header: 'Estado',
      size: 130,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <StatusBadge
          tone={TASK_STATUS_TONES[row.original.effective_status]}
          label={TASK_STATUS_LABELS[row.original.effective_status]}
        />
      ),
    },
    {
      accessorKey: 'due_at',
      header: 'Vencimiento',
      cell: ({ row }) =>
        row.original.due_at ? formatDateTime(row.original.due_at) : 'Sin vencimiento',
    },
    {
      id: 'actions',
      header: '',
      size: 48,
      cell: ({ row }) => (
        <Tooltip label="Ver tarea">
          <ActionIcon
            component={Link}
            href={`/portal/tasks/${row.original.id}${suffix}`}
            variant="light"
          >
            <Eye size={16} />
          </ActionIcon>
        </Tooltip>
      ),
    },
  ]
}
