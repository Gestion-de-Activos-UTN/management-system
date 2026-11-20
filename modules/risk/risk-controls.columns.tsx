import type { ColumnDef } from '@tanstack/react-table'
import { Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { ControlIndex } from '@/domain/risk/deficiency-index'
import { controlTitle } from './risk-labels'

const percent = (value: number) => `${Math.round(value * 100)} %`

// Server order, no sortable columns: same rule as the two lists (contracts §7).
export const controlColumns: ColumnDef<ControlIndex, unknown>[] = [
  {
    id: 'control',
    header: 'Control',
    enableSorting: false,
    cell: ({ row }) => (
      <Stack gap={0}>
        <Text size="sm" fw={600}>
          {controlTitle(row.original.control_key)}
        </Text>
        <Text size="xs" c="dimmed">
          {row.original.control_key}
        </Text>
      </Stack>
    ),
  },
  {
    id: 'importance',
    header: 'Importancia',
    size: 110,
    enableSorting: false,
    cell: ({ row }) => <Text size="sm">{row.original.importance} de 4</Text>,
  },
  {
    id: 'deficiency',
    header: 'Deficiencia',
    size: 110,
    enableSorting: false,
    // null when the index is not visible (contracts §10.5).
    cell: ({ row }) => (
      <Text size="sm">
        {row.original.deficiency === null ? '—' : percent(row.original.deficiency)}
      </Text>
    ),
  },
  {
    id: 'coverage',
    header: 'Información disponible',
    enableSorting: false,
    cell: ({ row }) => {
      const { coverage, evaluated_pairs, pending_pairs } = row.original
      return (
        <Stack gap={0}>
          <Text size="sm">{percent(coverage)}</Text>
          <Text size="xs" c="dimmed">
            {evaluated_pairs} de {evaluated_pairs + pending_pairs} comprobaciones
          </Text>
        </Stack>
      )
    },
  },
  {
    id: 'warning',
    header: 'Aviso',
    size: 150,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.warning ? <StatusBadge tone="warning" label="Información limitada" /> : null,
  },
]
